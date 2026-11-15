// Nightly verify: the popunder check only sees a trusted 'click' less than
// 1000 ms old. A popunder that opens on mousedown/pointerdown (before the click
// exists) or a moment later (setTimeout 1200 ms, activation still live) is not
// judged as a popunder and opens.
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

const loadPop = () => { const api = {}; new Function(`${unwrapMain(popupsSource)}\nreturn installPopupGuard;`)()(api); return api; };

function assert(condition, label) {
  if (!condition) throw new Error(label || "assert failed");
}

// A fake page: every listener registered for a type is kept; dispatch runs them
// in order, like a real capture-phase document listener would see the event.
function setup() {
  const g = loadPop();
  const opened = [];
  const listeners = {};
  let t = 10000;
  const win = { open: (u) => { opened.push(u); return {}; } };
  const nav = { userActivation: { isActive: false } };
  const doc = { addEventListener: (type, f) => { (listeners[type] ||= []).push(f); } };
  g.install({ window: win, document: doc, navigator: nav, location: { href: "https://news.example/", hostname: "news.example" }, now: () => t, flagOn: () => true });
  // Plain page text: closest(INTERACTIVE) finds nothing.
  const plainText = { closest: () => null };
  const dispatch = (type) => { for (const f of listeners[type] || []) f({ isTrusted: true, type, target: plainText }); };
  return { win, nav, opened, dispatch, advance: (ms) => { t += ms; } };
}

Deno.test("popup guard: a popunder opened on mousedown over plain page text is blocked", () => {
  const s = setup();
  // Real order of a mouse click: pointerdown, mousedown (activation starts), ... click.
  s.nav.userActivation.isActive = true;
  s.dispatch("pointerdown");
  s.dispatch("mousedown");
  // The page's own mousedown handler opens the popunder here.
  const r = s.win.open("https://ads.example/x");
  assert(r === null && s.opened.length === 0, `popunder on mousedown opened: ${JSON.stringify(s.opened)}`);
});

Deno.test("popup guard: a popunder opened 1.2 s after a click on plain page text is blocked", () => {
  const s = setup();
  s.nav.userActivation.isActive = true;
  s.dispatch("pointerdown");
  s.dispatch("mousedown");
  s.dispatch("pointerup");
  s.dispatch("mouseup");
  s.dispatch("click");
  s.advance(1200); // transient activation (about 5 s in Chrome) is still live
  const r = s.win.open("https://ads.example/x");
  assert(r === null && s.opened.length === 0, `delayed popunder opened: ${JSON.stringify(s.opened)}`);
});

Deno.test("popup guard: a popunder opened 0.5 s after a click on plain page text is blocked (control)", () => {
  const s = setup();
  s.nav.userActivation.isActive = true;
  s.dispatch("click");
  s.advance(500);
  assert(s.win.open("https://ads.example/x") === null && s.opened.length === 0, "control: fresh click popunder blocked");
});

// A page window-capture listener that stops propagation must not hide the
// gesture: the guard listens on window (capture), registered at document_start
// before any page listener, so it still sees the mousedown.
Deno.test("popup guard: a page window-capture stopPropagation does not hide the gesture", () => {
  const g = loadPop();
  const opened = [];
  const winL = {};
  const docL = {};
  const win = {
    open: (u) => { opened.push(u); return {}; },
    addEventListener: (type, f) => { (winL[type] ||= []).push(f); },
  };
  const doc = { addEventListener: (type, f) => { (docL[type] ||= []).push(f); } };
  const nav = { userActivation: { isActive: false } };
  g.install({ window: win, document: doc, navigator: nav, location: { href: "https://news.example/", hostname: "news.example" }, now: () => 10000, flagOn: () => true });
  // The popunder script, added after the guard.
  for (const type of ["pointerdown", "mousedown", "click"]) win.addEventListener(type, (e) => e.stopPropagation(), true);
  const plainText = { closest: () => null };
  const dispatch = (type) => {
    let stopped = false;
    const e = { isTrusted: true, type, target: plainText, stopPropagation() { stopped = true; } };
    for (const f of winL[type] || []) f(e); // listeners on one target all run
    if (!stopped) for (const f of docL[type] || []) f(e);
  };
  nav.userActivation.isActive = true;
  dispatch("pointerdown");
  dispatch("mousedown");
  dispatch("click");
  const r = win.open("https://ads.example/x");
  assert(r === null && opened.length === 0, `popunder after a starved gesture opened: ${JSON.stringify(opened)}`);
});
