// Block 4: the popup follows the design rules (update 2026-11-02):
// header with icon, name and gear; site; one plain status line; "Something
// broke? / Fix this site"; Allow this site / Block again; folded Show more.
// No jargon, no animation, no counters, keyboard and contrast friendly.
import popupHtml from "../src/popup.html" with { type: "text" };
import popupCss from "../src/popup.css" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import flagsSource from "../src/settings/flags.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }

Deno.test("popup layout: header, site, status, Fix card, Allow button, folded Show more", () => {
  const order = ['id="brand-icon"', 'id="product"', 'id="open-settings"', 'id="site-host"', 'id="site-status"', "Something broke?", 'id="fix-site"', 'id="allow-site"', "<details", "<summary>Show more</summary>"];
  let at = -1;
  for (const s of order) {
    const i = popupHtml.indexOf(s);
    assert(i > at, "order: " + s);
    at = i;
  }
  assert(!/<details[^>]*\bopen\b/.test(popupHtml), "Show more is folded by default");
  assert(/<h1 id="product">Gecko Adblock<\/h1>/.test(popupHtml), "product name");
  assert(/id="open-settings"[^>]*aria-label="Settings"/.test(popupHtml), "gear has a label");
  assert(/<img id="brand-icon"[^>]*alt=""/.test(popupHtml), "decorative icon");
  assert([...popupHtml.matchAll(/<script\b/g)].length === 1 && popupHtml.includes('<script src="popup.js"></script>'), "only popup.js");
  assert(popupHtml.includes('<link rel="stylesheet" href="popup.css">'), "stylesheet");
  assert(/id="site-status"[^>]*role="status"/.test(popupHtml), "status announced");
});

Deno.test("popup words: plain status lines, no jargon, no counters", () => {
  for (const s of ["✅ Protected", "Allowed – not blocking here", "Fix this site", "Did that fix it?", "Allow this site", "Block again", "You're protected"]) {
    assert(popupHtml.includes(s) || popupSource.includes(s), "missing: " + s);
  }
  for (const s of ["streams untouched", "streams unchanged", "ads snapped", "DNR", "ruleset", "declarativeNetRequest"]) {
    assert(!popupHtml.includes(s) && !popupSource.includes(s), "jargon or counter: " + s);
  }
  assert(!manifest.permissions.includes("declarativeNetRequestFeedback"), "no counting permission");
});

Deno.test("popup CSS: no animation, visible focus, automatic and manual high contrast, forced colours", () => {
  const css = popupCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert(!/transition|animation|@keyframes/.test(css), "no animation");
  assert(/:focus-visible\s*\{[^}]*outline:/.test(popupCss), "focus ring");
  assert(/@media \(prefers-contrast: more\)/.test(popupCss) && /:root\[data-theme="contrast"\]/.test(popupCss), "high contrast, auto and manual");
  assert(/@media \(forced-colors: active\)/.test(popupCss) && /Canvas/.test(popupCss), "forced colours use system colours");
  assert(!/@import|url\(/.test(popupCss), "no fonts or images from CSS");
});

Deno.test("guard pings: flags.js forwards only {g: clipboard|popup}, rate-limited, never settings", () => {
  assert(/ch\.port1\.onmessage = onGuardPing;/.test(flagsSource), "port1 listens for pings");
  assert(/d\.g !== "clipboard" && d\.g !== "popup"/.test(flagsSource) && /now - lastPing < 2000/.test(flagsSource), "shape check and rate limit");
  assert(/type: "guardEvent", kind: d\.g/.test(flagsSource), "forwards only the kind");
});
