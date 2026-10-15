import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
   Command palette (Ctrl+K)
   One box for everything: switch to an open tab, run a browser action, open a
   bookmark or a page from history, go to an address, search the web, or hand
   the question to Hey Groq. Fully keyboard driven, and it never sends
   anything anywhere by itself: every row runs only when it is chosen.
   --------------------------------------------------------------------------- */

const LIMITS = { tabs: 6, actions: 8, bookmarks: 5, history: 5 };

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function looksLikeAddress(value) {
  const text = String(value || '').trim();
  if (!text || /\s/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(text)) return true;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?(\/\S*)?$/i.test(text);
}

/* Each word of the query must match: substring beats subsequence, a match at
   a word boundary beats one in the middle, earlier beats later. */
function wordScore(haystack, word, fuzzy = true) {
  const at = haystack.indexOf(word);
  if (at === 0) return 100;
  if (at > 0) return (/[\s\-_./:·]/.test(haystack[at - 1]) ? 82 : 60) - Math.min(at, 40) * 0.2;
  if (!fuzzy) return 0;
  let from = 0, last = -1, gaps = 0;
  for (const ch of word) {
    const found = haystack.indexOf(ch, from);
    if (found < 0) return 0;
    if (last >= 0) gaps += found - last - 1;
    last = found;
    from = found + 1;
  }
  // A subsequence scattered across a long string is noise, not a match.
  if (gaps > word.length * 3) return 0;
  return Math.max(1, 34 - gaps * 1.5);
}

export function scoreItem(item, words) {
  if (!words.length) return 1;
  const haystack = `${item.title} ${item.subtitle || ''} ${item.keywords || ''}`.toLowerCase();
  const title = item.title.toLowerCase();
  let total = 0;
  for (const word of words) {
    // Substring anywhere, or a typed abbreviation of the title itself ("clt" for Close tab).
    const s = wordScore(haystack, word, false) || wordScore(title, word, true);
    if (!s) return 0;
    total += s;
  }
  // A title hit is worth more than a hit in the address or keywords.
  if (item.title.toLowerCase().includes(words[0])) total += 12;
  return total;
}

function rank(items, words, limit) {
  return items
    .map((item, order) => ({ item, s: scoreItem(item, words), order }))
    .filter(entry => entry.s > 0)
    .sort((a, b) => b.s - a.s || a.order - b.order)
    .slice(0, limit)
    .map(entry => ({ ...entry.item, score: entry.s }));
}

export function CommandPalette({
  open, onClose, tabs = [], activeTabId, bookmarks = [], history = [], commands = [],
  onSwitchTab, onOpenUrl, onSearch, onAskGroq, canAskGroq = true, resolveUrl, Icon,
}) {
  const listId = useId();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const returnFocus = useRef(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [shown, setShown] = useState(open);

  // Keep it mounted for the closing fade, then unmount.
  useEffect(() => {
    if (open) { setShown(true); return undefined; }
    const timer = setTimeout(() => setShown(false), 160);
    return () => clearTimeout(timer);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    setQuery('');
    setCursor(0);
    const focus = () => { inputRef.current?.focus(); inputRef.current?.select(); };
    focus();
    // A webview can hold focus for a frame after the shortcut arrives.
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6), [query]);

  const groups = useMemo(() => {
    const q = query.trim();
    const out = [];

    const tabItems = tabs.map(tab => ({
      id: `tab-${tab.id}`,
      icon: tab.pinned ? 'pin' : 'globe',
      title: tab.title || hostOf(tab.url) || 'New Space',
      subtitle: tab.url && !String(tab.url).startsWith('browsery:') ? hostOf(tab.url) : 'Browsery',
      hint: tab.id === activeTabId ? 'Current' : 'Switch',
      run: () => onSwitchTab?.(tab.id),
    }));
    const tabHits = rank(tabItems, words, LIMITS.tabs);
    const actionHits = rank(commands.filter(cmd => !cmd.hidden), words, words.length ? LIMITS.actions : 14);

    let urlItem = null;
    if (q && looksLikeAddress(q)) {
      const target = resolveUrl ? resolveUrl(q) : q;
      if (target) urlItem = { id: 'go-url', icon: 'link', title: `Open ${q}`, subtitle: 'In a new tab', hint: 'Go', run: () => onOpenUrl?.(target) };
    }
    if (urlItem) out.push({ label: 'Go to', items: [urlItem] });

    if (tabHits.length) out.push({ label: 'Open tabs', items: tabHits });
    if (actionHits.length) out.push({ label: 'Actions', items: actionHits });

    if (words.length) {
      const seen = new Set(tabs.map(tab => tab.url));
      const bookmarkItems = bookmarks.map((item, index) => ({
        id: `bm-${index}`, icon: 'bookmark', title: item.title || hostOf(item.url) || item.url,
        subtitle: hostOf(item.url) || item.url, keywords: item.folder || '', hint: 'Bookmark',
        url: item.url, run: () => onOpenUrl?.(item.url),
      }));
      const bookmarkHits = rank(bookmarkItems, words, LIMITS.bookmarks);
      bookmarkHits.forEach(item => seen.add(item.url));
      if (bookmarkHits.length) out.push({ label: 'Bookmarks', items: bookmarkHits });

      const historyItems = [];
      const historySeen = new Set();
      for (const item of history) {
        if (!item?.url || historySeen.has(item.url) || seen.has(item.url)) continue;
        historySeen.add(item.url);
        historyItems.push({
          id: `hist-${historyItems.length}`, icon: 'history', title: item.title || hostOf(item.url) || item.url,
          subtitle: hostOf(item.url) || item.url, hint: 'History', run: () => onOpenUrl?.(item.url),
        });
        if (historyItems.length >= 200) break;
      }
      const historyHits = rank(historyItems, words, LIMITS.history);
      if (historyHits.length) out.push({ label: 'History', items: historyHits });

      const fallbacks = [];
      if (!urlItem) fallbacks.push({ id: 'go-search', icon: 'search', title: `Search the web for “${q}”`, subtitle: 'In a new tab', hint: 'Search', run: () => onSearch?.(q) });
      if (canAskGroq) fallbacks.push({ id: 'go-groq', icon: 'spark', title: `Ask Hey Groq: “${q}”`, subtitle: 'Sends this question to Groq', hint: 'Ask', run: () => onAskGroq?.(q) });
      if (fallbacks.length) out.push({ label: out.length ? 'Or' : 'No matches. Try', items: fallbacks });
    }
    // With a query, the group holding the strongest match leads. "Go to" stays
    // first (an address is unambiguous) and the search fallbacks stay last.
    if (words.length) {
      const head = out[0]?.label === 'Go to' ? [out.shift()] : [];
      const tail = out.length && ['Or', 'No matches. Try'].includes(out[out.length - 1].label) ? [out.pop()] : [];
      out.sort((a, b) => Math.max(...b.items.map(i => i.score || 0)) - Math.max(...a.items.map(i => i.score || 0)));
      return [...head, ...out, ...tail];
    }
    return out;
  }, [query, words, tabs, activeTabId, commands, bookmarks, history, canAskGroq, resolveUrl, onSwitchTab, onOpenUrl, onSearch, onAskGroq]);

  const flat = useMemo(() => groups.flatMap(group => group.items), [groups]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { if (cursor >= flat.length) setCursor(Math.max(0, flat.length - 1)); }, [flat.length, cursor]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector('[aria-selected="true"]');
    node?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor, open, flat.length]);

  const close = useCallback((restore = true) => {
    onClose?.();
    if (restore) {
      const target = returnFocus.current;
      if (target && target.isConnected && typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); } catch {}
      }
    }
  }, [onClose]);

  const runItem = useCallback(item => {
    if (!item) return;
    close(false);
    // Let the palette leave before the action moves focus or opens a panel.
    requestAnimationFrame(() => { try { item.run?.(); } catch (error) { console.warn('Command failed:', error); } });
  }, [close]);

  const onKeyDown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (flat.length) setCursor(c => (c + 1) % flat.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); if (flat.length) setCursor(c => (c - 1 + flat.length) % flat.length); }
    else if (event.key === 'Home' && event.ctrlKey) { event.preventDefault(); setCursor(0); }
    else if (event.key === 'End' && event.ctrlKey) { event.preventDefault(); setCursor(Math.max(0, flat.length - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); runItem(flat[cursor]); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { event.preventDefault(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); close(true); }
  };

  // Render on the very first open frame too, so the focus effect finds the input.
  if (!open && !shown) return null;
  const activeId = flat[cursor] ? `${listId}-${flat[cursor].id}` : undefined;
  let index = -1;

  return <div className={`palette-scrim ${open ? 'open' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) close(true); }}>
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="palette-input">
        <Icon name="search" size={17}/>
        <input
          ref={inputRef}
          value={query}
          onChange={event => setQuery(event.target.value.slice(0, 200))}
          onKeyDown={onKeyDown}
          placeholder="Search tabs, actions, bookmarks, or ask Hey Groq"
          aria-label="Command palette search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-list" id={listId} role="listbox" ref={listRef} aria-label="Results">
        {groups.length === 0 && <div className="palette-empty">Type to search your tabs, actions, bookmarks and history.</div>}
        {groups.map(group => <div className="palette-group" role="group" aria-label={group.label} key={group.label}>
          <div className="palette-group-label" aria-hidden="true">{group.label}</div>
          {group.items.map(item => {
            index += 1;
            const mine = index;
            const selected = mine === cursor;
            return <div
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={selected}
              className={`palette-item ${selected ? 'is-active' : ''}`}
              onMouseMove={() => { if (cursor !== mine) setCursor(mine); }}
              onMouseDown={event => event.preventDefault()}
              onClick={() => runItem(item)}
            >
              <span className="palette-icon"><Icon name={item.icon || 'spark'} size={15}/></span>
              <span className="palette-copy"><b>{item.title}</b>{item.subtitle && <small>{item.subtitle}</small>}</span>
              {item.shortcut ? <kbd className="palette-hint">{item.shortcut}</kbd> : item.hint ? <span className="palette-hint">{item.hint}</span> : null}
            </div>;
          })}
        </div>)}
      </div>
      <div className="palette-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>Ctrl</kbd><kbd>K</kbd> close</span></div>
    </div>
  </div>;
}
