// Nightly verify: an IMA ad iframe (google_ads_iframe_*) placed as a direct
// child of the post-roll cover DIV (next to <video-player>, whose <video> is
// not mounted yet or sits in a closed shadow root) must not get the cover,
// and with it the live player, hidden by the banner-collapse path. Any hide
// that pass does write must be undone when the kick switch goes off or the
// ad frame leaves.
import kickSource from "../src/kick.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

function assert(c, l) { if (!c) throw new Error(l); }

function fakeEl(tag, props, children) {
  const style = {
    props: {},
    setProperty(k, v, p) { this.props[k] = { v, p: p || "" }; },
    getPropertyValue(k) { return this.props[k] ? this.props[k].v : ""; },
    getPropertyPriority(k) { return this.props[k] ? this.props[k].p : ""; },
    removeProperty(k) { delete this.props[k]; },
  };
  const el = Object.assign({ nodeType: 1, tagName: tag, children: children || [], parentElement: null, style, isConnected: true }, props || {});
  for (const c of el.children) c.parentElement = el;
  return el;
}

function setup() {
  const player = fakeEl("VIDEO-PLAYER", {}); // video not visible (not mounted / closed shadow root)
  const frame = fakeEl("IFRAME", { id: "google_ads_iframe_123" });
  const cover = fakeEl("DIV", {}, [player, frame]);
  const state = { framePresent: true, observerCb: null };
  const document = {
    documentElement: {},
    querySelectorAll: (sel) => (sel.includes("google_ads_iframe") && state.framePresent ? [frame] : []),
  };
  class MO { constructor(cb) { state.observerCb = cb; } observe() {} }
  const api = {};
  new Function("document", "MutationObserver", "requestAnimationFrame", `${unwrapMain(kickSource)}\nreturn installKickAdblock;`)(document, MO, (fn) => fn())(api);
  return { api, cover, frame, player, state };
}

Deno.test("kick banner collapse: a cover holding <video-player> is not hidden by the banner path", () => {
  const { api, cover } = setup();
  api.watchCovers(() => true);
  assert(
    cover.style.getPropertyValue("display") !== "none",
    "cover with <video-player> (the live player) got display:none from bannerCollapseTarget: " + JSON.stringify(cover.style.props),
  );
});

Deno.test("kick banner collapse: switching the kick switch off shows the collapsed box again", () => {
  const { api, cover } = setup();
  api.watchCovers(() => true);
  api.coversSwitched(false);
  assert(
    cover.style.getPropertyValue("display") !== "none",
    "box collapsed by the banner path is still display:none after the kick switch went off: " + JSON.stringify(cover.style.props),
  );
});
