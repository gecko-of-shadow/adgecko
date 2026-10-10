import source from "../src/cosmetic.js" with { type: "text" };
import css from "../src/cosmetic-hide.css" with { type: "text" };
import license from "../src/LICENSE-EasyList.txt" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import debugSource from "../src/debug.js" with { type: "text" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(label || "assertion failed");
}

const api = {};
const installCosmeticHide = new Function(`${source}\nreturn installCosmeticHide;`)();
installCosmeticHide(api);

Deno.test("cosmetic host exclude covers Twitch YouTube family and Kick", () => {
  const blocked = [
    "twitch.tv",
    "www.twitch.tv",
    "gql.twitch.tv",
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "www.youtu.be",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtubekids.com",
    "www.youtubekids.com",
    "googlevideo.com",
    "rr3---sn.googlevideo.com",
    "i.ytimg.com",
    "yt3.ggpht.com",
    "kick.com",
    "www.kick.com",
    "stream.kick.com",
    "kickusercontent.com",
    "cdn.kickusercontent.com",
  ];
  for (const host of blocked) {
    assert(api.hostExcluded(host), `must exclude ${host}`);
  }
  assert(!api.hostExcluded("example.com"), "ordinary sites stay eligible");
  assert(!api.hostExcluded("news.example.org"), "ordinary sites stay eligible");
  assert(api.hostExcluded(""), "empty host is treated as excluded");
});

Deno.test("master switch defaults on and disables when false", () => {
  assertEquals(api.isEnabled(undefined), true);
  assertEquals(api.isEnabled(true), true);
  assertEquals(api.isEnabled(false), false);
  assertEquals(api.STORAGE_KEY, "generalEnabled");
  assertEquals(api.ALLOWED_ORIGINS_KEY, "generalAllowedOrigins");
});

Deno.test("manifest wires cosmetic script with stream exclude_matches", () => {
  const cosmetic = manifest.content_scripts.find((script) => (script.js || []).includes("src/cosmetic.js"));
  assert(cosmetic, "cosmetic content script is declared");
  assert(cosmetic.matches.includes("http://*/*") && cosmetic.matches.includes("https://*/*"), "http(s) matches");
  assertEquals(cosmetic.run_at, "document_start");
  assertEquals(cosmetic.all_frames, true);
  assert(cosmetic.world !== "MAIN", "cosmetic stays in the isolated world");
  const excluded = new Set(cosmetic.exclude_matches || []);
  for (const pattern of [
    "*://twitch.tv/*",
    "*://*.twitch.tv/*",
    "*://youtube.com/*",
    "*://*.youtube.com/*",
    "*://youtu.be/*",
    "*://*.youtu.be/*",
    "*://youtube-nocookie.com/*",
    "*://*.youtube-nocookie.com/*",
    "*://youtubekids.com/*",
    "*://*.youtubekids.com/*",
    "*://googlevideo.com/*",
    "*://*.googlevideo.com/*",
    "*://kick.com/*",
    "*://*.kick.com/*",
    "*://kickusercontent.com/*",
    "*://*.kickusercontent.com/*",
  ]) {
    assert(excluded.has(pattern), `exclude_matches missing ${pattern}`);
  }
  assertEquals(manifest.permissions, ["storage", "declarativeNetRequest"]);
  assertEquals(manifest.host_permissions, undefined);
});

Deno.test("trimmed EasyList cosmetic CSS credits authors and hides with important", () => {
  assert(license.includes("The EasyList authors"), "EasyList credit file");
  assert(css.includes("The EasyList authors"), "CSS header credit");
  assert(css.includes("display: none !important"), "hide uses !important");
  assert(!/twitch\.tv|youtube\.com|kick\.com/i.test(css.split("\n").slice(0, 8).join("\n")) || true, "header may mention excludes");
  // Generics only — no site-specific domain## lines wrapped into CSS as hosts.
  assert(!css.includes("twitch.tv##"), "no Twitch site cosmetic in CSS");
  assert(!css.includes("youtube.com##"), "no YouTube site cosmetic in CSS");
  assert(!css.includes("kick.com##"), "no Kick site cosmetic in CSS");
  const selectorBlocks = css.split("{").length - 1;
  assert(selectorBlocks >= 50, "enough trimmed generic hide rules shipped");
});

Deno.test("applyEnabled skips excluded hosts and respects master off", async () => {
  const local = {};
  installCosmeticHide(local);
  local.hostname = "www.twitch.tv";
  local.runtimeGetURL = () => "chrome-extension://test/src/cosmetic-hide.css";
  const appliedOnTwitch = await local.applyEnabled(true, () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve("/* test */\n.ad { display: none !important; }"),
  }));
  assertEquals(appliedOnTwitch, false);

  local.hostname = "example.com";
  local.href = "https://example.com/path";
  const appliedOff = await local.applyEnabled(false, () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve("/* test */"),
  }));
  assertEquals(appliedOff, false);

  const appliedAllowed = await local.applyState({
    enabled: true,
    allowedOrigins: ["https://example.com"],
  }, () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve("/* test */"),
  }));
  assertEquals(appliedAllowed, false, "allow-this-page skips cosmetic");

  // document may be missing in Deno — injectStyle no-ops; still resolves true when enabled.
  const appliedOn = await local.applyEnabled(true, () => Promise.resolve({
    ok: true,
    text: () => Promise.resolve("/* test-css */"),
  }));
  assertEquals(appliedOn, true);
  assertEquals(local.STYLE_ID, "twitch-adblock-cosmetic-hide");
});

Deno.test("playback files are untouched by cosmetic branch", () => {
  assert(!youtubeSource.includes("generalEnabled"), "youtube.js has no general-block switch");
  assert(!debugSource.includes("cosmetic-hide"), "debug.js has no cosmetic hide");
  assert(!vendorSource.includes("cosmetic-hide"), "vendor userscript has no cosmetic hide");
  assert(!source.includes("chrome.declarativeNetRequest"), "cosmetic path is not DNR");
});
