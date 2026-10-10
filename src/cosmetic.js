// Cosmetic element-hide for leftover ad boxes on ordinary sites.
// Never runs on Twitch / YouTube family / Kick (manifest exclude_matches + host check).
// Master switch: chrome.storage.local.generalEnabled (default ON; shared with popup/DNR).
function installCosmeticHide(api) {
  const STYLE_ID = "twitch-adblock-cosmetic-hide";
  // Same key as popup src/general-settings.js — do not rename without coordinating.
  const STORAGE_KEY = "generalEnabled";
  const ALLOWED_ORIGINS_KEY = "generalAllowedOrigins";
  const CSS_PATH = "src/cosmetic-hide.css";

  // Hostname suffixes hard-excluded from general cosmetic hide.
  // Keep in sync with manifest exclude_matches and popup HARD_EXCLUDE_HOST_RE.
  const EXCLUDED_HOST_SUFFIXES = [
    "twitch.tv",
    "ttvnw.net",
    "jtvnw.net",
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "youtubekids.com",
    "googlevideo.com",
    "ytimg.com",
    "ggpht.com",
    "kick.com",
    "kickusercontent.com",
  ];

  function hostExcluded(hostname) {
    const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
    if (!host) return true;
    if (host.includes("twitchcdn")) return true;
    for (const bit of EXCLUDED_HOST_SUFFIXES) {
      if (host === bit || host.endsWith("." + bit)) return true;
    }
    return false;
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

  function removeStyle() {
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

  function injectStyle(text) {
    if (typeof document === "undefined") return;
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      const root = document.documentElement || document.head || document;
      root.appendChild(styleEl);
    }
    styleEl.textContent = text;
  }

  function loadCss(fetcher) {
    if (cssText != null) return Promise.resolve(cssText);
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

  function applyState(state, fetcher) {
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
    return loadCss(fetcher).then((text) => {
      injectStyle(text);
      return true;
    }).catch(() => {
      // Fail open for playback safety: do not throw into the page.
      removeStyle();
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
        getter([STORAGE_KEY, ALLOWED_ORIGINS_KEY], (result) => {
          if (typeof chrome !== "undefined") void chrome.runtime.lastError;
          resolve({
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

    try {
      const onChanged = opts.onChanged || (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged);
      if (onChanged && onChanged.addListener) {
        onChanged.addListener((changes, area) => {
          if (area && area !== "local") return;
          if (!changes || (!changes[STORAGE_KEY] && !changes[ALLOWED_ORIGINS_KEY])) return;
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
