// The ONE list of hosts a threat rule may never match (Twitch, YouTube and
// Kick own servers, player/CDN hosts, and the Google hosts their players
// load). Used by the threat compiler (src/threat/compile.js), the signed-feed
// validator (src/feed/) and the tests. Classic script: the service worker
// loads it with importScripts; tests import it for its global.
//
// DNR `requestDomains` also matches every subdomain, so a threat host is
// rejected when it is:
//   - equal to or under a SUFFIX entry (the entry and all its subdomains), or
//   - equal to or an ANCESTOR of any entry (e.g. "google.com" would match
//     www.google.com; "googleapis.com" would match youtubei.googleapis.com).
// EXACT entries (bare googleapis.com, gstatic.com, storage.googleapis.com)
// protect only themselves and their ancestors: deeper hosts such as
// "<bucket>.storage.googleapis.com" may be threat-blocked unless they fall
// under a SUFFIX entry (e.g. fonts.googleapis.com).
// Single-label hosts ("com", "tv") and hosts that are not plain DNS names are
// always rejected (a stray public suffix would take out a whole TLD).
(function (root) {
  const SUFFIX = Object.freeze([
    // Twitch
    "twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn.net", "twitchcdn.com", "live-video.net", "ext-twitch.tv",
    // Kick
    "kick.com", "kick-streamer.com",
    // YouTube
    "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com", "ytimg.com", "ggpht.com",
    // Google hosts the players and pages load
    "youtubei.googleapis.com", "play.googleapis.com", "fonts.googleapis.com", "fonts.gstatic.com",
    "www.gstatic.com", "ssl.gstatic.com", "www.google.com", "accounts.google.com",
    // Fail-open additions (2026-11-02 build): in the manifest's stream-site
    // exclude_matches but not in the build prompt's list.
    "youtubekids.com", "kickusercontent.com",
  ]);
  const EXACT = Object.freeze(["googleapis.com", "gstatic.com", "storage.googleapis.com"]);
  const ALL = Object.freeze(SUFFIX.concat(EXACT));

  const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  // Two-label hosts that look like a public suffix ("co.uk", "com.au"): a
  // block on one would take out a whole country's sites. Heuristic, not the
  // full Public Suffix List (not bundled; UNVERIFIED coverage).
  const SUFFIX_LIKE_FIRST_LABEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "ne", "or", "go", "gob", "mil", "nic", "ltd", "plc", "sch", "nom"]);

  function normalizeHost(host) {
    let h = String(host == null ? "" : host).trim().toLowerCase();
    if (h.endsWith(".")) h = h.slice(0, -1);
    return h;
  }

  const under = (h, d) => h === d || h.endsWith("." + d);

  // null when the host may be used in a threat rule, else a reason string.
  function protectedReason(host) {
    const h = normalizeHost(host);
    if (!h) return "empty";
    if (!HOST_RE.test(h)) return "not a plain host name";
    if (!h.includes(".")) return "single label";
    const labels = h.split(".");
    if (labels.length === 2 && SUFFIX_LIKE_FIRST_LABEL.has(labels[0])) return "looks like a public suffix";
    for (const p of SUFFIX) if (under(h, p)) return "protected: " + p;
    for (const p of ALL) if (under(p, h)) return "ancestor of protected " + p;
    return null;
  }

  function isProtectedHost(host) {
    return protectedReason(host) !== null;
  }

  root.GeckoProtectedHosts = Object.freeze({ SUFFIX, EXACT, ALL, normalizeHost, protectedReason, isProtectedHost });
})(typeof self !== "undefined" ? self : globalThis);
