// Child frames get a compact generic hide sheet (simple #id / .class
// selectors up to FRAME_GENERIC_MAX_LEN characters, the # or . included),
// not the full 13,635-selector list.
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
  assert(!list.includes("#Ad-Container"), "selectors over 10 characters are dropped");
  // The limit counts the # or . too: a 9-character name is kept, a 10-character name is not.
  assertEquals(P.frameGenericList(["#abcdefghi", ".abcdefghij"]), ["#abcdefghi"]);
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

// The frame sheet in a child frame follows the top site: an Allow (or the
// cosmetic switch off) on the top site, or $generichide on the top site,
// turns it off. A frame that cannot learn the top site does not use it.
const F = globalThis.GeckoFeatures;
const tick = () => new Promise((r) => setTimeout(r, 0));
let install = null;
async function loadInstall() {
  if (!install) {
    await import("../src/settings/features.js");
    const source = await Deno.readTextFile(new URL("../src/cosmetic.js", import.meta.url));
    install = new Function(`${source}\nreturn installCosmeticHide;`)();
  }
  return install;
}

async function withDoc(fn) {
  const writes = [];
  let el = null;
  const prev = { document: globalThis.document, CSSStyleSheet: globalThis.CSSStyleSheet };
  delete globalThis.CSSStyleSheet;
  globalThis.document = {
    documentElement: { appendChild(n) { el = n; n.isConnected = true; } },
    createElement() { return { id: "", isConnected: false, set textContent(t) { writes.push(t); }, remove() { this.isConnected = false; el = null; } }; },
    getElementById() { return el; },
    addEventListener() {},
  };
  try {
    return await fn(() => (el ? writes[writes.length - 1] || "" : ""));
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  }
}

const FRAME_HOST = "widgets.other.example";
function frameStore(overrides, extra) {
  const st = P.toStorage({ generic: ["#AdContent", ".ad-slot"], sites: { [FRAME_HOST]: [".site-ad"] } }, { source: "refresh" });
  return Object.assign({}, st, { settings: { v: 1, enabled: true, features: {} }, siteOverrides: overrides || {} }, extra || {});
}

async function frameCss(stored, topOrigin) {
  const inst = await loadInstall();
  return await withDoc(async (css) => {
    const api = { hostname: FRAME_HOST, href: "https://" + FRAME_HOST + "/w", isTop: false, topOrigin, parse: P };
    inst(api);
    await api.applyState({ stored, enabled: true, allowedOrigins: [] });
    return css();
  });
}

Deno.test("frame sheet: applied in a child frame of a normal top site", async () => {
  const css = await frameCss(frameStore(), "https://shop.example");
  assert(css.includes(".ad-slot") && css.includes(".site-ad"), css);
});

Deno.test("frame sheet: an Allow on the top site turns it off in a cross-origin child frame", async () => {
  const css = await frameCss(frameStore({ "shop.example": { enabled: false } }), "https://shop.example");
  assert(!css.includes(".ad-slot") && !css.includes("#AdContent"), "generic frame sheet on an allowed site: " + css);
  assert(css.includes(".site-ad"), "the frame's own site rules stay: " + css);
});

Deno.test("frame sheet: an Allow on a parent domain of the top site also turns it off", async () => {
  const css = await frameCss(frameStore({ "example.com": { enabled: false } }), "https://www.example.com");
  assert(!css.includes(".ad-slot"), css);
});

Deno.test("frame sheet: the cosmetic switch off for the top site turns it off", async () => {
  const css = await frameCss(frameStore({ "shop.example": { features: { cosmetic: false } } }), "https://shop.example");
  assert(!css.includes(".ad-slot"), css);
});

Deno.test("frame sheet: $generichide on the top site turns it off", async () => {
  const st = frameStore({}, { "cosNoG:shop.example": P.NO_HIDE_GENERIC });
  const keys = P.keysForHost(FRAME_HOST, false, "shop.example");
  assert(keys.includes("cosNoG:shop.example"), "a child frame reads the top site's page exceptions: " + keys);
  const css = await frameCss(st, "https://shop.example");
  assert(!css.includes(".ad-slot"), css);
  assert(css.includes(".site-ad"), css);
});

Deno.test("frame sheet: an unknown top site (no ancestor, or 'null') turns it off", async () => {
  for (const top of ["", "null", "chrome-extension://abc"]) {
    const css = await frameCss(frameStore(), top);
    assert(!css.includes(".ad-slot"), "top " + JSON.stringify(top) + ": " + css);
    assert(css.includes(".site-ad"), css);
  }
});

Deno.test("frame sheet: a same-origin child frame follows the same rule", async () => {
  const st = frameStore({ [FRAME_HOST]: {} });
  const ok = await frameCss(st, "https://" + FRAME_HOST);
  assert(ok.includes(".ad-slot"), ok);
  const off = await frameCss(frameStore({ "other.example": { enabled: false } }), "https://" + FRAME_HOST);
  assert(off === "", "an Allow on the frame's own site (also the top) removes all: " + off);
});

Deno.test("frame sheet: the legacy allow list (no settings yet) on the top site turns it off", async () => {
  const st = frameStore();
  delete st.settings;
  delete st.siteOverrides;
  const inst = await loadInstall();
  const css = await withDoc(async (css) => {
    const api = { hostname: FRAME_HOST, href: "https://" + FRAME_HOST + "/w", isTop: false, topOrigin: "https://shop.example", parse: P };
    inst(api);
    await api.applyState({ stored: st, enabled: true, allowedOrigins: ["https://shop.example"] });
    return css();
  });
  assert(!css.includes(".ad-slot") && css.includes(".site-ad"), css);
});

Deno.test("frame sheet: an Allow on the top site re-reads storage in the child frame", async () => {
  const inst = await loadInstall();
  let current = frameStore();
  let reads = 0;
  let listener = null;
  await withDoc(async (css) => {
    const api = { hostname: FRAME_HOST, href: "https://" + FRAME_HOST + "/w", isTop: false, topOrigin: "https://shop.example", parse: P };
    inst(api);
    api.start({
      hostname: FRAME_HOST, isTop: false,
      getLocal: (_keys, cb) => { reads += 1; cb(JSON.parse(JSON.stringify(current))); },
      onChanged: { addListener: (fn) => { listener = fn; } },
      onMessage: { addListener() {} },
    });
    await tick();
    assert(reads === 1 && css().includes(".ad-slot"), "first read");
    const old = current.siteOverrides;
    current = Object.assign({}, current, { siteOverrides: { "shop.example": { enabled: false } } });
    listener({ siteOverrides: { oldValue: old, newValue: current.siteOverrides } }, "local");
    await tick();
    assert(reads === 2, "an Allow on the top site must re-read: " + reads);
    assert(!css().includes(".ad-slot"), css());
    // An Allow on a third site changes nothing here.
    const prev = current.siteOverrides;
    current = Object.assign({}, current, { siteOverrides: Object.assign({}, prev, { "third.example": { enabled: false } }) });
    listener({ siteOverrides: { oldValue: prev, newValue: current.siteOverrides } }, "local");
    await tick();
    assert(reads === 2, "an Allow on a third site re-read: " + reads);
  });
});

Deno.test("frame sheet: a stream top site (Twitch) turns it off", async () => {
  const css = await frameCss(frameStore(), "https://www.twitch.tv");
  assert(!css.includes(".ad-slot") && css.includes(".site-ad"), css);
});

Deno.test("frame sheet: without a test hook the top site comes from location.ancestorOrigins (last entry)", async () => {
  const inst = await loadInstall();
  const prev = Object.getOwnPropertyDescriptor(globalThis, "location");
  const run = async (ancestors, overrides) => {
    Object.defineProperty(globalThis, "location", {
      configurable: true, writable: true,
      value: { hostname: FRAME_HOST, href: "https://" + FRAME_HOST + "/w", ancestorOrigins: ancestors },
    });
    return await withDoc(async (css) => {
      const api = { hostname: FRAME_HOST, href: "https://" + FRAME_HOST + "/w", isTop: false, parse: P };
      inst(api);
      await api.applyState({ stored: frameStore(overrides), enabled: true, allowedOrigins: [] });
      return css();
    });
  };
  try {
    const chain = ["https://mid.example", "https://shop.example"];
    assert((await run(chain, {})).includes(".ad-slot"), "normal top site");
    assert(!(await run(chain, { "shop.example": { enabled: false } })).includes(".ad-slot"), "Allow on the top site");
    assert((await run(chain, { "mid.example": { enabled: false } })).includes(".ad-slot"), "an Allow on a middle frame's site does not decide");
    for (const none of [[], undefined]) {
      const css = await run(none, {});
      assert(!css.includes(".ad-slot") && css.includes(".site-ad"), "no ancestors: " + css);
    }
  } finally {
    if (prev) Object.defineProperty(globalThis, "location", prev);
    else delete globalThis.location;
  }
});
