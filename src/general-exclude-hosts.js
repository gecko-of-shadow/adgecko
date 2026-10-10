// Hard-exclude hosts for the general list-based ad blocker (Chrome DNR).
// Twitch / YouTube / Kick playback files are never edited by this feature.
// Domains only ΓÇö no scheme-prefixed URLs here (keeps release-gate outbound checks clean).
//
// Lean coexistence: a few high-priority allow / allowAllRequests rules beat
// thousands of EasyList blocks *inside this extension*. Another extension's
// block can still win across extensions; see docs conflict research.

function installGeneralExcludeHosts(target) {
  // Page / frame hosts. Apex entries cover subdomains in DNR (www, m, music, ΓÇª).
  const SITE_DOMAINS = Object.freeze([
    "twitch.tv",
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "youtubekids.com",
    "kick.com",
  ]);

  // Video / player CDNs used by those sites (from release-gate + v0.2.4 Kick/IVS).
  // Do not list broad shared clouds (e.g. googleapis.com) ΓÇö that would weaken
  // general blocking on ordinary sites. Frame allowAllRequests covers in-page
  // API hosts when the top-level site is excluded.
  const VIDEO_CDN_DOMAINS = Object.freeze([
    "ttvnw.net",
    "jtvnw.net",
    "twitchcdn.net",
    "googlevideo.com",
    "ytimg.com",
    "ggpht.com",
    "live-video.net",
  ]);

  const ALL_EXCLUDED = Object.freeze(
    Array.from(new Set(SITE_DOMAINS.concat(VIDEO_CDN_DOMAINS))),
  );

  function normalizeHost(host) {
    let value = String(host || "").trim().toLowerCase();
    if (value.endsWith(".")) value = value.slice(0, -1);
    if (value.startsWith("www.")) value = value.slice(4);
    return value;
  }

  function hostMatchesDomain(host, domain) {
    const h = normalizeHost(host);
    const d = normalizeHost(domain);
    if (!h || !d) return false;
    return h === d || h.endsWith("." + d);
  }

  function isExcludedHost(host) {
    const h = normalizeHost(host);
    if (!h) return false;
    return ALL_EXCLUDED.some((domain) => hostMatchesDomain(h, domain));
  }

  function isExcludedSiteHost(host) {
    const h = normalizeHost(host);
    if (!h) return false;
    return SITE_DOMAINS.some((domain) => hostMatchesDomain(h, domain));
  }

  // Few DNR rules, high priority ΓÇö stays lean vs the ~30k static floor.
  // Within this extension, allow / allowAllRequests outrank same-extension blocks.
  function buildDnrExclusionRules(options) {
    const opts = options || {};
    const idStart = opts.idStart == null ? 1 : opts.idStart;
    const priority = opts.priority == null ? 2_000_000 : opts.priority;
    return [
      {
        id: idStart,
        priority,
        action: { type: "allowAllRequests" },
        condition: {
          requestDomains: SITE_DOMAINS.slice(),
          resourceTypes: ["main_frame", "sub_frame"],
        },
      },
      {
        id: idStart + 1,
        priority,
        action: { type: "allow" },
        condition: {
          requestDomains: VIDEO_CDN_DOMAINS.slice(),
        },
      },
    ];
  }

  target.SITE_DOMAINS = SITE_DOMAINS;
  target.VIDEO_CDN_DOMAINS = VIDEO_CDN_DOMAINS;
  target.ALL_EXCLUDED = ALL_EXCLUDED;
  target.normalizeHost = normalizeHost;
  target.isExcludedHost = isExcludedHost;
  target.isExcludedSiteHost = isExcludedSiteHost;
  target.buildDnrExclusionRules = buildDnrExclusionRules;
  target.EASYLIST_CREDIT =
    "Filter lists adapted from EasyList (The EasyList authors).";
}

if (typeof globalThis !== "undefined") {
  globalThis.installGeneralExcludeHosts = installGeneralExcludeHosts;
}
