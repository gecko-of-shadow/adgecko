// The uBO YouTube port: generated bundle behaviour, DNR rules, manifest wiring, provenance.
import manifest from "../manifest.json" with { type: "json" };
import rules from "../src/rules/ubo-youtube-network.json" with { type: "json" };
import { ruleMatches } from "./fixtures/dnr-matcher.js";
import { ensurePlayerAdsPruned, excludeCaptchaFromAdMediaRule } from "../scripts/lib/youtube-local-patches.mjs";
import meta from "../src/vendor/ubo-youtube-meta.json" with { type: "json" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import { unwrapMain } from "./fixtures/main-source.mjs";
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
  assert(!("adPlacements" in r.player) && !("adSlots" in r.player) && !("playerAds" in r.player), "player ads pruned " + JSON.stringify(r.player));
  assert(r.player.playabilityStatus.status === "OK" && r.player.streamingData, "playback fields kept");
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

Deno.test("uBO risky groups are individually switchable (generation-time defaults; tests inject them into the source)", async () => {
  const stb = await runBundle({ inboundEdit: false });
  assert(stb.boostedTimerMs > 0 && stb.boostedTimerMs < 200 && stb.globalsTouched.join() === "setTimeout", "nanoStb alone: " + JSON.stringify(stb.globalsTouched));
  const edit = await runBundle({ nanoStb: false });
  assert(edit.globalsTouched.join() === "stringify" && edit.boot[2] === true, "inboundEdit alone");
  const none = await runBundle({ nanoStb: false, inboundEdit: false });
  assert(none.globalsTouched.length === 0 && none.boostedTimerMs === 0, "both switch off");
  const off = await runBundle({ pruneFetch: false, replaceFetch: false });
  assert(Array.isArray(off.player.adPlacements), "default-on groups can be switched off");
});

Deno.test("fixture runs at the same time keep their own uBO options (no shared state)", async () => {
  // Deno shares --location localStorage between processes; fixtures/memory-storage.mjs
  // gives each run its own. Without it these runs read each other's options.
  const jobs = [];
  for (let i = 0; i < 8; i++) {
    jobs.push(runBundle({ nanoStb: false, inboundEdit: false }).then((r) => r.globalsTouched.join() || "none"));
    jobs.push(runBundle().then((r) => r.globalsTouched.join()));
  }
  const got = await Promise.all(jobs);
  const want = got.map((_, i) => (i % 2 ? "setTimeout,stringify" : "none"));
  assert(JSON.stringify(got) === JSON.stringify(want), "cross-talk between runs: " + got.join(" | "));
});

Deno.test("uBO bundle carries the exact uAssets prune paths and is pinned", async () => {
  const js = await Deno.readTextFile(new URL("../src/vendor/ubo-youtube.js", import.meta.url));
  for (const call of [
    'jsonPruneFetchResponse("playerAds adPlacements adSlots playerResponse.playerAds playerResponse.adPlacements playerResponse.adSlots [].playerResponse.playerAds [].playerResponse.adPlacements [].playerResponse.adSlots","","propsToMatch","/\\\\/player(\\\\?|$)/")',
    'jsonPruneXhrResponse("playerAds adPlacements adSlots playerResponse.playerAds playerResponse.adPlacements playerResponse.adSlots [].playerResponse.playerAds [].playerResponse.adPlacements [].playerResponse.adSlots","","propsToMatch","/\\\\/player(?:\\\\?.+)?$/")',
    'jsonPrune("entries.[-].command.reelWatchEndpoint.adClientParams.isAd")',
    'trustedReplaceFetchResponse("\\"adPlacements\\"","\\"no_ads\\"","player?")',
    'setConstant("ytInitialPlayerResponse.adPlacements","undefined")',
    'trustedReplaceFetchResponse("\\"adPlacements\\"","\\"no_ads\\"","/get_watch?")',
    'adjustSetTimeout("[native code]","17000","0.001")',
  ]) assert(js.includes(call), "missing " + call);
  assert(/^[0-9a-f]{40}$/.test(meta.uassets_commit) && js.includes(meta.uassets_commit), "uAssets commit recorded");
  assert(js.includes(meta.ublock_commit), "uBO commit recorded");
  assert(!/\bchrome\./.test(js), "no extension APIs in MAIN world");
  assert(js.includes("if (globalThis[Symbol.for(\"gk.u\")]) { return; }"), "install-once guard");
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

Deno.test("uBO _ad_ media rule still blocks ad media and does not match an hCaptcha host", () => {
  const rule = rules.find((r) => r.condition && r.condition.urlFilter === "_ad_");
  assert(rule && rule.action.type === "block" && rule.condition.resourceTypes.includes("media"), "rule present");
  assert((rule.condition.excludedRequestDomains || []).includes("hcaptcha.com"), "captcha host excluded");
  const req = (url) => ({ url, type: "media", initiator: "www.youtube.com", method: "get" });
  assert(ruleMatches(rule, req("https://ads.example/video_ad_clip.mp4")), "a third-party _ad_ media url still matches");
  assert(!ruleMatches(rule, req("https://hcaptcha.com/x_ad_y.mp4")), "hcaptcha.com _ad_ url matched");
  assert(!ruleMatches(rule, req("https://a.hcaptcha.com/media_ad_file")), "hCaptcha subdomain matched");
  assert(ruleMatches(rule, req("https://nothcaptcha.com/video_ad_x.mp4")), "lookalike should still match");
});

Deno.test("playerAds prune and captcha exclusion are local patches a re-sync keeps", () => {
  const upstream = [
    'jsonPruneFetchResponse("adPlacements adSlots playerResponse.adPlacements playerResponse.adSlots [].playerResponse.adPlacements [].playerResponse.adSlots","","propsToMatch","/\\\\/player(\\\\?|$)/");',
    'jsonPruneXhrResponse("adPlacements adSlots playerResponse.adPlacements playerResponse.adSlots [].playerResponse.adPlacements [].playerResponse.adSlots","","propsToMatch","/\\\\/player(?:\\\\?.+)?$/");',
  ].join("\n");
  const once = ensurePlayerAdsPruned(upstream);
  assert(once.patched === 2 && once.source.includes("playerResponse.playerAds") && !once.source.includes('jsonPruneFetchResponse("adPlacements adSlots '), "patch");
  const twice = ensurePlayerAdsPruned(once.source);
  assert(twice.patched === 0 && twice.source === once.source, "idempotent");
  const rulesIn = [{ id: 4, action: { type: "block" }, condition: { urlFilter: "_ad_", resourceTypes: ["media"] } }, { id: 1, action: { type: "block" }, condition: { urlFilter: "||doubleclick.net^" } }];
  excludeCaptchaFromAdMediaRule(rulesIn);
  assert(rulesIn[0].condition.excludedRequestDomains[0] === "hcaptcha.com" && !rulesIn[1].condition.excludedRequestDomains, "only the _ad_ rule");
  excludeCaptchaFromAdMediaRule(rulesIn);
  assert(rulesIn[0].condition.excludedRequestDomains.length === 1, "not duplicated");
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
  assert(youtubeSource.includes('Symbol.for("gk.u")'), "marker read");
  const api = {};
  // Installed BEFORE the uBO marker exists (late MAIN-world injection): must still see it live.
  const yt = unwrapMain(youtubeSource);
  new Function(`${yt.slice(0, yt.indexOf("function startYoutubeAdblock"))}\nreturn installYoutubeAdblock;`)()(api);
  assert(api.UBO_LAYER === false, "no layer yet");
  globalThis[Symbol.for("gk.u")] = true;
  try {
    assert(api.UBO_LAYER === true, "flag read live");
    const v = { playabilityStatus: { status: "OK" }, streamingData: { formats: [] }, videoDetails: { videoId: "x" }, adPlacements: [{ x: 1 }] };
    const s = api.stripValue(v, "player");
    assert(!s.blocked && s.value.adPlacements, "homemade player strip disabled (uBO owns it)");
  } finally {
    delete globalThis[Symbol.for("gk.u")];
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
  assert(js.includes("(Array.isArray(obj) ? obj.some(hasRootKey) : hasRootKey(obj)) === false ) { return; }"), "guard in bundle");
  const r = await runBundle();
  assert(r.boot.every((x) => x === true), "bootstrap still runs " + JSON.stringify(r.boot));
});

// uBO's videoplayback rule allows only a window of `expire=` timestamps and blocks
// everything else (a decoy filter). Upstream widens it only after real links break,
// so scripts/sync-ubo-youtube.mjs widens it locally (scripts/lib/youtube-expire-window.mjs).
// Once real links fall outside the window, every YouTube video (on youtube.com and in
// embeds) stops loading. The window must cover every day through 2033-05-01.
const expireUrl = (sec) => `https://rr1---sn-example.googlevideo.com/videoplayback?expire=${sec}&ei=x&itag=137`;
const shippedExpireRule = () => rules.find((r) => r.condition?.regexFilter?.includes("videoplayback\\?expire="));

Deno.test("uBO videoplayback expire window allows real links every day from today through 2033-05-01", () => {
  const rule = shippedExpireRule();
  if (!rule) return; // rule dropped upstream: nothing to expire
  const re = new RegExp(rule.condition.regexFilter);
  const end = Date.UTC(2033, 4, 1) / 1000;
  const start = Math.floor(Date.now() / 1000 / 86400) * 86400;
  let days = 0;
  for (let day = start; day <= end; day += 86400, days++) {
    const expire = day + 6 * 3600; // links expire about 6 h after they're issued
    if (re.test(expireUrl(expire))) {
      throw new Error(`a normal link with expire=${expire} (${new Date(expire * 1000).toISOString()}) is blocked; see scripts/lib/youtube-expire-window.mjs`);
    }
  }
  assert(days > 2000, "checked " + days + " days");
});

Deno.test("uBO videoplayback expire rule still blocks the decoy expiries", () => {
  const rule = shippedExpireRule();
  if (!rule) return;
  const re = new RegExp(rule.condition.regexFilter);
  for (const decoy of ["0123456789", "1234567890", "1750000000", "2500000000"]) {
    assert(re.test(expireUrl(decoy)), "decoy not blocked: " + decoy);
  }
  assert(rule.action.type === "block", "still a block rule");
});

Deno.test("expire window post-processing: widens the known upstream window, is idempotent, and never blocks more", async () => {
  const mod = await import("../scripts/lib/youtube-expire-window.mjs");
  const mk = (win) => [
    { id: 1, action: { type: "block" }, condition: { urlFilter: "||doubleclick.net^" } },
    { id: 3, action: { type: "block" }, condition: { regexFilter: mod.EXPIRE_PREFIX + win + mod.EXPIRE_SUFFIX, resourceTypes: ["xmlhttprequest"] } },
  ];
  const first = mod.widenYoutubeExpireWindow(mk(mod.UPSTREAM_WINDOW));
  assert(first.action === "widened", "known window widened");
  assert(first.rules[1].condition.regexFilter === mod.EXPIRE_PREFIX + mod.WIDENED_WINDOW + mod.EXPIRE_SUFFIX, "widened regex");
  assert(first.rules[1].condition.resourceTypes[0] === "xmlhttprequest" && first.rules[0].id === 1, "other fields kept");
  const second = mod.widenYoutubeExpireWindow(first.rules);
  assert(second.action === "unchanged", "idempotent");
  assert(JSON.stringify(second.rules) === JSON.stringify(first.rules), "idempotent output");
  // Allow-only: everything the widened rule blocks, the upstream rule also blocked.
  const up = new RegExp(mk(mod.UPSTREAM_WINDOW)[1].condition.regexFilter);
  const wide = new RegExp(first.rules[1].condition.regexFilter);
  for (let p = 0; p < 1000; p++) {
    const u = expireUrl(String(p).padStart(3, "0") + "4567890");
    if (wide.test(u)) assert(up.test(u), "widened blocks more than upstream at prefix " + p);
  }
  // Upstream already more permissive: kept as is.
  const looser = mod.widenYoutubeExpireWindow(mk("(?:[02-9]\\d+|1[1-5]\\d+)"));
  assert(looser.action === "unchanged" && looser.rules[1].condition.regexFilter.includes("1[1-5]"), "keeps a more permissive upstream window");
  // Upstream moved but stricter than ours (subset): ours wins.
  const stricter = mod.widenYoutubeExpireWindow(mk("(?:[02-9]\\d+|1[1-79]\\d+)"));
  assert(stricter.action === "widened", "stricter upstream window replaced");
  // No expire rule: nothing to do.
  assert(mod.widenYoutubeExpireWindow([{ id: 1, action: { type: "block" }, condition: {} }]).action === "none", "no rule");
});

Deno.test("expire window post-processing: an unrecognised rule shape stops the generator", async () => {
  const mod = await import("../scripts/lib/youtube-expire-window.mjs");
  const bad = [
    [{ id: 3, action: { type: "block" }, condition: { regexFilter: "googlevideo\\.com/videoplayback\\?expire=\\d+" } }],
    [{ id: 3, action: { type: "block" }, condition: { regexFilter: mod.EXPIRE_PREFIX + "(?:(?!x).)+" + mod.EXPIRE_SUFFIX } }],
    [{ id: 3, action: { type: "allow" }, condition: { regexFilter: mod.EXPIRE_PREFIX + mod.UPSTREAM_WINDOW + mod.EXPIRE_SUFFIX } }],
    [
      { id: 3, action: { type: "block" }, condition: { regexFilter: mod.EXPIRE_PREFIX + mod.UPSTREAM_WINDOW + mod.EXPIRE_SUFFIX } },
      { id: 4, action: { type: "block" }, condition: { regexFilter: mod.EXPIRE_PREFIX + mod.UPSTREAM_WINDOW + mod.EXPIRE_SUFFIX } },
    ],
    // Not comparable with ours (allows 0.., blocks 18..): needs a human.
    [{ id: 3, action: { type: "block" }, condition: { regexFilter: mod.EXPIRE_PREFIX + "(?:[2-9]\\d+|18\\d+)" + mod.EXPIRE_SUFFIX } }],
  ];
  for (const rulesIn of bad) {
    let threw = false;
    try { mod.widenYoutubeExpireWindow(rulesIn); } catch { threw = true; }
    assert(threw, "accepted " + JSON.stringify(rulesIn));
  }
  const gen = await Deno.readTextFile(new URL("../scripts/sync-ubo-youtube.mjs", import.meta.url));
  const call = gen.indexOf("widenYoutubeExpireWindow(rules)");
  const write = gen.indexOf('src/rules/ubo-youtube-network.json", JSON.stringify(expireFix.rules');
  assert(call > 0 && write > call, "generator post-processes before it writes the rule file");
});

// Early warning (fix prompt, Block 2): fails from 180 days before the first
// normal link the shipped expire rule would block, read from the rule itself,
// so there is half a year to re-sync / widen and ship before videos break.
Deno.test("uBO videoplayback expire window: more than 180 days left before its edge", () => {
  const rule = shippedExpireRule();
  if (!rule) return;
  const re = new RegExp(rule.condition.regexFilter);
  const today = Math.floor(Date.now() / 1000 / 86400) * 86400;
  let edge = 0;
  for (let day = today; day <= Date.UTC(2045, 0, 1) / 1000; day += 86400) {
    if (re.test(expireUrl(day + 6 * 3600))) {
      edge = day;
      break;
    }
  }
  assert(edge > 0, "no edge found before 2045");
  const daysLeft = Math.floor((edge - today) / 86400);
  assert(daysLeft > 180, `the YouTube expire window starts blocking normal links on ${new Date(edge * 1000).toISOString().slice(0, 10)} (${daysLeft} days left): widen it in scripts/lib/youtube-expire-window.mjs, re-sync and ship`);
  // Today the edge is 2033-05-18 (expire=1999999999 is the last allowed second).
  assert(edge >= Date.UTC(2033, 4, 18) / 1000 - 86400, "edge earlier than expected: " + new Date(edge * 1000).toISOString());
});
