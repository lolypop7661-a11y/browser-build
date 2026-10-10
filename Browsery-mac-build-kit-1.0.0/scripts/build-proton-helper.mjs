import { access, mkdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildProtonHelper() {
  if (process.platform !== 'win32') throw new Error('The Proton Connect helper must be built on Windows.');
  const framework = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const compiler = path.join(framework, 'csc.exe');
  const source = path.join(root, 'electron', 'native', 'ProtonConnect.cs');
  const output = path.join(root, 'electron', 'native', 'Browsery.ProtonConnect.exe');
  const references = ['UIAutomationClient.dll', 'UIAutomationTypes.dll', 'WindowsBase.dll']
    .map(name => path.join(framework, 'WPF', name));
  await Promise.all([compiler, source, ...references].map(file => access(file)));
  await mkdir(path.dirname(output), { recursive: true });
  try {
    await promisify(execFile)(compiler, [
      '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/debug-', '/warn:4', '/warnaserror+',
      `/out:${output}`, ...references.map(file => `/reference:${file}`), source,
    ], { cwd: root, windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    throw new Error(`Proton Connect helper compilation failed: ${String(error.stdout || error.stderr || error.message).trim()}`);
  }
  const info = await stat(output);
  if (!info.isFile() || !info.size) throw new Error('The Proton Connect helper executable was not generated.');
  console.log('Compiled Browsery.ProtonConnect.exe (no Proton app interaction).');
  return output;
}

// Import this module before the desktop staging copy. Compilation is automatic;
// neither the helper nor the Proton app is launched by the build step.
await buildProtonHelper();
