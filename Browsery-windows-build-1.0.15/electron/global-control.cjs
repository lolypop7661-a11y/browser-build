const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTROL_FUNCTION = 'browsery-global-control';
const MAX_RESPONSE_BYTES = 1_000_000;

function createGlobalControl({ app, safeStorage, config }) {
  const dataPath = name => path.join(app.getPath('userData'), name);
  const normalizeConfig = value => {
    try {
      const url = new URL(value?.supabaseUrl || '');
      const anonKey = typeof value?.supabaseAnonKey === 'string' ? value.supabaseAnonKey.trim() : '';
      if (url.protocol !== 'https:' || !url.hostname || !anonKey || /placeholder|YOUR_/i.test(anonKey)) return null;
      return { url: url.origin, anonKey };
    } catch { return null; }
  };
  const service = normalizeConfig(config);
  let adminBundle = null;
  let deviceId = '';
  let session = null;

  function readEncrypted(file) {
    if (!safeStorage?.isEncryptionAvailable?.()) return null;
    try {
      const buffer = fs.readFileSync(dataPath(file));
      return JSON.parse(safeStorage.decryptString(buffer));
    } catch { return null; }
  }

  function writeEncrypted(file, value) {
    if (!safeStorage?.isEncryptionAvailable?.()) return false;
    try {
      const target = dataPath(file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(value)));
      fs.renameSync(temporary, target);
      return true;
    } catch { return false; }
  }

  function deleteStored(file) {
    try { fs.rmSync(dataPath(file), { force: true }); } catch {}
  }

  const request = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9_000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('response-too-large');
      let payload;
      try { payload = text ? JSON.parse(text) : {}; } catch { throw new Error('invalid-response'); }
      if (!response.ok) throw new Error(payload?.message || payload?.error_description || payload?.error || `http-${response.status}`);
      return payload;
    } finally { clearTimeout(timeout); }
  };

  const headers = extra => ({ apikey: service.anonKey, 'Content-Type': 'application/json', ...extra });
  const authUrl = route => `${service.url}/auth/v1/${route}`;
  const functionUrl = `${service?.url || ''}/functions/v1/${CONTROL_FUNCTION}`;

  function hydrate() {
    adminBundle = readEncrypted('browsery-global-admin.bin');
    if (!adminBundle || typeof adminBundle.secret !== 'string') adminBundle = null;
    try { deviceId = fs.readFileSync(dataPath('browsery-global-device-id.txt'), 'utf8').trim(); } catch { deviceId = ''; }
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) {
      deviceId = crypto.randomUUID();
      try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(dataPath('browsery-global-device-id.txt'), deviceId); }
      catch { deviceId = ''; }
    }
    session = readEncrypted('browsery-account.bin');
    if (!session || typeof session.refresh_token !== 'string' || !session.user?.id) session = null;
  }

  function publicUser(user) {
    return user && typeof user.id === 'string' ? { id: user.id, email: typeof user.email === 'string' ? user.email : '', createdAt: user.created_at || null } : null;
  }

  async function refreshSession() {
    if (!service || !session?.refresh_token) return null;
    try {
      const refreshed = await request(authUrl('token?grant_type=refresh_token'), { method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: session.refresh_token }) });
      session = { ...refreshed, expires_at: Date.now() + (Number(refreshed.expires_in) || 3600) * 1000 };
      if (!writeEncrypted('browsery-account.bin', session)) { session = null; deleteStored('browsery-account.bin'); return null; }
      return session;
    } catch { session = null; deleteStored('browsery-account.bin'); return null; }
  }

  return {
    hydrate,
    status() {
      return { configured: Boolean(service), secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()), adminReady: Boolean(adminBundle?.secret), account: publicUser(session?.user) };
    },
    async globalState() {
      if (!service) return { ok: false, online: false, mode: 'active', message: '', announcements: [], error: 'not-configured' };
      try {
        const payload = await request(functionUrl, { headers: headers({ Accept: 'application/json' }) });
        const announcements = Array.isArray(payload.announcements) ? payload.announcements.slice(0, 50).map(item => ({ id: String(item.id || ''), title: String(item.title || '').slice(0, 100), body: String(item.body || '').slice(0, 1200), createdAt: item.created_at || null })) : [];
        return { ok: true, online: true, mode: ['active', 'maintenance', 'shutdown'].includes(payload.mode) ? payload.mode : 'active', message: String(payload.message || '').slice(0, 500), updatedAt: payload.updatedAt || payload.updated_at || null, announcements, policy: payload.policy || {} };
      } catch (error) { return { ok: false, online: false, mode: 'active', message: '', announcements: [], error: String(error.message || 'network-error').slice(0, 120) }; }
    },
    saveAdminSecret(secret) {
      const clean = typeof secret === 'string' ? secret.trim() : '';
      if (!service) return { ok: false, message: 'The shared service is not configured in this Browsery build yet.' };
      if (!safeStorage?.isEncryptionAvailable?.()) return { ok: false, message: 'Windows secure storage is unavailable, so the admin key will not be stored.' };
      if (clean.length < 32 || clean.length > 512) return { ok: false, message: 'Use the 32-character-or-longer secret configured on the Supabase server.' };
      adminBundle = { secret: clean };
      if (!writeEncrypted('browsery-global-admin.bin', adminBundle)) { adminBundle = null; return { ok: false, message: 'Could not securely save the admin key on this computer.' }; }
      return { ok: true };
    },
    clearAdminSecret() { adminBundle = null; deleteStored('browsery-global-admin.bin'); return { ok: true }; },
    async adminAction(payload) {
      if (!service) return { ok: false, message: 'The shared service is not configured in this Browsery build yet.' };
      if (!adminBundle?.secret) return { ok: false, message: 'Save the Supabase admin secret on this computer first.' };
      try {
        const result = await request(functionUrl, {
          method: 'POST',
          headers: headers({ 'x-browsery-admin': adminBundle.secret, 'x-browsery-device': deviceId }),
          body: JSON.stringify(payload),
        });
        return { ok: true, ...result, state: { ok: true, online: true, mode: result.mode, message: result.message || '', updatedAt: result.updatedAt || result.updated_at || null, announcements: Array.isArray(result.announcements) ? result.announcements.map(item => ({ id: String(item.id), title: String(item.title), body: String(item.body), createdAt: item.created_at || null })) : [], policy: result.policy || {} } };
      } catch (error) {
        const details = String(error.message || 'request-failed');
        const message = details.includes('admin_not_authorized') ? 'This computer is not paired as the Browsery admin device, or the server secret is incorrect.' : details.includes('Failed to fetch') ? 'Could not reach the shared service. Check your connection.' : 'The shared admin request failed. Check the Supabase function and server secret.';
        return { ok: false, message };
      }
    },
    async accountSignUp(email, password) {
      if (!service) return { ok: false, message: 'Accounts are not available until the shared service is configured.' };
      const cleanEmail = String(email || '').trim().slice(0, 254);
      if (!cleanEmail || typeof password !== 'string' || password.length < 10 || password.length > 256) return { ok: false, message: 'Enter a valid email and a password with at least 10 characters.' };
      try {
        const policy = await request(`${functionUrl}?action=signup-policy`, { headers: headers({ Accept: 'application/json' }) });
        if (policy.signupsEnabled === false) return { ok: false, message: 'New Browsery accounts are temporarily paused.' };
        const result = await request(authUrl('signup'), { method: 'POST', headers: headers(), body: JSON.stringify({ email: cleanEmail, password }) });
        if (result.access_token && result.refresh_token && result.user) {
          session = { ...result, expires_at: Date.now() + (Number(result.expires_in) || 3600) * 1000 };
          if (!writeEncrypted('browsery-account.bin', session)) { session = null; return { ok: false, message: 'Windows secure storage is unavailable, so Browsery will not keep this account signed in.' }; }
        }
        return { ok: true, account: publicUser(result.user), confirmationRequired: !result.access_token, message: result.access_token ? 'Browsery account created and signed in.' : 'Account created. Check your email to confirm it before signing in.' };
      } catch { return { ok: false, message: 'Could not create the account. Check the email, password rules, and Supabase Auth settings.' }; }
    },
    async accountSignIn(email, password) {
      if (!service) return { ok: false, message: 'Accounts are not available until the shared service is configured.' };
      const cleanEmail = String(email || '').trim().slice(0, 254);
      if (!cleanEmail || typeof password !== 'string' || password.length < 1 || password.length > 256) return { ok: false, message: 'Enter your email and password.' };
      try {
        const result = await request(authUrl('token?grant_type=password'), { method: 'POST', headers: headers(), body: JSON.stringify({ email: cleanEmail, password }) });
        session = { ...result, expires_at: Date.now() + (Number(result.expires_in) || 3600) * 1000 };
        if (!writeEncrypted('browsery-account.bin', session)) { session = null; return { ok: false, message: 'Windows secure storage is unavailable, so Browsery will not keep this account signed in.' }; }
        return { ok: true, account: publicUser(session.user), message: 'Signed in to your Browsery account.' };
      } catch { return { ok: false, message: 'Email or password was not accepted. Confirm your email and try again.' }; }
    },
    async accountStatus() {
      if (!session) return { account: null, secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()) };
      if (!service) return { account: publicUser(session.user), secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()) };
      if ((Number(session.expires_at) || 0) < Date.now() + 60_000) await refreshSession();
      return { account: publicUser(session?.user), secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()) };
    },
    async accountSignOut() {
      const accessToken = session?.access_token;
      session = null;
      deleteStored('browsery-account.bin');
      if (service && accessToken) request(authUrl('logout'), { method: 'POST', headers: headers({ Authorization: `Bearer ${accessToken}` }) }).catch(() => {});
      return { ok: true };
    },
  };
}

module.exports = { createGlobalControl };
