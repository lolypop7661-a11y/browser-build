// Runs installed extensions against open tabs and stores their settings.
// Framework-free so it can be tested without a browser.
import { extensionById, isWebPage, siteOf } from './catalog.js';

const INSTALLED_KEY = 'browsery:extensions-v2';
const CONFIG_KEY = 'browsery:extension-config-v1';
const LEGACY_KEY = 'browsery:extensions-v1';
const MAX_CONFIG_BYTES = 200_000;
const HOOK_TIMEOUT = 8000;
const TRACK_INTERVAL = 5000;

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));

// Keep each stored value the same shape as its default so a corrupted or
// hand-edited profile can never crash an extension.
function normalizeConfig(id, value) {
  const defaults = extensionById.get(id)?.defaults || {};
  const stored = isPlainObject(value) ? value : {};
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const candidate = stored[key];
    const sameShape = Array.isArray(fallback) ? Array.isArray(candidate) : isPlainObject(fallback) ? isPlainObject(candidate) : typeof candidate === typeof fallback;
    result[key] = sameShape ? candidate : clone(fallback);
  }
  return result;
}

const dayKey = time => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function createExtensionHost({ storage = globalThis.localStorage, now = () => Date.now(), timers = globalThis, environment = globalThis.document } = {}) {
  const read = (key, fallback) => {
    try { const value = JSON.parse(storage?.getItem(key) || 'null'); return isPlainObject(value) ? value : fallback; } catch { return fallback; }
  };
  const write = (key, value) => { try { storage?.setItem(key, JSON.stringify(value)); } catch {} };
  try { storage?.removeItem(LEGACY_KEY); } catch {}

  const savedInstalled = read(INSTALLED_KEY, {});
  const savedConfigs = read(CONFIG_KEY, {});
  let state = {
    installed: Object.fromEntries(Object.entries(savedInstalled).filter(([id, entry]) => extensionById.has(id) && entry?.installed)
      .map(([id, entry]) => [id, { installed: true, installedAt: Number(entry.installedAt) || now() }])),
    configs: Object.fromEntries([...extensionById.keys()].map(id => [id, normalizeConfig(id, savedConfigs[id])])),
    refresh: {},
  };
  const listeners = new Set();
  const controllers = new Map();
  const cssKeys = new WeakMap();
  const refreshTimers = new Map();
  let active = { tabId: null, url: '', title: '' };
  let trackTimer = null, pendingTime = {}, lastFlush = now();

  const emit = next => { state = next; listeners.forEach(listener => { try { listener(); } catch {} }); };
  const persistInstalled = () => write(INSTALLED_KEY, state.installed);
  const persistConfigs = () => write(CONFIG_KEY, state.configs);
  const isInstalled = id => Boolean(state.installed[id]);

  function setConfig(id, update) {
    if (!extensionById.has(id)) return;
    const current = state.configs[id];
    const patch = typeof update === 'function' ? update(clone(current)) : update;
    if (!isPlainObject(patch)) return;
    const next = normalizeConfig(id, { ...current, ...patch });
    if (JSON.stringify(next).length > MAX_CONFIG_BYTES) return;
    emit({ ...state, configs: { ...state.configs, [id]: next } });
    persistConfigs();
  }

  // A page API bound to one tab and one extension. CSS keys are remembered so
  // an extension can replace or remove only its own styles.
  function pageFor(view, id) {
    const keys = () => { let map = cssKeys.get(view); if (!map) { map = new Map(); cssKeys.set(view, map); } return map; };
    const page = {
      exec: (code, gesture = false) => view.executeJavaScript(code, gesture),
      async removeCSS() {
        const key = keys().get(id);
        if (!key) return;
        keys().delete(id);
        try { await view.removeInsertedCSS(key); } catch {}
      },
      async insertCSS(css) {
        await page.removeCSS();
        const key = await view.insertCSS(css);
        if (key) keys().set(id, key);
      },
      setZoom: factor => { try { view.setZoomFactor(factor); } catch {} },
    };
    return page;
  }

  async function runHook(id, controller, url) {
    const extension = extensionById.get(id);
    if (!extension?.onPageReady || !controller?.view || !isWebPage(url)) return;
    const hook = extension.onPageReady({
      url, page: pageFor(controller.view, id), config: state.configs[id], setConfig: update => setConfig(id, update),
    });
    let timer;
    try {
      await Promise.race([hook, new Promise((_, reject) => { timer = timers.setTimeout(() => reject(new Error('timeout')), HOOK_TIMEOUT); })]);
    } catch (error) {
      // An extension failing on one page must never break browsing.
      if (error?.message !== 'timeout') console.warn(`Browsery extension ${id} failed on this page:`, error?.message || error);
    } finally { timers.clearTimeout(timer); }
  }

  function activeController() {
    const controller = controllers.get(active.tabId);
    return controller?.ready ? controller : null;
  }

  function setRefresh(tabId, seconds) {
    const old = refreshTimers.get(tabId);
    if (old) timers.clearInterval(old);
    refreshTimers.delete(tabId);
    const refresh = { ...state.refresh };
    delete refresh[tabId];
    const interval = Number(seconds);
    if (interval >= 5) {
      refresh[tabId] = interval;
      refreshTimers.set(tabId, timers.setInterval(() => {
        const controller = controllers.get(tabId);
        try { if (controller?.ready && !controller.view.isLoading?.()) controller.view.reload(); } catch {}
      }, interval * 1000));
    }
    emit({ ...state, refresh });
  }

  function flushTime() {
    lastFlush = now();
    if (!Object.keys(pendingTime).length) return;
    const add = pendingTime;
    pendingTime = {};
    setConfig('time-tracker', current => {
      const days = { ...current.days };
      for (const [day, sites] of Object.entries(add)) {
        const today = { ...(days[day] || {}) };
        for (const [site, seconds] of Object.entries(sites)) today[site] = (Number(today[site]) || 0) + seconds;
        days[day] = Object.fromEntries(Object.entries(today).sort((a, b) => b[1] - a[1]).slice(0, 300));
      }
      return { days: Object.fromEntries(Object.entries(days).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14)) };
    });
  }

  function syncTracker() {
    const wanted = isInstalled('time-tracker');
    if (wanted && !trackTimer) {
      trackTimer = timers.setInterval(() => {
        const visible = !environment || (environment.visibilityState === 'visible' && environment.hasFocus?.() !== false);
        const site = siteOf(active.url);
        if (visible && site) {
          const day = dayKey(now());
          pendingTime[day] ||= {};
          pendingTime[day][site] = (pendingTime[day][site] || 0) + TRACK_INTERVAL / 1000;
        }
        if (now() - lastFlush >= 30000) flushTime();
      }, TRACK_INTERVAL);
    } else if (!wanted && trackTimer) {
      timers.clearInterval(trackTimer);
      trackTimer = null;
      pendingTime = {};
    }
  }
  syncTracker();

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    isInstalled,
    install(id) {
      if (!extensionById.has(id) || isInstalled(id)) return;
      emit({ ...state, installed: { ...state.installed, [id]: { installed: true, installedAt: now() } } });
      persistInstalled();
      syncTracker();
      const controller = activeController();
      if (controller) runHook(id, controller, active.url);
    },
    async uninstall(id) {
      if (!isInstalled(id)) return;
      const installed = { ...state.installed };
      delete installed[id];
      emit({ ...state, installed });
      persistInstalled();
      syncTracker();
      if (id === 'auto-refresh') for (const tabId of Object.keys(state.refresh)) setRefresh(Number(tabId) || tabId, 0);
      for (const controller of controllers.values()) if (controller.ready) await pageFor(controller.view, id).removeCSS();
    },
    config: id => state.configs[id],
    setConfig,
    attach(tabId, controller) { controllers.set(tabId, controller); },
    detach(tabId) { controllers.delete(tabId); if (refreshTimers.has(tabId)) setRefresh(tabId, 0); },
    setActive(next) { active = { tabId: next?.tabId ?? null, url: String(next?.url || ''), title: String(next?.title || '') }; },
    getActive: () => active,
    activeController,
    controller: tabId => controllers.get(tabId) || null,
    page: id => { const controller = activeController(); return controller ? pageFor(controller.view, id) : null; },
    async pageReady(tabId, controller, url) {
      controllers.set(tabId, controller);
      await Promise.all(Object.keys(state.installed).map(id => runHook(id, controller, url)));
    },
    reapply(id) {
      const controller = activeController();
      return controller ? runHook(id, controller, active.url) : Promise.resolve();
    },
    checkNavigation(url) {
      for (const id of Object.keys(state.installed)) {
        const reason = extensionById.get(id)?.checkNavigation?.(url, state.configs[id], now());
        if (reason) return reason;
      }
      return null;
    },
    zoomChanged(url, factor) {
      for (const id of Object.keys(state.installed)) extensionById.get(id)?.onZoom?.(url, factor, update => setConfig(id, update));
    },
    setRefresh,
    isBusy: tabId => Boolean(state.refresh[tabId]),
    flushTime,
    dispose() {
      flushTime();
      if (trackTimer) timers.clearInterval(trackTimer);
      for (const timer of refreshTimers.values()) timers.clearInterval(timer);
    },
  };
}
