import React, { useEffect, useState } from 'react';

const RESEND_SECONDS = 60;

/** Full-window account gate shown directly after Browsery's launch sequence. */
export function AccountGate({ desktop, onAuthenticated, Icon, checking = false, initialMessage = '' }) {
  // signup · signin · recover-email · recover-code
  const [mode, setMode] = useState('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { if (initialMessage) setMessage(initialMessage); }, [initialMessage]);
  useEffect(() => {
    if (mode !== 'recover-code' || resendAt <= Date.now()) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [mode, resendAt]);

  const recovering = mode === 'recover-email' || mode === 'recover-code';
  const switchMode = next => { setMode(next); setPassword(''); setCode(''); setNewPassword(''); setConfirmPassword(''); setMessage(''); };

  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const request = mode === 'signup' ? desktop?.browseryAccountSignUp : desktop?.browseryAccountSignIn;
      if (!request) {
        setMessage('Browsery accounts are available in the installed desktop app.');
        return;
      }
      const result = await request({ email: email.trim(), password });
      if (!result?.ok) {
        setMessage(result?.message || 'Could not complete the account request. Try again.');
        return;
      }
      if (result.confirmationRequired) {
        setMode('signin');
        setPassword('');
        setMessage('Your account was created. Sign in here to continue.');
        return;
      }
      if (!result.account) {
        setMessage(result.message || 'Your account is not ready yet. Try signing in.');
        return;
      }
      onAuthenticated(result.account, { isNew: mode === 'signup' });
    } catch {
      setMessage('Browsery could not reach the account service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async event => {
    event?.preventDefault();
    if (busy) return;
    if (!desktop?.browseryAccountRecover) { setMessage('Password recovery is available in the installed desktop app.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const result = await desktop.browseryAccountRecover(email.trim());
      if (!result?.ok) { setMessage(result?.message || 'Could not send a reset code. Try again.'); return; }
      setMode('recover-code');
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setNow(Date.now());
      setMessage(result.message || 'If an account exists for that email, we sent a 6-digit code.');
    } catch {
      setMessage('Browsery could not reach the account service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async event => {
    event.preventDefault();
    if (busy) return;
    const cleanCode = code.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(cleanCode)) { setMessage('Enter the 6-digit code from the reset email.'); return; }
    if (newPassword.length < 10) { setMessage('Choose a new password with at least 10 characters.'); return; }
    if (newPassword !== confirmPassword) { setMessage('The two passwords do not match.'); return; }
    if (!desktop?.browseryAccountResetPassword) { setMessage('Password recovery is available in the installed desktop app.'); return; }
    setBusy(true);
    setMessage('');
    try {
      const result = await desktop.browseryAccountResetPassword({ email: email.trim(), code: cleanCode, password: newPassword });
      if (!result?.ok) { setMessage(result?.message || 'Could not reset the password. Try again.'); return; }
      if (!result.account) { switchMode('signin'); setMessage(result.message || 'Password updated. Sign in with your new password.'); return; }
      onAuthenticated(result.account, { isNew: false });
    } catch {
      setMessage('Browsery could not reach the account service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const resendWait = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const title = checking ? 'Checking your account.' : mode === 'signup' ? 'Start with your account.' : mode === 'signin' ? 'Welcome back.' : mode === 'recover-email' ? 'Reset your password.' : 'Enter your reset code.';
  const description = checking ? 'One moment while Browsery checks this device.'
    : mode === 'signup' ? 'Create a Browsery account to continue. This is required for every user, including the owner.'
    : mode === 'signin' ? 'Sign in to continue to your Browsery space.'
    : mode === 'recover-email' ? 'Enter your account email. Browsery will ask Supabase to email you a 6-digit code. There is no link to click, so this works right here in the app.'
    : `Check the inbox for ${email.trim() || 'your email'}, then enter the code and choose a new password. Codes expire after a short time.`;

  return <div className="account-gate" role="dialog" aria-modal="true" aria-labelledby="account-gate-title">
    <div className="account-gate-stars" aria-hidden="true"/>
    <div className="account-gate-orbit account-gate-orbit-one" aria-hidden="true"/>
    <div className="account-gate-orbit account-gate-orbit-two" aria-hidden="true"/>
    <section className="account-gate-card">
      <div className="account-gate-brand"><img src="./assets/browsery-icon.png" alt=""/><span>Browsery</span></div>
      <span className="account-gate-kicker">{recovering ? `PASSWORD RECOVERY · STEP ${mode === 'recover-email' ? 1 : 2} OF 2` : 'YOUR BROWSER · YOUR ACCOUNT'}</span>
      <h1 id="account-gate-title">{title}</h1>
      <p className="account-gate-description">{description}</p>
      {!checking && !recovering && <form className="account-gate-form" onSubmit={submit}>
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} disabled={busy} autoFocus/></label>
        <label>Password<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'} required minLength={mode === 'signup' ? 10 : 1} maxLength={256} disabled={busy}/></label>
        {mode === 'signin' && <button className="account-gate-forgot" type="button" onClick={() => switchMode('recover-email')} disabled={busy}>Forgot password?</button>}
        <button className="account-gate-submit" type="submit" disabled={busy}>{busy ? 'Waiting for the human check…' : mode === 'signup' ? 'Create account and continue' : 'Sign in and continue'}<Icon name="forward" size={16}/></button>
        <p className="account-gate-privacy">A quick human check opens in a small window when you continue.</p>
      </form>}
      {!checking && mode === 'recover-email' && <form className="account-gate-form" onSubmit={sendCode}>
        <label>Account email<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} disabled={busy} autoFocus/></label>
        <button className="account-gate-submit" type="submit" disabled={busy || !email.trim()}>{busy ? 'Waiting for the human check…' : 'Email me a reset code'}<Icon name="forward" size={16}/></button>
        <p className="account-gate-privacy">A quick human check opens in a small window before the code is sent.</p>
      </form>}
      {!checking && mode === 'recover-code' && <form className="account-gate-form" onSubmit={resetPassword}>
        <label>6-digit code<input className="account-gate-code" type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/[^\d\s]/g, '').slice(0, 12))} placeholder="123456" required disabled={busy} autoFocus aria-describedby="account-gate-code-help"/></label>
        <label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="At least 10 characters" required minLength={10} maxLength={256} disabled={busy}/></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Type it again" required minLength={10} maxLength={256} disabled={busy}/></label>
        <button className="account-gate-submit" type="submit" disabled={busy}>{busy ? 'Updating your password…' : 'Reset password and sign in'}<Icon name="forward" size={16}/></button>
        <p id="account-gate-code-help" className="account-gate-privacy">No email? Check spam, wait a minute, then send a new code.{' '}
          <button className="account-gate-inline" type="button" onClick={sendCode} disabled={busy || resendWait > 0}>{resendWait > 0 ? `Send a new code in ${resendWait}s` : 'Send a new code'}</button>
        </p>
      </form>}
      {message && <p className="account-gate-message" role="status">{message}</p>}
      {!checking && !recovering && <button className="account-gate-switch" type="button" onClick={() => switchMode(mode === 'signup' ? 'signin' : 'signup')} disabled={busy}>
        {mode === 'signup' ? 'Already have a Browsery account? Sign in' : 'New to Browsery? Create an account'}
      </button>}
      {!checking && recovering && <button className="account-gate-switch" type="button" onClick={() => switchMode('signin')} disabled={busy}>Back to sign in</button>}
      <div className="account-gate-divider"/>
      <p className="account-gate-privacy"><Icon name="shield" size={15}/>Your owner controls remain device-bound and separate from your Browsery account. Your local browsing data stays on this computer.</p>
    </section>
  </div>;
}
