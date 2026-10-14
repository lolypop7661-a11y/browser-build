const { app, safeStorage, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

// Browsery deliberately keeps saved logins separate from browser cookies and
// never reads form fields from a webpage. A person must open the local manager
// and save each login themselves. The renderer only receives metadata; a
// password is either copied or filled by this trusted main-process module.
const STORE_VERSION = 1;
const STORE_NAME = 'saved-logins.bin';
const MAX_ENTRIES = 500;
const MAX_USERNAME_LENGTH = 512;
const MAX_PASSWORD_LENGTH = 4096;
let passwordClipboardTimer = null;

function storePath() {
  return path.join(app.getPath('userData'), STORE_NAME);
}

function encryptionAvailable() {
  try { return safeStorage.isEncryptionAvailable(); }
  catch { return false; }
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || value.trim().length > 2048) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    return url.origin;
  } catch { return ''; }
}

function normalizeEntry(value) {
  const origin = normalizeOrigin(value?.origin);
  const username = typeof value?.username === 'string' ? value.username.trim().slice(0, MAX_USERNAME_LENGTH) : '';
  const password = typeof value?.password === 'string' ? value.password.slice(0, MAX_PASSWORD_LENGTH) : '';
  const id = typeof value?.id === 'string' && /^[a-zA-Z0-9-]{8,120}$/.test(value.id) ? value.id : randomUUID();
  const createdAt = Number.isFinite(value?.createdAt) && value.createdAt > 0 ? value.createdAt : Date.now();
  const updatedAt = Number.isFinite(value?.updatedAt) && value.updatedAt > 0 ? value.updatedAt : createdAt;
  if (!origin || !username || !password) return null;
  return { id, origin, username, password, createdAt, updatedAt };
}

function readStore() {
  const stored = fs.existsSync(storePath());
  const unavailable = !encryptionAvailable();
  if (unavailable || !stored) return { entries: [], stored, status: unavailable ? 'unavailable' : 'missing' };
  try {
    const decoded = safeStorage.decryptString(fs.readFileSync(storePath()));
    const parsed = JSON.parse(decoded);
    if (parsed?.version !== STORE_VERSION || !Array.isArray(parsed.entries)) throw new Error('Unsupported credentials store');
    const entries = parsed.entries.map(normalizeEntry).filter(Boolean).slice(0, MAX_ENTRIES);
    return { entries, stored: true, status: 'saved' };
  } catch {
    return { entries: [], stored: true, status: 'unreadable' };
  }
}

function metadata(entry) {
  return {
    id: entry.id,
    origin: entry.origin,
    username: entry.username,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function writeStore(entries) {
  if (!encryptionAvailable()) return { ok: false, message: 'OS-backed secure storage is unavailable on this device.' };
  const normalized = entries.map(normalizeEntry).filter(Boolean).slice(0, MAX_ENTRIES);
  const target = storePath();
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const encrypted = safeStorage.encryptString(JSON.stringify({ version: STORE_VERSION, entries: normalized }));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
    // Verify the bytes before replacing the previous encrypted store.
    const check = JSON.parse(safeStorage.decryptString(fs.readFileSync(temporary)));
    if (check?.version !== STORE_VERSION || !Array.isArray(check.entries)) throw new Error('Credential verification failed');
    fs.renameSync(temporary, target);
    return { ok: true, entries: normalized };
  } catch {
    return { ok: false, message: 'Browsery could not securely save this login.' };
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function getStatus() {
  const state = readStore();
  return {
    encryptionAvailable: encryptionAvailable(),
    stored: state.stored,
    storageStatus: state.status,
    count: state.entries.length,
  };
}

function listLogins() {
  const state = readStore();
  return state.entries
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(metadata);
}

function saveLogin(value) {
  const entry = normalizeEntry({ ...value, id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now() });
  if (!entry) return { ok: false, message: 'Enter a valid http(s) site, username, and password.' };
  const current = readStore();
  if (current.status === 'unreadable') return { ok: false, message: 'Browsery cannot read the existing encrypted logins. Remove that store before saving a new login.' };
  const existing = current.entries.find(item => item.origin === entry.origin && item.username === entry.username);
  const entries = existing
    ? current.entries.map(item => item.id === existing.id ? { ...entry, id: existing.id, createdAt: existing.createdAt } : item)
    : [entry, ...current.entries];
  if (!existing && current.entries.length >= MAX_ENTRIES) return { ok: false, message: 'Browsery has reached its 500 saved-login limit.' };
  const result = writeStore(entries);
  return result.ok ? { ok: true, login: metadata(existing ? { ...entry, id: existing.id, createdAt: existing.createdAt } : entry) } : result;
}

function deleteLogin(id) {
  if (typeof id !== 'string') return { ok: false, message: 'Choose a saved login.' };
  const current = readStore();
  if (current.status === 'unreadable') return { ok: false, message: 'Browsery cannot read the encrypted logins.' };
  const entries = current.entries.filter(entry => entry.id !== id);
  if (entries.length === current.entries.length) return { ok: false, message: 'That saved login was already removed.' };
  const result = writeStore(entries);
  return result.ok ? { ok: true } : result;
}

function findLogin(id) {
  if (typeof id !== 'string') return null;
  return readStore().entries.find(entry => entry.id === id) || null;
}

function copyLogin(id, kind) {
  const login = findLogin(id);
  if (!login) return { ok: false, message: 'That saved login is unavailable.' };
  const value = kind === 'password' ? login.password : login.username;
  try {
    clipboard.writeText(value);
    if (kind === 'password') {
      if (passwordClipboardTimer) clearTimeout(passwordClipboardTimer);
      passwordClipboardTimer = setTimeout(() => {
        // Do not erase something the person copied after the password.
        try { if (clipboard.readText() === value) clipboard.clear(); } catch {}
      }, 60_000);
      passwordClipboardTimer.unref?.();
      return { ok: true, message: 'Password copied. Browsery clears it from the clipboard after one minute if it is unchanged.' };
    }
    return { ok: true, message: 'Username copied.' };
  } catch {
    return { ok: false, message: 'Browsery could not write to the clipboard.' };
  }
}

function fillScript(login) {
  // The account values are inserted only into the selected, already-open
  // guest page. The script contains no renderer-supplied JavaScript.
  const payload = JSON.stringify({ username: login.username, password: login.password });
  return `(() => {
    const login = ${payload};
    const visible = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.disabled && !element.readOnly && element.type !== 'hidden' && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const inputs = [...document.querySelectorAll('input')].filter(visible);
    const password = inputs.find(input => (input.type || '').toLowerCase() === 'password');
    const username = inputs.find(input => {
      const type = (input.type || 'text').toLowerCase();
      const hint = [input.autocomplete, input.name, input.id, input.getAttribute('aria-label'), input.placeholder].filter(Boolean).join(' ').toLowerCase();
      return input !== password && ['text', 'email', 'tel', ''].includes(type) && (/username|user|email|login|account/.test(hint) || input.autocomplete === 'username');
    }) || inputs.find(input => input !== password && ['text', 'email', 'tel', ''].includes((input.type || 'text').toLowerCase()));
    const setValue = (input, value) => {
      if (!input) return false;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    };
    return { username: setValue(username, login.username), password: setValue(password, login.password) };
  })()`;
}

async function fillLogin(id, contents) {
  const login = findLogin(id);
  if (!login) return { ok: false, message: 'That saved login is unavailable.' };
  if (!contents || contents.isDestroyed?.()) return { ok: false, message: 'Open the matching website before filling a saved login.' };
  if (normalizeOrigin(contents.getURL()) !== login.origin) return { ok: false, message: `Open ${login.origin} before filling this saved login.` };
  try {
    const result = await contents.executeJavaScript(fillScript(login), true);
    if (!result?.username && !result?.password) return { ok: false, message: 'Browsery could not find a visible sign-in form on this page.' };
    return { ok: true, filled: result };
  } catch {
    return { ok: false, message: 'Browsery could not fill this page. Reload it and try again.' };
  }
}

module.exports = { getStatus, listLogins, saveLogin, deleteLogin, copyLogin, fillLogin, normalizeOrigin };
