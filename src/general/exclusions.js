// Hard-exclude hosts for general (list) ad blocking. Shared by DNR allow rules
// and cosmetic injection. Playback scripts (Twitch / YouTube / Kick) stay alone.
function installGeneralAdblockExclusions(target) {
  // Site tabs where general network + cosmetic rules must never run.
  const SITE_SUFFIXES = [
    "twitch.tv",
    "youtube.com",
    "youtu.be",
    "youtubekids.com",
    "kick.com",
  ];

  // Request hosts used by those players (embeds on other pages still play).
  // Twitch/YouTube family from release-gate allowlist; Kick IVS from the Kick
  // beta (amazon-ivs worker → live-video.net).
  const VIDEO_SUFFIXES = [
    "ttvnw.net",
    "jtvnw.net",
    "twitchcdn.net",
    "twitchcdn.com",
    "googlevideo.com",
    "ytimg.com",
    "ggpht.com",
    "googleapis.com",
    "live-video.net",
  ];

  // Exact labels that appear in initiatorDomains / requestDomains (no leading *.).
  const SITE_DOMAINS = [
    "twitch.tv",
    "www.twitch.tv",
    "m.twitch.tv",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "studio.youtube.com",
    "youtubekids.com",
    "www.youtubekids.com",
    "youtu.be",
    "www.youtu.be",
    "kick.com",
    "www.kick.com",
    "player.kick.com",
  ];

  const VIDEO_DOMAINS = [
    "usher.ttvnw.net",
    "gql.twitch.tv",
    "ttvnw.net",
    "jtvnw.net",
    "googlevideo.com",
    "ytimg.com",
    "i.ytimg.com",
    "ggpht.com",
    "yt3.ggpht.com",
    "googleapis.com",
    "youtubei.googleapis.com",
    "live-video.net",
  ];

  function normalizeHost(host) {
    const value = String(host || "").toLowerCase().trim();
    if (!value) return "";
    return value.replace(/:\d+$/, "").replace(/\.$/, "");
  }

  function hostMatchesSuffix(host, suffix) {
    return host === suffix || host.endsWith("." + suffix);
  }

  function matchesAnySuffix(host, suffixes) {
    const value = normalizeHost(host);
    if (!value) return false;
    for (const suffix of suffixes) {
      if (hostMatchesSuffix(value, suffix)) return true;
    }
    return false;
  }

  function isExcludedSiteHost(host) {
    return matchesAnySuffix(host, SITE_SUFFIXES);
  }

  function isExcludedVideoHost(host) {
    return matchesAnySuffix(host, VIDEO_SUFFIXES);
  }

  function isExcludedHost(host) {
    return isExcludedSiteHost(host) || isExcludedVideoHost(host);
  }

  function hostFromUrl(url) {
    try {
      return normalizeHost(new URL(String(url || ""), "https://example.invalid").hostname);
    } catch {
      return "";
    }
  }

  function isExcludedUrl(url) {
    return isExcludedHost(hostFromUrl(url));
  }

  // initiatorDomains for a high-priority DNR allow rule (site tabs).
  function dnrExcludedInitiatorDomains() {
    return SITE_DOMAINS.slice();
  }

  // requestDomains for allowing player media even from non-excluded pages.
  function dnrExcludedRequestDomains() {
    return VIDEO_DOMAINS.concat(SITE_DOMAINS).filter(function (domain, index, all) {
      return all.indexOf(domain) === index;
    });
  }

  target.SITE_SUFFIXES = SITE_SUFFIXES.slice();
  target.VIDEO_SUFFIXES = VIDEO_SUFFIXES.slice();
  target.SITE_DOMAINS = SITE_DOMAINS.slice();
  target.VIDEO_DOMAINS = VIDEO_DOMAINS.slice();
  target.normalizeHost = normalizeHost;
  target.isExcludedSiteHost = isExcludedSiteHost;
  target.isExcludedVideoHost = isExcludedVideoHost;
  target.isExcludedHost = isExcludedHost;
  target.hostFromUrl = hostFromUrl;
  target.isExcludedUrl = isExcludedUrl;
  target.dnrExcludedInitiatorDomains = dnrExcludedInitiatorDomains;
  target.dnrExcludedRequestDomains = dnrExcludedRequestDomains;
}

if (typeof globalThis !== "undefined") {
  installGeneralAdblockExclusions(globalThis.GeneralAdblockExclusions = {});
}
