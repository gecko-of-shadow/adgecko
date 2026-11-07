// Block 4: the popup follows the design rules (update 2026-11-02):
// header with icon, name and gear; site; one plain status line; "Something
// broke? / Fix this site"; Allow this site / Block again; folded Show more.
// No jargon, no animation, no counters, keyboard and contrast friendly.
import popupHtml from "../src/popup.html" with { type: "text" };
import popupCss from "../src/popup.css" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import flagsSource from "../src/settings/flags.js" with { type: "text" };
import settingsHtml from "../src/settings.html" with { type: "text" };
import settingsSource from "../src/settings.js" with { type: "text" };
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
  assert(/<h1 id="product">Adgecko<\/h1>/.test(popupHtml), "product name");
  assert(/id="open-settings"[^>]*aria-label="Settings"/.test(popupHtml), "gear has a label");
  assert(/<img id="brand-icon"[^>]*alt=""/.test(popupHtml), "decorative icon");
  assert([...popupHtml.matchAll(/<script\b/g)].length === 1 && popupHtml.includes('<script src="popup.js"></script>'), "only popup.js");
  assert(popupHtml.includes('<link rel="stylesheet" href="popup.css">'), "stylesheet");
  assert(/id="site-status"[^>]*role="status"/.test(popupHtml), "status announced");
});

Deno.test("popup words: plain status lines, no jargon, no counters", () => {
  const code = popupSource.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ""); // a comment does not show on screen
  for (const s of ["✅ Protected", "Allowed – not blocking here", "Fix this site", "Did that fix it?", "Allow this site", "Block again", "You're protected"]) {
    assert(popupHtml.includes(s) || code.includes(s), "missing: " + s);
  }
  for (const s of ["streams untouched", "streams unchanged", "ads snapped", "DNR", "ruleset", "declarativeNetRequest"]) {
    const low = s.toLowerCase();
    assert(!popupHtml.toLowerCase().includes(low) && !popupSource.toLowerCase().includes(low), "jargon or counter: " + s);
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

// 2026-11-03 alignment with docs/design/popup-single.jpg and popup-high-contrast.jpg.
const rule = (css, sel) => {
  const m = css.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp("(?:^|\\})\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"));
  return m ? m[1] : "";
};

Deno.test("popup matches the mockups: bigger header icon, Block again outlined in the accent, Show more chevron after the text", () => {
  assert(/<img id="brand-icon"[^>]*width="40" height="40"/.test(popupHtml) && /width:\s*40px/.test(rule(popupCss, "#brand-icon")), "40 px header icon");
  const pressed = rule(popupCss, 'button.primary[aria-pressed="true"]');
  assert(/background:\s*transparent/.test(pressed) && /color:\s*var\(--outline\)/.test(pressed), "Block again: outline + accent text");
  assert(/border:\s*1px solid var\(--card-line\)/.test(rule(popupCss, ".card")), "card border in the accent family");
  assert(/list-style:\s*none/.test(rule(popupCss, "summary")) && /display:\s*none/.test(rule(popupCss, "summary::-webkit-details-marker")), "default marker hidden");
  assert(/content:\s*""/.test(rule(popupCss, "summary::after")) && /rotate\(-135deg\)/.test(rule(popupCss, "details[open] > summary::after")), "chevron after the text, flips when open");
});

Deno.test("high contrast: white gecko and ringed yellow buttons, manual and automatic, never over an explicit Purple", () => {
  const manual = rule(popupCss, ':root[data-theme="contrast"]');
  assert(/--icon-filter:\s*grayscale\(1\) brightness\(2\.2\)/.test(manual) && /--ring:\s*0 0 0 2px #000000, 0 0 0 4px #ffffff/.test(manual), "manual contrast tokens");
  const auto = popupCss.match(/@media \(prefers-contrast: more\)\s*\{\s*:root:not\(\[data-theme="purple"\]\)\s*\{([^}]*)\}/);
  assert(auto && auto[1].includes("--icon-filter: grayscale(1) brightness(2.2)") && auto[1].includes("--ring:"), "automatic contrast has the same tokens, guarded by :not([data-theme=purple])");
  assert(/filter:\s*var\(--icon-filter\)/.test(rule(popupCss, "#brand-icon")) && /box-shadow:\s*var\(--ring\)/.test(rule(popupCss, "button.primary")), "tokens used");
  assert(/--icon-filter:\s*none/.test(rule(popupCss, ":root")) && /--ring:\s*none/.test(rule(popupCss, ":root")), "purple: no filter, no ring");
});

Deno.test("settings page wears the popup's themes: tokens, manual switch, automatic contrast, forced colours, focus ring", () => {
  const css = settingsHtml.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, "");
  assert(/:root\s*\{[^}]*--bg:\s*#0e0b14[^}]*--accent:\s*#8f3dff/.test(css), "purple tokens as in popup.css");
  assert(/:root\[data-theme="contrast"\]\s*\{[^}]*--accent:\s*#ffd400/.test(css), "manual contrast");
  assert(/@media \(prefers-contrast: more\)\s*\{\s*:root:not\(\[data-theme="purple"\]\)/.test(css), "automatic contrast unless Purple");
  assert(/@media \(forced-colors: active\)[\s\S]*Canvas/.test(css) && /:focus-visible\s*\{[^}]*outline:/.test(css), "forced colours + focus ring");
  assert(!/transition|animation|@keyframes|@import|url\(/.test(css), "no animation, fonts or images");
  assert(/function applyTheme\(t\)/.test(settingsSource) && /applyTheme\(stored\.uiTheme\)/.test(settingsSource) && /applyTheme\(theme\);/.test(settingsSource), "theme applied on load and on change");
});

Deno.test("screen readers: the question names the Yes / No group, and the live notes stay rendered while empty", () => {
  assert(/<div id="fix-ask"[^>]*role="group"[^>]*aria-labelledby="fix-question"/.test(popupHtml), "Yes and No sit in a group named by the question");
  assert(/id="fix-question"[^>]*>Did that fix it\?/.test(popupHtml), "the group's name is the question");
  for (const id of ["fix-note", "page-status"]) assert(new RegExp(`id="${id}" class="note" aria-live="polite"`).test(popupHtml), id + " is a live region");
  const css = popupCss.replace(/\/\*[\s\S]*?\*\//g, "");
  assert(/\.note:empty\s*\{[^}]*margin:\s*0/.test(css), "empty notes collapse");
  assert(!/\.note:empty\s*\{[^}]*display:\s*none/.test(css), "display:none takes a live region out of the accessibility tree");
});

Deno.test("guard pings: flags.js forwards only {g: clipboard|popup}, rate-limited, never settings", () => {
  assert(/ch\.port1\.onmessage = onGuardPing;/.test(flagsSource), "port1 listens for pings");
  assert(/d\.g !== "clipboard" && d\.g !== "popup"/.test(flagsSource) && /now - lastPing < 2000/.test(flagsSource), "shape check and rate limit");
  assert(/type: "guardEvent", kind: d\.g/.test(flagsSource), "forwards only the kind");
});
