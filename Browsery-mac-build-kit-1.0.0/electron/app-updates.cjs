const { autoUpdater } = require('electron-updater');

// Browsery deliberately uses one public, versioned release channel. The
// updater never looks at a URL supplied by a webpage or by the renderer.
const OFFICIAL_REPOSITORY = 'lolypop7661-a11y/browser-build';
const RELEASES_URL = `https://github.com/${OFFICIAL_REPOSITORY}/releases`;
const MIN_RECHECK_MS = 4 * 60 * 60 * 1000;

let initialized = false;
let inFlightCheck = null;
const listeners = new Set();
let state = {
  status: 'idle',
  checkedAt: null,
  currentVersion: '',
  latestVersion: '',
  available: false,
  downloaded: false,
  progress: 0,
  releaseUrl: RELEASES_URL,
  message: 'Browsery will check its official release channel after launch.',
};

function publicState() {
  return { ...state };
}

function publish(patch) {
  state = { ...state, ...patch };
  const snapshot = publicState();
  for (const listener of listeners) {
    try { listener(snapshot); } catch {}
  }
  return snapshot;
}

function updateErrorMessage(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'ERR_UPDATER_INVALID_RELEASE') return 'The update release could not be verified.';
  if (code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return 'No Browsery update feed is published yet.';
  if (code === 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND') return 'Browsery could not find a current update release.';
  return 'Browsery could not check for an update right now.';
}

function supportsClickToUpdate(app) {
  return Boolean(app?.isPackaged) && process.platform === 'win32';
}

function configure(app) {
  if (initialized) return publicState();
  initialized = true;
  const currentVersion = app?.getVersion?.() || '';

  if (!app?.isPackaged) {
    return publish({
      status: 'manual', currentVersion, available: false, downloaded: false, progress: 0,
      message: 'This project copy is not installed. Install Browsery from its official release to receive updates.',
    });
  }

  if (!supportsClickToUpdate(app)) {
    return publish({
      status: 'manual', currentVersion, available: false, downloaded: false, progress: 0,
      message: 'One-click Browsery updates are currently available on Windows. Open the official release page for this platform.',
    });
  }

  try {
    // A person explicitly chooses Download and Restart & update in Browsery.
    // Nothing downloads or installs merely because a newer release exists.
    autoUpdater.autoDownload = false;
    try { autoUpdater.autoInstallEvent = 'manual'; } catch {}
    try { autoUpdater.autoInstallOnAppQuit = false; } catch {}
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.fullChangelog = false;

    autoUpdater.on('checking-for-update', () => publish({
      status: 'checking', currentVersion, progress: 0,
      message: 'Checking Browsery updates…',
    }));
    autoUpdater.on('update-available', info => publish({
      status: 'available', checkedAt: Date.now(), currentVersion,
      latestVersion: String(info?.version || ''), available: true,
      downloaded: false, progress: 0, releaseUrl: RELEASES_URL,
      message: `Browsery ${info?.version || 'update'} is ready to download.`,
    }));
    autoUpdater.on('update-not-available', info => publish({
      status: 'up-to-date', checkedAt: Date.now(), currentVersion,
      latestVersion: String(info?.version || currentVersion), available: false,
      downloaded: false, progress: 0, releaseUrl: RELEASES_URL,
      message: 'Browsery is up to date.',
    }));
    autoUpdater.on('download-progress', progress => {
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent) || 0)));
      publish({
        status: 'downloading', currentVersion, available: true, downloaded: false,
        progress: percent,
        message: `Downloading Browsery ${state.latestVersion || 'update'} · ${percent}%`,
      });
    });
    autoUpdater.on('update-downloaded', info => publish({
      status: 'downloaded', checkedAt: Date.now(), currentVersion,
      latestVersion: String(info?.version || state.latestVersion || ''), available: true,
      downloaded: true, progress: 100, releaseUrl: RELEASES_URL,
      message: `Browsery ${info?.version || state.latestVersion || 'update'} is ready. Restart to finish the update.`,
    }));
    autoUpdater.on('error', error => publish({
      status: 'error', checkedAt: Date.now(), currentVersion,
      available: false, downloaded: false, progress: 0,
      message: updateErrorMessage(error),
    }));

    return publish({
      status: 'ready', currentVersion, available: false, downloaded: false, progress: 0,
      message: 'Browsery checks its official release channel for updates.',
    });
  } catch (error) {
    return publish({
      status: 'error', currentVersion, available: false, downloaded: false, progress: 0,
      message: updateErrorMessage(error),
    });
  }
}

async function checkForUpdates(app, { force = false } = {}) {
  if (!initialized) configure(app);
  if (!supportsClickToUpdate(app)) return publicState();
  if (state.status === 'downloading' || state.status === 'downloaded' || state.status === 'installing') return publicState();
  if (!force && state.checkedAt && Date.now() - state.checkedAt < MIN_RECHECK_MS) return publicState();
  if (inFlightCheck) return inFlightCheck;

  inFlightCheck = Promise.resolve(autoUpdater.checkForUpdates())
    .then(() => publicState())
    .catch(error => publish({
      status: 'error', checkedAt: Date.now(), currentVersion: app?.getVersion?.() || state.currentVersion,
      available: false, downloaded: false, progress: 0, message: updateErrorMessage(error),
    }))
    .finally(() => { inFlightCheck = null; });
  return inFlightCheck;
}

async function downloadUpdate(app) {
  if (!initialized) configure(app);
  if (!supportsClickToUpdate(app)) return publicState();
  if (state.status === 'downloaded') return publicState();
  if (state.status !== 'available') {
    return publish({ ...state, message: 'Check for an available Browsery update before downloading.' });
  }
  publish({ status: 'downloading', available: true, downloaded: false, progress: 0, message: `Downloading Browsery ${state.latestVersion || 'update'}…` });
  try {
    await autoUpdater.downloadUpdate();
    return publicState();
  } catch (error) {
    return publish({
      status: 'error', checkedAt: Date.now(), available: false, downloaded: false, progress: 0,
      message: updateErrorMessage(error),
    });
  }
}

function installDownloadedUpdate(app) {
  if (!initialized) configure(app);
  if (!supportsClickToUpdate(app)) return { ok: false, ...publicState() };
  if (state.status !== 'downloaded') return { ok: false, ...publicState(), message: 'Finish downloading the update before restarting Browsery.' };
  try {
    publish({ status: 'installing', available: true, downloaded: true, progress: 100, message: 'Restarting Browsery to install the update…' });
    autoUpdater.quitAndInstall();
    return { ok: true, ...publicState() };
  } catch (error) {
    return { ok: false, ...publish({ status: 'error', available: false, downloaded: false, progress: 0, message: updateErrorMessage(error) }) };
  }
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  OFFICIAL_REPOSITORY,
  RELEASES_URL,
  configure,
  checkForUpdates,
  downloadUpdate,
  installDownloadedUpdate,
  getStatus: publicState,
  subscribe,
};
