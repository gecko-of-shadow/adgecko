/**
 * Shared storage keys + helpers for general (list) adblock UI.
 * Consumed by popup.js and general-background.js.
 * DNR / list / cosmetic agents should use the same keys.
 */
(function (root) {
  const STORAGE_KEYS = {
    enabled: "generalEnabled",
    allowedOrigins: "generalAllowedOrigins",
    listUpdatedAt: "generalListUpdatedAt",
    listStatus: "generalListStatus",
    listUpdateRequestAt: "generalListUpdateRequestAt",
  };

  const DEFAULTS = {
    generalEnabled: true,
    generalAllowedOrigins: [],
    generalListUpdatedAt: null,
    generalListStatus: "Packed lists (manual Update only).",
    generalListUpdateRequestAt: null,
  };

  /** Hard-excluded stream families — general lists never apply here. */
  const HARD_EXCLUDE_HOST_RE = /(?:^|\.)((?:twitch\.tv)|(youtube\.com)|(youtu\.be)|(youtube-nocookie\.com)|(youtubekids\.com)|(googlevideo\.com)|(kick\.com)|(kickusercontent\.com))$/i;

  const RULESET_ID = "general";
  const ALLOW_RULE_ID_BASE = 900000;

  function normalizeOrigin(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.origin;
    } catch {
      return null;
    }
  }

  function hostOfOrigin(origin) {
    try {
      return new URL(origin).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function isHardExcludedHost(hostname) {
    const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
    if (!h) return false;
    return HARD_EXCLUDE_HOST_RE.test(h);
  }

  function isHardExcludedOrigin(origin) {
    return isHardExcludedHost(hostOfOrigin(origin));
  }

  function withDefaults(stored) {
    return Object.assign({}, DEFAULTS, stored || {});
  }

  root.GeneralSettings = {
    STORAGE_KEYS,
    DEFAULTS,
    RULESET_ID,
    ALLOW_RULE_ID_BASE,
    normalizeOrigin,
    hostOfOrigin,
    isHardExcludedHost,
    isHardExcludedOrigin,
    withDefaults,
  };
})(typeof self !== "undefined" ? self : globalThis);
