// Temporary in-memory debug log. Off until the popup turns it on. Player workers stay off until the page says so. Never throws into playback.
function installTwitchAdblockDebug(target, worker, storage) {
  const CAP = 80;
  const FLAG = "twitch-adblock-debug";
  const ring = [];
  const isWorker = worker === true;
  target.on = false;
  target.version = "0.2.2";

  function slot() {
    if (isWorker) return null;
    if (storage) return storage;
    try {
      if (typeof sessionStorage === "undefined" || !sessionStorage) return null;
      return sessionStorage;
    } catch {
      return null;
    }
  }

  target.redact = function (value) {
    let text = "";
    try {
      text = String(value == null ? "" : value);
    } catch {
      return "";
    }
    text = text
      .replace(/([?&#])([a-z0-9_]*(?:sig|token|session|auth|nacl)[a-z0-9_]*)=[^&#\s]*/gi, "$1$2=<redacted>")
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<redacted>")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<redacted>")
      .replace(/\b(OAuth|Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 <redacted>");
    if (text.length > 180) text = text.slice(0, 177) + "...";
    return text;
  };

  target.note = function (kind, detail) {
    if (target.on !== true) return;
    try {
      const text = target.redact(typeof detail === "function" ? detail() : detail);
      const kindText = target.redact(kind).slice(0, 32) || "event";
      const last = ring[ring.length - 1];
      if (last && last.kind === kindText && last.detail === text) return;
      ring.push({ t: Date.now(), kind: kindText, detail: text });
      while (ring.length > CAP) ring.shift();
    } catch {
      // A full or broken buffer is dropped. Playback continues.
    }
  };

  target.trace = function (kind, detail) {
    try {
      if (target.on !== true) return;
      const text = target.redact(typeof detail === "function" ? detail() : detail);
      if (isWorker) {
        postMessage({ source: "twitch-adblock", type: "debug", entry: { kind, detail: text } });
        return;
      }
      target.note(kind, text);
    } catch {
      // Recording is optional. Never surface this to the player.
    }
  };

  target.setEnabled = function (value) {
    const next = value === true;
    if (next === target.on) return target.on;
    target.on = next;
    const current = slot();
    if (!current) return target.on;
    try {
      current.setItem(FLAG, next ? "1" : "0");
    } catch {
      // Storage can be locked during a player reload. The in-memory switch still works.
    }
    return target.on;
  };

  target.dump = function () {
    try {
      const lines = [
        "twitch-adblock " + target.version + " debug",
        "on=" + (target.on === true ? "true" : "false"),
      ];
      try {
        if (!isWorker && typeof location !== "undefined" && location.hostname) {
          lines.push("host=" + target.redact(location.hostname));
        }
      } catch {
        // Hostname is optional.
      }
      if (!ring.length) {
        lines.push("(no events)");
        return lines.join("\n");
      }
      const start = ring[0].t;
      for (let i = 0; i < ring.length; i++) {
        const entry = ring[i];
        const seconds = ((entry.t - start) / 1000).toFixed(3);
        lines.push("+" + seconds + " " + entry.kind + " " + entry.detail);
      }
      return lines.join("\n");
    } catch {
      return "twitch-adblock " + target.version + " debug\non=false\n(no events)";
    }
  };

  const saved = slot();
  if (saved) {
    try {
      const flag = saved.getItem(FLAG);
      if (flag === "0") {
        target.on = false;
      } else if (flag === "1") {
        target.on = true;
        target.note("debug", "on restored");
      }
    } catch {
      // Storage cannot be read, so the default stays.
    }
  }
}

// Answers the popup from the page world. The isolated bridge only forwards messages.
function installDebugPopupReply(host) {
  if (!host || host.__twitchAdblockDebugReply) return;
  const target = host.TwitchAdblockDebug;
  if (!target || typeof host.addEventListener !== "function") return;
  host.__twitchAdblockDebugReply = true;

  function onTwitch() {
    try {
      const name = String(host.location && host.location.hostname ? host.location.hostname : "");
      return name === "twitch.tv" || name.endsWith(".twitch.tv");
    } catch {
      return false;
    }
  }

  function bannerLine() {
    try {
      const doc = host.document;
      if (!doc || typeof doc.querySelector !== "function") return "";
      const overlay = doc.querySelector(".adblock-overlay");
      if (!overlay || !overlay.style || overlay.style.display === "none") return "";
      const node = typeof overlay.querySelector === "function" ? overlay.querySelector("p") : null;
      return String(node && node.textContent ? node.textContent : "").trim();
    } catch {
      return "";
    }
  }

  function noteBanner() {
    if (target.on !== true) return;
    const line = bannerLine();
    if (line) {
      target._bannerSeen = true;
      target.note("banner", line);
      return;
    }
    if (target._bannerSeen) target.note("banner", "clear");
    target._bannerSeen = false;
  }

  function watchBanner() {
    if (!onTwitch()) return;
    noteBanner();
    if (target._bannerWatch) return;
    const Observer = host.MutationObserver;
    const root = host.document && host.document.documentElement;
    if (typeof Observer !== "function" || !root) return;
    try {
      const observer = new Observer(function () {
        noteBanner();
      });
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      target._bannerWatch = observer;
    } catch {
      // The label watch is optional. Playback does not use it.
    }
  }

  function unwatchBanner() {
    const observer = target._bannerWatch;
    target._bannerWatch = null;
    if (observer && typeof observer.disconnect === "function") {
      try {
        observer.disconnect();
      } catch {
        // Stopping the watch must not affect playback.
      }
    }
  }

  if (target.on === true) watchBanner();

  host.addEventListener("message", function (event) {
    try {
      if (!event || event.source !== host) return;
      const data = event.data;
      if (!data || data.source !== "twitch-adblock-debug") return;
      if (data.type !== "set" && data.type !== "get") return;
      const debug = host.TwitchAdblockDebug;
      if (!debug) return;
      if (data.type === "set" && debug.on !== (data.on === true)) {
        const next = data.on === true;
        if (!next) debug.note("debug", "off");
        debug.setEnabled(next);
        if (next) {
          debug.note("debug", "on");
          watchBanner();
        } else {
          unwatchBanner();
        }
      } else if (debug.on === true) {
        noteBanner();
      }
      host.postMessage({
        source: "twitch-adblock-debug",
        type: "state",
        on: debug.on === true,
        text: debug.dump(),
        version: debug.version || "",
        gen: data.gen,
      }, "*");
    } catch {
      // The debug popup must not affect playback.
    }
  });
}

installTwitchAdblockDebug(globalThis.TwitchAdblockDebug = globalThis.TwitchAdblockDebug || {});
installDebugPopupReply(globalThis);
