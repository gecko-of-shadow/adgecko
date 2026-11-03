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
    generalListStatus: "Packed lists (auto refresh after startup).",
    generalListUpdateRequestAt: null,
  };

  // Hard-excluded stream families (general lists never apply there): the one
  // list lives in src/settings/features.js (STREAM_SITES), loaded first.
  const features = () => root.GeckoFeatures || (typeof globalThis !== "undefined" && globalThis.GeckoFeatures) || null;

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
    const F = features();
    // Without the registry treat every host as excluded: no allow rule is made.
    return F ? F.isStreamHost(h) : true;
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
