// ISOLATED world, document_start: on YouTube and Twitch (top frame), on Kick
// (all frames, like src/kick.js) and on every ordinary site (all frames, for
// the page guards).
// Hands the page-world scripts the extension owns (src/youtube.js,
// src/kick.js, src/guards/*.js) their feature switches, read from storage (settings,
// siteOverrides) through src/settings/features.js (listed first in the manifest).
//
// Channel (security review M-1): a private MessagePort, never window.postMessage.
// At document_start, before any page script can run, this script dispatches a
// MessageEvent "gk-p1" on window SYNCHRONOUSLY carrying one end of a fresh
// MessageChannel; each page-world script takes the first one it sees and stops
// listening. A page-world script injected after this one asks for its port by
// dispatching "gk-r1" synchronously; requests are answered only until the first
// task after injection (setTimeout 0), so page scripts cannot obtain a port to
// read the settings later. Flags travel only over the port: the page cannot
// write to it (it never holds the other end), and later window messages are
// ignored by everyone. If no port arrives, page-world features keep their
// built-in defaults (fail-open). That every document_start script of this
// extension runs in one task, in manifest order, is UNVERIFIED (Chrome
// behaviour); both orders are handled. Vendored scripts get no flags (always
// on, D-3).
(function () {
  const PORT_EVENT = "gk-p1"; // same ids in src/youtube.js, src/kick.js, src/guards/*.js
  const REQ_EVENT = "gk-r1";
  const MAX_PORTS = 8; // one per page-world script in this frame (at most 2 today)
  const KEYS = ["settings", "siteOverrides"];
  const PAGE_FLAGS = ["youtubeWatchdog", "youtubeCosmetic", "kick", "guardClipboard", "guardPopups"];
  const F = typeof globalThis !== "undefined" ? globalThis.GeckoFeatures : null;
  if (!F || typeof chrome === "undefined" || !chrome.storage) return;
  let flags = null;
  const ports = [];

  function send(port) {
    if (!flags) return;
    try {
      const out = {};
      for (const id of PAGE_FLAGS) out[id] = flags[id] !== false;
      port.postMessage({ f: out });
    } catch {
      // page-world features keep their defaults
    }
  }

  function handshake() {
    if (ports.length >= MAX_PORTS) return;
    try {
      const ch = new MessageChannel();
      ports.push(ch.port1);
      window.dispatchEvent(new MessageEvent(PORT_EVENT, { ports: [ch.port2] }));
      send(ch.port1);
    } catch {
      // page-world features keep their defaults
    }
  }

  function load() {
    try {
      chrome.storage.local.get(KEYS, (stored) => {
        void chrome.runtime.lastError;
        try {
          flags = F.resolve(stored && stored.settings, stored && stored.siteOverrides, location.hostname);
          for (const p of ports) send(p);
        } catch {
          // fail open
        }
      });
    } catch {
      // fail open
    }
  }

  // Page-world scripts injected before this one are already listening.
  handshake();
  let requestsOpen = true;
  try {
    window.addEventListener(REQ_EVENT, () => {
      if (requestsOpen) handshake();
    }, true);
    setTimeout(() => {
      requestsOpen = false;
    }, 0);
  } catch {
    // scripts injected before this one still got their port
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
  // The popup cannot read tab URLs (no "tabs" permission): the top frame tells
  // it. On ordinary sites src/cosmetic.js already answers, so only stream sites.
  try {
    if (window.top === window && F.isStreamHost(location.hostname) && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || msg.type !== "pageOrigin") return;
        sendResponse({ origin: location.origin });
      });
    }
  } catch {
    // popup falls back to "open a normal page"
  }
})();
