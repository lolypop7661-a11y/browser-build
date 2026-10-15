import React, { useEffect, useMemo, useRef, useState } from 'react';
import './chill.css';

// Chill mode: Browsery as a plain, everyday browser. The visual and sound
// settings underneath are kept untouched; Chill mode only overrides what is
// shown, so turning it off brings back exactly what the user had before.
export const CHILL_OVERRIDES = Object.freeze({
  power: true, cursorEnabled: false, ambience: false, clicks: false, hover: false, visualizer: false,
  startup: false, downloadtone: false, spatialaudio: false, haptic: 0, motionStrength: 0,
  refraction: false, parallax: false, shards: false, shadows: false, bloom: 0, tilt: 0, blur: 0,
});

export function readSavedChill() {
  try { return JSON.parse(localStorage.getItem('browsery:settings') || '{}').chill === true; }
  catch { return false; }
}

export function chillView(settings) {
  return settings?.chill ? { ...settings, ...CHILL_OVERRIDES } : settings;
}

function hostOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return String(value || ''); }
}

export function normalizeShortcutUrl(raw) {
  const candidate = String(raw || '').trim();
  if (!candidate) return '';
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try { const parsed = new URL(withProtocol); return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.') ? parsed.href : ''; }
  catch { return ''; }
}

// Electron has no window.prompt(), so shortcuts are added and edited here.
export function ShortcutEditor({ shortcut, onSave, onRemove, onCancel, Icon }) {
  const editing = Boolean(shortcut?.id);
  const [label, setLabel] = useState(shortcut?.label || '');
  const [address, setAddress] = useState(shortcut?.url || '');
  const [error, setError] = useState('');
  const cardRef = useRef(null);
  useEffect(() => {
    const first = cardRef.current?.querySelector(editing ? '#shortcut-name' : '#shortcut-url');
    first?.focus(); first?.select?.();
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [editing, onCancel]);
  const submit = event => {
    event.preventDefault();
    const url = normalizeShortcutUrl(address);
    if (!url) { setError('Enter a website address, like wikipedia.org'); return; }
    onSave({ ...(shortcut || {}), url, label: label.trim().slice(0, 32) || hostOf(url) });
  };
  return <div className="shortcut-editor-scrim" onPointerDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <form ref={cardRef} className="shortcut-editor" role="dialog" aria-modal="true" aria-labelledby="shortcut-editor-title" onSubmit={submit}>
      <h2 id="shortcut-editor-title">{editing ? 'Edit shortcut' : 'Add shortcut'}</h2>
      <label htmlFor="shortcut-name">Name</label>
      <input id="shortcut-name" value={label} onChange={event => setLabel(event.target.value)} placeholder="Optional" maxLength={32} autoComplete="off"/>
      <label htmlFor="shortcut-url">Website</label>
      <input id="shortcut-url" value={address} onChange={event => { setAddress(event.target.value); setError(''); }} placeholder="wikipedia.org" autoComplete="off" spellCheck="false" aria-invalid={Boolean(error)} aria-describedby={error ? 'shortcut-error' : undefined}/>
      {error && <p id="shortcut-error" className="shortcut-error" role="alert">{error}</p>}
      <div className="shortcut-editor-actions">
        {editing && <button type="button" className="chill-button danger" onClick={() => onRemove(shortcut)}><Icon name="trash" size={14}/>Remove</button>}
        <span/>
        <button type="button" className="chill-button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="chill-button primary">{editing ? 'Save' : 'Add'}</button>
      </div>
    </form>
  </div>;
}

function useClock(style) {
  const [time, setTime] = useState('');
  useEffect(() => {
    if (style === 'Hidden') return undefined;
    let timer = 0;
    const tick = () => {
      setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: style === '12-hour' }));
      timer = setTimeout(tick, 60000 - Date.now() % 60000 + 50);
    };
    tick();
    return () => clearTimeout(timer);
  }, [style]);
  return time;
}

export function ChillNewTab({ onSearch, settings, shortcuts, onUpdateShortcuts, Icon, Favicon }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const time = useClock(settings.clockStyle);
  const inputRef = useRef(null);
  useEffect(() => { const frame = requestAnimationFrame(() => inputRef.current?.focus()); return () => cancelAnimationFrame(frame); }, []);
  const engine = settings.engine === 'Browsery' ? 'the web' : settings.engine;
  const save = value => {
    if (value.id) onUpdateShortcuts(shortcuts.map(item => item.id === value.id ? { ...item, url: value.url, label: value.label } : item));
    else onUpdateShortcuts([...shortcuts, { id: `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url: value.url, label: value.label, color: '#c8d8e7' }]);
    setEditing(null);
  };
  const remove = value => { onUpdateShortcuts(shortcuts.filter(item => item.id !== value.id)); setEditing(null); };
  return <main className="chill-new-tab">
    <div className="chill-home">
      {time && <time className="chill-clock">{time}</time>}
      <form className="chill-search" role="search" onSubmit={event => { event.preventDefault(); if (query.trim()) onSearch(query); }}>
        <Icon name="search" size={18}/>
        <input ref={inputRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${engine} or type a web address`} aria-label="Search or type a web address" autoComplete="off"/>
      </form>
      {settings.showFavorites && <ul className="chill-shortcuts" aria-label="Shortcuts">
        {shortcuts.map(shortcut => <li key={shortcut.id}>
          <a href={shortcut.url} onClick={event => { event.preventDefault(); onSearch(shortcut.url); }} onContextMenu={event => { event.preventDefault(); setEditing(shortcut); }} title={shortcut.url}>
            <span className="chill-shortcut-icon"><Favicon url={shortcut.url} title={shortcut.label}/></span>
            <span className="chill-shortcut-label">{shortcut.label || hostOf(shortcut.url)}</span>
          </a>
          <button type="button" className="chill-shortcut-edit" onClick={() => setEditing(shortcut)} aria-label={`Edit ${shortcut.label || 'shortcut'}`}><Icon name="more" size={14}/></button>
        </li>)}
        {shortcuts.length < 12 && <li><button type="button" className="chill-shortcut-add" onClick={() => setEditing({})}>
          <span className="chill-shortcut-icon"><Icon name="plus" size={18}/></span>
          <span className="chill-shortcut-label">Add shortcut</span>
        </button></li>}
      </ul>}
    </div>
    {editing && <ShortcutEditor shortcut={editing} onSave={save} onRemove={remove} onCancel={() => setEditing(null)} Icon={Icon}/>}
  </main>;
}

// The overflow menu that holds everything a plain toolbar leaves out.
export function ChillMenu({ items, Icon }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  const wrapRef = useRef(null), buttonRef = useRef(null);
  const actionable = useMemo(() => items.filter(item => item && !item.divider), [items]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); setFocus(index => (index + 1) % actionable.length); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setFocus(index => (index - 1 + actionable.length) % actionable.length); }
      else if (event.key === 'Home') { event.preventDefault(); setFocus(0); }
      else if (event.key === 'End') { event.preventDefault(); setFocus(actionable.length - 1); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); };
  }, [open, actionable.length]);
  useEffect(() => { if (open) wrapRef.current?.querySelectorAll('[role=menuitem]')[focus]?.focus(); }, [open, focus]);
  const run = item => { setOpen(false); item.run(); };
  let index = -1;
  return <div className="chill-menu-wrap" ref={wrapRef}>
    <button ref={buttonRef} type="button" className={`chill-icon ${open ? 'active' : ''}`} aria-label="Menu" title="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => { setFocus(0); setOpen(value => !value); }}><Icon name="more" size={18}/></button>
    {open && <div className="chill-menu" role="menu" aria-label="Browsery menu">
      {items.filter(Boolean).map((item, position) => {
        if (item.divider) return <hr key={`divider-${position}`}/>;
        index += 1; const mine = index;
        return <button key={item.id} type="button" role="menuitem" tabIndex={mine === focus ? 0 : -1} onMouseEnter={() => setFocus(mine)} onClick={() => run(item)} className={item.accent ? 'accent' : ''}>
          <Icon name={item.icon} size={16}/><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>;
      })}
    </div>}
  </div>;
}

export function ChillSettingsCard({ on, onChange }) {
  return <section className={`chill-settings-card ${on ? 'on' : ''}`} data-tour="setting-chill">
    <div>
      <b>Chill mode</b>
      <p>{on
        ? 'Browsery is a normal browser right now: no launch video, 3D, sounds, cursor trail or bouncy animations. Your graphics, motion and sound settings are saved and come back when you turn this off.'
        : 'Turn Browsery into a plain, fast browser: no launch video, 3D, sounds, cursor trail or bouncy animations, and a simpler toolbar. Nothing else changes.'}</p>
    </div>
    <button type="button" className={`chill-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label="Chill mode" onClick={() => onChange(!on)}><i/></button>
  </section>;
}

export const CHILL_PAUSED_SECTIONS = new Set(['graphics', 'spatial', 'sound']);
