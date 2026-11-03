// ISOLATED world, document_start, on YouTube, Kick and Twitch (top frame).
// Hands the page-world scripts the extension owns (src/youtube.js,
// src/kick.js) their feature switches, read from storage (settings,
// siteOverrides) through src/settings/features.js (listed first in the manifest).
//
// Hook-time flags: the page-world script reads a flag each time it is about
// to act, and a feature stays ON until a flag says otherwise (fail-open). The
// first flags arrive a few milliseconds after document_start, once storage
// answers; the exact ordering between worlds is UNVERIFIED, so the page-world
// side also asks for them. Vendored scripts get no flags (always on, D-3).
// The page can see and fake these messages; the worst it can do is switch our
// own feature off on itself.
(function () {
  const CHANNEL = "gk-f1"; // same id in src/youtube.js and src/kick.js
  const KEYS = ["settings", "siteOverrides"];
  const PAGE_FLAGS = ["youtubeWatchdog", "youtubeCosmetic", "kick"];
  const F = typeof globalThis !== "undefined" ? globalThis.GeckoFeatures : null;
  if (!F || typeof chrome === "undefined" || !chrome.storage) return;
  let flags = null;

  function post() {
    if (!flags) return;
    try {
      const out = {};
      for (const id of PAGE_FLAGS) out[id] = flags[id] !== false;
      window.postMessage({ [CHANNEL]: out }, location.origin);
    } catch {
      // page-world features stay on
    }
  }

  function load() {
    try {
      chrome.storage.local.get(KEYS, (stored) => {
        void chrome.runtime.lastError;
        try {
          flags = F.resolve(stored && stored.settings, stored && stored.siteOverrides, location.hostname);
          post();
        } catch {
          // fail open
        }
      });
    } catch {
      // fail open
    }
  }

  load();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes || (!changes.settings && !changes.siteOverrides)) return;
      load();
    });
  } catch {
    // live updates are optional
  }
  try {
    window.addEventListener("message", (e) => {
      if (e.source === window && e.data && e.data[CHANNEL] === "?") post();
    });
  } catch {
    // the first post still goes out
  }
  // The popup cannot read tab URLs (no "tabs" permission): the top frame tells it.
  try {
    if (window.top === window && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || msg.type !== "pageOrigin") return;
        sendResponse({ origin: location.origin });
      });
    }
  } catch {
    // popup falls back to "open a normal page"
  }
})();
