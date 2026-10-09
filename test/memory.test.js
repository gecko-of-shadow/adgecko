import source from "../src/vendor/video-swap-new.user.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

Deno.test("AdSegmentCache drops entries older than two minutes", () => {
  assert(source.includes("AdSegmentCache.forEach"), "cache sweep exists");
  assert(source.includes("value < Date.now() - 120000"), "two-minute TTL matches upstream");
});

Deno.test("StreamInfos maps stay per-channel without a hand-rewrite session limit", () => {
  assert(source.includes("StreamInfos[channelName]"), "per-channel StreamInfos");
  assert(source.includes("StreamInfosByUrl"), "url index for media playlists");
  assert(!source.includes("sessionLimit"), "no hand-rewrite session LRU");
  assert(!source.includes("sessionTtl"), "no hand-rewrite session TTL");
});
