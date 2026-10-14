import React, { useEffect, useState } from 'react';

/** Full-window account gate shown directly after Browsery's launch sequence. */
export function AccountGate({ desktop, onAuthenticated, Icon, checking = false, initialMessage = '' }) {
  const [mode, setMode] = useState('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (initialMessage) setMessage(initialMessage); }, [initialMessage]);

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
        setMessage('Check your email to confirm your Browsery account, then sign in here.');
        return;
      }
      if (!result.account) {
        setMessage(result.message || 'Your account is not ready yet. Sign in after confirming your email.');
        return;
      }
      onAuthenticated(result.account);
    } catch {
      setMessage('Browsery could not reach the account service. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="account-gate" role="dialog" aria-modal="true" aria-labelledby="account-gate-title">
    <div className="account-gate-stars" aria-hidden="true"/>
    <div className="account-gate-orbit account-gate-orbit-one" aria-hidden="true"/>
    <div className="account-gate-orbit account-gate-orbit-two" aria-hidden="true"/>
    <section className="account-gate-card">
      <div className="account-gate-brand"><img src="./assets/browsery-icon.png" alt=""/><span>Browsery</span></div>
      <span className="account-gate-kicker">YOUR BROWSER · YOUR ACCOUNT</span>
      <h1 id="account-gate-title">{checking ? 'Checking your account.' : mode === 'signup' ? 'Start with your account.' : 'Welcome back.'}</h1>
      <p className="account-gate-description">{checking ? 'One moment while Browsery checks this device.' : mode === 'signup' ? 'Create a Browsery account to continue. This is required for every user, including the owner.' : 'Sign in to continue to your Browsery space.'}</p>
      {!checking && <form className="account-gate-form" onSubmit={submit}>
        <label>Email address<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} disabled={busy} autoFocus/></label>
        <label>Password<input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'At least 10 characters' : 'Your password'} required minLength={mode === 'signup' ? 10 : 1} maxLength={256} disabled={busy}/></label>
        <button className="account-gate-submit" type="submit" disabled={busy}>{busy ? 'Connecting…' : mode === 'signup' ? 'Create account and continue' : 'Sign in and continue'}<Icon name="forward" size={16}/></button>
      </form>}
      {message && <p className="account-gate-message" role="status">{message}</p>}
      {!checking && <button className="account-gate-switch" type="button" onClick={() => { setMode(current => current === 'signup' ? 'signin' : 'signup'); setPassword(''); setMessage(''); }} disabled={busy}>
        {mode === 'signup' ? 'Already have a Browsery account? Sign in' : 'New to Browsery? Create an account'}
      </button>}
      <div className="account-gate-divider"/>
      <p className="account-gate-privacy"><Icon name="shield" size={15}/>Your owner controls remain device-bound and separate from your Browsery account. Your local browsing data stays on this computer.</p>
    </section>
  </div>;
}
