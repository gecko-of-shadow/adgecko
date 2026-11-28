// A disabled main button ("Fix this site", "Allow this site" on a page the
// popup cannot act on) must not keep the filled look, and must not change
// colour under the mouse.
import { assert } from "jsr:@std/assert@1";
import popupCss from "../src/popup.css" with { type: "text" };

const css = popupCss.replace(/\/\*[\s\S]*?\*\//g, "");

Deno.test("popup: the primary hover colour skips disabled buttons", () => {
  assert(/button\.primary:hover:not\(:disabled\)\s*\{[^}]*--accent-hover/.test(css), "hover rule is limited to enabled buttons");
  assert(!/button\.primary:hover\s*\{/.test(css), "an unrestricted primary hover rule is still there");
});

Deno.test("popup: a disabled primary button drops the fill and gets a dashed edge", () => {
  const m = css.match(/button\.primary:disabled\s*\{([^}]*)\}/);
  assert(m, "no button.primary:disabled rule");
  assert(/background:\s*transparent/.test(m[1]), "fill kept");
  assert(/dashed/.test(m[1]), "no dashed edge");
  assert(/box-shadow:\s*none/.test(m[1]), "ring kept");
});

Deno.test("popup: forced colours show disabled buttons in GrayText", () => {
  const fc = css.slice(css.indexOf("@media (forced-colors: active)"));
  assert(/button:disabled\s*\{[^}]*GrayText/.test(fc), "no GrayText rule for disabled buttons");
});
