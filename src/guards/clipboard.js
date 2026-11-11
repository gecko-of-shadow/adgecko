// Page guard "guardClipboard" (default on; never on Twitch/YouTube/Kick, see
// the manifest exclude_matches generated from src/settings/features.js).
// MAIN world, document_start, all frames, plus about:blank / srcdoc / blob:
// frames of ordinary sites (match_about_blank, match_origin_as_fallback), so a
// page cannot reach a pristine clipboard through a same-origin blank frame.
//
// ClickFix-style attacks get a page to put a shell command into the clipboard
// and then tell the visitor to paste it into Run, PowerShell or a terminal.
// Checked: navigator.clipboard.writeText and .write, document.execCommand
// ("copy"/"cut"), the browser's own copy/cut of the selection, and
// DataTransfer.setData on a copy/cut event's clipboard data. Text that looks
// like a dangerous command is not written unless the visitor copied exactly
// that text themselves, or the site is on the known-safe list (documentation
// and code hosts). A small notice says why and how to copy on purpose.
//
// "Copied it themselves" (security review M-2 and its follow-up review): the
// text is part of the selection the visitor had when they pressed Ctrl/Cmd+C
// (or opened the context menu). A button labelled "Copy" does not count: a
// page can label, hide or fake anything it shows (opacity:0, off-screen text).
// The page runs in this same JavaScript world, so everything on the decision
// path is captured when this file runs (document_start, before any page
// script): built-ins (RegExp exec, string methods, Reflect.apply, Date.now,
// Promise.reject), the selection and form-field getters and the key-event
// getters. Values are turned into text once; the checked text is the one
// passed on. Wrappers sit on the prototype that owns each method.
// Known limit (UNVERIFIED in practice): the clipboard.write() check awaits
// promises, and a page that rewrites Promise internals can still interfere
// with that one asynchronous path.
// Fail-open: an error in the guard lets the original call through, but an
// error while judging "did the visitor copy it" counts as "no".
// Switch: flag "guardClipboard" from src/settings/flags.js, read at use time,
// on until a flag says otherwise.
// Wrapped in one function so the page sees no globals from this file (L-18).
(() => {
// Captured at load (document_start), before any page script can replace them.
const apply = Reflect.apply;
const reExec = RegExp.prototype.exec;
const sLower = String.prototype.toLowerCase;
const sSlice = String.prototype.slice;
const sIndexOf = String.prototype.indexOf;
const sCharCodeAt = String.prototype.charCodeAt;
const StringFn = String;
const dateNow = Date.now;
const PromiseCtor = Promise;
const promiseReject = Promise.reject;
const getOwnDesc = Object.getOwnPropertyDescriptor;
const getProto = Object.getPrototypeOf;
const defineProp = Object.defineProperty;
const hasOwn = Object.prototype.hasOwnProperty;

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
  // How long a copy gesture authorises a write of the selected text.
  const KEY_WINDOW_MS = 1500;
  const MENU_WINDOW_MS = 30000;

  const lower = (s) => apply(sLower, s, []);
  const matches = (re, s) => apply(reExec, re, [s]) !== null;
  const contains = (hay, needle) => apply(sIndexOf, hay, [needle]) !== -1;

  function hostOf(loc) {
    try {
      return lower(StringFn(loc.hostname || ""));
    } catch {
      return "";
    }
  }

  function onSafeHost(host) {
    for (let i = 0; i < SAFE_HOSTS.length; i++) {
      const d = SAFE_HOSTS[i];
      if (host === d || (host.length > d.length && apply(sSlice, host, [host.length - d.length - 1]) === "." + d)) return true;
    }
    return false;
  }

  function matchDangerous(text) {
    const s = typeof text === "string" ? text : (text == null ? "" : StringFn(text));
    if (s.length < 8) return null;
    const sample = s.length > 20000 ? apply(sSlice, s, [0, 20000]) : s;
    for (let i = 0; i < PATTERNS.length; i++) if (matches(PATTERNS[i].re, sample)) return PATTERNS[i].id;
    return null;
  }

  // Whitespace runs -> one space, trimmed (no regex, no page-replaceable methods).
  function squash(s) {
    const str = typeof s === "string" ? s : (s == null ? "" : StringFn(s));
    let out = "";
    let gap = false;
    for (let i = 0; i < str.length; i++) {
      const c = apply(sCharCodeAt, str, [i]);
      if (c <= 32 || c === 160 || c === 0x2028 || c === 0x2029) {
        gap = out.length > 0;
        continue;
      }
      if (gap) out += " ";
      gap = false;
      out += str[i];
    }
    return out;
  }

  // Did the visitor copy exactly this text themselves? last = the last copy
  // gesture: { kind: "key" | "menu", at, sel } where sel is the selection when
  // they pressed Ctrl/Cmd+C or opened the context menu. Any error means "no".
  function deliberateCopy(last, now, text) {
    try {
      if (!last) return false;
      const windowMs = last.kind === "menu" ? MENU_WINDOW_MS : KEY_WINDOW_MS;
      if (now - last.at > windowMs || now < last.at) return false;
      const want = squash(text);
      if (!want) return false;
      return contains(squash(last.sel), want);
    } catch {
      return false;
    }
  }

  // The object on the prototype chain that owns `key` (where a wrapper must
  // go so that no prototype further up still holds the native function).
  function ownerOf(obj, key) {
    for (let o = obj; o; o = getProto(o)) {
      if (apply(hasOwn, o, [key])) return o;
    }
    return null;
  }

  target.PATTERNS = PATTERNS;
  target.SAFE_HOSTS = SAFE_HOSTS;
  target.matchDangerous = matchDangerous;
  target.onSafeHost = onSafeHost;
  target.deliberateCopy = deliberateCopy;
  target.ownerOf = ownerOf;
  target.squash = squash;

  // Install the wrappers. env: { window, document, navigator, location, now(), notify(text), flagOn() }
  target.install = function install(env) {
    const win = env.window;
    const doc = env.document;
    const now = env.now || (() => apply(dateNow, Date, []));
    const flagOn = env.flagOn || (() => true);
    let lastCopy = null;
    let copyData = null; // clipboardData of the copy/cut event being dispatched

    // Native getters and methods, captured now (before page scripts).
    const getter = (proto, key) => {
      try {
        const d = proto && getOwnDesc(proto, key);
        return d && typeof d.get === "function" ? d.get : null;
      } catch {
        return null;
      }
    };
    const protoOf = (C) => (C && C.prototype) || null;
    const nativeGetSelection = typeof win.getSelection === "function" ? win.getSelection : null;
    const nativeSelectionText = protoOf(win.Selection) && typeof win.Selection.prototype.toString === "function" ? win.Selection.prototype.toString : null;
    const nativeActive = getter(protoOf(win.Document), "activeElement");
    const keyGet = getter(protoOf(win.KeyboardEvent), "key");
    const ctrlGet = getter(protoOf(win.KeyboardEvent), "ctrlKey");
    const metaGet = getter(protoOf(win.KeyboardEvent), "metaKey");
    const shiftGet = getter(protoOf(win.KeyboardEvent), "shiftKey");
    const codeGet = getter(protoOf(win.KeyboardEvent), "code");
    const clipboardDataGet = getter(protoOf(win.ClipboardEvent), "clipboardData");
    const preventDefaultFn = protoOf(win.Event) && typeof win.Event.prototype.preventDefault === "function" ? win.Event.prototype.preventDefault : null;
    const DOMExceptionCtor = typeof win.DOMException === "function" ? win.DOMException : (typeof DOMException === "function" ? DOMException : Error);
    const fieldGetters = [];
    const fieldCtors = [win.HTMLTextAreaElement, win.HTMLInputElement];
    for (let i = 0; i < fieldCtors.length; i++) {
      const p = protoOf(fieldCtors[i]);
      const g = { value: getter(p, "value"), start: getter(p, "selectionStart"), end: getter(p, "selectionEnd") };
      if (g.value && g.start && g.end) fieldGetters.push(g);
    }
    const read = (g, obj, name) => (g ? apply(g, obj, []) : obj[name]);
    const blocked = () => new DOMExceptionCtor("Write blocked by the browser's protection", "NotAllowedError");

    function selectionText() {
      try {
        const sel = nativeGetSelection ? apply(nativeGetSelection, win, []) : null;
        if (!sel) return "";
        return StringFn(nativeSelectionText ? apply(nativeSelectionText, sel, []) : sel);
      } catch {
        return "";
      }
    }
    function fieldSelection() {
      let active = null;
      try {
        active = nativeActive ? apply(nativeActive, doc, []) : doc.activeElement;
      } catch {
        return "";
      }
      if (!active) return "";
      for (let i = 0; i < fieldGetters.length; i++) {
        const g = fieldGetters[i];
        try {
          // Throws "Illegal invocation" unless active really is that kind of field.
          const v = apply(g.value, active, []);
          const s = apply(g.start, active, []);
          const e = apply(g.end, active, []);
          return typeof v === "string" && typeof s === "number" && typeof e === "number" ? apply(sSlice, v, [s, e]) : "";
        } catch {
          // not this kind of field
        }
      }
      if (fieldGetters.length) return "";
      // No native getters available (not a browser): plain properties.
      try {
        return typeof active.value === "string" && typeof active.selectionStart === "number" ? apply(sSlice, active.value, [active.selectionStart, active.selectionEnd]) : "";
      } catch {
        return "";
      }
    }

    // true = let it through.
    function allowed(text) {
      try {
        if (!flagOn()) return true;
        const hit = matchDangerous(text);
        if (!hit) return true;
        if (onSafeHost(hostOf(env.location))) return true;
        if (deliberateCopy(lastCopy, now(), text)) return true;
        if (env.notify) env.notify(hit);
        return false;
      } catch {
        return true;
      }
    }
    target.allowed = allowed;

    // Copy gestures, recorded by listeners on window (capture) added before any
    // page script: they run first, so the selection is the visitor's own.
    const listenOn = typeof win.addEventListener === "function" ? win : doc;
    try {
      listenOn.addEventListener("keydown", (e) => {
        try {
          if (!e || e.isTrusted !== true) return;
          // Copy and cut shortcuts: Ctrl/Cmd+C, Ctrl/Cmd+X, Ctrl+Insert,
          // Shift+Delete. On a non-Latin layout (Russian, Greek, ...) the
          // key is not "c" / "x", so the physical key (code) counts there.
          const key = lower(StringFn(read(keyGet, e, "key") || ""));
          const code = StringFn(read(codeGet, e, "code") || "");
          const latin = key.length === 1 && key >= "a" && key <= "z";
          const letter = latin ? key : (key.length === 1 ? (code === "KeyC" ? "c" : code === "KeyX" ? "x" : "") : "");
          const mod = !!(read(ctrlGet, e, "ctrlKey") || read(metaGet, e, "metaKey"));
          const copyKey = (mod && (letter === "c" || letter === "x")) || (mod && key === "insert") || (!!read(shiftGet, e, "shiftKey") && key === "delete");
          lastCopy = copyKey ? { kind: "key", at: now(), sel: selectionText() + "\n" + fieldSelection() } : null;
        } catch {
          lastCopy = null;
        }
      }, true);
      listenOn.addEventListener("contextmenu", (e) => {
        try {
          lastCopy = e && e.isTrusted === true ? { kind: "menu", at: now(), sel: selectionText() + "\n" + fieldSelection() } : lastCopy;
        } catch {
          lastCopy = null;
        }
      }, true);
      // The browser's own copy/cut of the selection (keyboard, menu, or the
      // copy event an execCommand("copy") fires): if the selection changed to
      // a command the visitor did not select, cancel the copy. Also remember
      // this event's clipboardData so setData is checked on it (and only on it,
      // not on drag-and-drop data).
      const onCopy = (e) => {
        try {
          copyData = clipboardDataGet ? apply(clipboardDataGet, e, []) : e && e.clipboardData;
          const sel = selectionText();
          const field = fieldSelection();
          if (!allowed(sel) || (field && field !== sel && !allowed(field))) {
            if (preventDefaultFn) apply(preventDefaultFn, e, []);
            else e.preventDefault();
          }
        } catch {
          // fail open
        }
      };
      listenOn.addEventListener("copy", onCopy, true);
      listenOn.addEventListener("cut", onCopy, true);
    } catch {
      // without gesture tracking every dangerous write outside safe hosts is held
    }

    const clip = env.navigator && env.navigator.clipboard;
    const clipOwner = clip && ownerOf(clip, "writeText");
    if (clipOwner && typeof clipOwner.writeText === "function") {
      try {
        const wrapped = new Proxy(clipOwner.writeText, {
          apply(fn, self, args) {
            if (args.length === 0) return apply(fn, self, args); // native error
            let text;
            try {
              text = StringFn(args[0]); // once: the checked string is the written one
            } catch (error) {
              return apply(promiseReject, PromiseCtor, [error]);
            }
            if (!allowed(text)) return apply(promiseReject, PromiseCtor, [blocked()]);
            return apply(fn, self, [text]);
          },
        });
        defineProp(clipOwner, "writeText", { value: wrapped, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    // clipboard.write([ClipboardItem]): text/plain and text/html parts are read
    // through the native ClipboardItem/Blob methods and checked before the
    // native write runs (follow-up review: this path was not covered).
    const writeOwner = clip && ownerOf(clip, "write");
    const ciProto = protoOf(win.ClipboardItem);
    const typesGet = getter(ciProto, "types");
    const getTypeFn = ciProto && typeof ciProto.getType === "function" ? ciProto.getType : null;
    const blobTextFn = protoOf(win.Blob) && typeof win.Blob.prototype.text === "function" ? win.Blob.prototype.text : null;
    if (writeOwner && typeof writeOwner.write === "function" && typesGet && getTypeFn && blobTextFn) {
      try {
        const wrappedWrite = new Proxy(writeOwner.write, {
          apply(fn, self, args) {
            const run = async () => {
              let verdict = true;
              try {
                if (flagOn() && !onSafeHost(hostOf(env.location))) {
                  const items = args[0];
                  const n = items ? items.length : 0;
                  for (let i = 0; i < n && verdict; i++) {
                    const item = items[i];
                    const types = apply(typesGet, item, []);
                    for (let j = 0; j < types.length && verdict; j++) {
                      const type = lower(StringFn(types[j]));
                      if (type !== "text/plain" && type !== "text/html") continue;
                      const blob = await apply(getTypeFn, item, [types[j]]);
                      verdict = allowed(await apply(blobTextFn, blob, []));
                    }
                  }
                }
              } catch {
                verdict = true; // not readable by us: the native call decides
              }
              if (!verdict) throw blocked();
              return apply(fn, self, args);
            };
            return run();
          },
        });
        defineProp(writeOwner, "write", { value: wrappedWrite, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    const execOwner = doc && ownerOf(doc, "execCommand");
    if (execOwner && typeof execOwner.execCommand === "function") {
      try {
        const wrappedExec = new Proxy(execOwner.execCommand, {
          apply(fn, self, args) {
            if (args.length === 0) return apply(fn, self, args); // native error
            const call = [];
            for (let i = 0; i < args.length; i++) call[i] = args[i];
            try {
              call[0] = StringFn(args[0]); // once
              const cmd = lower(call[0]);
              if (cmd === "copy" || cmd === "cut") {
                const sel = selectionText();
                const field = fieldSelection();
                if (!allowed(sel) || (field && field !== sel && !allowed(field))) return false;
              }
            } catch {
              // fail open
            }
            return apply(fn, self, call);
          },
        });
        defineProp(execOwner, "execCommand", { value: wrappedExec, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    // A page's copy handler can swap the copied text: check setData on the
    // clipboard data of the copy/cut event being dispatched (not on other
    // DataTransfer objects such as drag-and-drop data).
    const DT = win.DataTransfer;
    const dtOwner = DT && DT.prototype && ownerOf(DT.prototype, "setData");
    if (dtOwner && typeof dtOwner.setData === "function") {
      try {
        const wrappedSet = new Proxy(dtOwner.setData, {
          apply(fn, self, args) {
            if (args.length < 2 || self !== copyData) return apply(fn, self, args);
            const call = [];
            for (let i = 0; i < args.length; i++) call[i] = args[i];
            try {
              call[0] = StringFn(args[0]); // once each
              call[1] = StringFn(args[1]);
              const type = lower(call[0]);
              if ((type === "text/plain" || type === "text" || type === "text/html") && !allowed(call[1])) return undefined;
            } catch {
              // fail open
            }
            return apply(fn, self, call);
          },
        });
        defineProp(dtOwner, "setData", { value: wrappedSet, configurable: true, writable: true });
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
      const t = apply(dateNow, Date, []);
      if (t - shown < 3000) return;
      shown = t;
      const host = doc.createElement("div");
      const root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;
      const box = doc.createElement("div");
      box.setAttribute("role", "alert");
      box.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:360px;padding:12px 14px;border-radius:8px;background:#18181b;color:#efeff1;font:13px/1.4 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);border:1px solid #f0a33a";
      box.textContent = "Blocked: this page tried to put a command into your clipboard. If a page asks you to paste something into Run, PowerShell or a terminal to \"verify\" you, don't. If you meant to copy it yourself, select the text and press Ctrl+C.";
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
    // "Blocked something" ping for the toolbar dot, over the same private port
    // (postMessage captured now, before page scripts).
    const portPost = typeof MessagePort === "function" ? MessagePort.prototype.postMessage : null;
    const signal = () => {
      try {
        if (port) applyFn(portPost || port.postMessage, port, [{ g: "clipboard" }]);
      } catch {
        // no dot
      }
    };
    const notice = clipboardGuardNotice(document);
    const api = {};
    installClipboardGuard(api);
    api.install({ window, document, navigator, location, notify: (hit) => { notice(hit); signal(); }, flagOn: () => on });
  } catch {
    // guard not installed; the page works as before
  }
}
})();
