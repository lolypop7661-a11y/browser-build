'use strict';

// Browsery's blocker intentionally ships a compact, high-confidence rule set.
// It is local-only: no filter list is downloaded, no browsing URLs are logged,
// and a site's allowlist entry is stored only on this device.

const fs = require('node:fs');
const path = require('node:path');
const { domainToASCII } = require('node:url');

const MAX_ALLOWLIST_ENTRIES = 500;
const TRACKER_MODES = new Set(['Standard', 'Balanced', 'Strict']);
const SUBRESOURCE_TYPES = new Set(['script', 'image', 'media', 'font', 'stylesheet', 'xhr', 'fetch', 'websocket', 'subframe', 'other']);
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
]);

// Balanced blocks well-known analytics/marketing endpoints. Strict adds
// additional named session-replay and telemetry providers. The explicit host
// lists deliberately avoid generic URL heuristics that can break normal APIs.
const BALANCED_TRACKERS = new Set([
  'analytics.google.com', 'analytics.tiktok.com', 'api.amplitude.com', 'api.segment.io', 'cdn.amplitude.com',
  'cdn.segment.com', 'connect.facebook.net', 'google-analytics.com', 'googletagmanager.com', 'hotjar.com',
  'kissmetrics.io', 'luckyorange.com', 'mixpanel.com', 'segment.io', 'amplitude.com',
]);
const STRICT_TRACKERS = new Set([
  'app-measurement.com', 'bat.bing.com', 'braze.com', 'bugsnag.com', 'clarity.ms', 'contentsquare.net',
  'crazyegg.com', 'fullstory.com', 'heap.io', 'heapanalytics.com', 'intercom.io', 'mouseflow.com',
  'newrelic.com', 'nr-data.net', 'omtrdc.net', 'optimizely.com', 'pendo.io', 'quantcount.com',
  'scorecardresearch.com', 'sentry.io', 'snowplowanalytics.com', 'tealiumiq.com', 'visualwebsiteoptimizer.com',
]);

const AD_PATH_PATTERNS = [
  /\/(?:pagead|gampad|adserver|adserve|adsbygoogle|prebid|rtb)(?:[/?]|$)/i,
  /[?&](?:adslot|ad_slot|adunit|ad_unit|creative_id|placement_id)=/i,
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

function createAdblocker({ statePath }) {
  if (typeof statePath !== 'string' || !statePath) throw new Error('An ad-blocker state path is required.');
  const allowlist = readAllowlist(statePath);
  const stats = { blockedCount: 0, adsBlocked: 0, trackersBlocked: 0, lastBlockedAt: null };

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
        const hostRule = matchingHostRule(requestHost, AD_NETWORKS);
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
        const balancedRule = matchingHostRule(requestHost, BALANCED_TRACKERS);
        const strictRule = trackerMode === 'Strict' ? matchingHostRule(requestHost, STRICT_TRACKERS) : '';
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
  };
}

module.exports = { createAdblocker, normalizeHost };
