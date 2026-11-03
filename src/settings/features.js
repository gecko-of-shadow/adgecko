// Feature registry: every switch the extension has, the ONE stream-site list,
// and how stored settings resolve for a page. Pure code. Classic script: the
// worker importScripts it, the ISOLATED content scripts list it first in the
// manifest, the settings page loads it, tests import it for its global.
//
// Storage (chrome.storage.local), small keys only:
//   settings       { v: 1, enabled: bool, features: { <id>: bool } }  global switches
//   siteOverrides  { "<host>": { enabled?: false, features?: { <id>: bool } } }
// The old generalEnabled / generalAllowedOrigins keys are migrated once and
// then kept by the worker as derived mirrors for the DNR and cosmetic code.
(function (root) {
  // Hosts with their own handlers (Twitch, YouTube, Kick and their player /
  // media hosts). Ordinary-site scripts (cosmetic hide, page guards) never run
  // here, "Allow this page" never applies here, and the lists never touch the
  // pages. A host matches itself and every subdomain.
  const STREAM_SITES = Object.freeze([
    "twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn.net",
    "youtube.com", "youtu.be", "youtube-nocookie.com", "youtubekids.com", "googlevideo.com", "ytimg.com", "ggpht.com",
    "kick.com", "kickusercontent.com",
  ]);

  // layer: dnr (network rules), isolated (content script), main (page world)
  // apply: live (takes effect at once) | next-load (the page's next load) |
  //        always (cannot be switched off: no `scripting` permission and
  //        vendored code is not edited; owner decision D-3)
  // perSite: may be overridden for one site
  // sites: where the feature acts ("ordinary" = every site except STREAM_SITES)
  const FEATURES = Object.freeze([
    { id: "network", label: "Block ads and trackers (filter lists)", layer: "dnr", default: true, apply: "live", perSite: true, sites: ["ordinary"] },
    { id: "threatTier", label: "Block known malware hosts (threat lists)", layer: "dnr", default: true, apply: "live", perSite: false, sites: ["all"] },
    { id: "threatFeed", label: "Signed threat feed (off = Pause threat feed)", layer: "dnr", default: true, apply: "live", perSite: false, sites: ["all"] },
    { id: "cosmetic", label: "Hide leftover ad boxes", layer: "isolated", default: true, apply: "live", perSite: true, sites: ["ordinary"], scripts: ["src/cosmetic.js"] },
    { id: "twitchPlayer", label: "Twitch: ad-free stream swap (vendored)", layer: "main", default: true, apply: "always", perSite: false, sites: ["twitch.tv"], scripts: ["src/vendor/video-swap-new.user.js"] },
    { id: "twitchDisplay", label: "Twitch: hide directory ad banners", layer: "isolated", default: true, apply: "live", perSite: false, sites: ["twitch.tv"], scripts: ["src/twitch-directory-ads.js"] },
    { id: "youtubeScriptlets", label: "YouTube: uBlock Origin scriptlets (vendored)", layer: "main", default: true, apply: "always", perSite: false, sites: ["youtube.com"], scripts: ["src/vendor/ubo-youtube.js", "src/vendor/ubo-youtube-isolated.js"] },
    { id: "youtubeWatchdog", label: "YouTube: reload a stuck video start", layer: "main", default: true, apply: "live", perSite: false, sites: ["youtube.com"], scripts: ["src/youtube.js"] },
    { id: "youtubeCosmetic", label: "YouTube: remove sponsored feed tiles (script part)", layer: "main", default: true, apply: "live", perSite: false, sites: ["youtube.com"], scripts: ["src/youtube.js"] },
    { id: "kick", label: "Kick: skip in-stream ads", layer: "main", default: true, apply: "live", perSite: false, sites: ["kick.com"], scripts: ["src/kick.js"] },
    { id: "guardClipboard", label: "Stop pages from copying shell commands (ClickFix)", layer: "main", default: true, apply: "live", perSite: true, sites: ["ordinary"], available: false },
    { id: "guardPopups", label: "Block pop-ups opened without a click", layer: "main", default: false, apply: "live", perSite: true, sites: ["ordinary"], available: false },
    { id: "guardMiners", label: "Block crypto-miner scripts", layer: "dnr", default: true, apply: "live", perSite: false, sites: ["ordinary"], available: false },
  ]);
  const IDS = Object.freeze(FEATURES.map((f) => f.id));
  const byId = (id) => FEATURES.find((f) => f.id === id) || null;

  function normalizeHost(h) {
    return String(h == null ? "" : h).trim().toLowerCase().replace(/\.$/, "");
  }

  function isStreamHost(host) {
    const h = normalizeHost(host);
    if (!h) return false;
    return STREAM_SITES.some((d) => h === d || h.endsWith("." + d));
  }

  // Manifest match patterns for STREAM_SITES (exclude_matches of every
  // ordinary-site content script; test/settings.test.js checks the manifest).
  function streamExcludeMatches() {
    const out = [];
    for (const d of STREAM_SITES) out.push("*://" + d + "/*", "*://*." + d + "/*");
    return out;
  }

  function defaultSettings() {
    const features = {};
    for (const f of FEATURES) features[f.id] = f.default;
    return { v: 1, enabled: true, features };
  }

  // Stored value -> complete, valid settings (unknown ids dropped).
  function normalizeSettings(stored) {
    const out = defaultSettings();
    if (!stored || typeof stored !== "object") return out;
    if (stored.enabled === false) out.enabled = false;
    const f = stored.features || {};
    for (const id of IDS) if (typeof f[id] === "boolean" && byId(id).apply !== "always") out.features[id] = f[id];
    return out;
  }

  function normalizeOverrides(stored) {
    const out = {};
    if (!stored || typeof stored !== "object") return out;
    for (const [host0, o] of Object.entries(stored)) {
      const host = normalizeHost(host0);
      if (!host || !o || typeof o !== "object") continue;
      const entry = {};
      if (o.enabled === false) entry.enabled = false;
      const feats = {};
      for (const id of IDS) {
        const f = byId(id);
        if (f.perSite && o.features && typeof o.features[id] === "boolean") feats[id] = o.features[id];
      }
      if (Object.keys(feats).length) entry.features = feats;
      if (Object.keys(entry).length) out[host] = entry;
    }
    return out;
  }

  // Overrides that apply to a page: its own host and every parent domain;
  // the most specific host wins.
  function overrideFor(overrides, host) {
    const h = normalizeHost(host);
    const labels = h.split(".");
    for (let i = 0; i < labels.length - 1; i++) {
      const key = labels.slice(i).join(".");
      if (overrides[key]) return { host: key, entry: overrides[key] };
    }
    return null;
  }

  // Effective on/off for every feature on one page (host may be "").
  // Always-on features report true (they cannot be switched off here).
  function resolve(settingsIn, overridesIn, host) {
    const s = normalizeSettings(settingsIn);
    const o = overrideFor(normalizeOverrides(overridesIn), host);
    const out = {};
    for (const f of FEATURES) {
      if (f.apply === "always") { out[f.id] = true; continue; }
      if (f.available === false) { out[f.id] = false; continue; }
      let on = s.enabled && s.features[f.id];
      if (o && f.perSite) {
        if (o.entry.enabled === false) on = false;
        else if (o.entry.features && typeof o.entry.features[f.id] === "boolean") on = s.enabled && o.entry.features[f.id];
      }
      out[f.id] = !!on;
    }
    return out;
  }

  // One-time migration from the old keys (idempotent: a stored `settings`
  // wins). generalEnabled -> features.network; each generalAllowedOrigins host
  // -> a site override with the site switched off (what "Allow this page" did).
  function migrateLegacy(stored) {
    const s = stored || {};
    if (s.settings && typeof s.settings === "object") return null;
    const settings = defaultSettings();
    if (s.generalEnabled === false) settings.features.network = false;
    const siteOverrides = normalizeOverrides(s.siteOverrides);
    for (const origin of Array.isArray(s.generalAllowedOrigins) ? s.generalAllowedOrigins : []) {
      let host = "";
      try {
        host = normalizeHost(new URL(origin).hostname);
      } catch {
        continue;
      }
      if (!host || isStreamHost(host)) continue;
      siteOverrides[host] = Object.assign({}, siteOverrides[host], { enabled: false });
    }
    return { settings, siteOverrides };
  }

  // Mirrors for the existing DNR / cosmetic code: lists on when the extension
  // and the network feature are on; "allowed" origins = sites whose override
  // switches the network feature off (never a stream site).
  function legacyMirror(settingsIn, overridesIn) {
    const s = normalizeSettings(settingsIn);
    const o = normalizeOverrides(overridesIn);
    const origins = [];
    for (const [host, e] of Object.entries(o)) {
      if (isStreamHost(host)) continue;
      const off = e.enabled === false || (e.features && e.features.network === false);
      if (off) origins.push("https://" + host, "http://" + host);
    }
    origins.sort();
    return { generalEnabled: s.enabled && s.features.network, generalAllowedOrigins: origins };
  }

  root.GeckoFeatures = Object.freeze({
    STREAM_SITES, FEATURES, IDS, byId, normalizeHost, isStreamHost, streamExcludeMatches,
    defaultSettings, normalizeSettings, normalizeOverrides, overrideFor, resolve, migrateLegacy, legacyMirror,
  });
})(typeof self !== "undefined" ? self : globalThis);
