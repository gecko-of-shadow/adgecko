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
  // The manifest can inject this file twice into one frame (cosmetic entry and
  // flags entry). A second run keeps the first registry. The shape check (not
  // a plain truthy check) matters: an element with id="GeckoFeatures" is a
  // named property of window, so a page could otherwise make this run skip.
  const prev = root.GeckoFeatures;
  if (prev && typeof prev === "object" && Object.isFrozen(prev) && typeof prev.resolve === "function" &&
    Array.isArray(prev.FEATURES) && Array.isArray(prev.STREAM_SITES)) return;
  // Hosts with their own handlers (Twitch, YouTube, Kick and their player /
  // media hosts). Ordinary-site scripts (cosmetic hide, page guards) never run
  // here, "Allow this page" never applies here, and the lists never touch the
  // pages. A host matches itself and every subdomain.
  // test/settings.test.js checks that the threat tier's protected hosts and the
  // list tier's never-block hosts name no stream host missing here (L-6).
  const STREAM_SITES = Object.freeze([
    "twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn.net", "twitchcdn.com", "ext-twitch.tv", "live-video.net",
    "youtube.com", "youtu.be", "youtube-nocookie.com", "youtubekids.com", "googlevideo.com", "ytimg.com", "ggpht.com",
    "kick.com", "kickusercontent.com", "kick-streamer.com",
  ]);

  // layer: dnr (network rules), isolated (content script), main (page world)
  // apply: live (takes effect at once) | next-load (the page's next load) |
  //        always (cannot be switched off: no `scripting` permission and
  //        vendored code is not edited; owner decision D-3)
  // perSite: may be overridden for one site
  // keepOnAllow: the site switch ("Allow this site") leaves it on, on ordinary
  //        sites; its own per-site entry (Fix this site) still counts
  // sites: where the feature acts ("ordinary" = every site except STREAM_SITES)
  const FEATURES = Object.freeze([
    { id: "network", label: "Block ads and trackers (filter lists)", layer: "dnr", default: true, apply: "live", perSite: true, sites: ["ordinary"] },
    { id: "threatTier", label: "Block known malware hosts (threat lists)", layer: "dnr", default: true, apply: "live", perSite: false, sites: ["all"] },
    { id: "threatFeed", label: "Signed threat feed (off = Pause threat feed)", layer: "dnr", default: true, apply: "live", perSite: false, sites: ["all"] },
    { id: "cosmetic", label: "Hide leftover ad boxes", layer: "isolated", default: true, apply: "live", perSite: true, sites: ["ordinary"], scripts: ["src/cosmetic.js"] },
    { id: "twitchPlayer", label: "Twitch: ad-free stream swap (vendored)", layer: "main", default: true, apply: "always", perSite: false, sites: ["twitch.tv"], scripts: ["src/vendor/video-swap-new.user.js"] },
    { id: "twitchDisplay", label: "Twitch: hide directory ad banners", layer: "isolated", default: true, apply: "live", perSite: true, sites: ["twitch.tv"], scripts: ["src/twitch-directory-ads.js"] },
    { id: "youtubeScriptlets", label: "YouTube: uBlock Origin scriptlets (vendored)", layer: "main", default: true, apply: "always", perSite: false, sites: ["youtube.com"], scripts: ["src/vendor/ubo-youtube.js", "src/vendor/ubo-youtube-isolated.js"] },
    { id: "youtubeWatchdog", label: "YouTube: reload a stuck video start", layer: "main", default: true, apply: "live", perSite: true, sites: ["youtube.com"], scripts: ["src/youtube.js"] },
    { id: "youtubeCosmetic", label: "YouTube: remove sponsored feed tiles (script part)", layer: "main", default: true, apply: "live", perSite: true, sites: ["youtube.com"], scripts: ["src/youtube.js"] },
    { id: "kick", label: "Kick: skip in-stream ads", layer: "main", default: true, apply: "live", perSite: true, sites: ["kick.com"], scripts: ["src/kick.js"] },
    { id: "guardClipboard", label: "Stop pages from copying shell commands (ClickFix)", layer: "main", default: true, apply: "live", perSite: true, keepOnAllow: true, sites: ["ordinary"], scripts: ["src/guards/clipboard.js"] },
    { id: "guardPopups", label: "Block pop-ups opened without a click", layer: "main", default: false, apply: "live", perSite: true, sites: ["ordinary"], scripts: ["src/guards/popups.js"] },
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

  // Overrides that apply to a page: its own host and every parent domain.
  // Feature switches come from the most specific host that has an entry, as a
  // whole (0.3.4 semantics: a child entry never inherits a parent's other
  // switches, so a kept Fix on a parent does not reach into a subdomain that
  // has its own entry). Only two values reach down from any parent, because
  // the DNR allow rule for a parent (initiatorDomains) covers every subdomain
  // too: an Allow (enabled:false) and network:false. `host` is the entry that
  // controls the Allow when there is one (so "Block again" edits it), else the
  // most specific entry.
  function overrideFor(overrides, host) {
    const h = normalizeHost(host);
    const labels = h.split(".");
    let first = null;
    let allowHost = null;
    let networkOff = false;
    // Never a bare top-level label ("com") as a parent, but a single-label
    // host ("localhost", an intranet name) is its own key.
    for (let i = 0; i < Math.max(1, labels.length - 1); i++) {
      const key = labels.slice(i).join(".");
      const e = overrides[key];
      if (!e) continue;
      if (!first) first = key;
      if (e.enabled === false && !allowHost) allowHost = key;
      if (e.features && e.features.network === false) networkOff = true;
    }
    if (!first) return null;
    const entry = {};
    if (allowHost) entry.enabled = false;
    const features = Object.assign({}, overrides[first].features);
    if (networkOff) features.network = false;
    if (Object.keys(features).length) entry.features = features;
    return { host: allowHost || first, entry };
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
        if (o.entry.enabled === false && !(f.keepOnAllow && !isStreamHost(host))) on = false;
        else if (o.entry.features && typeof o.entry.features[f.id] === "boolean") on = s.enabled && o.entry.features[f.id];
      }
      out[f.id] = !!on;
    }
    return out;
  }

  // One-time migration from the old keys (idempotent: a stored `settings`
  // wins). generalEnabled -> features.network; each generalAllowedOrigins host
  // -> a site override with the site switched off (what "Allow this page" did).
  // Migration, added in 0.3.0: delete the old-key part when upgrades from
  // 0.2.21 or older are no longer supported. With no `settings` key it also
  // gives the default settings of a fresh install; that part stays.
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

  // The popup's "Test with the ad lists off" is an Allow with a question: a
  // popupFix entry with lists:true and enabled:false on the host's own
  // siteOverrides entry. Owner decision (2026-11-22): a test that nobody
  // answers ends after LIST_TEST_TTL_MS, so the site does not stay allowed by
  // accident. Pure: returns null when nothing expired, else { fix, overrides }
  // (fix null = remove the popupFix key). Only the Allow that the test wrote
  // is taken off: other fields of the entry (per-site switches) stay.
  const LIST_TEST_TTL_MS = 24 * 60 * 60 * 1000;
  function expireListTests(fix, overrides, now, ttlMs) {
    if (!fix || typeof fix !== "object") return null;
    const ttl = typeof ttlMs === "number" ? ttlMs : LIST_TEST_TTL_MS;
    const entries = [];
    if (typeof fix.host === "string" && fix.host) entries.push([fix.host, fix]);
    if (fix.others && typeof fix.others === "object") {
      for (const [h, e] of Object.entries(fix.others)) if (h && e && typeof e === "object") entries.push([h, e]);
    }
    const gone = new Set(entries.filter(([, e]) => e.lists === true && typeof e.at === "number" && now - e.at > ttl).map(([h]) => h));
    if (!gone.size) return null;
    const o = JSON.parse(JSON.stringify(overrides && typeof overrides === "object" ? overrides : {}));
    for (const h of gone) {
      if (!o[h] || o[h].enabled !== false) continue;
      const entry = Object.assign({}, o[h]);
      delete entry.enabled;
      if (Object.keys(entry).length) o[h] = entry;
      else delete o[h];
    }
    const keep = entries.filter(([h]) => !gone.has(h)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    if (!keep.length) return { fix: null, overrides: o };
    const copy = (e) => {
      const c = { at: e.at, prev: e.prev && typeof e.prev === "object" ? e.prev : {} };
      if (e.lists === true) c.lists = true;
      return c;
    };
    const [[topHost, topEntry], ...rest] = keep;
    const out = Object.assign({ host: topHost }, copy(topEntry));
    if (rest.length) {
      out.others = {};
      for (const [h, e] of rest) out.others[h] = copy(e);
    }
    return { fix: out, overrides: o };
  }

  // YouTube start times (opt-in diagnostics, off by default). One key in
  // chrome.storage.local: ytStartTimes { v: 1, on: bool, log: [entry] }.
  // src/youtube.js measures each watch-page start and sends only
  // { kind, waitMs, ad, toast, timeout } over the private port;
  // src/settings/flags.js adds the minute and the extension version and
  // appends; the settings page shows, exports and clears the log. An entry
  // holds no video id, address, title, channel or account data.
  // test/youtube-start-times.test.js keeps these rules.
  const ST_KEY = "ytStartTimes";
  const ST_MAX = 300;
  const ST_GIVE_UP_MS = 60000;
  const ST_KINDS = ["first-load", "in-page"];

  function stMinute(ms) {
    const t = Math.floor(Number(ms) / 60000) * 60000;
    if (!Number.isFinite(t) || t < 0) return "";
    return new Date(t).toISOString().slice(0, 16) + "Z";
  }

  // Strict: anything else from the page is dropped, never coerced into text.
  function stEntry(raw, nowMs, version) {
    if (!raw || typeof raw !== "object") return null;
    if (!ST_KINDS.includes(raw.kind)) return null;
    for (const k of ["ad", "toast", "timeout"]) if (typeof raw[k] !== "boolean") return null;
    const w = Number(raw.waitMs);
    if (typeof raw.waitMs !== "number" || !Number.isFinite(w) || w < 0) return null;
    const time = stMinute(nowMs);
    if (!time) return null;
    const ver = typeof version === "string" && /^\d{1,5}(\.\d{1,5}){0,3}$/.test(version) ? version : "";
    return { time, version: ver, kind: raw.kind, waitMs: Math.min(ST_GIVE_UP_MS, Math.round(w)), ad: raw.ad, toast: raw.toast, timeout: raw.timeout };
  }

  // A stored entry is checked again on read: same fields, nothing more.
  function stValid(e) {
    return !!e && typeof e === "object" && typeof e.time === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/.test(e.time) &&
      typeof e.version === "string" && e.version.length <= 23 && ST_KINDS.includes(e.kind) &&
      typeof e.waitMs === "number" && Number.isFinite(e.waitMs) && e.waitMs >= 0 && e.waitMs <= ST_GIVE_UP_MS &&
      typeof e.ad === "boolean" && typeof e.toast === "boolean" && typeof e.timeout === "boolean";
  }

  function stNormalize(stored) {
    const s = stored && typeof stored === "object" ? stored : {};
    const log = (Array.isArray(s.log) ? s.log : []).filter(stValid)
      .map((e) => ({ time: e.time, version: e.version, kind: e.kind, waitMs: e.waitMs, ad: e.ad, toast: e.toast, timeout: e.timeout }));
    return { v: 1, on: s.on === true, log: log.slice(-ST_MAX) };
  }

  // Adds one entry and keeps the newest ST_MAX (the oldest go first).
  function stAppend(stored, entry) {
    const s = stNormalize(stored);
    if (stValid(entry)) s.log.push(entry);
    s.log = s.log.slice(-ST_MAX);
    return s;
  }

  // Nearest-rank percentile over the starts that played (timeouts excluded):
  // the value at rank ceil(p * n) of the sorted waits.
  function stPercentile(sorted, p) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length))) - 1];
  }

  function stStats(logIn) {
    const log = stNormalize({ log: logIn }).log;
    const waits = log.filter((e) => !e.timeout).map((e) => e.waitMs).sort((a, b) => a - b);
    return {
      count: log.length,
      played: waits.length,
      timeouts: log.length - waits.length,
      ads: log.filter((e) => e.ad).length,
      toasts: log.filter((e) => e.toast).length,
      median: stPercentile(waits, 0.5),
      p90: stPercentile(waits, 0.9),
    };
  }

  const stSec = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(1) + " s");

  function stSummary(logIn) {
    const s = stStats(logIn);
    if (!s.count) return "No video starts recorded.";
    return s.count + " video starts recorded (" + s.timeouts + " gave up after 60 s). Median wait " + stSec(s.median) +
      ", 90th percentile " + stSec(s.p90) + ". " + s.ads + " with an ad first, " + s.toasts + " with the \"Experiencing interruptions?\" popup.";
  }

  // Plain text table for the clipboard (fixed-width columns, UTC minutes).
  function stText(logIn) {
    const log = stNormalize({ log: logIn }).log;
    const head = ["time (UTC)", "version", "kind", "wait_s", "ad", "toast", "timeout"];
    const rows = log.map((e) => [e.time, e.version || "-", e.kind, e.timeout ? ">60.0" : (e.waitMs / 1000).toFixed(1),
      e.ad ? "yes" : "no", e.toast ? "yes" : "no", e.timeout ? "yes" : "no"]);
    const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
    const line = (r) => r.map((c, i) => c.padEnd(width[i])).join("  ").trimEnd();
    return ["Adgecko YouTube start times", stSummary(log), "", line(head), ...rows.map(line)].join("\n") + "\n";
  }

  // The hosts where src/youtube.js runs (manifest CS-4): www, m and the bare domain.
  const stIsHost = (host) => /^(www\.|m\.)?youtube\.com$/.test(normalizeHost(host));

  const startTimes = Object.freeze({
    KEY: ST_KEY, MAX: ST_MAX, GIVE_UP_MS: ST_GIVE_UP_MS, KINDS: ST_KINDS,
    isHost: stIsHost, minute: stMinute, entry: stEntry, normalize: stNormalize, append: stAppend, stats: stStats, summary: stSummary, text: stText,
  });

  root.GeckoFeatures = Object.freeze({
    STREAM_SITES, FEATURES, IDS, byId, normalizeHost, isStreamHost, streamExcludeMatches,
    defaultSettings, normalizeSettings, normalizeOverrides, overrideFor, resolve, migrateLegacy, legacyMirror,
    LIST_TEST_TTL_MS, expireListTests, startTimes,
  });
})(typeof self !== "undefined" ? self : globalThis);
