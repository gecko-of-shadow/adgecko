// YouTube's newer popup (snackbar-container). Seen on a live page on 2026-11-20:
// "Experiencing interruptions?" and "Link copied to clipboard" have the same
// elements, classes and attributes, so only the text tells them apart.
// syncInterruptionsSnackbar hides the container for the first and shows it
// again for any other message.
import source from "../src/youtube.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const api = {};
const installYoutubeAdblock = new Function(`${unwrapMain(source)}\nreturn installYoutubeAdblock;`)();
installYoutubeAdblock(api);

function snackbar(text) {
  const props = {};
  return {
    textContent: text,
    style: {
      setProperty(name, value, priority) { props[name] = { value, priority }; },
      removeProperty(name) { delete props[name]; },
    },
    display: () => (props.display ? props.display.value + "!" + props.display.priority : ""),
    vis: () => (props.visibility ? props.visibility.value + "!" + props.visibility.priority : "") + "/" + (props["pointer-events"] ? props["pointer-events"].value : ""),
  };
}

Deno.test("snackbar text: only the interruptions message matches", () => {
  assert(api.isInterruptionsSnackbarText("Experiencing interruptions?"), "the message");
  assert(api.isInterruptionsSnackbarText("  Experiencing\n interruptions?  "), "white space");
  assert(api.isInterruptionsSnackbarText("Experiencing interruptions? Find out why"), "the message with a button label after it");
  for (const other of ["Link copied to clipboard", "Saved to Watch later", "", null, undefined, "Are you experiencing interruptions? Tell us"]) {
    assert(!api.isInterruptionsSnackbarText(other), "not the message: " + other);
  }
});

Deno.test("snackbar: the interruptions message is hidden in place; the next message shows again", () => {
  const box = snackbar("Experiencing interruptions?");
  assert(api.syncInterruptionsSnackbar(box) === true, "hidden");
  assert(box.vis() === "hidden!important/none", "visibility hidden, no pointer events: " + box.vis());
  // display:none stops YouTube's snackbar queue (the next message never shows).
  assert(box.display() === "", "display is not touched: " + box.display());
  // YouTube puts the next message into the same container.
  box.textContent = "Link copied to clipboard";
  assert(api.syncInterruptionsSnackbar(box) === false, "not hidden");
  assert(box.vis() === "/", "inline hide removed: " + box.vis());
});

Deno.test("snackbar: another message is never touched", () => {
  const box = snackbar("Link copied to clipboard");
  box.style.setProperty("display", "flex", "");
  assert(api.syncInterruptionsSnackbar(box) === false, "not hidden");
  assert(box.display() === "flex!", "YouTube's own inline display stays: " + box.display());
});

Deno.test("snackbar: with the cosmetic switch off it only restores", () => {
  const box = snackbar("Experiencing interruptions?");
  assert(api.syncInterruptionsSnackbar(box, false) === false, "switch off: not hidden");
  assert(box.vis() === "/", "no inline hide");
  assert(api.syncInterruptionsSnackbar(box, true) === true, "switch on: hidden");
  assert(api.syncInterruptionsSnackbar(box, false) === false, "switch off again: restored");
  assert(box.vis() === "/", "inline hide removed");
});

Deno.test("snackbar: a missing or odd container does not throw", () => {
  for (const bad of [null, undefined, {}, { style: {} }]) assert(api.syncInterruptionsSnackbar(bad) === false, "no-op");
});

// The wiring, run with a fake document and a fake observer class.
function fakePage() {
  const nodes = {};
  const observers = [];
  class Observer {
    constructor(cb) { this.cb = cb; }
    observe(target, opts) { observers.push({ target, opts, fire: () => this.cb([]) }); }
  }
  const doc = { querySelector: (sel) => nodes[sel] || null };
  return { nodes, observers, doc, Observer, on: (target) => observers.filter((o) => o.target === target) };
}

Deno.test("snackbar guard: waits for ytd-app, then for snackbar-container; hides and restores through its observers", () => {
  const page = fakePage();
  let cosmetic = true;
  const attach = api.installSnackbarGuard(page.doc, page.Observer, () => cosmetic);
  assert(typeof attach === "function", "guard installed");
  assert(attach() === false && page.observers.length === 0, "no ytd-app yet: nothing observed, caller keeps trying");
  const app = { name: "ytd-app" };
  page.nodes["ytd-app"] = app;
  assert(attach() === true, "ytd-app found");
  assert(page.on(app).length === 1 && JSON.stringify(page.on(app)[0].opts) === '{"childList":true}', "ytd-app: direct children only");
  assert(attach() === true && page.observers.length === 1, "a second try adds no second observer");
  // YouTube adds the container with the message already in it.
  const box = snackbar("Experiencing interruptions?");
  page.nodes["snackbar-container"] = box;
  page.on(app)[0].fire();
  assert(page.on(box).length === 1, "container observed once");
  const opts = page.on(box)[0].opts;
  assert(opts.childList === true && opts.subtree === true && opts.characterData === true, "container: children, subtree and text");
  assert(box.vis() === "hidden!important/none", "hidden at once, before a change inside the container: " + box.vis());
  // The next message arrives in the same container.
  box.textContent = "Link copied to clipboard";
  page.on(box)[0].fire();
  assert(box.vis() === "/", "next message shows: " + box.vis());
  box.textContent = "Experiencing interruptions?";
  page.on(box)[0].fire();
  assert(box.vis() === "hidden!important/none", "hidden again");
  // The cosmetic switch goes off: the next change restores and does not hide.
  cosmetic = false;
  page.on(box)[0].fire();
  assert(box.vis() === "/", "switch off: restored");
  // A switch change is applied through sync(), with no change inside the container.
  cosmetic = true;
  attach.sync();
  assert(box.vis() === "hidden!important/none", "switch on + sync: hidden with no mutation");
  cosmetic = false;
  attach.sync();
  assert(box.vis() === "/", "switch off + sync: restored with no mutation");
  cosmetic = true;
  page.on(app)[0].fire();
  assert(page.observers.length === 2, "the same container is not observed twice");
  assert(page.observers.every((o) => o.target === app || o.target === box), "no observer on the document");
});

Deno.test("snackbar guard: a container that exists before the first try is handled at once", () => {
  const page = fakePage();
  const box = snackbar("Experiencing interruptions?");
  page.nodes["ytd-app"] = { name: "ytd-app" };
  page.nodes["snackbar-container"] = box;
  assert(api.installSnackbarGuard(page.doc, page.Observer, () => true)() === true, "attached");
  assert(box.vis() === "hidden!important/none", "hidden: " + box.vis());
});

Deno.test("snackbar guard: a replaced container is observed too; no observer class or document means no guard", () => {
  const page = fakePage();
  const app = { name: "ytd-app" };
  page.nodes["ytd-app"] = app;
  page.nodes["snackbar-container"] = snackbar("Saved to Watch later");
  const attach = api.installSnackbarGuard(page.doc, page.Observer, () => true);
  attach();
  const second = snackbar("Experiencing interruptions?");
  page.nodes["snackbar-container"] = second;
  page.on(app)[0].fire();
  assert(page.on(second).length === 1 && second.vis() === "hidden!important/none", "new container observed and hidden");
  assert(api.installSnackbarGuard(page.doc, undefined, () => true) === null, "no observer class");
  assert(api.installSnackbarGuard(null, page.Observer, () => true) === null, "no document");
});

Deno.test("snackbar guard: an error in the sync goes to the error callback, not to the page", () => {
  const page = fakePage();
  page.nodes["ytd-app"] = { name: "ytd-app" };
  page.nodes["snackbar-container"] = { get textContent() { throw new Error("boom"); }, style: { setProperty() {}, removeProperty() {} } };
  const errors = [];
  api.installSnackbarGuard(page.doc, page.Observer, () => true, (e) => errors.push(e.message))();
  assert(errors.join() === "boom", "error reported: " + errors.join());
});

Deno.test("snackbar guard call site: reads the cosmetic switch and runs with and without the uBO layer", () => {
  const start = source.indexOf("// Snackbar guard (see installSnackbarGuard)");
  const end = source.indexOf("injectHomeFeedCss();", start);
  assert(start > 0 && end > start, "guard block found");
  const block = source.slice(start, end);
  assert(block.includes('api.installSnackbarGuard(document, MutationObserver, () => !(typeof flagOn === "function" && !flagOn("youtubeCosmetic")), logFailOpen)'), "call with the cosmetic switch");
  assert(!block.includes("uboLayerPresent"), "not gated on the uBO layer");
  assert(block.includes("clearInterval(early)") && block.includes("30000"), "the early poll stops by itself");
  assert(block.includes("snackbarResync = attachApp.sync;"), "the sync is kept for switch changes");
  assert(/FLAGS\[key\] = next\[key\];[\s\S]{0,400}snackbarResync\(\)/.test(source), "the flag handler runs the sync after it stores the flags");
});
