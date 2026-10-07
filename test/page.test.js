import source from "../src/page.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

Deno.test("the worker prelude installs the playlist on globalThis", () => {
  assert(
    source.includes("installTwitchAdblockPlaylist(globalThis.TwitchAdblockPlaylist = {})"),
    "worker prelude must assign globalThis.TwitchAdblockPlaylist",
  );
  assert(
    !source.includes("const TwitchAdblockPlaylist = {}"),
    "a const binding is not visible as globalThis.TwitchAdblockPlaylist",
  );
});

Deno.test("the gql reply keeps the worker after the event finishes", () => {
  assert(source.includes("const worker = event.currentTarget;"), "capture the worker before pageGql");
  assert(!source.includes("event.currentTarget.postMessage"), "currentTarget is null after the await");
});

Deno.test("fail-open clones a Request before the body is used", () => {
  assert(source.includes("const replay = input instanceof Request ? input.clone() : input;"), "page fetch keeps a replayable request");
  assert(source.includes("const replay = typeof Request !== \"undefined\" && input instanceof Request ? input.clone() : input;"), "worker fetch keeps a replayable request");
});

Deno.test("a failed variant probe does not count as a clean backup", () => {
  assert(source.includes("if (!response.ok) continue;"), "a missing rung is not a clean stream");
  assert(source.includes('if (!body.startsWith("#EXTM3U")) continue;'), "a non-playlist body is not a clean stream");
  assert(source.includes("return playlist.hasAdBreak(masterText) || null;"), "a master with no variant is not a clean stream");
  assert(source.includes("if (probe === null || probe === true) return null;"), "skip a backup that did not load or still has ads");
  assert(source.includes("session.tried.clear();"), "a good backup can be chosen again after the retry window");
});

Deno.test("sampleHasAds stops on the first clean quality playlist", () => {
  const start = source.indexOf("async function sampleHasAds");
  const end = source.indexOf("async function backupMaster", start);
  const sample = source.slice(start, end);
  assert(sample.includes("return false;"), "a clean rung ends the probe early");
  assert(sample.includes("if (variants[0]) enqueue(variants[0]);"), "the first listed rung is preferred");
  assert(sample.includes("knownUrl"), "a known media body is reused when present");
});

Deno.test("playback rewrite gates on the gql url before reading a Request body", () => {
  assert(source.includes('if (!url.includes("gql")) return { input, init };'), "page skips body read for non-gql fetches");
  const workerStart = source.indexOf("function startTwitchAdblockWorker");
  const workerFetch = source.slice(workerStart);
  assert(workerFetch.includes('if (url.includes("gql"))'), "worker gates body read on gql");
  assert(
    workerFetch.indexOf('if (url.includes("gql"))') < workerFetch.indexOf("input.clone().text()"),
    "worker reads the Request body only after the gql check",
  );
});

Deno.test("backup graphql uses only headers gql.twitch.tv allows", () => {
  assert(!source.includes("X-Twitch-Adblock"), "that header is not in Access-Control-Allow-Headers");
  assert(!source.includes('defineProperty(document, "visibilityState"'), "Twitch reads document.hidden, not this spoof");
});

Deno.test("backup player types match video-swap-new try order", () => {
  assert(
    source.includes('const backupTypes = ["autoplay", "picture-by-picture", "embed"];'),
    "try autoplay then picture-by-picture then embed",
  );
  assert(!source.includes("mobile_web"), "does not request a mobile web backup");
  assert(
    source.includes('platform: playerType === "autoplay" ? "android" : "web"'),
    "autoplay tokens use the android platform",
  );
  assert(source.includes("findCleanBackup"), "backup probes run together for a faster handoff");
  assert(source.includes("backupMatchScore"), "a clean backup is scored against the live ladder");
  assert(source.includes("handoffGraceMs"), "a short grace window can pick a better quality peer");
  assert(source.includes("scheduleReload"), "reload waits for the clean playlist response");
  assert(source.includes('setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true })'), "usher switches via setSrc");
  assert(source.includes("}, 800);"), "settings are restored after the new instance boots");
});

Deno.test("a conflict with another Twitch ad script is logged once", () => {
  assert(source.includes("warnConflictOnce"), "detect another fetch/Worker patcher");
  assert(source.includes("__twitchAdblockConflictWarned"), "log the conflict warning only once");
  assert(source.includes("twitch-videoad"), "the warning names the common uBlock script");
});

Deno.test("the blocking label counts midrolls in this tab session", () => {
  assert(source.includes("noticeBlocks"), "session counter lives only in memory");
  assert(source.includes("Blocking ads (${noticeBlocks})"), "label shows the in-session count");
  assert(source.includes("if (!noticeOn) noticeBlocks += 1"), "count rises once per blocking streak");
});

Deno.test("a picture-by-picture token request is dropped before the chat mini player opens", () => {
  const start = source.indexOf("function rewritePlaybackBody");
  const rewritePlaybackBody = new Function(`${source.slice(start)}\nreturn rewritePlaybackBody;`)();
  const onlyPip = JSON.stringify({ operationName: "PlaybackAccessToken", variables: { playerType: "picture-by-picture" } });
  assertEquals(rewritePlaybackBody(onlyPip).body, "");
  const batch = JSON.stringify([
    { operationName: "PlaybackAccessToken", variables: { playerType: "site", login: "Some_Channel" } },
    { operationName: "PlaybackAccessToken", variables: { playerType: "picture-by-picture", login: "Some_Channel" } },
  ]);
  const kept = JSON.parse(rewritePlaybackBody(batch).body);
  assertEquals(kept.length, 1);
  assertEquals(kept[0].variables.playerType, "popout");
  assertEquals(kept[0].variables.login, "Some_Channel");
});

Deno.test("a midroll variant is answered with the backup stream", () => {
  assert(source.includes("const streamByUrl = new Map();"), "variant urls stay tied to the channel");
  assert(source.includes("if (!session.reloadedForBackup)"), "reload once when the player is already on the ad playlist");
  assert(source.includes("session.mainVariantUrl"), "the main variant is checked so playback can return");
  assert(source.includes("json.streamPlaybackAccessToken"), "embed tokens may sit on the response root");
  assert(source.includes("await env.gql(body)"), "backup tokens use the original gql fetch");
  assert(source.includes('await nativeFetch("https://gql.twitch.tv/gql"'), "page gql does not go through the hooked fetch");
});

Deno.test("a background tab stays visible to the player", () => {
  assert(source.includes('defineProperty(document, "hidden"'), "Twitch pauses when document.hidden is true");
  assert(source.includes("lowLatencyModeEnabled"), "a reload keeps the low-latency setting");
});

Deno.test("reloadPlayer still refreshes when the stalled player reports paused", () => {
  const start = source.indexOf("function reloadPlayer");
  const end = source.indexOf("function safeGet", start);
  const block = source.slice(start, end);
  assert(block.includes("setSrc"), "reload still refreshes the player source");
  assert(!block.includes("isPaused"), "do not skip reload when a midroll stall looks paused");
});

Deno.test("visibilitychange does not block Twitch chat reconnect listeners", () => {
  const start = source.indexOf('document.addEventListener("visibilitychange"');
  assert(start !== -1, "visibilitychange listener exists");
  const block = source.slice(start, start + 350);
  assert(!block.includes("stopImmediatePropagation"), "do not swallow other visibilitychange listeners after player reload");
  assert(block.includes("video.play()"), "still resume a paused video when the tab changes");
});

Deno.test("only player-looking workers get the playlist prelude", () => {
  assert(source.includes("isPlayerWorkerSource"), "gate worker injection on source markers");
  assert(source.includes("usher.ttvnw.net") || source.includes("PlaybackAccessToken"), "player markers include live HLS or token strings");
  const workerCtor = source.slice(source.indexOf("function TwitchAdblockWorker"), source.indexOf("TwitchAdblockWorker.prototype"));
  assert(workerCtor.includes("isPlayerWorkerSource(source)"), "non-player blob workers stay native");
});

Deno.test("scheduleReload coalesces to one player reload per turn", () => {
  const start = source.indexOf("function scheduleReload");
  const end = source.indexOf("function backupMatchScore", start);
  const block = source.slice(start, end);
  assert(block.includes("reloadQueued"), "a second scheduleReload in the same turn is ignored");
  assert(block.includes("setTimeout"), "reload waits a macrotask so the playlist Response lands first");
  assert(!block.includes("queueMicrotask"), "a microtask would setSrc before the fetch resolves");
});

Deno.test("reloadPlayer always resets src after a midroll handoff", () => {
  const start = source.indexOf("function reloadPlayer");
  const end = source.indexOf("function safeGet", start);
  const block = source.slice(start, end);
  assert(block.includes('setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true })'), "usher switches via setSrc");
  assert(!block.includes("isPaused()"), "a paused buffering spinner must still reset");
  assert(block.includes("found.player.play"), "playback is nudged immediately after setSrc");
  // 0.1.13 latched mute / spinner: pin before setSrc, deferred HTMLVideoElement play, 1000ms rewrite.
  assert(!block.includes("getHTMLVideoElement"), "no deferred HTMLVideoElement play after setSrc");
  assert(!block.includes("}, 1000);"), "no second settings rewrite at 1000ms");
  const setSrcAt = block.indexOf("setSrc");
  assert(setSrcAt !== -1 && !block.slice(0, setSrcAt).includes("safeSet("), "do not pin settings before setSrc");
});

Deno.test("player maps and worker waits do not live for the whole tab", () => {
  assert(source.includes("const variantLimit = 64;"), "a channel keeps a bounded set of variant urls");
  assert(source.includes("sessions.delete(channel)"), "a finished channel session is removed");
  assert(source.includes("const sessionTtl = 120000;"), "an idle channel session expires");
  assert(source.includes("URL.revokeObjectURL(blobUrl)"), "the player worker blob is revoked");
  assert(source.includes('worker.removeEventListener("message", onWorkerMessage, true)'), "the worker listener is removed");
  assert(source.includes('reject(new Error("gql timed out"))'), "an unanswered worker graphql wait ends");
  assert(source.includes("clearTimeout(waiter.timer)"), "a graphql reply cancels the wait");
});

Deno.test("the blocking label follows backup stay, like video-swap-new", () => {
  assert(!source.includes("env.status(true)"), "a live master must not latch the label on");
  assert(!source.includes("env.status(stripped.stripped)"), "strip-only must not drive the notice");
  assert(
    source.includes("env.status(Boolean(latest && latest.usingBackup))")
      || source.includes("env.status(Boolean(session && session.usingBackup))"),
    "media notice matches BackupEncodings-style stay",
  );
  assert(source.includes("if (!session.usingBackup) env.status(false);"), "an unknown probe clears the label when no backup is playing");
});

Deno.test("return-to-main refreshes a rotated live ladder and fails open", () => {
  const start = source.indexOf("async function maybeReturnToMain");
  const end = source.indexOf("async function playbackToken", start);
  const body = source.slice(start, end);
  assert(body.includes("leaveBackup"), "clearing backup state is shared");
  assert(body.includes("sampleHasAds"), "a stale mainVariantUrl re-probes via the live master");
  assert(body.includes("mainProbeFails"), "unreachable main/master probes are counted");
  assert(body.includes("mainProbeFails >= 3"), "fail open after repeated probe failures");
});

Deno.test("leaveBackup uses video-swap-new moving-off guard", () => {
  assert(source.includes("movingOffBackup"), "session tracks IsMovingOffBackupEncodings");
  assert(source.includes("if (wasUsing) session.movingOffBackup = true"), "leave sets the guard before reload");
  assert(source.includes("movingOffBackup = false"), "master poll clears the guard");
  assert(source.includes('const backupTypes = ["autoplay", "picture-by-picture", "embed"]'), "backup try order matches video-swap-new");
});

Deno.test("fail-open after exhausted backups skips strip and forces reload", () => {
  assert(source.includes("function failOpenShowAds"), "shared fail-open helper exists");
  assert(source.includes("session.failOpen"), "session tracks fail-open like gold exhausted BackupEncodingsStatus");
  assert(source.includes("failOpenShowAds(session)"), "exhausted backups enter fail-open");
  assert(source.includes("if (session && session.failOpen && !swapped)"), "fail-open media passes ads through");
  assert(source.includes("if (session && session.failOpen && !replacement)"), "fail-open master keeps the live ladder");
  assert(source.includes("if (wasUsing || wasFailOpen) scheduleReload()"), "leaveBackup reloads after fail-open too");
});