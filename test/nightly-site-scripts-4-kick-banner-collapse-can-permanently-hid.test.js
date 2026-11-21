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

// frameOnly: the ad frame sits alone in a plain box (a banner slot), so the
// banner path collapses the box itself, not only the frame.
function setup(frameOnly = false) {
  const player = fakeEl("VIDEO-PLAYER", {}); // video not visible (not mounted / closed shadow root)
  const frame = fakeEl("IFRAME", { id: "google_ads_iframe_123" });
  const cover = fakeEl("DIV", {}, frameOnly ? [frame] : [player, frame]);
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

// Owner decision 2026-11-20: the correction in
// docs/proposals/kick-0.3.5-fixes.patch is applied to src/kick.js. Kick was
// not tested live (UNVERIFIED in Chrome).
Deno.test({ name: "kick banner collapse: a cover holding <video-player> is not hidden by the banner path", fn: () => {
  const { api, cover } = setup();
  api.watchCovers(() => true);
  assert(
    cover.style.getPropertyValue("display") !== "none",
    "cover with <video-player> (the live player) got display:none from bannerCollapseTarget: " + JSON.stringify(cover.style.props),
  );
} });

// Owner decision 2026-11-20: the correction in
// docs/proposals/kick-0.3.5-fixes.patch is applied to src/kick.js. Kick was
// not tested live (UNVERIFIED in Chrome).
Deno.test({ name: "kick banner collapse: switching the kick switch off shows the collapsed box again", fn: () => {
  // Player cover: the banner path hides only the frame.
  const a = setup();
  a.api.watchCovers(() => true);
  assert(a.frame.style.getPropertyValue("display") === "none", "frame was not hidden by the banner path: " + JSON.stringify(a.frame.style.props));
  a.api.coversSwitched(false);
  assert(a.frame.style.getPropertyValue("display") !== "none", "frame is still display:none after the kick switch went off");
  // Banner slot: the banner path collapses the whole box.
  const b = setup(true);
  b.api.watchCovers(() => true);
  assert(b.cover.style.getPropertyValue("display") === "none", "banner box was not collapsed: " + JSON.stringify(b.cover.style.props));
  b.api.coversSwitched(false);
  assert(b.cover.style.getPropertyValue("display") !== "none", "box collapsed by the banner path is still display:none after the kick switch went off");
} });

// The ad frame leaves: the next pass shows the collapsed box again.
Deno.test({ name: "kick banner collapse: a collapsed box is shown again when its ad frame is gone", fn: () => {
  const { api, cover, state } = setup(true);
  api.watchCovers(() => true);
  assert(cover.style.getPropertyValue("display") === "none", "banner box was not collapsed: " + JSON.stringify(cover.style.props));
  state.framePresent = false;
  api.coversSwitched(true);
  assert(cover.style.getPropertyValue("display") !== "none", "box is still display:none after its ad frame left");
} });
