import exclusionsSource from "../src/general/exclusions.js" with { type: "text" };
import togglesSource from "../src/general/toggles.js" with { type: "text" };
import cosmeticSource from "../src/general/cosmetic.js" with { type: "text" };
import youtubeSource from "../src/youtube.js" with { type: "text" };
import vendorSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };
import debugSource from "../src/debug.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

const exclusions = {};
const toggles = {};
const cosmetic = {};
new Function(`${exclusionsSource}\nreturn installGeneralAdblockExclusions;`)()(exclusions);
new Function(`${togglesSource}\nreturn installGeneralAdblockToggles;`)()(toggles);
new Function(`${cosmeticSource}\nreturn installGeneralAdblockCosmetic;`)()(cosmetic, exclusions, toggles);

const on = toggles.emptyState();

Deno.test("cosmetic skips Twitch, YouTube family, and Kick even when master is on", () => {
  for (const page of [
    "https://www.twitch.tv/some/channel",
    "https://m.twitch.tv/",
    "https://www.youtube.com/watch?v=abc",
    "https://music.youtube.com/",
    "https://www.youtubekids.com/",
    "https://youtu.be/abc",
    "https://www.kick.com/streamer",
    "https://player.kick.com/embed/x",
  ]) {
    assertEquals(cosmetic.shouldApplyCosmetic(page, on), false, page);
    assertEquals(cosmetic.skipReason(page, on), "excluded-host", page);
  }
});

Deno.test("cosmetic skips excluded video hosts", () => {
  assertEquals(cosmetic.shouldApplyCosmetic("rr3---sn.googlevideo.com", on), false);
  assertEquals(cosmetic.shouldApplyCosmetic("usher.ttvnw.net", on), false);
  assertEquals(cosmetic.shouldApplyCosmetic("abc.live-video.net", on), false);
  assertEquals(cosmetic.skipReason("usher.ttvnw.net", on), "excluded-host");
});

Deno.test("cosmetic can run on an ordinary site when master is on", () => {
  assertEquals(cosmetic.shouldApplyCosmetic("https://news.example/article", on), true);
  assertEquals(cosmetic.skipReason("https://news.example/article", on), "");
});

Deno.test("cosmetic respects master off and page allow", () => {
  const off = toggles.setMasterEnabled(on, false);
  assertEquals(cosmetic.shouldApplyCosmetic("https://news.example/", off), false);
  assertEquals(cosmetic.skipReason("https://news.example/", off), "master-off");

  const allowed = toggles.allowPage(on, "https://broken.example/ads");
  assertEquals(cosmetic.shouldApplyCosmetic("https://broken.example/ads", allowed), false);
  assertEquals(cosmetic.skipReason("https://broken.example/ads", allowed), "page-allowed");
  assertEquals(cosmetic.shouldApplyCosmetic("https://other.example/", allowed), true);
});

Deno.test("cosmetic module does not edit playback scripts", () => {
  assert(!cosmeticSource.includes("installYoutubeAdblock"));
  assert(!cosmeticSource.includes("video-swap-new"));
  assert(!cosmeticSource.includes("reloadTwitchPlayer"));
  assert(youtubeSource.includes("installYoutubeAdblock"), "youtube stays");
  assert(vendorSource.includes("ourTwitchAdSolutionsVersion = 23"), "vendor stays");
  assert(debugSource.includes("installTwitchAdblockDebug"), "debug stays");
});
