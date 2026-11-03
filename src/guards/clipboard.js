// Page guard "guardClipboard" (default on; never on Twitch/YouTube/Kick, see
// the manifest exclude_matches generated from src/settings/features.js).
// MAIN world, document_start, all frames.
//
// ClickFix-style attacks get a page to put a shell command into the clipboard
// and then tell the visitor to paste it into Run, PowerShell or a terminal.
// This wraps navigator.clipboard.writeText, document.execCommand("copy") and
// DataTransfer.setData during copy events: text that looks like a dangerous
// command is not written unless the visitor clearly asked for a copy (a copy
// shortcut, or a click on something labelled "copy") or the site is on the
// known-safe list (documentation and code hosts). A small notice says why.
// Fail-open: any error inside the guard lets the original call through.
// Switch: flag "guardClipboard" from src/settings/flags.js, read at use time,
// on until a flag says otherwise.
function installClipboardGuard(target) {
  // Commands people are tricked into running (patterns are case-insensitive).
  const PATTERNS = [
    { id: "powershell-encoded", re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,200}\s-(?:e|ec|en|enc|enco|encod|encode|encoded|encodedcommand)\s+[A-Za-z0-9+/=]{16,}/i },
    { id: "powershell-download", re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,400}(?:\biex\b|invoke-expression|downloadstring|downloadfile|invoke-webrequest|\biwr\b|\birm\b|invoke-restmethod|net\.webclient|start-bitstransfer|frombase64string)/i },
    { id: "powershell-hidden", re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,200}\s-(?:w|win|window|windowstyle)\s+(?:h|hid|hidden)\b/i },
    { id: "iex-download", re: /\b(?:iex|invoke-expression)\b[^\n]{0,40}\(?\s*(?:iwr|irm|invoke-webrequest|invoke-restmethod|new-object\s+net\.webclient)/i },
    { id: "cmd-chain", re: /\bcmd(?:\.exe)?\s+\/[ck]\b[^\n]{0,300}(?:mshta|curl|wget|bitsadmin|certutil|powershell|pwsh|rundll32|regsvr32|msiexec|start\s+\/min)/i },
    { id: "mshta", re: /\bmshta(?:\.exe)?\s+["']?(?:https?:|vbscript:|javascript:|\\\\)/i },
    { id: "bitsadmin", re: /\bbitsadmin(?:\.exe)?\s+\/transfer\b/i },
    { id: "certutil", re: /\bcertutil(?:\.exe)?\s+[^\n]{0,80}-urlcache\b/i },
    { id: "rundll32", re: /\brundll32(?:\.exe)?\s+[^\n]{0,80}(?:javascript:|https?:|\\\\)/i },
    { id: "regsvr32", re: /\bregsvr32(?:\.exe)?\s+[^\n]{0,40}\/i:\s*https?:/i },
    { id: "msiexec-remote", re: /\bmsiexec(?:\.exe)?\s+[^\n]{0,40}\/(?:i|package)\s+["']?https?:/i },
    { id: "curl-pipe-shell", re: /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/i },
    { id: "osascript-curl", re: /\bosascript\b[^\n]{0,200}(?:curl|do shell script)/i },
    { id: "base64-pipe-shell", re: /\bbase64\s+(?:-d|--decode|-D)\b[^\n]{0,80}\|\s*(?:ba|z)?sh\b/i },
  ];

  // Documentation and code hosts whose "copy" buttons hand out install
  // commands on purpose (e.g. `curl ... | sh`). A host matches itself and
  // its subdomains.
  const SAFE_HOSTS = [
    "github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com",
    "developer.mozilla.org", "learn.microsoft.com", "docs.microsoft.com", "developer.apple.com", "docs.github.com",
    "readthedocs.io", "readthedocs.org", "npmjs.com", "pypi.org", "crates.io", "brew.sh", "rustup.rs", "deno.com", "deno.land", "nodejs.org", "python.org",
    "docker.com", "kubernetes.io", "archlinux.org", "debian.org", "ubuntu.com", "fedoraproject.org", "chocolatey.org",
  ];

  function hostOf(loc) {
    try {
      return String(loc.hostname || "").toLowerCase();
    } catch {
      return "";
    }
  }

  function onSafeHost(host) {
    return SAFE_HOSTS.some((d) => host === d || host.endsWith("." + d));
  }

  function matchDangerous(text) {
    const s = String(text == null ? "" : text);
    if (s.length < 8) return null;
    const sample = s.length > 20000 ? s.slice(0, 20000) : s;
    for (const p of PATTERNS) if (p.re.test(sample)) return p.id;
    return null;
  }

  // Was the most recent trusted input a deliberate copy? A copy shortcut, or a
  // click on an element (or ancestor) labelled "copy". A fake "I'm not a
  // robot" button that writes a command does not count.
  function deliberateCopy(last, now) {
    if (!last || now - last.at > 1500) return false;
    if (last.kind === "key") return last.copyKey === true;
    let el = last.target;
    for (let i = 0; el && i < 4; i++, el = el.parentElement) {
      const bits = [el.getAttribute && el.getAttribute("aria-label"), el.getAttribute && el.getAttribute("title"), el.getAttribute && el.getAttribute("data-clipboard-text") != null ? "copy" : "", typeof el.className === "string" ? el.className : "", el.id, i === 0 ? String(el.textContent || "").slice(0, 40) : ""];
      if (bits.some((b) => b && /\bcop(?:y|ied)\b|clipboard/i.test(String(b)))) return true;
    }
    return false;
  }

  target.PATTERNS = PATTERNS;
  target.SAFE_HOSTS = SAFE_HOSTS;
  target.matchDangerous = matchDangerous;
  target.onSafeHost = onSafeHost;
  target.deliberateCopy = deliberateCopy;

  // Install the wrappers. env: { window, document, navigator, location, now(), notify(text), flagOn() }
  target.install = function install(env) {
    const win = env.window;
    const doc = env.document;
    const now = env.now || (() => Date.now());
    const flagOn = env.flagOn || (() => true);
    let lastInput = null;
    const remember = (e, kind) => {
      try {
        if (!e || e.isTrusted !== true) return;
        const copyKey = kind === "key" && (e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "c";
        lastInput = { kind, at: now(), target: e.target, copyKey };
      } catch {
        // fail open
      }
    };
    try {
      doc.addEventListener("pointerdown", (e) => remember(e, "click"), true);
      doc.addEventListener("click", (e) => remember(e, "click"), true);
      doc.addEventListener("keydown", (e) => remember(e, "key"), true);
    } catch {
      // without input tracking every dangerous write outside safe hosts is held
    }

    // true = let it through.
    function allowed(text) {
      try {
        if (!flagOn()) return true;
        const hit = matchDangerous(text);
        if (!hit) return true;
        if (onSafeHost(hostOf(env.location))) return true;
        if (deliberateCopy(lastInput, now())) return true;
        if (env.notify) env.notify(hit);
        return false;
      } catch {
        return true;
      }
    }
    target.allowed = allowed;

    const clip = env.navigator && env.navigator.clipboard;
    if (clip && typeof clip.writeText === "function") {
      const nativeWrite = clip.writeText;
      try {
        const wrapped = new Proxy(nativeWrite, {
          apply(fn, self, args) {
            if (!allowed(args[0])) return Promise.reject(new DOMException("Write blocked by the browser's protection", "NotAllowedError"));
            return Reflect.apply(fn, self, args);
          },
        });
        Object.defineProperty(Object.getPrototypeOf(clip) || clip, "writeText", { value: wrapped, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    if (doc && typeof doc.execCommand === "function") {
      try {
        const proto = Object.getPrototypeOf(doc) || doc;
        const nativeExec = proto.execCommand || doc.execCommand;
        const wrappedExec = new Proxy(nativeExec, {
          apply(fn, self, args) {
            try {
              if (String(args[0] || "").toLowerCase() === "copy") {
                const sel = win.getSelection ? String(win.getSelection()) : "";
                const active = doc.activeElement;
                const field = active && typeof active.value === "string" && typeof active.selectionStart === "number"
                  ? active.value.slice(active.selectionStart, active.selectionEnd) : "";
                if (!allowed(sel || field)) return false;
              }
            } catch {
              // fail open
            }
            return Reflect.apply(fn, self, args);
          },
        });
        Object.defineProperty(proto, "execCommand", { value: wrappedExec, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    // A page's copy handler can swap the copied text: check it too.
    const DT = win.DataTransfer;
    if (DT && DT.prototype && typeof DT.prototype.setData === "function") {
      try {
        const nativeSet = DT.prototype.setData;
        const wrappedSet = new Proxy(nativeSet, {
          apply(fn, self, args) {
            try {
              const type = String(args[0] || "").toLowerCase();
              if ((type === "text/plain" || type === "text" || type === "text/html") && !allowed(args[1])) return undefined;
            } catch {
              // fail open
            }
            return Reflect.apply(fn, self, args);
          },
        });
        Object.defineProperty(DT.prototype, "setData", { value: wrappedSet, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }
  };
}

// A small notice in the page (closed shadow root, removed after 12 s).
function clipboardGuardNotice(doc) {
  let shown = 0;
  return () => {
    try {
      if (Date.now() - shown < 3000) return;
      shown = Date.now();
      const host = doc.createElement("div");
      const root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;
      const box = doc.createElement("div");
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:12px 14px;border-radius:8px;background:#18181b;color:#efeff1;font:13px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);border:1px solid #f0a33a";
      box.textContent = "Blocked: this page tried to put a command into your clipboard. If a page asks you to paste something into Run, PowerShell or a terminal to \"verify\" you, don't.";
      root.appendChild(box);
      (doc.body || doc.documentElement).appendChild(host);
      setTimeout(() => {
        try { host.remove(); } catch { /* gone */ }
      }, 12000);
    } catch {
      // the block itself still happened
    }
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined" && typeof navigator !== "undefined") {
  try {
    // Switch "guardClipboard" over the private flag port (src/settings/flags.js;
    // never window messages, which the page can forge). On until told otherwise.
    let on = true;
    const PORT_EVENT = "gk-p1";
    let port = null;
    const take = (event) => {
      const p = event && event.ports && event.ports[0];
      if (port || !p) return;
      port = p;
      window.removeEventListener(PORT_EVENT, take, true);
      p.addEventListener("message", (m) => {
        const f = m && m.data && m.data.f;
        if (f && typeof f === "object" && typeof f.guardClipboard === "boolean") on = f.guardClipboard;
      });
      p.start();
    };
    window.addEventListener(PORT_EVENT, take, true);
    window.dispatchEvent(new Event("gk-r1"));
    const api = {};
    installClipboardGuard(api);
    api.install({ window, document, navigator, location, notify: clipboardGuardNotice(document), flagOn: () => on });
  } catch {
    // guard not installed; the page works as before
  }
}
