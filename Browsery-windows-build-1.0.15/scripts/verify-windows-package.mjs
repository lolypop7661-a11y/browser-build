import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagerRequire = createRequire(require.resolve('@electron/packager'));
const { extractFile, listPackage } = packagerRequire('@electron/asar');

// A raw Electron directory can produce an installer with broken shortcuts.
// Check the application, not just the runtime, before building or sharing it.
export async function verifyWindowsPackage(directory, expectedVersion) {
  const requiredFiles = [
    'Browsery.exe', 'icudtl.dat', 'resources.pak', 'ffmpeg.dll',
    'chrome_100_percent.pak', 'chrome_200_percent.pak',
    'snapshot_blob.bin', 'v8_context_snapshot.bin',
    'locales/en-US.pak', 'resources/app.asar',
    'resources/app.asar.unpacked/electron/native/Browsery.ProtonConnect.exe',
  ];
  await Promise.all(requiredFiles.map(async relative => {
    const info = await stat(path.join(directory, relative)).catch(() => null);
    if (!info?.isFile() || info.size === 0) {
      throw new Error(`Incomplete Browsery package: missing ${relative}`);
    }
  }));

  const archive = path.join(directory, 'resources', 'app.asar');
  const readArchive = relative => extractFile(archive, relative.replaceAll('/', path.sep));
  const files = listPackage(archive).map(file => file.replaceAll('\\', '/').replace(/^\//, ''));
  const metadata = JSON.parse(readArchive('package.json').toString());
  if (metadata.productName !== 'Browsery' || metadata.main !== 'electron/main.cjs' || metadata.version !== expectedVersion) {
    throw new Error('Packaged app metadata does not match the Browsery release.');
  }
  for (const relative of [
    'electron/main.cjs', 'electron/preload.cjs', 'electron/adblocker.cjs', 'electron/adblock-rules.json',
    'electron/global-control.cjs', 'electron/global-control-config.json', 'electron/captcha.cjs',
    'electron/ai-overview.cjs', 'electron/proton-vpn.cjs',
    'dist/index.html', 'dist/assets/browsery-icon.ico',
    'dist/assets/browsery-icon.png', 'dist/assets/saturn-loop.mp4',
    'dist/assets/terminal-loading.mp4',
  ]) {
    if (!files.includes(relative) || readArchive(relative).length === 0) {
      throw new Error(`Incomplete Browsery archive: missing ${relative}`);
    }
  }
  const launchVideo = readArchive('dist/assets/terminal-loading.mp4');
  const movieOffset = launchVideo.indexOf(Buffer.from('moov'));
  const mediaOffset = launchVideo.indexOf(Buffer.from('mdat'));
  if (!launchVideo.includes(Buffer.from('avc1')) || movieOffset < 0 || mediaOffset < 0 || movieOffset > mediaOffset) {
    throw new Error('Browsery launch video must be a fast-start H.264 MP4.');
  }
  const html = readArchive('dist/index.html').toString();
  const script = html.match(/src="\.\/([^"\s]+\.js)"/)?.[1];
  if (!script || !files.includes(`dist/${script}`)) throw new Error('Built renderer entry is missing.');
  const renderer = readArchive(`dist/${script}`).toString();
  if (!renderer.includes('browsery:tutorial-complete-v3') || !renderer.includes('Your Browsery owner guide')) {
    throw new Error('This archive does not include the updated presentation tutorial.');
  }
  if (!files.includes('node_modules/electron-updater/out/main.js')) {
    throw new Error('This archive does not include Browsery’s in-app update runtime.');
  }
  return { version: metadata.version, files: files.length, renderer: script };
}
