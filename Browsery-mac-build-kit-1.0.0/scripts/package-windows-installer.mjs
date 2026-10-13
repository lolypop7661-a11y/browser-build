import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build, Platform } from 'electron-builder';
import { verifyWindowsPackage } from './verify-windows-package.mjs';
import './build-proton-helper.mjs';
import './create-browsery-icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'outputs', `windows-${metadata.version}`);
const filename = `Browsery-${metadata.version}-x64.exe`;
await mkdir(release, { recursive: true });

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Packaging step exited with code ${code}`)));
  });
}

// Build from the project root, not a stripped staging copy. electron-builder
// then carries the small production-only electron-updater runtime into app.asar
// and writes the app-update.yml / latest.yml metadata from build.publish.
const artifacts = await build({
  projectDir: root,
  targets: Platform.WINDOWS.createTarget('nsis'),
  publish: 'never',
  config: { directories: { output: release } },
});
const installer = artifacts.find(file => path.basename(file) === filename) || path.join(release, filename);
if (!(await stat(installer).catch(() => null))?.size) throw new Error('NSIS installer was not created.');

const appDirectory = path.join(release, 'win-unpacked');
const verified = await verifyWindowsPackage(appDirectory, metadata.version);
const latest = path.join(release, 'latest.yml');
const blockmap = `${installer}.blockmap`;
const [latestText, blockmapInfo] = await Promise.all([
  readFile(latest, 'utf8').catch(() => ''),
  stat(blockmap).catch(() => null),
]);
if (!latestText.includes(`version: ${metadata.version}`) || !latestText.includes(filename) || !/sha512:/i.test(latestText)) {
  throw new Error('The Windows update feed is missing or does not match this release.');
}
if (!blockmapInfo?.isFile() || blockmapInfo.size === 0) throw new Error('The NSIS differential update blockmap was not created.');

// 7-Zip recognizes NSIS's embedded application archive directly. Extract the
// final executable, not a neighboring archive that could belong to an old build.
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve('electron-builder'));
const libraryRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const { getPath7za } = libraryRequire('./toolsets/7zip');
const sevenZip = await getPath7za();
const extracted = await mkdtemp(path.join(release, 'verify-'));
await run(sevenZip, ['t', '-bd', '-bso0', '-bsp0', installer]);
await run(sevenZip, ['x', '-y', '-bd', '-bso0', '-bsp0', `-o${extracted}`, installer]);
await verifyWindowsPackage(extracted, metadata.version);

const hash = createHash('sha256');
for await (const chunk of createReadStream(installer)) hash.update(chunk);
const checksum = hash.digest('hex');
await writeFile(`${installer}.sha256`, `${checksum}  ${path.basename(installer)}\n`);
await writeFile(path.join(release, 'verification.json'), JSON.stringify({
  installer: path.basename(installer),
  bytes: (await stat(installer)).size,
  sha256: checksum,
  package: verified,
  updateFeed: { manifest: path.basename(latest), blockmap: path.basename(blockmap) },
  checks: ['complete packaged app', 'release version matches', 'owner guide included', 'in-app updater included', 'update feed matches installer', 'embedded installer payload extracted and verified'],
}, null, 2));
console.log(`Verified Windows installer and update feed: ${installer}`);
