/**
 * Emulates post-ad reloadPlayer handoff without live Twitch usher.
 *
 * The 0.1.13-style path (pin before setSrc, deferred play + HTMLVideoElement
 * nudge, second restore at 1000ms) is the known mute-latch / spinner regression.
 * Tip (0.1.15 / restored 0.1.12 shape) must pass the contract below.
 */
import pageSource from "../src/page.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mock localStorage + player.state for one reloadPlayer call. */
function createHandoffEnv(prefs = {}) {
  const store = new Map([
    ["video-quality", prefs.quality ?? '{"default":"720p60"}'],
    ["video-muted", prefs.muted ?? "false"],
    ["volume", prefs.volume ?? "0.8"],
  ]);
  const events = [];
  let writeBeforeSetSrc = 0;
  let sawSetSrc = false;

  const player = {
    play() {
      events.push("play");
    },
    getHTMLVideoElement() {
      return {
        paused: true,
        ended: false,
        play() {
          events.push("video.play");
          return Promise.resolve();
        },
      };
    },
    core: { state: { quality: { group: "720p60" }, muted: false } },
  };

  const state = {
    setSrc(opts) {
      sawSetSrc = true;
      events.push({ op: "setSrc", opts });
    },
  };

  function safeGet(key) {
    return store.has(key) ? store.get(key) : "";
  }

  function safeSet(key, value) {
    if (!sawSetSrc) writeBeforeSetSrc += 1;
    events.push({ op: "safeSet", key, value });
    store.set(key, value);
  }

  function findPlayer() {
    return { player, state };
  }

  return {
    events,
    store,
    get writeBeforeSetSrc() {
      return writeBeforeSetSrc;
    },
    findPlayer,
    safeGet,
    safeSet,
  };
}

function compileReload(fnSource) {
  return new Function(
    "findPlayer",
    "safeGet",
    "safeSet",
    "setTimeout",
    "console",
    "claimReload",
    `${fnSource}\nreturn reloadPlayer;`,
  );
}

/** Current tip shape: capture → setSrc + immediate play → single 800ms restore. */
const GOOD_RELOAD = `function reloadPlayer() {
  const found = findPlayer();
  if (!found || !found.player || !found.state) return;
  const quality = safeGet("video-quality");
  const muted = safeGet("video-muted");
  const volume = safeGet("volume");
  try {
    found.state.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
    if (typeof found.player.play === "function") found.player.play();
  } catch (error) {
    console.log("twitch-adblock reload failed", error);
    return;
  }
  setTimeout(() => {
    if (quality) safeSet("video-quality", quality);
    if (muted) safeSet("video-muted", muted);
    if (volume) safeSet("volume", volume);
  }, 800);
}`;

/**
 * 0.1.13-style regression fixture (pin before setSrc, deferred play,
 * HTMLVideoElement nudge, second restore at 1000ms).
 */
const BAD_013_RELOAD = `function reloadPlayer() {
  const found = findPlayer();
  if (!found || !found.player || !found.state) return;
  const muted = safeGet("video-muted");
  const volume = safeGet("volume");
  let quality = safeGet("video-quality");
  try {
    const group = found.player.core && found.player.core.state && found.player.core.state.quality
      ? found.player.core.state.quality.group
      : "";
    if (!quality && group) quality = JSON.stringify({ default: group });
  } catch {}
  if (quality) safeSet("video-quality", quality);
  if (muted) safeSet("video-muted", muted);
  if (volume) safeSet("volume", volume);
  try {
    found.state.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
  } catch (error) {
    console.log("twitch-adblock reload failed", error);
    return;
  }
  setTimeout(() => {
    if (quality) safeSet("video-quality", quality);
    if (muted) safeSet("video-muted", muted);
    if (volume) safeSet("volume", volume);
    const again = findPlayer();
    const player = again && again.player;
    try {
      if (player && typeof player.play === "function") player.play();
      const video = player && typeof player.getHTMLVideoElement === "function"
        ? player.getHTMLVideoElement()
        : null;
      if (video && video.paused && !video.ended) video.play().catch(() => {});
    } catch {}
  }, 0);
  setTimeout(() => {
    if (quality) safeSet("video-quality", quality);
    if (muted) safeSet("video-muted", muted);
    if (volume) safeSet("volume", volume);
  }, 1000);
}`;

function summarize(events) {
  return events.map((item) => {
    if (typeof item === "string") return item;
    if (item.op === "setSrc") return "setSrc";
    if (item.op === "safeSet") return `safeSet:${item.key}`;
    return JSON.stringify(item);
  });
}

async function runReload(fnSource, prefs) {
  const env = createHandoffEnv(prefs);
  const reloadPlayer = compileReload(fnSource)(
    env.findPlayer,
    env.safeGet,
    env.safeSet,
    setTimeout,
    { log() {} },
    () => true,
  );
  reloadPlayer();
  return env;
}

function assertGoodContract(env, labelPrefix) {
  const seq = summarize(env.events);
  assertEquals(env.writeBeforeSetSrc, 0, `${labelPrefix}: no settings pin before setSrc`);
  assert(seq[0] === "setSrc", `${labelPrefix}: setSrc is first side effect`);
  assert(seq[1] === "play", `${labelPrefix}: play runs in the same turn as setSrc`);
  assert(!seq.includes("video.play"), `${labelPrefix}: no HTMLVideoElement play nudge`);
  const sets = seq.filter((item) => item.startsWith("safeSet:"));
  assertEquals(sets.length, 0, `${labelPrefix}: no restore yet before timers`);
}

Deno.test("tip reloadPlayer source matches the good handoff contract", () => {
  const start = pageSource.indexOf("function reloadPlayer");
  const end = pageSource.indexOf("function safeGet", start);
  const block = pageSource.slice(start, end);
  assert(block.includes("setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true })"), "setSrc refreshes usher");
  assert(block.includes("found.player.play"), "immediate play after setSrc");
  assert(block.includes("}, 800);"), "single restore at 800ms");
  assert(!block.includes("getHTMLVideoElement"), "no deferred HTMLVideoElement play");
  assert(!block.includes("}, 1000);"), "no second restore at 1000ms");
  assert(!block.includes("Pin settings before setSrc"), "does not pin before setSrc");
  // Pre-setSrc safeSet of the captured prefs is the 0.1.13 latch pattern.
  const tryStart = block.indexOf("try {");
  const setSrcAt = block.indexOf("setSrc");
  const before = block.slice(0, setSrcAt);
  assert(!before.includes("safeSet("), "no safeSet before setSrc in tip source");
  assert(tryStart !== -1 && tryStart < setSrcAt, "setSrc stays inside the try");
});

Deno.test("good handoff: setSrc then immediate play; one 800ms restore", async () => {
  const env = await runReload(GOOD_RELOAD, { muted: "false", volume: "0.8" });
  assertGoodContract(env, "good");

  await delay(50);
  assertEquals(
    summarize(env.events).filter((item) => item === "play" || item === "video.play"),
    ["play"],
    "good: no deferred play after a macrotask",
  );
  assertEquals(
    summarize(env.events).filter((item) => item.startsWith("safeSet:")).length,
    0,
    "good: still no restore at 50ms",
  );

  await delay(800);
  const after = summarize(env.events);
  assert(after.includes("safeSet:video-muted"), "good: muted restored once after boot");
  assert(after.includes("safeSet:volume"), "good: volume restored once after boot");
  assert(after.includes("safeSet:video-quality"), "good: quality restored once after boot");
  assertEquals(
    after.filter((item) => item === "safeSet:video-muted").length,
    1,
    "good: muted restored exactly once",
  );

  await delay(250);
  assertEquals(
    summarize(env.events).filter((item) => item === "safeSet:video-muted").length,
    1,
    "good: no second mute rewrite around 1000ms",
  );
  assertEquals(env.store.get("video-muted"), "false", "good: unmuted preference survives");
});

Deno.test("0.1.13-style handoff fails the contract (mute latch / deferred play)", async () => {
  const env = await runReload(BAD_013_RELOAD, { muted: "false", volume: "0.8" });
  const seq = summarize(env.events);

  assert(env.writeBeforeSetSrc >= 1, "bad: pins settings before setSrc");
  assert(seq.indexOf("safeSet:video-muted") < seq.indexOf("setSrc"), "bad: mute pin before setSrc");
  assert(!seq.includes("play") || seq.indexOf("play") > seq.indexOf("setSrc"), "bad: play is not immediate with setSrc");

  await delay(50);
  const afterPlay = summarize(env.events);
  assert(afterPlay.includes("play"), "bad: play eventually runs on deferred timer");
  assert(afterPlay.includes("video.play"), "bad: HTMLVideoElement nudge runs");
  assert(
    afterPlay.filter((item) => item === "safeSet:video-muted").length >= 2,
    "bad: mute rewritten again in the deferred play timer",
  );

  await delay(1000);
  assert(
    summarize(env.events).filter((item) => item === "safeSet:video-muted").length >= 3,
    "bad: third mute rewrite at 1000ms latches preference",
  );
});

Deno.test("tip reloadPlayer compiled from source passes the good contract", async () => {
  const start = pageSource.indexOf("function reloadPlayer");
  const end = pageSource.indexOf("function safeGet", start);
  const block = pageSource.slice(start, end).trim();
  assert(block.startsWith("function reloadPlayer"), "extracted tip reloadPlayer");

  const env = await runReload(block, { muted: "false", volume: "0.5" });
  assertGoodContract(env, "tip");

  await delay(850);
  assertEquals(
    summarize(env.events).filter((item) => item === "safeSet:video-muted").length,
    1,
    "tip: single mute restore",
  );
  assertEquals(env.store.get("video-muted"), "false", "tip: unmuted preference kept");
  assert(!summarize(env.events).includes("video.play"), "tip: no video element play");
});

Deno.test("the page-wide ceiling refuses a third setSrc inside 60 s, whoever asks", () => {
  const start = pageSource.indexOf("const reloadCeiling");
  const end = pageSource.indexOf("function reloadPlayer", start);
  const ring = new Function(`${pageSource.slice(start, end)}\nreturn { reloadRoom, claimReload };`)();
  const realNow = Date.now;
  let now = 1700000000000;
  Date.now = () => now;
  try {
    assert(ring.claimReload(), "first reload allowed");
    now += 10000;
    assert(ring.claimReload(), "second reload allowed");
    now += 10000;
    assert(!ring.reloadRoom(), "no room for a third");
    assert(!ring.claimReload(), "third reload refused");
    now += 40000;
    assert(ring.claimReload(), "room again once the first one is 60 s old");
  } finally {
    Date.now = realNow;
  }
});

Deno.test("reloadPlayer asks the ceiling before setSrc and reports a refusal", () => {
  const start = pageSource.indexOf("function reloadPlayer");
  const end = pageSource.indexOf("function safeGet", start);
  const block = pageSource.slice(start, end);
  assert(block.indexOf("claimReload()") !== -1 && block.indexOf("claimReload()") < block.indexOf("found.state.setSrc"), "the ceiling is checked before setSrc");
  const env = createHandoffEnv();
  const compiled = compileReload(block.trim())(env.findPlayer, env.safeGet, env.safeSet, setTimeout, { log() {} }, () => false);
  assertEquals(compiled(), false, "a refused reload says so");
  assertEquals(summarize(env.events).filter((item) => item === "setSrc").length, 0, "a refused reload never calls setSrc");
});
