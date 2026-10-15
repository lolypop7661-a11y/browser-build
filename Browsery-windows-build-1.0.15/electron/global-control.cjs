const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTROL_FUNCTION = 'browsery-global-control';
const MAX_RESPONSE_BYTES = 1_000_000;

function createGlobalControl({ app, safeStorage, config, requestCaptcha }) {
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
  // Server-verified: true only when the signed-in account is listed in BROWSERY_OWNER_USER_IDS.
  let ownerAccount = { userId: '', owner: false, checkedAt: 0 };

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
      if (!response.ok) {
        const detail = payload?.msg || payload?.message || payload?.error_description || payload?.error || '';
        throw new Error([payload?.error_code, detail].filter(Boolean).join(': ') || `http-${response.status}`);
      }
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

  // Supabase Auth verifies this token server-side when CAPTCHA protection is
  // enabled, so the public sign-up endpoint cannot simply skip the check.
  async function captchaSecurity() {
    if (typeof requestCaptcha !== 'function') return {};
    const result = await requestCaptcha();
    if (result?.status === 'not-configured') return {};
    if (result?.status !== 'ready' || typeof result.token !== 'string') {
      const error = new Error('captcha-cancelled');
      error.code = 'captcha-cancelled';
      throw error;
    }
    return { gotrue_meta_security: { captcha_token: result.token } };
  }

  function accountFailure(error, fallback) {
    const details = String(error?.message || '').toLowerCase();
    if (error?.code === 'captcha-cancelled') return 'The human check was closed before it finished. Try again when you are ready.';
    if (details.includes('captcha')) return 'The human check was not accepted. Please try again.';
    if (details.includes('user_already_exists') || details.includes('already registered')) return 'An account with this email already exists. Sign in instead.';
    if (details.includes('weak_password')) return 'Choose a stronger password with at least 10 characters.';
    if (details.includes('email_address_invalid') || details.includes('validation_failed')) return 'Enter a valid email address.';
    if (details.includes('email_not_confirmed')) return 'This older account was never confirmed. Ask the Browsery owner to confirm it, or create a new account.';
    if (details.includes('rate_limit') || details.includes('http-429')) return 'Too many attempts. Wait a minute and try again.';
    if (error?.name === 'AbortError' || details.includes('fetch failed')) return 'Could not reach Browsery accounts. Check your connection and try again.';
    return fallback;
  }

  // Password-recovery errors. The reset code is a one-time token from the
  // Supabase "Reset password" email ({{ .Token }}), so no redirect URL is used.
  function recoveryFailure(error, fallback) {
    const details = String(error?.message || '').toLowerCase();
    if (details.includes('otp_expired') || details.includes('expired or is invalid') || details.includes('invalid otp') || details.includes('otp_disabled')) return 'That code is invalid or has expired. Request a new code and try again.';
    if (details.includes('same_password') || details.includes('different from the old')) return 'Choose a new password that is different from your old one.';
    if (details.includes('user_banned')) return 'This account cannot be recovered right now. Contact the Browsery owner.';
    if (details.includes('reauthentication')) return 'Supabase asked for an extra confirmation. Request a new code and try again.';
    return accountFailure(error, fallback);
  }

  // Support-ticket errors returned by the browsery-global-control function.
  function supportFailure(error) {
    const details = String(error?.message || '').toLowerCase();
    if (details.includes('support_ticket_limit')) return 'You can open up to 5 tickets a day. Reply to an existing ticket, or try again tomorrow.';
    if (details.includes('support_message_limit')) return 'You have sent a lot of messages in the last hour. Please wait a little before replying again.';
    if (details.includes('user_not_authenticated')) return 'Your Browsery session expired. Sign out and sign in again, then retry.';
    if (details.includes('user_banned')) return 'This account cannot contact support right now.';
    if (details.includes('ticket_not_found')) return 'That ticket no longer exists.';
    if (details.includes('ticket_closed')) return 'This ticket is closed. Open a new ticket if you still need help.';
    if (details.includes('subject_') || details.includes('body_') || details.includes('invalid_')) return 'Check the subject (up to 120 characters) and message (up to 4,000 characters), then try again.';
    if (details.includes('unknown_action') || details.includes('http-404')) return 'Support is not set up on the Browsery server yet. Please try again later.';
    if (error?.name === 'AbortError' || details.includes('fetch failed')) return 'Could not reach Browsery support. Check your connection and try again.';
    return 'Browsery support could not complete that request. Try again in a moment.';
  }

  const cleanTicketText = (value, max) => String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
  const cleanTicket = ticket => ({
    id: String(ticket?.id || ''),
    category: String(ticket?.category || 'other'),
    subject: cleanTicketText(ticket?.subject, 120),
    body: cleanTicketText(ticket?.body, 4000),
    status: ['open', 'answered', 'closed'].includes(ticket?.status) ? ticket.status : 'open',
    email: cleanTicketText(ticket?.email, 254),
    appVersion: cleanTicketText(ticket?.appVersion, 32),
    platform: cleanTicketText(ticket?.platform, 40),
    createdAt: ticket?.createdAt || null,
    updatedAt: ticket?.updatedAt || null,
    messages: Array.isArray(ticket?.messages) ? ticket.messages.slice(0, 200).map(message => ({ id: String(message?.id || ''), author: message?.author === 'owner' ? 'owner' : 'user', body: cleanTicketText(message?.body, 4000), createdAt: message?.createdAt || null })) : [],
  });

  // Support requests are authenticated by the signed-in user's own session.
  async function supportRequest(payload) {
    if (!service) return { ok: false, message: 'Support is not available until the shared service is configured.' };
    const token = await freshAccessToken();
    if (!token) return { ok: false, message: 'Sign in to your Browsery account to contact support.' };
    try {
      const result = await request(functionUrl, { method: 'POST', headers: headers({ 'x-browsery-user': token }), body: JSON.stringify(payload) });
      return { ok: true, tickets: Array.isArray(result?.tickets) ? result.tickets.slice(0, 50).map(cleanTicket) : [], ticketId: typeof result?.ticketId === 'string' ? result.ticketId : '' };
    } catch (error) { return { ok: false, message: supportFailure(error) }; }
  }

  function storeSession(result) {
    session = { ...result, expires_at: Date.now() + (Number(result.expires_in) || 3600) * 1000 };
    ownerAccount = { userId: '', owner: false, checkedAt: 0 };
    if (!writeEncrypted('browsery-account.bin', session)) { session = null; return false; }
    return true;
  }

  // A verified recovery session is kept in memory for a few minutes so a
  // rejected new password can be retried without spending another code.
  let recovery = null;

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

  async function freshAccessToken() {
    if (!service || !session) return '';
    if ((Number(session.expires_at) || 0) < Date.now() + 60_000) await refreshSession();
    return typeof session?.access_token === 'string' ? session.access_token : '';
  }

  // Asks the server whether the signed-in account is a Browsery owner. Cached for
  // five minutes per account; a network failure keeps the last verified answer.
  async function checkOwnerAccount(force = false) {
    const userId = session?.user?.id || '';
    if (!service || !userId) { ownerAccount = { userId: '', owner: false, checkedAt: 0 }; return false; }
    if (!force && ownerAccount.userId === userId && Date.now() - ownerAccount.checkedAt < 300_000) return ownerAccount.owner;
    const keep = ownerAccount.userId === userId ? ownerAccount.owner : false;
    try {
      const token = await freshAccessToken();
      if (!token) { ownerAccount = { userId: '', owner: false, checkedAt: 0 }; return false; }
      const result = await request(`${functionUrl}?action=owner-status`, { headers: headers({ Accept: 'application/json', 'x-browsery-user': token }) });
      ownerAccount = { userId, owner: result?.owner === true, checkedAt: Date.now() };
    } catch { ownerAccount = { userId, owner: keep, checkedAt: 0 }; }
    return ownerAccount.owner;
  }

  const isOwnerAccount = () => Boolean(session?.user?.id) && ownerAccount.userId === session.user.id && ownerAccount.owner;

  return {
    hydrate,
    checkOwnerAccount,
    status() {
      const ownerByAccount = isOwnerAccount();
      return { configured: Boolean(service), secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()), adminReady: Boolean(adminBundle?.secret) || ownerByAccount, ownerKey: Boolean(adminBundle?.secret), ownerAccount: ownerByAccount, account: publicUser(session?.user) };
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
      const userToken = isOwnerAccount() ? await freshAccessToken() : '';
      if (!adminBundle?.secret && !userToken) return { ok: false, message: 'Sign in with your Browsery owner account, or save the Supabase admin secret on this computer first.' };
      try {
        const authHeaders = { ...(adminBundle?.secret ? { 'x-browsery-admin': adminBundle.secret, 'x-browsery-device': deviceId } : {}), ...(userToken ? { 'x-browsery-user': userToken } : {}) };
        const result = await request(functionUrl, {
          method: 'POST',
          headers: headers(authHeaders),
          body: JSON.stringify(payload),
        });
        return { ok: true, ...result, state: { ok: true, online: true, mode: result.mode, message: result.message || '', updatedAt: result.updatedAt || result.updated_at || null, announcements: Array.isArray(result.announcements) ? result.announcements.map(item => ({ id: String(item.id), title: String(item.title), body: String(item.body), createdAt: item.created_at || null })) : [], policy: result.policy || {} } };
      } catch (error) {
        const details = String(error.message || 'request-failed');
        const message = details.includes('admin_not_authorized') ? 'Owner access was refused. Check that your account ID is in BROWSERY_OWNER_USER_IDS on the server, or that this computer holds the paired admin key.' : details.includes('Failed to fetch') ? 'Could not reach the shared service. Check your connection.' : 'The shared admin request failed. Check the Supabase function and server secret.';
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
        const security = await captchaSecurity();
        const result = await request(authUrl('signup'), { method: 'POST', headers: headers(), body: JSON.stringify({ email: cleanEmail, password, ...security }) });
        if (result.access_token && result.refresh_token && result.user) {
          session = { ...result, expires_at: Date.now() + (Number(result.expires_in) || 3600) * 1000 };
          if (!writeEncrypted('browsery-account.bin', session)) { session = null; return { ok: false, message: 'Windows secure storage is unavailable, so Browsery will not keep this account signed in.' }; }
        }
        return { ok: true, account: publicUser(result.user), confirmationRequired: !result.access_token, message: result.access_token ? 'Browsery account created and signed in.' : 'Account created. Check your email to confirm it before signing in.' };
      } catch (error) { return { ok: false, message: accountFailure(error, 'Could not create the account. Check the email and password, then try again.') }; }
    },
    async accountSignIn(email, password) {
      if (!service) return { ok: false, message: 'Accounts are not available until the shared service is configured.' };
      const cleanEmail = String(email || '').trim().slice(0, 254);
      if (!cleanEmail || typeof password !== 'string' || password.length < 1 || password.length > 256) return { ok: false, message: 'Enter your email and password.' };
      try {
        const security = await captchaSecurity();
        const result = await request(authUrl('token?grant_type=password'), { method: 'POST', headers: headers(), body: JSON.stringify({ email: cleanEmail, password, ...security }) });
        session = { ...result, expires_at: Date.now() + (Number(result.expires_in) || 3600) * 1000 };
        if (!writeEncrypted('browsery-account.bin', session)) { session = null; return { ok: false, message: 'Windows secure storage is unavailable, so Browsery will not keep this account signed in.' }; }
        return { ok: true, account: publicUser(session.user), message: 'Signed in to your Browsery account.' };
      } catch (error) { return { ok: false, message: accountFailure(error, 'Email or password was not accepted. Try again.') }; }
    },
    // Step 1 of password recovery: Supabase emails a one-time code. The answer is
    // the same whether or not the account exists, so emails cannot be probed.
    async accountRecover(email) {
      if (!service) return { ok: false, message: 'Accounts are not available until the shared service is configured.' };
      const cleanEmail = String(email || '').trim().slice(0, 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, message: 'Enter the email address of your Browsery account.' };
      try {
        const security = await captchaSecurity();
        await request(authUrl('recover'), { method: 'POST', headers: headers(), body: JSON.stringify({ email: cleanEmail, ...security }) });
      } catch (error) {
        const details = String(error?.message || '').toLowerCase();
        const visible = error?.code === 'captcha-cancelled' || details.includes('captcha') || details.includes('rate_limit') || details.includes('http-429') || error?.name === 'AbortError' || details.includes('fetch failed');
        if (visible) return { ok: false, message: accountFailure(error, 'Could not send a reset code. Try again.') };
      }
      return { ok: true, message: 'If an account exists for that email, we sent a 6-digit code. Enter it below with a new password.' };
    },
    // Step 2: exchange the emailed code for a session, set the new password,
    // then keep the session so the person is signed in afterwards.
    async accountResetPassword(email, code, password) {
      if (!service) return { ok: false, message: 'Accounts are not available until the shared service is configured.' };
      const cleanEmail = String(email || '').trim().slice(0, 254);
      const cleanCode = String(code || '').replace(/\s+/g, '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, message: 'Enter the email address of your Browsery account.' };
      if (!/^\d{6,10}$/.test(cleanCode)) return { ok: false, message: 'Enter the 6-digit code from the reset email.' };
      if (typeof password !== 'string' || password.length < 10 || password.length > 256) return { ok: false, message: 'Choose a new password with at least 10 characters.' };
      try {
        let verified = recovery && recovery.email === cleanEmail.toLowerCase() && recovery.code === cleanCode && recovery.until > Date.now() ? recovery.session : null;
        if (!verified) {
          recovery = null;
          verified = await request(authUrl('verify'), { method: 'POST', headers: headers(), body: JSON.stringify({ type: 'recovery', email: cleanEmail, token: cleanCode }) });
          if (typeof verified?.access_token !== 'string' || typeof verified?.refresh_token !== 'string' || !verified.user?.id) throw new Error('otp_expired: no session');
          recovery = { email: cleanEmail.toLowerCase(), code: cleanCode, session: verified, until: Date.now() + Math.min(600, Number(verified.expires_in) || 600) * 1000 };
        }
        const user = await request(authUrl('user'), { method: 'PUT', headers: headers({ Authorization: `Bearer ${verified.access_token}` }), body: JSON.stringify({ password }) });
        recovery = null;
        if (!storeSession({ ...verified, user: user?.id ? user : verified.user })) return { ok: false, message: 'Your password was changed, but secure storage is unavailable, so Browsery cannot keep you signed in. Sign in with the new password.' };
        return { ok: true, account: publicUser(session.user), message: 'Password updated. You are signed in.' };
      } catch (error) {
        const message = recoveryFailure(error, 'Could not reset the password. Check the code and try again.');
        return { ok: false, message: recovery && !/code is invalid/.test(message) ? `${message} Your code is still valid for a few minutes.` : message };
      }
    },
    supportCreate(ticket) {
      return supportRequest({ action: 'support-create', category: String(ticket?.category || 'other').slice(0, 20), subject: String(ticket?.subject || '').slice(0, 200), body: String(ticket?.body || '').slice(0, 5000), appVersion: String(ticket?.appVersion || '').slice(0, 32), platform: String(ticket?.platform || '').slice(0, 40) });
    },
    supportList() { return supportRequest({ action: 'support-list' }); },
    supportReply(ticketId, body) { return supportRequest({ action: 'support-reply', ticketId: String(ticketId || '').slice(0, 64), body: String(body || '').slice(0, 5000) }); },
    supportClose(ticketId) { return supportRequest({ action: 'support-close', ticketId: String(ticketId || '').slice(0, 64) }); },
    async accountStatus() {
      if (!session) return { account: null, secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()) };
      if (!service) return { account: publicUser(session.user), secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()) };
      if ((Number(session.expires_at) || 0) < Date.now() + 60_000) await refreshSession();
      return { account: publicUser(session?.user), secureStorage: Boolean(safeStorage?.isEncryptionAvailable?.()) };
    },
    async accountSignOut() {
      const accessToken = session?.access_token;
      session = null;
      recovery = null;
      ownerAccount = { userId: '', owner: false, checkedAt: 0 };
      deleteStored('browsery-account.bin');
      if (service && accessToken) request(authUrl('logout'), { method: 'POST', headers: headers({ Authorization: `Bearer ${accessToken}` }) }).catch(() => {});
      return { ok: true };
    },
  };
}

module.exports = { createGlobalControl };
