// Code that Browsery extensions run inside web pages through <webview>.executeJavaScript.
//
// These scripts run in the page's own JavaScript world, so anything they return
// is page-controlled data. Callers must treat results as untrusted: validate
// shapes, cap sizes, and render text through React (never as HTML).
// Arguments are embedded with JSON.stringify so no caller value is ever
// interpolated as code.

const arg = value => JSON.stringify(value).replace(/</g, '\\u003c');

// ---------- Night Shift ----------
export const NIGHT_PROBE = `(() => {
  const lum = el => {
    if (!el) return null;
    const parts = getComputedStyle(el).backgroundColor.match(/[\\d.]+/g);
    if (!parts) return null;
    const [r, g, b, a = 1] = parts.map(Number);
    return a < 0.1 ? null : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const scheme = getComputedStyle(document.documentElement).colorScheme || '';
  const meta = document.querySelector('meta[name="color-scheme"]')?.content || '';
  return { luminance: lum(document.body) ?? lum(document.documentElement) ?? 1, dark: /dark/.test(scheme + ' ' + meta) && !/light/.test(scheme) };
})()`;

export const NIGHT_CSS = `html{filter:invert(.9) hue-rotate(180deg)!important;background:#fff!important}
img,video,picture,canvas,iframe,embed,object,svg image,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)!important}`;

// ---------- Cookie pop-ups ----------
export const COOKIE_CSS = `#onetrust-consent-sdk,#onetrust-banner-sdk,.onetrust-pc-dark-filter,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,
.qc-cmp2-container,#qc-cmp2-container,.fc-consent-root,#usercentrics-root,#usercentrics-cmp-ui,#didomi-host,#truste-consent-track,.truste_overlay,.truste_box_overlay,
#cmpbox,#cmpbox2,.cmpboxBG,[id^="sp_message_container"],.cc-window,.cc-banner,#cookie-law-info-bar,#cookiescript_injected,#termly-code-snippet-support,
.osano-cm-window,.osano-cm-dialog,#hs-eu-cookie-confirmation,.cky-consent-container,.cky-overlay,#gdpr-cookie-message,#cookie-notice,.cookie-notice-container,
#moove_gdpr_cookie_info_bar,.cmplz-cookiebanner,#BorlabsCookieBox,.iubenda-cs-container,#iubenda-cs-banner,#axeptio_overlay,.klaro .cookie-notice{display:none!important}`;

export const COOKIE_DECLINE = `(() => {
  const known = ['#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '.fc-cta-do-not-consent', '[data-testid="uc-deny-all-button"]', '#didomi-notice-disagree-button', '.cky-btn-reject', '.osano-cm-denyAll',
    '.cmplz-deny', '#truste-consent-required', '.iubenda-cs-reject-btn', '[data-cookiefirst-action="reject"]', '.qc-cmp2-summary-buttons button[mode="secondary"]'];
  const words = /^(reject all|reject|decline all|decline|deny all|deny|refuse all|only necessary|necessary only|use necessary cookies only|essential only|continue without accepting)$/i;
  let clicked = 0;
  const unlock = () => { for (const el of [document.documentElement, document.body]) if (el && getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important'); };
  const sweep = () => {
    // Known consent buttons are clicked even when Browsery's CSS has already hidden
    // the banner, so hiding the pop-up never skips declining the cookies.
    for (const selector of known) {
      const button = document.querySelector(selector);
      if (button && !button.dataset.browseryDeclined) { button.dataset.browseryDeclined = '1'; button.click(); clicked += 1; unlock(); return; }
    }
    for (const box of document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-label*="cookie" i]')) {
      for (const button of box.querySelectorAll('button,[role="button"],a')) {
        if (words.test((button.textContent || '').trim()) && button.offsetParent !== null) { button.click(); clicked += 1; unlock(); return; }
      }
    }
  };
  sweep();
  if (!window.__browseryCookieWatch) {
    window.__browseryCookieWatch = true;
    let runs = 0;
    const observer = new MutationObserver(() => { if (++runs > 60) return observer.disconnect(); sweep(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 12000);
  }
  return clicked;
})()`;

// ---------- Shared: visible headings ----------
const HEADINGS = `const browseryHeadings = () => [...document.querySelectorAll('h1,h2,h3')].filter(h => h.offsetParent !== null && (h.textContent || '').trim());`;

export const OUTLINE_READ = `(() => { ${HEADINGS}
  return browseryHeadings().slice(0, 300).map(h => ({ level: Number(h.tagName[1]), text: h.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) }));
})()`;

export const outlineScroll = index => `(() => { ${HEADINGS}
  const target = browseryHeadings()[${arg(Number(index) || 0)}];
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.animate?.([{ outline: '2px solid #888', outlineOffset: '4px' }, { outline: '2px solid transparent', outlineOffset: '4px' }], { duration: 1400 });
  return true;
})()`;

// ---------- Reader ----------
export const READER_EXTRACT = `(() => {
  const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
  const candidates = [...document.querySelectorAll('article, main, [role="main"], .post, .entry-content, .article-body, #content, .content, body')];
  let best = document.body, bestScore = 0;
  for (const el of candidates) {
    const score = [...el.querySelectorAll('p')].reduce((sum, p) => sum + Math.min(clean(p.textContent).length, 600), 0);
    if (score > bestScore * 1.15) { best = el; bestScore = score; }
  }
  const skip = el => el.closest('nav,aside,footer,header,form,[role="navigation"],[aria-hidden="true"],.comments,#comments,.related,.share,.newsletter');
  const blocks = [];
  for (const el of best.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre')) {
    if (blocks.length >= 600 || skip(el) || el.offsetParent === null) continue;
    if (el.tagName === 'LI' && el.querySelector('p')) continue;
    if (el.tagName === 'P' && el.closest('blockquote,li')) continue;
    const text = el.tagName === 'PRE' ? (el.textContent || '').slice(0, 4000) : clean(el.textContent).slice(0, 4000);
    if (!text || (el.tagName === 'P' && text.length < 25 && !/[.!?]$/.test(text))) continue;
    const type = /^H[1-4]$/.test(el.tagName) ? 'heading' : el.tagName === 'LI' ? 'item' : el.tagName === 'BLOCKQUOTE' ? 'quote' : el.tagName === 'PRE' ? 'code' : 'text';
    blocks.push({ type, text });
  }
  const byline = clean(document.querySelector('[rel="author"], .author, .byline, [itemprop="author"], meta[name="author"]')?.content || document.querySelector('[rel="author"], .author, .byline, [itemprop="author"]')?.textContent || '').slice(0, 120);
  return { title: clean(document.querySelector('h1')?.textContent || document.title).slice(0, 240), byline, site: location.hostname, blocks };
})()`;

// ---------- Selection ----------
export const SELECTION_READ = `(() => ({ text: String(getSelection?.() || '').slice(0, 8000), url: location.href, title: document.title.slice(0, 240) }))()`;

// ---------- Images ----------
export const IMAGES_READ = `(() => {
  const seen = new Set(), out = [];
  const add = (src, width, height, alt) => {
    try { src = new URL(src, location.href).href; } catch { return; }
    if (!/^https?:/.test(src) || seen.has(src) || out.length >= 240) return;
    seen.add(src); out.push({ src, width: width || 0, height: height || 0, alt: (alt || '').replace(/\\s+/g, ' ').trim().slice(0, 140) });
  };
  for (const meta of document.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"]')) add(meta.content, 0, 0, 'Share image');
  for (const img of document.images) {
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (w && h && (w < 48 || h < 48)) continue;
    add(img.currentSrc || img.src, w, h, img.alt);
  }
  return out;
})()`;

// ---------- Links ----------
export const LINKS_READ = `(() => {
  const seen = new Set(), out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    let href; try { href = new URL(a.getAttribute('href'), location.href).href; } catch { continue; }
    if (!/^https?:/.test(href) || seen.has(href) || out.length >= 1500) continue;
    seen.add(href);
    out.push({ href, text: (a.textContent || a.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 140) });
  }
  return { origin: location.origin, links: out };
})()`;

// ---------- Video ----------
export const PIP_TOGGLE = `(async () => {
  if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 'closed'; }
  const video = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 && !v.disablePictureInPicture)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!video) return 'no-video';
  await video.requestPictureInPicture();
  return 'opened';
})()`;

export const videoSpeed = rate => `(() => {
  const w = window;
  w.__browseryRate = ${arg(Math.min(4, Math.max(0.25, Number(rate) || 1)))};
  const apply = el => { if (el instanceof HTMLMediaElement && Math.abs(el.playbackRate - w.__browseryRate) > 0.01) try { el.playbackRate = w.__browseryRate; } catch {} };
  const media = document.querySelectorAll('video,audio');
  media.forEach(apply);
  if (!w.__browseryRateHook) {
    w.__browseryRateHook = true;
    // Sites reset the rate when a new video loads; re-apply only when a custom speed is chosen.
    const hook = event => { if (w.__browseryRate !== 1) apply(event.target); };
    document.addEventListener('play', hook, true);
    document.addEventListener('loadedmetadata', hook, true);
  }
  return media.length;
})()`;

// ---------- Element zapper ----------
export const ZAP_PICK = `new Promise(resolve => {
  if (window.__browseryZapping) return resolve({ status: 'busy' });
  window.__browseryZapping = true;
  const box = document.createElement('div');
  const tip = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #fff;background:rgba(255,255,255,.12);box-shadow:0 0 0 1px #000;border-radius:3px;transition:all 60ms';
  tip.style.cssText = 'position:fixed;z-index:2147483647;left:50%;top:14px;translate:-50% 0;padding:7px 12px;border-radius:8px;background:#111;color:#eee;font:12px system-ui;pointer-events:none;border:1px solid #444';
  tip.textContent = 'Click an element to hide it on this site · Esc cancels';
  document.documentElement.append(box, tip);
  let current = null;
  const usable = cls => cls && cls.length < 32 && !/\\d{3,}|^(css|sc|jsx|tw)-|[:[\\]]/.test(cls);
  const part = el => {
    if (el.id && usable(el.id) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    let s = el.tagName.toLowerCase();
    const classes = [...el.classList].filter(usable).slice(0, 2);
    if (classes.length) s += classes.map(c => '.' + CSS.escape(c)).join('');
    const parent = el.parentElement;
    if (parent && [...parent.children].filter(c => c.tagName === el.tagName).length > 1) s += ':nth-of-type(' + ([...parent.children].filter(c => c.tagName === el.tagName).indexOf(el) + 1) + ')';
    return s;
  };
  const selectorFor = el => {
    const chain = [];
    for (let node = el; node && node !== document.body && chain.length < 5; node = node.parentElement) {
      chain.unshift(part(node));
      if (chain[0].startsWith('#')) break;
      const selector = chain.join(' > ');
      try { if (document.querySelectorAll(selector).length === 1) return selector; } catch {}
    }
    return chain.join(' > ');
  };
  const finish = result => {
    removeEventListener('mousemove', move, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true);
    box.remove(); tip.remove(); window.__browseryZapping = false; clearTimeout(timer); resolve(result);
  };
  const move = event => {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === document.documentElement || el === document.body) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const click = event => {
    event.preventDefault(); event.stopImmediatePropagation();
    if (!current) return;
    const selector = selectorFor(current);
    const label = (current.getAttribute('aria-label') || current.textContent || current.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60);
    current.style.setProperty('display', 'none', 'important');
    finish({ status: 'picked', selector, label });
  };
  const key = event => { if (event.key === 'Escape') { event.preventDefault(); finish({ status: 'cancelled' }); } };
  const timer = setTimeout(() => finish({ status: 'timeout' }), 60000);
  addEventListener('mousemove', move, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
})`;

// ---------- JSON viewer ----------
export const JSON_RENDER = `(() => {
  if (document.querySelector('.browsery-json')) return true;
  const only = document.body && document.body.children.length === 1 ? document.body.firstElementChild : null;
  const pre = only && only.tagName === 'PRE' ? only : null;
  if (!/json/i.test(document.contentType || '') && !pre) return false;
  const raw = (pre || document.body)?.textContent || '';
  if (!raw.trim() || raw.length > 8e6) return false;
  let data; try { data = JSON.parse(raw); } catch { return false; }
  let nodes = 0;
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const render = (value, key, depth) => {
    nodes += 1;
    const row = el('div', 'bj-row');
    if (key != null) row.append(el('span', 'bj-key', JSON.stringify(key)), el('span', 'bj-p', ': '));
    if (value && typeof value === 'object') {
      const isArray = Array.isArray(value), entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
      if (!entries.length) { row.append(el('span', 'bj-p', isArray ? '[]' : '{}')); return row; }
      const details = el('details'); details.open = depth < 2;
      const summary = el('summary', '', '');
      summary.append(...row.childNodes, el('span', 'bj-p', isArray ? '[' : '{'), el('span', 'bj-count', ' ' + entries.length + (isArray ? ' items' : ' keys') + ' '));
      details.append(summary);
      const body = el('div', 'bj-body');
      for (const [k, v] of entries) { if (nodes > 25000) { body.append(el('div', 'bj-more', '… too large to show fully. Use Raw.')); break; } body.append(render(v, isArray ? null : k, depth + 1)); }
      details.append(body, el('span', 'bj-p', isArray ? ']' : '}'));
      return details;
    }
    const type = value === null ? 'null' : typeof value;
    row.append(el('span', 'bj-' + type, JSON.stringify(value)));
    return row;
  };
  const view = el('div', 'browsery-json');
  const bar = el('div', 'bj-bar');
  const formatted = el('button', 'bj-on', 'Formatted'), rawButton = el('button', '', 'Raw');
  const tree = el('div', 'bj-tree'); tree.append(render(data, null, 0));
  const rawView = el('pre', 'bj-raw', JSON.stringify(data, null, 2)); rawView.hidden = true;
  formatted.onclick = () => { tree.hidden = false; rawView.hidden = true; formatted.className = 'bj-on'; rawButton.className = ''; };
  rawButton.onclick = () => { tree.hidden = true; rawView.hidden = false; rawButton.className = 'bj-on'; formatted.className = ''; };
  bar.append(el('b', '', 'JSON'), formatted, rawButton);
  view.append(bar, tree, rawView);
  document.body.replaceChildren(view);
  return true;
})()`;

export const JSON_CSS = `body{margin:0;background:#0b0b0b}.browsery-json{font:13px/1.55 ui-monospace,"Cascadia Code",Consolas,monospace;color:#ddd;padding:0 0 40px}
.bj-bar{position:sticky;top:0;display:flex;gap:6px;align-items:center;padding:10px 16px;background:#111;border-bottom:1px solid #2a2a2a}.bj-bar b{margin-right:8px;color:#fff;font:600 12px system-ui}
.bj-bar button{padding:5px 11px;border:1px solid #3a3a3a;border-radius:7px;background:#181818;color:#bbb;font:12px system-ui;cursor:pointer}.bj-bar button.bj-on{background:#eee;color:#111;border-color:#eee}
.bj-tree{padding:12px 16px}.bj-body{padding-left:20px;border-left:1px solid #262626;margin-left:4px}.bj-row{white-space:pre-wrap;word-break:break-word}
.browsery-json details>summary{cursor:pointer;list-style:none}.browsery-json details>summary::-webkit-details-marker{display:none}.browsery-json details:not([open])>.bj-body{display:none}
.bj-key{color:#e8e8e8}.bj-string{color:#a8d4a0}.bj-number{color:#9ec5f2}.bj-boolean,.bj-null{color:#e6b673}.bj-p,.bj-count{color:#777}.bj-more{color:#888;font-style:italic}.bj-raw{margin:0;padding:12px 16px;white-space:pre-wrap;color:#ddd}`;

// Validates a stored element-zapper selector before it is put into CSS.
export function safeSelector(value) {
  const selector = String(value || '').trim();
  return selector && selector.length <= 400 && !/[{};<@\\]|\/\*/.test(selector) ? selector : '';
}
