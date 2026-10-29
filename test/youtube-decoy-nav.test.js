// Resource-timing decoy evidence, late-uBO hooks stand-down and the per-navigation
// reset, end to end: the uBO bundle and youtube.js in one realm (see fixtures/youtube-decoy-run.mjs),
// plus the wait-reply reset on a virtual clock (fixtures/youtube-clock-run.mjs).
function assert(c, l) { if (!c) throw new Error(l); }

async function run(scenario) {
  const out = await new Deno.Command(Deno.execPath(), {
    env: { SCENARIO: scenario },
    args: ["run", "-A", "--location", "https://www.youtube.com/watch?v=abcdefghijk", new URL("./fixtures/youtube-decoy-run.mjs", import.meta.url).href],
    stdout: "piped", stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(new TextDecoder().decode(out.stdout).trim().split("\n").pop());
}

// The whole youtube.js on a virtual clock (fixtures/youtube-clock-run.mjs): reload times in ms.
async function clock(scenario) {
  const out = await new Deno.Command(Deno.execPath(), {
    env: { SCENARIO: scenario },
    args: ["run", "-A", new URL("./fixtures/youtube-clock-run.mjs", import.meta.url).href],
    stdout: "piped", stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(new TextDecoder().decode(out.stdout).trim().split("\n").pop());
}

// "late-hooks" writes the opts key; each run has its own localStorage (fixtures/memory-storage.mjs).
const manifest = await run("manifest");
const late = await run("late");
const lateHooks = await run("late-hooks");
const ytOnly = await run("yt");
const [prevReply, ownReply, noReply] = await Promise.all(["prev-reply", "own-reply", "no-reply"].map(clock));
const GENTLE_7 = "uBO gentle 7000ms (decoys), 1 reload max";
const GENTLE_15 = "uBO gentle 15000ms, 1 reload max";

Deno.test("resource-timing decoy evidence: logged once per navigation, arms the 7s gentle wait", () => {
  assert(manifest.observers === 1 && !manifest.ytHookedFetch, "manifest order: one read-only observer, no fetch hook " + JSON.stringify(manifest));
  assert(manifest.rtDecoyLogs === 1, "two decoy entries, one diag line: " + manifest.rtDecoyLogs);
  assert(manifest.armWithDecoy.endsWith(GENTLE_7), manifest.armWithDecoy);
});

Deno.test("resource-timing watcher: ignores non-videoplayback urls, still catches the 105-byte wait reply", () => {
  assert(manifest.rtDecoyLogsAfterImage === 1, "an image url with an old expire is not a decoy");
  assert(manifest.waitReplies === 1, "wait reply still seen: " + manifest.waitReplies);
});

Deno.test("yt-navigate-start resets the uBO decoy evidence (real handler); fresh evidence counts again", () => {
  assert(manifest.armNextNav.endsWith(GENTLE_15), "next video without decoys: 15s again: " + manifest.armNextNav);
  assert(manifest.armFreshDecoy.endsWith(GENTLE_7) && manifest.rtDecoyLogsTotal === 2, "decoy in the new navigation: 7s again: " + manifest.armFreshDecoy);
});

Deno.test("late uBO marker: hooks stand down once, one observer, hooked calls reach native untouched", () => {
  assert(late.ytHookedFetch && late.observersAtLoad === 0, "hooks decided at install, no observer yet " + JSON.stringify(late));
  assert(late.standDowns === 1, "one stand-down diag for 5 JSON.parse + 1 fetch: " + late.standDowns);
  assert(late.observers === 1, "observer installed on stand-down, exactly once: " + late.observers);
  assert(late.decoyReachedNative && late.hookDecoyLogs === 0, "decoy fetch went straight to native, no hook logic");
  assert(late.armWithDecoy.endsWith(GENTLE_7) && late.armNextNav.endsWith(GENTLE_15), "resource timing feeds the watchdog after the stand-down");
});

Deno.test("hooksUnderUbo:true with a late uBO marker: hooks stay live and their decoy evidence arms 7s", () => {
  assert(lateHooks.standDowns === 0 && lateHooks.hookDecoyLogs === 1, "no stand-down, hook saw the decoy " + JSON.stringify(lateHooks));
  assert(lateHooks.armWithDecoy.endsWith(GENTLE_7) && lateHooks.armNextNav.endsWith(GENTLE_15), lateHooks.armWithDecoy);
});

Deno.test("no uBO layer: no resource-timing observer and no stand-down", () => {
  assert(ytOnly.observers === 0 && ytOnly.standDowns === 0 && ytOnly.ytHookedFetch, JSON.stringify(ytOnly));
  assert(ytOnly.rtDecoyLogsTotal === 0 && ytOnly.armWithDecoy === "", "watchdog not armed by navigation without uBO");
});

// perfobs-bufguard review 2026-10-21, M2 and L2.
Deno.test("a resource entry that started before yt-navigate-start does not mark the new navigation", () => {
  assert(manifest.armStaleEntry.endsWith(GENTLE_15), "stale entry re-armed the 7s wait: " + manifest.armStaleEntry);
});
Deno.test("hooksUnderUbo:true with a late uBO marker still installs the read-only observer", () => {
  assert(lateHooks.observers === 1, "no observer: no wait-reply hold, no resource-timing decoys: " + lateHooks.observers);
});

// M3. Video A gets a wait reply at 1s; video B (nav 3s, armed 3.6s, first poll 3.85s) stalls.
Deno.test("yt-navigate-start clears the previous video's SABR wait reply: next video reloads on its own 15s", () => {
  assert(noReply.reloads.length === 1 && noReply.reloads[0] === 18850, "no reply: 3.85s + 15s: " + noReply.reloads);
  assert(prevReply.reloads.length === 1 && prevReply.reloads[0] === noReply.reloads[0], "video A's reply must not hold video B (was ~21.1s): " + prevReply.reloads);
  assert(!prevReply.lines.some((l) => l.includes("holding")), "no hold logged for video B");
  assert(ownReply.reloads.length === 1 && ownReply.reloads[0] === 24100, "video B's own reply at 4s still holds 20s: " + ownReply.reloads);
});
