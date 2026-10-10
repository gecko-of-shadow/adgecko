// List update policy: manual only. No background / alarm / idle fetch.
function installGeneralAdblockUpdate(target) {
  const POLICY = "manual-only";

  // Hosts that must never be contacted automatically for filter lists.
  const FORBIDDEN_AUTO_FETCH_HOST_BITS = [
    "easylist.to",
    "easylist-downloads.adblockplus.org",
    "filters.adtidy.org",
    "gitlab.com/easylist",
    "raw.githubusercontent.com/easylist",
    "pgl.yoyo.org",
    "malware-filter",
    "urlhaus",
  ];

  function isManualOnly() {
    return POLICY === "manual-only";
  }

  // A fetch is allowed only when the user explicitly started an Update action.
  function mayFetchLists(context) {
    const source = context && typeof context === "object" ? context : {};
    if (source.userInitiated !== true) return false;
    if (source.background === true) return false;
    if (source.alarm === true) return false;
    if (source.idle === true) return false;
    if (source.startup === true) return false;
    return true;
  }

  function isForbiddenAutoFetchUrl(url) {
    const value = String(url || "").toLowerCase();
    for (const bit of FORBIDDEN_AUTO_FETCH_HOST_BITS) {
      if (value.includes(bit)) return true;
    }
    return false;
  }

  target.POLICY = POLICY;
  target.FORBIDDEN_AUTO_FETCH_HOST_BITS = FORBIDDEN_AUTO_FETCH_HOST_BITS.slice();
  target.isManualOnly = isManualOnly;
  target.mayFetchLists = mayFetchLists;
  target.isForbiddenAutoFetchUrl = isForbiddenAutoFetchUrl;
}

if (typeof globalThis !== "undefined") {
  installGeneralAdblockUpdate(globalThis.GeneralAdblockUpdate = {});
}
