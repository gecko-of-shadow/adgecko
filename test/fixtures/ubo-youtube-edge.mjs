// Edge cases of the generated uBO MAIN-world bundle: inboundEdit (JSON.stringify)
// output and the nanoStb setTimeout boost. Used by test/ubo-youtube-edge.test.js.
//   UBO_VARIANT=upstream  root-key guard stripped (uBO's own behaviour)
//   UBO_VARIANT=double    bundle loaded twice, as when uBO Lite injects its own copy
globalThis.window = globalThis;
globalThis.self = globalThis;
localStorage.removeItem("twitch-adblock-ubo-opts");
class Node { appendChild(c) { return c; } }
globalThis.Node = Node;
globalThis.document = {
  readyState: "loading", currentScript: null,
  addEventListener() {}, removeEventListener() {},
  querySelectorAll: () => [], querySelector: () => null, getElementById: () => null,
  createElement: () => ({ style: {} }), documentElement: {}, head: null,
};
Date.now = () => 1700000000000;
const realSetTimeout = globalThis.setTimeout;
const delays = [];
// Records the delay each call reaches the native timer with; long ones are not scheduled.
globalThis.setTimeout = function setTimeout(fn, delay, ...rest) {
  delays.push(delay);
  return delay >= 1000 ? 0 : realSetTimeout(fn, delay, ...rest);
};

const variant = Deno.env.get("UBO_VARIANT") || "";
let src = await Deno.readTextFile(new URL("../../src/vendor/ubo-youtube.js", import.meta.url));
if (variant === "upstream") {
  const before = src;
  src = src.replace(/^\s*if \( rootKey !== null[^\n]*\n/m, "");
  if (src === before) throw new Error("root-key guard line not found");
}
(0, eval)(src);
if (variant === "double") {
  (0, eval)(src.replace('if (globalThis[Symbol.for("twitch-adblock.ubo")]) { return; }', ""));
}

const s = (v, ...a) => {
  try {
    return String(JSON.stringify(v, ...a));
  } catch (e) {
    return "THREW " + e.message;
  }
};
const req = (ua) => ({
  attestationRequest: {},
  context: { client: { clientName: "WEB", userAgent: "Mozilla/5.0 (Windows NT 10.0" + ua + ")" } },
  playbackContext: { contentPlaybackContext: { referer: "https://www.youtube.com/watch?v=x", lactMilliseconds: "-1" } },
});
const out = {};
out.edits = {
  channel: s(req("; channel")),
  lactmilli: s(req("; lactmilli")),
  plainUa: s(req("")),
  noAttestation: s({ context: { client: { clientName: "WEB", userAgent: "x; channel" } } }),
  arrayRoot: s([req("; channel"), { other: 1 }]),
  nested: s({ wrap: req("; channel") }),
  primitives: [undefined, null, "x", 5, true].map((v) => s(v)).join("|"),
  replacerSpace: s({ a: 1, b: 2 }, ["a"], 2),
  twice: s(JSON.parse(s(req("; channel")))),
};
const original = req("; channel");
s(original);
out.originalUntouched = original.context.client.clientScreen === undefined && original.playbackContext.contentPlaybackContext.referer.endsWith("v=x");
let toJSONCalls = 0;
s({ a: 1, toJSON() { toJSONCalls++; return { a: 1 }; } });
out.toJSONCalls = toJSONCalls;

const bound = Function.prototype.bind.call(function () {}, null);
delays.length = 0;
setTimeout(bound, 17000);
setTimeout(function plain() {}, 17000);
setTimeout(bound, 16999);
setTimeout(Math.max, 17000);
setTimeout("void 0", 17000);
out.delays = delays.slice();

// A native-looking 17s timer that re-arms itself becomes a 17ms loop; it must
// stay a loop at that pace, not collapse toward 0ms when layers stack.
let runs = 0;
const t0 = performance.now();
let tick = null;
tick = Function.prototype.bind.call(function () {
  runs++;
  if (performance.now() - t0 < 600) setTimeout(tick, 17000);
}, null);
setTimeout(tick, 17000);
await new Promise((r) => realSetTimeout(r, 750));
out.chainRuns = runs;
console.log(JSON.stringify(out));
Deno.exit(0);
