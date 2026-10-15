import React, { useCallback, useEffect, useRef, useState } from 'react';

// First-run setup for a signed-in account. Completion is stored per account id
// so a second Browsery account on the same computer gets its own setup.
export const onboardingKey = userId => `browsery:onboarding-v1:${userId}`;
export function onboardingComplete(userId) {
  try { return localStorage.getItem(onboardingKey(userId)) === '1'; }
  catch { return true; } // Storage unavailable: never nag on every launch.
}
export function markOnboardingComplete(userId) {
  try { localStorage.setItem(onboardingKey(userId), '1'); } catch {}
}

const STEPS = ['welcome', 'default', 'groq', 'tour', 'done'];
const GROQ_KEYS_URL = 'https://console.groq.com/keys';
const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function defaultBrowserCopy(platform) {
  if (platform === 'darwin') return {
    body: 'macOS lets only you make this choice. Browsery opens System Settings; then choose Desktop & Dock (General on older macOS) and set Default web browser to Browsery.',
    action: 'Open macOS System Settings',
  };
  if (platform === 'win32') return {
    body: 'Windows lets only you make this choice. Browsery opens Settings → Apps → Default apps; pick Browsery under Web browser, or set it for HTTP and HTTPS.',
    action: 'Open Windows default-apps settings',
  };
  return { body: 'Set Browsery as your default web browser from your system settings.', action: 'Open system settings' };
}

export function SetupWizard({ open, account, desktop, platform = '', onFinish, onOpenLink, Icon }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [defaultResult, setDefaultResult] = useState({ state: 'idle', message: '' });
  const [keyStatus, setKeyStatus] = useState({ loading: true, configured: false, encryptionAvailable: false });
  const [keyDraft, setKeyDraft] = useState('');
  const [keyMessage, setKeyMessage] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const step = STEPS[stepIndex];
  const copy = defaultBrowserCopy(platform);

  // Fresh state each time the wizard is opened (also for "Run setup again").
  useEffect(() => {
    if (!open) return;
    setStepIndex(0); setMinimized(false); setDefaultResult({ state: 'idle', message: '' });
    setKeyDraft(''); setKeyMessage(''); setKeySaved(false); setBusy(false);
  }, [open]);

  useEffect(() => {
    if (!open || step !== 'groq') return undefined;
    let live = true;
    if (!desktop?.aiKeyStatus) { setKeyStatus({ loading: false, configured: false, encryptionAvailable: false }); return undefined; }
    setKeyStatus(current => ({ ...current, loading: true }));
    desktop.aiKeyStatus().then(result => { if (live) setKeyStatus({ loading: false, ...result }); }).catch(() => { if (live) setKeyStatus({ loading: false, configured: false, encryptionAvailable: false }); });
    return () => { live = false; };
  }, [open, step, desktop]);

  const finish = useCallback((startTour = false) => onFinish({ startTour, defaultBrowser: defaultResult.state, groqKey: keySaved }), [onFinish, defaultResult.state, keySaved]);
  const next = useCallback(() => setStepIndex(index => Math.min(index + 1, STEPS.length - 1)), []);
  const back = useCallback(() => setStepIndex(index => Math.max(index - 1, 0)), []);
  // Escape skips the current step; on the last step it closes the wizard.
  const skipStep = useCallback(() => { if (step === 'done') finish(false); else next(); }, [step, finish, next]);

  // Focus the step's main control and keep Tab inside the dialog.
  useEffect(() => {
    if (!open || minimized) return undefined;
    if (!restoreFocusRef.current) restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const target = cardRef.current?.querySelector('[data-setup-autofocus]') || cardRef.current?.querySelector('[data-setup-primary]');
      target?.focus();
    });
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) skipStep(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(cardRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!cardRef.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown, true); };
  }, [open, minimized, stepIndex, skipStep, busy]);

  // The key field is disabled while secure storage is checked; focus it once ready.
  useEffect(() => {
    if (!open || minimized || step !== 'groq' || keyStatus.loading) return;
    const input = cardRef.current?.querySelector('#setup-groq-key');
    if (input && !input.disabled && (document.activeElement === document.body || !cardRef.current.contains(document.activeElement))) input.focus();
  }, [open, minimized, step, keyStatus.loading]);

  useEffect(() => {
    if (open) return;
    const previous = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (previous?.isConnected) previous.focus();
  }, [open]);

  const openDefaultSettings = async () => {
    if (busy) return;
    if (!desktop?.openDefaultBrowserSettings) { setDefaultResult({ state: 'failed', message: 'Default-browser settings open from the installed Browsery app.' }); return; }
    setBusy(true);
    try {
      const result = await desktop.openDefaultBrowserSettings();
      setDefaultResult({ state: result?.ok ? 'opened' : 'failed', message: result?.message || (result?.ok ? 'Opened your system settings.' : 'Could not open system settings.') });
    } catch { setDefaultResult({ state: 'failed', message: 'Could not open system settings. Open them from your device settings instead.' }); }
    finally { setBusy(false); }
  };

  const keyLooksValid = /^gsk_\S{20,}$/.test(keyDraft.trim());
  const saveKey = async event => {
    event?.preventDefault();
    if (busy) return;
    const draft = keyDraft.trim();
    if (!/^gsk_\S{20,}$/.test(draft)) { setKeyMessage('Groq keys start with gsk_ followed by at least 20 characters. Copy the whole key from console.groq.com/keys.'); return; }
    if (!desktop?.saveAiApiKey) { setKeyMessage('Key setup is available in the installed Browsery app.'); return; }
    setBusy(true); setKeyMessage('');
    try {
      const result = await desktop.saveAiApiKey(draft);
      if (!result?.ok) { setKeyMessage(result?.message || 'Could not save the key.'); return; }
      const verified = await desktop.aiKeyStatus?.();
      if (verified && !verified.configured) { setKeyMessage('The key could not be read back. Try saving it again.'); return; }
      if (verified) setKeyStatus({ loading: false, ...verified });
      setKeyDraft(''); setKeySaved(true); setKeyMessage('Saved and encrypted on this device.');
    } catch { setKeyMessage('Could not securely save the key.'); }
    finally { setBusy(false); }
  };

  const openGroqConsole = () => { setMinimized(true); onOpenLink?.(GROQ_KEYS_URL); };

  if (!open) return null;
  if (minimized) return <aside className="setup-resume" role="region" aria-label="Browsery setup paused">
    <div><span>BROWSERY SETUP · PAUSED</span><b>Copy your key from the Groq console, then come back.</b></div>
    <button type="button" className="setup-primary" onClick={() => setMinimized(false)} autoFocus>Resume setup<Icon name="forward" size={14}/></button>
  </aside>;

  const keyReady = keySaved || (keyStatus.configured && !keyDraft);
  const email = account?.email || 'your Browsery account';

  return <div className="setup-wizard" role="presentation">
    <section ref={cardRef} className="setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title" aria-describedby="setup-description">
      <header className="setup-top">
        <span className="setup-kicker">BROWSERY SETUP · STEP {stepIndex + 1} OF {STEPS.length}</span>
        {step !== 'done' && <button type="button" className="setup-link" onClick={() => finish(false)} disabled={busy}>Skip setup</button>}
      </header>
      <ol className="setup-progress" aria-hidden="true">{STEPS.map((id, index) => <li key={id} className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : ''}/>)}</ol>

      {step === 'welcome' && <>
        <div className="setup-mark"><img src="./assets/browsery-icon.png" alt=""/></div>
        <h2 id="setup-title" aria-live="polite">Welcome to Browsery.</h2>
        <p id="setup-description">You’re signed in as <b className="setup-email">{email}</b>. Three short, optional steps get Browsery ready for you. Everything here can be changed later.</p>
        <ul className="setup-list"><li><Icon name="globe" size={15}/>Choose your default browser</li><li><Icon name="key" size={15}/>Add a Groq key for the AI features</li><li><Icon name="help" size={15}/>Take a two-minute tour</li></ul>
      </>}

      {step === 'default' && <>
        <h2 id="setup-title" aria-live="polite">Make Browsery your default browser?</h2>
        <p id="setup-description">{copy.body} Browsery never changes this by itself.</p>
        <button type="button" data-setup-autofocus={defaultResult.state === 'opened' ? undefined : true} className="setup-wide" onClick={openDefaultSettings} disabled={busy}><Icon name="settings" size={16}/><span>{busy ? 'Opening…' : copy.action}</span><Icon name="forward" size={15}/></button>
        {defaultResult.message && <p className="setup-message" role="status">{defaultResult.message}</p>}
      </>}

      {step === 'groq' && <>
        <h2 id="setup-title" aria-live="polite">Add your Groq API key <em className="setup-chip">Optional</em></h2>
        <p id="setup-description">Groq powers <b>Hey Groq</b>, <b>Analyze with Groq</b> and the <b>AI Overview</b> on Browsery search. The key is stored encrypted on this device, is never shared, and Groq usage follows your own plan.</p>
        <button type="button" className="setup-text-link" onClick={openGroqConsole}><Icon name="link" size={14}/>Get a key at console.groq.com/keys<span className="setup-visually-hidden"> (opens in a Browsery tab)</span></button>
        {keyReady ? <div className="setup-saved" role="status"><span aria-hidden="true">✓</span><div><b>{keySaved ? 'Key saved' : 'A Groq key is already saved'}</b><small>Encrypted on this device · change it any time in Settings → AI Overview</small></div></div>
          : <form className="setup-form" onSubmit={saveKey}>
            <label htmlFor="setup-groq-key">Groq API key</label>
            <input id="setup-groq-key" data-setup-autofocus type="password" autoComplete="off" spellCheck="false" value={keyDraft} onChange={event => { setKeyDraft(event.target.value); setKeyMessage(''); }} placeholder="gsk_…" disabled={busy || keyStatus.loading || (!keyStatus.encryptionAvailable && Boolean(desktop?.aiKeyStatus))} aria-invalid={Boolean(keyDraft) && !keyLooksValid} aria-describedby="setup-key-hint"/>
            <small id="setup-key-hint" className={keyDraft && !keyLooksValid ? 'warning' : ''}>{keyStatus.loading ? 'Checking secure storage…' : !keyStatus.encryptionAvailable && desktop?.aiKeyStatus ? 'Secure storage is unavailable on this device, so the key cannot be saved.' : keyDraft && !keyLooksValid ? 'Groq keys start with gsk_.' : 'Paste the key that starts with gsk_.'}</small>
          </form>}
        {keyMessage && <p className="setup-message" role="status">{keyMessage}</p>}
      </>}

      {step === 'tour' && <>
        <h2 id="setup-title" aria-live="polite">Take the quick tour?</h2>
        <p id="setup-description">A short guided tour opens the real panels: tabs and search, extensions, privacy, Groq and settings. It takes about two minutes and never changes a setting. Replay it any time with Guide at the far right of the toolbar.</p>
      </>}

      {step === 'done' && <>
        <h2 id="setup-title" aria-live="polite">You’re all set.</h2>
        <p id="setup-description">Browsery is ready. A few things worth knowing:</p>
        <ul className="setup-list">
          <li><Icon name="globe" size={15}/>{defaultResult.state === 'opened' ? 'Default-browser settings were opened for you.' : 'Default browser: Settings → Browser → Personal browser.'}</li>
          <li><Icon name="key" size={15}/>{keySaved || keyStatus.configured ? 'Your Groq key is saved on this device.' : 'Groq key: Settings → AI Overview, whenever you want AI features.'}</li>
          <li><Icon name="support" size={15}/>Questions? Help &amp; Support is the chat button next to Guide.</li>
          <li><Icon name="reload" size={15}/>Run this setup again from Settings → Browser → Setup wizard.</li>
        </ul>
      </>}

      <footer className="setup-actions">
        {stepIndex > 0 && step !== 'done' ? <button type="button" className="setup-secondary" onClick={back} disabled={busy}>Back</button> : <span/>}
        <div>
          {step === 'welcome' && <button type="button" data-setup-primary className="setup-primary" onClick={next}>Let’s go<Icon name="forward" size={15}/></button>}
          {step === 'default' && <><button type="button" className="setup-secondary" onClick={next} disabled={busy}>{defaultResult.state === 'opened' ? 'Skip' : 'Not now'}</button>{defaultResult.state === 'opened' && <button type="button" data-setup-primary className="setup-primary" onClick={next}>Continue<Icon name="forward" size={15}/></button>}</>}
          {step === 'groq' && <>{!keyReady && <button type="button" className="setup-secondary" onClick={next} disabled={busy}>Skip</button>}{keyReady ? <button type="button" data-setup-primary className="setup-primary" onClick={next}>Continue<Icon name="forward" size={15}/></button> : <button type="button" data-setup-primary className="setup-primary" onClick={saveKey} disabled={busy || !keyDraft.trim()}>{busy ? 'Saving…' : 'Save key'}</button>}</>}
          {step === 'tour' && <><button type="button" className="setup-secondary" onClick={next}>Skip</button><button type="button" data-setup-primary className="setup-primary" onClick={() => finish(true)}>Start tour<Icon name="forward" size={15}/></button></>}
          {step === 'done' && <button type="button" data-setup-primary className="setup-primary" onClick={() => finish(false)}>Start browsing<Icon name="forward" size={15}/></button>}
        </div>
      </footer>
      <p className="setup-hint">Esc skips a step</p>
    </section>
  </div>;
}
