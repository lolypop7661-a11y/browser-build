const { app, BrowserWindow, ipcMain, session, shell, protocol, dialog, webContents, safeStorage, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('url');
const { getApiKeyStatus, saveApiKey, clearApiKey, createOverview, createVoiceAssistantReply, analyzePageScreenshot } = require('./ai-overview.cjs');
const { createAdblocker } = require('./adblocker.cjs');
const savedLogins = require('./credentials.cjs');
const appUpdates = require('./app-updates.cjs');
const { createGlobalControl } = require('./global-control.cjs');
const { createCaptchaPrompt } = require('./captcha.cjs');

// QA gets its own profile, so captures can never touch a person's live tabs,
// cookies, downloads, or encrypted AI credential. Portable output folders can
// change; the installed user's encrypted profile must not.
if (process.env.BROWSERY_QA_DIR) {
  const qaProfileDirectory = path.join(process.env.BROWSERY_QA_DIR, 'profile');
  fs.mkdirSync(qaProfileDirectory, { recursive: true });
  app.setPath('userData', qaProfileDirectory);
} else if (app.isPackaged) {
  const profileDirectory = path.join(app.getPath('appData'), 'Browsery');
  fs.mkdirSync(profileDirectory, { recursive: true });
  app.setPath('userData', profileDirectory);
}

const activeDownloads = new Map();
const browserySearchCursors = new Map();
const searchRequests = new WeakMap();
const imageRequests = new Map();
const imageSearchCursors = new Map();
const DOWNLOAD_HISTORY_LIMIT = 120;
const CLOSED_TAB_HISTORY_LIMIT = 32;
const SITE_PERMISSION_LIMIT = 400;
const DNS_OVER_HTTPS_TEMPLATE = 'https://cloudflare-dns.com/dns-query';
const cookiePurgeIntervals = new Map([
  ['1 hour', 60 * 60 * 1000],
  ['24 hours', 24 * 60 * 60 * 1000],
  ['7 days', 7 * 24 * 60 * 60 * 1000],
]);
let mainWindow;
let adblocker;
let globalControl;
let remoteGlobalState = { ok: false, online: false, mode: 'active', message: '', announcements: [], error: 'not-configured' };
const defaultBrowserPreferences = Object.freeze({
  adblock: true,
  trackers: 'Strict',
  https: true,
  phishing: true,
  dnt: true,
  fingerprint: true,
  webrtc: true,
  doh: true,
  sleep: true,
  preload: false,
  closewarn: true,
  aiOverview: true,
  aiModel: 'openai/gpt-oss-120b',
  downloadPath: 'Downloads',
  systemContrast: true,
});
let browserPreferences = { ...defaultBrowserPreferences };
let completedDownloads = [];
let closedTabs = [];
let browserPreferencesWriteTimer = null;
let closeWarningInFlight = false;
let allowWindowClose = false;
const pendingPermissionRequests = new Map();
const permissionDecisions = new Map();
const preconnectAttempts = new Map();
let downloadHistoryWriteTimer = null;
let cookiePurgePreference = '24 hours';
let lastCookiePurgeAt = Date.now();
let cookiePurgeTimer = null;
let cookiePurgeInFlight = null;
let bypassCookiePurgeOnQuit = false;
const provisioningOnly = process.argv.includes('--provision-global-admin');
const primaryInstance = provisioningOnly || app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function profileFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readProfileJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(profileFile(name), 'utf8')); }
  catch { return fallback; }
}

function writeProfileJson(name, value) {
  try {
    const target = profileFile(name);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(value));
    fs.renameSync(temporary, target);
  } catch (error) {
    // Browsing must remain usable when a profile folder is temporarily read-only.
    console.warn(`Browsery could not save ${name}:`, error.code || error.name);
  }
}

function normalizeBrowserPreferences(value) {
  const saved = value && typeof value === 'object' ? value : {};
  return {
    ...defaultBrowserPreferences,
    adblock: saved.adblock !== false,
    trackers: ['Off', 'Standard', 'Strict'].includes(saved.trackers) ? saved.trackers : defaultBrowserPreferences.trackers,
    https: saved.https !== false,
    phishing: saved.phishing !== false,
    dnt: saved.dnt !== false,
    fingerprint: saved.fingerprint !== false,
    webrtc: saved.webrtc !== false,
    doh: saved.doh !== false,
    sleep: saved.sleep !== false,
    preload: Boolean(saved.preload),
    closewarn: saved.closewarn !== false,
    aiOverview: saved.aiOverview !== false,
    aiModel: typeof saved.aiModel === 'string' && saved.aiModel.length <= 120 ? saved.aiModel : defaultBrowserPreferences.aiModel,
    downloadPath: ['Downloads', 'Desktop', 'Ask every time'].includes(saved.downloadPath) ? saved.downloadPath : defaultBrowserPreferences.downloadPath,
    systemContrast: saved.systemContrast !== false,
  };
}

function loadBrowserPreferences() {
  browserPreferences = normalizeBrowserPreferences(readProfileJson('browser-preferences.json', {}));
}

function saveBrowserPreferences() {
  if (browserPreferencesWriteTimer) {
    clearTimeout(browserPreferencesWriteTimer);
    browserPreferencesWriteTimer = null;
  }
  writeProfileJson('browser-preferences.json', browserPreferences);
}

function scheduleBrowserPreferencesSave() {
  if (browserPreferencesWriteTimer) return;
  browserPreferencesWriteTimer = setTimeout(saveBrowserPreferences, 350);
  browserPreferencesWriteTimer.unref?.();
}

function configureDnsOverHttpsAtLaunch() {
  // Chromium's DNS-over-HTTPS resolver is selected before its network service
  // starts. Persisting the preference here makes the privacy toggle real on the
  // next Browsery launch instead of pretending a live renderer switch can alter
  // DNS for already-created sessions.
  if (browserPreferences.doh) {
    app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
    app.commandLine.appendSwitch('dns-over-https-templates', DNS_OVER_HTTPS_TEMPLATE);
  } else {
    app.commandLine.appendSwitch('disable-features', 'DnsOverHttps');
  }
}

function normalizeClosedTab(value) {
  if (!value || typeof value !== 'object' || value.private) return null;
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  if (!url || url.length > 8192) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'browsery:'].includes(parsed.protocol)) return null;
  } catch { return null; }
  return {
    restoreId: typeof value.restoreId === 'string' && value.restoreId.length <= 120 ? value.restoreId : randomUUID(),
    url,
    title: (title || url).slice(0, 512),
    favicon: typeof value.favicon === 'string' && value.favicon.length <= 4096 ? value.favicon : '',
    pinned: Boolean(value.pinned),
    group: typeof value.group === 'string' ? value.group.slice(0, 120) : '',
    closedAt: Number.isFinite(value.closedAt) && value.closedAt > 0 ? value.closedAt : Date.now(),
  };
}

function loadClosedTabs() {
  const saved = readProfileJson('closed-tabs.json', []);
  closedTabs = Array.isArray(saved) ? saved.map(normalizeClosedTab).filter(Boolean)
    .sort((left, right) => right.closedAt - left.closedAt).slice(0, CLOSED_TAB_HISTORY_LIMIT) : [];
}

function saveClosedTabs() {
  writeProfileJson('closed-tabs.json', closedTabs);
}

function rememberClosedTab(tab) {
  const normalized = normalizeClosedTab({ ...tab, closedAt: Date.now() });
  if (!normalized) return { ok: false, reason: 'not-restorable' };
  closedTabs = [normalized, ...closedTabs.filter(item => item.url !== normalized.url)].slice(0, CLOSED_TAB_HISTORY_LIMIT);
  saveClosedTabs();
  return { ok: true, tab: normalized };
}

function reopenClosedTab() {
  const tab = closedTabs.shift() || null;
  if (tab) saveClosedTabs();
  return tab;
}

function normalizePermissionOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.origin;
  } catch { return ''; }
}

function permissionScopeForSession(browserSession) {
  return browserSession?.getPartition?.() === 'browsery-private' ? 'private' : 'regular';
}

function permissionDecisionKey(scope, origin, permission) {
  return `${scope}\n${origin}\n${permission}`;
}

function loadPermissionDecisions() {
  const saved = readProfileJson('site-permissions.json', []);
  if (!Array.isArray(saved)) return;
  for (const entry of saved.slice(0, SITE_PERMISSION_LIMIT)) {
    const origin = normalizePermissionOrigin(entry?.origin);
    const permission = typeof entry?.permission === 'string' ? entry.permission : '';
    if (!origin || !interactivePermissions.has(permission) || entry?.decision !== 'allow') continue;
    permissionDecisions.set(permissionDecisionKey('regular', origin, permission), 'allow');
  }
}

function savePermissionDecisions() {
  const entries = [];
  for (const [key, decision] of permissionDecisions) {
    if (decision !== 'allow') continue;
    const [scope, origin, permission] = key.split('\n');
    if (scope === 'regular') entries.push({ origin, permission, decision });
  }
  writeProfileJson('site-permissions.json', entries.slice(0, SITE_PERMISSION_LIMIT));
}

// Only potentially useful website features receive a prompt. Hardware,
// payment, device pairing, and filesystem permissions remain blocked unless a
// dedicated, reviewed flow is added for them.
const interactivePermissions = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'fullscreen', 'pointerLock']);
const permissionLabels = {
  media: 'camera or microphone',
  geolocation: 'location',
  notifications: 'notifications',
  midi: 'MIDI devices',
  midiSysex: 'MIDI system messages',
  'clipboard-read': 'your clipboard',
  fullscreen: 'full screen',
  pointerLock: 'pointer lock',
};

// Load this before Electron is ready so the DNS network-service flags take
// effect for the first tab, not only after the user opens Settings.
loadBrowserPreferences();
configureDnsOverHttpsAtLaunch();

function normalizeCompletedDownload(value) {
  if (!value || typeof value !== 'object') return null;
  const name = typeof value.name === 'string' ? path.basename(value.name).trim() : '';
  const savePath = typeof value.savePath === 'string' && path.isAbsolute(value.savePath) ? value.savePath : '';
  const completedAt = Number.isFinite(value.completedAt) && value.completedAt > 0 ? value.completedAt : 0;
  if (!name || !savePath || !completedAt) return null;
  const received = Math.max(0, Number(value.received) || 0);
  const total = Math.max(received, Number(value.total) || 0);
  return {
    id: typeof value.id === 'string' && value.id.length <= 120 ? value.id : randomUUID(),
    name: name.slice(0, 255),
    savePath,
    received,
    total,
    progress: 100,
    speed: 0,
    paused: false,
    state: 'completed',
    completedAt,
  };
}

function loadCompletedDownloads() {
  const values = readProfileJson('download-history.json', []);
  completedDownloads = Array.isArray(values) ? values.map(normalizeCompletedDownload).filter(Boolean)
    .sort((left, right) => right.completedAt - left.completedAt).slice(0, DOWNLOAD_HISTORY_LIMIT) : [];
}

function saveCompletedDownloads() {
  if (downloadHistoryWriteTimer) {
    clearTimeout(downloadHistoryWriteTimer);
    downloadHistoryWriteTimer = null;
  }
  writeProfileJson('download-history.json', completedDownloads);
}

function scheduleCompletedDownloadsSave() {
  if (downloadHistoryWriteTimer) return;
  downloadHistoryWriteTimer = setTimeout(saveCompletedDownloads, 350);
  downloadHistoryWriteTimer.unref?.();
}

function rememberCompletedDownload(download) {
  const normalized = normalizeCompletedDownload({ ...download, completedAt: Date.now() });
  if (!normalized) return;
  completedDownloads = [normalized, ...completedDownloads.filter(item => item.savePath !== normalized.savePath)].slice(0, DOWNLOAD_HISTORY_LIMIT);
  scheduleCompletedDownloadsSave();
}

function loadCookiePurgeState() {
  const state = readProfileJson('browser-data-state.json', {});
  cookiePurgePreference = cookiePurgeIntervals.has(state?.cookiePurge) || state?.cookiePurge === 'On close' ? state.cookiePurge : '24 hours';
  lastCookiePurgeAt = Number.isFinite(state?.lastCookiePurgeAt) && state.lastCookiePurgeAt > 0 ? state.lastCookiePurgeAt : Date.now();
}

function saveCookiePurgeState() {
  writeProfileJson('browser-data-state.json', { cookiePurge: cookiePurgePreference, lastCookiePurgeAt });
}

function isTrustedShell(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event?.sender === mainWindow.webContents && event.senderFrame === mainWindow.webContents.mainFrame);
}

const spaceSearchCss = `
  #browsery-overview-notice[hidden]{display:none!important}
  :root{background:#080808;color:#ededed;--a:#f2f2f2;--muted:#929292;--line:#2a2a2a}
  body{position:relative;isolation:isolate;background:radial-gradient(ellipse at 78% 8%,rgba(255,255,255,.045),transparent 32%),radial-gradient(ellipse at 15% 38%,rgba(255,255,255,.025),transparent 38%),linear-gradient(180deg,#0a0a0a,#080808 62%)}
  body:before{content:"";position:fixed;z-index:0;inset:0;pointer-events:none;opacity:.45;background-image:radial-gradient(1px 1px at 8% 16%,#dedede 99%,transparent),radial-gradient(1px 1px at 19% 73%,#bdbdbd 99%,transparent),radial-gradient(1px 1px at 33% 27%,#fff 99%,transparent),radial-gradient(1px 1px at 46% 86%,#bdbdbd 99%,transparent),radial-gradient(1px 1px at 57% 13%,#fff 99%,transparent),radial-gradient(1px 1px at 71% 56%,#dedede 99%,transparent),radial-gradient(1px 1px at 84% 31%,#fff 99%,transparent),radial-gradient(1px 1px at 93% 79%,#bdbdbd 99%,transparent);background-size:317px 283px}
  body:after{content:"";position:fixed;z-index:0;pointer-events:none;width:58vw;height:58vw;right:-28vw;top:5vh;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.025),rgba(255,255,255,.01) 48%,transparent 70%)}
  .hero,.layout{position:relative;z-index:1}.hero{background:linear-gradient(180deg,rgba(18,18,18,.24),transparent)}
  .brand-word{background:none;color:#f5f5f5}
  .search-form{background:rgba(18,18,18,.94);border-color:#383838;box-shadow:0 14px 40px #0005,inset 0 1px #ffffff0a}
  .search-form button{background:#1c1c1c}.search-form button:hover{background:#292929}
  .search-tabs{border-color:#2c2c2c}.search-tabs a.active{border-color:#e5e5e5}
  .side{background:linear-gradient(155deg,rgba(23,23,23,.94),rgba(15,15,15,.97));border-color:#333}
  .search-skeleton{display:grid;gap:10px;padding:18px 0 24px}.search-skeleton i,.search-skeleton b,.search-skeleton span{display:block;border-radius:999px;background:linear-gradient(100deg,#171717 20%,#303030 45%,#171717 70%);background-size:220% 100%;animation:search-sheen 1.35s ease-in-out infinite}.search-skeleton i{width:27px;height:27px}.search-skeleton b{width:min(410px,72%);height:16px}.search-skeleton span{width:min(600px,92%);height:11px;margin-bottom:14px}.search-skeleton span:nth-of-type(2){width:75%}.search-skeleton span:nth-of-type(3){width:84%}@keyframes search-sheen{to{background-position:-220% 0}}
  .result{animation:browsery-result-arrive .38s cubic-bezier(.2,.75,.25,1) both}.result:nth-of-type(2){animation-delay:35ms}.result:nth-of-type(3){animation-delay:70ms}.result:nth-of-type(4){animation-delay:105ms}.result:nth-of-type(5){animation-delay:140ms}
  .image-card{transition:transform .32s cubic-bezier(.25,1,.5,1),border-color .22s,box-shadow .32s}.image-card:active{transform:scale(.985)}
  .hero{width:100%;max-width:1360px;min-height:112px;margin:0 auto;padding:17px 24px 0;display:grid;grid-template-columns:190px minmax(0,690px) minmax(0,320px);grid-template-rows:53px 41px;align-items:center;gap:0 28px;text-align:left;background:transparent;border-bottom:1px solid #292929}
  .hero .brand{grid-column:1;grid-row:1;justify-content:flex-start;justify-self:start;gap:9px;font-size:29px;letter-spacing:-.045em}
  .hero .orb{width:28px;height:28px;border-radius:50%;background:radial-gradient(circle at 34% 29%,#fafafa,#b6b6b6 42%,#777 70%,#303030 100%);box-shadow:0 0 18px #ffffff12}
  .hero .orb:after{inset:auto auto 5px -5px;width:38px;height:10px;border:1px solid #d4d4d488;border-radius:50%;background:transparent;filter:none;transform:rotate(-22deg)}
  .search-form{grid-column:2;grid-row:1;width:100%;max-width:690px;height:46px;margin:0;border-radius:25px;background:#151515;border-color:#444;box-shadow:0 2px 8px #0003,inset 0 1px #ffffff08}
  .search-form:focus-within{border-color:#a3a3a3;box-shadow:0 0 0 2px #ffffff14,0 3px 12px #0004}
  .search-form input{height:44px;font-size:14px}.search-form button{width:48px;height:44px;background:transparent;border-left:1px solid #333;color:#dedede;font-size:17px}
  .search-symbol svg{width:18px;height:18px;flex:0 0 18px}
  .empty .search-retry,.empty .search-alternative{display:inline-flex;margin:9px 12px 0 0;padding:8px 12px;border:1px solid #444;border-radius:8px;color:#e5e5e5;text-decoration:none;font-size:12px;background:#1a1a1a}.empty p{color:#ababab;font-size:13px;line-height:1.6}
  .search-tabs{grid-column:2 / 4;grid-row:2;max-width:none;height:41px;margin:0;justify-content:flex-start;gap:20px;border:0}
  .search-tabs a{height:41px;padding:0 4px;color:#a0a0a0;font-size:12px}.search-tabs a.active{color:#f5f5f5;border-color:#d4d4d4}.search-tabs a:hover{color:#fff}
  .layout{width:100%;max-width:1360px;grid-template-columns:190px minmax(0,690px) minmax(0,320px);gap:28px;margin:0 auto;padding:17px 24px 80px}
  .layout>section{grid-column:2;min-width:0;display:flex;flex-direction:column;gap:0}.layout>.side{grid-column:3;position:sticky;top:22px;margin-top:12px;padding:17px 18px;border:1px solid #333;border-radius:12px;background:rgba(18,18,18,.82);box-shadow:none}
  .layout>section>.web-section{order:1}.layout>section>.more-results{order:1}.layout>section>.visual-section{order:2}.layout>section>article:has(#browsery-overview){order:0;margin:0 0 18px!important;padding:18px 20px!important;border:1px solid #363636!important;border-radius:12px!important;background:#131313!important;box-shadow:none!important}
  .web-heading{padding:2px 0 9px;border-bottom:1px solid #303030}.web-heading h2{font-size:14px;color:#e5e5e5;letter-spacing:0}.web-heading p{font-size:12px;color:#a0a0a0}
  .result{max-width:690px;padding:13px 0 18px;border:0;animation-duration:.28s}.result+.result{border:0}
  .result-site{gap:9px;margin-bottom:5px}.site-logo{flex-basis:22px;width:22px;height:22px;border:0;border-radius:50%;background:transparent}.site-logo img{inset:1px;width:20px;height:20px;border-radius:50%}.site-logo b{font-size:10px}.site-meta{gap:2px}.site-meta strong{color:#e0e0e0;font-size:12px;font-weight:450}.site-meta small{color:#b0b0b0;font-size:11px}.result-number{display:none}
  .result-title{display:block;margin:0 0 3px;color:#ededed;font-size:20px;line-height:1.32;font-weight:450;letter-spacing:0}.result-title:hover{color:#fff;text-decoration:underline}.result p{max-width:680px;margin:0;color:#c5c5c5;font-size:13px;line-height:1.55}
  .side-title{font-size:14px}.side-mark{width:24px;height:24px;border-radius:50%;background:#202020;color:#d4d4d4}.side p{font-size:12px;line-height:1.6}.source-line{font-size:10px}
  .visual-section{margin:18px 0 28px;padding-top:8px;border-top:1px solid #303030}.section-heading h2{font-size:14px}.image-grid-preview{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.image-grid-preview .image-frame{aspect-ratio:1.45}.image-card{border-color:#333;border-radius:9px;background:#131313}.image-caption strong{font-size:10px}.image-caption small{font-size:9px}
  .more-results{min-height:42px;margin:5px 0 26px}.more-results p{margin:0;color:#999;font-size:11px}.more-results button{height:34px;margin-top:9px;padding:0 14px;border:1px solid #444;border-radius:18px;background:#181818;color:#e5e5e5;font-size:11px;cursor:pointer}.more-results button:hover{background:#262626;border-color:#666}.more-results button[hidden]{display:none}#results-sentinel{height:2px}
  .image-more{min-height:35px;margin:13px 0 3px}.image-more[hidden]{display:none}.image-more p{margin:0;color:#929292;font-size:10px}.image-more button{height:32px;margin-top:8px;padding:0 13px;border:1px solid #444;border-radius:16px;background:#181818;color:#e5e5e5;font-size:10px;cursor:pointer}.image-more button:hover{background:#262626;border-color:#666}.image-more button[hidden]{display:none}#images-sentinel{height:2px}
  .empty{border:0;border-top:1px solid #303030;border-radius:0;background:transparent;padding:18px 0}
  /* Neutralize inherited page chrome, never image pixels or third-party pages. */
  .brand,.search-form input{color:#f5f5f5}.search-symbol{color:#b0b0b0}.search-form input::placeholder{color:#858585}
  .side p{color:#aaa}.source-line{border-color:#303030;color:#858585}.side-mark{border-color:#444}
  .section-heading h2{color:#e5e5e5}.section-heading p{color:#999}.section-heading>a{color:#d4d4d4}
  .image-card:hover{border-color:#666}.image-frame{background:linear-gradient(135deg,#242424,#171717)}.image-open{background:#0a0a0ab8}
  .image-caption strong{color:#e5e5e5}.image-caption small,.image-credit{color:#929292}.image-empty{border-color:#444;color:#a3a3a3}.image-empty strong{color:#e5e5e5}.image-empty-mark,.site-logo b{color:#d4d4d4}
  .empty strong{color:#f5f5f5}.empty a{color:var(--a)}
  @media(max-width:1100px){.hero,.layout{grid-template-columns:150px minmax(0,1fr);gap:0 22px}.hero .search-tabs{grid-column:2}.layout>section{grid-column:2}.layout>.side{display:none}}
  @media(max-width:650px){.hero{min-height:121px;grid-template-columns:minmax(0,1fr);grid-template-rows:36px 47px 38px;padding:10px 16px 0}.hero .brand{grid-column:1;grid-row:1;font-size:22px}.hero .orb{width:21px;height:21px}.hero .orb:after{width:29px;height:8px;bottom:3px;left:-4px}.search-form{grid-column:1;grid-row:2;height:42px}.search-form input{height:40px;font-size:13px}.search-form button{height:40px}.search-tabs{grid-column:1;grid-row:3;height:38px;gap:17px}.search-tabs a{height:38px;font-size:11px}.layout{grid-template-columns:minmax(0,1fr);padding:13px 18px 50px}.layout>section{grid-column:1}.result-title{font-size:18px}.result p{font-size:12px}.image-grid-preview{grid-template-columns:repeat(2,minmax(0,1fr))}.image-grid-preview .image-card:nth-child(3){display:none}}
  @keyframes browsery-result-arrive{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:translateY(0)}}
  @media(prefers-reduced-motion:reduce){.result{animation:none}}
`;

protocol.registerSchemesAsPrivileged([{
  scheme: 'browsery',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function decodeXml(value = '') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([\da-f]{1,6});/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

function readTag(block, tag) {
  return decodeXml(block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
}

function parseSearchForm(html) {
  const form = html.match(/<form\b[^>]*class=["'][^"']*\bnext_form\b[^"']*["'][^>]*>([\s\S]*?)<\/form>/i)?.[1];
  if (!form) return null;
  const fields = {};
  for (const tag of form.match(/<input\b[^>]*>/gi) || []) {
    const attrs = Object.fromEntries([...tag.matchAll(/\b([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), decodeXml(match[2] ?? match[3] ?? match[4] ?? '')]));
    if (attrs.name) fields[attrs.name] = attrs.value || '';
  }
  return fields.q && fields.s && fields.vqd ? fields : null;
}

function parseSearchResults(html) {
  const anchors = [...html.matchAll(/<a\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bresult-link\b[^"']*\1)[^>]*>([\s\S]*?)<\/a>/gi)];
  return anchors.map((match, index) => {
    const anchorTag = match[0].slice(0, match[0].indexOf('>') + 1);
    const href = anchorTag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!href) return null;
    const redirect = decodeXml(href[1] ?? href[2] ?? href[3] ?? '');
    let resultUrl = redirect;
    try { resultUrl = new URL(redirect.startsWith('//') ? `https:${redirect}` : redirect).searchParams.get('uddg') || redirect; } catch {}
    const nextAnchorIndex = anchors[index + 1]?.index ?? html.length;
    const followingMarkup = html.slice(match.index + match[0].length, nextAnchorIndex);
    const snippet = followingMarkup.match(/<td\b[^>]*\bclass\s*=\s*(["'])[^"']*\bresult-snippet\b[^"']*\1[^>]*>([\s\S]*?)<\/td>/i)?.[2] || '';
    return {
      title: decodeXml(match[2].replace(/<[^>]+>/g, '')).trim() || 'Web result',
      url: resultUrl,
      description: decodeXml(snippet.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
    };
  }).filter(result => result && /^https?:\/\//i.test(result.url) && !/(?:^|\.)google\.|youtube\.com\/@google/i.test(result.url));
}

function renderSearchResultMarkup(results, startIndex = 0) {
  return results.map((result, index) => {
    let host = '';
    let pathName = '';
    try { const parsed = new URL(result.url); host = parsed.hostname; pathName = parsed.pathname.replace(/\/$/, ''); } catch {}
    const siteName = host.replace(/^www\./i, '');
    const icon = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
    const initial = escapeHtml((siteName[0] || '?').toUpperCase());
    return `<article class="result" data-result-url="${escapeHtml(result.url)}">
      <div class="result-site"><span class="site-logo"><img src="${icon}" alt="" loading="lazy" onerror="this.remove()"><b>${initial}</b></span><span class="site-meta"><strong>${escapeHtml(siteName || 'Web result')}</strong><small>${escapeHtml(`${siteName}${pathName}`)}</small></span><span class="result-number">${String(startIndex + index + 1).padStart(2, '0')}</span></div>
      <a class="result-title" href="${escapeHtml(result.url)}">${escapeHtml(result.title)}</a>
      <p>${escapeHtml(result.description)}</p>
    </article>`;
  }).join('');
}

function rememberSearchCursor(browserSession, query, fields, extra = {}) {
  const now = Date.now();
  for (const [id, entry] of browserySearchCursors) if (now - entry.createdAt > 20 * 60 * 1000) browserySearchCursors.delete(id);
  while (browserySearchCursors.size >= 150) browserySearchCursors.delete(browserySearchCursors.keys().next().value);
  const id = randomUUID();
  browserySearchCursors.set(id, { browserSession, query, fields, ...extra, createdAt: now });
  return id;
}

async function getBrowseryResults(query, browserSession, cursorId = null) {
  let requests = searchRequests.get(browserSession);
  if (!requests) { requests = new Map(); searchRequests.set(browserSession, requests); }
  const key = JSON.stringify([query, cursorId]);
  const cached = requests.get(key);
  if (cached && (cached.pending || cached.expiresAt > Date.now())) return cached.value;
  if (cached) requests.delete(key);
  while (requests.size >= 64) requests.delete(requests.keys().next().value);
  const entry = { pending: true, expiresAt: 0, value: null };
  entry.value = (cursorId ? fetchBrowseryResults(query, browserSession, cursorId) : fetchInitialBrowseryResults(query, browserSession)).then(page => {
    entry.pending = false;
    if (page.results.length) entry.expiresAt = Date.now() + 90_000;
    else requests.delete(key);
    return page;
  }, error => { requests.delete(key); throw error; });
  requests.set(key, entry);
  return entry.value;
}

// DuckDuckGo remains the primary source because it supplies continuation
// cursors. Start the independent fallback only when the primary source is
// slow or empty, then return whichever useful response arrives first. This
// avoids the former 2.5s + 4s sequential failure path.
async function fetchInitialBrowseryResults(query, browserSession) {
  const primary = fetchBrowseryResults(query, browserSession);
  const slow = Symbol('primary-search-slow');
  const early = await Promise.race([
    primary,
    new Promise(resolve => setTimeout(() => resolve(slow), 650)),
  ]);
  if (early !== slow) {
    if (early.results.length) return early;
    const backup = await fetchMwmblResults(query, browserSession);
    return backup.results.length ? backup : early;
  }

  const backup = fetchMwmblResults(query, browserSession);
  const first = await Promise.race([
    primary.then(page => ({ provider: 'primary', page })),
    backup.then(page => ({ provider: 'backup', page })),
  ]);
  if (first.page.results.length) return first.page;
  const second = await (first.provider === 'primary' ? backup : primary);
  return second.results.length ? second : first.page;
}

async function fetchBrowseryResults(query, browserSession, cursorId = null) {
  if (!query) return { results: [], nextCursor: null, error: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const headers = {
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36 Browsery/1.0`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.8',
    };
    let response;
    let startIndex = 0;
    let cursorRecord = null;
    if (cursorId) {
      cursorRecord = browserySearchCursors.get(cursorId);
      if (!cursorRecord || cursorRecord.browserSession !== browserSession || cursorRecord.query !== query || Date.now() - cursorRecord.createdAt > 20 * 60 * 1000) {
        browserySearchCursors.delete(cursorId);
        return { results: [], nextCursor: null, error: 'expired-cursor' };
      }
      startIndex = Number(cursorRecord.fields.s) || 0;
      if (cursorRecord.source === 'Mwmbl') return mwmblPage(query, browserSession, cursorRecord.items, startIndex);
      response = await browserSession.fetch('https://lite.duckduckgo.com/lite/', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}` },
        body: new URLSearchParams(cursorRecord.fields).toString(),
        signal: controller.signal,
      });
    } else {
      const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      response = await browserSession.fetch(url, { headers, signal: controller.signal });
    }
    if (!response.ok) throw new Error(`Search source returned ${response.status}`);
    const html = await response.text();
    if (response.status === 202 || /anomaly|automated requests/i.test(html)) {
      return { results: [], nextCursor: null, error: 'search-source-blocked' };
    }
    // Keep cursors reusable until expiry: Back/Forward and cached searches must still paginate.
    const results = parseSearchResults(html);
    const nextFields = parseSearchForm(html);
    const nextCursor = nextFields?.q === query ? rememberSearchCursor(browserSession, query, nextFields) : null;
    return { results, nextCursor, startIndex, source: 'DuckDuckGo', error: results.length ? null : 'no-results' };
  } catch (error) {
    console.warn('Browsery search source unavailable:', error.message);
    return { results: [], nextCursor: null, error: error.name === 'AbortError' ? 'search-timeout' : 'search-unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

function mwmblPage(query, browserSession, items, startIndex = 0) {
  const results = items.slice(startIndex, startIndex + 20);
  const nextOffset = startIndex + results.length;
  const nextCursor = nextOffset < items.length
    ? rememberSearchCursor(browserSession, query, { s: nextOffset }, { source: 'Mwmbl', items }) : null;
  return { results, nextCursor, startIndex, source: 'Mwmbl', error: results.length ? null : 'no-results' };
}

async function fetchMwmblResults(query, browserSession) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3250);
  try {
    // One user-initiated API request; subsequent pages use this finite cached collection.
    const response = await browserSession.fetch(`https://api.mwmbl.org/api/v2/search/?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Browsery/1.0 (personal desktop search)' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Mwmbl returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.results)) throw new Error('Invalid search response');
    const seen = new Set();
    const items = data.results.slice(0, 300).flatMap(item => {
      if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url) || seen.has(item.url)) return [];
      seen.add(item.url);
      return [{ url: item.url, title: String(item.title || item.url), description: String(item.content || '') }];
    });
    return mwmblPage(query, browserSession, items);
  } catch (error) {
    console.warn('Browsery independent search unavailable:', error.message);
    return { results: [], nextCursor: null, error: error.name === 'AbortError' ? 'search-timeout' : 'search-unavailable' };
  } finally { clearTimeout(timeout); }
}

function rememberImageCursor(query, continuation) {
  const now = Date.now();
  for (const [id, entry] of imageSearchCursors) {
    if (now - entry.createdAt > 20 * 60 * 1000) imageSearchCursors.delete(id);
  }
  while (imageSearchCursors.size >= 120) imageSearchCursors.delete(imageSearchCursors.keys().next().value);
  const id = randomUUID();
  imageSearchCursors.set(id, { query, continuation, createdAt: now });
  return id;
}

function readImageCursor(query, cursorId) {
  if (!cursorId) return null;
  const entry = imageSearchCursors.get(cursorId);
  if (!entry || entry.query !== query || Date.now() - entry.createdAt > 20 * 60 * 1000) {
    imageSearchCursors.delete(cursorId);
    return null;
  }
  return entry;
}

async function getBrowseryImages(query, cursorId = null) {
  const cacheKey = JSON.stringify([query, cursorId]);
  const cached = imageRequests.get(cacheKey);
  if (cached && (cached.pending || cached.expiresAt > Date.now())) return cached.value;
  if (cached) imageRequests.delete(cacheKey);
  while (imageRequests.size >= 64) imageRequests.delete(imageRequests.keys().next().value);
  const entry = { pending: true, expiresAt: 0, value: null };
  entry.value = fetchBrowseryImages(query, cursorId).then(page => {
    entry.pending = false;
    if (page.images.length) entry.expiresAt = Date.now() + 5 * 60_000;
    else imageRequests.delete(cacheKey);
    return page;
  }, error => { imageRequests.delete(cacheKey); throw error; });
  imageRequests.set(cacheKey, entry);
  return entry.value;
}

async function fetchBrowseryImages(query, cursorId = null) {
  if (!query) return { images: [], nextCursor: null, error: null };
  const cursor = cursorId ? readImageCursor(query, cursorId) : null;
  if (cursorId && !cursor) return { images: [], nextCursor: null, error: 'expired-cursor' };
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    // Twenty-four keeps the first view dense without delaying the first paint;
    // additional pages stream in only when the person reaches the image rail.
    gsrlimit: '24',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '720',
    format: 'json',
  });
  if (cursor?.continuation && typeof cursor.continuation === 'object') {
    for (const [key, value] of Object.entries(cursor.continuation)) {
      if (/^(?:continue|gsrcontinue|gsroffset|iicontinue)$/.test(key) && typeof value === 'string' && value.length <= 512) params.set(key, value);
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'Browsery/1.0 (desktop search)', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Image source returned ${response.status}`);
    const data = await response.json();
    const images = Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index).map(page => {
      const info = page.imageinfo?.[0];
      const metadata = info?.extmetadata || {};
      const plainText = value => decodeXml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      const title = page.title.replace(/^File:/i, '').replace(/_/g, ' ');
      return {
        title,
        imageUrl: info?.thumburl || info?.url || '',
        pageUrl: info?.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        description: plainText(metadata.ImageDescription?.value || ''),
        license: plainText(metadata.LicenseShortName?.value || 'Wikimedia Commons'),
      };
    }).filter(image => /^https:\/\/(?:upload|thumb)\.wikimedia\.org\//i.test(image.imageUrl) && /^https:\/\/commons\.wikimedia\.org\//i.test(image.pageUrl));
    const nextCursor = data.continue && typeof data.continue === 'object' ? rememberImageCursor(query, data.continue) : null;
    return { images, nextCursor, error: images.length ? null : 'no-results' };
  } catch (error) {
    console.warn('Browsery image search unavailable:', error.message);
    return { images: [], nextCursor: null, error: error.name === 'AbortError' ? 'search-timeout' : 'search-unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

function renderBrowseryImageCards(images) {
  return images.map(image => `<a class="image-card" data-image-url="${escapeHtml(image.imageUrl)}" href="${escapeHtml(image.pageUrl)}" aria-label="${escapeHtml(image.title)}">
    <span class="image-frame"><img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(image.description || image.title)}" loading="lazy"><span class="image-open">↗</span></span>
    <span class="image-caption"><strong>${escapeHtml(image.title)}</strong><small>${escapeHtml(image.license)} · Wikimedia Commons</small></span>
  </a>`).join('');
}

function renderBrowseryImageSection(query, imagePage, tab = 'all', loading = false) {
  const page = Array.isArray(imagePage) ? { images: imagePage, nextCursor: null, error: null } : (imagePage || { images: [], nextCursor: null, error: null });
  const images = Array.isArray(page.images) ? page.images : [];
  const safeQuery = escapeHtml(query);
  const isImages = tab === 'images';
  const searchQuery = encodeURIComponent(query);
  const imageCards = images.length ? renderBrowseryImageCards(images) : '';
  const empty = `<div class="image-empty"><span class="image-empty-mark">${loading ? '◌' : '▧'}</span><strong>${loading ? 'Finding visual matches…' : 'No image matches yet'}</strong><span>${loading ? 'Images are loading while your results stay usable.' : 'Try a broader phrase or switch back to web results.'}</span></div>`;
  const shown = isImages ? (imageCards || empty) : images.length ? renderBrowseryImageCards(images.slice(0, 3)) : (loading ? empty : '');
  const pagination = isImages ? `<div class="image-more" id="image-more" ${images.length ? '' : 'hidden'}><p id="image-status" role="status">${page.nextCursor ? `${images.length} images loaded · keep scrolling` : images.length ? `${images.length} images loaded` : ''}</p><button id="load-more-images" type="button" ${page.nextCursor ? '' : 'hidden'}>Load more images</button><div id="images-sentinel" aria-hidden="true"></div></div>` : '';
  return `<section class="visual-section" id="visual-section"><div class="section-heading"><div><h2>${isImages ? 'Images' : 'Visual matches'}</h2><p>${isImages ? 'Open any image to see its source and license.' : 'A visual trail for “' + safeQuery + '”.'}</p></div>${!isImages ? `<a href="browsery://search/?q=${searchQuery}&tab=images">See all images <span>→</span></a>` : ''}</div><div class="image-grid ${isImages ? 'image-grid-full' : 'image-grid-preview'}" id="visual-grid">${shown}</div>${pagination}${isImages && images.length ? `<p class="image-credit">Images served by Wikimedia Commons. Open a result for the original source and reuse terms.</p>` : ''}</section>`;
}

function renderSearchError(query, error) {
  const titles = { 'no-results': 'No matches for this search.', 'search-source-blocked': 'The search sources are not responding.', 'search-timeout': 'The search took too long.' };
  const encoded = encodeURIComponent(query);
  return `<section class="empty" role="status"><strong>${titles[error] || 'Search results could not connect.'}</strong><p>Your browser is still working. Retry or open another search source here in Browsery.</p><a class="search-retry" href="browsery://search/?q=${encoded}">Retry search</a><a class="search-alternative" href="https://www.bing.com/search?q=${encoded}">Try Bing in Browsery →</a><a class="search-alternative" href="https://duckduckgo.com/?q=${encoded}">Open DuckDuckGo →</a></section>`;
}

function renderBrowserySearch(query, searchPage, images, tab = 'all', aiEnabled = true, imagesLoading = false) {
  const { results = [], nextCursor = null, startIndex = 0, error = null } = searchPage || {};
  const safeQuery = escapeHtml(query);
  const isImages = tab === 'images';
  const searchQuery = encodeURIComponent(query);
  const queryJson = JSON.stringify(query).replace(/</g, '\\u003c');
  const resultMarkup = results.length ? renderSearchResultMarkup(results, startIndex) : error === 'loading' ? '<div class="search-skeleton" role="status" aria-label="Loading search results"><i></i><b></b><span></span><i></i><b></b><span></span><i></i><b></b><span></span></div>' : renderSearchError(query, error);
  const imageSection = query ? renderBrowseryImageSection(query, images, tab, imagesLoading) : '';
  const overviewMarkup = query ? `<article style="margin:0 0 25px;padding:20px 22px;border:1px solid #363636;border-radius:16px;background:linear-gradient(140deg,#191919,#111);box-shadow:0 18px 42px #0003"><div style="display:flex;align-items:center;gap:9px;margin-bottom:12px;color:#ededed;font-weight:650;font-size:13px">AI Overview <small style="margin-left:auto;color:#999;font-weight:450">Groq · short answer</small></div><div id="browsery-overview" aria-live="polite" aria-busy="${aiEnabled}" style="color:#dedede;font-size:14px;line-height:1.6">${aiEnabled ? 'Finding a short answer…' : 'AI Overview is turned off in Settings.'}</div><small id="browsery-overview-notice" role="status" hidden style="display:block;margin-top:8px;color:#aaa;font-size:11px"></small><details id="browsery-overview-attribution" hidden style="margin-top:12px"><summary style="color:#999;cursor:pointer;font-size:11px">Sources</summary><div id="browsery-overview-sources" style="display:flex;flex-wrap:wrap;gap:7px;margin-top:9px"></div></details><button id="browsery-overview-retry" type="button" style="display:none;margin-top:12px;padding:7px 10px;border:1px solid #444;border-radius:8px;background:#1a1a1a;color:#e5e5e5;cursor:pointer">Try again</button></article><script>
  const overview=document.getElementById('browsery-overview'),sources=document.getElementById('browsery-overview-sources'),query=${queryJson};
  const messages={disabled:'AI Overview is turned off in Browsery Settings.','missing-key':'Add your Groq API key in Settings → AI Overview to enable a sourced summary.','key-unreadable':'The saved Groq key could not be decrypted. Replace it in Settings → AI Overview.','secure-storage-unavailable':'Secure key storage is unavailable on this device.','invalid-key':'Groq did not accept this API key. Check it in Settings.','usage-limit':'Groq account rate or usage limit reached.','request-failed':'Groq could not complete the overview. Try again.',timeout:'The web overview took too long. Try again.',empty:'Groq returned no overview for this search.'};
  const retry=document.getElementById('browsery-overview-retry');
  const attribution=document.getElementById('browsery-overview-attribution'),notice=document.getElementById('browsery-overview-notice');
  let overviewRequest=null,overviewFrame=0,pendingAnswer='';
  function flushAnswer(){if(overviewFrame)cancelAnimationFrame(overviewFrame);overviewFrame=0;if(pendingAnswer)overview.textContent=pendingAnswer;}
  function updateAnswer(text){pendingAnswer=String(text||'');if(!overviewFrame)overviewFrame=requestAnimationFrame(flushAnswer);}
  function finishOverview(result){
    flushAnswer();overview.setAttribute('aria-busy','false');
    if(result.status!=='ready'){
      if(result.status==='cancelled')return;
      const message=messages[result.status]||messages['request-failed'];
      if(pendingAnswer){notice.textContent='Answer interrupted. '+message;notice.hidden=false}else overview.textContent=message;
      if(['request-failed','timeout','usage-limit','empty'].includes(result.status))retry.style.display='inline-flex';
      return;
    }
    pendingAnswer=String(result.text||'');flushAnswer();
    const references=(result.sources||[]).filter(source=>String(source.url||'').startsWith('https://')).slice(0,3);
    for(const source of references){const link=document.createElement('a');link.href=source.url;link.textContent=source.title||new URL(source.url).hostname;link.title=source.title||source.url;link.style.cssText='border:1px solid #444;border-radius:8px;padding:7px 9px;color:#ddd;text-decoration:none;font-size:10px';sources.append(link)}
    attribution.hidden=!references.length;attribution.querySelector('summary').textContent='Sources ('+references.length+')';
  }
  async function loadOverview(){
    overviewRequest?.abort();const request=new AbortController();overviewRequest=request;
    if(overviewFrame)cancelAnimationFrame(overviewFrame);overviewFrame=0;pendingAnswer='';
    retry.style.display='none';notice.hidden=true;attribution.hidden=true;attribution.open=false;sources.replaceChildren();
    overview.setAttribute('aria-busy','true');overview.textContent='Finding a short answer…';
    let reader;
    try{
      const endpoint=new URL('/overview',window.location.href);endpoint.searchParams.set('q',query);endpoint.searchParams.set('stream','1');
      const response=await fetch(endpoint.href,{cache:'no-store',signal:request.signal});
      if(!response.ok)throw new Error('Overview endpoint returned '+response.status);
      if(response.headers.get('content-type')?.includes('application/json')){finishOverview(await response.json());return}
      reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',completed=false;
      const consume=line=>{if(!line.trim()||overviewRequest!==request||request.signal.aborted)return;const event=JSON.parse(line);if(event.type==='update')updateAnswer(event.text);if(event.type==='result'){completed=true;finishOverview(event)}};
      while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let newline;while((newline=buffer.indexOf('\\n'))>=0){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1)}if(done)break;if(buffer.length>65536)throw new Error('Invalid overview stream')}
      if(buffer.trim())consume(buffer);if(!completed)throw new Error('Overview stream ended early');
    }catch(error){if(request.signal.aborted)return;request.abort();finishOverview({status:'request-failed'})}
    finally{if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}}
  }
  addEventListener('pagehide',()=>{overviewRequest?.abort();if(overviewFrame)cancelAnimationFrame(overviewFrame)},{once:true});
  retry.addEventListener('click',loadOverview);
  if(${aiEnabled ? 'true' : 'false'})loadOverview();
  </script>` : '';
  const imageMoreMarkup = isImages && query ? `<script>
  (()=>{const query=${queryJson};let cursor=null,count=0,loading=false,paused=false,observer;
  const elements=()=>({section:document.getElementById('visual-section'),grid:document.getElementById('visual-grid'),more:document.getElementById('image-more'),status:document.getElementById('image-status'),button:document.getElementById('load-more-images'),sentinel:document.getElementById('images-sentinel')});
  const stop=()=>{observer?.disconnect();observer=null};
  const observe=()=>{const {sentinel,button}=elements();if(!cursor||!sentinel){stop();return}if('IntersectionObserver'in window){stop();observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMore(false)},{rootMargin:'900px 0px'});observer.observe(sentinel);button.hidden=true}else button.hidden=false};
  const update=(state)=>{const {more,status,button}=elements();count=Math.max(0,Number(state.images)||0);cursor=state.nextCursor||null;paused=false;if(!more||!status||!button)return;more.hidden=!count;if(!count){status.textContent=state.error==='search-timeout'?'Image search took too long.':'No more image matches found.';button.hidden=true;stop();return}if(cursor){status.textContent=count+' images loaded · keep scrolling';button.hidden=true;observe()}else{status.textContent=count+' images loaded';button.hidden=true;stop()}};
  const loadMore=async(manual=false)=>{if(!cursor||loading||(paused&&!manual))return;const {grid,status,button}=elements();if(!grid||!status||!button)return;loading=true;paused=false;button.disabled=true;button.textContent='Loading…';status.textContent='Finding more images…';try{const endpoint=new URL('/images-more',window.location.href);endpoint.searchParams.set('q',query);endpoint.searchParams.set('cursor',cursor);const response=await fetch(endpoint.href,{cache:'no-store'});const page=await response.json();if(!response.ok||!page.ok)throw new Error(page.error||'search-unavailable');const existing=new Set([...grid.querySelectorAll('.image-card')].map(card=>card.dataset.imageUrl));const template=document.createElement('template');template.innerHTML=page.html||'';let added=0;for(const card of [...template.content.querySelectorAll('.image-card')]){if(existing.has(card.dataset.imageUrl))card.remove();else{existing.add(card.dataset.imageUrl);added++}}grid.append(template.content);count+=added;cursor=page.nextCursor||null;if(!cursor){status.textContent=count+' images loaded';button.hidden=true;stop()}else if(!added){paused=true;status.textContent='The next image page repeated these matches. Use Load more to retry.';button.hidden=false;stop()}else{status.textContent=count+' images loaded · keep scrolling';observe()}}catch(error){console.warn('Browsery could not load more images:',error);paused=true;status.textContent='More images could not load. Try again.';button.textContent='Retry';button.hidden=false;stop()}finally{loading=false;button.disabled=false;if(cursor&&button.textContent==='Loading…')button.textContent='Load more images'}};
  window.browseryImagesReady=update;document.addEventListener('click',event=>{if(event.target.closest('#load-more-images'))loadMore(true)});if(document.getElementById('visual-grid')?.querySelector('.image-card'))update({images:document.querySelectorAll('#visual-grid .image-card').length,nextCursor:null});
  })();
  </script>` : '';
  const moreResultsMarkup = !isImages && query ? `<div class="more-results" id="more-results"><p id="results-status" role="status">${error === 'loading' ? 'Searching the web…' : nextCursor ? 'Scroll for more results' : 'No further pages from this search'}</p><button id="load-more-results" type="button" ${nextCursor ? '' : 'hidden'}>Load more results</button><div id="results-sentinel" aria-hidden="true"></div></div><script>
  (()=>{const query=${queryJson},list=document.getElementById('search-result-list'),status=document.getElementById('results-status'),button=document.getElementById('load-more-results'),sentinel=document.getElementById('results-sentinel'),counter=document.getElementById('results-count');let cursor=${JSON.stringify(nextCursor)},count=${results.length},loading=false,paused=false,observer;
  window.browserySearchReady=state=>{count=Number(state.results)||0;cursor=state.nextCursor||null;counter.textContent=count?count+' results loaded':state.error==='no-results'?'No matches':'Search unavailable';if(cursor){status.textContent=count+' results · keep scrolling';button.hidden=true;if('IntersectionObserver'in window){observer?.disconnect();observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMore(false)},{rootMargin:'850px 0px'});observer.observe(sentinel)}else button.hidden=false}else{status.textContent=count?'You’re at the end of the available results':'';button.hidden=true;observer?.disconnect()}};
  const loadMore=async(manual=false)=>{if(!cursor||loading||(paused&&!manual))return;loading=true;paused=false;button.disabled=true;button.textContent='Loading…';status.textContent='Looking for more results…';try{const endpoint=new URL('/more',window.location.href);endpoint.searchParams.set('q',query);endpoint.searchParams.set('cursor',cursor);const response=await fetch(endpoint.href,{cache:'no-store'});const page=await response.json();if(!response.ok||!page.ok)throw new Error(page.error||'search-unavailable');const existing=new Set([...list.querySelectorAll('.result')].map(item=>item.dataset.resultUrl));const template=document.createElement('template');template.innerHTML=page.html||'';let added=0;for(const item of [...template.content.querySelectorAll('.result')]){if(existing.has(item.dataset.resultUrl))item.remove();else{existing.add(item.dataset.resultUrl);added++}}list.append(template.content);count+=added;counter.textContent=count+' results loaded';cursor=page.nextCursor||null;if(!cursor){status.textContent='You’re at the end of the available results';button.hidden=true;observer?.disconnect()}else{status.textContent=count+' results · keep scrolling';button.hidden=true}if(!added&&cursor){paused=true;status.textContent='The next page repeated these results. Use Load more to retry.';button.hidden=false}}catch(error){console.warn('Browsery could not load another search page:',error);paused=true;status.textContent='More results could not load. Try again.';button.textContent='Retry';button.hidden=false}finally{loading=false;button.disabled=false;if(cursor&&button.textContent==='Loading…')button.textContent='Load more results'}};
  button.addEventListener('click',()=>loadMore(true));if(cursor&&'IntersectionObserver'in window){observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))loadMore(false)},{rootMargin:'850px 0px'});observer.observe(sentinel)}else if(!cursor)button.hidden=true;
  })();
  </script>` : '';
  const activeResults = isImages ? `${imageSection}${imageMoreMarkup}` : `${overviewMarkup}${imageSection}<section class="web-section"><div class="section-heading web-heading"><div><h2>Web results</h2><p id="results-count">${error === 'loading' ? 'Searching…' : `${results.length} results loaded`}</p></div></div><p id="search-provider" style="font-size:11px;color:#999;margin:9px 0 0">Searching live web sources…</p><p id="mwmbl-credit" hidden style="font-size:10px;color:#999;margin:5px 0 0">Results supplied by <a href="https://mwmbl.org" style="color:#ccc">Mwmbl</a> · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" style="color:#ccc">CC BY-NC-SA 4.0</a> · Formatting adapted for Browsery.</p><div id="search-result-list">${resultMarkup}</div></section>${moreResultsMarkup}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeQuery || 'Search'} — Browsery</title><style>
  :root{color-scheme:dark;font-family:Inter,"Segoe UI Variable","Segoe UI",system-ui,sans-serif;background:#080b11;color:#ecf4ff;--a:#75ddff;--muted:#8292a7;--line:#25303c}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% -28%,#203c5b 0,rgba(17,29,46,.55) 27%,transparent 59%),#080b11}.hero{padding:34px 24px 0;text-align:center;background:linear-gradient(180deg,rgba(17,27,42,.64),rgba(8,11,17,0));}.brand{display:inline-flex;align-items:center;justify-content:center;gap:12px;color:#f6f9ff;text-decoration:none;font-weight:740;font-size:39px;letter-spacing:-.055em}.brand-word{background:linear-gradient(100deg,#ecfbff 4%,#8ce5ff 48%,#a69aff 92%);background-clip:text;color:transparent}.orb{width:35px;height:35px;border-radius:12px;background:conic-gradient(from 205deg,#72e6ff,#708fff 38%,#bb7bff 67%,#72e6ff);box-shadow:0 0 32px #62dcff48;transform:rotate(-12deg);position:relative}.orb:after{content:"";position:absolute;inset:5px 12px 15px 6px;border-radius:50%;background:#fff9;filter:blur(3px)}.search-form{max-width:700px;margin:23px auto 0;display:flex;align-items:center;border:1px solid #34475c;border-radius:16px;background:linear-gradient(135deg,#151f2b,#101720);overflow:hidden;box-shadow:0 15px 45px #0005,0 1px #ffffff09 inset;transition:border-color .18s,box-shadow .18s}.search-form:focus-within{border-color:#68c9f0;box-shadow:0 0 0 3px #54bce51c,0 18px 48px #0006}.search-symbol{margin-left:17px;color:#94abc3;display:flex}.search-form input{flex:1;min-width:0;height:52px;border:0;outline:0;padding:0 13px;background:transparent;color:#f3f8ff;font-size:14px}.search-form input::placeholder{color:#74849a}.search-form button{width:53px;height:52px;border:0;border-left:1px solid #293849;background:#152639;color:var(--a);font-size:20px;cursor:pointer;transition:background .18s}.search-form button:hover{background:#1d3851}.search-tabs{max-width:1060px;margin:25px auto 0;display:flex;justify-content:center;gap:8px;border-bottom:1px solid #202a35}.search-tabs a{height:43px;padding:0 17px;display:flex;align-items:center;gap:9px;text-decoration:none;color:#8594a7;font-size:12px;border-bottom:2px solid transparent;transition:color .18s,border-color .18s}.search-tabs a:hover,.search-tabs a.active{color:#eaf8ff}.search-tabs a.active{border-color:#78dcff}.search-tabs svg{width:15px;height:15px}.layout{display:grid;grid-template-columns:minmax(0,790px) 248px;gap:45px;max-width:1120px;margin:0 auto;padding:30px 24px 80px}.side{position:sticky;top:26px;height:max-content;padding:19px;border:1px solid #263442;border-radius:17px;background:linear-gradient(145deg,#101822,#0c121a);box-shadow:0 16px 38px #0003}.side-title{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:680}.side-mark{width:27px;height:27px;border:1px solid #30495d;border-radius:9px;background:linear-gradient(145deg,#183448,#162035);display:grid;place-items:center;color:#8be6ff;font-size:15px}.side p{margin:12px 0 14px;color:#8999ad;font-size:11px;line-height:1.65}.source-line{padding-top:12px;border-top:1px solid #25313d;color:#64768c;font-size:10px;line-height:1.5}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:20px;margin:0 0 13px}.section-heading h2{margin:0;color:#e7f0f8;font-size:16px;letter-spacing:-.02em}.section-heading p{margin:5px 0 0;color:#77869a;font-size:10px}.section-heading>a{color:#8fe4ff;font-size:10px;text-decoration:none;white-space:nowrap}.section-heading>a span{font-size:15px;margin-left:4px}.visual-section{margin-bottom:33px}.image-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.image-grid-full{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:20px}.image-card{min-width:0;border:1px solid #253442;border-radius:14px;overflow:hidden;background:#111820;color:inherit;text-decoration:none;transition:transform .24s cubic-bezier(.25,1,.5,1),border-color .2s,box-shadow .24s}.image-card:hover{transform:translateY(-4px);border-color:#526b80;box-shadow:0 15px 32px #0005}.image-frame{position:relative;display:block;aspect-ratio:1.55;background:linear-gradient(135deg,#182a3b,#131821);overflow:hidden}.image-frame img{width:100%;height:100%;display:block;object-fit:cover;transition:transform .5s cubic-bezier(.25,1,.5,1)}.image-card:hover .image-frame img{transform:scale(1.045)}.image-open{position:absolute;right:9px;top:9px;width:25px;height:25px;display:grid;place-items:center;border:1px solid #ffffff40;border-radius:8px;background:#080d14b8;color:white;font-size:13px;opacity:0;transform:translateY(3px);transition:opacity .18s,transform .18s}.image-card:hover .image-open{opacity:1;transform:none}.image-caption{display:block;padding:10px 11px 11px}.image-caption strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#e4edf6;font-size:10px;font-weight:600}.image-caption small{display:block;margin-top:5px;color:#77889b;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.image-credit{margin:12px 0 0;color:#66778c;font-size:9px}.image-empty{grid-column:1/-1;min-height:150px;border:1px dashed #344453;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:#7b8da2;font-size:10px}.image-empty strong{color:#d5e1ec;font-size:12px}.image-empty-mark{font-size:23px;color:#86dfff}.web-heading{padding-top:5px}.result{padding:16px 0 18px;border-top:1px solid #202b36}.result-site{display:flex;align-items:center;gap:10px;margin-bottom:8px;min-width:0}.site-logo{position:relative;flex:0 0 29px;width:29px;height:29px;border:1px solid #354554;border-radius:9px;background:linear-gradient(145deg,#182433,#10161f);display:grid;place-items:center;overflow:hidden}.site-logo img{position:absolute;inset:4px;width:19px;height:19px;object-fit:contain;border-radius:4px}.site-logo b{color:#82dcf7;font-size:12px;font-weight:700}.site-meta{min-width:0;display:flex;flex-direction:column;gap:3px}.site-meta strong{color:#c9d5e1;font-size:10px;font-weight:600}.site-meta small{max-width:640px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#77879a;font-size:9px}.result-number{margin-left:auto;color:#526174;font:9px ui-monospace,monospace}.result-title{color:#a6dfff;font-size:16px;font-weight:620;line-height:1.35;text-decoration:none;letter-spacing:-.015em}.result-title:hover{color:#ddf7ff;text-decoration:underline;text-underline-offset:3px}.result p{max-width:680px;margin:6px 0 0;color:#9aa8b6;font-size:11px;line-height:1.65}.empty{padding:26px;border:1px solid #2c3a49;border-radius:15px;background:#0d141d}.empty strong{color:#edf5ff}.empty p{color:#93a3b7;font-size:12px;line-height:1.6}.empty a{color:var(--a);font-size:11px}.@media(max-width:900px){.layout{grid-template-columns:1fr;max-width:800px}.side{position:static;order:-1}.side p{margin-bottom:10px}}@media(max-width:620px){.hero{padding:26px 16px 0}.brand{font-size:33px}.orb{width:30px;height:30px}.search-form{margin-top:19px}.search-form input{height:48px;font-size:13px}.search-form button{height:48px}.search-tabs{margin-top:18px}.search-tabs a{padding:0 12px;height:40px}.layout{padding:22px 16px 60px;gap:26px}.image-grid,.image-grid-full{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.image-grid-preview .image-card:nth-child(3){display:none}.image-frame{aspect-ratio:1.2}.section-heading h2{font-size:14px}}
  </style></head><body><header class="hero"><div class="brand"><i class="orb"></i><span class="brand-word">Browsery</span></div><form class="search-form" action="browsery://search/" method="get"><span class="search-symbol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4.5 4.5"></path></svg></span><input name="q" value="${safeQuery}" placeholder="Search the web" aria-label="Search the web" autocomplete="off"><input type="hidden" name="tab" value="${isImages ? 'images' : 'all'}"><button aria-label="Search">→</button></form><nav class="search-tabs" aria-label="Search categories"><a class="${!isImages ? 'active' : ''}" href="browsery://search/?q=${searchQuery}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="m16 16 4.5 4.5"></path></svg>All</a><a class="${isImages ? 'active' : ''}" href="browsery://search/?q=${searchQuery}&tab=images"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><circle cx="9" cy="10" r="1.7"></circle><path d="m5 17 5.5-5 3.5 3 2.5-2 3 4"></path></svg>Images</a></nav></header><main class="layout"><section>${activeResults}</section><aside class="side"><div class="side-title"><span class="side-mark">✳</span>Browsery search</div><p>Live web results use DuckDuckGo with an independent Mwmbl backup. The active source is shown above the results. Images come from Wikimedia Commons, with source and license links.</p><div class="source-line">Results load separately from images and AI.</div></aside></main><script>scrollTo(0,0);addEventListener('load',()=>scrollTo(0,0))</script></body></html>`;
}

async function handleBrowseryRequest(request, browserSession) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim() || '';
  if (url.hostname === 'search' && url.pathname === '/overview') {
    if (url.searchParams.get('stream') === '1') {
      const abort = new AbortController();
      const encoder = new TextEncoder();
      let closed = false;
      const cancel = () => abort.abort();
      if (request.signal?.aborted) cancel();
      request.signal?.addEventListener('abort', cancel, { once: true });
      const stream = new ReadableStream({
        start(output) {
          const send = (type, value) => {
            if (!closed) output.enqueue(encoder.encode(JSON.stringify({ ...value, type }) + '\n'));
          };
          createOverview(query, {
            enabled: browserPreferences.aiOverview, model: browserPreferences.aiModel,
            signal: abort.signal, onUpdate: text => send('update', { text }),
          }).then(result => send('result', result)).catch(() => send('result', { status: 'request-failed' })).finally(() => {
            request.signal?.removeEventListener('abort', cancel);
            if (!closed) { closed = true; output.close(); }
          });
        },
        cancel() { closed = true; abort.abort(); request.signal?.removeEventListener('abort', cancel); },
      });
      return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const overview = await createOverview(query, { enabled: browserPreferences.aiOverview, model: browserPreferences.aiModel });
    return new Response(JSON.stringify(overview), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (url.hostname === 'search' && url.pathname === '/more') {
    const cursor = url.searchParams.get('cursor') || '';
    const page = await getBrowseryResults(query, browserSession, cursor);
    const ok = page.results.length > 0 || page.error === 'no-results';
    return new Response(JSON.stringify({ ok, error: page.error, html: renderSearchResultMarkup(page.results, page.startIndex), results: page.results.length, nextCursor: page.nextCursor, source: page.source }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (url.hostname === 'search' && url.pathname === '/results') {
    const page = await getBrowseryResults(query, browserSession);
    return new Response(JSON.stringify({ ok: page.results.length > 0 || page.error === 'no-results', error: page.error, html: page.results.length ? renderSearchResultMarkup(page.results, page.startIndex) : renderSearchError(query, page.error), results: page.results.length, nextCursor: page.nextCursor, source: page.source }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (url.hostname === 'search' && url.pathname === '/images') {
    const imagePage = await getBrowseryImages(query);
    return new Response(JSON.stringify({
      ok: imagePage.images.length > 0 || imagePage.error === 'no-results',
      error: imagePage.error,
      html: renderBrowseryImageSection(query, imagePage, url.searchParams.get('tab') === 'images' ? 'images' : 'all'),
      images: imagePage.images.length,
      nextCursor: imagePage.nextCursor,
    }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (url.hostname === 'search' && url.pathname === '/images-more') {
    const cursor = url.searchParams.get('cursor') || '';
    const imagePage = await getBrowseryImages(query, cursor);
    return new Response(JSON.stringify({
      ok: imagePage.images.length > 0 || imagePage.error === 'no-results',
      error: imagePage.error,
      html: renderBrowseryImageCards(imagePage.images),
      images: imagePage.images.length,
      nextCursor: imagePage.nextCursor,
    }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }
  const tab = url.searchParams.get('tab') === 'images' ? 'images' : 'all';
  const page = renderBrowserySearch(query, { results: [], nextCursor: null, startIndex: 0, error: query ? 'loading' : null }, [], tab, browserPreferences.aiOverview, Boolean(query));
  const loader = query ? `<script>
  (async()=>{const query=${JSON.stringify(query).replace(/</g, '\\u003c')},tab=${JSON.stringify(tab)};const endpoint=(path)=>{const url=new URL(path,location.href);url.searchParams.set('q',query);url.searchParams.set('tab',tab);return url};
  const results=document.getElementById('search-result-list'),visual=document.getElementById('visual-section');
  const request=path=>fetch(endpoint(path),{cache:'no-store',signal:AbortSignal.timeout(10000)}).then(response=>{if(!response.ok)throw new Error('Search returned '+response.status);return response.json()});
  const tasks=[];
  if(results)tasks.push(request('/results').then(data=>{
    results.innerHTML=data.html;
    const provider=document.getElementById('search-provider'),credit=document.getElementById('mwmbl-credit');
    if(provider)provider.textContent=data.source?'Web results via '+data.source:'Live search unavailable';
    if(credit)credit.hidden=data.source!=='Mwmbl';
    window.browserySearchReady?.(data);
  }).catch(error=>{
    console.warn('Browsery search results could not load:',error);
    results.innerHTML=${JSON.stringify(renderSearchError(query, 'search-timeout')).replace(/</g, '\\u003c')};
    const provider=document.getElementById('search-provider');if(provider)provider.textContent='Search connection interrupted';
    window.browserySearchReady?.({results:0,nextCursor:null});
  }));
   if(visual)tasks.push(request('/images').then(data=>{if(data.html)visual.outerHTML=data.html;window.browseryImagesReady?.(data)}).catch(error=>{console.warn('Browsery image results could not load:',error);visual.innerHTML='<div class="empty"><strong>Images could not load.</strong><p>Web results are still available. Retry the Images tab when your connection is ready.</p></div>'}));
  await Promise.allSettled(tasks)})();
  </script>` : '';
  // Match the shell's explicit contrast preference without changing Windows or
  // interfering with the colors/accessibility of arbitrary third-party sites.
  const contrastCss = `:root{forced-color-adjust:${browserPreferences.systemContrast === false ? 'none' : 'auto'}}`;
  const html = page.replace('</style>', `${spaceSearchCss}${contrastCss}</style>`).replace('</body>', `${loader}</body>`);
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function browserDataSession(partition) {
  if (partition === 'regular') return session.fromPartition('persist:browsery');
  if (partition === 'private') return session.fromPartition('browsery-private');
  throw new Error('Unknown browser profile.');
}

function cookieRemovalUrl(cookie) {
  const host = String(cookie.domain || '').replace(/^\./, '');
  if (!host || /[\s/@?#]/.test(host)) throw new Error('Invalid cookie domain.');
  const protocol = cookie.secure ? 'https:' : 'http:';
  const url = new URL(`${protocol}//${host}`);
  url.pathname = cookie.path?.startsWith('/') ? cookie.path : '/';
  return url.href;
}

function cookieMetadata(cookie, partition) {
  return {
    partition,
    name: cookie.name,
    domain: cookie.domain || '',
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    hostOnly: Boolean(cookie.hostOnly),
    session: Boolean(cookie.session),
    expirationDate: Number.isFinite(cookie.expirationDate) ? cookie.expirationDate : null,
    sameSite: cookie.sameSite || 'unspecified',
  };
}

async function clearSessionCookies(browserSession) {
  const cookies = await browserSession.cookies.get({});
  for (const cookie of cookies) await browserSession.cookies.remove(cookieRemovalUrl(cookie), cookie.name);
  await browserSession.cookies.flushStore();
  return cookies.length;
}

function markCookiesPurged() {
  lastCookiePurgeAt = Date.now();
  saveCookiePurgeState();
}

function scheduleCookiePurge() {
  if (cookiePurgeTimer) {
    clearTimeout(cookiePurgeTimer);
    cookiePurgeTimer = null;
  }
  const interval = cookiePurgeIntervals.get(cookiePurgePreference);
  if (!interval) return;
  const delay = Math.max(1000, interval - Math.max(0, Date.now() - lastCookiePurgeAt));
  cookiePurgeTimer = setTimeout(async () => {
    cookiePurgeTimer = null;
    try { await purgeRegularCookies(); }
    catch (error) { console.warn('Browsery could not run the scheduled cookie purge:', error.code || error.name); scheduleCookiePurge(); }
  }, delay);
  cookiePurgeTimer.unref?.();
}

function updateCookiePurgePreference(value) {
  cookiePurgePreference = cookiePurgeIntervals.has(value) || value === 'On close' ? value : '24 hours';
  saveCookiePurgeState();
  scheduleCookiePurge();
}

function purgeRegularCookies() {
  if (cookiePurgeInFlight) return cookiePurgeInFlight;
  cookiePurgeInFlight = clearSessionCookies(session.fromPartition('persist:browsery')).then(removed => {
    markCookiesPurged();
    scheduleCookiePurge();
    return removed;
  }).finally(() => { cookiePurgeInFlight = null; });
  return cookiePurgeInFlight;
}

function isBrowserGuest(contents) {
  return Boolean(
    contents
      && !contents.isDestroyed?.()
      && contents.getType?.() === 'webview'
      && mainWindow
      && !mainWindow.isDestroyed()
      && contents.hostWebContents === mainWindow.webContents,
  );
}

function getBrowserGuestFromShell(event, webContentsId) {
  if (!isTrustedShell(event) || !Number.isSafeInteger(webContentsId)) return null;
  const guest = webContents.fromId(webContentsId);
  return isBrowserGuest(guest) ? guest : null;
}

function settlePermissionRequest(id, allowed, { remember = false } = {}) {
  const request = pendingPermissionRequests.get(id);
  if (!request) return { ok: false, reason: 'expired' };
  pendingPermissionRequests.delete(id);
  if (request.fallbackTimer) clearTimeout(request.fallbackTimer);
  const grant = Boolean(allowed);
  if (grant && remember && request.scope === 'regular') {
    permissionDecisions.set(permissionDecisionKey(request.scope, request.origin, request.permission), 'allow');
    savePermissionDecisions();
  }
  try { request.callback(grant); } catch {}
  // Keep Browsery's own permission card in sync when the person answered the
  // native fallback instead. The renderer never receives a permission token
  // for a different window or a different site.
  send('browser:permission-resolved', { id, allowed: grant });
  return { ok: true, allowed: grant };
}

async function showNativePermissionPrompt(id) {
  const request = pendingPermissionRequests.get(id);
  if (!request || request.nativePromptOpen) return;
  request.nativePromptOpen = true;
  if (!mainWindow || mainWindow.isDestroyed()) {
    settlePermissionRequest(id, false);
    return;
  }
  const label = permissionLabels[request.permission] || request.permission;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Browsery permission request',
      message: `${request.origin} wants to use ${label}.`,
      detail: 'Allow only if you trust this site. Browsery never grants device or location access automatically.',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: request.scope === 'regular' ? 'Remember this choice for this site' : undefined,
      checkboxChecked: false,
      noLink: true,
    });
    settlePermissionRequest(id, result.response === 0, { remember: Boolean(result.checkboxChecked) });
  } catch {
    settlePermissionRequest(id, false);
  }
}

function requestSitePermission(browserSession, contents, permission, callback, details = {}) {
  if (!interactivePermissions.has(permission) || !isBrowserGuest(contents)) {
    callback(false);
    return;
  }
  const origin = normalizePermissionOrigin(details.requestingUrl || contents.getURL());
  if (!origin) {
    callback(false);
    return;
  }
  const scope = permissionScopeForSession(browserSession);
  if (permissionDecisions.get(permissionDecisionKey(scope, origin, permission)) === 'allow') {
    callback(true);
    return;
  }
  const id = randomUUID();
  const request = { id, callback, permission, origin, scope, nativePromptOpen: false, fallbackTimer: null };
  pendingPermissionRequests.set(id, request);
  // A Browsery UI prompt can answer immediately through the preload bridge.
  // Leave it visible long enough to be useful, then keep a native fallback so
  // camera, microphone, and location still work if the shell has not mounted.
  send('browser:permission-request', { id, permission, label: permissionLabels[permission] || permission, origin, private: scope === 'private' });
  request.fallbackTimer = setTimeout(() => showNativePermissionPrompt(id), 1800);
  request.fallbackTimer.unref?.();
  contents.once('destroyed', () => settlePermissionRequest(id, false));
}

function configurePermissionHandlers(browserSession) {
  browserSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => {
    if (!interactivePermissions.has(permission) || !isBrowserGuest(contents)) return false;
    const origin = normalizePermissionOrigin(requestingOrigin || contents.getURL());
    if (!origin) return false;
    return permissionDecisions.get(permissionDecisionKey(permissionScopeForSession(browserSession), origin, permission)) === 'allow';
  });
  browserSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    requestSitePermission(browserSession, contents, permission, callback, details);
  });
}

function toPreconnectOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (browserPreferences.https && url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') url.protocol = 'https:';
    return url.origin;
  } catch { return ''; }
}

function preconnect(browserSession, rawUrl) {
  if (!browserPreferences.preload) return { ok: false, status: 'disabled' };
  const origin = toPreconnectOrigin(rawUrl);
  if (!origin || !browserSession?.preconnect) return { ok: false, status: 'unsupported' };
  const key = `${permissionScopeForSession(browserSession)}\n${origin}`;
  const now = Date.now();
  if (now - (preconnectAttempts.get(key) || 0) < 12_000) return { ok: true, status: 'recent' };
  try {
    browserSession.preconnect({ url: origin, numSockets: 1 });
    preconnectAttempts.set(key, now);
    return { ok: true, status: 'warming', origin };
  } catch {
    return { ok: false, status: 'unavailable' };
  }
}

function updateTabSleepState(event, { webContentsId, active } = {}) {
  const guest = getBrowserGuestFromShell(event, webContentsId);
  if (!guest) return { ok: false, status: 'invalid-tab' };
  const sleeping = Boolean(browserPreferences.sleep && !active);
  try {
    // Chromium pauses timers and animation work only after a tab is actually
    // backgrounded. The renderer owns visibility; this call makes the sleeping
    // tabs preference decide whether that throttling is allowed.
    guest.setBackgroundThrottling(sleeping);
    return { ok: true, status: sleeping ? 'sleeping' : 'awake' };
  } catch {
    return { ok: false, status: 'unavailable' };
  }
}

function uniqueDownloadPath(directory, filename) {
  const extension = path.extname(filename);
  const stem = path.basename(filename, extension);
  let candidate = path.join(directory, filename);
  for (let index = 1; fs.existsSync(candidate); index += 1) candidate = path.join(directory, `${stem} (${index})${extension}`);
  return candidate;
}

function attachDownloadManager(browserSession, { persistHistory = true } = {}) {
  browserSession.on('will-download', (_event, item) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let lastBytes = 0;
    let lastAt = Date.now();
    activeDownloads.set(id, item);
    const filename = path.basename(item.getFilename());
    if (browserPreferences.downloadPath === 'Ask every time') {
      item.pause();
      const options = { defaultPath: uniqueDownloadPath(app.getPath('downloads'), filename) };
      const saveDialog = mainWindow && !mainWindow.isDestroyed() ? dialog.showSaveDialog(mainWindow, options) : dialog.showSaveDialog(options);
      saveDialog.then(({ canceled, filePath }) => {
        if (canceled || !filePath) item.cancel();
        else { item.setSavePath(filePath); item.resume(); }
      }).catch(() => item.resume());
    } else {
      const directory = browserPreferences.downloadPath === 'Desktop' ? app.getPath('desktop') : app.getPath('downloads');
      item.setSavePath(uniqueDownloadPath(directory, filename));
    }
    const publish = (state = 'progressing') => {
      const now = Date.now();
      const received = item.getReceivedBytes();
      const total = item.getTotalBytes();
      const elapsed = Math.max(1, now - lastAt);
      const speed = Math.max(0, ((received - lastBytes) / elapsed) * 1000);
      lastBytes = received;
      lastAt = now;
      const update = { id, name: item.getFilename(), savePath: item.getSavePath(), received, total, progress: total ? Math.round((received / total) * 100) : 0, speed, paused: item.isPaused(), state };
      // A private tab can still show its download while Browsery is open, but
      // its transfer must never become part of the regular download library.
      if (state === 'completed' && persistHistory) rememberCompletedDownload(update);
      send('download:update', update);
    };
    item.on('updated', () => publish());
    item.once('done', (_event, state) => { publish(state); activeDownloads.delete(id); });
    publish();
  });
}

function configureBrowserSession(browserSession, options) {
  browserSession.protocol.handle('browsery', request => handleBrowseryRequest(request, browserSession));
  browserSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    try {
      const url = new URL(details.url);
      const host = url.hostname.toLowerCase();
      const blocked = adblocker?.shouldBlock(details, browserPreferences);
      if (blocked) return callback({ cancel: true });
      if (browserPreferences.https && url.protocol === 'http:' && host !== 'localhost' && host !== '127.0.0.1') return callback({ redirectURL: details.url.replace(/^http:/, 'https:') });
    } catch {}
    callback({});
  });
  // These headers express the user's privacy preference to pages without
  // recording destinations or relying on an external tracking service.
  browserSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    if (browserPreferences.dnt !== false) {
      requestHeaders.DNT = '1';
      requestHeaders['Sec-GPC'] = '1';
    } else {
      delete requestHeaders.DNT;
      delete requestHeaders['Sec-GPC'];
    }
    if (browserPreferences.fingerprint !== false) {
      // High-entropy client hints make a browser easier to distinguish. This
      // is intentionally opt-out: some download sites use them to choose an
      // installer, so the setting remains visible in Browsery Privacy.
      for (const header of ['Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Model', 'Sec-CH-UA-Platform-Version', 'Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-WoW64']) delete requestHeaders[header];
    }
    callback({ requestHeaders });
  });
  const applyWebRtcPolicy = () => {
    if (typeof browserSession.setWebRTCIPHandlingPolicy !== 'function') return;
    try { browserSession.setWebRTCIPHandlingPolicy(browserPreferences.webrtc === false ? 'default' : 'disable_non_proxied_udp'); } catch {}
  };
  const applySleepingTabsPolicy = () => {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.session !== browserSession || contents.getType?.() !== 'webview' || contents.isDestroyed?.()) continue;
      try { contents.setBackgroundThrottling(Boolean(browserPreferences.sleep)); } catch {}
    }
  };
  applyWebRtcPolicy();
  browserSession.__browseryApplyWebRtcPolicy = applyWebRtcPolicy;
  browserSession.__browseryApplySleepingTabsPolicy = applySleepingTabsPolicy;
  configurePermissionHandlers(browserSession);
  attachDownloadManager(browserSession, options);
}

function createWindow() {
  allowWindowClose = false;
  closeWarningInFlight = false;
  const browseryIcon = path.join(
    __dirname,
    '..',
    app.isPackaged || process.env.BROWSERY_DIST ? 'dist' : 'public',
    'assets',
    'browsery-icon.png',
  );
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 600,
    frame: false,
    // Match the launch scene so the first compositor frame is never a page flash.
    backgroundColor: '#030303',
    icon: browseryIcon,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });

  mainWindow.on('close', event => {
    if (allowWindowClose || !browserPreferences.closewarn || process.env.BROWSERY_QA_DIR) return;
    event.preventDefault();
    if (closeWarningInFlight) return;
    closeWarningInFlight = true;
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Close Browsery?',
      message: 'Close Browsery and its open tabs?',
      detail: 'Your current session is restored on the next launch when Restore last session is enabled.',
      buttons: ['Close Browsery', 'Keep browsing'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }).then(result => {
      closeWarningInFlight = false;
      if (result.response !== 0 || !mainWindow || mainWindow.isDestroyed()) return;
      allowWindowClose = true;
      mainWindow.close();
    }).catch(() => { closeWarningInFlight = false; });
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });

  // Give React one paint to mount the launch scene before revealing the window.
  // This prevents a native webview frame from appearing before the animation.
  mainWindow.once('ready-to-show', () => setTimeout(() => mainWindow.show(), 120));
  const startUrl = app.isPackaged || process.env.BROWSERY_DIST
    ? pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString()
    : (process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
  mainWindow.loadURL(startUrl);

  if (process.env.BROWSERY_QA_DIR) {
    mainWindow.webContents.once('did-finish-load', () => runQa(mainWindow, process.env.BROWSERY_QA_DIR));
  }
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForRendererValue(win, expression, { timeout = 9000, interval = 120 } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      if (await win.webContents.executeJavaScript(expression)) return true;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  if (lastError) throw lastError;
  return false;
}

async function saveCapture(win, filePath) {
  const image = await win.capturePage();
  fs.writeFileSync(filePath, image.toPNG());
}

async function runQa(win, qaDir) {
  try {
    // Reload through Electron rather than navigating from executeJavaScript.
    // The latter destroys its own isolated world mid-evaluation and made the
    // optional packaged-app QA capture flaky on some Electron versions.
    await win.webContents.executeJavaScript(`localStorage.removeItem('browsery:settings')`);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out reloading the Browsery shell for QA.')), 10000);
      win.webContents.once('did-finish-load', () => { clearTimeout(timeout); resolve(); });
      win.webContents.reload();
    });
    // The visible Browsery shell deliberately waits for its launch sequence.
    // QA must wait for the real New Tab surface instead of sampling a hidden
    // shell at an arbitrary timeout.
    const launchVisible = await waitForRendererValue(win, `Boolean(document.querySelector('.launch-screen'))`, { timeout: 3_000, interval: 50 });
    if (!launchVisible) throw new Error('The Browsery launch video did not appear.');
    const launchPlaying = await waitForRendererValue(win, `(() => {
      const video = document.querySelector('.launch-reference-video');
      return Boolean(video && !video.error && video.readyState >= 2 && video.currentTime > 0.6 && video.videoWidth === 1920);
    })()`, { timeout: 5_000, interval: 100 });
    if (!launchPlaying) throw new Error('The packaged terminal-loading MP4 did not decode and play.');
    const launchVideo = await win.webContents.executeJavaScript(`(() => {
      const video = document.querySelector('.launch-reference-video');
      return { currentSrc: video.currentSrc, duration: video.duration, currentTime: video.currentTime, width: video.videoWidth, height: video.videoHeight, readyState: video.readyState, error: video.error?.code || null };
    })()`);
    await sleep(1_600);
    await saveCapture(win, path.join(qaDir, 'browsery-launch.png'));
    const brandVisible = await waitForRendererValue(win, `Boolean(document.querySelector('.launch-final-brand'))`, { timeout: 15_000 });
    if (!brandVisible) {
      const videoState = await win.webContents.executeJavaScript(`(() => {
        const video = document.querySelector('.launch-reference-video');
        return { phase: document.querySelector('.launch-screen')?.className, time: video?.currentTime, duration: video?.duration, paused: video?.paused, ended: video?.ended, readyState: video?.readyState, error: video?.error?.code || null };
      })()`);
      throw new Error(`The Browsery logo did not appear after the full loading video: ${JSON.stringify(videoState)}`);
    }
    await sleep(650);
    await saveCapture(win, path.join(qaDir, 'browsery-launch-reveal.png'));
    const launchReady = await waitForRendererValue(win, `(() => {
      const video = document.querySelector('.saturn-video');
      return Boolean(video && video.readyState >= 2 && !document.querySelector('.launch-screen'));
    })()`, { timeout: 5_000 });
    if (!launchReady) throw new Error('Timed out waiting for the Browsery launch scene to finish.');
    const initial = await win.webContents.executeJavaScript(`(() => {
      const video = document.querySelector('.saturn-video');
      const settings = JSON.parse(localStorage.getItem('browsery:settings') || '{}');
      return { title: document.title, videoReady: Boolean(video && video.readyState >= 2), videoTime: video?.currentTime || 0, visibleSettingsCount: document.querySelectorAll('.setting-row,.setting-range').length, searchEngine: settings.engine, spatialPlane: Boolean(document.querySelector('.command-plane')), raisedTabs: document.querySelectorAll('.spatial-tabs span').length, updateButton: Boolean(document.querySelector('.update-toolbar')) };
    })()`);
    if (!initial.updateButton) throw new Error('Browsery’s visible Update button is missing.');
    const saturnFrame = await win.webContents.executeJavaScript(`(() => { const video=document.querySelector('.saturn-video'); const canvas=document.createElement('canvas'); canvas.width=video.videoWidth; canvas.height=video.videoHeight; canvas.getContext('2d').drawImage(video,0,0); return canvas.toDataURL('image/png').split(',')[1]; })()`);
    fs.writeFileSync(path.join(qaDir, 'saturn-video-reference.png'), Buffer.from(saturnFrame, 'base64'));
    await saveCapture(win, path.join(qaDir, 'browsery-desktop-onboarding.png'));
    // The owner guide must be short and hands-on: verify its extension route
    // opens the real store, then "Use Extensions" leaves that store usable.
    const guideInitial = await win.webContents.executeJavaScript(`(() => ({
      heading: document.querySelector('.tour-card h2')?.textContent?.trim() || '',
      stepCount: document.querySelectorAll('.tour-route').length,
      hasExtensionsRoute: [...document.querySelectorAll('.tour-route')].some(node => node.textContent.includes('Extensions')),
    }))()`);
    if (!guideInitial.hasExtensionsRoute || guideInitial.stepCount < 4) throw new Error('Owner guide is missing its direct feature routes.');
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('.tour-route')].find(node => node.textContent.includes('Extensions')))?.click()`);
    await sleep(440);
    const extensionGuide = await win.webContents.executeJavaScript(`(() => ({
      drawerOpen: document.querySelector('.extensions-drawer')?.classList.contains('open') || false,
      title: document.querySelector('.tour-card h2')?.textContent?.trim() || '',
      action: document.querySelector('.tour-open')?.textContent?.trim() || '',
    }))()`);
    if (!extensionGuide.drawerOpen || extensionGuide.title !== 'Extensions are here') throw new Error('Owner guide did not open the Extensions panel.');
    await saveCapture(win, path.join(qaDir, 'browsery-owner-guide-extensions.png'));
    await win.webContents.executeJavaScript(`document.querySelector('.tour-open')?.click()`);
    await sleep(220);
    const extensionUseReady = await win.webContents.executeJavaScript(`Boolean(document.querySelector('.extensions-drawer.open')) && !Boolean(document.querySelector('.tour-layer'))`);
    if (!extensionUseReady) throw new Error('Owner guide did not leave Extensions ready to use.');
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Close extensions"]')?.click()`);
    await sleep(260);
    // Settings routes are the other important escape hatch: the guide should
    // open the settings drawer and let the owner jump straight to a category.
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Open owner guide"]')?.click()`);
    await sleep(160);
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('.tour-route')].find(node => node.textContent.includes('Settings')))?.click()`);
    await sleep(440);
    const settingsGuide = await win.webContents.executeJavaScript(`(() => ({
      drawerOpen: document.querySelector('.settings-drawer')?.classList.contains('open') || false,
      title: document.querySelector('.tour-card h2')?.textContent?.trim() || '',
      routeCount: document.querySelectorAll('.tour-settings-link').length,
    }))()`);
    if (!settingsGuide.drawerOpen || settingsGuide.title !== 'Every setting has a home' || settingsGuide.routeCount < 7) throw new Error('Owner guide did not expose the Settings routes.');
    await saveCapture(win, path.join(qaDir, 'browsery-owner-guide-settings.png'));
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('.tour-settings-link')].find(node => node.textContent.includes('Sound')))?.click()`);
    await sleep(220);
    const settingsUseReady = await win.webContents.executeJavaScript(`Boolean(document.querySelector('.settings-drawer.open')) && !Boolean(document.querySelector('.tour-layer')) && /sound/i.test(document.querySelector('.settings-section-head h3')?.textContent || '')`);
    if (!settingsUseReady) throw new Error('Owner guide did not open the selected Settings category.');
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Close settings"]')?.click()`);
    await sleep(260);
    // Capture the real new-tab surface separately from first-run onboarding.
    await win.webContents.executeJavaScript(`document.querySelector('.tour-progress button')?.click()`);
    await sleep(160);
    await saveCapture(win, path.join(qaDir, 'browsery-desktop.png'));
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Settings"]')?.click()`);
    await sleep(350);
    const settingsOpen = await win.webContents.executeJavaScript(`document.querySelector('.settings-drawer')?.classList.contains('open')`);
    await saveCapture(win, path.join(qaDir, 'browsery-desktop-settings.png'));
    const settingChanged = await win.webContents.executeJavaScript(`(() => {
      [...document.querySelectorAll('.settings-nav button')].find(node=>node.textContent.includes('Customize'))?.click();
      return true;
    })()`);
    await sleep(180);
    await win.webContents.executeJavaScript(`(() => {
      const selectRow=[...document.querySelectorAll('.setting-row')].find(node=>node.textContent.includes('Accent theme'));
      const select=selectRow?.querySelector('select');
      if(select){ const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(select,'Ultraviolet'); select.dispatchEvent(new Event('change',{bubbles:true})); }
      const rangeRow=[...document.querySelectorAll('.setting-range')].find(node=>node.textContent.includes('Background brightness'));
      const range=rangeRow?.querySelector('input');
      if(range){ const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(range,'24'); range.dispatchEvent(new Event('input',{bubbles:true})); range.dispatchEvent(new Event('change',{bubbles:true})); }
    })()`);
    await sleep(220);
    const appliedSettings = await win.webContents.executeJavaScript(`(() => { const saved=JSON.parse(localStorage.getItem('browsery:settings')); const root=getComputedStyle(document.documentElement); return { accentPreset:saved.accentPreset, backgroundBrightness:saved.backgroundBrightness, accentCss:root.getPropertyValue('--cyan').trim(), videoBrightness:root.getPropertyValue('--video-brightness').trim() }; })()`);
    await saveCapture(win, path.join(qaDir, 'browsery-desktop-customized.png'));
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Close settings"]')?.click()`);
    await win.webContents.executeJavaScript(`(() => { const input=document.querySelector('.home-search input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'spatial computing'); input.dispatchEvent(new Event('input',{bubbles:true})); input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); })()`);
    await sleep(7000);
    const navigatedUrl = await win.webContents.executeJavaScript(`document.querySelector('webview')?.getURL?.() || ''`);
    const resultTitle = await win.webContents.executeJavaScript(`document.querySelector('webview')?.getTitle?.() || ''`);
    await saveCapture(win, path.join(qaDir, 'browsery-desktop-search.png'));
    const result = { ...initial, launchVideo, guideInitial, extensionGuide, extensionUseReady, settingsGuide, settingsUseReady, settingsOpen, settingChanged, appliedSettings, navigatedUrl, resultTitle };
    fs.writeFileSync(path.join(qaDir, 'browsery-qa.json'), JSON.stringify(result, null, 2));
    console.log(`BROWSERY_QA ${JSON.stringify(result)}`);
  } catch (error) {
    console.error('BROWSERY_QA_FAILED', error);
    fs.writeFileSync(path.join(qaDir, 'browsery-qa-error.txt'), String(error?.stack || error));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

if (primaryInstance) app.whenReady().then(async () => {
  adblocker = createAdblocker({ statePath: path.join(app.getPath('userData'), 'adblock-allowlist.json') });
  // The updater publishes state changes to the trusted Browsery shell only.
  // The renderer also reads the current snapshot on mount, so no event is
  // missed while the launch sequence is on screen.
  const stopUpdateNotifications = appUpdates.subscribe(update => send('app-update:state', update));
  app.once('will-quit', stopUpdateNotifications);
  appUpdates.configure(app);
  // quitAndInstall closes windows before Electron's normal before-quit flow.
  // Skip the ordinary close warning while preserving the current profile for
  // the newly installed version.
  app.on('before-quit-for-update', () => {
    allowWindowClose = true;
    bypassCookiePurgeOnQuit = true;
  });
  // Rule updates happen off the startup path; the bundled/cached definitions
  // protect the first page even when the update service is unavailable.
  adblocker.refreshRules?.().catch(() => {});
  loadCompletedDownloads();
  loadClosedTabs();
  loadPermissionDecisions();
  loadCookiePurgeState();
  const trustedShell = event => event.sender === mainWindow?.webContents && event.senderFrame === mainWindow.webContents.mainFrame;
  const globalControlConfig = require('./global-control-config.json');
  const captcha = createCaptchaPrompt({
    session,
    BrowserWindow,
    siteKey: globalControlConfig.captchaSiteKey,
    host: globalControlConfig.captchaHost,
    getParent: () => mainWindow,
  });
  globalControl = createGlobalControl({ app, safeStorage, config: globalControlConfig, requestCaptcha: captcha.requestToken });
  globalControl.hydrate();
  // One-time owner provisioning is passed only to this Electron main process.
  // Persist it through safeStorage, then remove it before any renderer/webview
  // is created so it cannot be inherited by website content.
  const bootstrapAdminSecret = process.env.BROWSERY_ADMIN_SECRET;
  if (bootstrapAdminSecret) {
    delete process.env.BROWSERY_ADMIN_SECRET;
    const savedAdminSecret = globalControl.saveAdminSecret(bootstrapAdminSecret);
    if (!savedAdminSecret.ok) {
      console.error('Browsery could not securely provision the owner key:', savedAdminSecret.message);
      app.quit();
      return;
    }
    if (process.argv.includes('--provision-global-admin')) {
      app.quit();
      return;
    }
  }
  const publishGlobalState = state => {
    if (!state) return;
    // Keep the most recently received lock state if the service goes offline.
    // Otherwise a temporary network failure could turn a known shutdown into
    // an apparent "active" state and unlock browsing locally.
    remoteGlobalState = state.online
      ? state
      : { ...remoteGlobalState, ok: false, online: false, error: state.error || 'network-error' };
    send('global-control:state-changed', remoteGlobalState);
  };
  ipcMain.handle('global-control:status', event => trustedShell(event) ? { ...globalControl.status(), state: remoteGlobalState } : null);
  ipcMain.handle('global-control:state', async event => {
    if (!trustedShell(event)) return { ok: false, online: false, error: 'untrusted' };
    const state = await globalControl.globalState(); publishGlobalState(state); return remoteGlobalState;
  });
  ipcMain.handle('global-control:admin-secret:save', (event, secret) => trustedShell(event) ? globalControl.saveAdminSecret(secret) : { ok: false, message: 'Admin controls are only available from the installed Browsery app.' });
  ipcMain.handle('global-control:admin-secret:clear', event => trustedShell(event) ? globalControl.clearAdminSecret() : { ok: false });
  ipcMain.handle('global-control:admin-action', async (event, action) => {
    if (!trustedShell(event)) return { ok: false, message: 'Admin controls are only available from this Browsery installation.' };
    const result = await globalControl.adminAction(action);
    if (result.state) publishGlobalState(result.state);
    return result;
  });
  ipcMain.handle('global-control:account:signup', (event, credentials) => trustedShell(event) ? globalControl.accountSignUp(credentials?.email, credentials?.password) : { ok: false, message: 'Accounts are only available inside Browsery.' });
  ipcMain.handle('global-control:account:signin', (event, credentials) => trustedShell(event) ? globalControl.accountSignIn(credentials?.email, credentials?.password) : { ok: false, message: 'Accounts are only available inside Browsery.' });
  ipcMain.handle('global-control:account:status', event => trustedShell(event) ? globalControl.accountStatus() : { account: null });
  ipcMain.handle('global-control:account:signout', event => trustedShell(event) ? globalControl.accountSignOut() : { ok: false });
  const { createProtonController } = require('./proton-vpn.cjs');
  const proton = createProtonController({ helperPath: path.join(__dirname, 'native', 'Browsery.ProtonConnect.exe').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) });
  const deniedProtonAction = { ok: false, status: 'unavailable', message: 'Control Proton from Browsery’s VPN panel, not from a webpage.' };
  const deniedProtectionAction = { ok: false, message: 'Protection controls are only available from Browsery.' };
  const deniedProtectionStatus = { enabled: false, adblockEnabled: false, trackerMode: 'Standard', blockedCount: 0, adsBlocked: 0, trackersBlocked: 0, allowlisted: false, allowlistCount: 0, lastBlockedAt: null };
  ipcMain.handle('browser:closed-tab:remember', (event, tab) => trustedShell(event) ? rememberClosedTab(tab) : { ok: false, reason: 'untrusted' });
  ipcMain.handle('browser:closed-tab:reopen', event => trustedShell(event) ? { ok: true, tab: reopenClosedTab() } : { ok: false, tab: null });
  ipcMain.handle('browser:closed-tab:list', event => trustedShell(event) ? closedTabs.map(tab => ({ ...tab })) : []);
  ipcMain.handle('browser:closed-tab:clear', event => {
    if (!trustedShell(event)) return { ok: false };
    closedTabs = [];
    saveClosedTabs();
    return { ok: true };
  });
  ipcMain.handle('browser:predictive-preload', (event, { url, webContentsId } = {}) => {
    const guest = getBrowserGuestFromShell(event, webContentsId);
    return guest ? preconnect(guest.session, url) : { ok: false, status: 'invalid-tab' };
  });
  ipcMain.handle('browser:tab-activity', (event, payload) => updateTabSleepState(event, payload));
  ipcMain.handle('browser:permission-response', (event, { id, decision, remember } = {}) => {
    if (!trustedShell(event) || typeof id !== 'string' || !['allow', 'block'].includes(decision)) return { ok: false, reason: 'invalid-request' };
    return settlePermissionRequest(id, decision === 'allow', { remember: Boolean(remember) });
  });
  ipcMain.handle('browser:permissions:list', event => {
    if (!trustedShell(event)) return [];
    const result = [];
    for (const [key, decision] of permissionDecisions) {
      const [scope, origin, permission] = key.split('\n');
      if (scope === 'regular' && decision === 'allow') result.push({ origin, permission, decision });
    }
    return result;
  });
  ipcMain.handle('browser:permissions:clear', (event, { origin, permission } = {}) => {
    if (!trustedShell(event)) return { ok: false };
    const normalizedOrigin = normalizePermissionOrigin(origin);
    if (!normalizedOrigin || !interactivePermissions.has(permission)) return { ok: false, reason: 'invalid-permission' };
    permissionDecisions.delete(permissionDecisionKey('regular', normalizedOrigin, permission));
    savePermissionDecisions();
    return { ok: true };
  });
  ipcMain.handle('saved-logins:status', event => trustedShell(event)
    ? savedLogins.getStatus()
    : { encryptionAvailable: false, stored: false, storageStatus: 'unavailable', count: 0 });
  ipcMain.handle('saved-logins:list', event => trustedShell(event) ? savedLogins.listLogins() : []);
  ipcMain.handle('saved-logins:save', (event, login) => trustedShell(event)
    ? savedLogins.saveLogin(login)
    : { ok: false, message: 'Saved logins are only available from Browsery Settings.' });
  ipcMain.handle('saved-logins:delete', (event, id) => trustedShell(event)
    ? savedLogins.deleteLogin(id)
    : { ok: false, message: 'Saved logins are only available from Browsery Settings.' });
  ipcMain.handle('saved-logins:copy', (event, { id, kind } = {}) => {
    if (!trustedShell(event) || !['username', 'password'].includes(kind)) return { ok: false, message: 'Saved logins are only available from Browsery Settings.' };
    return savedLogins.copyLogin(id, kind);
  });
  ipcMain.handle('saved-logins:fill', async (event, { id, webContentsId } = {}) => {
    const guest = getBrowserGuestFromShell(event, webContentsId);
    if (!guest) return { ok: false, message: 'Open the matching website in Browsery before filling a saved login.' };
    return savedLogins.fillLogin(id, guest);
  });
  ipcMain.handle('browser:open-default-browser-settings', async event => {
    if (!trustedShell(event)) return { ok: false, message: 'Open default-browser settings from Browsery Settings.' };
    const destination = process.platform === 'win32'
      ? 'ms-settings:defaultapps'
      : process.platform === 'darwin'
        ? 'x-apple.systempreferences:com.apple.preference.general'
        : '';
    if (!destination) return { ok: false, message: 'Set your default browser from your system settings.' };
    try {
      await shell.openExternal(destination);
      return { ok: true, message: 'Opened your system browser settings. Browsery never changes your default browser automatically.' };
    } catch {
      return { ok: false, message: 'Could not open system browser settings. Open them from your device settings instead.' };
    }
  });
  ipcMain.handle('app-update:status', event => trustedShell(event) ? appUpdates.getStatus() : { status: 'unavailable', message: 'Updates are available only from Browsery Settings.' });
  ipcMain.handle('app-update:check', async event => trustedShell(event)
    ? appUpdates.checkForUpdates(app, { force: true })
    : { status: 'unavailable', message: 'Updates are available only from Browsery Settings.' });
  ipcMain.handle('app-update:download', async event => trustedShell(event)
    ? appUpdates.downloadUpdate(app)
    : { status: 'unavailable', message: 'Updates are available only from Browsery Settings.' });
  ipcMain.handle('app-update:install', event => {
    if (!trustedShell(event)) return { ok: false, status: 'unavailable', message: 'Updates are available only from Browsery Settings.' };
    // Prevent a close confirmation from interrupting an explicit update. The
    // updater has already downloaded and verified its release at this point.
    allowWindowClose = true;
    bypassCookiePurgeOnQuit = true;
    const result = appUpdates.installDownloadedUpdate(app);
    if (!result?.ok) {
      allowWindowClose = false;
      bypassCookiePurgeOnQuit = false;
    }
    return result;
  });
  ipcMain.handle('app-update:open-release', async event => {
    if (!trustedShell(event)) return { ok: false, message: 'Open updates from Browsery Settings.' };
    const update = appUpdates.getStatus();
    try {
      await shell.openExternal(update.releaseUrl || appUpdates.RELEASES_URL);
      return { ok: true, message: 'Opened Browsery’s official GitHub Releases page.' };
    } catch {
      return { ok: false, message: 'Could not open Browsery’s GitHub Releases page.' };
    }
  });
  ipcMain.handle('vpn:proton-status', event => trustedShell(event) ? proton.getStatus() : { installed: false, canConnect: false });
  ipcMain.handle('vpn:proton-open', event => trustedShell(event) ? proton.open() : deniedProtonAction);
  ipcMain.handle('vpn:proton-connect', event => trustedShell(event) ? proton.connect() : deniedProtonAction);
  ipcMain.handle('protection:status', (event, site) => trustedShell(event) ? adblocker.getStatus(browserPreferences, site) : deniedProtectionStatus);
  ipcMain.handle('protection:allow-site', (event, site) => trustedShell(event) ? adblocker.allowSite(site, browserPreferences) : deniedProtectionAction);
  ipcMain.handle('protection:remove-site', (event, site) => trustedShell(event) ? adblocker.removeAllowedSite(site, browserPreferences) : deniedProtectionAction);
  ipcMain.handle('protection:list-allowed-sites', event => trustedShell(event) ? { ok: true, sites: adblocker.listAllowedSites() } : deniedProtectionAction);
  ipcMain.handle('protection:reset-stats', event => trustedShell(event) ? { ok: true, ...adblocker.resetStats(browserPreferences) } : deniedProtectionAction);
  ipcMain.handle('protection:refresh-rules', async event => {
    if (!trustedShell(event)) return deniedProtectionAction;
    const result = await adblocker.refreshRules?.({ force: true });
    return { ...(result || { ok: false, status: 'unavailable' }), ...adblocker.getStatus(browserPreferences) };
  });
  ipcMain.handle('vpn:open-settings', async event => {
    if (!trustedShell(event)) return { ok: false, message: 'Open VPN settings from Browsery’s VPN panel.' };
    if (process.platform !== 'win32') return { ok: false, message: 'Windows VPN settings are only available on Windows.' };
    try {
      await shell.openExternal('ms-settings:network-vpn');
      return { ok: true };
    } catch {
      return { ok: false, message: 'Windows VPN settings could not open. Open Settings → Network & internet → VPN.' };
    }
  });
  ipcMain.handle('ai-key:status', event => trustedShell(event) ? getApiKeyStatus() : { configured: false, stored: false, encryptionAvailable: false, storageStatus: 'unavailable' });
  ipcMain.handle('ai-key:save', (event, key) => trustedShell(event) ? saveApiKey(key) : { ok: false, message: 'Credential changes are only available from Browsery Settings.' });
  ipcMain.handle('ai-key:clear', event => trustedShell(event) ? clearApiKey() : { ok: false, message: 'Credential changes are only available from Browsery Settings.' });
  ipcMain.handle('ai:voice-assistant', async (event, { prompt, model, context } = {}) => {
    if (!trustedShell(event)) return { status: 'request-failed' };
    if (typeof prompt !== 'string' || prompt.length > 2000) return { status: 'invalid-prompt' };
    // The optional Browsery-state summary is re-validated field by field and
    // capped to ~1500 characters by browsery-knowledge.cjs (in this process)
    // before it reaches Groq. An oversized or malformed object is dropped here
    // so it can never block the question itself.
    let rawContext = null;
    try {
      if (context && typeof context === 'object' && !Array.isArray(context) && JSON.stringify(context).length <= 16_000) rawContext = context;
    } catch { rawContext = null; }
    return createVoiceAssistantReply(prompt, { model, context: rawContext });
  });
  ipcMain.handle('ai:analyze-visible-page', async (event, { webContentsId } = {}) => {
    if (!trustedShell(event) || !Number.isSafeInteger(webContentsId)) return { status: 'request-failed' };
    const guest = webContents.fromId(webContentsId);
    if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' || guest.hostWebContents !== event.sender) return { status: 'request-failed' };
    const pageUrl = guest.getURL();
    if (!/^(?:https?:|browsery:)/i.test(pageUrl)) return { status: 'no-page' };
    if (guest.isLoading()) return { status: 'page-loading' };
    try {
      const captured = await guest.capturePage();
      if (captured.isEmpty()) return { status: 'invalid-image' };
      const { width } = captured.getSize();
      const image = width > 1280 ? captured.resize({ width: 1280, quality: 'good' }) : captured;
      return await analyzePageScreenshot(image.toJPEG(78));
    } catch (error) {
      console.warn('Browsery could not capture the active page:', error.name || 'capture error');
      return { status: 'invalid-image' };
    }
  });
  // Extension helpers. The renderer passes a tab id, never a path or URL, and
  // only Browsery's own shell frame may call these.
  ipcMain.handle('browser:capture-tab', async (event, { webContentsId } = {}) => {
    const guest = getBrowserGuestFromShell(event, webContentsId);
    if (!guest || guest.isLoading()) return { ok: false, status: guest ? 'page-loading' : 'no-page' };
    try {
      const image = await guest.capturePage();
      if (image.isEmpty()) return { ok: false, status: 'empty' };
      const { width, height } = image.getSize();
      return { ok: true, dataUrl: image.toDataURL(), width, height };
    } catch {
      return { ok: false, status: 'failed' };
    }
  });
  ipcMain.handle('clipboard:write-text', (event, text) => {
    if (!trustedShell(event) || typeof text !== 'string' || text.length > 1_000_000) return { ok: false };
    clipboard.writeText(text);
    return { ok: true };
  });
  ipcMain.handle('clipboard:write-image', (event, dataUrl) => {
    if (!trustedShell(event) || typeof dataUrl !== 'string' || dataUrl.length > 40_000_000 || !dataUrl.startsWith('data:image/png;base64,')) return { ok: false };
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return { ok: false };
    clipboard.writeImage(image);
    return { ok: true };
  });
  ipcMain.handle('downloads:list', event => trustedShell(event) ? completedDownloads.map(item => ({ ...item })) : []);
  ipcMain.handle('browser-data:list-cookies', async (event, partition) => {
    if (!trustedShell(event)) return [];
    const cookies = await browserDataSession(partition).cookies.get({});
    return cookies.map(cookie => cookieMetadata(cookie, partition)).sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
  });
  ipcMain.handle('browser-data:remove-cookie', async (event, { partition, name, domain, path: cookiePath } = {}) => {
    if (!trustedShell(event)) return { ok: false, removed: 0 };
    if (typeof name !== 'string' || typeof domain !== 'string') throw new Error('Choose a valid cookie.');
    const browserSession = browserDataSession(partition);
    const normalizedDomain = domain.toLowerCase();
    const matching = (await browserSession.cookies.get({ name })).filter(cookie => (cookie.domain || '').toLowerCase() === normalizedDomain && (cookie.path || '/') === (cookiePath || '/'));
    for (const cookie of matching) await browserSession.cookies.remove(cookieRemovalUrl(cookie), cookie.name);
    await browserSession.cookies.flushStore();
    return { ok: true, removed: matching.length };
  });
  ipcMain.handle('browser-data:clear', async (event, { partition, types } = {}) => {
    if (!trustedShell(event)) return { ok: false, cleared: [] };
    const browserSession = browserDataSession(partition);
    const requested = new Set(Array.isArray(types) ? types : []);
    const allowed = new Set(['cookies', 'siteData', 'cache', 'auth']);
    for (const type of requested) if (!allowed.has(type)) throw new Error('Unknown browser-data category.');
    const completed = [];
    if (requested.has('cookies')) {
      await clearSessionCookies(browserSession);
      if (partition === 'regular') {
        markCookiesPurged();
        scheduleCookiePurge();
      }
      completed.push('cookies');
    }
    const operations = [];
    if (requested.has('siteData')) operations.push(browserSession.clearStorageData({ storages: ['filesystem', 'indexdb', 'localstorage', 'shadercache', 'serviceworkers', 'cachestorage'] }).then(() => completed.push('siteData')));
    if (requested.has('cache')) operations.push(browserSession.clearCache().then(() => completed.push('cache')));
    if (requested.has('auth')) operations.push(browserSession.clearAuthCache().then(() => completed.push('auth')));
    await Promise.all(operations);
    return { ok: true, cleared: completed };
  });
  configureBrowserSession(session.fromPartition('persist:browsery'), { persistHistory: true });
  configureBrowserSession(session.fromPartition('browsery-private'), { persistHistory: false });
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setBackgroundThrottling(Boolean(browserPreferences.sleep));
    contents.setWindowOpenHandler(details => {
      if (/^(https?:|browsery:)/i.test(details.url)) {
        preconnect(contents.session, details.url);
        send('browser:new-tab', details.url);
      }
      return { action: 'deny' };
    });
    contents.on('will-navigate', (navigationEvent, destination) => {
      if (remoteGlobalState.mode !== 'active') { navigationEvent.preventDefault(); return; }
      preconnect(contents.session, destination);
    });
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      const key = input.key.toLowerCase();
      const mod = input.control || input.meta;
      let shortcut = null;
      if (mod && input.shift && key === 't') {
        event.preventDefault();
        // Let the shell choose the top item from its unified restore stack.
        // That preserves recently closed blank tabs alongside native web tabs.
        send('browser:shortcut', 'reopen-tab');
        return;
      }
      else if (mod && key === 'l') shortcut = 'focus';
      else if (mod && key === 't') shortcut = 'new-tab';
      else if (mod && key === 'w') shortcut = 'close-tab';
      else if (mod && key === 'r') shortcut = 'reload';
      else if (mod && key === 'f') shortcut = 'find';
      else if (mod && key === 'h') shortcut = 'history';
      else if (mod && key === 'j') shortcut = 'downloads';
      else if (mod && key === 'd') shortcut = 'bookmark';
      else if (mod && input.shift && key === 'b') shortcut = 'bookmarks';
      else if (mod && ['+', '='].includes(key)) shortcut = 'zoom-in';
      else if (mod && key === '-') shortcut = 'zoom-out';
      else if (mod && key === '0') shortcut = 'zoom-reset';
      else if (input.alt && key === 'arrowleft') shortcut = 'back';
      else if (input.alt && key === 'arrowright') shortcut = 'forward';
      if (shortcut) { event.preventDefault(); send('browser:shortcut', shortcut); }
    });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  attachDownloadManager(session.defaultSession);
  scheduleCookiePurge();
  // This check is intentionally delayed and silent. Browsery never downloads
  // or installs an update until its owner explicitly chooses the Update button.
  const backgroundUpdateCheck = setTimeout(() => appUpdates.checkForUpdates(app).catch(() => {}), 10_000);
  backgroundUpdateCheck.unref?.();
  app.on('before-quit', event => {
    saveCompletedDownloads();
    saveBrowserPreferences();
    if (bypassCookiePurgeOnQuit || cookiePurgePreference !== 'On close') return;
    event.preventDefault();
    bypassCookiePurgeOnQuit = true;
    purgeRegularCookies().catch(error => console.warn('Browsery could not clear cookies on exit:', error.code || error.name)).finally(() => app.quit());
  });

  const syncGlobalControl = async () => {
    if (!globalControl) return;
    const state = await globalControl.globalState();
    publishGlobalState(state);
  };
  syncGlobalControl().catch(() => {});
  const globalControlTimer = setInterval(() => syncGlobalControl().catch(() => {}), 15_000);
  globalControlTimer.unref?.();
  app.once('will-quit', () => clearInterval(globalControlTimer));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

ipcMain.on('window:action', (event, action) => {
  if (!isTrustedShell(event) || !mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  if (action === 'close') mainWindow.close();
});

ipcMain.on('download:command', (event, { id, action } = {}) => {
  if (!isTrustedShell(event) || typeof id !== 'string') return;
  const item = activeDownloads.get(id);
  // Never trust a renderer-supplied file path. Resolve the requested transfer
  // from the live manager or Browsery's own persisted history instead.
  if (action === 'open') {
    const historical = completedDownloads.find(download => download.id === id);
    const downloadPath = item?.getSavePath?.() || historical?.savePath;
    if (typeof downloadPath === 'string' && path.isAbsolute(downloadPath) && fs.existsSync(downloadPath)) shell.showItemInFolder(downloadPath);
    return;
  }
  if (!item) return;
  if (action === 'pause') item.pause();
  if (action === 'resume') item.resume();
  if (action === 'cancel') item.cancel();
});

ipcMain.on('settings:update', (event, settings) => {
  if (!isTrustedShell(event)) return;
  if (typeof settings?.cookies === 'string') updateCookiePurgePreference(settings.cookies);
  const previousDoh = browserPreferences.doh;
  browserPreferences = normalizeBrowserPreferences({
    ...browserPreferences,
    ...(settings && typeof settings === 'object' ? settings : {}),
    downloadPath: typeof settings?.path === 'string' ? settings.path : browserPreferences.downloadPath,
  });
  scheduleBrowserPreferencesSave();
  for (const partition of ['persist:browsery', 'browsery-private']) {
    try {
      const browserSession = session.fromPartition(partition);
      browserSession.__browseryApplyWebRtcPolicy?.();
      browserSession.__browseryApplySleepingTabsPolicy?.();
    } catch {}
  }
  if (previousDoh !== browserPreferences.doh) {
    send('browser:settings-applied', {
      dnsOverHttps: browserPreferences.doh,
      restartRequired: true,
      message: browserPreferences.doh
        ? 'DNS over HTTPS will use Cloudflare after Browsery restarts.'
        : 'DNS over HTTPS will turn off after Browsery restarts.',
    });
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
