import source from "../src/vendor/video-swap-new.user.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

Deno.test("worker blob still evals the real Twitch worker after declaring video-swap-new helpers", () => {
  assert(source.includes("eval(workerString);"), "upstream boots the player worker via eval");
  assert(source.includes("getWasmWorkerJs"), "sync XHR reads the original worker source");
  assert(source.includes("${stripAdSegments.toString()}"), "stripAdSegments is inlined into the worker");
  assert(source.includes("${processM3U8.toString()}"), "processM3U8 is inlined into the worker");
  assert(source.includes("${onFoundAd.toString()}"), "onFoundAd is inlined into the worker");
});

Deno.test("conflict skip uses twitchAdSolutionsVersion, not a hand-rewrite install flag", () => {
  assert(source.includes("window.twitchAdSolutionsVersion"), "upstream version gate");
  assert(!source.includes("__twitchAdblockInstalled"), "hand-rewrite install flag is gone");
});

Deno.test("Visibility hooks keep the tab from pausing on background ads", () => {
  assert(source.includes("Object.defineProperty(document, 'visibilityState'"), "visibilityState spoof");
  assert(source.includes("Object.defineProperty(document, 'hidden'"), "hidden spoof");
  assert(source.includes("visibilitychange"), "visibilitychange blocked");
});
