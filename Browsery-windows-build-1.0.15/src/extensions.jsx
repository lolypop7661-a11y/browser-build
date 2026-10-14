import React, { useEffect, useMemo, useState } from 'react';
import { useSpringPresence } from './motion.js';

// Browsery extensions are configuration packs bundled with the app.  They are
// intentionally declarative: an entry can adjust a known preference, but it
// can never download or execute third-party JavaScript in the browser process.
const EXTENSION_STORAGE_KEY = 'browsery:extensions-v1';

export const extensionCatalog = [
  { id: 'deep-shield', name: 'Deep Shield', category: 'Protection', icon: 'shield', description: 'Turns on Browsery’s strict local tracker and suspicious-link protections.', settings: { adblock: true, trackers: 'Strict', phishing: true, https: true } },
  { id: 'privacy-signals', name: 'Privacy Signals', category: 'Protection', icon: 'shield', description: 'Sends privacy preference headers and limits high-entropy browser hints.', settings: { dnt: true, fingerprint: true, webrtc: true } },
  { id: 'download-guard', name: 'Download Guard', category: 'Protection', icon: 'download', description: 'Asks where to save each download so nothing silently lands in an unexpected folder.', settings: { path: 'Ask every time', phishing: true } },
  { id: 'quiet-tabs', name: 'Quiet Tabs', category: 'Performance', icon: 'volume', description: 'Keeps background tabs muted and lets Browsery sleep inactive tabs.', settings: { sleep: true, mutetabs: true } },
  { id: 'tab-wake', name: 'Tab Wake', category: 'Performance', icon: 'reload', description: 'Keeps open tabs restored between launches for a quick return to your workspace.', settings: { restore: true, sleep: false } },
  { id: 'calm-motion', name: 'Calm Motion', category: 'Accessibility', icon: 'spark', description: 'Keeps the spatial look while reducing particle density and click energy.', settings: { particles: 22, motionStrength: 34, speed: 42, cursorEnabled: false } },
  { id: 'type-comfort', name: 'Type Comfort', category: 'Accessibility', icon: 'sliders', description: 'Raises the interface scale for longer reading sessions.', settings: { fontScale: 66, chromeDensity: 'Spacious' } },
  { id: 'contrast-lens', name: 'Contrast Lens', category: 'Accessibility', icon: 'alert', description: 'Uses the Windows contrast preference and clearer, less translucent browser chrome.', settings: { systemContrast: true, opacity: 86, blur: 28 } },
  { id: 'search-compass', name: 'Search Compass', category: 'Search', icon: 'search', description: 'Uses Browsery search with typed suggestions and local history matches.', settings: { engine: 'Browsery', suggestions: true } },
  { id: 'research-brief', name: 'Research Brief', category: 'Search', icon: 'spark', description: 'Turns on concise Groq web overviews for searches when your key is configured.', settings: { aiOverview: true } },
  { id: 'image-atlas', name: 'Image Atlas', category: 'Search', icon: 'grid', description: 'Keeps Browsery’s visual-search route ready from the custom results page.', settings: { engine: 'Browsery', suggestions: true } },
  { id: 'clean-start', name: 'Clean Start', category: 'Workspace', icon: 'home', description: 'Makes the Saturn new tab page your home and keeps the shortcut dock visible.', settings: { homepage: 'New Space', showFavorites: true, showStatus: true } },
  { id: 'focus-deck', name: 'Focus Deck', category: 'Workspace', icon: 'find', description: 'Tightens tab chrome and removes the shortcut dock for a quieter workspace.', settings: { compact: true, showFavorites: false, showStatus: true } },
  { id: 'tab-rail', name: 'Tab Rail', category: 'Workspace', icon: 'grid', description: 'Switches Browsery to a vertical tab rail when you need a wider workspace.', settings: { tabs: 'Vertical', compact: false } },
  { id: 'bookmark-dock', name: 'Bookmark Dock', category: 'Workspace', icon: 'bookmark', description: 'Keeps the shortcut dock visible and browser navigation comfortably spaced.', settings: { showFavorites: true, chromeDensity: 'Comfortable' } },
  { id: 'ambient-deck', name: 'Ambient Deck', category: 'Media', icon: 'music', description: 'Enables Browsery’s local procedural ambience and understated click feedback.', settings: { ambience: true, ambienceVolume: 42, master: 45, clicks: true, spatialaudio: true } },
  { id: 'media-quiet', name: 'Media Quiet', category: 'Media', icon: 'volume', description: 'Mutes background tabs while keeping the audio visualizer available.', settings: { mutetabs: true, visualizer: true, hover: false } },
  { id: 'saturn-studio', name: 'Saturn Studio', category: 'Appearance', icon: 'globe', description: 'Returns the focused Original Saturn scene with a gentle, readable tilt.', settings: { backgroundScene: 'Original Saturn', saturnTilt: -24, backgroundBrightness: 50, backgroundContrast: 50 } },
  { id: 'mono-orbit', name: 'Mono Orbit', category: 'Appearance', icon: 'spark', description: 'Uses Browsery’s black-and-white palette with soft spatial geometry.', settings: { accentPreset: 'Monochrome', cornerStyle: 'Soft', glow: '#ffffff' } },
  { id: 'safe-session', name: 'Private Session', category: 'Privacy', icon: 'cookie', description: 'Starts a local private Browsery session and clears cookies when it closes.', settings: { private: true, cookies: 'On close', dnt: true } },
];

const categories = ['All', ...new Set(extensionCatalog.map(extension => extension.category))];

function readInstalled() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXTENSION_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) => extensionCatalog.some(extension => extension.id === id) && value?.installed));
  } catch {
    return {};
  }
}

function ExtensionCard({ extension, installed, onInstall, onRemove, Icon, Button }) {
  return <article className={`extension-card ${installed ? 'is-installed' : ''}`}>
    <div className="extension-card-top">
      <span className="extension-icon"><Icon name={extension.icon} size={17}/></span>
      <div><span className="extension-category">{extension.category}</span><h3>{extension.name}</h3></div>
      {installed && <span className="extension-installed" aria-label="Installed">Installed</span>}
    </div>
    <p>{extension.description}</p>
    <div className="extension-card-footer">
      <small>Built in · local settings only</small>
      {installed
        ? <Button className="extension-action subtle" onClick={() => onRemove(extension)}>Remove</Button>
        : <Button className="extension-action" onClick={() => onInstall(extension)}>Install</Button>}
    </div>
  </article>;
}

export function ExtensionStore({ open, onClose, setSettings, onNotice, Icon, Button, CloseButton }) {
  const panelRef = useSpringPresence(open, { preset: 'fluid', offset: 90 });
  const [installed, setInstalled] = useState(readInstalled);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');

  useEffect(() => {
    try { localStorage.setItem(EXTENSION_STORAGE_KEY, JSON.stringify(installed)); } catch {}
  }, [installed]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCategory('All');
  }, [open]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return extensionCatalog.filter(extension => (category === 'All' || extension.category === category) && (!term || `${extension.name} ${extension.description} ${extension.category}`.toLowerCase().includes(term)));
  }, [category, query]);

  const install = extension => {
    setInstalled(current => ({ ...current, [extension.id]: { installed: true, installedAt: Date.now() } }));
    if (extension.settings) setSettings(current => ({ ...current, ...extension.settings }));
    onNotice?.(`${extension.name} installed`);
  };

  const remove = extension => {
    setInstalled(current => {
      const next = { ...current };
      delete next[extension.id];
      return next;
    });
    // Deliberately leave preferences alone: silently reverting several browser
    // settings after a remove would be more surprising than useful.
    onNotice?.(`${extension.name} removed — its current preferences were kept`);
  };

  const installedCount = Object.keys(installed).length;
  return <aside ref={panelRef} className={`drawer extensions-drawer ${open ? 'open' : ''}`} aria-hidden={!open} aria-label="Browsery extension store">
    <div className="drawer-head extensions-head">
      <div><span className="drawer-kicker">Safe local catalogue</span><h2>Extensions</h2></div>
      <CloseButton icon="close" label="Close extensions" onClick={onClose}/>
    </div>
    <div className="extensions-body">
      <section className="extensions-intro">
        <div><span className="extensions-orb"><Icon name="grid" size={18}/></span><div><b>Browsery Extension Store</b><small>{installedCount} of {extensionCatalog.length} local extensions installed</small></div></div>
        <p>Every extension is bundled with Browsery. Installing one only applies visible preferences; Browsery never downloads or runs extension code from the web.</p>
      </section>
      <label className="extensions-search"><Icon name="search" size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an extension" aria-label="Find an extension"/></label>
      <div className="extension-filters" role="tablist" aria-label="Extension categories">{categories.map(item => <button key={item} type="button" role="tab" aria-selected={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className="extension-grid">{visible.map(extension => <ExtensionCard key={extension.id} extension={extension} installed={Boolean(installed[extension.id])} onInstall={install} onRemove={remove} Icon={Icon} Button={Button}/>)}</div>
      {visible.length === 0 && <div className="extensions-empty"><Icon name="search" size={19}/><b>No extension found</b><span>Try another name or category.</span></div>}
    </div>
  </aside>;
}
