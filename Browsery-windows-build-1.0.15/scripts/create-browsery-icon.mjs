import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngPath = path.join(root, 'public', 'assets', 'browsery-icon.png');
const icoPath = path.join(root, 'public', 'assets', 'browsery-icon.ico');
const png = await readFile(pngPath);

// Windows accepts PNG payloads inside an ICO container (Vista+), preserving
// the full alpha channel while keeping the source asset easy to edit.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6); // 256px is encoded as 0 in ICO metadata.
header.writeUInt8(0, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);

await mkdir(path.dirname(icoPath), { recursive: true });
await writeFile(icoPath, Buffer.concat([header, png]));
console.log(`Browsery icon: ${icoPath}`);
