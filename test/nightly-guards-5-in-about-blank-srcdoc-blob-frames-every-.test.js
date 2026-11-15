// Nightly verify: the popup guard must not fail open on a protocol-relative
// URL opened from an about:blank / about:srcdoc / blob: frame. Chrome resolves
// such a URL against the frame's inherited base URL (the creator page), so
// `//ads.evil.test/x` opens https://ads.evil.test/x. Without a user gesture the
// guard must block it, exactly as it does in the top frame.
import popupsSource from "../src/guards/popups.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
function assert(c, l) { if (!c) throw new Error(l); }
const loadPop = () => { const api = {}; new Function(`${unwrapMain(popupsSource)}\nreturn installPopupGuard;`)()(api); return api; };

// Like a real browser: an about:blank / about:srcdoc frame of
// https://news.example/ inherits that base URL and origin (window.origin), but
// its location.origin is the opaque "null". Only blob: carries the real origin
// in location.origin. `sandboxed` makes every origin opaque.
function frame(href, sandboxed = false) {
  const g = loadPop();
  const opened = [];
  const win = { open: (u) => { opened.push(u); return {}; }, origin: sandboxed ? "null" : "https://news.example" };
  const doc = { baseURI: "https://news.example/a", addEventListener() {} };
  const origin = href.startsWith("blob:") && !sandboxed ? "https://news.example" : "null";
  g.install({
    window: win, document: doc, navigator: { userActivation: { isActive: false } },
    location: { href, hostname: "", origin },
    flagOn: () => true, signal() {},
  });
  return { win, opened };
}

Deno.test("popup guard: top frame blocks a gesture-less protocol-relative ad URL (baseline)", () => {
  const g = loadPop();
  const loc = { href: "https://news.example/a", hostname: "news.example" };
  assert(g.judge("//ads.evil.test/x", { location: loc, activation: false, opensThisGesture: 0, lastClickTarget: null, lastClickInteractive: true }) === "no user gesture", "top frame blocks");
});

for (const href of ["about:blank", "about:srcdoc", "blob:https://news.example/0b6c4f3e-1111-2222-3333-444455556666"]) {
  Deno.test(`popup guard: ${href.slice(0, 12)} frame blocks a gesture-less //ads.evil.test/x`, () => {
    const { win, opened } = frame(href);
    const r = win.open("//ads.evil.test/x");
    assert(r === null && opened.length === 0, `guard in ${href} frame let a gesture-less cross-site popup through (opened=${JSON.stringify(opened)})`);
  });
}

// The fix must not block the frame's own same-site popups: a relative URL
// resolves against the inherited base (https://news.example/x), and the page
// host comes from the inherited origin, not from the opaque location.origin.
for (const href of ["about:blank", "about:srcdoc", "blob:https://news.example/0b6c4f3e-1111-2222-3333-444455556666"]) {
  Deno.test(`popup guard: ${href.slice(0, 12)} frame still allows a gesture-less relative same-site open`, () => {
    const { win, opened } = frame(href);
    const r = win.open("x");
    assert(r !== null && opened.length === 1, `same-site relative open in ${href} frame was blocked`);
  });
}

Deno.test("popup guard: sandboxed srcdoc frame (all origins opaque) judges same-site by its base URL", () => {
  const { win, opened } = frame("about:srcdoc", true);
  assert(win.open("x") !== null && opened.length === 1, "same-site relative open in sandboxed frame was blocked");
  assert(win.open("//ads.evil.test/x") === null && opened.length === 1, "cross-site open in sandboxed frame got through");
});
