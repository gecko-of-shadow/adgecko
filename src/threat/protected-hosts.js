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
// Also rejected (security review M-3): public suffixes, shared-hosting and big
// platform parents (github.io, pages.dev, amazonaws.com, blogspot.com, ...)
// and their parents, from src/threat/psl.js (must be loaded first: without it
// every host is rejected, so a load-order mistake blocks nothing); and IPv4
// literals in private, loopback, link-local, shared (CGNAT) or multicast
// ranges (a block there could cut off the visitor's own router or network).
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
  // Captcha widget hosts the ordinary lists never block (NEVER_BLOCK_CAPTCHA
  // in the packer and in src/general/update.js). A threat rule must not block
  // them either. Kept off SUFFIX so they are not treated as stream sites.
  const CAPTCHA = Object.freeze([
    "hcaptcha.com",
  ]);

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

  // Non-public IPv4 literal -> reason, else null.
  function localAddressReason(h) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return null;
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return "non-public address";
    if ((a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "non-public address";
    return null;
  }

  // null when the host may be used in a threat rule, else a reason string.
  function protectedReason(host) {
    const h = normalizeHost(host);
    if (!h) return "empty";
    if (!HOST_RE.test(h)) return "not a plain host name";
    if (!h.includes(".")) return "single label";
    const labels = h.split(".");
    if (labels.length === 2 && SUFFIX_LIKE_FIRST_LABEL.has(labels[0])) return "looks like a public suffix";
    for (const p of SUFFIX) if (under(h, p)) return "protected: " + p;
    for (const p of CAPTCHA) if (under(h, p)) return "protected: " + p;
    for (const p of ALL) if (under(p, h)) return "ancestor of protected " + p;
    const local = localAddressReason(h);
    if (local) return local;
    const ps = root.GeckoPublicSuffix;
    if (!ps) return "public-suffix data not loaded";
    return ps.suffixReason(h);
  }

  function isProtectedHost(host) {
    return protectedReason(host) !== null;
  }

  root.GeckoProtectedHosts = Object.freeze({ SUFFIX, EXACT, ALL, CAPTCHA, normalizeHost, protectedReason, isProtectedHost, localAddressReason });
})(typeof self !== "undefined" ? self : globalThis);
