import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const owner = 'lolypop7661-a11y';
const repo = 'browser-build';
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const tag = `v${metadata.version}`;
const filename = `Browsery-${metadata.version}-x64.exe`;
const installer = path.join(root, 'outputs', `windows-${metadata.version}`, filename);
const blockmap = `${installer}.blockmap`;
const latest = path.join(root, 'outputs', `windows-${metadata.version}`, 'latest.yml');
const adblockRules = path.join(root, 'electron', 'adblock-rules.json');
const report = JSON.parse(await readFile(path.join(path.dirname(installer), 'verification.json'), 'utf8'));
if (report.installer !== filename || report.bytes !== (await stat(installer)).size) throw new Error('Installer verification report is out of date.');
const latestText = await readFile(latest, 'utf8').catch(() => '');
if (!latestText.includes(`version: ${metadata.version}`) || !latestText.includes(filename) || !/sha512:/i.test(latestText)) throw new Error('The Windows update feed is missing or does not match this installer.');
if (!(await stat(blockmap)).size) throw new Error('The Windows update blockmap is missing.');
const installerHash = createHash('sha256');
for await (const chunk of createReadStream(installer)) installerHash.update(chunk);
if (installerHash.digest('hex') !== report.sha256) throw new Error('The installer checksum does not match the verified build.');

// Consume Git's normal credential helper in memory. Credentials never go into
// command arguments, files, release notes, or console output.
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || await new Promise(resolve => {
  const child = spawn('git', ['credential', 'fill'], {
    cwd: root, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GCM_GUI_PROMPT: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let result = '';
  child.stdout.on('data', chunk => { result += chunk; });
  child.stderr.resume();
  child.once('error', () => resolve(null));
  child.once('close', code => resolve(code === 0 ? result.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9) : null));
  child.stdin.end('protocol=https\nhost=github.com\n\n');
});
if (!token) {
  console.log(JSON.stringify({ connected: false, reason: 'GitHub is not authenticated on this computer.' }));
  process.exit(2);
}

const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Browsery-release-upload' };
async function request(endpoint, options = {}, accepted = [200, 201]) {
  const response = await fetch(`https://api.github.com${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!accepted.includes(response.status)) throw new Error(`GitHub request failed (${response.status}): ${data.message || 'Unknown error'}`);
  return { status: response.status, data };
}
const { data: repository } = await request(`/repos/${owner}/${repo}`);
// GitHub's workflow token can publish because this workflow explicitly grants
// contents: write, but the REST response omits `repository.permissions` for
// that short-lived token. A personal credential still has to prove push access.
const usesWorkflowToken = Boolean(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
if (!usesWorkflowToken && !repository.permissions?.push) throw new Error('The signed-in GitHub account cannot upload releases to this repository.');
if (!process.argv.includes('--publish')) {
  console.log(JSON.stringify({ connected: true, repository: repository.full_name, canPublish: true }));
} else {

const existing = await request(`/repos/${owner}/${repo}/releases/tags/${tag}`, {}, [200, 404]);
let release = existing.status === 200 ? existing.data : (await request(`/repos/${owner}/${repo}/releases`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ tag_name: tag, name: `Browsery ${metadata.version}`, draft: true, prerelease: false,
    body: `Browsery ${metadata.version} for Windows x64.\n\nThis release includes Browsery’s click-to-update channel. Installed copies check this official release feed, download only after a person clicks Update, and apply only after Restart & update.\n\nAssets: ${filename}, ${path.basename(blockmap)}, and latest.yml.\n\nSHA-256: ${report.sha256}` }),
})).data;

for (const file of [installer, blockmap, latest, `${installer}.sha256`, adblockRules]) {
  const name = file === adblockRules ? 'browsery-adblock-rules.json' : path.basename(file);
  const found = release.assets?.find(asset => asset.name === name);
  if (found) {
    if (found.size !== (await stat(file)).size) throw new Error(`A different ${name} already exists on this release; no file was overwritten.`);
    continue;
  }
  const response = await fetch(`https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': name.endsWith('.exe') || name.endsWith('.blockmap') ? 'application/octet-stream' : name.endsWith('.json') ? 'application/json' : name.endsWith('.yml') ? 'text/yaml' : 'text/plain', 'Content-Length': String((await stat(file)).size) },
    body: createReadStream(file), duplex: 'half',
  });
  const asset = await response.json();
  if (response.status !== 201 || asset.state !== 'uploaded') throw new Error(`GitHub asset upload failed (${response.status}): ${asset.message || 'Upload incomplete'}`);
  console.log(JSON.stringify({ uploaded: asset.name, bytes: asset.size }));
}
if (release.draft) release = (await request(`/repos/${owner}/${repo}/releases/${release.id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false, make_latest: 'true' }),
})).data;
release = (await request(`/repos/${owner}/${repo}/releases/${release.id}`)).data;
const asset = release.assets.find(item => item.name === filename && item.state === 'uploaded');
const updaterAssets = [filename, path.basename(blockmap), path.basename(latest)];
if (release.draft || !asset || asset.size !== report.bytes || updaterAssets.some(name => !release.assets.some(item => item.name === name && item.state === 'uploaded'))) throw new Error('The published installer or update feed could not be verified.');
console.log(JSON.stringify({ release: release.html_url, download: asset.browser_download_url, bytes: asset.size }));
}
