// Browsery's built-in extension catalogue. Every extension adds a capability the
// base browser does not have. Extensions are bundled code: nothing is ever
// downloaded or run from the web.
import { COOKIE_CSS, COOKIE_DECLINE, JSON_CSS, JSON_RENDER, NIGHT_CSS, NIGHT_PROBE, safeSelector, videoSpeed } from './scripts.js';

export function siteOf(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '').toLowerCase() : '';
  } catch { return ''; }
}

export const isWebPage = url => Boolean(siteOf(url));

// Matches a host against a list entry such as "youtube.com" (subdomains included).
export const hostMatches = (host, entry) => Boolean(host && entry) && (host === entry || host.endsWith(`.${entry}`));

export const extensionCatalog = [
  {
    id: 'night-shift', name: 'Night Shift', category: 'Reading', icon: 'moon',
    description: 'Turns bright websites dark automatically, while keeping photos and videos in their real colors.',
    defaults: { excluded: [] },
    async onPageReady({ url, page, config }) {
      const site = siteOf(url);
      if (!site || config.excluded.includes(site)) return page.removeCSS();
      const probe = await page.exec(NIGHT_PROBE);
      if (Number(probe?.luminance) > 0.6 && !probe?.dark) await page.insertCSS(NIGHT_CSS);
      else page.removeCSS();
    },
  },
  {
    id: 'reader', name: 'Reader View', category: 'Reading', icon: 'book',
    description: 'Strips ads, menus and clutter from an article and shows just the text in a calm, adjustable layout.',
    defaults: { size: 18 }, wide: true,
  },
  {
    id: 'read-aloud', name: 'Read Aloud', category: 'Reading', icon: 'speaker',
    description: 'Reads the article or your selected text out loud with your system voices. Pause, skip and change speed.',
    defaults: { rate: 1, voice: '' },
  },
  {
    id: 'outline', name: 'Page Outline', category: 'Reading', icon: 'list',
    description: 'A live table of contents for any page. Jump straight to any heading in long docs and articles.',
    defaults: {},
  },
  {
    id: 'pip', name: 'Pop-out Video', category: 'Media', icon: 'pip',
    description: 'Pops the video on the current page into a floating window that stays on top while you browse.',
    defaults: {},
  },
  {
    id: 'video-speed', name: 'Video Speed', category: 'Media', icon: 'gauge',
    description: 'Plays videos from 0.25× to 4× and remembers your favourite speed for each site.',
    defaults: { rates: {} },
    async onPageReady({ url, page, config }) {
      const rate = Number(config.rates[siteOf(url)]);
      if (rate && rate !== 1) await page.exec(videoSpeed(rate));
    },
  },
  {
    id: 'image-grabber', name: 'Image Grabber', category: 'Media', icon: 'image',
    description: 'Lists every image on the page in one grid so you can save any of them in a click.',
    defaults: {}, wide: true,
  },
  {
    id: 'snapshot', name: 'Snapshot', category: 'Media', icon: 'camera',
    description: 'Captures what you see in the current tab as a PNG. Save it or copy it to your clipboard.',
    defaults: {},
  },
  {
    id: 'color-picker', name: 'Color Picker', category: 'Media', icon: 'droplet',
    description: 'Picks any color on screen and copies it as HEX, RGB or HSL. Keeps your recent picks.',
    defaults: { history: [] },
  },
  {
    id: 'cookie-dismiss', name: 'Cookie Pop-up Killer', category: 'Cleanup', icon: 'cookie',
    description: 'Hides cookie consent pop-ups from common providers and declines optional cookies when it can.',
    defaults: { excluded: [], declined: 0 },
    async onPageReady({ url, page, config, setConfig }) {
      const site = siteOf(url);
      if (!site || config.excluded.includes(site)) return page.removeCSS();
      await page.insertCSS(COOKIE_CSS);
      const clicked = Number(await page.exec(COOKIE_DECLINE)) || 0;
      if (clicked) setConfig(current => ({ declined: (Number(current.declined) || 0) + clicked }));
    },
  },
  {
    id: 'zapper', name: 'Element Zapper', category: 'Cleanup', icon: 'target',
    description: 'Click any annoying box, banner or sidebar to hide it. It stays hidden every time you return to that site.',
    defaults: { rules: {} },
    async onPageReady({ url, page, config }) {
      const rules = (config.rules[siteOf(url)] || []).map(rule => safeSelector(rule.selector)).filter(Boolean);
      if (!rules.length) return page.removeCSS();
      await page.insertCSS(`${rules.join(',\n')}{display:none!important}`);
    },
  },
  {
    id: 'json-viewer', name: 'JSON Viewer', category: 'Cleanup', icon: 'braces',
    description: 'Turns raw JSON from APIs into a readable, collapsible, colour-coded tree with a Raw switch.',
    defaults: { formatted: 0 },
    async onPageReady({ page, setConfig }) {
      if (await page.exec(JSON_RENDER) === true) {
        await page.insertCSS(JSON_CSS);
        setConfig(current => ({ formatted: (Number(current.formatted) || 0) + 1 }));
      }
    },
  },
  {
    id: 'focus-mode', name: 'Focus Mode', category: 'Productivity', icon: 'focus',
    description: 'Starts a timed focus session that blocks the distracting sites you choose until the timer ends.',
    defaults: { blocked: ['youtube.com', 'reddit.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com'], endsAt: 0 },
    checkNavigation(url, config, now = Date.now()) {
      if (!(Number(config.endsAt) > now)) return null;
      const site = siteOf(url);
      const match = config.blocked.find(entry => hostMatches(site, entry));
      if (!match) return null;
      const minutes = Math.max(1, Math.ceil((config.endsAt - now) / 60000));
      return `Focus Mode is blocking ${match} for ${minutes} more minute${minutes === 1 ? '' : 's'}.`;
    },
  },
  {
    id: 'site-notes', name: 'Site Notes', category: 'Productivity', icon: 'note',
    description: 'Keep private notes for each website. They come back automatically when you revisit the site.',
    defaults: { notes: {} },
  },
  {
    id: 'clips', name: 'Clipboard Clips', category: 'Productivity', icon: 'quote',
    description: 'Save highlighted text from any page with its source link, then copy everything as tidy Markdown.',
    defaults: { items: [] },
  },
  {
    id: 'time-tracker', name: 'Time Tracker', category: 'Productivity', icon: 'clock',
    description: 'Shows how long you actually spent on each site today and this week. Stays on this computer.',
    defaults: { days: {} },
  },
  {
    id: 'auto-refresh', name: 'Auto Refresh', category: 'Productivity', icon: 'refresh',
    description: 'Reloads a tab on a timer, handy for dashboards, live scores, order pages and status pages.',
    defaults: {},
  },
  {
    id: 'password-generator', name: 'Password Generator', category: 'Tools', icon: 'key',
    description: 'Creates strong random passwords and passphrases on your device, with a strength meter.',
    defaults: { length: 20, symbols: true, mode: 'password' },
  },
  {
    id: 'link-inspector', name: 'Link Inspector', category: 'Tools', icon: 'link',
    description: 'Lists every link on a page grouped by website, so you can filter, open or copy them all at once.',
    defaults: {}, wide: true,
  },
  {
    id: 'zoom-memory', name: 'Zoom Memory', category: 'Tools', icon: 'zoomIn',
    description: 'Remembers the zoom level you choose for each site and restores it every time, even after restarting.',
    defaults: { sites: {} },
    async onPageReady({ url, page, config }) {
      const factor = Number(config.sites[siteOf(url)]);
      if (factor && factor !== 1) page.setZoom(factor);
    },
    onZoom(url, factor, setConfig) {
      const site = siteOf(url);
      if (!site) return;
      setConfig(current => {
        const sites = { ...current.sites };
        if (Math.abs(factor - 1) < 0.01) delete sites[site]; else sites[site] = Math.round(factor * 100) / 100;
        return { sites: Object.fromEntries(Object.entries(sites).slice(-400)) };
      });
    },
  },
];

export const extensionById = new Map(extensionCatalog.map(extension => [extension.id, extension]));
export const extensionCategories = ['All', ...new Set(extensionCatalog.map(extension => extension.category))];
