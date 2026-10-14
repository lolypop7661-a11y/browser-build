'use strict';

// Browsery's blocker intentionally ships a compact, high-confidence rule set.
// It is local-only: no filter list is downloaded, no browsing URLs are logged,
// and a site's allowlist entry is stored only on this device.

const fs = require('node:fs');
const path = require('node:path');
const { domainToASCII } = require('node:url');

const MAX_ALLOWLIST_ENTRIES = 500;
const MAX_REMOTE_RULES_PER_CATEGORY = 30_000;
const RULE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_RULE_DEFINITION_BYTES = 3 * 1024 * 1024;
// This URL is only a data document published with Browsery releases. It is
// deliberately not a generic subscription URL: Browsery never executes remote
// rules or JavaScript, and malformed data is ignored atomically.
const RULE_UPDATE_URL = 'https://github.com/lolypop7661-a11y/browser-build/releases/latest/download/browsery-adblock-rules.json';
const TRACKER_MODES = new Set(['Standard', 'Balanced', 'Strict']);
const SUBRESOURCE_TYPES = new Set(['script', 'image', 'media', 'font', 'stylesheet', 'xhr', 'fetch', 'websocket', 'subframe', 'other']);
const EMPTY_RULES = new Set();
const MULTIPART_PUBLIC_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'gov.uk', 'ltd.uk', 'me.uk', 'net.uk', 'nhs.uk', 'org.uk', 'plc.uk', 'sch.uk',
  'com.au', 'edu.au', 'gov.au', 'id.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'com.cn', 'com.mx', 'co.nz', 'co.za', 'com.sg', 'com.tr', 'com.tw', 'co.in', 'com.ar',
]);

// Advertising, bidding and ad-verification endpoints. These rules are applied
// only to subresources, so typing one of these domains into the address bar
// still works normally.
const AD_NETWORKS = new Set([
  '2mdn.net', 'ad-delivery.net', 'adform.net', 'adition.com', 'adnxs.com', 'adroll.com',
  '33across.com', 'adcash.com', 'adcolony.com', 'adinplay.com', 'admantx.com', 'admetricspro.com',
  'admost.com', 'adrecover.com', 'adsafeprotected.com', 'adsco.re', 'adsrvr.org', 'adtelligent.com',
  'adup-tech.com', 'adxpansion.com', 'advertising.com', 'amazon-adsystem.com', 'bidr.io', 'bidswitch.net',
  'bidvertiser.com', 'bluekai.com', 'btrll.com', 'carbonads.com', 'casalemedia.com', 'connatix.com',
  'contextweb.com', 'conversantmedia.com', 'criteo.com', 'criteo.net', 'demdex.net', 'distriqt.com',
  'doubleclick.net', 'doubleverify.com', 'everesttech.net', 'ezoic.net', 'exosrv.com', 'getintent.com',
  'googleadservices.com', 'googlesyndication.com', 'googletagservices.com', 'gumgum.com', 'imrworldwide.com',
  'indexexchange.com', 'inmobi.com', 'kargo.com', 'lijit.com', 'lkqd.net', 'madsrevenue.com', 'mathtag.com',
  'media.net', 'moatads.com', 'nativeads.com', 'openx.net', 'outbrain.com', 'popads.net', 'pubmatic.com',
  'quantserve.com', 'revcontent.com', 'rfihub.com', 'rubiconproject.com', 'scorecardresearch.com', 'serving-sys.com',
  'sharethrough.com', 'smartadserver.com', 'sonarads.com', 'sovrn.com', 'spotxchange.com', 'taboola.com',
  'teads.tv', 'tremorhub.com', 'tradedoubler.com', 'triplelift.com', 'underdogmedia.com', 'unrulymedia.com',
  'vidible.tv', 'xandr.com', 'yieldmo.com', 'zedo.com', 'zemanta.com',
  // Common regional and mobile exchanges. Keeping these as exact host rules
  // makes the filter predictable and avoids the false positives of matching
  // generic words such as "ad" in arbitrary URLs.
  'adkernel.com', 'adnami.io', 'adnimation.com', 'adnxs.net', 'adskeeper.co.uk',
  'adsterra.com', 'adthrive.com', 'a-ads.com', 'bannerflow.com', 'betweendigital.com',
  'bidswitch.net', 'cedato.com', 'chartboost.com', 'clickadu.com',
  'criteo.net', 'dianomi.com', 'digitalturbine.com', 'dspdigital.com', 'emxdgt.com',
  'engageya.com', 'epsilon.com', 'fwmrm.net', 'gamoshi.io', 'geniee.jp',
  'gumgumads.com', 'hyprmx.com', 'impact-ad.jp', 'impactradius.com', 'infolinks.com',
  'innovid.com', 'justpremium.com', 'loopme.me', 'magnite.com', 'mgid.com', 'mintegral.com',
  'mobfox.com', 'mytarget.ru', 'nativo.com', 'nend.net', 'nielsen.com', 'ogury.co',
  'onetrust.com', 'optad360.com', 'optimonk.com', 'playwire.com', 'primis.tech',
  'proximic.com', 'qortex.ai', 'redintelligence.net', 'richrelevance.com', 'rtbhouse.com',
  'smaato.net', 'smilewanted.com', 'smrtb.com', 'sonobi.com', 'stickyadstv.com',
  'tapad.com', 'tappx.com', 'thetradedesk.com', 'trafficjunky.net', 'undertone.com',
  'verizonmedia.com', 'vidoomy.com', 'vungle.com', 'weborama.com', 'zedo.net',
]);

// Balanced blocks well-known analytics/marketing endpoints. Strict adds
// additional named session-replay and telemetry providers. The explicit host
// lists deliberately avoid generic URL heuristics that can break normal APIs.
const BALANCED_TRACKERS = new Set([
  'analytics.google.com', 'analytics.tiktok.com', 'api.amplitude.com', 'api.segment.io', 'cdn.amplitude.com',
  'cdn.segment.com', 'connect.facebook.net', 'google-analytics.com', 'googletagmanager.com', 'hotjar.com',
  'kissmetrics.io', 'luckyorange.com', 'mixpanel.com', 'segment.io', 'amplitude.com',
  'adobe.io', 'analytics.yahoo.com', 'atdmt.com', 'branch.io', 'cdn-analytics.pl',
  'chartbeat.com', 'dwin1.com', 'evergage.com', 'firebaseinstallations.googleapis.com',
  'logrocket.com', 'matomo.cloud', 'matomo.org', 'metrics.apple.com', 'monetate.net',
  'mopub.com', 'parsely.com', 'posthog.com', 'quantserve.com', 'sailthru.com',
  'scorecardresearch.com', 'shopifycloud.com', 'snap.licdn.com', 't.co', 'tags.tiqcdn.com',
  'tealium.com', 'w55c.net', 'woopra.com', 'yandex.ru',
]);
const STRICT_TRACKERS = new Set([
  'app-measurement.com', 'bat.bing.com', 'braze.com', 'bugsnag.com', 'clarity.ms', 'contentsquare.net',
  'crazyegg.com', 'fullstory.com', 'heap.io', 'heapanalytics.com', 'intercom.io', 'mouseflow.com',
  'newrelic.com', 'nr-data.net', 'omtrdc.net', 'optimizely.com', 'pendo.io', 'quantcount.com',
  'scorecardresearch.com', 'sentry.io', 'snowplowanalytics.com', 'tealiumiq.com', 'visualwebsiteoptimizer.com',
  'adobedtm.com', 'appcues.com', 'braintreegateway.com', 'cquotient.com', 'datadoghq.com',
  'decibelinsight.com', 'dynamicyield.com', 'elastic.co', 'getsentry.com', 'glassboxdigital.io',
  'launchdarkly.com', 'mparticle.com', 'nr-data.net', 'permutive.com', 'qualtrics.com',
  'quantummetric.com', 'raygun.com', 'redtrack.io', 'rybbon.net', 'smartlook.com',
  'splunkcloud.com', 'taplytics.com', 'usercentrics.eu', 'userleap.com', 'userzoom.com',
  'vitals.io', 'watchmouse.com', 'zendesk.com',
]);

const AD_PATH_PATTERNS = [
  /\/(?:pagead|gampad|adserver|adserve|adsbygoogle|prebid|rtb)(?:[/?]|$)/i,
  /[?&](?:adslot|ad_slot|adunit|ad_unit|creative_id|placement_id)=/i,
  /\/(?:ads?|advert(?:isement|ising)?|banner|sponsor)(?:[._/-]|$)/i,
  /[?&](?:utm_(?:source|medium|campaign|term|content)|gclid|fbclid|msclkid)=/i,
];
function normalizeHost(input) {
  if (typeof input !== 'string') return '';
  let candidate = input.trim();
  if (!candidate) return '';
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = new URL(candidate).hostname;
  } catch {
    return '';
  }
  candidate = candidate.toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!candidate || candidate.length > 253 || /[\s/@?#\\]/.test(candidate)) return '';
  const host = domainToASCII(candidate).toLowerCase();
  if (!host || host.length > 253 || !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/.test(host)) return '';
  return host;
}

function hostFromUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try { return normalizeHost(new URL(value).hostname); } catch { return ''; }
}

function matchingHostRule(host, rules) {
  let candidate = normalizeHost(host);
  while (candidate) {
    if (rules.has(candidate)) return candidate;
    const separator = candidate.indexOf('.');
    if (separator === -1) break;
    candidate = candidate.slice(separator + 1);
  }
  return '';
}

function siteKey(host) {
  const labels = normalizeHost(host).split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const suffix = labels.slice(-2).join('.');
  return labels.slice(MULTIPART_PUBLIC_SUFFIXES.has(suffix) ? -3 : -2).join('.');
}

function isThirdParty(requestHost, sourceHost) {
  const requestSite = siteKey(requestHost);
  const sourceSite = siteKey(sourceHost);
  return Boolean(requestSite && sourceSite && requestSite !== sourceSite);
}

function isSubresource(resourceType) {
  return SUBRESOURCE_TYPES.has(String(resourceType || '').toLowerCase());
}

function modeFromPreferences(preferences) {
  const mode = preferences?.trackers;
  return TRACKER_MODES.has(mode) ? mode : 'Standard';
}

function readAllowlist(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const rawSites = Array.isArray(parsed) ? parsed : parsed?.sites;
    if (!Array.isArray(rawSites)) return new Set();
    const sites = new Set();
    for (const value of rawSites) {
      const host = normalizeHost(value);
      if (host) sites.add(host);
      if (sites.size >= MAX_ALLOWLIST_ENTRIES) break;
    }
    return sites;
  } catch {
    return new Set();
  }
}

function safeWriteAllowlist(statePath, allowlist) {
  const directory = path.dirname(statePath);
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  const body = JSON.stringify({ version: 1, sites: [...allowlist].sort() }, null, 2);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryPath, body, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, statePath);
    return true;
  } catch {
    try { fs.unlinkSync(temporaryPath); } catch {}
    return false;
  }
}

function sanitizeRuleHosts(values) {
  if (!Array.isArray(values)) return new Set();
  const hosts = new Set();
  for (const value of values) {
    const host = normalizeHost(value);
    if (!host) continue;
    hosts.add(host);
    if (hosts.size >= MAX_REMOTE_RULES_PER_CATEGORY) break;
  }
  return hosts;
}

function normalizeRuleDocument(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const adHosts = sanitizeRuleHosts(value.adHosts);
  const balancedTrackers = sanitizeRuleHosts(value.balancedTrackers);
  const strictTrackers = sanitizeRuleHosts(value.strictTrackers);
  // A remote update must contain useful, typed data. A transient error page or
  // an empty response can never erase the last known-good definitions.
  if (!adHosts.size && !balancedTrackers.size && !strictTrackers.size) return null;
  const updatedAt = Number.isFinite(value.updatedAt) && value.updatedAt > 0 ? value.updatedAt : Date.now();
  return {
    version: typeof value.version === 'string' ? value.version.slice(0, 80) : 'unversioned',
    updatedAt,
    adHosts,
    balancedTrackers,
    strictTrackers,
  };
}

function ruleCachePath(statePath) {
  return path.join(path.dirname(statePath), 'adblock-rules-cache.json');
}

function loadRuleCache(cachePath) {
  try { return normalizeRuleDocument(JSON.parse(fs.readFileSync(cachePath, 'utf8'))); }
  catch { return null; }
}

function loadBundledRuleDocument() {
  try { return normalizeRuleDocument(JSON.parse(fs.readFileSync(path.join(__dirname, 'adblock-rules.json'), 'utf8'))); }
  catch { return null; }
}

function serializeRuleDocument(document) {
  return JSON.stringify({
    version: document.version,
    updatedAt: document.updatedAt,
    adHosts: [...document.adHosts].sort(),
    balancedTrackers: [...document.balancedTrackers].sort(),
    strictTrackers: [...document.strictTrackers].sort(),
  });
}

function safeWriteRuleCache(cachePath, document) {
  const temporaryPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(temporaryPath, serializeRuleDocument(document), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, cachePath);
    return true;
  } catch {
    try { fs.unlinkSync(temporaryPath); } catch {}
    return false;
  }
}

async function fetchRuleDocument() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7500);
  try {
    const response = await fetch(RULE_UPDATE_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'Browsery rule updater/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Rule update returned ${response.status}`);
    // GitHub Releases redirects downloads to its own short-lived asset host.
    // Reject every other final origin so this cannot become a general-purpose
    // remote configuration channel.
    const finalHost = new URL(response.url).hostname.toLowerCase();
    if (!['github.com', 'release-assets.githubusercontent.com'].includes(finalHost)) {
      throw new Error('Rule update used an unexpected host');
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_RULE_DEFINITION_BYTES) throw new Error('Rule update is too large');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RULE_DEFINITION_BYTES) throw new Error('Rule update is too large');
    return normalizeRuleDocument(JSON.parse(text));
  } finally {
    clearTimeout(timeout);
  }
}

function createAdblocker({ statePath }) {
  if (typeof statePath !== 'string' || !statePath) throw new Error('An ad-blocker state path is required.');
  const allowlist = readAllowlist(statePath);
  const cachePath = ruleCachePath(statePath);
  const bundledRules = loadBundledRuleDocument();
  const cachedRules = loadRuleCache(cachePath);
  let remoteRules = cachedRules || bundledRules;
  let rulesFromCache = Boolean(cachedRules);
  let refreshPromise = null;
  let lastRefreshAttempt = 0;
  let updateStatus = cachedRules ? 'ready' : bundledRules ? 'bundled-definitions' : 'bundled';
  const stats = { blockedCount: 0, adsBlocked: 0, trackersBlocked: 0, lastBlockedAt: null };

  const refreshRules = async ({ force = false } = {}) => {
    if (refreshPromise) return refreshPromise;
    if (!force && Date.now() - lastRefreshAttempt < RULE_REFRESH_INTERVAL) {
      return { ok: Boolean(remoteRules), status: updateStatus, skipped: true };
    }
    lastRefreshAttempt = Date.now();
    updateStatus = 'updating';
    refreshPromise = fetchRuleDocument().then(document => {
      if (!document) throw new Error('Rule update was not valid');
      remoteRules = document;
      safeWriteRuleCache(cachePath, document);
      rulesFromCache = true;
      updateStatus = 'ready';
      return { ok: true, status: updateStatus, version: document.version, updatedAt: document.updatedAt };
    }).catch(error => {
      // Keep the bundled/cache rules active on every network error. This is a
      // background refresh, not a reason to slow browsing or change a setting.
      updateStatus = remoteRules ? 'stale-cache' : 'bundled';
      return { ok: false, status: updateStatus, message: error?.message || 'Rule update unavailable' };
    }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  };

  const isAllowed = (requestHost, sourceHost) => Boolean(
    matchingHostRule(requestHost, allowlist) || matchingHostRule(sourceHost, allowlist)
  );

  const status = (preferences = {}, site = '') => {
    const trackerMode = modeFromPreferences(preferences);
    const host = normalizeHost(site);
    return {
      enabled: preferences?.adblock !== false || trackerMode !== 'Standard',
      adblockEnabled: preferences?.adblock !== false,
      trackerMode,
      blockedCount: stats.blockedCount,
      adsBlocked: stats.adsBlocked,
      trackersBlocked: stats.trackersBlocked,
      allowlisted: Boolean(host && matchingHostRule(host, allowlist)),
      allowlistCount: allowlist.size,
      lastBlockedAt: stats.lastBlockedAt,
      rules: {
        source: rulesFromCache ? 'Browsery definitions cache' : remoteRules ? 'Bundled Browsery definitions' : 'Core Browsery definitions',
        status: updateStatus,
        version: remoteRules?.version || 'bundled',
        updatedAt: remoteRules?.updatedAt || null,
        adHosts: AD_NETWORKS.size + (remoteRules?.adHosts.size || 0),
        trackerHosts: BALANCED_TRACKERS.size + STRICT_TRACKERS.size + (remoteRules?.balancedTrackers.size || 0) + (remoteRules?.strictTrackers.size || 0),
      },
    };
  };

  const record = category => {
    stats.blockedCount += 1;
    if (category === 'ad') stats.adsBlocked += 1;
    if (category === 'tracker') stats.trackersBlocked += 1;
    stats.lastBlockedAt = Date.now();
  };

  return {
    shouldBlock(details, preferences = {}) {
      // Never interfere with a direct navigation. The blocker only evaluates
      // web subresources, where ad/tracker requests live.
      if (!details || !isSubresource(details.resourceType)) return null;
      let parsed;
      try { parsed = new URL(details.url); } catch { return null; }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      const requestHost = normalizeHost(parsed.hostname);
      if (!requestHost) return null;
      const sourceHost = hostFromUrl(details.initiator) || hostFromUrl(details.referrer) || hostFromUrl(details.documentUrl);
      if (isAllowed(requestHost, sourceHost)) return null;

      const adblockEnabled = preferences?.adblock !== false;
      const trackerMode = modeFromPreferences(preferences);
      const pathAndQuery = `${parsed.pathname}${parsed.search}`;
      const thirdParty = isThirdParty(requestHost, sourceHost);

      if (adblockEnabled) {
        // Cached updates extend the built-in list; a failed/partial update can
        // never make protection weaker than the shipped definitions.
        const hostRule = matchingHostRule(requestHost, AD_NETWORKS) || matchingHostRule(requestHost, remoteRules?.adHosts || EMPTY_RULES);
        if (hostRule) {
          record('ad');
          return { category: 'ad', rule: hostRule };
        }
        if (thirdParty && AD_PATH_PATTERNS.some(pattern => pattern.test(pathAndQuery))) {
          record('ad');
          return { category: 'ad', rule: 'ad-path' };
        }
      }

      if (trackerMode !== 'Standard') {
        const balancedRule = matchingHostRule(requestHost, BALANCED_TRACKERS) || matchingHostRule(requestHost, remoteRules?.balancedTrackers || EMPTY_RULES);
        const strictRule = trackerMode === 'Strict'
          ? matchingHostRule(requestHost, STRICT_TRACKERS) || matchingHostRule(requestHost, remoteRules?.strictTrackers || EMPTY_RULES)
          : '';
        if (balancedRule || strictRule) {
          record('tracker');
          return { category: 'tracker', rule: balancedRule || strictRule };
        }
      }
      return null;
    },

    getStatus(preferences, site = '') {
      return status(preferences, site);
    },

    allowSite(site, preferences = {}) {
      const host = normalizeHost(site);
      if (!host) return { ok: false, message: 'Choose a valid website address.', ...status(preferences) };
      if (allowlist.size >= MAX_ALLOWLIST_ENTRIES && !allowlist.has(host)) return { ok: false, message: 'The site allowlist is full.', ...status(preferences, host) };
      allowlist.add(host);
      const persisted = safeWriteAllowlist(statePath, allowlist);
      return { ok: true, host, persisted, ...status(preferences, host) };
    },

    removeAllowedSite(site, preferences = {}) {
      const host = normalizeHost(site);
      if (!host) return { ok: false, message: 'Choose a valid website address.', ...status(preferences) };
      const removed = allowlist.delete(host);
      const persisted = removed ? safeWriteAllowlist(statePath, allowlist) : true;
      return { ok: true, host, removed, persisted, ...status(preferences, host) };
    },

    listAllowedSites() {
      return [...allowlist].sort();
    },

    resetStats(preferences = {}) {
      stats.blockedCount = 0;
      stats.adsBlocked = 0;
      stats.trackersBlocked = 0;
      stats.lastBlockedAt = null;
      return status(preferences);
    },

    refreshRules,
  };
}

module.exports = { createAdblocker, normalizeHost };
