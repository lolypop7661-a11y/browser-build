import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hostMatches, siteOf } from './catalog.js';
import { IMAGES_READ, LINKS_READ, OUTLINE_READ, PIP_TOGGLE, READER_EXTRACT, SELECTION_READ, ZAP_PICK, outlineScroll, safeSelector, videoSpeed } from './scripts.js';

// ---------- shared helpers ----------
const bridge = () => window.browseryDesktop;
const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : []);
const webUrl = value => { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; } };

export async function copyText(text) {
  try { const result = await bridge()?.copyText?.(text); if (result?.ok) return true; } catch {}
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

async function inPage(ctx, code, gesture = false) {
  const controller = ctx.host.activeController();
  if (!controller) throw new Error('not-ready');
  return controller.view.executeJavaScript(code, gesture);
}

// Reads data from the active page whenever the tab's address changes.
function usePageData(ctx, code, sanitize) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!ctx.site) { setState({ status: 'no-page', data: null }); return undefined; }
    let cancelled = false, attempts = 0, timer = 0;
    setState(current => ({ status: 'loading', data: current.data }));
    const run = async () => {
      const controller = ctx.host.activeController();
      if (!controller || controller.view.isLoading?.()) {
        if (!cancelled) timer = window.setTimeout(run, 450);
        if (++attempts > 40 && !cancelled) { window.clearTimeout(timer); setState({ status: 'error', data: null }); }
        return;
      }
      try {
        const raw = await controller.view.executeJavaScript(code);
        if (!cancelled) setState({ status: 'ready', data: sanitize(raw) });
      } catch { if (!cancelled) setState({ status: 'error', data: null }); }
    };
    run();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [ctx.url, ctx.tabId, ctx.site, version, ctx.host, code, sanitize]);
  return { ...state, reload: useCallback(() => setVersion(value => value + 1), []) };
}

function Note({ children, tone = '' }) { return <p className={`ext-note ${tone}`}>{children}</p>; }

function PageGate({ ctx, name, status, children }) {
  if (!bridge()?.isDesktop) return <Note>{name} works in the Browsery desktop app.</Note>;
  if (!ctx.site || status === 'no-page') return <Note>Open a website in this tab to use {name}.</Note>;
  if (status === 'error') return <Note tone="warn">Browsery couldn’t read this page. Reload it, then try again.</Note>;
  return children;
}

function SiteToggle({ ctx, label, excluded, onChange, Button }) {
  if (!ctx.site) return <Note>Open a website to change this for a specific site.</Note>;
  const off = excluded.includes(ctx.site);
  return <div className="ext-row">
    <div><b>{ctx.site}</b><small>{off ? `${label} is off for this site` : `${label} is on for this site`}</small></div>
    <Button className={`ext-switch ${off ? '' : 'on'}`} aria-pressed={!off} aria-label={`${label} on ${ctx.site}`} onClick={() => onChange(off ? excluded.filter(site => site !== ctx.site) : [...excluded, ctx.site].slice(-300))}><i /></Button>
  </div>;
}

function SiteList({ title, items, empty, onRemove, render, Icon }) {
  return <section className="ext-section"><h4>{title}</h4>{items.length ? <ul className="ext-list">{items.map(item => <li key={item.key}>{render(item)}<button type="button" className="ext-icon-button" onClick={() => onRemove(item)} aria-label={`Remove ${item.key}`}><Icon name="close" size={14} /></button></li>)}</ul> : <Note>{empty}</Note>}</section>;
}

const formatDuration = seconds => {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

// ---------- Night Shift ----------
function NightShiftTool({ ctx, config, setConfig, Button, Icon }) {
  const update = excluded => { setConfig({ excluded }); window.setTimeout(() => ctx.host.reapply('night-shift'), 0); };
  return <>
    <Note>Bright pages turn dark when they load. Pages that are already dark are left alone.</Note>
    <SiteToggle ctx={ctx} label="Night Shift" excluded={config.excluded} onChange={update} Button={Button} />
    <SiteList title="Sites kept in their original colors" items={config.excluded.map(site => ({ key: site }))} empty="No sites excluded." Icon={Icon}
      onRemove={item => update(config.excluded.filter(site => site !== item.key))} render={item => <span>{item.key}</span>} />
  </>;
}

// ---------- Reader ----------
const sanitizeArticle = raw => ({
  title: str(raw?.title, 240), byline: str(raw?.byline, 120), site: str(raw?.site, 120),
  blocks: list(raw?.blocks, 600).map(block => ({ type: ['heading', 'text', 'item', 'quote', 'code'].includes(block?.type) ? block.type : 'text', text: str(block?.text, 4000) })).filter(block => block.text),
});

function ReaderTool({ ctx, config, setConfig, Button }) {
  const { status, data, reload } = usePageData(ctx, READER_EXTRACT, sanitizeArticle);
  const size = Math.min(26, Math.max(14, Number(config.size) || 18));
  return <PageGate ctx={ctx} name="Reader View" status={status}>
    <div className="ext-toolbar"><span>Text size</span><Button onClick={() => setConfig({ size: size - 1 })} aria-label="Smaller text">A−</Button><Button onClick={() => setConfig({ size: size + 1 })} aria-label="Larger text">A+</Button><Button onClick={reload}>Refresh</Button></div>
    {status === 'loading' && !data ? <Note>Reading the article…</Note> : data && data.blocks.length < 2 ? <Note>This page doesn’t look like an article. Try a news story or blog post.</Note> : data && <article className="ext-reader" style={{ '--reader-size': `${size}px` }}>
      <h1>{data.title}</h1>{(data.byline || data.site) && <p className="ext-reader-meta">{[data.byline, data.site].filter(Boolean).join(' · ')}</p>}
      {data.blocks.filter((block, index) => !(index === 0 && block.type === 'heading' && block.text === data.title)).map((block, index) => block.type === 'heading' ? <h2 key={index}>{block.text}</h2> : block.type === 'item' ? <p key={index} className="ext-reader-item">{block.text}</p> : block.type === 'quote' ? <blockquote key={index}>{block.text}</blockquote> : block.type === 'code' ? <pre key={index}>{block.text}</pre> : <p key={index}>{block.text}</p>)}
    </article>}
  </PageGate>;
}

// ---------- Read Aloud ----------
const splitForSpeech = text => text.split(/(?<=[.!?])\s+(?=[A-Z0-9“"(])/).reduce((parts, sentence) => {
  const last = parts[parts.length - 1];
  if (last && last.length + sentence.length < 280) parts[parts.length - 1] = `${last} ${sentence}`; else parts.push(sentence);
  return parts;
}, []);

function ReadAloudTool({ ctx, config, setConfig, Button, Icon }) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  const [voices, setVoices] = useState([]);
  const [parts, setParts] = useState([]);
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState('idle');
  const [message, setMessage] = useState('');
  const token = useRef(0);
  useEffect(() => {
    if (!synth) return undefined;
    const load = () => setVoices(synth.getVoices());
    load(); synth.addEventListener?.('voiceschanged', load);
    return () => { synth.removeEventListener?.('voiceschanged', load); token.current += 1; synth.cancel(); };
  }, [synth]);
  const speak = useCallback((items, at) => {
    if (!synth || at >= items.length) { setMode('idle'); return; }
    const run = ++token.current;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(items[at]);
    utterance.rate = Math.min(2, Math.max(0.6, Number(config.rate) || 1));
    const voice = synth.getVoices().find(item => item.voiceURI === config.voice);
    if (voice) utterance.voice = voice;
    utterance.onend = () => { if (run === token.current) { setIndex(at + 1); speak(items, at + 1); } };
    utterance.onerror = event => { if (run === token.current && event.error !== 'interrupted' && event.error !== 'canceled') { setMode('idle'); setMessage('Your system voice stopped unexpectedly.'); } };
    setIndex(at); setMode('playing'); synth.speak(utterance);
  }, [synth, config.rate, config.voice]);
  const start = async source => {
    setMessage('');
    try {
      let text = [];
      if (source === 'selection') {
        const selection = str((await inPage(ctx, SELECTION_READ))?.text, 8000).trim();
        if (!selection) { setMessage('Select some text on the page first.'); return; }
        text = selection.split(/\n{2,}/);
      } else {
        text = sanitizeArticle(await inPage(ctx, READER_EXTRACT)).blocks.filter(block => block.type !== 'code').map(block => block.text);
      }
      const items = text.flatMap(splitForSpeech).map(item => item.trim()).filter(Boolean).slice(0, 800);
      if (!items.length) { setMessage('There’s no readable text on this page.'); return; }
      setParts(items); speak(items, 0);
    } catch { setMessage('Open and finish loading a page first.'); }
  };
  const stop = () => { token.current += 1; synth?.cancel(); setMode('idle'); };
  const pause = () => { if (mode === 'playing') { synth.pause(); setMode('paused'); } else { synth.resume(); setMode('playing'); } };
  if (!synth) return <Note>Speech isn’t available on this computer.</Note>;
  return <PageGate ctx={ctx} name="Read Aloud" status="ready">
    <div className="ext-actions"><Button onClick={() => start('article')}><Icon name="play" size={14} />Read article</Button><Button onClick={() => start('selection')}><Icon name="quote" size={14} />Read selection</Button></div>
    {mode !== 'idle' && <div className="ext-player">
      <p className="ext-player-text">{parts[index]}</p>
      <div className="ext-actions">
        <Button onClick={() => speak(parts, Math.max(0, index - 1))} aria-label="Previous part"><Icon name="previous" size={14} /></Button>
        <Button onClick={pause}>{mode === 'paused' ? <><Icon name="play" size={14} />Resume</> : <><Icon name="pause" size={14} />Pause</>}</Button>
        <Button onClick={() => speak(parts, index + 1)} aria-label="Next part"><Icon name="next" size={14} /></Button>
        <Button onClick={stop}>Stop</Button>
      </div>
      <small>Part {Math.min(index + 1, parts.length)} of {parts.length}</small>
    </div>}
    <label className="ext-field">Speed · {(Number(config.rate) || 1).toFixed(1)}×<input type="range" min="0.6" max="2" step="0.1" value={Number(config.rate) || 1} onChange={event => setConfig({ rate: Number(event.target.value) })} /></label>
    <label className="ext-field">Voice<select value={config.voice} onChange={event => setConfig({ voice: event.target.value })}><option value="">System default</option>{voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label>
    {message && <Note tone="warn">{message}</Note>}
    <Note>Speed and voice changes apply from the next sentence. Reading continues while this panel is closed.</Note>
  </PageGate>;
}

// ---------- Outline ----------
const sanitizeOutline = raw => list(raw, 300).map(item => ({ level: [1, 2, 3].includes(item?.level) ? item.level : 3, text: str(item?.text, 160) })).filter(item => item.text);

function OutlineTool({ ctx, Button }) {
  const { status, data, reload } = usePageData(ctx, OUTLINE_READ, sanitizeOutline);
  return <PageGate ctx={ctx} name="Page Outline" status={status}>
    <div className="ext-toolbar"><span>{data ? `${data.length} headings` : 'Reading headings…'}</span><Button onClick={reload}>Refresh</Button></div>
    {data && !data.length ? <Note>This page has no headings to jump to.</Note> : <ol className="ext-outline">{(data || []).map((item, index) => <li key={index} className={`level-${item.level}`}><button type="button" onClick={() => inPage(ctx, outlineScroll(index)).catch(() => {})}>{item.text}</button></li>)}</ol>}
  </PageGate>;
}

// ---------- Pop-out video ----------
function PipTool({ ctx, Button, Icon }) {
  const [message, setMessage] = useState('');
  const toggle = async () => {
    try {
      const result = await inPage(ctx, PIP_TOGGLE, true);
      setMessage(result === 'opened' ? 'The video is floating. Drag its corner to resize it.' : result === 'closed' ? 'The video is back on the page.' : 'No playable video found. Start the video, then try again.');
    } catch { setMessage('This site doesn’t allow pop-out video.'); }
  };
  return <PageGate ctx={ctx} name="Pop-out Video" status="ready">
    <Button className="ext-primary" onClick={toggle}><Icon name="pip" size={18} />Pop out / bring back video</Button>
    {message && <Note>{message}</Note>}
    <Note>Picks the largest video on the page. The floating window stays on top of other apps.</Note>
  </PageGate>;
}

// ---------- Video speed ----------
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
function VideoSpeedTool({ ctx, config, setConfig, Button, Icon }) {
  const saved = Number(config.rates[ctx.site]) || 1;
  const [rate, setRate] = useState(saved);
  const [remember, setRemember] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => setRate(Number(config.rates[ctx.site]) || 1), [ctx.site]);
  const apply = async next => {
    setRate(next);
    if (remember && ctx.site) setConfig(current => { const rates = { ...current.rates }; if (next === 1) delete rates[ctx.site]; else rates[ctx.site] = next; return { rates: Object.fromEntries(Object.entries(rates).slice(-300)) }; });
    try { const count = Number(await inPage(ctx, videoSpeed(next))) || 0; setMessage(count ? `Playing at ${next}×.` : `No video yet. ${next}× applies when one starts.`); }
    catch { setMessage('Open and finish loading a page first.'); }
  };
  return <PageGate ctx={ctx} name="Video Speed" status="ready">
    <div className="ext-chips">{SPEEDS.map(speed => <Button key={speed} className={speed === rate ? 'active' : ''} aria-pressed={speed === rate} onClick={() => apply(speed)}>{speed}×</Button>)}</div>
    <label className="ext-check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />Remember this speed for {ctx.site || 'this site'}</label>
    {message && <Note>{message}</Note>}
    {Object.keys(config.rates).length > 0 && <SiteList title="Saved speeds" items={Object.entries(config.rates).map(([site, value]) => ({ key: site, value }))} empty="" Icon={Icon}
      onRemove={item => setConfig(current => { const rates = { ...current.rates }; delete rates[item.key]; return { rates }; })} render={item => <span>{item.key} · {item.value}×</span>} />}
  </PageGate>;
}

// ---------- Image grabber ----------
const sanitizeImages = raw => list(raw, 240).map(image => ({ src: webUrl(image?.src), width: Number(image?.width) || 0, height: Number(image?.height) || 0, alt: str(image?.alt, 140) })).filter(image => image.src);

function ImageGrabberTool({ ctx, Button, Icon }) {
  const { status, data, reload } = usePageData(ctx, IMAGES_READ, sanitizeImages);
  const [minimum, setMinimum] = useState(0);
  const images = (data || []).filter(image => !minimum || (image.width >= minimum && image.height >= minimum) || !image.width);
  const save = src => { try { ctx.host.activeController()?.view.downloadURL(src); ctx.notify('Saving image to Downloads'); } catch { ctx.notify('This image could not be saved'); } };
  const saveAll = () => { if (images.length > 12 && !window.confirm(`Save all ${images.length} images to Downloads?`)) return; images.forEach(image => save(image.src)); };
  return <PageGate ctx={ctx} name="Image Grabber" status={status}>
    <div className="ext-toolbar"><span>{data ? `${images.length} images` : 'Finding images…'}</span>
      <select value={minimum} onChange={event => setMinimum(Number(event.target.value))} aria-label="Minimum image size"><option value="0">All sizes</option><option value="200">200px and up</option><option value="600">600px and up</option></select>
      <Button onClick={reload}>Refresh</Button><Button onClick={saveAll} disabled={!images.length}>Save all</Button></div>
    {data && !images.length ? <Note>No images match. Scroll the page to load more, then refresh.</Note> : <div className="ext-image-grid">{images.map(image => <figure key={image.src}>
      <img src={image.src} alt={image.alt} loading="lazy" referrerPolicy="no-referrer" />
      <figcaption><span>{image.width ? `${image.width}×${image.height}` : 'Share image'}</span><button type="button" onClick={() => save(image.src)} aria-label={`Save ${image.alt || 'image'}`}><Icon name="download" size={14} /></button></figcaption>
    </figure>)}</div>}
  </PageGate>;
}

// ---------- Snapshot ----------
async function captureActiveTab(ctx) {
  const controller = ctx.host.activeController();
  const id = controller?.view.getWebContentsId?.();
  if (!Number.isSafeInteger(id)) throw new Error('not-ready');
  const result = await bridge()?.captureTab?.(id);
  if (!result?.ok || !/^data:image\/png;base64,/.test(result.dataUrl || '')) throw new Error(result?.status || 'failed');
  return result;
}

function SnapshotTool({ ctx, Button, Icon }) {
  const [shot, setShot] = useState(null);
  const [message, setMessage] = useState('');
  const capture = async () => {
    setMessage('');
    try { setShot(await captureActiveTab(ctx)); } catch (error) { setMessage(error.message === 'page-loading' ? 'Wait for the page to finish loading.' : 'Couldn’t capture this tab.'); }
  };
  const save = () => {
    const link = document.createElement('a');
    link.href = shot.dataUrl;
    link.download = `snapshot-${ctx.site || 'page'}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
    link.click();
    ctx.notify('Snapshot saved to Downloads');
  };
  const copy = async () => { const result = await bridge()?.copyImage?.(shot.dataUrl).catch(() => null); ctx.notify(result?.ok ? 'Snapshot copied' : 'Couldn’t copy the snapshot'); };
  return <PageGate ctx={ctx} name="Snapshot" status="ready">
    <Button className="ext-primary" onClick={capture}><Icon name="camera" size={18} />Capture visible page</Button>
    {message && <Note tone="warn">{message}</Note>}
    {shot && <>
      <img className="ext-shot" src={shot.dataUrl} alt="Snapshot of the current tab" />
      <div className="ext-actions"><Button onClick={save}><Icon name="download" size={14} />Save PNG</Button><Button onClick={copy}>Copy</Button><small>{shot.width}×{shot.height}</small></div>
    </>}
  </PageGate>;
}

// ---------- Color picker ----------
const toHex = (r, g, b) => `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`;
const fromHex = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const toHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return `hsl(${Math.round((h * 60 + 360) % 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
};

function ColorPickerTool({ ctx, config, setConfig, Button, Icon }) {
  const [color, setColor] = useState(config.history[0] || '');
  const [fallback, setFallback] = useState(null);
  const canvas = useRef(null);
  const remember = hex => { setColor(hex); setConfig(current => ({ history: [hex, ...current.history.filter(item => item !== hex)].slice(0, 16) })); };
  const pick = async () => {
    if ('EyeDropper' in window) {
      try { const result = await new window.EyeDropper().open(); if (/^#[0-9a-f]{6}$/i.test(result?.sRGBHex || '')) remember(result.sRGBHex.toLowerCase()); return; }
      catch (error) { if (error?.name === 'AbortError') return; }
    }
    try { setFallback(await captureActiveTab(ctx)); } catch { ctx.notify('Open a page to pick a color from it'); }
  };
  useEffect(() => {
    if (!fallback) return;
    const image = new Image();
    image.onload = () => { const surface = canvas.current; if (!surface) return; surface.width = image.width; surface.height = image.height; surface.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0); };
    image.src = fallback.dataUrl;
  }, [fallback]);
  const sample = event => {
    const surface = canvas.current, rect = surface.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * surface.width), y = Math.floor((event.clientY - rect.top) / rect.height * surface.height);
    const [r, g, b] = surface.getContext('2d').getImageData(x, y, 1, 1).data;
    remember(toHex(r, g, b)); setFallback(null);
  };
  const rgb = color ? fromHex(color) : null;
  const formats = rgb ? [['HEX', color], ['RGB', `rgb(${rgb.join(', ')})`], ['HSL', toHsl(...rgb)]] : [];
  return <>
    <Button className="ext-primary" onClick={pick}><Icon name="droplet" size={18} />Pick a color</Button>
    {fallback && <><Note>Click anywhere on the snapshot to pick that color.</Note><canvas ref={canvas} className="ext-sample" onClick={sample} /></>}
    {color && <div className="ext-color"><span className="ext-swatch big" style={{ background: color }} /><div>{formats.map(([label, value]) => <button type="button" key={label} className="ext-copy-row" onClick={() => copyText(value).then(ok => ctx.notify(ok ? `${value} copied` : 'Couldn’t copy'))}><b>{label}</b><code>{value}</code><Icon name="export" size={13} /></button>)}</div></div>}
    {config.history.length > 0 && <section className="ext-section"><h4>Recent</h4><div className="ext-swatches">{config.history.map(hex => <button type="button" key={hex} className="ext-swatch" style={{ background: hex }} title={hex} aria-label={hex} onClick={() => setColor(hex)} />)}</div></section>}
  </>;
}

// ---------- Cookie pop-ups ----------
function CookieTool({ ctx, config, setConfig, Button, Icon }) {
  const update = excluded => { setConfig({ excluded }); window.setTimeout(() => ctx.host.reapply('cookie-dismiss'), 0); };
  return <>
    <div className="ext-stat"><b>{config.declined}</b><span>cookie requests declined for you</span></div>
    <SiteToggle ctx={ctx} label="Pop-up blocking" excluded={config.excluded} onChange={update} Button={Button} />
    <Note>If a site stops working, turn blocking off for that site and reload it.</Note>
    <SiteList title="Sites allowed to show cookie pop-ups" items={config.excluded.map(site => ({ key: site }))} empty="None." Icon={Icon}
      onRemove={item => update(config.excluded.filter(site => site !== item.key))} render={item => <span>{item.key}</span>} />
  </>;
}

// ---------- Element zapper ----------
function ZapperTool({ ctx, config, setConfig, Button, Icon }) {
  const [message, setMessage] = useState('');
  const rules = config.rules[ctx.site] || [];
  const writeRules = (site, next) => setConfig(current => {
    const all = { ...current.rules };
    if (next.length) all[site] = next.slice(-100); else delete all[site];
    return { rules: Object.fromEntries(Object.entries(all).slice(-200)) };
  });
  const pick = async () => {
    setMessage('');
    ctx.setDrawerHidden(true);
    try {
      const result = await inPage(ctx, ZAP_PICK);
      const selector = safeSelector(result?.selector);
      if (result?.status === 'picked' && selector) {
        writeRules(ctx.site, [...rules.filter(rule => rule.selector !== selector), { selector, label: str(result.label, 60) || selector, at: Date.now() }]);
        window.setTimeout(() => ctx.host.reapply('zapper'), 0);
        setMessage('Hidden. It stays hidden whenever you visit this site.');
      } else if (result?.status === 'cancelled') setMessage('Cancelled.');
      else if (result?.status === 'timeout') setMessage('Nothing was picked.');
    } catch { setMessage('Open and finish loading a page first.'); }
    finally { ctx.setDrawerHidden(false); }
  };
  const remove = rule => {
    writeRules(ctx.site, rules.filter(item => item.selector !== rule.selector));
    try { ctx.host.activeController()?.view.reload(); } catch {}
  };
  return <PageGate ctx={ctx} name="Element Zapper" status="ready">
    <Button className="ext-primary" onClick={pick}><Icon name="target" size={18} />Pick something to hide</Button>
    <Note>This panel hides while you pick. Click the element on the page, or press Esc to cancel.</Note>
    {message && <Note>{message}</Note>}
    <SiteList title={`Hidden on ${ctx.site}`} items={rules.map(rule => ({ ...rule, key: rule.selector }))} empty="Nothing hidden on this site." Icon={Icon} onRemove={remove}
      render={rule => <span title={rule.selector}>{rule.label}</span>} />
    {rules.length > 0 && <Button onClick={() => { writeRules(ctx.site, []); try { ctx.host.activeController()?.view.reload(); } catch {} }}>Show everything again</Button>}
  </PageGate>;
}

// ---------- JSON viewer ----------
function JsonTool({ config }) {
  return <>
    <div className="ext-stat"><b>{config.formatted}</b><span>JSON responses formatted</span></div>
    <Note>Open any API URL that returns JSON and it appears as a collapsible, color-coded tree. Use the Raw button at the top of the page to see the plain text.</Note>
  </>;
}

// ---------- Focus mode ----------
const normalizeDomain = value => {
  const host = String(value || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : '';
};

function FocusTool({ ctx, config, setConfig, Button, Icon }) {
  const [now, setNow] = useState(Date.now());
  const [draft, setDraft] = useState('');
  const running = Number(config.endsAt) > now;
  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const left = Math.max(0, Number(config.endsAt) - now);
  const start = minutes => { setConfig({ endsAt: Date.now() + minutes * 60000 }); setNow(Date.now()); ctx.notify(`Focus Mode on for ${minutes} minutes`); };
  const add = event => {
    event.preventDefault();
    const domain = normalizeDomain(draft);
    if (!domain) { ctx.notify('Enter a site like reddit.com'); return; }
    setConfig(current => ({ blocked: [...new Set([...current.blocked, domain])].slice(0, 100) }));
    setDraft('');
  };
  const currentBlocked = config.blocked.some(entry => hostMatches(ctx.site, entry));
  return <>
    {running ? <div className="ext-timer">
      <b>{String(Math.floor(left / 60000)).padStart(2, '0')}:{String(Math.floor(left / 1000) % 60).padStart(2, '0')}</b><span>left in this focus session</span>
      <Button onClick={() => { if (window.confirm('End this focus session early?')) setConfig({ endsAt: 0 }); }}>End session</Button>
    </div> : <><h4 className="ext-heading">Start a focus session</h4><div className="ext-chips">{[15, 25, 50, 90].map(minutes => <Button key={minutes} onClick={() => start(minutes)}>{minutes} min</Button>)}</div></>}
    {running && currentBlocked && <Note tone="warn">This tab is on your blocked list. It stays open, but new visits are blocked.</Note>}
    <section className="ext-section"><h4>Blocked during focus</h4>
      <div className="ext-tags">{config.blocked.map(site => <span key={site}>{site}{!running && <button type="button" aria-label={`Unblock ${site}`} onClick={() => setConfig(current => ({ blocked: current.blocked.filter(item => item !== site) }))}><Icon name="close" size={12} /></button>}</span>)}</div>
      <form className="ext-inline-form" onSubmit={add}><input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Add a site, e.g. news.ycombinator.com" maxLength={260} /><Button type="submit">Add</Button></form>
      {running && <Note>You can add sites during a session, but not remove them until it ends.</Note>}
    </section>
  </>;
}

// ---------- Site notes ----------
function NotesTool({ ctx, config, setConfig, Button, Icon }) {
  const site = ctx.site;
  const [text, setText] = useState(config.notes[site]?.text || '');
  const timer = useRef(0);
  useEffect(() => { setText(config.notes[site]?.text || ''); }, [site]);
  const save = value => {
    setText(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setConfig(current => {
      const notes = { ...current.notes };
      if (value.trim()) notes[site] = { text: value.slice(0, 20000), updatedAt: Date.now() }; else delete notes[site];
      return { notes: Object.fromEntries(Object.entries(notes).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 300)) };
    }), 400);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const others = Object.entries(config.notes).filter(([key]) => key !== site);
  return <>
    {site ? <label className="ext-field">Notes for {site}<textarea rows={9} value={text} onChange={event => save(event.target.value)} placeholder="Anything you want to remember about this site…" maxLength={20000} /></label> : <Note>Open a website to write notes for it.</Note>}
    <SiteList title="Other sites with notes" items={others.map(([key, note]) => ({ key, note }))} empty="No other notes yet." Icon={Icon}
      onRemove={item => { if (window.confirm(`Delete your notes for ${item.key}?`)) setConfig(current => { const notes = { ...current.notes }; delete notes[item.key]; return { notes }; }); }}
      render={item => <button type="button" className="ext-link" onClick={() => ctx.openTab(`https://${item.key}`)}><b>{item.key}</b><small>{item.note.text.slice(0, 80)}</small></button>} />
  </>;
}

// ---------- Clips ----------
function ClipsTool({ ctx, config, setConfig, Button, Icon }) {
  const [message, setMessage] = useState('');
  const save = async () => {
    setMessage('');
    try {
      const result = await inPage(ctx, SELECTION_READ);
      const text = str(result?.text, 8000).trim();
      if (!text) { setMessage('Highlight some text on the page first.'); return; }
      setConfig(current => ({ items: [{ id: `${Date.now()}`, text, url: webUrl(result.url), title: str(result.title, 240), at: Date.now() }, ...current.items].slice(0, 200) }));
      ctx.notify('Clip saved');
    } catch { setMessage('Open and finish loading a page first.'); }
  };
  const markdown = config.items.map(item => `> ${item.text.replace(/\n/g, '\n> ')}\n>\n> — [${item.title || item.url}](${item.url})`).join('\n\n');
  return <>
    <Button className="ext-primary" onClick={save}><Icon name="quote" size={18} />Save highlighted text</Button>
    {message && <Note tone="warn">{message}</Note>}
    {config.items.length > 0 && <div className="ext-actions"><Button onClick={() => copyText(markdown).then(ok => ctx.notify(ok ? `${config.items.length} clips copied as Markdown` : 'Couldn’t copy'))}>Copy all as Markdown</Button><Button onClick={() => { if (window.confirm('Delete all clips?')) setConfig({ items: [] }); }}>Clear</Button></div>}
    {config.items.length ? <ul className="ext-clips">{config.items.map(item => <li key={item.id}>
      <p>{item.text}</p>
      <div>{item.url ? <button type="button" className="ext-link" onClick={() => ctx.openTab(item.url)}>{item.title || siteOf(item.url)}</button> : <span />}<button type="button" className="ext-icon-button" aria-label="Delete clip" onClick={() => setConfig(current => ({ items: current.items.filter(entry => entry.id !== item.id) }))}><Icon name="trash" size={14} /></button></div>
    </li>)}</ul> : <Note>Your saved highlights appear here with a link back to where you found them.</Note>}
  </>;
}

// ---------- Time tracker ----------
function TimeTrackerTool({ config, setConfig, ctx, Button }) {
  const [range, setRange] = useState('today');
  useEffect(() => { ctx.host.flushTime(); }, [ctx.host]);
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const weekAgo = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 6);
  const weekStart = `${weekAgo.getFullYear()}-${String(weekAgo.getMonth() + 1).padStart(2, '0')}-${String(weekAgo.getDate()).padStart(2, '0')}`;
  const totals = {};
  for (const [, sites] of Object.entries(config.days).filter(([day]) => range === 'today' ? day === today : day >= weekStart && day <= today)) {
    for (const [site, seconds] of Object.entries(sites)) totals[site] = (totals[site] || 0) + Number(seconds || 0);
  }
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, seconds]) => sum + seconds, 0), top = rows[0]?.[1] || 1;
  return <>
    <div className="ext-chips"><Button className={range === 'today' ? 'active' : ''} onClick={() => setRange('today')}>Today</Button><Button className={range === 'week' ? 'active' : ''} onClick={() => setRange('week')}>Last 7 days</Button></div>
    <div className="ext-stat"><b>{formatDuration(total)}</b><span>on the web {range === 'today' ? 'today' : 'this week'}</span></div>
    {rows.length ? <ul className="ext-bars">{rows.slice(0, 15).map(([site, seconds]) => <li key={site}><span>{site}</span><i style={{ '--bar': `${Math.max(3, seconds / top * 100)}%` }} /><em>{formatDuration(seconds)}</em></li>)}</ul> : <Note>Time appears here as you browse. Only time with Browsery in front counts.</Note>}
    {rows.length > 0 && <Button onClick={() => { if (window.confirm('Clear all tracked time?')) setConfig({ days: {} }); }}>Clear history</Button>}
  </>;
}

// ---------- Auto refresh ----------
const REFRESH = [[10, '10s'], [30, '30s'], [60, '1 min'], [300, '5 min'], [900, '15 min']];
function AutoRefreshTool({ ctx, hostState, Button }) {
  const current = hostState.refresh[ctx.tabId] || 0;
  const others = Object.keys(hostState.refresh).filter(id => String(id) !== String(ctx.tabId));
  return <PageGate ctx={ctx} name="Auto Refresh" status="ready">
    <div className="ext-stat"><b>{current ? REFRESH.find(([seconds]) => seconds === current)?.[1] || `${current}s` : 'Off'}</b><span>{current ? 'This tab reloads on a timer' : 'This tab is not refreshing'}</span></div>
    <div className="ext-chips">{REFRESH.map(([seconds, label]) => <Button key={seconds} className={current === seconds ? 'active' : ''} onClick={() => { ctx.host.setRefresh(ctx.tabId, seconds); ctx.notify(`Refreshing every ${label}`); }}>{label}</Button>)}</div>
    {current > 0 && <Button onClick={() => ctx.host.setRefresh(ctx.tabId, 0)}>Stop refreshing this tab</Button>}
    {others.length > 0 && <Note>{others.length} other tab{others.length === 1 ? ' is' : 's are'} also refreshing. <button type="button" className="ext-link" onClick={() => others.forEach(id => ctx.host.setRefresh(Number(id) || id, 0))}>Stop all</button></Note>}
    <Note>Refreshing pauses while the page is loading and stops when you close the tab.</Note>
  </PageGate>;
}

// ---------- Password generator ----------
const SETS = { lower: 'abcdefghijkmnopqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits: '23456789', symbols: '!#$%&*+-=?@^_~' };
const FULL = { lower: 'abcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', symbols: SETS.symbols };
const randomIndex = max => {
  const limit = Math.floor(0x100000000 / max) * max, buffer = new Uint32Array(1);
  do crypto.getRandomValues(buffer); while (buffer[0] >= limit);
  return buffer[0] % max;
};
export function generatePassword({ length = 20, symbols = true, digits = true, upper = true, simple = true } = {}) {
  const source = simple ? SETS : FULL;
  const groups = [source.lower, upper && source.upper, digits && source.digits, symbols && source.symbols].filter(Boolean);
  const pool = groups.join('');
  const size = Math.min(64, Math.max(8, Number(length) || 20));
  const chars = groups.map(group => group[randomIndex(group.length)]);
  while (chars.length < size) chars.push(pool[randomIndex(pool.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) { const swap = randomIndex(index + 1); [chars[index], chars[swap]] = [chars[swap], chars[index]]; }
  return { password: chars.join(''), bits: Math.round(size * Math.log2(pool.length)) };
}

function PasswordTool({ config, setConfig, ctx, Button, Icon }) {
  const options = { length: config.length, symbols: config.symbols, digits: config.digits !== false, upper: config.upper !== false, simple: config.simple !== false };
  const [result, setResult] = useState(() => generatePassword(options));
  useEffect(() => setResult(generatePassword(options)), [config.length, config.symbols]);
  const strength = result.bits >= 100 ? 'Excellent' : result.bits >= 80 ? 'Strong' : result.bits >= 60 ? 'Good' : 'Weak';
  return <>
    <div className="ext-password"><code>{result.password}</code></div>
    <div className={`ext-meter s-${strength.toLowerCase()}`}><i style={{ '--bar': `${Math.min(100, result.bits / 1.28)}%` }} /><span>{strength} · about {result.bits} bits</span></div>
    <div className="ext-actions"><Button className="ext-primary" onClick={() => copyText(result.password).then(ok => ctx.notify(ok ? 'Password copied' : 'Couldn’t copy'))}><Icon name="export" size={14} />Copy</Button><Button onClick={() => setResult(generatePassword(options))}><Icon name="reload" size={14} />New</Button></div>
    <label className="ext-field">Length · {config.length}<input type="range" min="8" max="64" value={config.length} onChange={event => setConfig({ length: Number(event.target.value) })} /></label>
    <label className="ext-check"><input type="checkbox" checked={config.symbols} onChange={event => setConfig({ symbols: event.target.checked })} />Include symbols</label>
    <Note>Generated on this computer and never saved or sent anywhere. Look-alike characters like l, 1, O and 0 are left out.</Note>
  </>;
}

// ---------- Link inspector ----------
const sanitizeLinks = raw => ({ origin: str(raw?.origin, 300), links: list(raw?.links, 1500).map(link => ({ href: webUrl(link?.href), text: str(link?.text, 140) })).filter(link => link.href) });

function LinkInspectorTool({ ctx, Button }) {
  const { status, data, reload } = usePageData(ctx, LINKS_READ, sanitizeLinks);
  const [scope, setScope] = useState('all');
  const [filter, setFilter] = useState('');
  const links = useMemo(() => (data?.links || []).filter(link => {
    const internal = siteOf(link.href) === ctx.site;
    if (scope === 'internal' && !internal) return false;
    if (scope === 'external' && internal) return false;
    const query = filter.trim().toLowerCase();
    return !query || `${link.href} ${link.text}`.toLowerCase().includes(query);
  }), [data, scope, filter, ctx.site]);
  const groups = useMemo(() => {
    const map = new Map();
    for (const link of links) { const site = siteOf(link.href); if (!map.has(site)) map.set(site, []); map.get(site).push(link); }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [links]);
  return <PageGate ctx={ctx} name="Link Inspector" status={status}>
    <div className="ext-toolbar"><div className="ext-chips">{[['all', 'All'], ['internal', 'This site'], ['external', 'Other sites']].map(([value, label]) => <Button key={value} className={scope === value ? 'active' : ''} onClick={() => setScope(value)}>{label}</Button>)}</div><Button onClick={reload}>Refresh</Button></div>
    <div className="ext-inline-form"><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter links" aria-label="Filter links" /><Button disabled={!links.length} onClick={() => copyText(links.map(link => link.href).join('\n')).then(ok => ctx.notify(ok ? `${links.length} links copied` : 'Couldn’t copy'))}>Copy {links.length}</Button></div>
    {data && !links.length ? <Note>No links match.</Note> : groups.map(([site, items]) => <details key={site} className="ext-group" open={groups.length < 4}>
      <summary><b>{site}</b><em>{items.length}</em></summary>
      <ul>{items.slice(0, 200).map(link => <li key={link.href}><button type="button" className="ext-link" onClick={() => ctx.openTab(link.href)} title={link.href}><b>{link.text || link.href}</b><small>{link.href}</small></button></li>)}</ul>
    </details>)}
  </PageGate>;
}

// ---------- Zoom memory ----------
function ZoomMemoryTool({ ctx, config, setConfig, Icon }) {
  const sites = Object.entries(config.sites);
  const current = config.sites[ctx.site];
  return <>
    <div className="ext-stat"><b>{current ? `${Math.round(current * 100)}%` : '100%'}</b><span>{ctx.site ? `saved zoom for ${ctx.site}` : 'open a website to see its zoom'}</span></div>
    <Note>Zoom with Ctrl + and Ctrl −. Browsery remembers the level for that site and brings it back every visit, even after restarting.</Note>
    <SiteList title="Remembered zoom levels" items={sites.map(([key, value]) => ({ key, value }))} empty="No sites yet." Icon={Icon}
      onRemove={item => { setConfig(currentConfig => { const next = { ...currentConfig.sites }; delete next[item.key]; return { sites: next }; }); if (item.key === ctx.site) ctx.host.page('zoom-memory')?.setZoom(1); }}
      render={item => <span>{item.key} · {Math.round(item.value * 100)}%</span>} />
  </>;
}

export const extensionTools = {
  'night-shift': NightShiftTool, reader: ReaderTool, 'read-aloud': ReadAloudTool, outline: OutlineTool, pip: PipTool,
  'video-speed': VideoSpeedTool, 'image-grabber': ImageGrabberTool, snapshot: SnapshotTool, 'color-picker': ColorPickerTool,
  'cookie-dismiss': CookieTool, zapper: ZapperTool, 'json-viewer': JsonTool, 'focus-mode': FocusTool, 'site-notes': NotesTool,
  clips: ClipsTool, 'time-tracker': TimeTrackerTool, 'auto-refresh': AutoRefreshTool, 'password-generator': PasswordTool,
  'link-inspector': LinkInspectorTool, 'zoom-memory': ZoomMemoryTool,
};
