// Recomputes WCAG 2.1 contrast from the real CSS tokens of the popup and the
// settings page, in the purple and the high-contrast theme. Text needs 4.5:1,
// UI parts and focus rings 3:1 (1.4.3, 1.4.11). No text here is "large": the
// biggest is 21 px at normal weight. Forced colours use the system palette.
import popupCss from "../src/popup.css" with { type: "text" };
import settingsHtml from "../src/settings.html" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const settingsCss = strip(settingsHtml.match(/<style>([\s\S]*?)<\/style>/)[1]);
const popup = strip(popupCss);

function tokens(css, re, label) {
  const m = css.match(re);
  assert(m, "no block: " + label);
  return Object.fromEntries([...m[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((t) => [t[1], t[2].trim()]));
}
const BASE = /(?:^|\})\s*:root\s*\{([^}]*)\}/;
const MANUAL = /:root\[data-theme="contrast"\]\s*\{([^}]*)\}/;
const AUTO = /@media \(prefers-contrast: more\)\s*\{\s*:root:not\(\[data-theme="purple"\]\)\s*\{([^}]*)\}/;

function rgb(hex) {
  assert(/^#[0-9a-f]{6}$/i.test(hex), "not a #rrggbb colour: " + hex);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(c) {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const over = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

function check(theme, label, fg, bg, need) {
  const r = ratio(fg, bg);
  assert(r >= need, `${theme}: ${label} is ${r.toFixed(3)}:1, needs ${need}:1`);
}

const POPUP_THEMES = (() => {
  const base = tokens(popup, BASE, "popup purple");
  return {
    purple: base,
    "manual contrast": { ...base, ...tokens(popup, MANUAL, "popup manual contrast") },
    "automatic contrast": { ...base, ...tokens(popup, AUTO, "popup automatic contrast") },
  };
})();
const SETTINGS_THEMES = (() => {
  const base = tokens(settingsCss, BASE, "settings purple");
  return {
    purple: base,
    "manual contrast": { ...base, ...tokens(settingsCss, MANUAL, "settings manual contrast") },
    "automatic contrast": { ...base, ...tokens(settingsCss, AUTO, "settings automatic contrast") },
  };
})();

Deno.test("popup: every text and UI pair meets AA in each theme, hover included", () => {
  for (const [name, t] of Object.entries(POPUP_THEMES)) {
    const c = (k) => rgb(t[k]);
    for (const surface of ["--bg", "--panel"]) {
      check(name, "text on " + surface, c("--text"), c(surface), 4.5);
      check(name, "note on " + surface, c("--muted"), c(surface), 4.5);
      check(name, "link / Block again on " + surface, c("--outline"), c(surface), 4.5);
      check(name, "button shape on " + surface, c("--accent"), c(surface), 3);
      check(name, "focus ring on " + surface, c("--focus"), c(surface), 3);
    }
    check(name, "button label", c("--accent-text"), c("--accent"), 4.5);
    check(name, "button label on hover", c("--accent-text"), c("--accent-hover"), 4.5);
    check(name, "credit line at 0.85", over(c("--muted"), c("--bg"), 0.85), c("--bg"), 4.5);
  }
});

Deno.test("settings page: every text and UI pair meets AA in each theme, hover, fields and placeholder included", () => {
  for (const [name, t] of Object.entries(SETTINGS_THEMES)) {
    const c = (k) => rgb(t[k]);
    check(name, "text on page", c("--text"), c("--bg"), 4.5);
    check(name, "text on section", c("--text"), c("--panel"), 4.5);
    check(name, "note on section", c("--muted"), c("--panel"), 4.5);
    check(name, "status line", c("--status"), c("--bg"), 4.5);
    check(name, "button label", c("--accent-text"), c("--accent"), 4.5);
    check(name, "button label on hover", c("--accent-text"), c("--accent-hover"), 4.5);
    check(name, "button shape on section", c("--accent"), c("--panel"), 3);
    check(name, "focus ring on section", c("--focus"), c("--panel"), 3);
    check(name, "text box edge on section", c("--field-line"), c("--panel"), 3);
    check(name, "text box edge on field", c("--field-line"), c("--field"), 3);
    check(name, "placeholder", c("--placeholder"), c("--field"), 4.5);
  }
});

// The tokens above only count if the rules use them.
Deno.test("the checked tokens are the ones the rules use", () => {
  assert(/button\.primary:hover\s*\{[^}]*background:\s*var\(--accent-hover\)/.test(popup), "popup hover uses the token");
  assert(/button:hover\s*\{[^}]*background:\s*var\(--accent-hover\)/.test(settingsCss), "settings hover uses the token");
  assert(!/button:hover\s*\{[^}]*filter:/.test(settingsCss), "a brightness filter would skip this check");
  assert(/input\[type="text"\],\s*select\s*\{[^}]*border:\s*1px solid var\(--field-line\)/.test(settingsCss), "field edge uses the token");
  assert(/::placeholder\s*\{[^}]*color:\s*var\(--placeholder\)[^}]*opacity:\s*1/.test(settingsCss), "placeholder uses the token");
});

Deno.test("manual and automatic high contrast are the same theme, on both pages", () => {
  for (const [name, css] of [["popup", popup], ["settings", settingsCss]]) {
    const manual = tokens(css, MANUAL, name + " manual");
    const auto = tokens(css, AUTO, name + " automatic");
    assert(JSON.stringify(manual) === JSON.stringify(auto), `${name}: the two high-contrast blocks differ`);
  }
});

Deno.test("the settings page's shared colours match the popup's", () => {
  const p = POPUP_THEMES.purple, s = SETTINGS_THEMES.purple;
  for (const k of ["--bg", "--panel", "--text", "--muted", "--accent", "--accent-hover", "--accent-text", "--focus"]) {
    assert(p[k] === s[k], `${k}: popup ${p[k]}, settings ${s[k]}`);
  }
});

Deno.test("the settings page does not scroll sideways at 320 px: the theme list may not outgrow its section", () => {
  assert(/(?:^|\})\s*select\s*\{[^}]*max-width:\s*100%/.test(settingsCss), "select { max-width: 100% }");
});
