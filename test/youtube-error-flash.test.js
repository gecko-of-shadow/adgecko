import source from "../src/youtube.js" with { type: "text" };
function assert(c, label) { if (!c) throw new Error(label); }
function rig(mode) {
  const api = {};
  new Function(`${source}\nreturn installYoutubeAdblock;`)()(api);
  let t = 0; const timers = []; const log = [];
  const g = api.createErrorFlashGuard({
    mode, windowMs: 5000, revealMs: 1500, now: () => t,
    setHidden: (on) => log.push(on),
    setTimer: (f, ms) => { timers.push({ f, at: t + ms, live: true }); return timers.length; },
    clearTimer: (id) => { timers[id - 1].live = false; },
  });
  const advance = (ms) => { t += ms; for (const x of timers) if (x.live && x.at <= t) { x.live = false; x.f(); } };
  return { g, advance, hidden: () => g.state.hidden, log };
}
for (const mode of ["window", "delay", "gated"]) {
  Deno.test(`error flash ${mode}: a short start flash stays hidden`, () => {
    const r = rig(mode);
    r.g.start(); r.advance(800); r.g.errorShown();
    assert(r.hidden(), "hidden during flash");
    r.advance(400); r.g.errorGone(); r.advance(300); r.g.playing();
    assert(!r.hidden(), "released after playback");
  });
  Deno.test(`error flash ${mode}: a persistent error (unavailable video) is shown after the grace`, () => {
    const r = rig(mode);
    r.g.start(); r.advance(500); r.g.errorShown();
    r.advance(5000);
    assert(!r.hidden(), "real error visible within 5.5s");
  });
}
Deno.test("error flash delay/gated: no attribute churn on a clean start", () => {
  for (const mode of ["delay", "gated"]) {
    const r = rig(mode); r.g.start(); r.advance(2000); r.g.playing();
    assert(r.log.length === 0, mode + " never touched the DOM");
  }
});
Deno.test("error flash: a new start while an error is held never hides it for good", () => {
  for (const mode of ["window", "delay", "gated"]) {
    const r = rig(mode);
    r.g.start(); r.advance(500); r.g.errorShown();
    r.advance(1000); r.g.start();
    r.advance(5500);
    assert(!r.hidden(), mode + ": error from a failed SPA start is visible within 5.5s");
  }
});
Deno.test("error flash gated: an error after playback shows at once", () => {
  const r = rig("gated"); r.g.start(); r.advance(1000); r.g.playing(); r.advance(60000); r.g.errorShown();
  assert(!r.hidden(), "mid-play error not hidden");
});
Deno.test("error flash: wiring is opt-out and only hides via visibility", () => {
  const css = Deno.readTextFileSync(new URL("../src/youtube-ads.css", import.meta.url));
  assert(/html\[data-ta-yterr\] #movie_player \.ytp-error\s*\{\s*visibility:\s*hidden !important;?\s*\}/.test(css), "manifest CSS hides via visibility only");
  assert(/errorFlash: "(window|delay|gated)"/.test(source), "default mode set");
});
