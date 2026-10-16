// Behavior test of the progress-aware stall poller, extracted from youtube.js.
import source from "../src/youtube.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const start = source.indexOf("  let stallArmedAt = 0;");
const end = source.indexOf("  // Every fallback host failed:");
const block = source.slice(start, end);

function sim({ opts = null, onTick = () => {},  steps, hidden = () => false, classes = () => "unstarted-mode", failoverAt = () => 0, ms = 15000 }) {
  let now = 0; const timers = [];
  const video = { currentTime: 0, readyState: 1, buffered: { length: 0, end: () => 0 } };
  const loads = [];
  const player = { className: "", querySelector: () => video, loadVideoById: (id) => loads.push(now), getVideoData: () => ({ video_id: "x" }), getPlayerState: () => -1, getCurrentTime: () => 0 };
  const OPTS = { stallReload: true, stallMs: 4000, stallQuietMs: 3000, stallPollMs: 500, stallFailoverGraceMs: 2000, stallGiveUpMs: 30000, stallSecondGapMs: 6000 };
  if (opts) Object.assign(OPTS, opts);
  const doc = { get hidden() { return hidden(now); } };
  const f = new Function("Date", "setTimeout", "clearTimeout", "document", "env", `
    const OPTS = env.OPTS;
    let navAt = 0, stalledReloaded = 0, stallTimer = 0, startLogged = false, strippedThisVideo = true, mediaFailed = false;
    const onWatchSurface = () => true, playerRoot = env.playerRoot, logFailOpen = () => {}, diag = () => {}, api = { UBO_LAYER: !!env.ubo };
    let decoyThisNav = !!env.decoy, lastPlayerAt = 0;
    const console = { log() {} };
    ${block}
    return { armStall, setFailover: (t) => { lastFailoverAt = t; }, played: (id) => { playbackSeen.any = true; startedVideoId = id; stopStall(); }, renav: () => { playbackSeen.any = false; startLogged = false; stalledReloaded = 0; } };`);
  const api = f({ now: () => now }, (fn, d) => { const t = { at: now + d, fn }; timers.push(t); return t; }, (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }, doc, { playerRoot: () => player, OPTS, ubo: !!(opts && opts.ubo), decoy: !!(opts && opts.decoy) });
  api.armStall();
  while (now < ms) {
    now += 100;
    steps(now, video, player);
    onTick(now, api, video);
    player.className = classes(now);
    const fo = failoverAt(now); if (fo) api.setFailover(fo);
    for (const t of timers.filter((t) => t.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  }
  return loads;
}

Deno.test("a dead start reloads at ~4s, second reload >=6s later, max 2", () => {
  const loads = sim({ steps: () => {}, ms: 20000 });
  assert(loads.length === 2, "two reloads " + loads);
  assert(loads[0] >= 4000 && loads[0] <= 4600, "first at " + loads[0]);
  assert(loads[1] - loads[0] >= 6000 && loads[1] - loads[0] <= 6600, "second gap " + (loads[1] - loads[0]));
});
Deno.test("buffer still growing never reloads", () => {
  const loads = sim({ steps: (t, v) => { v.buffered = { length: 1, end: () => t / 4000 }; }, ms: 8000 });
  assert(loads.length === 0, "no reload " + loads);
});
Deno.test("progress stopping at 3s fires only after 3s quiet", () => {
  const loads = sim({ steps: (t, v) => { if (t < 3000) v.buffered = { length: 1, end: () => t / 1000 }; }, ms: 7000 });
  assert(loads.length === 1 && loads[0] >= 6000 && loads[0] <= 6600, "at " + loads);
});
Deno.test("REGRESSION: playback started, then stale 0:00 state, never reloads", () => {
  // Playing at 3.2s; afterwards the element we see reads 0:00 / readyState 0
  // (stale or swapped element) and a same-video yt-navigate resets flags.
  const loads = sim({
    steps: (t, v) => { v.currentTime = 0; v.readyState = 0; },
    onTick: (t, api) => { if (t === 3200) api.played("x"); if (t === 3400) { api.renav(); api.armStall(); } },
    ms: 25000,
  });
  assert(loads.length === 0, "reloaded after playback started: " + loads);
});
Deno.test("readyState 2 or player playing counts as moving; unpaused-but-empty does not", () => {
  assert(sim({ steps: (t, v) => { v.readyState = 2; } }).length === 0, "readyState 2");
  assert(sim({ steps: (t, v) => { v.paused = false; }, ms: 6000 }).length === 1, "unpaused but stuck at readyState 1 is still a stall");
  assert(sim({ steps: (t, v, p) => { p.getPlayerState = () => 1; } }).length === 0, "player state playing");
});
Deno.test("playing video, ads, hidden tab, user pause, failover retry hold off", () => {
  assert(sim({ steps: (t, v) => { if (t > 1000) v.currentTime = 0.5; } }).length === 0, "playing");
  assert(sim({ steps: () => {}, classes: () => "ad-showing" }).length === 0, "ad");
  assert(sim({ steps: () => {}, hidden: () => true }).length === 0, "hidden");
  assert(sim({ steps: (t, v, p) => { p.getPlayerState = () => 2; }, classes: () => "paused-mode" }).length === 0, "user paused");
  const l = sim({ steps: () => {}, failoverAt: (t) => (t <= 4000 ? t : 0), ms: 9000 });
  assert(l.length >= 1 && l[0] >= 7000, "waits for failover, fired " + l);
});

const SRC_OPTS = JSON.parse(source.match(/const OPTS = (\{ noAdFlag[^}]*\})/)[1].replace(/(\w+):/g, '"$1":'));
Deno.test("shipped timing: dead start reloads within ~2.5s, second >=5s later, max 2", () => {
  const loads = sim({ opts: SRC_OPTS, steps: () => {}, ms: 20000 });
  assert(loads.length === 2, "two reloads " + loads);
  assert(loads[0] >= 2000 && loads[0] <= 2600, "first at " + loads[0]);
  const gap = loads[1] - loads[0];
  assert(gap >= 5000 && gap <= 5600, "second gap " + gap);
});
Deno.test("shipped timing: slow-but-loading start is not reloaded", () => {
  const loads = sim({ opts: SRC_OPTS, steps: (t, v) => { v.buffered = { length: 1, end: () => t / 4000 }; }, ms: 8000 });
  assert(loads.length === 0, "no reload " + loads);
});
Deno.test("shipped timing: ad showing holds the clock", () => {
  const loads = sim({ opts: SRC_OPTS, steps: () => {}, classes: (t) => (t < 5000 ? "ad-showing" : "unstarted-mode"), ms: 6000 });
  assert(loads.length === 0, "no reload during/just after ad " + loads);
});

Deno.test("uBO layer, no media failure: watchdog waits stallUboMs (SPA buffering is not reloaded at 2s)", () => {
  const loads = sim({ opts: { ...SRC_OPTS, stallUnderUbo: true, ubo: true }, steps: () => {}, ms: 20000 });
  assert(loads.length >= 1 && loads[0] >= SRC_OPTS.stallUboMs && loads[0] <= SRC_OPTS.stallUboMs + 700 && SRC_OPTS.stallUboMs >= 10000, "first at " + loads);
});
Deno.test("uBO layer, slow but loading SPA start is never reloaded", () => {
  const loads = sim({ opts: { ...SRC_OPTS, stallUnderUbo: true, ubo: true }, steps: (t, v) => { v.buffered = { length: 1, end: () => t / 4000 }; }, ms: 14000 });
  assert(loads.length === 0, "no reload " + loads);
});

Deno.test("uBO layer: floor holds even when media failed earlier; decoys too (eb034fd)", () => {
  const plain = sim({ opts: { ...SRC_OPTS, stallUnderUbo: true, ubo: true }, steps: () => {}, ms: 12000 });
  assert(plain.length === 1 && plain[0] >= SRC_OPTS.stallUboMs, "floor " + plain);
  const decoy = sim({ opts: { ...SRC_OPTS, stallUnderUbo: true, ubo: true, decoy: true }, steps: () => {}, ms: 12000 });
  assert(decoy.length === 1 && decoy[0] >= SRC_OPTS.stallUboMs, "decoy under uBO still waits the floor " + decoy);
  const noUbo = sim({ opts: { ...SRC_OPTS, decoy: true }, steps: () => {}, ms: 9000 });
  assert(noUbo.length >= 1 && noUbo[0] < 3000, "no uBO: fast path kept " + noUbo);
});

Deno.test("uBO layer: no 2nd reload once /player answered after reload 1", () => {
  const src = source.slice(source.indexOf("  let stallArmedAt = 0;"), source.indexOf("  // Every fallback host failed:"));
  assert(/stalledReloaded >= 1 && lastPlayerAt > lastReloadAt\) \{[^}]*return stopStall\(\);/.test(src), "guard present in checkStall");
});

Deno.test("uBO layer: decoy does not trigger the fast reload, with a diag line", () => {
  const i = source.indexOf("function onDecoyUrl(");
  const head = source.slice(i, i + 600);
  assert(/if \(api\.UBO_LAYER\) \{[^}]*decoy seen, uBO present: not reloading[^}]*return;/.test(head), "uBO early return");
  assert(head.indexOf("return;") < head.indexOf("decoyThisNav = true"), "flag only set without uBO");
});

Deno.test("uBO layer, shipped default: our watchdog never reloads (rpnt handles the wait; 8b4ba14 full loads)", () => {
  const loads = sim({ opts: { ...SRC_OPTS, ubo: true }, steps: () => {}, ms: 20000 });
  assert(SRC_OPTS.stallUnderUbo === false && loads.length === 0, "reloads " + loads);
});
