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
  assert(source.includes("if (probe === null || probe === true) continue;"), "skip a backup that did not load or still has ads");
  assert(source.includes("session.tried.clear();"), "a good backup can be chosen again after the retry window");
});

Deno.test("backup graphql uses only headers gql.twitch.tv allows", () => {
  assert(!source.includes("X-Twitch-Adblock"), "that header is not in Access-Control-Allow-Headers");
  assert(!source.includes('defineProperty(document, "visibilityState"'), "Twitch reads document.hidden, not this spoof");
});

Deno.test("backup player types match video-swap-new", () => {
  assert(
    source.includes('const backupTypes = ["autoplay", "picture-by-picture", "embed"];'),
    "try autoplay, then picture-by-picture, then embed",
  );
  assert(!source.includes("mobile_web"), "video-swap-new does not request a mobile web backup");
  assert(
    source.includes('platform: playerType === "autoplay" ? "android" : "web"'),
    "autoplay tokens use the android platform",
  );
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

Deno.test("player maps and worker waits do not live for the whole tab", () => {
  assert(source.includes("const variantLimit = 64;"), "a channel keeps a bounded set of variant urls");
  assert(source.includes("sessions.delete(channel)"), "a finished channel session is removed");
  assert(source.includes("const sessionTtl = 120000;"), "an idle channel session expires");
  assert(source.includes("URL.revokeObjectURL(blobUrl)"), "the player worker blob is revoked");
  assert(source.includes('worker.removeEventListener("message", onWorkerMessage, true)'), "the worker listener is removed");
  assert(source.includes('reject(new Error("gql timed out"))'), "an unanswered worker graphql wait ends");
  assert(source.includes("clearTimeout(waiter.timer)"), "a graphql reply cancels the wait");
});

Deno.test("the blocking label follows the media playlist, not the live master", () => {
  assert(!source.includes("env.status(true)"), "a live master must not latch the label on");
  assert(source.includes("env.status(stripped.stripped)"), "media playlists show the label only while a segment was replaced");
  assert(source.includes("if (!session.usingBackup) env.status(false);"), "an unknown probe clears the label when no backup is playing");
});
