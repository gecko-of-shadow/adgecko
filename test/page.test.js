import source from "../src/page.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
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
  assert(source.includes("if (!response.ok) return null;"), "unknown probe result");
  assert(source.includes('if (!body.startsWith("#EXTM3U")) return null;'), "a non-playlist body is not a clean stream");
  assert(source.includes("return playlist.hasAdBreak(masterText) || null;"), "a master with no variant is not a clean stream");
  assert(source.includes("if (probe === null) continue;"), "skip a backup whose playlist did not load");
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
  const dropAt = source.indexOf('init.body.includes("picture-by-picture")');
  const rewriteAt = source.indexOf("item.variables.playerType = FORCED_PLAYER_TYPE");
  assert(dropAt !== -1, "detect the mini-player token");
  assert(source.includes('body: ""'), "an empty body makes gql reject that token");
  assert(rewriteAt !== -1 && dropAt < rewriteAt, "drop the mini-player token before rewriting it to popout");
});

Deno.test("the blocking label follows the media playlist, not the live master", () => {
  assert(!source.includes("env.status(true)"), "a live master must not latch the label on");
  assert(source.includes("env.status(stripped.stripped)"), "media playlists show the label only while a segment was replaced");
  assert(source.includes("if (!session.usingBackup) env.status(false);"), "an unknown probe clears the label when no backup is playing");
});
