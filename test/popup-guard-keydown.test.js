// WP-24 item 3 (review 2026-11-16): a trusted key press starts a new gesture
// for the pop-up guard. Before, a click into a search box and Enter less than
// 5 s later (the site opens results in a new window from its keydown handler)
// was judged by the old click on the text field: "popunder (click on page
// content)", so the open was blocked.
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";

const loadPop = () => { const api = {}; new Function(`${unwrapMain(popupsSource)}\nreturn installPopupGuard;`)()(api); return api; };
function assert(condition, label) { if (!condition) throw new Error(label || "assert failed"); }

// Fake nodes: closest(INTERACTIVE) finds nothing for a text field or plain text.
const searchBox = { localName: "input", closest: () => null };
const plainText = { localName: "p", closest: () => null };
const body = { localName: "body", closest: () => null };

function setup() {
  const g = loadPop();
  const opened = [];
  const listeners = {};
  let t = 10000;
  const win = { open: (u) => { opened.push(u); return {}; }, addEventListener: (type, f) => { (listeners[type] ||= []).push(f); } };
  const nav = { userActivation: { isActive: false } };
  const doc = { addEventListener() {} };
  let signals = 0;
  g.install({ window: win, document: doc, navigator: nav, location: { href: "https://news.example/", hostname: "news.example" }, now: () => t, flagOn: () => true, signal: () => { signals++; } });
  const dispatch = (type, target, trusted = true) => { for (const f of listeners[type] || []) f({ isTrusted: trusted, type, target }); };
  const click = (target) => { nav.userActivation.isActive = true; for (const type of ["pointerdown", "mousedown", "click"]) dispatch(type, target); };
  return { win, nav, opened, dispatch, click, advance: (ms) => { t += ms; }, signals: () => signals };
}

Deno.test("popup guard: click in a search box, then Enter opens a cross-site window: allowed", () => {
  const s = setup();
  s.click(searchBox);
  s.advance(1500); // the visitor types the query
  s.dispatch("keydown", searchBox); // Enter; the page's keydown handler opens results
  const r = s.win.open("https://results.example.org/?q=x");
  assert(r !== null && s.opened.length === 1, "keyboard-started open was blocked as a popunder: " + JSON.stringify(s.opened));
  assert(s.signals() === 0, "a blocked signal was sent");
});

Deno.test("popup guard: a key press starts a new gesture, so its one window is counted again", () => {
  const s = setup();
  s.click({ localName: "button", closest: () => ({}) }); // a real button
  assert(s.win.open("https://one.example.org/") !== null, "first window of the click");
  assert(s.win.open("https://two.example.org/") === null, "second window in one click is still blocked");
  s.advance(800);
  s.dispatch("keydown", searchBox);
  assert(s.win.open("https://three.example.org/") !== null, "the key press did not start a new gesture");
  assert(s.win.open("https://four.example.org/") === null, "second window in one key press is blocked");
});

Deno.test("popup guard: a click on plain text, then window.open, is still blocked (control)", () => {
  const s = setup();
  s.click(plainText);
  s.advance(300);
  assert(s.win.open("https://ads.example/x") === null && s.opened.length === 0, "popunder after a click on plain text opened");
});

Deno.test("popup guard: a key press with no focused control (page body) still counts as page content", () => {
  const s = setup();
  s.click(plainText);
  s.dispatch("keydown", body);
  assert(s.win.open("https://ads.example/x") === null && s.opened.length === 0, "popunder on a key press over the page body opened");
});

Deno.test("popup guard: an untrusted (script) keydown does not start a gesture", () => {
  const s = setup();
  s.click(plainText);
  s.dispatch("keydown", searchBox, false);
  assert(s.win.open("https://ads.example/x") === null && s.opened.length === 0, "a script keydown let the popunder through");
});
