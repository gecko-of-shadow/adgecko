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
// dispatching "gk-r1" synchronously. Requests are answered only until the
// first of these: the parser inserts a <script> element (a page inline <head>
// script runs in the same task as document_start, before any timer; the
// parser does a microtask checkpoint before it runs the script, so a
// MutationObserver sees the element first), the first "readystatechange"
// (about:blank frames, which have no parser), or the first task after
// injection (setTimeout 0). A page-world script injected after this one asks
// before any of these, at document_start. Flags travel only over the port:
// the page cannot write to it (it never holds the other end), and later
// window messages are ignored by everyone. If no port arrives, page-world
// features keep their built-in defaults (fail-open). In Chromium (headless,
// review 2026-11-16) every page-world script of this extension ran BEFORE
// this script and took the first port; the order is not a documented Chrome
// guarantee, so both orders are handled. Live Chrome on the owner's PC is
// UNVERIFIED. Vendored scripts get no flags (always on, D-3).
//
// YouTube start times (opt-in, off by default): in the top frame of a
// YouTube watch host only, the port also carries one message upstream,
// {y: {kind, waitMs, ad, toast, timeout}} from src/youtube.js. This script
// checks it strictly (GeckoFeatures.startTimes.entry), adds the minute and the
// extension version, and appends it to chrome.storage.local ytStartTimes
// (at most 300 entries). Nothing else is stored; nothing leaves the browser.
// The switch (ytStartTimes.on) travels down as the flag "ytTiming".
(function () {
  const PORT_EVENT = "gk-p1"; // same ids in src/youtube.js, src/kick.js, src/guards/*.js
  const REQ_EVENT = "gk-r1";
  const MAX_PORTS = 8; // one per page-world script in this frame (at most 2 today)
  const KEYS = ["settings", "siteOverrides"];
  const PAGE_FLAGS = ["youtubeWatchdog", "youtubeCosmetic", "kick", "guardClipboard", "guardPopups"];
  const F = typeof globalThis !== "undefined" ? globalThis.GeckoFeatures : null;
  if (!F || typeof chrome === "undefined" || !chrome.storage) return;
  const ST = F.startTimes;
  let ytTop = false;
  try {
    ytTop = !!ST && window.top === window && ST.isHost(location.hostname);
  } catch {
    // no start times here
  }
  let timingOn = false;
  let flags = null;
  const ports = [];

  function send(port) {
    if (!flags) return;
    try {
      const out = {};
      for (const id of PAGE_FLAGS) out[id] = flags[id] !== false;
      if (ytTop) out.ytTiming = timingOn === true;
      port.postMessage({ f: out });
    } catch {
      // page-world features keep their defaults
    }
  }

  // What a page-world script may send back: "a page guard blocked something
  // here" ({g: "clipboard" | "popup"}), forwarded to the worker for the
  // toolbar dot, at most once per 2 s per frame; and, in the top YouTube frame
  // only, one YouTube start-time record ({y: ...}, see onStartTime). Anything
  // else is ignored (flags never travel this way).
  let lastPing = 0;
  function onGuardPing(m) {
    try {
      const d = m && m.data;
      if (d && typeof d === "object" && d.y) return onStartTime(d.y);
      if (!d || typeof d !== "object" || (d.g !== "clipboard" && d.g !== "popup")) return;
      const now = Date.now();
      if (now - lastPing < 2000) return;
      lastPing = now;
      chrome.runtime.sendMessage({ source: "adgecko-general", type: "guardEvent", kind: d.g }, () => void chrome.runtime.lastError);
    } catch {
      // no dot
    }
  }

  // One YouTube start-time record: top YouTube frame only, switch on, at most
  // one per second (read fresh, append, write). Best effort: the writes are in
  // order inside this tab only. chrome.storage has no atomic append, so two
  // YouTube tabs that end a start at the same moment can lose one of the two
  // records, and a tab that read the log just before Clear on the settings
  // page can write those old records back. Accepted for a diagnostics log.
  let lastStart = 0;
  let stWrites = Promise.resolve();
  function onStartTime(raw) {
    if (!ytTop || !timingOn) return;
    const now = Date.now();
    if (now - lastStart < 1000) return;
    let version = "";
    try {
      version = String(chrome.runtime.getManifest().version || "");
    } catch {
      // no version
    }
    const entry = ST.entry(raw, now, version);
    if (!entry) return;
    lastStart = now;
    stWrites = stWrites.then(() => new Promise((resolve) => {
      try {
        chrome.storage.local.get([ST.KEY], (stored) => {
          void chrome.runtime.lastError;
          try {
            const cur = ST.normalize(stored && stored[ST.KEY]);
            if (!cur.on) return resolve();
            chrome.storage.local.set({ [ST.KEY]: ST.append(cur, entry) }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          } catch {
            resolve();
          }
        });
      } catch {
        resolve();
      }
    }));
  }

  function handshake() {
    if (ports.length >= MAX_PORTS) return;
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = onGuardPing;
      ports.push(ch.port1);
      window.dispatchEvent(new MessageEvent(PORT_EVENT, { ports: [ch.port2] }));
      send(ch.port1);
    } catch {
      // page-world features keep their defaults
    }
  }

  // about:blank, srcdoc and blob: frames have no host of their own
  // (location.hostname is ""): they belong to the site that created them, so
  // its per-site switches apply (window.origin is the inherited origin; the
  // nearest ancestor's origin is the fallback). Opaque origins stay "".
  function siteHost() {
    try {
      if (location.hostname) return location.hostname;
      const candidates = [window.origin];
      if (location.ancestorOrigins && location.ancestorOrigins.length) candidates.push(location.ancestorOrigins[0]);
      for (const o of candidates) {
        if (typeof o === "string" && /^https?:\/\//.test(o)) return new URL(o).hostname;
      }
    } catch {
      // defaults
    }
    return "";
  }

  function load() {
    try {
      chrome.storage.local.get(ytTop ? KEYS.concat(ST.KEY) : KEYS, (stored) => {
        void chrome.runtime.lastError;
        try {
          if (ytTop) timingOn = ST.normalize(stored && stored[ST.KEY]).on;
          flags = F.resolve(stored && stored.settings, stored && stored.siteOverrides, siteHost());
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
  let watcher = null;
  function closeRequests() {
    requestsOpen = false;
    try {
      if (watcher) watcher.disconnect();
      watcher = null;
    } catch {
      // the timer closes the window anyway
    }
  }
  try {
    window.addEventListener(REQ_EVENT, () => {
      if (requestsOpen) handshake();
    }, true);
    setTimeout(closeRequests, 0);
  } catch {
    // scripts injected before this one still got their port
  }
  // A parser-inserted page <script> can run before that timer (same parser
  // task). The parser does a microtask checkpoint before it runs such a
  // script, so this observer sees the element first and closes the window.
  // Extension page-world scripts are never <script> elements.
  try {
    if (typeof MutationObserver === "function" && typeof document !== "undefined" && document) {
      watcher = new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (n && n.nodeType === 1 && String(n.localName).toLowerCase() === "script") {
              closeRequests();
              return;
            }
          }
        }
      });
      watcher.observe(document, { childList: true, subtree: true });
      document.addEventListener("readystatechange", closeRequests, { once: true });
    }
  } catch {
    // the timer closes the window anyway
  }
  load();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes) return;
      if (ytTop && changes[ST.KEY]) {
        // Only the switch matters here; a new log entry changes nothing.
        const on = ST.normalize(changes[ST.KEY].newValue).on;
        if (on !== timingOn) {
          timingOn = on;
          for (const p of ports) send(p);
        }
      }
      if (!changes.settings && !changes.siteOverrides) return;
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
