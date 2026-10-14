const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

// Commands and executables are chosen here, never supplied by a webpage.
const SIGNATURE_CHECK = "$ErrorActionPreference='Stop'; $files=@($env:BROWSERY_PROTON_LAUNCHER,$env:BROWSERY_PROTON_CLIENT); $valid=$true; foreach($file in $files){$signature=Get-AuthenticodeSignature -LiteralPath $file; if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\\s*)CN=Proton AG(?:,|$)'){$valid=$false}}; ConvertTo-Json -Compress -InputObject $valid";
const PROCESS_QUERY = "$ErrorActionPreference='Stop'; $root=$env:BROWSERY_PROTON_DIRECTORY+'\\'; $items=@(Get-Process -Name 'ProtonVPN.Client' -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $signature=Get-AuthenticodeSignature -LiteralPath $_.Path; @{pid=$_.Id;path=$_.Path;verified=($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match '(?:^|,\\s*)CN=Proton AG(?:,|$)')} }); ConvertTo-Json -Compress -InputObject $items";

function runFile(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, { windowsHide: true, timeout: 15000, maxBuffer: 16384, ...options }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function launchFile(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function createProtonController({
  helperPath,
  platform = process.platform,
  environment = process.env,
  disk = fs,
  run = runFile,
  launch = launchFile,
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  let activeAction = null;
  const powershell = path.join(environment.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

  function findInstallation() {
    if (platform !== 'win32') return null;
    const roots = [...new Set([environment.ProgramW6432, environment.ProgramFiles, environment['ProgramFiles(x86)']].filter(Boolean))];
    for (const directory of roots) {
      const root = path.join(directory, 'Proton', 'VPN');
      const launcher = path.join(root, 'ProtonVPN.Launcher.exe');
      try {
        if (!disk.statSync(launcher).isFile()) continue;
        const versions = disk.readdirSync(root, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && /^v\d+\.\d+\.\d+(?:\.\d+)?$/.test(entry.name))
          .sort((left, right) => {
            const a = left.name.slice(1).split('.').map(Number), b = right.name.slice(1).split('.').map(Number);
            for (let index = 0; index < 4; index++) { const difference = (b[index] || 0) - (a[index] || 0); if (difference) return difference; }
            return 0;
          });
        for (const version of versions) {
          const client = path.join(root, version.name, 'ProtonVPN.Client.exe');
          if (disk.existsSync(client) && disk.statSync(client).isFile()) return { root, launcher, client, version: version.name.slice(1) };
        }
      } catch { /* Try the other standard installation directory. */ }
    }
    return null;
  }

  function helperAvailable() {
    try { return Boolean(helperPath && disk.statSync(helperPath).isFile()); } catch { return false; }
  }

  function getStatus() {
    const installation = findInstallation();
    const installed = Boolean(installation);
    return {
      installed,
      canConnect: installed && helperAvailable(),
      ...(installed ? { version: installation.version } : {}),
      message: platform !== 'win32' ? 'Proton control is available in Browsery for Windows.' : !installed ? 'Install Proton’s official Windows app, then sign in there.' : !helperAvailable() ? 'Proton is installed. Rebuild Browsery to enable its connection helper.' : 'Ready to open Proton and press its Connect button. Connection status stays in Proton.',
    };
  }

  function options(installation) {
    return { env: { ...environment, BROWSERY_PROTON_DIRECTORY: installation.root, BROWSERY_PROTON_LAUNCHER: installation.launcher, BROWSERY_PROTON_CLIENT: installation.client } };
  }

  async function verify(installation) {
    const result = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', SIGNATURE_CHECK], options(installation));
    if (JSON.parse(String(result).trim()) !== true) throw new Error('Publisher verification failed');
  }

  async function processId(installation) {
    const output = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', PROCESS_QUERY], { ...options(installation), timeout: 4000 });
    const parsed = JSON.parse(String(output).trim() || '[]');
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const matches = entries.filter(entry => Number.isSafeInteger(entry?.pid) && entry.pid > 0 && typeof entry.path === 'string' &&
      path.basename(entry.path).toLowerCase() === 'protonvpn.client.exe' &&
      /^v\d+\.\d+\.\d+(?:\.\d+)?$/i.test(path.basename(path.dirname(entry.path))) &&
      path.resolve(path.dirname(path.dirname(entry.path))).toLowerCase() === path.resolve(installation.root).toLowerCase());
    if (matches.length > 1) throw new Error('More than one Proton client is running');
    if (matches.length && matches[0].verified !== true) throw new Error('The running Proton client could not be verified');
    return matches[0]?.pid;
  }

  async function perform(connect) {
    const installation = findInstallation();
    if (!installation) return { ok: false, status: 'not-installed', message: getStatus().message };
    if (connect && !helperAvailable()) return { ok: false, status: 'helper-unavailable', message: getStatus().message };
    try { await verify(installation); }
    catch { return { ok: false, status: 'unverified-app', message: 'Proton’s app signature could not be verified. Open the official Proton app yourself; Browsery did not run it.' }; }
    try {
      // Proton's supported launcher restores an existing window or selects its current version.
      await launch(installation.launcher, ['-OpenOnDesktop']);
      if (!connect) return { ok: true, status: 'opened', message: 'Proton VPN opened. Its app shows your actual connection status.' };
      let pid; const started = Date.now();
      for (let attempt = 0; attempt < 12 && !pid && Date.now() - started < 10000; attempt++) {
        pid = await processId(installation);
        if (!pid) await delay(300);
      }
      if (!pid) return { ok: false, status: 'manual-required', message: 'Proton is opening. Finish signing in there, then try Connect Proton again.' };
      const result = JSON.parse(String(await run(helperPath, ['--connect', String(pid)])).trim());
      const statuses = new Set(['requested', 'already-connected', 'connecting', 'manual-required', 'unavailable', 'failed']);
      const success = ['requested', 'already-connected', 'connecting'].includes(result?.status);
      if (!statuses.has(result?.status) || result.ok !== success || typeof result.message !== 'string') throw new Error('Invalid helper result');
      return { ok: result.ok, status: result.status, message: result.message.slice(0, 400) };
    } catch {
      return { ok: false, status: 'manual-required', message: 'Proton opened, but Browsery could not safely press Connect. Sign in or close any Proton dialog, then try again—or connect in Proton.' };
    }
  }

  function action(connect) {
    // One native action at a time, even across rapid clicks or multiple IPC requests.
    if (activeAction) return Promise.resolve({ ok: false, status: 'busy', message: 'A Proton action is already running. Please wait.' });
    activeAction = perform(connect).finally(() => { activeAction = null; });
    return activeAction;
  }

  return { getStatus, open: () => action(false), connect: () => action(true) };
}

module.exports = { createProtonController };
