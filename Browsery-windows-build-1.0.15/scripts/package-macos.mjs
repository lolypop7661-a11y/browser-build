import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeFiles = ['main.cjs', 'preload.cjs', 'ai-overview.cjs', 'proton-vpn.cjs'];
const textExtensions = new Set(['.cjs', '.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt']);
const sensitiveName = /^(?:\..*|node_modules|native|profiles?|user[- ]?data|sessions?|cookies|local storage|indexeddb|credentials?|secrets?|groq-api-key\.bin)$/i;
const sensitiveExtension = /\.(?:exe|dll|p12|pfx|p8|pem|key|mobileprovision|bin|sqlite\d*|db|log|map)$/i;

async function checkPayloadFile(file, label) {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the macOS payload: ${label}`);
  if (!info.isFile()) throw new Error(`Expected a runtime file: ${label}`);
  if (textExtensions.has(path.extname(file).toLowerCase())) {
    // Never print the match: build logs and artifacts must not disclose an API key.
    if (/gsk_[A-Za-z0-9]{30,}/.test(await readFile(file, 'utf8'))) {
      throw new Error(`A hardcoded Groq API key was found; remove it before packaging: ${label}`);
    }
  }
}

async function checkRendererTree(directory, relative = 'dist') {
  const info = await lstat(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Invalid renderer directory: ${relative}`);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const label = `${relative}/${entry.name}`;
    if (sensitiveName.test(entry.name) || sensitiveExtension.test(entry.name)) {
      throw new Error(`Private, native or development data is not allowed in the macOS payload: ${label}`);
    }
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await checkRendererTree(file, label);
    else await checkPayloadFile(file, label);
  }
}

// The staging allowlist excludes profiles, .env files, certificates, node_modules,
// development scripts and the Windows-only Proton executable by construction.
export async function stageMacPayload(sourceRoot, stage, metadata) {
  await checkRendererTree(path.join(sourceRoot, 'dist'));
  for (const file of runtimeFiles) {
    await checkPayloadFile(path.join(sourceRoot, 'electron', file), `electron/${file}`);
  }
  await mkdir(path.join(stage, 'electron'), { recursive: true });
  await cp(path.join(sourceRoot, 'dist'), path.join(stage, 'dist'), { recursive: true });
  for (const file of runtimeFiles) {
    await cp(path.join(sourceRoot, 'electron', file), path.join(stage, 'electron', file));
  }
  await writeFile(path.join(stage, 'package.json'), JSON.stringify({
    name: 'browsery',
    productName: 'Browsery',
    version: metadata.version,
    description: metadata.description,
    main: 'electron/main.cjs',
  }, null, 2));
}

function hasNotarizationCredentials() {
  return Boolean(process.env.APPLE_KEYCHAIN_PROFILE
    || (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID)
    || (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER));
}

export async function prepareMacOutputDirectory(sourceRoot) {
  const workspace = await realpath(sourceRoot);
  let output = workspace;
  for (const name of ['outputs', 'macos']) {
    output = path.join(output, name);
    const info = await lstat(output).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new Error('The macOS output directory must be a real directory inside this workspace, not a symlink.');
    }
    if (!info) await mkdir(output);
    output = await realpath(output);
    const relative = path.relative(workspace, output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('macOS packages must be written inside this Browsery workspace.');
    }
  }
  return output;
}

export async function packageMacOS() {
  // Check before importing build tools, building dist, staging or touching outputs.
  if (process.platform !== 'darwin') {
    throw new Error('A real Browsery .dmg must be built on macOS. Run pnpm package:mac on a Mac or an authorized macOS CI runner. No .dmg was created.');
  }
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--signed') || args.length > 1) throw new Error('Usage: pnpm package:mac [--signed]');
  const signed = args.includes('--signed');
  if (signed && !hasNotarizationCredentials()) {
    throw new Error('Signed distribution requires Apple notarization credentials in the environment or an APPLE_KEYCHAIN_PROFILE, plus a Developer ID Application signing identity. Never put credentials in the project.');
  }

  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const require = createRequire(import.meta.url);
  const electronVersion = require('electron/package.json').version;
  const output = await prepareMacOutputDirectory(root);
  const { build: buildRenderer } = await import('vite');
  const { build, Platform, Arch } = await import('electron-builder');
  await buildRenderer({ root });

  const workspace = await realpath(root);
  const work = path.join(root, 'work');
  await mkdir(work, { recursive: true });
  const resolvedWork = await realpath(work);
  const relativeWork = path.relative(workspace, resolvedWork);
  if (!relativeWork || relativeWork.startsWith('..') || path.isAbsolute(relativeWork)) {
    throw new Error('The macOS staging directory must be inside this Browsery workspace.');
  }
  const stage = await mkdtemp(path.join(resolvedWork, 'macos-package-'));
  try {
    await stageMacPayload(root, stage, metadata);
    const artifacts = await build({
      projectDir: root,
      targets: Platform.MAC.createTarget(['dmg'], Arch.arm64, Arch.x64),
      publish: 'never',
      config: {
        ...metadata.build,
        extends: null,
        electronVersion,
        directories: { app: stage, output },
        files: ['dist/**/*', 'electron/*.cjs', 'package.json'],
        npmRebuild: false,
        nodeGypRebuild: false,
        forceCodeSigning: signed,
        mac: {
          ...metadata.build.mac,
          artifactName: signed
            ? 'Browsery-${version}-macOS-${arch}.${ext}'
            : 'Browsery-${version}-macOS-${arch}-unnotarized.${ext}',
          type: 'distribution',
          // Ad-hoc signatures support Apple Silicon, but are not Developer ID trust.
          ...(signed ? {} : { identity: '-' }),
          hardenedRuntime: signed,
          notarize: signed,
        },
      },
    });
    const images = artifacts.filter(file => file.endsWith('.dmg'));
    for (const arch of ['arm64', 'x64']) {
      const image = images.find(file => path.basename(file).includes(`-${arch}`));
      if (!image || !(await stat(image)).size) throw new Error(`The ${arch} DMG was not generated.`);
    }
    console.log(signed
      ? 'Built Developer ID signed, notarized macOS disk images. Test both on their target Macs before sharing.'
      : 'Built ad-hoc signed, UNNOTARIZED macOS disk images for private testing. These are not Apple-trusted releases; Gatekeeper may require an explicit user approval.');
    for (const image of images) console.log(image);
  } finally {
    // mkdtemp returned this exact private directory inside the validated workspace.
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  packageMacOS().catch(error => {
    console.error(`macOS packaging failed: ${error.message}`);
    process.exitCode = 1;
  });
}
