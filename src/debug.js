// Temporary in-memory debug log. On by default in the page for now (temporary), off in player workers until the page says so. Never throws into playback.
function installTwitchAdblockDebug(target, worker, storage) {
  const CAP = 80;
  const FLAG = "twitch-adblock-debug";
  const ring = [];
  const isWorker = worker === true;
  target.on = !isWorker;
  target.version = "0.2.1";

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
  if (target.on === true && !ring.length) target.note("debug", "on by default");
}

installTwitchAdblockDebug(globalThis.TwitchAdblockDebug = globalThis.TwitchAdblockDebug || {});
