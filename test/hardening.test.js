// Block I: no page-writable option channels, no web-accessible resources,
// no product-named markers in the page, diagnostic logging off by default.
import manifest from "../manifest.json" with { type: "json" };
import { withYtOpts, withUboOpts } from "./fixtures/source-opts.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const read = (p) => Deno.readTextFileSync(new URL("../" + p, import.meta.url));
const code = (src) => src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// Project-owned scripts that run in pages (MAIN or ISOLATED world).
const OWNED_PAGE = ["src/youtube.js", "src/kick.js", "src/cosmetic.js", "src/twitch-directory-ads.js", "src/settings/flags.js", "src/settings/features.js", "src/general/cosmetic-parse.js"];
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
