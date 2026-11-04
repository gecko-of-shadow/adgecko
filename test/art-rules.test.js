// Art and design rules that had no real guard: mutation testing showed each of
// these could break with every other test still green. Comments do not count.
import popupHtml from "../src/popup.html" with { type: "text" };
import popupCss from "../src/popup.css" with { type: "text" };
import popupSource from "../src/popup.js" with { type: "text" };
import settingsHtml from "../src/settings.html" with { type: "text" };

function assert(c, l) { if (!c) throw new Error(l); }

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const POPUP = strip(popupCss);
const SETTINGS = strip(settingsHtml.match(/<style>([\s\S]*?)<\/style>/)[1]);

function forcedBlock(css) {
  const at = css.indexOf("@media (forced-colors: active)");
  assert(at >= 0, "forced-colors block");
  let i = css.indexOf("{", at), depth = 0;
  const start = i;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start + 1, i);
  }
  throw new Error("unclosed forced-colors block");
}

Deno.test("the focus ring is really drawn and the forced-colours rules are real, on both pages", () => {
  for (const [name, css] of [["popup", POPUP], ["settings", SETTINGS]]) {
    const forced = forcedBlock(css);
    for (const c of ["Canvas", "CanvasText", "ButtonFace", "ButtonText", "Highlight"]) {
      assert(new RegExp("\\b" + c + "\\b").test(forced), `${name}: forced colours lack ${c}`);
    }
    const ring = css.replace(forced, "").match(/:focus-visible\s*\{([^}]*)\}/);
    assert(ring && /outline:\s*2px solid var\(--focus\)/.test(ring[1]), `${name}: focus ring`);
    assert(!/outline:\s*(?:none|0)\b/.test(css), `${name}: outline removed somewhere`);
  }
});

// A pin on purpose: a new element here is a design change, so it must be a
// deliberate edit of this list (rules: simple and clean, no tour, no mood icons).
Deno.test("the popup holds exactly the approved elements; the welcome card and the question start hidden", () => {
  const body = popupHtml.slice(popupHtml.indexOf("<body>") + 6, popupHtml.indexOf("</body>"));
  const got = [...body.matchAll(/<([a-z0-9]+)\b([^>]*)>/g)].map((m) => {
    const id = m[2].match(/\bid="([^"]+)"/);
    return m[1] + (id ? "#" + id[1] : "");
  }).join(" ");
  const want = "main header img#brand-icon h1#product button#open-settings section#welcome p#welcome-title p button#welcome-close p#site-host p#site-status section p#fix-title button#fix-site div#fix-ask p#fix-question div button#fix-yes button#fix-no p#fix-note button#allow-site p#page-status details#more summary p#signal-line p#lists-status p#feed-status p#version-line p script";
  assert(got === want, "popup elements changed: " + got);
  assert(/<section id="welcome"[^>]*\shidden>/.test(popupHtml), "welcome card starts hidden");
  assert(/<div id="fix-ask"[^>]*\shidden>/.test(popupHtml), "Did that fix it? starts hidden");
});

Deno.test("no animation from script or inline styles either", () => {
  const js = popupSource.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  assert(!/\.animate\(|requestAnimationFrame/.test(js), "popup.js animates");
  assert(!/\sstyle="/.test(popupHtml), "inline style in popup.html");
});

// Pinned after review. Changing the art means changing this table on purpose.
// SVG line endings are normalised so a checkout cannot trip the pin.
const PINS = {
  "icons/source/gecko.svg": "1df0451139c7139e946ab839284fbc8f61374804f6c175041d164a9b0dbc1a01",
  "icons/source/gecko-16.svg": "b0ac5874dd077c1de097d05a4a55c46579c0d853f08a0d40b9ba135f4f054d5f",
  "icons/icon16.png": "b27a770d9b7678525edc99df23d9796d3bd9ef923993c250f6931aa0bb35836a",
  "icons/icon48.png": "63f05df378043659f45666302028cdb4225a7c66048d2ccacb89ae62d36e52bc",
  "icons/icon128.png": "90e03f41092fd61eaf3d1209c6015e9e104f50c0c5b218ccf9d636de2478b783",
  "icons/icon16-working.png": "181f854949dc6004061e4ad8468f113fb020ae8472d91448045d033749a8871f",
  "icons/icon48-working.png": "216488e8a232b2be1066c247a15c7d6c3555dae6b6e29aef7e188563c15d6408",
  "icons/icon128-working.png": "36f843f36fec69bfaa42fed983c61bfc1a067f781682f40aa41c7502516033cd",
  "icons/icon16-off.png": "1adb5e5a907112d65461f44bf52f09cdcd92fa357ca25df58d0b58d14024774b",
  "icons/icon48-off.png": "ea5d6f31b5cd9870ec12deaa565dff180387476d7a74a563295179c6b7cd6f27",
  "icons/icon128-off.png": "55a7acb8fbd0574db1d0470b7f27054aff050364ea0b34b80879a6c8f3df63c5",
};

Deno.test("the approved art is pinned: no shield or other swap slips in, and the PNGs match their review", async () => {
  for (const [rel, want] of Object.entries(PINS)) {
    let bytes = await Deno.readFile(new URL("../" + rel, import.meta.url));
    if (rel.endsWith(".svg")) bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/\r\n/g, "\n"));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const got = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
    assert(got === want, `${rel} changed: ${got}`);
  }
});

Deno.test("quiet alerts: no alert, confirm or prompt dialogs in our own code", async () => {
  for (const dir of ["src", "src/guards", "src/settings", "src/general", "src/feed", "src/threat"]) {
    for await (const f of Deno.readDir(new URL("../" + dir + "/", import.meta.url))) {
      if (!f.isFile || !f.name.endsWith(".js")) continue;
      const src = (await Deno.readTextFile(new URL("../" + dir + "/" + f.name, import.meta.url))).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
      assert(!/\b(?:alert|confirm|prompt)\s*\(/.test(src), `${dir}/${f.name} opens a dialog`);
    }
  }
});
