// Child frames get a compact generic hide sheet (simple #id / .class names
// up to FRAME_GENERIC_MAX_LEN), not the full 13,635-selector list.
import { assert, assertEquals } from "jsr:@std/assert@1";
import "../src/general/cosmetic-parse.js";

const P = globalThis.GeneralCosmeticParse;

Deno.test("frameGenericList keeps short simple ids and classes, drops the rest", () => {
  const list = P.frameGenericList([
    "#AdContent", ".ad-slot", "#AC_ad", "#AdSense1",
    "#Ad-Container", ".cornerstone_slot", "[aria-label=\"Sponsored Content\"]",
    ".ad-box:not(:empty)", "#leaderboard.ad", "",
  ]);
  assert(list.includes("#AdContent") && list.includes(".ad-slot") && list.includes("#AC_ad") && list.includes("#AdSense1"));
  assert(!list.includes("#Ad-Container"), "11+ character names are dropped");
  assert(!list.includes(".cornerstone_slot") && !list.includes("[aria-label=\"Sponsored Content\"]"));
  assert(!list.includes(".ad-box:not(:empty)") && !list.includes("#leaderboard.ad"));
  assertEquals(P.FRAME_GENERIC_MAX_LEN, 10);
});

Deno.test("toStorage writes cosGF and keysForHost gives it only to subframes", () => {
  const st = P.toStorage({ generic: ["#AdContent", "#Ad-Container", ".ad-slot", ".ad-box:not(:empty)"] }, { source: "bundled" });
  assertEquals(st[P.KEY_GENERIC_FRAME], "#AdContent\n.ad-slot");
  assert(st[P.KEY_GENERIC].includes("#Ad-Container"));
  const sub = P.keysForHost("news.example", false);
  const top = P.keysForHost("news.example", true);
  assert(sub.includes(P.KEY_GENERIC_FRAME) && !sub.includes(P.KEY_GENERIC));
  assert(top.includes(P.KEY_GENERIC) && !top.includes(P.KEY_GENERIC_FRAME));
});

Deno.test("buildPageCss: a subframe hides short generics and the host's site rules, not a long generic", () => {
  const st = P.toStorage({
    generic: ["#AdContent", "#Ad-Container", ".ad-slot"],
    sites: { "news.example": [".site-ad"] },
  }, {});
  const pick = (top) => Object.fromEntries(P.keysForHost("news.example", top).filter((k) => k in st).map((k) => [k, st[k]]));
  const css = P.buildPageCss("news.example", pick(false), "", 0);
  assert(css.includes("#AdContent") && css.includes(".ad-slot") && css.includes(".site-ad"));
  assert(!css.includes("#Ad-Container"), css);
  assert(P.buildPageCss("news.example", pick(true), "", 0).includes("#Ad-Container"));
});
