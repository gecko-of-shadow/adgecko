// Cosmetic (hide leftover boxes) gate. Never inject on hard-excluded hosts.
// Depends on exclusions + toggles install APIs (injected or pre-installed).
function installGeneralAdblockCosmetic(target, exclusions, toggles) {
  const excl = exclusions || (typeof globalThis !== "undefined" && globalThis.GeneralAdblockExclusions) || {};
  const toggleApi = toggles || (typeof globalThis !== "undefined" && globalThis.GeneralAdblockToggles) || {};

  function hostOf(pageUrlOrHost) {
    if (typeof excl.hostFromUrl === "function" && /[\/:]/.test(String(pageUrlOrHost || ""))) {
      return excl.hostFromUrl(pageUrlOrHost);
    }
    if (typeof excl.normalizeHost === "function") {
      return excl.normalizeHost(pageUrlOrHost);
    }
    return String(pageUrlOrHost || "").toLowerCase();
  }

  function originOf(pageUrlOrOrigin) {
    if (typeof toggleApi.normalizeOrigin === "function") {
      return toggleApi.normalizeOrigin(pageUrlOrOrigin);
    }
    try {
      return new URL(String(pageUrlOrOrigin || "")).origin.toLowerCase();
    } catch {
      return "";
    }
  }

  // True only when general cosmetic may touch the page.
  function shouldApplyCosmetic(pageUrlOrHost, state) {
    const host = hostOf(pageUrlOrHost);
    if (typeof excl.isExcludedHost === "function" && excl.isExcludedHost(host)) {
      return false;
    }
    if (typeof excl.isExcludedSiteHost === "function" && excl.isExcludedSiteHost(host)) {
      return false;
    }
    const origin = originOf(
      /:\/\//.test(String(pageUrlOrHost || "")) ? pageUrlOrHost : "https://" + host + "/",
    );
    if (typeof toggleApi.generalBlockingApplies === "function") {
      return toggleApi.generalBlockingApplies(state, origin) === true;
    }
    return false;
  }

  function skipReason(pageUrlOrHost, state) {
    const host = hostOf(pageUrlOrHost);
    if (typeof excl.isExcludedHost === "function" && excl.isExcludedHost(host)) {
      return "excluded-host";
    }
    if (typeof toggleApi.generalBlockingApplies === "function") {
      const origin = originOf(
        /:\/\//.test(String(pageUrlOrHost || "")) ? pageUrlOrHost : "https://" + host + "/",
      );
      if (!toggleApi.generalBlockingApplies(state, origin)) {
        const current = typeof toggleApi.copyState === "function"
          ? toggleApi.copyState(state)
          : state;
        if (current && current.enabled === false) return "master-off";
        if (typeof toggleApi.isPageAllowed === "function" && toggleApi.isPageAllowed(state, origin)) {
          return "page-allowed";
        }
        return "inactive";
      }
    }
    return "";
  }

  target.shouldApplyCosmetic = shouldApplyCosmetic;
  target.skipReason = skipReason;
}

if (typeof globalThis !== "undefined") {
  installGeneralAdblockCosmetic(globalThis.GeneralAdblockCosmetic = {});
}
