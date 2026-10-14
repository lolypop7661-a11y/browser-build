import React, { useCallback, useEffect, useState } from 'react';
import { useSpringPresence } from './motion.js';

const desktop = () => window.browseryDesktop;
const dateLabel = value => { try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return 'Recently'; } };
const FEATURE_LABELS = { ai: 'AI analysis', extensions: 'Extensions', voice: 'Voice assistant', music: 'Music player', vpn: 'VPN panel' };

export function LocalControlCenter({ open, onClose, state, onStateChange, onAdminReadyChange = () => {}, Icon, Button, CloseButton }) {
  const panelRef = useSpringPresence(open, { preset: 'fluid', offset: 90 });
  const [service, setService] = useState({ configured: false, secureStorage: false, adminReady: false });
  const [announcement, setAnnouncement] = useState({ title: '', body: '' });
  const [globalMessage, setGlobalMessage] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [userDuration, setUserDuration] = useState('168h');
  const [users, setUsers] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [version, setVersion] = useState('');
  const [releaseUrl, setReleaseUrl] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mode = ['active', 'maintenance', 'shutdown'].includes(state?.mode) ? state.mode : 'active';
  const policy = state?.policy || {};
  const announcements = Array.isArray(state?.announcements) ? state.announcements : [];

  const updateService = useCallback(async () => {
    try {
      const next = await desktop()?.globalControlStatus();
      if (next) { setService(next); onAdminReadyChange(Boolean(next.adminReady)); }
    } catch { onAdminReadyChange(false); }
  }, [onAdminReadyChange]);

  const refresh = useCallback(async () => {
    const api = desktop();
    if (!api?.isDesktop) return;
    try {
      const [status, nextState] = await Promise.all([api.globalControlStatus(), api.getGlobalControlState()]);
      if (status) { setService(status); onAdminReadyChange(Boolean(status.adminReady)); }
      if (nextState) {
        onStateChange(nextState);
        const remote = nextState.policy || {};
        setVersion(remote.minimumVersion || ''); setReleaseUrl(remote.releaseUrl || ''); setReleaseNotes(remote.releaseNotes || '');
        if (remote.maintenanceStart) setWindowStart(new Date(remote.maintenanceStart).toISOString().slice(0, 16));
        if (remote.maintenanceEnd) setWindowEnd(new Date(remote.maintenanceEnd).toISOString().slice(0, 16));
      }
    } catch { setMessage('Could not contact Browsery’s global-control service.'); }
  }, [onStateChange, onAdminReadyChange]);

  useEffect(() => { updateService(); }, [updateService]);
  useEffect(() => { if (open && service.adminReady) { setMessage(''); refresh(); } }, [open, service.adminReady, refresh]);
  useEffect(() => desktop()?.onGlobalControlState?.(next => { if (next) onStateChange(next); }), [onStateChange]);

  const runAdmin = async (payload, success = 'Control saved.') => {
    if (!service.adminReady || busy) return null;
    if (payload.action === 'set-mode' && payload.mode !== 'active' && !window.confirm(payload.mode === 'shutdown' ? 'Lock Browsery for every online user?' : 'Put Browsery in maintenance mode for every online user?')) return null;
    setBusy(true); setMessage('');
    try {
      const result = await desktop()?.globalAdminAction(payload);
      if (!result?.ok) { setMessage(result?.message || result?.error || 'The admin request failed.'); return null; }
      if (result.state) onStateChange(result.state);
      setMessage(success);
      return result;
    } catch { setMessage('Could not reach the global admin service.'); return null; }
    finally { setBusy(false); }
  };

  const publish = async event => {
    event.preventDefault();
    const result = await runAdmin({ action: 'publish-announcement', ...announcement }, 'Announcement sent to Browsery users.');
    if (result) setAnnouncement({ title: '', body: '' });
  };

  const loadUsers = async () => {
    const result = await runAdmin({ action: 'list-users', filter: userFilter }, 'User list refreshed.');
    if (result) setUsers(Array.isArray(result.users) ? result.users : []);
  };
  const moderate = async (user, action) => {
    const label = action === 'ban-user' ? 'Ban' : 'Unban';
    if (action === 'ban-user' && !window.confirm(`Ban ${user.email || user.id} from Browsery account sign-in?`)) return;
    const result = await runAdmin({ action, id: user.id, duration: userDuration }, `${label} action completed.`);
    if (result?.user) setUsers(current => current.map(entry => entry.id === user.id ? result.user : entry));
  };
  const loadAudit = async () => {
    const result = await runAdmin({ action: 'list-audit' }, 'Admin activity loaded.');
    if (result) setAuditEvents(Array.isArray(result.events) ? result.events : []);
  };

  const saveMaintenanceWindow = async event => {
    event.preventDefault();
    const result = await runAdmin({ action: 'set-maintenance-window', start: new Date(windowStart).toISOString(), end: new Date(windowEnd).toISOString() }, 'Scheduled maintenance window saved.');
    if (result?.state) onStateChange(result.state);
  };
  const saveReleaseInfo = async event => {
    event.preventDefault();
    await runAdmin({ action: 'set-release-info', releaseUrl, releaseNotes }, 'Release information published.');
  };

  if (!service.adminReady) return null;
  return <aside ref={panelRef} className={`drawer local-control-drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
    <div className="drawer-head"><div><span className="drawer-kicker">Owner controls · this PC only</span><h2>Browsery Operations</h2></div><CloseButton icon="close" label="Close owner controls" onClick={onClose}/></div>
    <div className="local-control-body">
      {!service.configured ? <section className="local-control-intro"><Icon name="alert" size={20}/><div><b>Global service unavailable</b><p>This owner key is device-bound, but the hosted service is not configured.</p></div></section> : <>
        <section className="local-control-intro"><Icon name="shield" size={20}/><div><b>{state?.online ? 'Owner device verified' : 'Global service offline'}</b><p>No admin account is used. This profile’s encrypted key is paired to one Browsery device ID on the server.</p></div></section>

        <section className="local-control-section"><div className="local-control-section-title"><div><span>01 · Service control</span><h3>{mode === 'active' ? 'All systems active' : mode === 'maintenance' ? 'Maintenance is active' : 'Global shutdown is active'}</h3></div><em className={state?.online ? 'online' : 'offline'}>{state?.online ? 'ONLINE' : 'OFFLINE'}</em></div>
          <p className="local-control-note">{state?.message || 'Service status for connected Browsery installs.'}</p>
          <label className="local-control-field">Message for the next status<textarea value={globalMessage} onChange={event => setGlobalMessage(event.target.value)} maxLength={500} placeholder="Optional message to all users." disabled={busy}/></label>
          <div className="global-control-actions"><Button type="button" onClick={() => runAdmin({ action: 'set-mode', mode: 'active', message: '' }, 'Browsery access resumed globally.')} disabled={busy || !state?.online}>Resume browser access</Button><Button type="button" onClick={() => runAdmin({ action: 'set-mode', mode: 'maintenance', message: globalMessage }, 'Global maintenance enabled.')} disabled={busy || !state?.online}>Enable maintenance</Button><Button type="button" onClick={() => runAdmin({ action: 'set-mode', mode: 'shutdown', message: globalMessage }, 'Global shutdown lock enabled.')} disabled={busy || !state?.online}>Shutdown lock</Button></div>
          <p className="local-control-note">Clients check about every 15 seconds. A lock does not power off users’ computers.</p>
        </section>

        <section className="local-control-section"><div className="local-control-section-title"><div><span>02 · Announcements</span><h3>Broadcast to users</h3></div><em>{announcements.length} ACTIVE</em></div>
          <form className="local-control-form" onSubmit={publish}><label>Title<input value={announcement.title} onChange={event => setAnnouncement(current => ({ ...current, title: event.target.value }))} maxLength={100} required disabled={busy}/></label><label>Message<textarea value={announcement.body} onChange={event => setAnnouncement(current => ({ ...current, body: event.target.value }))} maxLength={1200} required disabled={busy}/></label><Button type="submit" disabled={busy || !state?.online}>Publish announcement</Button></form>
          <div className="local-control-announcements">{announcements.map(item => <article key={item.id}><div><b>{item.title}</b><small>{dateLabel(item.createdAt)}</small><p>{item.body}</p></div><Button type="button" onClick={() => runAdmin({ action: 'remove-announcement', id: item.id }, 'Announcement removed.')} disabled={busy}>Remove</Button></article>)}{!announcements.length && <p className="local-control-empty">No active global announcements.</p>}</div>
        </section>

        <section className="local-control-section"><div className="local-control-section-title"><div><span>03 · Account moderation</span><h3>Find, ban, or restore users</h3></div><em>SERVER ENFORCED</em></div>
          <form className="local-control-form user-search-form" onSubmit={event => { event.preventDefault(); loadUsers(); }}><label>Filter by email<input type="search" value={userFilter} onChange={event => setUserFilter(event.target.value)} placeholder="name@example.com" disabled={busy}/></label><Button type="submit" disabled={busy}>Load users</Button></form>
          <label className="local-control-field">Ban duration<select value={userDuration} onChange={event => setUserDuration(event.target.value)} disabled={busy}><option value="24h">24 hours</option><option value="168h">7 days</option><option value="876000h">Permanent (100 years)</option></select></label>
          <div className="admin-user-list">{users.map(user => <article key={user.id}><div><b>{user.email || 'No email'}</b><small>{user.bannedUntil ? `Banned until ${dateLabel(user.bannedUntil)}` : user.confirmed ? 'Confirmed account' : 'Email not confirmed'}</small><code>{user.id}</code></div><Button type="button" onClick={() => moderate(user, user.bannedUntil ? 'unban-user' : 'ban-user')} disabled={busy}>{user.bannedUntil ? 'Unban' : 'Ban'}</Button></article>)}{!users.length && <p className="local-control-empty">Load users to manage Browsery accounts. Bans are enforced by Supabase Auth.</p>}</div>
          <div className="global-control-actions"><Button type="button" onClick={() => runAdmin({ action: 'set-signups', enabled: policy.signupsEnabled === false }, policy.signupsEnabled === false ? 'New account signups enabled.' : 'New account signups paused.')} disabled={busy}>{policy.signupsEnabled === false ? 'Enable new accounts' : 'Pause new accounts'}</Button></div>
        </section>

        <section className="local-control-section"><div className="local-control-section-title"><div><span>04 · Scheduled maintenance</span><h3>Automatic maintenance window</h3></div></div>
          <p className="local-control-note">The app will show the maintenance lock only during this UTC-backed window, then return to the current service mode.</p>
          <form className="local-control-form" onSubmit={saveMaintenanceWindow}><label>Starts<input type="datetime-local" value={windowStart} onChange={event => setWindowStart(event.target.value)} required disabled={busy}/></label><label>Ends<input type="datetime-local" value={windowEnd} onChange={event => setWindowEnd(event.target.value)} required disabled={busy}/></label><Button type="submit" disabled={busy || !windowStart || !windowEnd}>Schedule maintenance</Button></form>
          <Button type="button" onClick={() => runAdmin({ action: 'clear-maintenance-window' }, 'Scheduled maintenance cancelled.')} disabled={busy || !policy.maintenanceStart}>Cancel scheduled window</Button>
        </section>

        <section className="local-control-section"><div className="local-control-section-title"><div><span>05 · Required update</span><h3>{policy.minimumVersion ? `Required version ${policy.minimumVersion}` : 'No version lock'}</h3></div></div>
          <form className="local-control-form" onSubmit={event => { event.preventDefault(); runAdmin({ action: 'set-minimum-version', version }, `Version ${version} is now required.`); }}><label>Minimum version<input value={version} onChange={event => setVersion(event.target.value)} placeholder="1.0.16" pattern="[0-9]+[.][0-9]+[.][0-9]+" required disabled={busy}/></label><Button type="submit" disabled={busy || !version}>Require this version</Button></form>
          <Button type="button" onClick={() => { setVersion(''); runAdmin({ action: 'clear-minimum-version' }, 'Minimum version requirement cleared.'); }} disabled={busy || !policy.minimumVersion}>Clear required version</Button>
          <form className="local-control-form" onSubmit={saveReleaseInfo}><label>GitHub release link<input type="url" value={releaseUrl} onChange={event => setReleaseUrl(event.target.value)} placeholder="https://github.com/owner/repo/releases/tag/v..." disabled={busy}/></label><label>Release notes<textarea value={releaseNotes} onChange={event => setReleaseNotes(event.target.value)} maxLength={2000} disabled={busy}/></label><Button type="submit" disabled={busy}>Publish update details</Button></form>
          <Button type="button" onClick={() => { setReleaseUrl(''); setReleaseNotes(''); runAdmin({ action: 'clear-release-info' }, 'Release details cleared.'); }} disabled={busy || (!policy.releaseUrl && !policy.releaseNotes)}>Clear release details</Button>
        </section>

        <section className="local-control-section"><div className="local-control-section-title"><div><span>06 · Remote features</span><h3>Global feature switches</h3></div></div>
          <p className="local-control-note">These switches change the shared policy returned to Browsery clients. A disabled feature is hidden or blocked in the app, not uninstalled.</p>
          <div className="admin-feature-list">{Object.entries(FEATURE_LABELS).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={policy.features?.[key] !== false} onChange={event => runAdmin({ action: 'set-feature', feature: key, enabled: event.target.checked }, `${label} ${event.target.checked ? 'enabled' : 'disabled'} for Browsery clients.`)} disabled={busy}/></label>)}</div>
        </section>

        <section className="local-control-section"><div className="local-control-section-title"><div><span>07 · Audit history</span><h3>Owner actions</h3></div></div><Button type="button" onClick={loadAudit} disabled={busy}>Load recent admin activity</Button><div className="admin-audit-list">{auditEvents.map(event => <article key={event.id}><b>{event.action}</b><small>{dateLabel(event.created_at)} · {event.target || 'global'}</small></article>)}{!auditEvents.length && <p className="local-control-empty">Audit history is private to this owner console.</p>}</div></section>
      </>}
      {message && <p className="local-control-message" role="status">{message}</p>}
      <p className="local-control-footnote">Admin access uses an encrypted local key and one server-bound device identifier—there is no admin account, and no admin secret is embedded in the public installer.</p>
    </div>
  </aside>;
}
