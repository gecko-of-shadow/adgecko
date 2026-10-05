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
  assert(source.includes("if (probe === null) continue;"), "skip a backup whose playlist did not load");
  assert(source.includes("session.tried.clear();"), "a good backup can be chosen again after the retry window");
});
