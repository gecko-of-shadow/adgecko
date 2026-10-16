import source from "../src/youtube.js" with { type: "text" };
function assert(c, label) { if (!c) throw new Error(label); }
function fresh() {
  const api = {};
  new Function(`${source}\nreturn installYoutubeAdblock;`)()(api);
  return api;
}
const NOW = Date.UTC(2026, 9, 16) ;
const url = (expire) => "https://rr3---sn-k2mn5pqr.googlevideo.com/videoplayback?expire=" + expire + "&ip=203.0.113.9&itag=18&mn=ZAbCd%2CE2GhI&fvip=3";

Deno.test("decoy: expire years in the past is a decoy (seen on the owner's PC)", () => {
  assert(fresh().isDecoyStreamUrl(url(1508648445), NOW), "2017 expire flagged");
});
Deno.test("decoy: real future / recent expiry is not a decoy", () => {
  const api = fresh();
  const s = Math.floor(NOW / 1000);
  assert(!api.isDecoyStreamUrl(url(s + 6 * 3600), NOW), "future ok");
  assert(!api.isDecoyStreamUrl(url(s - 3600), NOW), "clock skew of 1h ok");
  assert(!api.isDecoyStreamUrl(url("abc"), NOW), "non-numeric ignored");
  assert(!api.isDecoyStreamUrl("https://rr3---sn-k2mn5pqr.googlevideo.com/videoplayback?itag=18", NOW), "no expire ignored");
  assert(!api.isDecoyStreamUrl("https://www.youtube.com/videoplayback?expire=1508648445", NOW), "non-googlevideo ignored");
  assert(!api.isDecoyStreamUrl("not a url", NOW), "garbage ignored");
});
Deno.test("decoy: wiring in page hooks is bounded", () => {
  assert(/if \(api\.isDecoyStreamUrl\(url\)\) \{\s*onDecoyUrl\(url\);\s*return nativeFetch\(input, init\);/.test(source), "fetch skips failover for decoys");
  assert(source.includes("stalledReloaded >= 2") && /function onDecoyUrl[\s\S]*?stalledReloaded >= 2/.test(source), "decoy reload shares the 2-reload cap");
  assert(/decoyReloadMs: (\d+)/.exec(source)[1] < 1000, "reload well under 1s");
});

Deno.test("decoy: expire years in the future is a decoy (2273 seen live)", () => {
  const api = fresh();
  assert(api.isDecoyStreamUrl(url(9571572721), NOW), "2273 flagged");
  assert(!api.isDecoyStreamUrl(url(Math.floor(NOW / 1000) + 6 * 86400), NOW), "6 days ahead is fine");
});
Deno.test("decoy: a 403 stops failover and is flagged (dead DNS names still remembered)", async () => {
  const api = fresh();
  const calls = [];
  const r = await api.fetchWithFallback("https://rr5---sn-h9jk2mn5.googlevideo.com/videoplayback?expire=1&mn=sn-n5pqrstu&fvip=3", (u) => {
    calls.push(new URL(u).hostname);
    return calls.length === 1 ? Promise.reject(new TypeError("net::ERR_NAME_NOT_RESOLVED")) : Promise.resolve({ ok: false, status: 403 });
  });
  assert(r.flagged && calls.length === 2, "stopped at first 403: " + calls);
  assert(api.badGvHosts.has("rr5---sn-h9jk2mn5.googlevideo.com"), "dns-dead host remembered");
});
Deno.test("stealth defaults: ad lists emptied not deleted, start policies and stream untouched", () => {
  const api = fresh();
  assert(api.STEALTH.emptyAdFields && !api.STEALTH.zeroStartPolicies && !api.STEALTH.patchUmpBackoff && !api.STEALTH.failoverOn403, "defaults");
  const body = { videoDetails: { videoId: "v" }, streamingData: { formats: [{ url: "https://rr1---sn-a.googlevideo.com/videoplayback" }] },
    playabilityStatus: { status: "OK" }, playerConfig: { mediaCommonConfig: { startMinReadaheadPolicy: [{ minReadaheadMs: 1500 }] } },
    adPlacements: [{ adPlacementRenderer: { config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_START" } } } }], playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }] };
  const out = api.stripResponseText(JSON.stringify(body), "https://www.youtube.com/youtubei/v1/player");
  assert(out.blocked, "ads stripped");
  const p = JSON.parse(out.text);
  assert(Array.isArray(p.adPlacements) && p.adPlacements.length === 0 && Array.isArray(p.playerAds) && p.playerAds.length === 0, "keys kept as []");
  assert(p.playerConfig.mediaCommonConfig.startMinReadaheadPolicy[0].minReadaheadMs === 1500, "YouTube's readahead kept");
  assert(/installSabrPatch\(xhr\) \{\s*if \(!api\.STEALTH\.patchUmpBackoff\) return;/.test(source), "stream patch gated");
});

const playerText = (expires) => JSON.stringify({ videoDetails: { videoId: "IjkLmNo_QrS" }, streamingData: {
  formats: expires.map((e) => ({ url: "https://rr5---sn-2cde6gh9.googlevideo.com/videoplayback?expire=" + e + "&itag=18" })),
  adaptiveFormats: [{ signatureCipher: "s=x&url=https%3A%2F%2Frr5---sn-2cde6gh9.googlevideo.com%2Fvideoplayback%3Fexpire%3D" + expires[0] + "%26itag%3D137" }],
}});
Deno.test("player response: decoy urls (2189 seen live) are found before any media request", () => {
  const api = fresh();
  const hit = api.findDecoyInPlayerText(playerText([6938943669]), NOW);
  assert(hit && hit.expire === "6938943669" && hit.videoId === "IjkLmNo_QrS", JSON.stringify(hit));
  assert(api.findDecoyInPlayerText(playerText([1508648445]), NOW), "past decoy found");
});
Deno.test("player response: a real url means not a decoy; no urls means nothing", () => {
  const api = fresh();
  const real = Math.floor(NOW / 1000) + 6 * 3600;
  assert(!api.findDecoyInPlayerText(playerText([real]), NOW), "real");
  assert(!api.findDecoyInPlayerText(playerText([6938943669, real]), NOW), "any real url -> not decoy");
  assert(!api.findDecoyInPlayerText('{"streamingData":{}}', NOW), "none");
  assert(!api.findDecoyInPlayerText(null, NOW), "null");
});
Deno.test("player response inspection is wired into fetch, XHR, JSON.parse and the initial response", () => {
  assert(source.includes('if (kind === "player") inspectPlayerText(text);'), "fetch");
  assert(source.includes('=== "player") inspectPlayerText(raw);'), "xhr");
  assert(source.includes('includes("serverAbrStreamingUrl")) inspectPlayerText(text);'), "JSON.parse");
  assert(source.includes('if (kind === "player") inspectPlayerValue(current);'), "initial");
  assert(/tries\+\+ < 12/.test(source), "bounded wait for the player to switch video");
});
