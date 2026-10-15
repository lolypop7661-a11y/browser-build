import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-browsery-admin, x-browsery-device, x-browsery-user',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: corsHeaders });
const backendUrl = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const adminSecret = Deno.env.get('BROWSERY_ADMIN_SECRET');
// Owner accounts: comma-separated Supabase Auth user IDs (Authentication → Users → copy UID).
// A signed-in Browsery account on this list gets owner controls on any device.
const ownerUserIds = new Set((Deno.env.get('BROWSERY_OWNER_USER_IDS') || '').split(',').map(id => id.trim().toLowerCase()).filter(id => /^[0-9a-f-]{36}$/.test(id)));
const database = backendUrl && serviceKey ? createClient(backendUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const defaultConfig = { signupsEnabled: true, minimumVersion: '', releaseUrl: '', releaseNotes: '', maintenanceStart: '', maintenanceEnd: '', features: { ai: true, extensions: true, voice: true, music: true, vpn: true } };

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left); const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}

// Verifies the caller's Browsery session token with Supabase Auth and returns the
// user ID only when that account is listed in BROWSERY_OWNER_USER_IDS.
async function ownerAccountId(request: Request) {
  const token = request.headers.get('x-browsery-user') || '';
  if (!database || !ownerUserIds.size || token.length < 20 || token.length > 4096) return '';
  const { data, error } = await database.auth.getUser(token);
  if (error || !data?.user?.id) return '';
  const id = data.user.id.toLowerCase();
  return ownerUserIds.has(id) && !data.user.banned_until ? id : '';
}

async function authorizeAdmin(request: Request) {
  if (await ownerAccountId(request)) return true;
  const supplied = request.headers.get('x-browsery-admin') || '';
  const deviceId = request.headers.get('x-browsery-device') || '';
  if (!database || !adminSecret || adminSecret.length < 32 || !constantTimeEqual(supplied, adminSecret) || !/^[0-9a-f-]{36}$/i.test(deviceId)) return false;
  const { data: existing, error } = await database.from('browsery_admin_device').select('device_id').eq('id', true).maybeSingle();
  if (error) throw error;
  if (!existing) {
    const { error: insertError } = await database.from('browsery_admin_device').insert({ id: true, device_id: deviceId });
    if (insertError && insertError.code !== '23505') throw insertError;
    const { data: paired, error: readError } = await database.from('browsery_admin_device').select('device_id').eq('id', true).single();
    if (readError) throw readError;
    return paired.device_id === deviceId;
  }
  return existing.device_id === deviceId;
}

async function readConfig() {
  const { data, error } = await database!.from('browsery_admin_config').select('config').eq('id', true).single();
  if (error) throw error;
  return { ...defaultConfig, ...(data?.config || {}), features: { ...defaultConfig.features, ...(data?.config?.features || {}) } };
}

async function readPublicState() {
  const [{ data: state, error: stateError }, { data: announcements, error: announcementError }, config] = await Promise.all([
    database!.from('browsery_global_state').select('mode,message,updated_at').eq('id', true).single(),
    database!.from('browsery_announcements').select('id,title,body,created_at').eq('active', true).order('created_at', { ascending: false }).limit(50),
    readConfig(),
  ]);
  if (stateError || announcementError) throw stateError || announcementError;
  const now = Date.now();
  const from = Date.parse(config.maintenanceStart || ''); const until = Date.parse(config.maintenanceEnd || '');
  const scheduled = Number.isFinite(from) && Number.isFinite(until) && now >= from && now < until;
  const effectiveMode = scheduled && state.mode === 'active' ? 'maintenance' : state.mode;
  const scheduledMessage = scheduled ? 'Browsery is in scheduled maintenance.' : state.message;
  return {
    mode: effectiveMode, message: scheduledMessage, updatedAt: state.updated_at, announcements: announcements || [],
    policy: { signupsEnabled: config.signupsEnabled !== false, minimumVersion: String(config.minimumVersion || ''), releaseUrl: String(config.releaseUrl || ''), releaseNotes: String(config.releaseNotes || ''), maintenanceStart: config.maintenanceStart || '', maintenanceEnd: config.maintenanceEnd || '', features: config.features },
  };
}

function safeUser(user: any) {
  return { id: String(user.id), email: String(user.email || ''), createdAt: user.created_at || null, bannedUntil: user.banned_until || null, confirmed: Boolean(user.email_confirmed_at) };
}

// ---------------------------------------------------------------------------
// Help & Support. Tickets are read and written only here with the service
// role; the tables have RLS on and no anon/authenticated access.
// ---------------------------------------------------------------------------
const SUPPORT_CATEGORIES = ['bug', 'account', 'feature', 'question', 'other'];
const SUPPORT_STATUSES = ['open', 'answered', 'closed'];
const TICKETS_PER_DAY = 5;
const MESSAGES_PER_HOUR = 30;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ticketColumns = 'id,user_id,email,category,subject,body,app_version,platform,status,created_at,updated_at,browsery_support_messages(id,author,body,created_at)';

// Removes control and bidi-override characters. Single-line fields also fold whitespace.
function supportText(value: unknown, singleLine = false) {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '');
  return (singleLine ? cleaned.replace(/\s+/g, ' ') : cleaned.replace(/\n{4,}/g, '\n\n\n')).trim();
}

type SupportUser = { id: string; email: string; banned: boolean };

// Verifies the caller's own Browsery session token (header x-browsery-user).
async function supportUser(request: Request): Promise<SupportUser | null> {
  const token = request.headers.get('x-browsery-user') || '';
  if (!database || token.length < 20 || token.length > 4096) return null;
  const { data, error } = await database.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const bannedUntil = Date.parse(String(data.user.banned_until || ''));
  return { id: data.user.id.toLowerCase(), email: String(data.user.email || '').slice(0, 254), banned: Number.isFinite(bannedUntil) && bannedUntil > Date.now() };
}

function shapeTicket(row: any, includeOwnerFields = false) {
  const messages = Array.isArray(row.browsery_support_messages) ? [...row.browsery_support_messages] : [];
  messages.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  return {
    id: row.id, category: row.category, subject: row.subject, body: row.body, status: row.status,
    appVersion: row.app_version || '', platform: row.platform || '', createdAt: row.created_at, updatedAt: row.updated_at,
    ...(includeOwnerFields ? { email: row.email || '', userId: row.user_id } : {}),
    messages: messages.map(message => ({ id: message.id, author: message.author, body: message.body, createdAt: message.created_at })),
  };
}

async function listUserTickets(userId: string) {
  const { data, error } = await database!.from('browsery_support_tickets').select(ticketColumns).eq('user_id', userId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data || []).map(row => shapeTicket(row));
}

async function ownTicket(userId: string, ticketId: unknown) {
  if (typeof ticketId !== 'string' || !uuidPattern.test(ticketId)) return null;
  const { data, error } = await database!.from('browsery_support_tickets').select('id,status').eq('id', ticketId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function userMessagesLastHour(userId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await database!.from('browsery_support_messages')
    .select('id,browsery_support_tickets!inner(user_id)', { count: 'exact', head: true })
    .eq('author', 'user').eq('browsery_support_tickets.user_id', userId).gte('created_at', since);
  if (error) throw error;
  return count || 0;
}

// Normal Browsery users: create, list, reply to and close their own tickets.
async function handleSupportUser(request: Request, payload: Record<string, unknown>, action: string) {
  const user = await supportUser(request);
  if (!user) return json({ error: 'user_not_authenticated' }, 401);
  if (user.banned) return json({ error: 'user_banned' }, 403);

  if (action === 'support-list') return json({ ok: true, tickets: await listUserTickets(user.id) });

  if (action === 'support-create') {
    const subject = supportText(payload.subject, true);
    const body = supportText(payload.body);
    const category = SUPPORT_CATEGORIES.includes(String(payload.category)) ? String(payload.category) : 'other';
    if (!subject) return json({ error: 'subject_required' }, 400);
    if (subject.length > 120) return json({ error: 'subject_too_long' }, 400);
    if (!body) return json({ error: 'body_required' }, 400);
    if (body.length > 4000) return json({ error: 'body_too_long' }, 400);
    const appVersion = typeof payload.appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(payload.appVersion) ? payload.appVersion : '';
    const platform = typeof payload.platform === 'string' ? supportText(payload.platform, true).replace(/[^\w .-]/g, '').slice(0, 40) : '';
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countError } = await database!.from('browsery_support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
    if (countError) throw countError;
    if ((count || 0) >= TICKETS_PER_DAY) return json({ error: 'support_ticket_limit' }, 429);
    const { data, error } = await database!.from('browsery_support_tickets').insert({ user_id: user.id, email: user.email, category, subject, body, app_version: appVersion, platform }).select('id').single();
    if (error) throw error;
    return json({ ok: true, ticketId: data.id, tickets: await listUserTickets(user.id) });
  }

  if (action === 'support-reply') {
    const ticket = await ownTicket(user.id, payload.ticketId);
    if (!ticket) return json({ error: 'ticket_not_found' }, 404);
    if (ticket.status === 'closed') return json({ error: 'ticket_closed' }, 409);
    const body = supportText(payload.body);
    if (!body) return json({ error: 'body_required' }, 400);
    if (body.length > 4000) return json({ error: 'body_too_long' }, 400);
    if (await userMessagesLastHour(user.id) >= MESSAGES_PER_HOUR) return json({ error: 'support_message_limit' }, 429);
    const { error } = await database!.from('browsery_support_messages').insert({ ticket_id: ticket.id, author: 'user', body });
    if (error) throw error;
    // A user reply on an answered ticket puts it back in the owner's open queue.
    const { error: updateError } = await database!.from('browsery_support_tickets').update({ status: 'open', updated_at: new Date().toISOString() }).eq('id', ticket.id);
    if (updateError) throw updateError;
    return json({ ok: true, tickets: await listUserTickets(user.id) });
  }

  if (action === 'support-close') {
    const ticket = await ownTicket(user.id, payload.ticketId);
    if (!ticket) return json({ error: 'ticket_not_found' }, 404);
    const { error } = await database!.from('browsery_support_tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', ticket.id);
    if (error) throw error;
    return json({ ok: true, tickets: await listUserTickets(user.id) });
  }
  return json({ error: 'unknown_action' }, 400);
}

const USER_SUPPORT_ACTIONS = ['support-create', 'support-list', 'support-reply', 'support-close'];

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!database) return json({ error: 'service_unconfigured' }, 503);
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.searchParams.get('action') === 'owner-status') return json({ owner: Boolean(await ownerAccountId(request)) });
      if (url.searchParams.get('action') === 'signup-policy') {
        const config = await readConfig();
        return json({ signupsEnabled: config.signupsEnabled !== false });
      }
      return json(await readPublicState());
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'invalid_request' }, 400);
    const action = String(payload.action || '');
    // Support actions for ordinary signed-in users are routed before the owner
    // check; every other POST action stays owner/admin-only.
    if (USER_SUPPORT_ACTIONS.includes(action)) return await handleSupportUser(request, payload, action);
    if (!await authorizeAdmin(request)) return json({ error: 'admin_not_authorized' }, 403);
    const deviceId = request.headers.get('x-browsery-device') || '';
    let result: Record<string, unknown> = {};

    if (action === 'set-mode') {
      if (!['active', 'maintenance', 'shutdown'].includes(payload.mode)) return json({ error: 'invalid_mode' }, 400);
      const message = typeof payload.message === 'string' ? payload.message.trim().slice(0, 500) : '';
      const { error } = await database.from('browsery_global_state').update({ mode: payload.mode, message, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error;
    } else if (action === 'publish-announcement') {
      const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 100) : '';
      const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 1200) : '';
      if (!title || !body) return json({ error: 'title_and_body_required' }, 400);
      const { error } = await database.from('browsery_announcements').insert({ title, body, active: true });
      if (error) throw error;
    } else if (action === 'edit-announcement') {
      const id = typeof payload.id === 'string' ? payload.id : '';
      const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 100) : '';
      const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 1200) : '';
      if (!id || !title || !body) return json({ error: 'announcement_fields_required' }, 400);
      const { error } = await database.from('browsery_announcements').update({ title, body }).eq('id', id);
      if (error) throw error;
    } else if (action === 'remove-announcement') {
      if (typeof payload.id !== 'string') return json({ error: 'invalid_announcement_id' }, 400);
      const { error } = await database.from('browsery_announcements').update({ active: false }).eq('id', payload.id);
      if (error) throw error;
    } else if (action === 'list-users') {
      const page = Math.max(1, Math.min(50, Number(payload.page) || 1));
      const filter = typeof payload.filter === 'string' ? payload.filter.trim().toLowerCase().slice(0, 254) : '';
      const collected: any[] = []; let hasMore = false; let total = 0;
      const lastPage = filter ? 50 : page;
      for (let currentPage = filter ? 1 : page; currentPage <= lastPage; currentPage += 1) {
        const { data, error } = await database.auth.admin.listUsers({ page: currentPage, perPage: 100 });
        if (error) throw error;
        const pageUsers = data.users || []; total = Number(data.total) || total;
        const matches = pageUsers.map(safeUser).filter(user => !filter || user.email.toLowerCase().includes(filter));
        collected.push(...matches);
        if (filter && matches.some(user => user.email.toLowerCase() === filter)) break;
        if (pageUsers.length < 100) { hasMore = false; break; }
        hasMore = true;
        if (!filter) break;
      }
      result = { users: collected.slice(0, 100), page, hasMore, total };
    } else if (action === 'ban-user' || action === 'unban-user') {
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      const duration = ['24h', '168h', '876000h'].includes(payload.duration) ? payload.duration : '168h';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'invalid_user_id' }, 400);
      if (action === 'ban-user' && ownerUserIds.has(id.toLowerCase())) return json({ error: 'cannot_ban_owner' }, 400);
      const { data, error } = await database.auth.admin.updateUserById(id, { ban_duration: action === 'unban-user' ? 'none' : duration });
      if (error) throw error;
      result = { user: data.user ? safeUser(data.user) : null };
    } else if (action === 'set-signups') {
      const config = await readConfig(); config.signupsEnabled = Boolean(payload.enabled);
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error; result = { signupsEnabled: config.signupsEnabled };
    } else if (action === 'set-maintenance-window') {
      const start = Date.parse(String(payload.start || '')); const end = Date.parse(String(payload.end || ''));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < Date.now() || end - start > 7 * 24 * 60 * 60 * 1000) return json({ error: 'invalid_maintenance_window' }, 400);
      const config = await readConfig(); config.maintenanceStart = new Date(start).toISOString(); config.maintenanceEnd = new Date(end).toISOString();
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error; result = { maintenanceStart: config.maintenanceStart, maintenanceEnd: config.maintenanceEnd };
    } else if (action === 'clear-maintenance-window') {
      const config = await readConfig(); config.maintenanceStart = ''; config.maintenanceEnd = '';
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error;
    } else if (action === 'set-minimum-version') {
      const version = typeof payload.version === 'string' ? payload.version.trim().slice(0, 32) : '';
      if (!/^\d+\.\d+\.\d+$/.test(version)) return json({ error: 'invalid_version' }, 400);
      const config = await readConfig(); config.minimumVersion = version;
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error; result = { minimumVersion: version };
    } else if (action === 'clear-minimum-version') {
      const config = await readConfig(); config.minimumVersion = '';
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error;
    } else if (action === 'set-release-info') {
      const releaseUrl = typeof payload.releaseUrl === 'string' ? payload.releaseUrl.trim().slice(0, 500) : '';
      const releaseNotes = typeof payload.releaseNotes === 'string' ? payload.releaseNotes.trim().slice(0, 2000) : '';
      if (releaseUrl && !/^https:\/\/(github\.com|www\.github\.com)\//i.test(releaseUrl)) return json({ error: 'release_url_must_be_github' }, 400);
      const config = await readConfig(); config.releaseUrl = releaseUrl; config.releaseNotes = releaseNotes;
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error;
    } else if (action === 'clear-release-info') {
      const config = await readConfig(); config.releaseUrl = ''; config.releaseNotes = '';
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error;
    } else if (action === 'set-feature') {
      const feature = String(payload.feature || '');
      if (!['ai', 'extensions', 'voice', 'music', 'vpn'].includes(feature)) return json({ error: 'invalid_feature' }, 400);
      const config = await readConfig(); config.features[feature] = Boolean(payload.enabled);
      const { error } = await database.from('browsery_admin_config').update({ config, updated_at: new Date().toISOString() }).eq('id', true);
      if (error) throw error; result = { feature, enabled: config.features[feature] };
    } else if (action === 'list-audit') {
      const { data, error } = await database.from('browsery_admin_audit').select('id,action,target,details,created_at').order('created_at', { ascending: false }).limit(100);
      if (error) throw error; result = { events: data || [] };
    } else if (action === 'support-admin-list') {
      const status = SUPPORT_STATUSES.includes(String(payload.status)) ? String(payload.status) : '';
      let query = database.from('browsery_support_tickets').select(ticketColumns);
      if (status) query = query.eq('status', status);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      result = { tickets: (data || []).map(row => shapeTicket(row, true)) };
    } else if (action === 'support-admin-reply') {
      const ticketId = typeof payload.ticketId === 'string' && uuidPattern.test(payload.ticketId) ? payload.ticketId : '';
      const body = supportText(payload.body);
      if (!ticketId) return json({ error: 'invalid_ticket_id' }, 400);
      if (!body || body.length > 4000) return json({ error: 'invalid_reply' }, 400);
      const { data: ticket, error: readError } = await database.from('browsery_support_tickets').select('id').eq('id', ticketId).maybeSingle();
      if (readError) throw readError;
      if (!ticket) return json({ error: 'ticket_not_found' }, 404);
      const { error } = await database.from('browsery_support_messages').insert({ ticket_id: ticketId, author: 'owner', body });
      if (error) throw error;
      const { data: updated, error: updateError } = await database.from('browsery_support_tickets').update({ status: 'answered', updated_at: new Date().toISOString() }).eq('id', ticketId).select(ticketColumns).single();
      if (updateError) throw updateError;
      result = { ticket: shapeTicket(updated, true) };
    } else if (action === 'support-admin-set-status') {
      const ticketId = typeof payload.ticketId === 'string' && uuidPattern.test(payload.ticketId) ? payload.ticketId : '';
      if (!ticketId || !SUPPORT_STATUSES.includes(String(payload.status))) return json({ error: 'invalid_ticket_status' }, 400);
      const { data: updated, error } = await database.from('browsery_support_tickets').update({ status: String(payload.status), updated_at: new Date().toISOString() }).eq('id', ticketId).select(ticketColumns).maybeSingle();
      if (error) throw error;
      if (!updated) return json({ error: 'ticket_not_found' }, 404);
      result = { ticket: shapeTicket(updated, true) };
    } else return json({ error: 'unknown_action' }, 400);

    if (!['list-users', 'list-audit'].includes(action)) {
      const target = typeof payload.id === 'string' ? payload.id.slice(0, 254) : typeof payload.ticketId === 'string' ? payload.ticketId.slice(0, 254) : typeof payload.email === 'string' ? payload.email.slice(0, 254) : '';
      const details = Object.fromEntries(Object.entries(payload).filter(([key]) => !['password', 'secret', 'id', 'email', 'body'].includes(key)));
      const { error: auditError } = await database.from('browsery_admin_audit').insert({ action, target, device_id: deviceId, details });
      if (auditError) console.warn('Admin audit insert failed:', auditError.message);
    }
    return json({ ok: true, ...result, ...(await readPublicState()) });
  } catch (error) {
    console.error('Browsery global control request failed:', error?.message || 'unknown error');
    return json({ error: 'global_control_failed' }, 500);
  }
});
