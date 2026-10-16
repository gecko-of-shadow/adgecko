// inboundEdit (JSON.stringify) and nanoStb (setTimeout) edge cases, run on the
// real generated bundle: as shipped, with the root-key guard stripped (uBO's own
// code), and loaded twice (uBO Lite injecting the same filters next to ours).
function assert(c, l) { if (!c) throw new Error(l); }

async function run(variant) {
  const out = await new Deno.Command(Deno.execPath(), {
    env: { UBO_VARIANT: variant },
    args: ["run", "-A", "--location", "https://www.youtube.com/watch?v=x", new URL("./fixtures/ubo-youtube-edge.mjs", import.meta.url).pathname],
    stdout: "piped", stderr: "piped",
  }).output();
  const lines = new TextDecoder().decode(out.stdout).trim().split("\n");
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(lines.pop());
}

const [shipped, upstream, double] = await Promise.all([run(""), run("upstream"), run("double")]);
const req = (ua) => ({
  attestationRequest: {},
  context: { client: { clientName: "WEB", userAgent: "Mozilla/5.0 (Windows NT 10.0" + ua + ")" } },
  playbackContext: { contentPlaybackContext: { referer: "https://www.youtube.com/watch?v=x", lactMilliseconds: "-1" } },
});

Deno.test("inboundEdit: attestation requests get uBO's markers; the caller's object is not mutated", () => {
  const ch = JSON.parse(shipped.edits.channel);
  assert(ch.context.client.clientScreen === "CHANNEL", "clientScreen " + shipped.edits.channel);
  assert(ch.playbackContext.contentPlaybackContext.referer.endsWith("v=x#reloadxhr"), "referer marker");
  assert(ch.playbackContext.contentPlaybackContext.lactMilliseconds === "1700000000000", "lactMilliseconds = now");
  const lm = JSON.parse(shipped.edits.lactmilli);
  assert(lm.params === "8AUB" && lm.context.client.clientScreen === undefined, "lactmilli params only " + shipped.edits.lactmilli);
  assert(shipped.originalUntouched, "edit works on a clone");
  const twice = JSON.parse(shipped.edits.twice).playbackContext.contentPlaybackContext.referer;
  assert(twice.split("#reloadxhr").length === 2, "referer marker added once on re-stringify: " + twice);
});

Deno.test("inboundEdit attestationRequest guard: everything else passes through as native JSON.stringify", () => {
  assert(shipped.edits.plainUa === JSON.stringify(req("")), "no UA hint: unchanged");
  assert(shipped.edits.noAttestation === JSON.stringify({ context: { client: { clientName: "WEB", userAgent: "x; channel" } } }), "no attestationRequest: unchanged");
  assert(shipped.edits.nested === JSON.stringify({ wrap: req("; channel") }), "root filter only: nested request unchanged");
  assert(shipped.edits.primitives === "undefined|null|\"x\"|5|true", "primitives " + shipped.edits.primitives);
  assert(shipped.edits.replacerSpace === '{\n  "a": 1\n}', "replacer/space kept");
  assert(shipped.toJSONCalls === 1, "unrelated object stringified once, no clone: " + shipped.toJSONCalls);
  assert(upstream.toJSONCalls > 1, "control: without the guard every layer clones (" + upstream.toJSONCalls + ")");
});

Deno.test("inboundEdit guard keeps uBO's exact output (incl. a top-level array of requests)", () => {
  for (const k of Object.keys(upstream.edits)) {
    assert(shipped.edits[k] === upstream.edits[k], k + " differs from uBO:\n shipped  " + shipped.edits[k] + "\n upstream " + upstream.edits[k]);
  }
});

Deno.test("inboundEdit stacked twice (uBO Lite + ours): same output, still no clone", () => {
  for (const k of Object.keys(shipped.edits)) assert(double.edits[k] === shipped.edits[k], "double layer changed " + k + ": " + double.edits[k]);
  assert(double.toJSONCalls === 1, "guarded layers never clone: " + double.toJSONCalls);
});

Deno.test("nanoStb: only 17000ms timers with native-looking callbacks are cut to 17ms", () => {
  assert(shipped.delays.join() === "17,17000,16999,17,17000", "bound, plain fn, other delay, native fn, string: " + shipped.delays);
});

Deno.test("nanoStb: no compounding when stacked, and a self re-arming timer stays a ~17ms loop", () => {
  assert(double.delays.join() === shipped.delays.join(), "stacked boost " + double.delays);
  for (const r of [shipped, double]) assert(r.chainRuns >= 5 && r.chainRuns <= 60, "re-arming chain ran " + r.chainRuns + "x in 600ms");
});
