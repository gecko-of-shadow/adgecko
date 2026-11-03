// Block I: no page-writable option channels, no web-accessible resources,
// no product-named markers in the page, diagnostic logging off by default.
import manifest from "../manifest.json" with { type: "json" };
import { withYtOpts, withUboOpts } from "./fixtures/source-opts.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const read = (p) => Deno.readTextFileSync(new URL("../" + p, import.meta.url));
const code = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// Project-owned scripts that run in pages (MAIN or ISOLATED world).
const OWNED_PAGE = ["src/youtube.js", "src/kick.js", "src/cosmetic.js", "src/twitch-directory-ads.js", "src/settings/flags.js", "src/settings/features.js", "src/general/cosmetic-parse.js", "src/guards/clipboard.js", "src/guards/popups.js"];
// Generated from uBO by scripts/sync-ubo-youtube.mjs (never hand-edited).
const GENERATED = ["src/vendor/ubo-youtube.js", "src/vendor/ubo-youtube-isolated.js"];

Deno.test("no options are read from page-writable localStorage (owned scripts and the generated uBO bundle)", () => {
  for (const f of OWNED_PAGE.concat(GENERATED)) {
    const c = code(read(f));
    assert(!/localStorage\.getItem|localStorage\[/.test(c), f + " reads localStorage");
  }
  assert(!/self\.localStorage/.test(read("scripts/sync-ubo-youtube.mjs")), "generator no longer emits a localStorage read");
  // The defaults still apply: rmnt and domBypass off, the rest on.
  const bundle = read("src/vendor/ubo-youtube.js");
  assert(/const defaults = \{"rmnt":false,"domBypass":false\};\r?\n\s*return \(key\) => defaults\[key\] !== false;/.test(bundle), "built-in group defaults only");
  // Test harnesses inject options into the source instead.
  assert(/Object\.assign\(\{ noAdFlag/.test(withYtOpts(read("src/youtube.js"), { stallReload: false })), "youtube.js option injection for tests");
  assert(/Object\.assign\(\{"rmnt":false,"domBypass":false\}, \{"rmnt":true\}\)/.test(withUboOpts(bundle, { rmnt: true })), "uBO option injection for tests");
});

Deno.test("no web-accessible resources: the fallback hide sheet comes from the worker by message", () => {
  assert(!manifest.web_accessible_resources || manifest.web_accessible_resources.length === 0, "web_accessible_resources present");
  const cos = read("src/cosmetic.js");
  assert(cos.includes('type: "cosmeticCss"'), "cosmetic.js asks the worker");
  const bg = read("src/general-background.js");
  const i = bg.indexOf('message.type === "cosmeticCss"');
  assert(i > 0 && i < bg.indexOf("if (sender.tab) {"), "worker answers content scripts (read-only), before the tab check");
});

Deno.test("no product-named markers in pages: neutral Symbol.for ids, DOM ids and no marker properties", () => {
  for (const f of OWNED_PAGE.concat(GENERATED)) {
    const c = code(read(f));
    assert(!/Symbol\.for\(["']twitch-adblock/.test(c), f + " uses a product-named Symbol.for");
    assert(!/\.id = "twitch-adblock|getElementById\("twitch-adblock|STYLE_ID = "twitch-adblock/.test(c), f + " uses a product-named DOM id");
    assert(!/__kickAdblock|__twitchAdblock/.test(c), f + " sets a marker property on page objects");
  }
  assert(read("src/youtube.js").includes('Symbol.for("gk.y")') && read("src/youtube.js").includes('Symbol.for("gk.u")'), "youtube.js neutral ids");
  assert(read("src/vendor/ubo-youtube.js").includes('Symbol.for("gk.u")') && read("src/vendor/ubo-youtube-isolated.js").includes('Symbol.for("gk.ui")'), "bundle neutral ids");
});

Deno.test("diagnostic logging is off by default in the page", () => {
  const yt = read("src/youtube.js");
  assert(/ diag: false, /.test(yt), "youtube.js OPTS.diag defaults to false");
  for (const line of code(yt).split("\n")) {
    if (!/console\.log\(/.test(line)) continue;
    assert(/OPTS\.diag\)|if \(!OPTS\.diag\) return;|^\s*console\.log\("twitch-adblock: \[\+" \+ \(Date\.now\(\) - navAt\)/.test(line), "ungated youtube.js log: " + line.trim());
  }
  const kick = code(read("src/kick.js"));
  assert(/const DEBUG = false;/.test(kick), "kick.js DEBUG off");
  assert((kick.match(/console\.log\(/g) || []).length === 1, "kick.js logs only through debugLog");
});

Deno.test("the vendored Twitch file is untouched (its AuthorizationHeader switch is listed for the owner)", () => {
  const v = read("src/vendor/video-swap-new.user.js");
  assert(v.includes("ourTwitchAdSolutionsVersion = 23") && v.includes("scope.AuthorizationHeader = undefined;"), "vendored file unchanged");
});

// Security review L-18: the extension's own MAIN-world files add no globals
// to the page (each is one `(() => { ... })();`).
Deno.test("own MAIN-world scripts add no page globals (one IIFE each)", () => {
  const mainOwned = [...new Set(manifest.content_scripts.filter((c) => c.world === "MAIN").flatMap((c) => c.js).filter((f) => !f.startsWith("src/vendor/")))];
  assert(mainOwned.sort().join() === ["src/guards/clipboard.js", "src/guards/popups.js", "src/kick.js", "src/youtube.js"].join(), mainOwned.join());
  for (const f of mainOwned) {
    const src = read(f);
    const lines = src.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\/\//.test(l));
    assert(lines[0] === "(() => {" && lines.at(-1) === "})();", f + " is not wrapped in one IIFE");
    // Evaluate as a classic script in the global scope (indirect eval): no new
    // global names appear. (No window/document here, so nothing starts.)
    const before = new Set(Object.getOwnPropertyNames(globalThis));
    (0, eval)(src);
    const added = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
    assert(added.length === 0, f + " adds globals: " + added.join());
  }
});

// Security review M-2: blank / srcdoc / blob: frames of ordinary sites get the
// guards (and their flag script), so a page cannot copy through a pristine
// same-origin frame; stream sites stay excluded.
Deno.test("guards and their flag script also run in about:blank-style frames of ordinary sites only", () => {
  const entries = manifest.content_scripts.filter((c) => c.js.includes("src/guards/clipboard.js") || (c.js.includes("src/settings/flags.js") && c.matches.includes("https://*/*")));
  assert(entries.length === 2, "guard + flags entries");
  for (const e of entries) {
    assert(e.match_about_blank === true && e.match_origin_as_fallback === true, "blank-frame matching on " + e.js.join());
    assert(e.matches.every((m) => /^https?:\/\/\*\/\*$/.test(m)), "match_origin_as_fallback needs /* paths");
    for (const host of ["twitch.tv", "youtube.com", "kick.com", "googlevideo.com"]) assert(e.exclude_matches.includes("*://*." + host + "/*"), host + " excluded");
  }
  for (const c of manifest.content_scripts.filter((x) => !entries.includes(x))) {
    assert(!c.match_about_blank && !c.match_origin_as_fallback, "only the guard entries match blank frames: " + c.js.join());
  }
});
