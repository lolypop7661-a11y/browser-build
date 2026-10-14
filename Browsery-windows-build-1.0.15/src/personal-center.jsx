import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSpringPresence } from './motion.js';

function originFromUrl(value) {
  try {
    const url = new URL(value || '');
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch { return ''; }
}

function formatDate(value) {
  try { return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return 'Recently saved'; }
}

// A deliberately explicit credentials panel. Browsery does not observe web
// form fields, save submissions, or return passwords to this React renderer.
// The native layer encrypts the store and only fills/copies after a click.
export function PersonalCenter({ open, onClose, onAccountChange, activeUrl, webContentsId, Icon, Button, CloseButton }) {
  const panelRef = useSpringPresence(open, { preset: 'fluid', offset: 90 });
  const desktop = window.browseryDesktop;
  const pageOrigin = useMemo(() => originFromUrl(activeUrl), [activeUrl]);
  const [status, setStatus] = useState({ loading: true, encryptionAvailable: false, count: 0 });
  const [logins, setLogins] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [form, setForm] = useState({ origin: '', username: '', password: '' });
  const [account, setAccount] = useState(null);
  const [accountForm, setAccountForm] = useState({ email: '', password: '' });
  const [accountMode, setAccountMode] = useState('signin');
  const [accountMessage, setAccountMessage] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState({ status: 'idle', message: 'Checking for updates is available in the desktop app.' });

  const refresh = useCallback(async () => {
    if (!desktop?.savedLoginStatus) {
      setStatus({ loading: false, encryptionAvailable: false, count: 0 });
      setLogins([]);
      setPermissions([]);
      return;
    }
    try {
      const [nextStatus, nextLogins, nextUpdate, nextPermissions] = await Promise.all([
        desktop.savedLoginStatus(),
        desktop.listSavedLogins(),
        desktop.appUpdateStatus?.() || Promise.resolve(null),
        desktop.listSitePermissions?.() || Promise.resolve([]),
      ]);
      const accountStatus = desktop.browseryAccountStatus ? await desktop.browseryAccountStatus().catch(() => null) : null;
      setStatus({ loading: false, ...nextStatus });
      setLogins(Array.isArray(nextLogins) ? nextLogins : []);
      setPermissions(Array.isArray(nextPermissions) ? nextPermissions : []);
      setAccount(accountStatus?.account || null);
      onAccountChange?.(accountStatus?.account || null);
      if (nextUpdate) setUpdate(nextUpdate);
    } catch {
      setStatus({ loading: false, encryptionAvailable: false, count: 0 });
      setMessage('Browsery could not read the local personal-data store.');
    }
  }, [desktop, onAccountChange]);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setForm(current => ({ ...current, origin: current.origin || pageOrigin }));
    refresh();
  }, [open, pageOrigin, refresh]);

  useEffect(() => desktop?.onAppUpdate?.(nextUpdate => {
    if (nextUpdate && typeof nextUpdate === 'object') setUpdate(nextUpdate);
  }), [desktop]);

  const saveLogin = async event => {
    event.preventDefault();
    if (!desktop?.saveLogin || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await desktop.saveLogin(form);
      if (!result?.ok) { setMessage(result?.message || 'Browsery could not save this login.'); return; }
      setForm(current => ({ origin: current.origin, username: '', password: '' }));
      setMessage('Saved locally with operating-system encryption.');
      await refresh();
    } catch { setMessage('Browsery could not save this login.'); }
    finally { setBusy(false); }
  };

  const removeLogin = async login => {
    if (!desktop?.deleteSavedLogin || busy) return;
    if (!window.confirm(`Remove the saved login for ${login.username} on ${login.origin}? This cannot be undone.`)) return;
    setBusy(true); setMessage('');
    try {
      const result = await desktop.deleteSavedLogin(login.id);
      setMessage(result?.ok ? 'Saved login removed.' : (result?.message || 'Browsery could not remove that login.'));
      if (result?.ok) await refresh();
    } catch { setMessage('Browsery could not remove that login.'); }
    finally { setBusy(false); }
  };

  const copy = async (login, kind) => {
    const invoke = kind === 'password' ? desktop?.copySavedLoginPassword : desktop?.copySavedLoginUsername;
    if (!invoke || busy) return;
    setBusy(true); setMessage('');
    try { const result = await invoke(login.id); setMessage(result?.message || (result?.ok ? 'Copied.' : 'Browsery could not copy that value.')); }
    catch { setMessage('Browsery could not copy that value.'); }
    finally { setBusy(false); }
  };

  // The component never touches the guest webview. The shell gives it only a
  // numeric id, which the main process validates against the active tab.
  const activeWebContentsId = Number(webContentsId);
  const fillCurrent = async login => {
    if (!desktop?.fillSavedLogin || busy) return;
    if (pageOrigin !== login.origin) { setMessage(`Open ${login.origin} in the active tab before filling this login.`); return; }
    if (!Number.isSafeInteger(activeWebContentsId)) { setMessage('The active website is not ready to fill yet. Reload it and try again.'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await desktop.fillSavedLogin({ id: login.id, webContentsId: activeWebContentsId });
      setMessage(result?.ok ? 'Login details filled into the visible sign-in form.' : (result?.message || 'Browsery could not fill this page.'));
    } catch { setMessage('Browsery could not fill this page.'); }
    finally { setBusy(false); }
  };

  const openDefaultSettings = async () => {
    if (!desktop?.openDefaultBrowserSettings || busy) return;
    setBusy(true); setMessage('');
    try { const result = await desktop.openDefaultBrowserSettings(); setMessage(result?.message || (result?.ok ? 'Opened your system browser settings.' : 'Could not open system browser settings.')); }
    catch { setMessage('Could not open system browser settings.'); }
    finally { setBusy(false); }
  };

  const clearPermission = async entry => {
    if (!desktop?.clearSitePermission || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await desktop.clearSitePermission({ origin: entry.origin, permission: entry.permission });
      setMessage(result?.ok ? `Permission cleared for ${entry.origin}.` : 'Browsery could not clear that permission.');
      if (result?.ok) await refresh();
    } catch { setMessage('Browsery could not clear that permission.'); }
    finally { setBusy(false); }
  };

  const checkUpdates = async () => {
    if (!desktop?.checkForAppUpdate || busy) return;
    setBusy(true); setMessage('');
    try { const result = await desktop.checkForAppUpdate(); setUpdate(result || update); }
    catch { setUpdate(current => ({ ...current, status: 'unavailable', message: 'Browsery could not check GitHub Releases right now.' })); }
    finally { setBusy(false); }
  };

  const downloadUpdate = async () => {
    if (!desktop?.downloadAppUpdate || busy) return;
    setBusy(true); setMessage('');
    try { const result = await desktop.downloadAppUpdate(); setUpdate(result || update); }
    catch { setUpdate(current => ({ ...current, status: 'error', message: 'Browsery could not download this update.' })); }
    finally { setBusy(false); }
  };

  const installUpdate = async () => {
    if (!desktop?.installAppUpdate || busy) return;
    setBusy(true); setMessage('');
    try {
      const result = await desktop.installAppUpdate();
      if (result) setUpdate(result);
      if (!result?.ok) setMessage(result?.message || 'Browsery could not start the update.');
    } catch { setMessage('Browsery could not start the update.'); }
    finally { setBusy(false); }
  };

  const submitAccount = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setAccountMessage('');
    try {
      const result = accountMode === 'signup'
        ? await desktop?.browseryAccountSignUp?.(accountForm)
        : await desktop?.browseryAccountSignIn?.(accountForm);
      if (!result?.ok) { setAccountMessage(result?.message || 'Could not complete the account request.'); return; }
      setAccount(result.confirmationRequired ? null : result.account || null);
      onAccountChange?.(result.confirmationRequired ? null : result.account || null);
      setAccountMessage(result.message || 'Account request completed.');
      setAccountForm(current => ({ email: current.email, password: '' }));
    } catch { setAccountMessage('Could not contact Browsery Accounts.'); }
    finally { setBusy(false); }
  };

  const signOutAccount = async () => {
    await desktop?.browseryAccountSignOut?.();
    setAccount(null); setAccountMessage('Signed out on this device.');
    onAccountChange?.(null);
  };

  const openRelease = async () => {
    if (!desktop?.openAppUpdateRelease || busy) return;
    setBusy(true); setMessage('');
    try { const result = await desktop.openAppUpdateRelease(); setMessage(result?.message || (result?.ok ? 'Opened Browsery’s official GitHub Releases page.' : 'Could not open GitHub Releases.')); }
    catch { setMessage('Could not open GitHub Releases.'); }
    finally { setBusy(false); }
  };

  const systemLabel = desktop?.platform === 'win32' ? 'Windows' : desktop?.platform === 'darwin' ? 'macOS' : 'your system';
  const nativeReady = Boolean(desktop?.isDesktop);
  const updateAction = update.status === 'downloaded' ? installUpdate : update.status === 'available' ? downloadUpdate : checkUpdates;
  const updateActionLabel = update.status === 'installing' ? 'Restarting…'
    : update.status === 'downloaded' ? 'Restart & update'
      : update.status === 'downloading' ? `Downloading ${Math.round(Number(update.progress) || 0)}%`
        : update.status === 'available' ? `Download ${update.latestVersion ? `v${update.latestVersion}` : 'update'}`
          : update.status === 'checking' ? 'Checking…' : 'Check now';
  const updateActionDisabled = !nativeReady || busy || ['checking', 'downloading', 'installing'].includes(update.status);
  return <aside ref={panelRef} className={`drawer personal-center ${open ? 'open' : ''}`} aria-hidden={!open}>
    <div className="drawer-head">
      <div><span className="drawer-kicker">This device · explicit controls</span><h2>Personal browser</h2></div>
      <CloseButton icon="close" label="Close personal browser" onClick={onClose}/>
    </div>
    <div className="personal-center-body">
      <section className="personal-intro">
        <span><Icon name="shield" size={18}/></span>
        <div><b>Private by design</b><p>Browsery never captures passwords or form submissions. You choose exactly what to save, copy, or fill.</p></div>
      </section>

      <section className="personal-section browsery-account-section" aria-labelledby="browsery-account-title">
        <div className="personal-section-head"><div><span>Browsery account</span><h3 id="browsery-account-title">{account ? account.email : accountMode === 'signup' ? 'Create an account' : 'Sign in'}</h3></div><em>{account ? 'SIGNED IN' : 'REQUIRED'}</em></div>
        {account ? <><p className="personal-note">You are signed in on this device. Owner/admin controls do not use Browsery accounts.</p><Button type="button" onClick={signOutAccount} disabled={busy}>Sign out</Button></> : <form className="login-save-form" onSubmit={submitAccount}><label>Email<input type="email" autoComplete="email" value={accountForm.email} onChange={event => setAccountForm(current => ({ ...current, email: event.target.value }))} required disabled={busy}/></label><label>Password<input type="password" autoComplete={accountMode === 'signup' ? 'new-password' : 'current-password'} minLength={accountMode === 'signup' ? 10 : 1} maxLength={256} value={accountForm.password} onChange={event => setAccountForm(current => ({ ...current, password: event.target.value }))} required disabled={busy}/></label><Button type="submit" disabled={busy}>{accountMode === 'signup' ? 'Create account' : 'Sign in'}</Button><button className="local-control-text-button" type="button" onClick={() => { setAccountMode(current => current === 'signup' ? 'signin' : 'signup'); setAccountMessage(''); }}>{accountMode === 'signup' ? 'Already registered? Sign in' : 'New to Browsery? Create account'}</button></form>}
        {accountMessage && <p className="personal-note" role="status">{accountMessage}</p>}
      </section>

      <section className="personal-section" aria-labelledby="saved-logins-title">
        <div className="personal-section-head"><div><span>Saved logins</span><h3 id="saved-logins-title">Encrypted on this device</h3></div><em>{status.loading ? '…' : `${logins.length} saved`}</em></div>
        {!nativeReady ? <p className="personal-note">Saved logins are available only in the installed Browsery desktop app.</p> : !status.encryptionAvailable ? <p className="personal-note warning">Your operating system’s secure storage is unavailable, so Browsery will not save login details.</p> : <>
          <form className="login-save-form" onSubmit={saveLogin}>
            <label>Website<input type="url" value={form.origin} onChange={event => setForm(current => ({ ...current, origin: event.target.value }))} placeholder="https://example.com" autoComplete="off" disabled={busy}/></label>
            <label>Username<input value={form.username} onChange={event => setForm(current => ({ ...current, username: event.target.value }))} placeholder="you@example.com" autoComplete="off" disabled={busy}/></label>
            <label>Password<input type="password" value={form.password} onChange={event => setForm(current => ({ ...current, password: event.target.value }))} placeholder="Enter manually" autoComplete="new-password" disabled={busy}/></label>
            <Button type="submit" disabled={busy || !form.origin.trim() || !form.username.trim() || !form.password}>Save login</Button>
          </form>
          <p className="personal-note">Passwords never appear in this panel. Browsery uses OS-backed encryption and does not import, observe, or auto-save website fields.</p>
          <div className="saved-login-list">{logins.length === 0 ? <div className="personal-empty"><Icon name="shield" size={20}/><b>No saved logins</b><span>Add one manually only if this is your personal device.</span></div> : logins.map(login => <article className="saved-login" key={login.id}>
            <div className="saved-login-copy"><b>{login.username}</b><small>{login.origin}</small><em>Updated {formatDate(login.updatedAt)}</em></div>
            <div className="saved-login-actions"><Button type="button" onClick={() => fillCurrent(login)} disabled={busy || pageOrigin !== login.origin || !Number.isSafeInteger(activeWebContentsId)}>Fill this site</Button><Button type="button" onClick={() => copy(login, 'username')} disabled={busy}>Copy user</Button><Button type="button" onClick={() => copy(login, 'password')} disabled={busy}>Copy password</Button><button className="saved-login-remove" type="button" aria-label={`Remove saved login for ${login.username}`} onClick={() => removeLogin(login)} disabled={busy}><Icon name="trash" size={15}/></button></div>
          </article>)}</div>
        </>}
      </section>

      <section className="personal-section site-permissions-section" aria-labelledby="site-permissions-title">
        <div className="personal-section-head"><div><span>Website permissions</span><h3 id="site-permissions-title">Your remembered choices</h3></div><em>{permissions.length ? `${permissions.length} allowed` : 'None saved'}</em></div>
        <p className="personal-note">Camera, microphone, and location requests always ask first. Private-session choices are never saved.</p>
        <div className="site-permission-list">{permissions.length === 0 ? <div className="permission-empty">No site permissions are remembered.</div> : permissions.map(entry => <article className="site-permission" key={`${entry.origin}|${entry.permission}`}><div><b>{entry.origin}</b><small>{String(entry.permission || 'feature').replace(/([A-Z])/g, ' $1')}</small></div><Button type="button" onClick={() => clearPermission(entry)} disabled={busy}>Clear</Button></article>)}</div>
      </section>

      <section className="personal-section personal-system-section">
        <div className="personal-section-head"><div><span>System browser</span><h3>Default-browser setup</h3></div></div>
        <p className="personal-note">Browsery does not register itself as your default browser automatically. That choice stays in {systemLabel}.</p>
        <Button type="button" onClick={openDefaultSettings} disabled={!nativeReady || busy}>Open {systemLabel} browser settings</Button>
      </section>

      <section className="personal-section personal-update-section">
        <div className="personal-section-head"><div><span>Updates</span><h3>{update.available ? 'A new version is ready' : 'Safe update check'}</h3></div><em>{update.currentVersion ? `v${update.currentVersion}` : ''}</em></div>
        <p className="personal-note">{update.message}</p>
        {update.status === 'downloading' && <div className="personal-update-progress" aria-label={`Update download ${Math.round(Number(update.progress) || 0)} percent`}><i style={{ width: `${Math.max(0, Math.min(100, Number(update.progress) || 0))}%` }}/></div>}
        <div className="personal-update-actions"><Button type="button" onClick={updateAction} disabled={updateActionDisabled}>{updateActionLabel}</Button><Button type="button" onClick={openRelease} disabled={!nativeReady || busy}>Open GitHub Releases</Button></div>
        <p className="personal-note subtle">Browsery only downloads after you choose it. Restart &amp; update is a separate click.</p>
      </section>
      {message && <p className="personal-message" role="status">{message}</p>}
    </div>
  </aside>;
}
