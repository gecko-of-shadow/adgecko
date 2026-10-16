// uBO detection path, end to end: the generated uBO bundle and youtube.js
// loaded together in one realm, as the manifest injects them.
function assert(c, l) { if (!c) throw new Error(l); }

async function run(layers) {
  const out = await new Deno.Command(Deno.execPath(), {
    env: { LAYERS: layers },
    args: ["run", "-A", "--location", "https://www.youtube.com/watch?v=abcdefghijk", new URL("./fixtures/youtube-layers-run.mjs", import.meta.url).pathname],
    stdout: "piped", stderr: "piped",
  }).output();
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return JSON.parse(new TextDecoder().decode(out.stdout).trim().split("\n").pop());
}

const [manifestOrder, ytOnly, ytFirst] = await Promise.all([run("ubo,yt"), run("yt"), run("yt,ubo")]);

Deno.test("uBO detection: bundle first (manifest order) -> youtube.js adds no hooks and no DOM observer", () => {
  assert(manifestOrder.marker, "marker set by the bundle");
  assert(manifestOrder.hookedByYoutube.length === 0, "youtube.js hooked " + manifestOrder.hookedByYoutube);
  assert(manifestOrder.mutationObservers === 0, "MutationObservers: " + manifestOrder.mutationObservers);
  assert(manifestOrder.perfObservers.join() === "resource", "one read-only resource-timing observer: " + manifestOrder.perfObservers);
  assert(manifestOrder.armedOnWatch, "gentle watchdog arms on a watch navigation");
});

Deno.test("uBO detection: a page script cannot flip the marker back", () => {
  assert(manifestOrder.markerAfterTamper, "marker is non-writable");
});

Deno.test("uBO detection fails open: no bundle -> youtube.js hooks fetch/XHR/JSON.parse and watches the DOM", () => {
  assert(!ytOnly.marker, "no marker");
  for (const k of ["fetch", "parse", "toString", "open", "send", "rt"]) assert(ytOnly.hookedByYoutube.includes(k), "missing hook " + k + ": " + ytOnly.hookedByYoutube);
  assert(ytOnly.mutationObservers === 1, "one DOM observer: " + ytOnly.mutationObservers);
  assert(ytOnly.perfObservers.length === 0, "no resource-timing observer without uBO");
});

Deno.test("uBO detection: youtube.js loaded before the bundle keeps its hooks (manifest order matters)", () => {
  assert(ytFirst.marker && ytFirst.hookedByYoutube.includes("fetch"), "hooks decided at install: " + ytFirst.hookedByYoutube);
});

Deno.test("wait-reply catcher: only 104/105-byte videoplayback replies count", () => {
  assert(manifestOrder.waitReplies.join() === "105,104", "seen " + manifestOrder.waitReplies);
  assert(ytOnly.waitReplies.length === 0, "not watched without uBO");
});
