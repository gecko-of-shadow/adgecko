// Cosmetic element-hide for leftover ad boxes on ordinary sites.
// Never runs on Twitch / YouTube family / Kick (manifest exclude_matches + host check).
// Master switch: chrome.storage.local.generalEnabled (default ON; shared with popup/DNR).
function installCosmeticHide(api) {
  const STYLE_ID = "gk-c1"; // neutral id (no product name in the page)
  // Same key as popup src/general-settings.js — do not rename without coordinating.
  const STORAGE_KEY = "generalEnabled";
  const ALLOWED_ORIGINS_KEY = "generalAllowedOrigins";
  const CSS_PATH = "src/cosmetic-hide.css";
  const SETTINGS_KEY = "settings";
  const OVERRIDES_KEY = "siteOverrides";

  // Stream hosts are hard-excluded from the cosmetic hide (second guard after
  // the manifest exclude_matches). The one list: src/settings/features.js,
  // listed before this file in the manifest.
  const features = () => (typeof globalThis !== "undefined" && globalThis.GeckoFeatures) || null;
  const EXCLUDED_HOST_SUFFIXES = (features() && features().STREAM_SITES) || [];

  function hostExcluded(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    if (!host) return true;
    if (host.includes("twitchcdn")) return true;
    const F = features();
    // Fail open (hide nothing) if the registry did not load.
    return F ? F.isStreamHost(host) : true;
  }

  // Phase 0 decision 6: default ON for every site except the stream excludes.
  function isEnabled(value) {
    return value !== false;
  }

  function pageOrigin(hostname, href) {
    try {
      if (href) return new URL(href).origin;
    } catch {
      // fall through
    }
    const host = String(hostname || "").toLowerCase();
    if (!host) return "";
    return "https://" + host;
  }

  function originAllowed(origin, allowedList) {
    if (!origin || !Array.isArray(allowedList) || allowedList.length === 0) return false;
    return allowedList.indexOf(origin) !== -1;
  }

  let cssText = null;
  let styleEl = null;
  // The hide CSS lives in a constructed sheet in document.adoptedStyleSheets.
  // A <style> node under <html> (added at document_start, before <head>
  // exists) breaks React 18 whole-document hydration (hydrateRoot(document)):
  // React re-renders the whole document and the node is lost. An adopted
  // sheet is not a DOM node. It has no id, so the page sees no product name.
  // The <style> node stays as the fallback when the sheet API fails.
  let sheet = null;
  let sheetOn = false; // our sheet should be adopted now
  let sheetFailed = false;
  let watchers = false;
  let styleObserver = null;

  function adoptedHas(s) {
    return Array.prototype.includes.call(document.adoptedStyleSheets || [], s);
  }

  function adoptSheet() {
    if (!sheet || !sheetOn || adoptedHas(sheet)) return;
    document.adoptedStyleSheets = Array.from(document.adoptedStyleSheets || []).concat(sheet);
  }

  // A page script may replace document.adoptedStyleSheets. Check again when
  // the document is parsed and when the page has loaded.
  function watchAdopted() {
    if (watchers) return;
    watchers = true;
    const again = () => {
      try {
        adoptSheet();
      } catch {
        // The page made the list read-only: nothing more to do.
      }
    };
    try {
      document.addEventListener("DOMContentLoaded", again, { once: true });
      if (typeof window !== "undefined" && window && window.addEventListener) window.addEventListener("load", again, { once: true });
    } catch {
      // No events in unit tests without a DOM.
    }
  }

  function removeStyle() {
    sheetOn = false;
    if (sheet) {
      try {
        if (adoptedHas(sheet)) document.adoptedStyleSheets = Array.from(document.adoptedStyleSheets).filter((s) => s !== sheet);
      } catch {
        // document may be unavailable in unit tests.
      }
    }
    if (styleObserver) {
      try {
        styleObserver.disconnect();
      } catch {
        // ignore
      }
      styleObserver = null;
    }
    if (styleEl) {
      try {
        styleEl.remove();
      } catch {
        // Page may have already torn the node down.
      }
      styleEl = null;
    }
    try {
      const existing = document.getElementById(STYLE_ID);
      if (existing) existing.remove();
    } catch {
      // document may be unavailable in unit tests.
    }
  }

  function injectSheet(text) {
    if (sheetFailed || typeof CSSStyleSheet === "undefined" || !document.adoptedStyleSheets) return false;
    try {
      if (!sheet) sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      sheetOn = true;
      adoptSheet();
      watchAdopted();
      return true;
    } catch {
      sheetFailed = true;
      sheetOn = false;
      sheet = null;
      return false;
    }
  }

  function appendStyleEl() {
    const root = document.documentElement || document.head || document;
    root.appendChild(styleEl);
  }

  // Fallback only: put the <style> node back when the page (or a hydration
  // re-render) removes it.
  function watchStyleEl() {
    if (styleObserver || typeof MutationObserver === "undefined") return;
    try {
      styleObserver = new MutationObserver(() => {
        if (styleEl && !styleEl.isConnected) appendStyleEl();
      });
      styleObserver.observe(document, { childList: true });
      if (document.documentElement) styleObserver.observe(document.documentElement, { childList: true });
    } catch {
      styleObserver = null;
    }
  }

  function injectStyle(text) {
    if (typeof document === "undefined") return;
    if (injectSheet(text)) return;
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      appendStyleEl();
    }
    styleEl.textContent = text;
    watchStyleEl();
  }

  // The bundled fallback sheet comes from the service worker by message: it is
  // no longer a web-accessible resource that any page could probe for (Block I).
  // (A fetcher argument keeps the old path for unit tests.)
  function askWorkerForCss() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ source: "adgecko-general", type: "cosmeticCss" }, (r) => {
          const err = chrome.runtime.lastError;
          if (err || !r || typeof r.css !== "string") reject(new Error("cosmetic css unavailable"));
          else resolve(r.css);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function loadCss(fetcher) {
    if (cssText != null) return Promise.resolve(cssText);
    if (!fetcher && !api.runtimeGetURL && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      return askWorkerForCss().then((text) => {
        cssText = text;
        return cssText;
      });
    }
    const getURL = (api.runtimeGetURL || (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL));
    const doFetch = fetcher || fetch;
    if (typeof getURL !== "function") {
      return Promise.reject(new Error("runtime.getURL unavailable"));
    }
    return doFetch(getURL(CSS_PATH)).then((res) => {
      if (!res || !res.ok) throw new Error("cosmetic css fetch failed");
      return res.text();
    }).then((text) => {
      cssText = text;
      return cssText;
    });
  }

  // Each applyState call bumps this. A slow fallback-sheet load injects only
  // if no newer call ran meanwhile (master off, allowed site, per-host CSS).
  let applyGen = 0;

  function applyState(state, fetcher) {
    const gen = ++applyGen;
    const hostname = api.hostname != null
      ? api.hostname
      : (typeof location !== "undefined" ? location.hostname : "");
    const href = api.href != null
      ? api.href
      : (typeof location !== "undefined" ? location.href : "");
    if (hostExcluded(hostname)) {
      removeStyle();
      return Promise.resolve(false);
    }
    const stored = state && typeof state === "object" ? state.stored : null;
    // Feature switches (src/settings/features.js): the "cosmetic" feature, the
    // extension master and this site's override. Live: storage.onChanged re-runs.
    // When settings exist, they alone decide. generalEnabled and
    // generalAllowedOrigins mirror the "network" feature (legacyMirror), so
    // they must not switch off "Hide leftover ad boxes". They decide only
    // before the migration, when no settings key exists yet.
    const F = features();
    const settings = stored && stored[SETTINGS_KEY];
    if (F && settings && typeof settings === "object") {
      if (!F.resolve(settings, stored[OVERRIDES_KEY], hostname).cosmetic) {
        removeStyle();
        return Promise.resolve(false);
      }
    } else {
      const enabled = state && typeof state === "object" ? state.enabled : state;
      const allowed = state && typeof state === "object" ? state.allowedOrigins : undefined;
      if (!isEnabled(enabled)) {
        removeStyle();
        return Promise.resolve(false);
      }
      if (originAllowed(pageOrigin(hostname, href), allowed)) {
        removeStyle();
        return Promise.resolve(false);
      }
    }
    // Refreshed / installed rules in storage: generic sheet (top frame only)
    // plus this host's site rules, minus its #@# exceptions. One <style>.
    const P = api.parse || (typeof globalThis !== "undefined" && globalThis.GeneralCosmeticParse);
    if (P && stored && stored[P.KEY_META]) {
      try {
        const top = api.isTop != null ? api.isTop : (typeof window !== "undefined" && window.top === window);
        const view = top ? stored : Object.assign({}, stored, { [P.KEY_GENERIC]: "" });
        injectStyle(P.buildPageCss(hostname, view));
        return Promise.resolve(true);
      } catch {
        // fall back to the bundled sheet below
      }
    }
    return loadCss(fetcher).then((text) => {
      if (gen !== applyGen) return false;
      injectStyle(text);
      return true;
    }).catch(() => {
      // Fail open for playback safety: do not throw into the page.
      if (gen === applyGen) removeStyle();
      return false;
    });
  }

  // Back-compat name used by early tests / callers.
  function applyEnabled(enabled, fetcher) {
    return applyState(enabled, fetcher);
  }

  function readStorage(getLocal) {
    const getter = getLocal || (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local &&
      ((keys, cb) => chrome.storage.local.get(keys, cb)));
    return new Promise((resolve) => {
      if (typeof getter !== "function") {
        resolve({ enabled: undefined, allowedOrigins: [] });
        return;
      }
      try {
        const P = api.parse || (typeof globalThis !== "undefined" && globalThis.GeneralCosmeticParse);
        const host = api.hostname != null ? api.hostname : (typeof location !== "undefined" ? location.hostname : "");
        const top = api.isTop != null ? api.isTop : (typeof window !== "undefined" && window.top === window);
        // Subframes only need their host's site rules, not the generic sheet.
        const extra = P ? P.keysForHost(host, top) : [];
        getter([STORAGE_KEY, ALLOWED_ORIGINS_KEY, SETTINGS_KEY, OVERRIDES_KEY].concat(extra), (result) => {
          if (typeof chrome !== "undefined") void chrome.runtime.lastError;
          resolve({
            stored: result || {},
            enabled: result ? result[STORAGE_KEY] : undefined,
            allowedOrigins: result && Array.isArray(result[ALLOWED_ORIGINS_KEY])
              ? result[ALLOWED_ORIGINS_KEY]
              : [],
          });
        });
      } catch {
        resolve({ enabled: undefined, allowedOrigins: [] });
      }
    });
  }

  function start(opts) {
    opts = opts || {};
    if (hostExcluded(opts.hostname != null ? opts.hostname : (typeof location !== "undefined" ? location.hostname : ""))) {
      return;
    }

    const sync = () => {
      readStorage(opts.getLocal).then((state) => applyState(state, opts.fetch));
    };

    sync();

    // The popup can't read tab URLs (no "tabs" permission), so the top frame
    // tells it which origin "Allow this page" should toggle.
    try {
      const onMessage = opts.onMessage || (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage);
      const top = opts.isTop != null ? opts.isTop : (typeof window !== "undefined" && window.top === window);
      if (top && onMessage && onMessage.addListener) {
        onMessage.addListener((msg, _sender, sendResponse) => {
          if (!msg || msg.type !== "pageOrigin") return;
          sendResponse({ origin: pageOrigin(opts.hostname, opts.href != null ? opts.href : (typeof location !== "undefined" ? location.href : "")) });
        });
      }
    } catch {
      // Popup falls back to "Open a normal http(s) page".
    }

    try {
      const onChanged = opts.onChanged || (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged);
      if (onChanged && onChanged.addListener) {
        onChanged.addListener((changes, area) => {
          if (area && area !== "local") return;
          if (!changes || (!changes[STORAGE_KEY] && !changes[ALLOWED_ORIGINS_KEY] && !changes.cosMeta && !changes[SETTINGS_KEY] && !changes[OVERRIDES_KEY])) return;
          sync();
        });
      }
    } catch {
      // Storage watch is optional; initial sync already ran.
    }
  }

  api.STYLE_ID = STYLE_ID;
  api.STORAGE_KEY = STORAGE_KEY;
  api.ALLOWED_ORIGINS_KEY = ALLOWED_ORIGINS_KEY;
  api.CSS_PATH = CSS_PATH;
  api.EXCLUDED_HOST_SUFFIXES = EXCLUDED_HOST_SUFFIXES.slice();
  api.hostExcluded = hostExcluded;
  api.isEnabled = isEnabled;
  api.originAllowed = originAllowed;
  api.applyEnabled = applyEnabled;
  api.applyState = applyState;
  api.removeStyle = removeStyle;
  api.readStorage = readStorage;
  api.start = start;
  api.loadCss = loadCss;
}

if (typeof document !== "undefined" && typeof chrome !== "undefined" && chrome.storage) {
  const api = {};
  installCosmeticHide(api);
  api.start();
}
