import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import './build-proton-helper.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  version: '1.0.0',
  description: 'A desktop browser with a Saturn new-tab experience.',
  main: 'electron/main.cjs',
}, null, 2));

const [appDirectory] = await packager({
  dir: stage,
  name: 'Browsery',
  platform: 'win32',
  arch: 'x64',
  out: output,
  overwrite: true,
  asar: { unpack: '**/native/*.exe' },
});

// Electron needs its runtime files beside the executable to start on double-click.
const requiredRuntimeFiles = [
  'Browsery.exe', 'icudtl.dat', 'resources.pak',
  'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'snapshot_blob.bin', 'v8_context_snapshot.bin',
  'locales/en-US.pak', 'resources/app.asar',
  'resources/app.asar.unpacked/electron/native/Browsery.ProtonConnect.exe',
];
await Promise.all(requiredRuntimeFiles.map(async file => {
  const info = await stat(path.join(appDirectory, file));
  if (!info.isFile() || info.size === 0) throw new Error(`Desktop package is incomplete: ${file}`);
}));

console.log(`Browsery desktop app: ${path.join(appDirectory, 'Browsery.exe')}`);
console.log('Verified the complete Electron runtime is included.');
