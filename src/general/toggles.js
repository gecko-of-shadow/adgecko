// Pure toggle logic for general (list) ad blocking.
// Master on/off does not gate Twitch / YouTube / Kick playback.
// Default is ON (phase0). Page allow is per-origin override.
function installGeneralAdblockToggles(target) {
  const STORAGE_KEY = "general-adblock";
  const DEFAULT_ENABLED = true;

  function normalizeOrigin(origin) {
    const value = String(origin || "").trim().toLowerCase();
    if (!value) return "";
    try {
      return new URL(value).origin.toLowerCase();
    } catch {
      try {
        return new URL("https://" + value.replace(/^\/+/, "")).origin.toLowerCase();
      } catch {
        return "";
      }
    }
  }

  function emptyState() {
    return {
      enabled: DEFAULT_ENABLED,
      allowedOrigins: [],
    };
  }

  function copyState(state) {
    const source = state && typeof state === "object" ? state : emptyState();
    const allowed = Array.isArray(source.allowedOrigins)
      ? source.allowedOrigins.map(normalizeOrigin).filter(Boolean)
      : [];
    const unique = [];
    for (const origin of allowed) {
      if (unique.indexOf(origin) === -1) unique.push(origin);
    }
    return {
      enabled: source.enabled !== false,
      allowedOrigins: unique,
    };
  }

  function parseStored(raw) {
    if (raw == null || raw === "") return emptyState();
    if (typeof raw === "object") return copyState(raw);
    try {
      return copyState(JSON.parse(String(raw)));
    } catch {
      return emptyState();
    }
  }

  function serialize(state) {
    return JSON.stringify(copyState(state));
  }

  function setMasterEnabled(state, enabled) {
    const next = copyState(state);
    next.enabled = enabled === true;
    return next;
  }

  function isPageAllowed(state, origin) {
    const key = normalizeOrigin(origin);
    if (!key) return false;
    return copyState(state).allowedOrigins.indexOf(key) !== -1;
  }

  function allowPage(state, origin) {
    const next = copyState(state);
    const key = normalizeOrigin(origin);
    if (key && next.allowedOrigins.indexOf(key) === -1) {
      next.allowedOrigins.push(key);
    }
    return next;
  }

  function revokePage(state, origin) {
    const next = copyState(state);
    const key = normalizeOrigin(origin);
    next.allowedOrigins = next.allowedOrigins.filter(function (item) {
      return item !== key;
    });
    return next;
  }

  // General list+cosmetic apply only when master is on and the page is not allowed.
  // Excluded stream hosts are handled separately by exclusions / cosmetic skip.
  function generalBlockingApplies(state, origin) {
    const current = copyState(state);
    if (!current.enabled) return false;
    if (isPageAllowed(current, origin)) return false;
    return true;
  }

  target.STORAGE_KEY = STORAGE_KEY;
  target.DEFAULT_ENABLED = DEFAULT_ENABLED;
  target.emptyState = emptyState;
  target.copyState = copyState;
  target.parseStored = parseStored;
  target.serialize = serialize;
  target.normalizeOrigin = normalizeOrigin;
  target.setMasterEnabled = setMasterEnabled;
  target.isPageAllowed = isPageAllowed;
  target.allowPage = allowPage;
  target.revokePage = revokePage;
  target.generalBlockingApplies = generalBlockingApplies;
}

if (typeof globalThis !== "undefined") {
  installGeneralAdblockToggles(globalThis.GeneralAdblockToggles = {});
}
