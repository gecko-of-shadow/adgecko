// The uBO YouTube port: generated bundle behaviour, DNR rules, manifest wiring, provenance.
import manifest from "../manifest.json" with { type: "json" };
import rules from "../src/rules/ubo-youtube-network.json" with { type: "json" };
import meta from "../src/vendor/ubo-youtube-meta.json" with { type: "json" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }

async function runBundle(opts) {
  const env = opts ? { UBO_OPTS: JSON.stringify(opts) } : {};
  const out = await new Deno.Command(Deno.execPath(), {
    env,
    args: ["run", "-A", "--location", "https://www.youtube.com/watch?v=x", new URL("./fixtures/ubo-youtube-run.mjs", import.meta.url).pathname],
    stdout: "piped", stderr: "piped",
  }).output();
  const text = new TextDecoder().decode(out.stdout).trim().split("\n").pop();
  return JSON.parse(text);
}

Deno.test("uBO bundle: player fetch loses adPlacements/adSlots exactly as uBO's json-prune-fetch-response/rpfr", async () => {
  const r = await runBundle();
  assert(r.marker, "layer marker set for youtube.js");
  assert(!("adPlacements" in r.player) && !("adSlots" in r.player), "player ads pruned " + JSON.stringify(r.player));
  assert(r.player.playabilityStatus.status === "OK" && r.player.streamingData, "playback fields kept");
  assert(Array.isArray(r.player.playerAds), "playerAds untouched on www (uBO's www rules don't prune it)");
  assert(r.next.adPlacements, "non-matching url (/next) untouched");
  assert(r.reel.entries.length === 1 && r.reel.entries[0].command.reelWatchEndpoint.videoId === "v1", "reel_watch_sequence isAd entry pruned");
  assert(r.parsedEntries === 1, "JSON.parse prune of entries.[-]...isAd");
  assert(r.initial.videoId === "x" && r.initial.adPlacements === undefined && r.initial.adSlots === undefined && r.initial.playerAds === undefined, "set-constant on ytInitialPlayerResponse");
  assert(r.boostedTimerMs > 0 && r.boostedTimerMs < 200, "nano-stb on by default like uBO Lite");
});

Deno.test("uBO bundle defaults: only uBO Lite's default globals (setTimeout, JSON.stringify), mock YouTube bootstrap runs (9b82bf8 blank-page fix)", async () => {
  const r = await runBundle();
  assert(r.globalsTouched.join() === "setTimeout,stringify", "globals touched by default: " + r.globalsTouched);
  assert(r.boot.every((x) => x === true), "bootstrap " + JSON.stringify(r.boot));
});

Deno.test("uBO risky groups are individually switchable via localStorage", async () => {
  const stb = await runBundle({ inboundEdit: false });
  assert(stb.boostedTimerMs > 0 && stb.boostedTimerMs < 200 && stb.globalsTouched.join() === "setTimeout", "nanoStb alone: " + JSON.stringify(stb.globalsTouched));
  const edit = await runBundle({ nanoStb: false });
  assert(edit.globalsTouched.join() === "stringify" && edit.boot[2] === true, "inboundEdit alone");
  const none = await runBundle({ nanoStb: false, inboundEdit: false });
  assert(none.globalsTouched.length === 0 && none.boostedTimerMs === 0, "both switch off");
  const off = await runBundle({ pruneFetch: false, replaceFetch: false });
  assert(Array.isArray(off.player.adPlacements), "default-on groups can be switched off");
});

Deno.test("uBO bundle carries the exact uAssets prune paths and is pinned", async () => {
  const js = await Deno.readTextFile(new URL("../src/vendor/ubo-youtube.js", import.meta.url));
  for (const call of [
    'jsonPruneFetchResponse("adPlacements adSlots playerResponse.adPlacements playerResponse.adSlots [].playerResponse.adPlacements [].playerResponse.adSlots","","propsToMatch","/\\\\/player(\\\\?|$)/")',
    'jsonPruneXhrResponse("adPlacements adSlots playerResponse.adPlacements playerResponse.adSlots [].playerResponse.adPlacements [].playerResponse.adSlots","","propsToMatch","/\\\\/player(?:\\\\?.+)?$/")',
    'jsonPrune("entries.[-].command.reelWatchEndpoint.adClientParams.isAd")',
    'trustedReplaceFetchResponse("\\"adPlacements\\"","\\"no_ads\\"","player?")',
    'setConstant("ytInitialPlayerResponse.adPlacements","undefined")',
    'trustedReplaceFetchResponse("\\"adPlacements\\"","\\"no_ads\\"","/get_watch?")',
    'adjustSetTimeout("[native code]","17000","0.001")',
  ]) assert(js.includes(call), "missing " + call);
  assert(/^[0-9a-f]{40}$/.test(meta.uassets_commit) && js.includes(meta.uassets_commit), "uAssets commit recorded");
  assert(js.includes(meta.ublock_commit), "uBO commit recorded");
  assert(!/\bchrome\./.test(js), "no extension APIs in MAIN world");
  assert(js.includes("if (globalThis[Symbol.for(\"twitch-adblock.ubo\")]) { return; }"), "install-once guard");
  for (const k of ["rmnt", "domBypass"]) assert(meta.off_by_default.includes(k), "off by default: " + k);
  for (const k of ["rpnt", "inboundEdit", "nanoStb"]) assert(!meta.off_by_default.includes(k), "on by default like uBO Lite: " + k);
  const iso = await Deno.readTextFile(new URL("../src/vendor/ubo-youtube-isolated.js", import.meta.url));
  assert(iso.includes('if (uboOn("rpnt"))') && iso.includes('if (uboOn("rmnt"))'), "rpnt/rmnt in isolated world like uBO");
});

Deno.test("uBO DNR: decoy videoplayback expire filter blocks absurd expiries only", () => {
  const r = rules.find((x) => x.condition.regexFilter && x.condition.regexFilter.includes("videoplayback"));
  assert(r && r.action.type === "block" && r.condition.initiatorDomains.includes("www.youtube.com"), "rule present, scoped");
  assert(r.priority > 2000000, "outranks general ruleset YouTube/googlevideo allows");
  const re = new RegExp(r.condition.regexFilter);
  for (const e of ["7694650297", "7965383766", "6301177760", "9571572721", "1508648445"]) assert(re.test(`https://rr2---sn-x.googlevideo.com/videoplayback?expire=${e}&ei=a`), "decoy " + e);
  assert(!re.test("https://rr2---sn-x.googlevideo.com/videoplayback?expire=1792300000&ei=a"), "real 2026 expiry passes");
});

Deno.test("manifest: uBO layers load before youtube.js; ruleset enabled", () => {
  const js = manifest.content_scripts.map((s) => (s.js || [])[0]);
  const m = js.indexOf("src/vendor/ubo-youtube.js"), i = js.indexOf("src/vendor/ubo-youtube-isolated.js"), y = js.indexOf("src/youtube.js");
  assert(m >= 0 && i >= 0 && m < y, "order " + js);
  assert(manifest.content_scripts[m].world === "MAIN" && !manifest.content_scripts[i].world, "worlds");
  assert(manifest.declarative_net_request.rule_resources.some((r) => r.id === "ubo-youtube" && r.enabled), "ruleset");
  assert(new Set(rules.map((r) => r.id)).size === rules.length, "unique ids");
});

Deno.test("youtube.js stands down on player ad fields when the uBO layer is present", () => {
  assert(youtubeSource.includes('Symbol.for("twitch-adblock.ubo")'), "marker read");
  const api = {};
  // Installed BEFORE the uBO marker exists (late MAIN-world injection): must still see it live.
  new Function(`${youtubeSource.slice(0, youtubeSource.indexOf("function startYoutubeAdblock"))}\nreturn installYoutubeAdblock;`)()(api);
  assert(api.UBO_LAYER === false, "no layer yet");
  globalThis[Symbol.for("twitch-adblock.ubo")] = true;
  try {
    assert(api.UBO_LAYER === true, "flag read live");
    const v = { playabilityStatus: { status: "OK" }, streamingData: { formats: [] }, videoDetails: { videoId: "x" }, adPlacements: [{ x: 1 }] };
    const s = api.stripValue(v, "player");
    assert(!s.blocked && s.value.adPlacements, "homemade player strip disabled (uBO owns it)");
  } finally {
    delete globalThis[Symbol.for("twitch-adblock.ubo")];
  }
});

Deno.test("youtube-ads.css: manifest CSS covers every home-feed/toast selector, one rule each", async () => {
  const css = await Deno.readTextFile(new URL("../src/youtube-ads.css", import.meta.url));
  const entry = manifest.content_scripts.find((c) => (c.js || [])[0] === "src/vendor/ubo-youtube-isolated.js");
  assert(entry && entry.css.includes("src/youtube-ads.css") && entry.run_at === "document_start", "wired at document_start");
  for (const sel of ["ytd-rich-item-renderer:has(ytd-ad-slot-renderer)", "ytd-in-feed-ad-layout-renderer", "#masthead-ad", "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)"]) assert(css.includes(sel + " {"), "missing " + sel);
  const m = youtubeSource.match(/const HOME_FEED_AD_CSS = \[([\s\S]*?)\]\.join/);
  for (const sel of JSON.parse("[" + m[1].trim().replace(/,\s*$/, "") + "]")) assert(css.includes(sel + " {"), "not mirrored: " + sel);
  for (const line of css.split("\n").filter((l) => l.includes("{"))) assert(!/,\s*\S.*\{/.test(line.split("{")[0]) || line.includes(":has("), "one selector per rule: " + line);
});

Deno.test("youtube.js: no DOM MutationObserver under uBO; throttled otherwise", () => {
  assert(/if \(uboLayerPresent\(\) && !NUDGE\) return;/.test(youtubeSource), "observer skipped under uBO");
  assert(/domSweepMs: 400/.test(youtubeSource) && /requestIdleCallback\(sweep/.test(youtubeSource), "throttled idle sweep");
});

Deno.test("inboundEdit: root-key guard skips the clone for unrelated JSON.stringify calls, still edits attestation requests", async () => {
  const js = await Deno.readTextFile(new URL("../src/vendor/ubo-youtube.js", import.meta.url));
  assert(js.includes("obj[rootKey[1]] === undefined) ) { return; }"), "guard in bundle");
  const r = await runBundle();
  assert(r.boot.every((x) => x === true), "bootstrap still runs " + JSON.stringify(r.boot));
});
