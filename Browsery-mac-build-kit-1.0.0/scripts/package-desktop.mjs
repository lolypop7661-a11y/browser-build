import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { verifyWindowsPackage } from './verify-windows-package.mjs';
import './build-proton-helper.mjs';
import './create-browsery-icon.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const stage = path.join(root, 'work', 'desktop-package-stage');
const outputsRoot = path.join(root, 'outputs');
const output = path.resolve(outputsRoot, process.env.BROWSERY_PACKAGE_OUTPUT || '.');
const outputRelative = path.relative(outputsRoot, output);
if (outputRelative.startsWith('..') || path.isAbsolute(outputRelative)) {
  throw new Error('Desktop packages must be written inside the Browsery outputs directory.');
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
await cp(path.join(root, 'electron'), path.join(stage, 'electron'), { recursive: true });
await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: 'browsery',
  productName: 'Browsery',
  version: metadata.version,
  description: metadata.description,
  main: 'electron/main.cjs',
}, null, 2));

const [appDirectory] = await packager({
  dir: stage,
  name: 'Browsery',
  appVersion: metadata.version,
  buildVersion: metadata.version,
  platform: 'win32',
  arch: 'x64',
  out: output,
  overwrite: true,
  icon: path.join(stage, 'dist', 'assets', 'browsery-icon.ico'),
  asar: { unpack: '**/native/*.exe' },
});

await verifyWindowsPackage(appDirectory, metadata.version);

console.log(`Browsery desktop app: ${path.join(appDirectory, 'Browsery.exe')}`);
console.log('Verified the complete Electron runtime is included.');
