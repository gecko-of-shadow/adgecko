// Behavior test of the uBO gentle watchdog's decoy path (decoyGentleMs, decoyBufGuard,
// decoyNavFloor) and its log lines, extracted from youtube.js like stall.test.js.
import source from "../src/youtube.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const start = source.indexOf("  let stallArmedAt = 0;");
const end = source.indexOf("  // Every fallback host failed:");
const block = source.slice(start, end);
const SRC_OPTS = JSON.parse(source.match(/const OPTS = (\{ noAdFlag[^}]*\})/)[1].replace(/(\w+):/g, '"$1":'));
const UBO = { ...SRC_OPTS, ubo: true };

// opts.ubo: uBO layer live. opts.decoy: the non-uBO decoyThisNav flag.
// preDecoy: uBO decoy evidence before the watchdog arms. onTick(t, api, video) can call
// api.uboDecoy() (evidence arrives later), api.mediaEvent(t) (a <video> progress event),
// api.waitReply(t) or api.navigate(t). Returns reload times plus .logs, .scheduled and .pending.
function sim({ opts = UBO, onTick = () => {}, steps = () => {}, preDecoy = false, ms = 30000 }) {
  let now = 0; const timers = []; const logs = [];
  const video = { currentTime: 0, readyState: 1, buffered: { length: 0, end: () => 0 } };
  const loads = [];
  const player = { className: "", querySelector: () => video, loadVideoById: () => loads.push(now), getVideoData: () => ({ video_id: "x" }), getPlayerState: () => -1, getCurrentTime: () => 0 };
  const f = new Function("Date", "setTimeout", "clearTimeout", "document", "env", `
    // Block I: page-console logs need OPTS.diag (now off in the shipped
    // defaults); this harness reads them, so it turns diag on.
    const OPTS = Object.assign({}, env.OPTS, { diag: true });
    let navAt = 0, stalledReloaded = 0, stallTimer = 0, startLogged = false, strippedThisVideo = true, mediaFailed = false;
    const onWatchSurface = () => true, playerRoot = env.playerRoot, logFailOpen = () => {}, diag = (m) => env.logs.push("diag " + m), api = { UBO_LAYER: !!env.ubo, lastWaitReplyAt: env.waitAt || 0 };
    let decoyThisNav = !!env.decoy, lastPlayerAt = 0;
    const console = { log: (...a) => env.logs.push(a.join(" ")) };
    ${block}
    // The real clock is epoch ms, so lastFailoverAt = 0 never holds; on this 0-based clock it would hold the first 1s.
    lastFailoverAt = -1e9;
    return { armStall, uboDecoy: () => { uboDecoyThisNav = true; }, mediaEvent: (t) => { lastMediaEventAt = t; }, waitReply: (t) => { api.lastWaitReplyAt = t; },
      // yt-navigate-start's resets (waitHoldStartAt is not one of them), then yt-navigate-finish's arm.
      navigate: (t) => { navAt = t; stalledReloaded = 0; startLogged = false; playbackSeen.any = false; lastReloadAt = 0; lastMediaEventAt = 0; uboDecoyThisNav = false; api.lastWaitReplyAt = 0; stopStall(); armStall(); } };`);
  let scheduled = 0;
  const api = f({ now: () => now }, (fn, d) => { scheduled++; const t = { at: now + d, fn }; timers.push(t); return t; }, (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); }, { hidden: false }, { playerRoot: () => player, OPTS: opts, ubo: !!opts.ubo, decoy: !!opts.decoy, waitAt: opts.waitAt, logs });
  if (preDecoy) api.uboDecoy();
  api.armStall();
  while (now < ms) {
    now += 100;
    steps(now, video, player);
    onTick(now, api, video);
    for (const t of timers.filter((t) => t.at <= now)) { timers.splice(timers.indexOf(t), 1); t.fn(); }
  }
  loads.logs = logs;
  loads.scheduled = scheduled;
  loads.pending = timers.length;
  return loads;
}
// A 2026-10-20 field log: decoys blocked at ~1.4s, last <video> progress event at 1947ms.
const ownerLog = (t, api) => { if (t === 1500) api.uboDecoy(); if (t === 1900) api.mediaEvent(1947); };
const staticBuffer = (from, seconds) => (t, v) => { if (t >= from) v.buffered = { length: 1, end: () => seconds }; };
// The 250ms poll fires on this sim's 100ms ticks, so polls land every 300ms.
const POLL = 300;
// The field log as base saw it in late order: no observer, so no decoy path and no wait-reply hold.
const BASE_LOG = sim({ onTick: (t, api) => { if (t === 1900) api.mediaEvent(1947); } })[0];
// First decoy-path poll on the field log (last progress counted at the 2100 poll, + decoyGentleMs).
const LOG_GATE = 2100 + SRC_OPTS.decoyGentleMs;
// The field log + a wait reply every `every` ms from 3.4s.
const ownerLogWaits = (every) => (t, api) => { ownerLog(t, api); if (t >= 3400 && (t - 3400) % every === 0) api.waitReply(t); };
const near = (got, want, slack = 600) => got >= want && got <= want + slack;

Deno.test("shipped decoy options: 7s decoy wait, buffer guard on, no 10s nav floor, short capped wait-reply hold", () => {
  assert(SRC_OPTS.decoyGentleMs === 7000 && SRC_OPTS.decoyBufGuard === true && SRC_OPTS.decoyNavFloor === false, JSON.stringify(SRC_OPTS));
  assert(SRC_OPTS.decoyGentleMs < SRC_OPTS.stallUboMs && SRC_OPTS.stallUboMs < SRC_OPTS.stallGentleMs, "7s < 10s floor < 15s gentle");
  // H1: the decoy path's wait-reply hold is short, and gate + cap never passes the plain gentle wait.
  assert(SRC_OPTS.decoyWaitHoldMs === 10000 && SRC_OPTS.decoyWaitHoldMs < SRC_OPTS.waitReplyHoldMs, "10s decoy hold " + SRC_OPTS.decoyWaitHoldMs);
  assert(SRC_OPTS.decoyWaitCapMs > 0 && SRC_OPTS.decoyGentleMs + SRC_OPTS.decoyWaitCapMs <= SRC_OPTS.stallGentleMs, "7s gate + cap <= 15s: " + SRC_OPTS.decoyWaitCapMs);
});

Deno.test("uBO gentle, decoys seen, nothing buffered: one reload ~7s after the last progress, before the 10s floor", () => {
  const dead = sim({ onTick: (t, api) => { if (t === 1500) api.uboDecoy(); } });
  assert(dead.length === 1 && dead[0] >= 7000 && dead[0] <= 7600, "dead start: ~7s, got " + dead);
  const log = sim({ onTick: ownerLog });
  assert(log.length === 1 && log[0] >= 8947 && log[0] <= 9600 && log[0] < SRC_OPTS.stallUboMs, "field log replay: ~9s (was ~17s), got " + log);
});

Deno.test("uBO gentle, decoys seen but media buffered: keeps the full 15s wait", () => {
  const early = sim({ steps: staticBuffer(100, 0.5), preDecoy: true });
  assert(early.length === 1 && early[0] >= 15000 && early[0] <= 15700, "0.5s buffered from the start: ~15s, got " + early);
  const later = sim({ steps: staticBuffer(3000, 0.5), onTick: ownerLog });
  assert(later.length === 1 && later[0] >= 18000 && later[0] <= 18700, "buffered at 3s, then stuck: 15s after that, got " + later);
});

Deno.test("uBO gentle, no decoys: timing unchanged (15s gentle wait, one reload)", () => {
  const dead = sim({});
  assert(dead.length === 1 && dead[0] >= 15000 && dead[0] <= 15700, "dead start: ~15s, got " + dead);
  const log = sim({ onTick: (t, api) => { if (t === 1900) api.mediaEvent(1947); } });
  assert(log.length === 1 && log[0] >= 16947 && log[0] <= 17600, "field log without decoys: ~17s as before, got " + log);
});

Deno.test("decoy evidence that arrives after 7s of quiet fires at the next poll", () => {
  const loads = sim({ onTick: (t, api) => { if (t === 12000) api.uboDecoy(); } });
  assert(loads.length === 1 && loads[0] >= 12000 && loads[0] <= 12400, "reload right after the evidence: " + loads);
});

Deno.test("decoy options switch off: decoyBufGuard:false, decoyGentleMs:0, decoyNavFloor:true", () => {
  const noGuard = sim({ opts: { ...UBO, decoyBufGuard: false }, steps: staticBuffer(100, 0.5), preDecoy: true });
  assert(noGuard.length === 1 && noGuard[0] >= 7000 && noGuard[0] <= 7600, "guard off: 7s even when buffered, got " + noGuard);
  const off = sim({ opts: { ...UBO, decoyGentleMs: 0 }, preDecoy: true });
  assert(off.length === 1 && off[0] >= 15000 && off[0] <= 15700, "decoyGentleMs 0: back to 15s, got " + off);
  const floor = sim({ opts: { ...UBO, decoyNavFloor: true }, preDecoy: true });
  assert(floor.length === 1 && floor[0] >= SRC_OPTS.stallUboMs && floor[0] <= SRC_OPTS.stallUboMs + 600, "nav floor kept: ~10s, got " + floor);
});

Deno.test("decoy path does not touch stallUnderUbo:true or stallUnderUbo:false", () => {
  const strict = sim({ opts: { ...UBO, stallUnderUbo: true }, preDecoy: true });
  assert(strict.length >= 1 && strict[0] >= SRC_OPTS.stallUboMs && strict[0] <= SRC_OPTS.stallUboMs + 600, "non-gentle: 10s floor as before, got " + strict);
  const off = sim({ opts: { ...UBO, stallUnderUbo: false }, preDecoy: true });
  assert(off.length === 0, "watchdog off under uBO: no reload " + off);
});

Deno.test("decoys + nothing buffered: a SABR wait reply holds only decoyWaitHoldMs, still before base", () => {
  // Live runs saw a 105-byte wait reply ~1.5-3.4s into most uBO starts. The full
  // 20s hold made a stall like the field log's reload at ~21.7s (H1); the decoy hold ends at ~11.7s.
  const held = sim({ opts: { ...UBO, waitAt: 1700 }, onTick: ownerLog });
  assert(held.length === 1 && near(held[0], 1700 + SRC_OPTS.decoyWaitHoldMs) && held[0] < BASE_LOG, "held to ~11.7s, base " + BASE_LOG + ": " + held);
  const later = sim({ opts: { ...UBO, waitAt: 3400 }, onTick: ownerLog });
  assert(later.length === 1 && near(later[0], 3400 + SRC_OPTS.decoyWaitHoldMs) && later[0] < BASE_LOG, "reply at 3.4s: ~13.4s: " + later);
  assert(held.logs.some((l) => l.includes("SABR wait reply") && l.includes("holding")), "the hold is logged");
});

Deno.test("decoys + nothing buffered + steady wait replies: one reload decoyWaitCapMs after the gate, never after base", () => {
  for (const every of [2000, 4000, 5000]) {
    const loads = sim({ onTick: ownerLogWaits(every) });
    assert(loads.length === 1 && near(loads[0], LOG_GATE + SRC_OPTS.decoyWaitCapMs) && loads[0] <= BASE_LOG + POLL, "reply every " + every + "ms: capped at gate + cap, base " + BASE_LOG + ": " + loads);
    assert(loads.logs.some((l) => l.includes("wait-reply hold capped after")), "the cap is logged");
  }
});

Deno.test("decoyWaitCapMs 6000 vs 8000 on steady replies: 6000 beats base by ~2s, 8000 lands on base's gentle time", () => {
  const six = sim({ opts: { ...UBO, decoyWaitCapMs: 6000 }, onTick: ownerLogWaits(4000) });
  const eight = sim({ opts: { ...UBO, decoyWaitCapMs: 8000 }, onTick: ownerLogWaits(4000) });
  assert(six.length === 1 && near(six[0], LOG_GATE + 6000) && six[0] <= BASE_LOG - 1500, "6000: ~15.1s vs base " + BASE_LOG + ": " + six);
  assert(eight.length === 1 && near(eight[0], LOG_GATE + 8000) && eight[0] <= BASE_LOG + POLL, "8000: base's time within one poll, base " + BASE_LOG + ": " + eight);
});

Deno.test("wait-reply hold stays 20s off the decoy path: no decoys, or decoys with media buffered (no cap there)", () => {
  const plain = sim({ opts: { ...UBO, waitAt: 1700 }, onTick: (t, api) => { if (t === 1900) api.mediaEvent(1947); } });
  assert(plain.length === 1 && near(plain[0], 1700 + SRC_OPTS.waitReplyHoldMs), "no decoys: ~21.7s as before: " + plain);
  const buffered = sim({ opts: { ...UBO, waitAt: 1700 }, preDecoy: true, steps: staticBuffer(100, 0.5) });
  assert(buffered.length === 1 && near(buffered[0], 1700 + SRC_OPTS.waitReplyHoldMs), "decoys + buffered: ~21.7s: " + buffered);
  const steady = sim({ preDecoy: true, steps: staticBuffer(100, 0.5), onTick: (t, api) => { if (t >= 3400 && (t - 3400) % 4000 === 0) api.waitReply(t); } });
  assert(steady.length === 0, "decoys + buffered + steady replies: not capped, gives up: " + steady);
});

Deno.test("decoy wait-reply switches: decoyWaitHoldMs:0 keeps the cap, decoyWaitCapMs:0 keeps the 10s hold, both 0 is the 20s hold", () => {
  const one = (o) => sim({ opts: { ...UBO, waitAt: 1700, ...o }, onTick: ownerLog });
  const steady = (o) => sim({ opts: { ...UBO, ...o }, onTick: ownerLogWaits(4000) });
  const holdOff = one({ decoyWaitHoldMs: 0 });
  assert(holdOff.length === 1 && near(holdOff[0], LOG_GATE + SRC_OPTS.decoyWaitCapMs), "hold 0: the 20s hold, cut at gate + cap: " + holdOff);
  const capOff = one({ decoyWaitCapMs: 0 });
  assert(capOff.length === 1 && near(capOff[0], 1700 + SRC_OPTS.decoyWaitHoldMs), "cap 0: 10s hold: " + capOff);
  assert(steady({ decoyWaitCapMs: 0 }).length === 0, "cap 0 + steady replies: no reload");
  const both = one({ decoyWaitHoldMs: 0, decoyWaitCapMs: 0 });
  assert(both.length === 1 && near(both[0], 1700 + SRC_OPTS.waitReplyHoldMs), "both 0: 20s hold (~21.7s): " + both);
  assert(steady({ decoyWaitHoldMs: 0, decoyWaitCapMs: 0 }).length === 0, "both 0 + steady replies: no reload");
});

Deno.test("decoy wait-reply cap clock restarts on each navigation", () => {
  const waitsEvery2s = (navStart) => (t, api) => { if (t === navStart + 1500) api.uboDecoy(); if (t >= navStart + 3400 && (t - navStart - 3400) % 2000 === 0) api.waitReply(t); };
  const nav1 = waitsEvery2s(0);
  const nav2 = waitsEvery2s(20000);
  const loads = sim({ onTick: (t, api) => { if (t === 20000) api.navigate(t); (t < 20000 ? nav1 : nav2)(t, api); }, ms: 45000 });
  // Nav 2: armed at 20s, last progress at the 20.3s poll, so the gate opens at 27.3s.
  const gate2 = 20300 + SRC_OPTS.decoyGentleMs;
  assert(loads.length === 2 && near(loads[0], 300 + SRC_OPTS.decoyGentleMs + SRC_OPTS.decoyWaitCapMs), "nav 1: capped reload: " + loads);
  assert(near(loads[1], gate2 + SRC_OPTS.decoyWaitCapMs), "nav 2: its own gate + cap, not nav 1's clock (" + gate2 + "): " + loads);
});

Deno.test("property: decoys + nothing buffered, any wait-reply pattern: one reload, never later than base (within one poll)", () => {
  let seed = 0x5eed;
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let r = Math.imul(seed ^ (seed >>> 15), 1 | seed); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  const bare = sim({})[0];
  for (let run = 0; run < 150; run++) {
    const withLog = rand() < 0.5;
    const replies = Array.from({ length: Math.floor(rand() * 9) }, () => Math.round(rand() * 300) * 100);
    const base = withLog ? BASE_LOG : bare;
    const onTick = (t, api) => { if (t === 1500) api.uboDecoy(); if (withLog && t === 1900) api.mediaEvent(1947); if (replies.includes(t)) api.waitReply(t); };
    for (const cap of [SRC_OPTS.decoyWaitCapMs, 6000, 8000]) {
      const loads = sim({ opts: { ...UBO, decoyWaitCapMs: cap }, onTick });
      assert(loads.length === 1 && loads[0] <= base + POLL, "cap " + cap + ", log " + withLog + ", replies " + replies + ": " + loads + " vs base " + base);
    }
  }
});

Deno.test("decoys seen, slow start trickling real media: no reload (8s and 12s gaps)", () => {
  for (const gap of [8000, 12000]) {
    const loads = sim({ preDecoy: true, steps: (t, v) => { const n = Math.floor((t - 1900) / gap) + 1; if (t >= 1900) v.buffered = { length: 1, end: () => n * 0.5 }; } });
    assert(loads.length === 0, "gap " + gap + ": buffered end grows, never a reload: " + loads);
  }
});

Deno.test("decoys seen, buffer stays empty, only <video> progress events every 8s: reloads at ~9s (known trade-off)", () => {
  const loads = sim({ preDecoy: true, onTick: (t, api) => { if (t >= 1900 && (t - 1900) % 8000 === 0) api.mediaEvent(t + 47); } });
  assert(loads.length === 1 && loads[0] >= 8947 && loads[0] <= 9600, "empty buffer counts as decoy-broken: " + loads);
});

Deno.test("decoy path: unreadable video.buffered counts as nothing buffered", () => {
  const loads = sim({ preDecoy: true, steps: (t, v) => { Object.defineProperty(v, "buffered", { configurable: true, get() { throw new Error("detached"); } }); } });
  assert(loads.length === 1 && loads[0] >= 7000 && loads[0] <= 7600, "throws -> 0 -> 7s: " + loads);
});

Deno.test("decoy path: polling stays bounded and stops after its one reload", () => {
  const maxPolls = SRC_OPTS.stallGiveUpMs / SRC_OPTS.stallPollMs + 5;
  const dead = sim({ preDecoy: true, ms: 40000 });
  assert(dead.length === 1 && dead.pending === 0 && dead.scheduled <= maxPolls, "one reload, no timer left: " + dead + " pending " + dead.pending + " scheduled " + dead.scheduled);
  const waits = sim({ preDecoy: true, onTick: (t, api) => { if (t % 5000 === 0) api.waitReply(t); }, ms: 40000 });
  // Last progress at the 300ms poll: the gate opens at 7.3s and the cap runs from there.
  assert(waits.length === 1 && near(waits[0], 300 + SRC_OPTS.decoyGentleMs + SRC_OPTS.decoyWaitCapMs) && waits.pending === 0 && waits.scheduled <= maxPolls, "steady wait replies: one capped reload, no timer left: " + waits + " pending " + waits.pending + " scheduled " + waits.scheduled);
  const uncapped = sim({ opts: { ...UBO, decoyWaitCapMs: 0 }, preDecoy: true, onTick: (t, api) => { if (t % 5000 === 0) api.waitReply(t); }, ms: 40000 });
  assert(uncapped.length === 0 && uncapped.pending === 0 && uncapped.scheduled <= maxPolls, "cap off: gives up at stallGiveUpMs, scheduled " + uncapped.scheduled);
});

Deno.test("reload log counts against the real cap: (1/1) under uBO gentle, (n/2) otherwise", () => {
  const gentle = sim({ preDecoy: true });
  const line = gentle.logs.find((l) => l.includes("reloading the video"));
  assert(line && line.endsWith("reloading the video (1/1)"), "uBO gentle allows one reload: " + line);
  assert(!gentle.logs.some((l) => l.includes("(1/2)")), "no (1/2) under uBO gentle");
  const plain = sim({ opts: SRC_OPTS, ms: 20000 });
  const lines = plain.logs.filter((l) => l.includes("reloading the video"));
  assert(lines.length === 2 && lines[0].endsWith("(1/2)") && lines[1].endsWith("(2/2)"), "no uBO: two reloads " + lines);
  const strict = sim({ opts: { ...UBO, stallUnderUbo: true }, ms: 25000 });
  assert(strict.logs.filter((l) => l.includes("reloading the video"))[0].endsWith("(1/2)"), "stallUnderUbo:true keeps 2");
  assert(gentle.logs.some((l) => l.includes("reload reason:") && l.includes("uboDecoys=true")), "reload reason names the uBO decoy evidence");
});

Deno.test("watchdog armed log states the real wait instead of 'uBO floor 10000ms'", () => {
  const armed = (o) => sim({ ms: 200, ...o }).logs.find((l) => l.includes("stall watchdog armed"));
  assert(armed({}).endsWith("uBO gentle 15000ms, 1 reload max"), armed({}));
  assert(armed({ preDecoy: true }).endsWith("uBO gentle 7000ms (decoys), 1 reload max"), armed({ preDecoy: true }));
  assert(armed({ opts: { ...UBO, stallUnderUbo: true } }).endsWith("uBO floor 10000ms"), armed({ opts: { ...UBO, stallUnderUbo: true } }));
  assert(armed({ opts: SRC_OPTS }).endsWith("stall watchdog armed"), "no uBO: no suffix " + armed({ opts: SRC_OPTS }));
});
