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
// DataTransfer.setData / DataTransferItemList.add (any DataTransfer, see
// below). Text that looks
// like a dangerous command is not written unless the visitor copied exactly
// that text themselves, or the site is on the known-safe list (documentation
// and code hosts). A small notice says why and how to copy on purpose.
//
// "Copied it themselves" (security review M-2 and its follow-up review): the
// text is part of the selection the visitor had when they pressed Ctrl/Cmd+C
// (or opened the context menu; that counts only for the browser's own copy
// event, never for a page-initiated write). The visitor must also have made
// that selection with a selection gesture, and it must be visible (review
// 2026-11-16 WP-05). A button labelled "Copy" does not count: a
// page can label, hide or fake anything it shows (opacity:0, off-screen text).
// The page runs in this same JavaScript world, so everything on the decision
// path is captured when this file runs (document_start, before any page
// script): built-ins (RegExp exec, string methods, Reflect.apply, Date.now,
// Promise.reject), the selection and form-field getters and the key-event
// getters. Values are turned into text once; the checked text is the one
// passed on. Wrappers sit on the prototype that owns each method.
// Every text write through DataTransfer setData / items.add is checked, on
// any DataTransfer (copy, cut, drag-and-drop or one the page made): a frame
// realm's methods called on this realm's clipboardData are then checked by
// that frame's guard too (final review 9, round 2). Only trusted copy/cut
// events count as copy events, and each event's clipboardData (and every
// items list read from it: Chrome returns a new list on each read, so the
// items getter is wrapped) remembers whether it is the browser's own copy.
// The browser's own copy (the only one a right-click "menu" gesture can
// authorise) is a trusted event that this realm's execCommand did not start
// AND that the browser dispatched with no script on the stack: microtasks run
// between two listeners only then (HTML "clean up after running script").
// So a copy event that page script starts, through any realm's execCommand
// (also a frame the guard has not reached yet), never counts as the menu
// Copy (final review 8). Checked in Chromium 156: microtasks run between
// listeners of trusted click/keydown, not of copy events from execCommand in
// a click handler, a timer, a bound timer or a frame realm; they do run
// between listeners of the copy event of a keyboard Ctrl+C (Playwright
// Chromium). UNVERIFIED: the copy event of the context-menu Copy (same
// browser path). Without queueMicrotask the old "not inside this realm's
// execCommand" rule is used.
// execCommand("copy"/"cut") on a document of another window is refused. A
// right-click gesture ends at the next trusted pointerdown or mousedown.
// Known limit (UNVERIFIED in Chrome): a same-origin frame the guard has not
// reached yet has native methods (writeText, setData, execCommand on its own
// document), so it is not checked at all; that is an injection-timing gap.
// The clipboard.write() check does not use `await`: it chains with the native
// Promise.prototype.then captured at load, and while the guard is on any
// error on that path blocks the write (fail closed, review 2026-11-16). A
// page getter on Promise.prototype.constructor made the old `await` path
// fail open (proven in Chrome).
// Fail-open: an error in the guard lets the original call through, but an
// error while judging "did the visitor copy it" counts as "no". An error from
// the page's own value (its toString throws) is not a guard error: it goes
// back to the page, and the native method is not called.
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
const promiseThen = Promise.prototype.then;
const getOwnDesc = Object.getOwnPropertyDescriptor;
const getProto = Object.getPrototypeOf;
const defineProp = Object.defineProperty;
const freeze = Object.freeze;
const symIterator = Symbol.iterator;
const hasOwn = Object.prototype.hasOwnProperty;
const WeakMapCtor = WeakMap;
const wmGet = WeakMap.prototype.get;
const wmSet = WeakMap.prototype.set;
const wmHas = WeakMap.prototype.has;

function installClipboardGuard(target) {
  // Commands people are tricked into running (patterns are case-insensitive).
  const PATTERNS = [
    // powershell.exe takes a switch after "/", "-", "--" or a Unicode dash
    // (en dash, em dash, horizontal bar), and any prefix of its name
    // (PowerShell CommandLineParameterParser: GetSwitchKey, MatchSwitch).
    { id: "powershell-encoded", re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,200}\s(?:\/|[-\u2013-\u2015]{1,2})(?:ec|e(?:n(?:c(?:o(?:d(?:e(?:d(?:c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?)?)?)?)?)?)?)?)\s+[A-Za-z0-9+/=]{16,}/i },
    { id: "powershell-download", re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,400}(?:\biex\b|invoke-expression|downloadstring|downloadfile|invoke-webrequest|\biwr\b|\birm\b|invoke-restmethod|net\.webclient|start-bitstransfer|frombase64string)/i },
    // WindowStyle 1 is Hidden.
    { id: "powershell-hidden", re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,200}\s(?:\/|[-\u2013-\u2015]{1,2})w(?:i(?:n(?:d(?:o(?:w(?:s(?:t(?:y(?:l(?:e)?)?)?)?)?)?)?)?)?)?\s+(?:h|hi|hid|hidd|hidde|hidden|1)\b/i },
    // Pipeline form "irm URL | iex" (curl/wget are PowerShell aliases too).
    { id: "download-pipe-iex", re: /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^\n|]{0,300}\|\s*(?:iex|invoke-expression)\b/i },
    { id: "iex-download", re: /\b(?:iex|invoke-expression)\b[^\n]{0,40}\(?\s*(?:iwr|irm|invoke-webrequest|invoke-restmethod|new-object\s+net\.webclient)/i },
    // Other switches can come before /c (cmd /q /c, cmd.exe /v:on /c), and
    // cmd/c needs no space.
    { id: "cmd-chain", re: /\bcmd(?:\.exe)?(?:\s*\/[a-bd-jl-z](?::[a-z]{1,3})?){0,4}\s*\/[ck]\b[^\n]{0,300}(?:mshta|curl|wget|bitsadmin|certutil|powershell|pwsh|rundll32|regsvr32|msiexec|start\s+\/min)/i },
    { id: "mshta", re: /\bmshta(?:\.exe)?\s+["']?(?:https?:|vbscript:|javascript:|\\\\)/i },
    { id: "bitsadmin", re: /\bbitsadmin(?:\.exe)?\s+\/transfer\b/i },
    { id: "certutil", re: /\bcertutil(?:\.exe)?\s+[^\n]{0,80}-urlcache\b/i },
    { id: "rundll32", re: /\brundll32(?:\.exe)?\s+[^\n]{0,80}(?:javascript:|https?:|\\\\)/i },
    // Remote files also come from a UNC path (\\host\share, WebDAV).
    { id: "regsvr32", re: /\bregsvr32(?:\.exe)?\s+[^\n]{0,40}\/i:\s*(?:https?:|\\\\)/i },
    { id: "msiexec-remote", re: /\bmsiexec(?:\.exe)?\s+[^\n]{0,40}\/(?:i|package)\s+["']?(?:https?:|\\\\)/i },
    { id: "powershell-unc-file", re: /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,200}\s(?:\/|[-\u2013-\u2015]{1,2})(?:f|fi|fil|file)\s+["']?\\\\/i },
    // Pipe to a shell, also by path (/bin/bash) and after sudo / nohup / env
    // (with up to three flags each). Every gap is bounded (linear matching).
    { id: "curl-pipe-shell", re: /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:(?:[^\s|]{0,100}\/)?(?:sudo|nohup|env)\s+(?:-[\w-]{1,20}\s+){0,3}){0,3}(?:[^\s|]{0,100}\/)?(?:ba|z|da|k)?sh\b/i },
    // Process substitution: bash <(curl -fsSL URL).
    { id: "shell-process-download", re: /\b(?:(?:ba|z|da|k)?sh|source)\s+<\(\s*(?:curl|wget)\b/i },
    // macOS form without a pipe: /bin/bash -c "$(curl -fsSL URL)".
    { id: "shell-c-download", re: /\b(?:ba|z|da)?sh\s+-c\s+["']?\$\(\s*(?:curl|wget)\b/i },
    // The same with a base64 payload: /bin/bash -c "$(echo ... | base64 -d)".
    { id: "shell-c-base64", re: /\b(?:ba|z|da)?sh\s+-c\s+["']?\$\([^)]{0,300}\bbase64\s+(?:-d|--decode|-D)\b/i },
    // Windows: finger user@host | cmd (the reply is run as commands).
    { id: "finger-pipe-cmd", re: /\bfinger(?:\.exe)?\b[^\n|]{0,100}\|\s*cmd\b/i },
    // A WebDAV path pasted into Run: \\host@SSL\..., \\host@80\..., DavWWWRoot.
    // A plain \\server\share path does not match.
    { id: "webdav-unc", re: /\\\\[^\\\s]{1,255}@(?:ssl|\d{1,5})(?:@\d{1,5})?\\|\bdavwwwroot\b/i },
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
    // The whole text: shells ignore leading padding, so a sample window could
    // hide a command. Every pattern uses bounded gaps, so this stays linear.
    for (let i = 0; i < PATTERNS.length; i++) if (matches(PATTERNS[i].re, s)) return PATTERNS[i].id;
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
    // clipboardData (and its items list) of every trusted copy/cut event seen
    // -> true when that event is the browser's own copy, false when it comes
    // from execCommand. Per object, not one slot: a nested copy event (from
    // the page's copy handler) must not take the check away from the outer one.
    const copyMap = new WeakMapCtor();
    const isObj = (o) => o !== null && (typeof o === "object" || typeof o === "function");
    const isCopyData = (o) => isObj(o) && apply(wmHas, copyMap, [o]);
    const copyKind = (o) => apply(wmGet, copyMap, [o]);
    let inExec = 0; // depth inside the wrapped execCommand("copy"/"cut")
    // Did the browser dispatch this event with no script on the stack? A
    // microtask queued by the first copy listener runs before the second one
    // only then. null without queueMicrotask (old engines, tests): not used.
    const queueMicro = typeof win.queueMicrotask === "function" ? win.queueMicrotask : null;
    let gapEvent = null;

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
    const defaultViewGet = getter(protoOf(win.Document), "defaultView");
    const itemsGet = getter(protoOf(win.DataTransfer), "items");
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
    // The native setData, captured before the wrapper below replaces it: the
    // guard writes the checked text of a copy with it (review 2026-11-16).
    const setDataOwner = protoOf(win.DataTransfer) && ownerOf(win.DataTransfer.prototype, "setData");
    const nativeSetData = setDataOwner && typeof setDataOwner.setData === "function" ? setDataOwner.setData : null;
    const inputTypeGet = getter(protoOf(win.HTMLInputElement), "type");
    // For the text a cut really copies: alt text and field values in the range.
    const selProto = protoOf(win.Selection);
    const rangeCountGet = getter(selProto, "rangeCount");
    const getRangeAtFn = selProto && typeof selProto.getRangeAt === "function" ? selProto.getRangeAt : null;
    const cloneContentsFn = protoOf(win.Range) && typeof win.Range.prototype.cloneContents === "function" ? win.Range.prototype.cloneContents : null;
    const firstChildGet = getter(protoOf(win.Node), "firstChild");
    const nextSiblingGet = getter(protoOf(win.Node), "nextSibling");
    const nodeTypeGet = getter(protoOf(win.Node), "nodeType");
    const charDataGet = getter(protoOf(win.CharacterData), "data");
    const localNameGet = getter(protoOf(win.Element), "localName");
    const getAttrFn = protoOf(win.Element) && typeof win.Element.prototype.getAttribute === "function" ? win.Element.prototype.getAttribute : null;
    const taValueGet = getter(protoOf(win.HTMLTextAreaElement), "value");
    const inValueGet = getter(protoOf(win.HTMLInputElement), "value");
    // Who made the selection, and can the visitor see it (WP-05).
    const buttonsGet = getter(protoOf(win.MouseEvent), "buttons");
    const rangeRectFn = protoOf(win.Range) && typeof win.Range.prototype.getBoundingClientRect === "function" ? win.Range.prototype.getBoundingClientRect : null;
    const elementRectFn = protoOf(win.Element) && typeof win.Element.prototype.getBoundingClientRect === "function" ? win.Element.prototype.getBoundingClientRect : null;
    const rectProto = protoOf(win.DOMRectReadOnly);
    const rectGet = { left: getter(rectProto, "left"), top: getter(rectProto, "top"), right: getter(rectProto, "right"), bottom: getter(rectProto, "bottom"), width: getter(rectProto, "width"), height: getter(rectProto, "height") };
    const innerWidthGet = getter(win, "innerWidth");
    const innerHeightGet = getter(win, "innerHeight");
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
    // Is the focused element a password field? Any error means "yes" (the
    // guard then writes nothing). Chrome fires no copy event there.
    function secretField() {
      try {
        const active = nativeActive ? apply(nativeActive, doc, []) : doc.activeElement;
        if (!active) return false;
        let type;
        try {
          type = inputTypeGet ? apply(inputTypeGet, active, []) : active.type;
        } catch {
          return false; // not an input element
        }
        return lower(StringFn(type || "")) === "password";
      } catch {
        return true;
      }
    }
    // Can the visitor see the selection (WP-05)? A box with a size that is at
    // least partly inside the viewport: the focused field's box when it has
    // a selection, else the box of one of the selected ranges. true when the
    // browser gives no way to tell (old engines, tests); an error means "no".
    // Known limit: text that is visible but disguised (opacity, colour, 1px
    // font) passes.
    function selectionVisible() {
      try {
        const vw = innerWidthGet ? apply(innerWidthGet, win, []) : undefined;
        const vh = innerHeightGet ? apply(innerHeightGet, win, []) : undefined;
        if (typeof vw !== "number" || typeof vh !== "number") return true;
        const shown = (r) => {
          const left = read(rectGet.left, r, "left");
          const top = read(rectGet.top, r, "top");
          const right = read(rectGet.right, r, "right");
          const bottom = read(rectGet.bottom, r, "bottom");
          const width = read(rectGet.width, r, "width");
          const height = read(rectGet.height, r, "height");
          return width > 0 && height > 0 && right > 0 && bottom > 0 && left < vw && top < vh;
        };
        if (fieldSelection()) {
          if (!elementRectFn) return true;
          const active = nativeActive ? apply(nativeActive, doc, []) : doc.activeElement;
          return !!active && shown(apply(elementRectFn, active, []));
        }
        if (!nativeGetSelection || !rangeCountGet || !getRangeAtFn || !rangeRectFn) return true;
        const sel = apply(nativeGetSelection, win, []);
        if (!sel) return true;
        const n = apply(rangeCountGet, sel, []);
        if (!n) return true; // nothing selected: nothing to protect
        for (let i = 0; i < n; i++) {
          if (shown(apply(rangeRectFn, apply(getRangeAtFn, sel, [i]), []))) return true;
        }
        return false;
      } catch {
        return false;
      }
    }
    // The selected ranges as Chrome's text/plain copy has them: text, plus the
    // alt text of images and the values of text fields inside the ranges
    // (Selection.toString() leaves those out). Read from a clone through
    // getters captured at load. "" when not available (the check then uses
    // the selection text only). Bounded, so a huge selection stays cheap.
    function rangesText() {
      try {
        if (!nativeGetSelection || !rangeCountGet || !getRangeAtFn || !cloneContentsFn || !firstChildGet || !nextSiblingGet || !nodeTypeGet || !charDataGet || !localNameGet || !getAttrFn) return "";
        const sel = apply(nativeGetSelection, win, []);
        if (!sel) return "";
        const n = apply(rangeCountGet, sel, []);
        let out = "";
        let budget = 20000; // nodes
        for (let i = 0; i < n && budget > 0; i++) {
          // A plain index stack (no page-replaceable Array methods).
          const stack = [apply(cloneContentsFn, apply(getRangeAtFn, sel, [i]), [])];
          let top = 1;
          while (top > 0 && budget-- > 0) {
            const node = stack[--top];
            const t = apply(nodeTypeGet, node, []);
            if (t === 3) {
              out += apply(charDataGet, node, []);
            } else if (t === 1) {
              const name = apply(localNameGet, node, []);
              if (name === "img" || name === "area") out += StringFn(apply(getAttrFn, node, ["alt"]) || "");
              else if (name === "textarea" && taValueGet) out += "\n" + apply(taValueGet, node, []) + "\n";
              else if (name === "input" && inValueGet) {
                const it = lower(StringFn(apply(getAttrFn, node, ["type"]) || ""));
                if (it === "image") out += StringFn(apply(getAttrFn, node, ["alt"]) || "");
                else if (it !== "password" && it !== "hidden") out += "\n" + apply(inValueGet, node, []) + "\n";
              }
            }
            // Children in document order: push the last child first.
            const kids = [];
            let nk = 0;
            for (let c = apply(firstChildGet, node, []); c && nk < budget; c = apply(nextSiblingGet, c, [])) kids[nk++] = c;
            for (let k = nk - 1; k >= 0; k--) stack[top++] = kids[k];
          }
        }
        return out;
      } catch {
        return "";
      }
    }

    // true = let it through. nativeCopy: the check is for the browser's own
    // copy/cut event. A context-menu gesture (right-click) authorises only that
    // native copy, never a page-initiated write: opening the menu is not a copy,
    // and the page can set the selection itself.
    function allowed(text, nativeCopy) {
      try {
        if (!flagOn()) return true;
        const hit = matchDangerous(text);
        if (!hit) return true;
        if (onSafeHost(hostOf(env.location))) return true;
        // A gesture on a selection that the visitor did not make, or cannot
        // see, never counts (WP-05).
        const last = lastCopy && (lastCopy.kind !== "menu" || nativeCopy === true) && lastCopy.user !== false ? lastCopy : null;
        if (deliberateCopy(last, now(), text)) return true;
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
    const addListener = listenOn.addEventListener;
    const removeListener = listenOn.removeEventListener;
    // Did the visitor make the current selection (WP-05, review 2026-11-16)?
    // A page can select a hidden command and ask the visitor to press Ctrl+C.
    // Every selection change fires a trusted "selectionchange", also a change
    // made by page script. It counts as the visitor's when a selection
    // gesture came in the last 500 ms: a press, move with a button down, or
    // release of a pointer button, a double click, Shift with a navigation
    // key, or Ctrl/Cmd+A. null = no selectionchange seen yet (old engines,
    // tests): not known, the old rule is used. Known limit: a page listener
    // on such a gesture (a click handler) can still set the selection inside
    // the 500 ms; the visibility check then still applies.
    let userSel = null;
    let lastSelInput = -1e15;
    const SEL_INPUT_MS = 500;
    const visitorSelection = () => userSel !== false && selectionVisible();
    try {
      const pointerInput = (e) => {
        try {
          if (e && e.isTrusted === true) lastSelInput = now();
        } catch {
          // not counted
        }
      };
      for (const t of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick"]) listenOn.addEventListener(t, pointerInput, true);
      const moveInput = (e) => {
        try {
          if (e && e.isTrusted === true && read(buttonsGet, e, "buttons")) lastSelInput = now();
        } catch {
          // not counted
        }
      };
      listenOn.addEventListener("pointermove", moveInput, true);
      listenOn.addEventListener("mousemove", moveInput, true);
      listenOn.addEventListener("keydown", (e) => {
        try {
          if (!e || e.isTrusted !== true) return;
          const key = lower(StringFn(read(keyGet, e, "key") || ""));
          const mod = !!(read(ctrlGet, e, "ctrlKey") || read(metaGet, e, "metaKey"));
          const nav = key === "arrowleft" || key === "arrowright" || key === "arrowup" || key === "arrowdown" || key === "home" || key === "end" || key === "pageup" || key === "pagedown";
          const code = StringFn(read(codeGet, e, "code") || "");
          if ((nav && read(shiftGet, e, "shiftKey")) || (mod && (key === "a" || code === "KeyA"))) lastSelInput = now();
        } catch {
          // not counted
        }
      }, true);
      listenOn.addEventListener("selectionchange", (e) => {
        try {
          if (e && e.isTrusted === true) {
            const t = now();
            userSel = t >= lastSelInput && t - lastSelInput <= SEL_INPUT_MS;
          }
        } catch {
          userSel = false;
        }
      }, true);
    } catch {
      // no tracking: the old rule
    }
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
          lastCopy = copyKey ? { kind: "key", at: now(), sel: selectionText() + "\n" + fieldSelection(), user: visitorSelection() } : null;
        } catch {
          lastCopy = null;
        }
      }, true);
      listenOn.addEventListener("contextmenu", (e) => {
        try {
          lastCopy = e && e.isTrusted === true ? { kind: "menu", at: now(), sel: selectionText() + "\n" + fieldSelection(), user: visitorSelection() } : lastCopy;
        } catch {
          lastCopy = null;
        }
      }, true);
      // A right-click authorises only the menu "Copy" that follows it. Choosing
      // an item in the browser's menu sends no event to the page, so the next
      // press of a pointer button ends the gesture (never the up events: on
      // macOS "contextmenu" fires before mouseup).
      const endMenu = (e) => {
        try {
          if (e && e.isTrusted === true && lastCopy && lastCopy.kind === "menu") lastCopy = null;
        } catch {
          lastCopy = null;
        }
      };
      listenOn.addEventListener("pointerdown", endMenu, true);
      listenOn.addEventListener("mousedown", endMenu, true);
      // The browser's own copy/cut of the selection (keyboard, menu, or the
      // copy event an execCommand("copy") fires): if the selection changed to
      // a command the visitor did not select, cancel the copy. Also remember
      // this event's clipboardData so setData is checked on it (and only on it,
      // not on drag-and-drop data).
      const markCopy = (e) => {
        try {
          if (!queueMicro || !e || e.isTrusted !== true) return;
          gapEvent = null;
          apply(queueMicro, win, [() => { gapEvent = e; }]);
        } catch {
          // no microtask: onCopy treats the event as page-initiated
        }
      };
      const cancel = (e) => {
        if (preventDefaultFn) apply(preventDefaultFn, e, []);
        else e.preventDefault();
      };
      // The visitor's own cut (Ctrl+X) keeps the browser's cut, so the text
      // is still removed. A page listener that runs after onCopy can change
      // the selection, so it is checked again (with alt text and field
      // values) by a listener added now: it runs last in the bubble phase
      // on window. Known limit (UNVERIFIED in practice): a page that stops
      // the event's propagation, or adds its own bubble listener on window
      // during the dispatch, is not seen by that second check.
      const recheckCut = (e, copyNative) => {
        const again = (ev) => {
          try {
            apply(removeListener, listenOn, ["cut", again, false]);
          } catch {
            // stays; it only acts on its own event
          }
          if (ev !== e) return;
          try {
            const s = selectionText();
            const f = fieldSelection();
            const x = rangesText();
            if (!allowed(s, copyNative) || (f && f !== s && !allowed(f, copyNative)) || (x && !allowed(x, copyNative))) cancel(ev);
          } catch {
            // fail open
          }
        };
        apply(addListener, listenOn, ["cut", again, false]);
      };
      const onCopyFor = (isCut) => (e) => {
        try {
          // A synthetic event writes nothing to the clipboard: ignore it. In
          // Chrome isTrusted is an unforgeable own property of each event.
          if (!e || e.isTrusted !== true) return;
          const copyNative = inExec === 0 && (!queueMicro || gapEvent === e);
          gapEvent = null;
          const data = clipboardDataGet ? apply(clipboardDataGet, e, []) : e.clipboardData;
          if (isObj(data)) {
            apply(wmSet, copyMap, [data, copyNative]);
            try {
              const items = itemsGet ? apply(itemsGet, data, []) : data.items;
              if (isObj(items)) apply(wmSet, copyMap, [items, copyNative]);
            } catch {
              // no items list
            }
          }
          const sel = selectionText();
          const field = fieldSelection();
          if (!allowed(sel, copyNative) || (field && field !== sel && !allowed(field, copyNative))) {
            cancel(e);
            return;
          }
          if (!flagOn() || onSafeHost(hostOf(env.location))) return;
          if (isCut && copyNative) {
            const x = rangesText();
            if (x && !allowed(x, copyNative)) cancel(e);
            else recheckCut(e, copyNative);
            return;
          }
          // The checked text is the copied text (review 2026-11-16): a page
          // listener that runs later can change the selection or a field's
          // selection range, and Selection.toString() leaves out alt text
          // and field values that the browser's own copy puts in. So the
          // browser does not serialise the selection: the guard cancels the
          // event and writes the text it checked (the focused field's slice,
          // else the selection) as text/plain with the native setData. No
          // text/html. A page listener that runs later can still write its
          // own data; that goes through the setData / items.add check. A
          // page-started cut (execCommand) is copied the same way, so it
          // does not remove the text. An empty text writes nothing (the
          // clipboard stays as it was, as with the browser's own empty copy).
          if (!isObj(data) || !nativeSetData) return;
          cancel(e);
          const text = field || sel;
          if (text && !secretField()) apply(nativeSetData, data, ["text/plain", text]);
        } catch {
          // fail open
        }
      };
      // markCopy first, onCopy right after it (same target and phase, added in
      // this order before any page script).
      listenOn.addEventListener("copy", markCopy, true);
      listenOn.addEventListener("copy", onCopyFor(false), true);
      listenOn.addEventListener("cut", markCopy, true);
      listenOn.addEventListener("cut", onCopyFor(true), true);
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
            if (args.length === 0) return apply(fn, self, args); // native error
            // One synchronous snapshot, taken the way the native sequence
            // conversion reads it (the iterator). The checked items are the
            // written ones: the native write gets this private, frozen list,
            // so neither a custom iterator nor a swap during the awaits counts.
            const list = [];
            try {
              let n = 0;
              for (const it of args[0]) defineProp(list, n++, { value: it, writable: false, enumerable: true, configurable: false });
              const len = n;
              defineProp(list, symIterator, {
                value() {
                  let i = 0;
                  return { next: () => (i < len ? { value: list[i++], done: false } : { value: undefined, done: true }) };
                },
              });
              freeze(list);
            } catch (error) {
              return apply(promiseReject, PromiseCtor, [error]);
            }
            const call = [list];
            for (let i = 1; i < args.length; i++) call[i] = args[i];
            // No `await` (review 2026-11-16): `await` reads promise.constructor,
            // and a page getter there could throw or hand the check a harmless
            // Blob through its own `then`. The parts are chained with the
            // native then (captured at load). Any error while the guard is on
            // blocks the write (fail closed); with the switch off, on a safe
            // host, or when the switch itself throws, the native call decides.
            return new PromiseCtor((resolve, reject) => {
              const finish = (ok) => {
                if (!ok) {
                  reject(blocked());
                  return;
                }
                try {
                  resolve(apply(fn, self, call));
                } catch (error) {
                  reject(error);
                }
              };
              let active = false;
              try {
                active = flagOn() && !onSafeHost(hostOf(env.location));
              } catch {
                active = false;
              }
              const failed = () => finish(!active);
              if (!active) {
                finish(true);
                return;
              }
              // The text parts to check, as [item, type] pairs (index access
              // only: no page-replaceable Array iterator).
              const parts = [];
              try {
                const n = list.length;
                for (let i = 0; i < n; i++) {
                  const item = list[i];
                  const types = apply(typesGet, item, []);
                  for (let j = 0; j < types.length; j++) {
                    const type = lower(StringFn(types[j]));
                    if (type === "text/plain" || type === "text/html") parts[parts.length] = [item, types[j]];
                  }
                }
              } catch {
                failed();
                return;
              }
              let k = 0;
              const next = () => {
                if (k >= parts.length) {
                  finish(true);
                  return;
                }
                const part = parts[k++];
                try {
                  apply(promiseThen, apply(getTypeFn, part[0], [part[1]]), [(blob) => {
                    try {
                      apply(promiseThen, apply(blobTextFn, blob, []), [(text) => {
                        if (allowed(text)) next();
                        else finish(false);
                      }, failed]);
                    } catch {
                      failed();
                    }
                  }, failed]);
                } catch {
                  failed();
                }
              };
              next();
            });
          },
        });
        defineProp(writeOwner, "write", { value: wrappedWrite, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    // Is `d` a document of this window? Compared by window, not by document:
    // a window can get a new document (initial about:blank, then a same-origin
    // page) and keep this realm. Any error means "no".
    function sameWindow(d) {
      try {
        if (defaultViewGet) return apply(defaultViewGet, d, []) === win;
        return d === doc;
      } catch {
        return false;
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
            // Once, outside the fail-open block: when the page's own value
            // throws, the error goes back to the page and the native method
            // never converts that value a second time (review 2026-11-16).
            call[0] = StringFn(args[0]);
            try {
              const cmd = lower(call[0]);
              if (cmd === "copy" || cmd === "cut") {
                const sel = selectionText();
                const field = fieldSelection();
                if (!allowed(sel) || (field && field !== sel && !allowed(field))) return false;
                // A document of another window (a same-origin frame's realm used
                // on this document, or this realm used on a frame's document):
                // its copy event would not see this realm's inExec mark and would
                // count as the browser's own copy. Refused.
                if (flagOn() && !sameWindow(self)) return false;
              }
            } catch {
              // fail open
            }
            inExec++;
            try {
              return apply(fn, self, call);
            } finally {
              inExec--;
            }
          },
        });
        defineProp(execOwner, "execCommand", { value: wrappedExec, configurable: true, writable: true });
      } catch {
        // stays native
      }
    }

    // Chrome returns a new DataTransferItemList on every read of .items, so
    // the list a copy handler gets is marked here, with its DataTransfer's kind.
    const DT = win.DataTransfer;
    const itemsOwner = DT && DT.prototype && ownerOf(DT.prototype, "items");
    const itemsDesc = itemsOwner && getOwnDesc(itemsOwner, "items");
    if (itemsDesc && typeof itemsDesc.get === "function" && itemsDesc.configurable) {
      try {
        const wrappedItems = new Proxy(itemsDesc.get, {
          apply(fn, self, args) {
            const list = apply(fn, self, args);
            try {
              if (isCopyData(self) && isObj(list)) apply(wmSet, copyMap, [list, copyKind(self)]);
            } catch {
              // unmarked: still checked, as a page-initiated write
            }
            return list;
          },
        });
        defineProp(itemsOwner, "items", { get: wrappedItems, set: itemsDesc.set, enumerable: itemsDesc.enumerable, configurable: true });
      } catch {
        // stays native
      }
    }
    // Is `o` the clipboardData (or an items list of it) of the browser's own
    // copy/cut event? Only then can a right-click gesture authorise the write.
    const nativeCopyData = (o) => isCopyData(o) && copyKind(o) === true;

    // A page's copy handler can swap the copied text. Checked on every
    // DataTransfer, not only on this realm's copy-event data: a frame realm's
    // setData called on this realm's clipboardData (or ours on a frame's) is
    // otherwise not seen by the guard that knows the event (review round 2).
    // Drag-and-drop data with a command is a ClickFix route as well.
    const dtOwner = DT && DT.prototype && ownerOf(DT.prototype, "setData");
    if (dtOwner && typeof dtOwner.setData === "function") {
      try {
        const wrappedSet = new Proxy(dtOwner.setData, {
          apply(fn, self, args) {
            if (args.length < 2) return apply(fn, self, args);
            const call = [];
            for (let i = 0; i < args.length; i++) call[i] = args[i];
            // Once each, in the native order, outside the fail-open block (a
            // throwing value is never passed on to be converted again).
            call[0] = StringFn(args[0]);
            call[1] = StringFn(args[1]);
            try {
              const type = lower(call[0]);
              if ((type === "text/plain" || type === "text" || type === "text/html") && !allowed(call[1], nativeCopyData(self))) return undefined;
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

    // The same data can be written with clipboardData.items.add(string, type):
    // checked like setData, on every item list. add(File) has one argument.
    const DTIL = win.DataTransferItemList;
    const addOwner = DTIL && DTIL.prototype && ownerOf(DTIL.prototype, "add");
    if (addOwner && typeof addOwner.add === "function") {
      try {
        const wrappedAdd = new Proxy(addOwner.add, {
          apply(fn, self, args) {
            if (args.length < 2) return apply(fn, self, args);
            const call = [];
            for (let i = 0; i < args.length; i++) call[i] = args[i];
            // Once each, in the native order, outside the fail-open block.
            call[0] = StringFn(args[0]);
            call[1] = StringFn(args[1]);
            try {
              const type = lower(call[1]);
              if ((type === "text/plain" || type === "text" || type === "text/html") && !allowed(call[0], nativeCopyData(self))) return null;
            } catch {
              // fail open
            }
            return apply(fn, self, call);
          },
        });
        defineProp(addOwner, "add", { value: wrappedAdd, configurable: true, writable: true });
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
