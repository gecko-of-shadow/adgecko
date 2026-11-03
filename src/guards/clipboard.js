// Page guard "guardClipboard" (default on; never on Twitch/YouTube/Kick, see
// the manifest exclude_matches generated from src/settings/features.js).
// MAIN world, document_start, all frames, plus about:blank / srcdoc / blob:
// frames of ordinary sites (match_about_blank, match_origin_as_fallback), so a
// page cannot reach a pristine clipboard through a same-origin blank frame.
//
// ClickFix-style attacks get a page to put a shell command into the clipboard
// and then tell the visitor to paste it into Run, PowerShell or a terminal.
// This wraps navigator.clipboard.writeText, document.execCommand("copy"/"cut")
// and DataTransfer.setData during copy events: text that looks like a dangerous
// command is not written unless the visitor clearly asked for exactly that
// text, or the site is on the known-safe list (documentation and code hosts).
// A small notice says why.
// "Clearly asked" (security review M-2): a copy shortcut while the text is part
// of the real selection, or a click on something labelled "copy" while the
// text is visible right next to it. A "copy" label alone is not enough.
// Values are coerced to a string once; the checked string is the one passed
// on. Wrappers sit on the prototype that owns each method, and the selection
// and form-field values are read through getters captured before any page
// script runs, so a page cannot show the check one text and copy another.
// Fail-open: an error in the guard lets the original call through, but an
// error while judging "did the visitor ask for it" counts as "no".
// Switch: flag "guardClipboard" from src/settings/flags.js, read at use time,
// on until a flag says otherwise.
// Wrapped in one function so the page sees no globals from this file (L-18).
(() => {
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
  // its subdomains. No host where anyone can publish their own pages and
  // scripts on a subdomain (readthedocs.io/.org were removed for that).
  const SAFE_HOSTS = [
    "github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com",
    "developer.mozilla.org", "learn.microsoft.com", "docs.microsoft.com", "developer.apple.com", "docs.github.com",
    "npmjs.com", "pypi.org", "crates.io", "brew.sh", "rustup.rs", "deno.com", "deno.land", "nodejs.org", "python.org",
    "docker.com", "kubernetes.io", "archlinux.org", "debian.org", "ubuntu.com", "fedoraproject.org", "chocolatey.org",
  ];
  const MAX_NEARBY_TEXT = 200000; // characters read from one ancestor at most

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
    const s = typeof text === "string" ? text : String(text == null ? "" : text);
    if (s.length < 8) return null;
    const sample = s.length > 20000 ? s.slice(0, 20000) : s;
    for (const p of PATTERNS) if (p.re.test(sample)) return p.id;
    return null;
  }

  const squash = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  // Did the visitor ask for exactly this text? last = most recent trusted
  // input (last.sel = the selected text when a copy shortcut was pressed, read
  // through native getters by the first keydown listener on window).
  //  - copy shortcut (Ctrl/Cmd+C): the text must be part of that selection, so
  //    a copy handler cannot swap a command in, and a page that changes the
  //    selection after the key press gains nothing ("pastejacking");
  //  - click on an element (or one of 3 ancestors) labelled "copy": the text
  //    must also be visible in that element or one of its 4 nearest ancestors
  //    (a code block next to its copy button). A fake "I'm not a robot" or a
  //    "Copy" button over hidden text does not count.
  // Any error means "no".
  function deliberateCopy(last, now, text) {
    try {
      if (!last || now - last.at > 1500) return false;
      const want = squash(text);
      if (!want) return false;
      if (last.kind === "key") return last.copyKey === true && squash(last.sel).includes(want);
      let labelled = false;
      let el = last.target;
      for (let i = 0; el && i < 4; i++, el = el.parentElement) {
        const bits = [el.getAttribute && el.getAttribute("aria-label"), el.getAttribute && el.getAttribute("title"), el.getAttribute && el.getAttribute("data-clipboard-text") != null ? "copy" : "", typeof el.className === "string" ? el.className : "", el.id, i === 0 ? String(el.textContent || "").slice(0, 40) : ""];
        if (bits.some((b) => b && /\bcop(?:y|ied)\b|clipboard/i.test(String(b)))) {
          labelled = true;
          break;
        }
      }
      if (!labelled) return false;
      el = last.target;
      for (let i = 0; el && i < 5; i++, el = el.parentElement) {
        const shown = typeof el.innerText === "string" ? el.innerText : el.textContent;
        if (typeof shown !== "string" || shown.length > MAX_NEARBY_TEXT) continue;
        if (squash(shown).includes(want)) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // The object on the prototype chain that owns `key` (where a wrapper must
  // go so that no prototype further up still holds the native function).
  function ownerOf(obj, key) {
    for (let o = obj; o; o = Object.getPrototypeOf(o)) {
      if (Object.prototype.hasOwnProperty.call(o, key)) return o;
    }
    return null;
  }

  target.PATTERNS = PATTERNS;
  target.SAFE_HOSTS = SAFE_HOSTS;
  target.matchDangerous = matchDangerous;
  target.onSafeHost = onSafeHost;
  target.deliberateCopy = deliberateCopy;
  target.ownerOf = ownerOf;

  // Install the wrappers. env: { window, document, navigator, location, now(), notify(text), flagOn() }
  target.install = function install(env) {
    const win = env.window;
    const doc = env.document;
    const now = env.now || (() => Date.now());
    const flagOn = env.flagOn || (() => true);
    let lastInput = null;

    // Native getters, captured now (document_start, before page scripts).
    const getter = (proto, key) => {
      try {
        const d = proto && Object.getOwnPropertyDescriptor(proto, key);
        return d && typeof d.get === "function" ? d.get : null;
      } catch {
        return null;
      }
    };
    const nativeGetSelection = typeof win.getSelection === "function" ? win.getSelection : null;
    const nativeSelectionText = win.Selection && win.Selection.prototype && typeof win.Selection.prototype.toString === "function" ? win.Selection.prototype.toString : null;
    const nativeActive = getter(win.Document && win.Document.prototype, "activeElement");
    const fieldGetters = [];
    for (const C of [win.HTMLTextAreaElement, win.HTMLInputElement]) {
      const p = C && C.prototype;
      const g = { value: getter(p, "value"), start: getter(p, "selectionStart"), end: getter(p, "selectionEnd") };
      if (g.value && g.start && g.end) fieldGetters.push(g);
    }

    function selectionText() {
      try {
        const sel = nativeGetSelection ? Reflect.apply(nativeGetSelection, win, []) : null;
        if (!sel) return "";
        return nativeSelectionText ? String(Reflect.apply(nativeSelectionText, sel, [])) : String(sel);
      } catch {
        return "";
      }
    }
    function fieldSelection() {
      let active = null;
      try {
        active = nativeActive ? Reflect.apply(nativeActive, doc, []) : doc.activeElement;
      } catch {
        return "";
      }
      if (!active) return "";
      for (const g of fieldGetters) {
        try {
          // Throws "Illegal invocation" unless active really is that kind of field.
          const v = Reflect.apply(g.value, active, []);
          const s = Reflect.apply(g.start, active, []);
          const e = Reflect.apply(g.end, active, []);
          return typeof v === "string" && typeof s === "number" && typeof e === "number" ? v.slice(s, e) : "";
        } catch {
          // not this kind of field
        }
      }
      if (fieldGetters.length) return "";
      // No native getters available (not a browser): plain properties.
      try {
        return typeof active.value === "string" && typeof active.selectionStart === "number" ? active.value.slice(active.selectionStart, active.selectionEnd) : "";
      } catch {
        return "";
      }
    }

    const remember = (e, kind) => {
      try {
        if (!e || e.isTrusted !== true) return;
        const copyKey = kind === "key" && (e.ctrlKey || e.metaKey) && String(e.key || "").toLowerCase() === "c";
        lastInput = { kind, at: now(), target: e.target, copyKey, sel: copyKey ? selectionText() + "\n" + fieldSelection() : "" };
      } catch {
        // fail open
      }
    };
    // Capture listeners on window, added before any page script: they run
    // before every page listener, so the selection is the visitor's own.
    const inputTarget = typeof win.addEventListener === "function" ? win : doc;
    try {
      inputTarget.addEventListener("pointerdown", (e) => remember(e, "click"), true);
      inputTarget.addEventListener("click", (e) => remember(e, "click"), true);
      inputTarget.addEventListener("keydown", (e) => remember(e, "key"), true);
    } catch {
      // without input tracking every dangerous write outside safe hosts is held
    }

    // text must already be a string. true = let it through.
    function allowed(text) {
      try {
        if (!flagOn()) return true;
        const hit = matchDangerous(text);
        if (!hit) return true;
        if (onSafeHost(hostOf(env.location))) return true;
        if (deliberateCopy(lastInput, now(), text)) return true;
        if (env.notify) env.notify(hit);
        return false;
      } catch {
        return true;
      }
    }
    target.allowed = allowed;

    const clip = env.navigator && env.navigator.clipboard;
    const clipOwner = clip && ownerOf(clip, "writeText");
    if (clipOwner && typeof clipOwner.writeText === "function") {
      try {
        const wrapped = new Proxy(clipOwner.writeText, {
          apply(fn, self, args) {
            if (args.length === 0) return Reflect.apply(fn, self, args); // native error
            let text;
            try {
              text = String(args[0]); // once: the checked string is the written one
            } catch (error) {
              return Promise.reject(error);
            }
            if (!allowed(text)) return Promise.reject(new DOMException("Write blocked by the browser's protection", "NotAllowedError"));
            return Reflect.apply(fn, self, [text, ...args.slice(1)]);
          },
        });
        Object.defineProperty(clipOwner, "writeText", { value: wrapped, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    const execOwner = doc && ownerOf(doc, "execCommand");
    if (execOwner && typeof execOwner.execCommand === "function") {
      try {
        const wrappedExec = new Proxy(execOwner.execCommand, {
          apply(fn, self, args) {
            if (args.length === 0) return Reflect.apply(fn, self, args); // native error
            const call = args.slice();
            try {
              call[0] = String(args[0]); // once
              const cmd = call[0].toLowerCase();
              if (cmd === "copy" || cmd === "cut") {
                const sel = selectionText();
                const field = fieldSelection();
                if (!allowed(sel) || (field && field !== sel && !allowed(field))) return false;
              }
            } catch {
              // fail open
            }
            return Reflect.apply(fn, self, call);
          },
        });
        Object.defineProperty(execOwner, "execCommand", { value: wrappedExec, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    // A page's copy handler can swap the copied text: check it too.
    const DT = win.DataTransfer;
    const dtOwner = DT && DT.prototype && ownerOf(DT.prototype, "setData");
    if (dtOwner && typeof dtOwner.setData === "function") {
      try {
        const wrappedSet = new Proxy(dtOwner.setData, {
          apply(fn, self, args) {
            if (args.length < 2) return Reflect.apply(fn, self, args); // native error
            const call = args.slice();
            try {
              call[0] = String(args[0]); // once each
              call[1] = String(args[1]);
              const type = call[0].toLowerCase();
              if ((type === "text/plain" || type === "text" || type === "text/html") && !allowed(call[1])) return undefined;
            } catch {
              // fail open
            }
            return Reflect.apply(fn, self, call);
          },
        });
        Object.defineProperty(dtOwner, "setData", { value: wrappedSet, configurable: true, writable: true });
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
    // Read events through MessageEvent getters captured now, before any page
    // script runs: a page that later redefines MessageEvent.prototype.data or
    // .ports can then neither rewrite nor read the flags (review of M-1). Outside
    // a browser (tests) plain property reads are used.
    const applyFn = Reflect.apply;
    const meGetter = (k) => {
      const d = Object.getOwnPropertyDescriptor(MessageEvent.prototype, k);
      return d && typeof d.get === "function" ? d.get : null;
    };
    const dataGet = meGetter("data");
    const portsGet = meGetter("ports");
    const dataOf = dataGet ? (m) => applyFn(dataGet, m, []) : (m) => m && m.data;
    const portsOf = portsGet ? (e) => applyFn(portsGet, e, []) : (e) => e && e.ports;
    const flagsOf = (m) => {
      const d = dataOf(m);
      return d && typeof d === "object" ? d.f : null;
    };
    const take = (event) => {
      const ps = portsOf(event);
      const p = ps && ps[0];
      if (port || !p) return;
      port = p;
      window.removeEventListener(PORT_EVENT, take, true);
      p.addEventListener("message", (m) => {
        const f = flagsOf(m);
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
})();
