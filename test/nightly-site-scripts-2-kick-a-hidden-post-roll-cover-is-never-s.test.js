// Nightly verify: a post-roll cover hidden while it showed no <video> (an ad
// slate, or a player whose video sits in a closed shadow root) must be shown
// again once IMA removes its ad controls. The removal is the only DOM change.
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

// Owner decision 2026-11-20: the correction in
// docs/proposals/kick-0.3.5-fixes.patch is applied to src/kick.js. Kick was
// not tested live (UNVERIFIED in Chrome).
Deno.test({ name: "kick covers: a hidden cover with no visible <video> is shown again when only its ad controls are removed", fn: () => {
  // <video-player> with its video in a closed shadow root (not visible to us).
  const player = fakeEl("VIDEO-PLAYER", {});
  const controls = fakeEl("DIV", { matches: (s) => s.includes("ima-ad-controls"), querySelector: () => null });
  const overlay = fakeEl("DIV", {}, [player, controls]);
  let controlsPresent = true;
  let observerCb = null;
  const document = {
    documentElement: {},
    querySelectorAll: (sel) => (sel.includes("ima-ad-controls") && controlsPresent ? [controls] : []),
  };
  class MO { constructor(cb) { observerCb = cb; } observe() {} }
  const api = {};
  new Function("document", "MutationObserver", "requestAnimationFrame", `${unwrapMain(kickSource)}\nreturn installKickAdblock;`)(document, MO, (fn) => fn())(api);
  api.watchCovers(() => true);
  assert(overlay.style.getPropertyValue("display") === "none", "precondition: cover without a visible video hidden");

  // The ad ends: IMA removes only its controls node. Nothing is added.
  controlsPresent = false;
  overlay.children = [player];
  controls.parentElement = null;
  controls.isConnected = false;
  observerCb([{ type: "childList", target: overlay, addedNodes: [], removedNodes: [controls] }]);

  assert(
    overlay.style.getPropertyValue("display") !== "none",
    "cover (and the player in it) still display:none after the ad controls were removed: " + JSON.stringify(overlay.style.props),
  );
} });
