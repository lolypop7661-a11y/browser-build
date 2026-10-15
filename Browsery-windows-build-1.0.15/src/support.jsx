import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSpringPresence } from './motion.js';

export const SUPPORT_CATEGORIES = [
  ['bug', 'Something is broken'],
  ['account', 'Account or sign-in'],
  ['feature', 'Feature request'],
  ['question', 'Question'],
  ['other', 'Other'],
];
const CATEGORY_LABELS = Object.fromEntries(SUPPORT_CATEGORIES);
const STATUS_LABELS = { open: 'Open', answered: 'Answered', closed: 'Closed' };
const PLATFORM_LABELS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
const BACKGROUND_REFRESH_MS = 10 * 60 * 1000;

const desktop = () => window.browseryDesktop;
const seenKey = userId => `browsery:support-seen-v1:${userId}`;
function readSeen(userId) {
  try { const value = JSON.parse(localStorage.getItem(seenKey(userId)) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
function writeSeen(userId, seen) { try { localStorage.setItem(seenKey(userId), JSON.stringify(seen)); } catch {} }
const time = value => { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; };
const dateLabel = value => { try { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch { return 'Recently'; } };
export const platformLabel = value => PLATFORM_LABELS[String(value || '').split(' ')[0]] || String(value || '') || 'Unknown system';

// Latest reply from the Browsery team, used for the unread badge.
const lastOwnerReply = ticket => (ticket.messages || []).filter(message => message.author === 'owner').reduce((latest, message) => Math.max(latest, time(message.createdAt)), 0);
const isUnread = (ticket, seen) => { const reply = lastOwnerReply(ticket); return reply > 0 && reply > (Number(seen[ticket.id]) || 0); };

export function SupportDrawer({ open, onClose, account, appVersion = '', platform = '', voiceAvailable = true, onAskGroq, onRunSetup, onUnreadChange = () => {}, Icon, Button, CloseButton }) {
  const panelRef = useSpringPresence(open, { preset: 'fluid', offset: 90 });
  const userId = account?.id || '';
  const [view, setView] = useState('tickets');
  const [tickets, setTickets] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState('');
  const [seen, setSeen] = useState(() => (userId ? readSeen(userId) : {}));
  const [draft, setDraft] = useState({ category: 'question', subject: '', body: '' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const subjectRef = useRef(null);

  useEffect(() => { setSeen(userId ? readSeen(userId) : {}); setTickets([]); setLoaded(false); setExpanded(''); }, [userId]);

  const unread = useMemo(() => tickets.filter(ticket => isUnread(ticket, seen)).length, [tickets, seen]);
  useEffect(() => { onUnreadChange(unread); }, [unread, onUnreadChange]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const api = desktop();
    if (!api?.supportList || !userId) return;
    if (!quiet) { setBusy('load'); setMessage(''); }
    try {
      const result = await api.supportList();
      if (result?.ok) { setTickets(Array.isArray(result.tickets) ? result.tickets : []); setLoaded(true); }
      else if (!quiet) setMessage(result?.message || 'Could not load your tickets.');
    } catch { if (!quiet) setMessage('Could not reach Browsery support.'); }
    finally { if (!quiet) setBusy(''); }
  }, [userId]);

  // Refresh when opened, and quietly in the background so a reply can show a badge.
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (!userId) return undefined;
    const first = setTimeout(() => load({ quiet: true }), 20_000);
    const timer = setInterval(() => load({ quiet: true }), BACKGROUND_REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [userId, load]);

  const markSeen = useCallback(ticket => {
    const reply = lastOwnerReply(ticket);
    if (!userId || !reply) return;
    setSeen(current => {
      if ((Number(current[ticket.id]) || 0) >= reply) return current;
      const next = { ...current, [ticket.id]: reply };
      writeSeen(userId, next);
      return next;
    });
  }, [userId]);

  // An expanded thread counts as read, including replies that arrive while it is open.
  useEffect(() => {
    if (!open || !expanded) return;
    const ticket = tickets.find(item => item.id === expanded);
    if (ticket) markSeen(ticket);
  }, [open, expanded, tickets, markSeen]);

  const toggleTicket = id => { setReply(''); setMessage(''); setExpanded(current => current === id ? '' : id); };

  const create = async event => {
    event.preventDefault();
    if (busy) return;
    const subject = draft.subject.trim(), body = draft.body.trim();
    if (!subject || !body) { setMessage('Add a subject and a message.'); return; }
    if (!desktop()?.supportCreate) { setMessage('Support is available in the installed Browsery app.'); return; }
    setBusy('create'); setMessage('');
    try {
      const result = await desktop().supportCreate({ category: draft.category, subject, body });
      if (!result?.ok) { setMessage(result?.message || 'Could not send your ticket.'); return; }
      setTickets(Array.isArray(result.tickets) ? result.tickets : []); setLoaded(true);
      setDraft({ category: 'question', subject: '', body: '' });
      setView('tickets'); setExpanded(result.ticketId || '');
      setMessage('Ticket sent. The Browsery team will reply here.');
    } catch { setMessage('Could not reach Browsery support.'); }
    finally { setBusy(''); }
  };

  const sendReply = async (event, ticket) => {
    event.preventDefault();
    const body = reply.trim();
    if (busy || !body) return;
    setBusy('reply'); setMessage('');
    try {
      const result = await desktop()?.supportReply?.({ ticketId: ticket.id, body });
      if (!result?.ok) { setMessage(result?.message || 'Could not send your reply.'); return; }
      setTickets(Array.isArray(result.tickets) ? result.tickets : []); setReply('');
    } catch { setMessage('Could not reach Browsery support.'); }
    finally { setBusy(''); }
  };

  const closeTicket = async ticket => {
    if (busy || !window.confirm('Close this ticket? You can open a new one any time.')) return;
    setBusy('close'); setMessage('');
    try {
      const result = await desktop()?.supportClose?.(ticket.id);
      if (!result?.ok) { setMessage(result?.message || 'Could not close the ticket.'); return; }
      setTickets(Array.isArray(result.tickets) ? result.tickets : []); setMessage('Ticket closed.');
    } catch { setMessage('Could not reach Browsery support.'); }
    finally { setBusy(''); }
  };

  const startTicket = () => { setView('new'); setMessage(''); requestAnimationFrame(() => subjectRef.current?.focus()); };
  const openCount = tickets.filter(ticket => ticket.status !== 'closed').length;

  return <aside ref={panelRef} className={`drawer support-drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Help and support">
    <div className="drawer-head"><div><h2>Help &amp; Support</h2></div><CloseButton icon="close" label="Close help and support" onClick={onClose}/></div>
    <div className="support-body">
      <section className="support-quick">
        {voiceAvailable && <button type="button" className="support-groq" onClick={onAskGroq} disabled={!open}><span className="support-groq-icon"><Icon name="spark" size={17}/></span><span><b>Ask Hey Groq first</b><small>Instant answers about Browsery’s buttons, settings and extensions.</small></span><Icon name="forward" size={15}/></button>}
        <div className="support-quick-row"><button type="button" className="support-text-button" onClick={onRunSetup} disabled={!open}><Icon name="reload" size={13}/>Run setup again</button></div>
      </section>

      <div className="support-tabs" role="tablist" aria-label="Support views">
        <button type="button" role="tab" aria-selected={view === 'tickets'} className={view === 'tickets' ? 'active' : ''} onClick={() => { setView('tickets'); setMessage(''); }} disabled={!open}>My tickets{tickets.length ? <em>{openCount}</em> : null}{unread > 0 && <i className="support-dot" aria-label={`${unread} unread replies`}/>}</button>
        <button type="button" role="tab" aria-selected={view === 'new'} className={view === 'new' ? 'active' : ''} onClick={startTicket} disabled={!open}><Icon name="plus" size={13}/>New ticket</button>
      </div>

      {view === 'new' && <form className="support-form" onSubmit={create}>
        <label>Topic<select value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} disabled={Boolean(busy)}>{SUPPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Subject<input ref={subjectRef} value={draft.subject} onChange={event => setDraft(current => ({ ...current, subject: event.target.value }))} maxLength={120} required placeholder="A short summary" disabled={Boolean(busy)}/><small className="support-count">{draft.subject.length}/120</small></label>
        <label>Message<textarea value={draft.body} onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} maxLength={4000} required placeholder="What happened, what you expected, and the steps to see it again." disabled={Boolean(busy)}/><small className="support-count">{draft.body.length}/4000</small></label>
        <p className="support-meta"><Icon name="alert" size={13}/>Attached automatically: Browsery {appVersion || 'version unknown'} · {platformLabel(platform)} · your account email. Never include passwords or API keys.</p>
        <Button type="submit" className="support-submit" disabled={Boolean(busy) || !draft.subject.trim() || !draft.body.trim()}>{busy === 'create' ? 'Sending…' : 'Send ticket'}</Button>
      </form>}

      {view === 'tickets' && <section className="support-list" aria-busy={busy === 'load'}>
        <div className="support-list-head"><span>{loaded ? `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}` : 'Your tickets'}</span><button type="button" className="support-text-button" onClick={() => load()} disabled={Boolean(busy) || !open}><Icon name="refresh" size={13}/>{busy === 'load' ? 'Refreshing…' : 'Refresh'}</button></div>
        {tickets.map(ticket => {
          const isOpen = expanded === ticket.id;
          const fresh = isUnread(ticket, seen);
          return <article key={ticket.id} className={`support-ticket ${isOpen ? 'expanded' : ''}`}>
            <button type="button" className="support-ticket-summary" onClick={() => toggleTicket(ticket.id)} aria-expanded={isOpen}>
              <span className="support-ticket-title">{fresh && <i className="support-dot" aria-hidden="true"/>}<b>{ticket.subject}</b></span>
              <span className={`support-status status-${ticket.status}`}>{fresh ? 'New reply' : STATUS_LABELS[ticket.status] || 'Open'}</span>
              <small>{CATEGORY_LABELS[ticket.category] || 'Other'} · updated {dateLabel(ticket.updatedAt || ticket.createdAt)}</small>
            </button>
            {isOpen && <div className="support-thread">
              <div className="support-message from-user"><span>You · {dateLabel(ticket.createdAt)}</span><p>{ticket.body}</p></div>
              {ticket.messages.map(item => <div key={item.id} className={`support-message from-${item.author}`}><span>{item.author === 'owner' ? 'Browsery team' : 'You'} · {dateLabel(item.createdAt)}</span><p>{item.body}</p></div>)}
              {ticket.status === 'closed' ? <p className="support-note">This ticket is closed. Open a new ticket if you still need help.</p> : <form className="support-reply" onSubmit={event => sendReply(event, ticket)}>
                <label className="support-visually-hidden" htmlFor={`support-reply-${ticket.id}`}>Reply</label>
                <textarea id={`support-reply-${ticket.id}`} value={reply} onChange={event => setReply(event.target.value)} maxLength={4000} placeholder="Write a reply…" disabled={Boolean(busy)}/>
                <div><button type="button" className="support-text-button" onClick={() => closeTicket(ticket)} disabled={Boolean(busy)}>Close ticket</button><Button type="submit" disabled={Boolean(busy) || !reply.trim()}>{busy === 'reply' ? 'Sending…' : 'Send reply'}</Button></div>
              </form>}
            </div>}
          </article>;
        })}
        {loaded && !tickets.length && <div className="support-empty"><Icon name="support" size={22}/><b>No tickets yet</b><span>Ask Hey Groq for quick answers, or open a ticket and the Browsery team will reply here.</span><button type="button" className="support-text-button" onClick={startTicket}>Open a ticket</button></div>}
        {!loaded && busy !== 'load' && !message && <p className="support-note">Open this panel while signed in to see your tickets.</p>}
      </section>}

      {message && <p className="support-message-line" role="status">{message}</p>}
      <p className="support-footnote">Replies from the Browsery team appear in this panel; a dot on the Help &amp; Support button means there is a new reply. Tickets are stored with your account on Browsery’s server.</p>
    </div>
  </aside>;
}
