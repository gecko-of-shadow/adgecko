/**
 * Emulates upstream reloadTwitchPlayer handoff without live Twitch usher.
 * video-swap-new: setSrc + immediate play; localStorage hooks preserve quality/mute/volume.
 */
import pageSource from "../src/vendor/video-swap-new.user.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

Deno.test("reloadTwitchPlayer source matches upstream setSrc handoff", () => {
  const start = pageSource.indexOf("function reloadTwitchPlayer");
  const end = pageSource.indexOf("function onContentLoaded", start);
  const block = pageSource.slice(start, end);
  assert(block.includes("setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true })"), "setSrc refreshes usher");
  assert(block.includes("player.play()"), "immediate play after setSrc");
  assert(!block.includes("getHTMLVideoElement"), "no HTMLVideoElement play nudge");
  assert(!block.includes("}, 800);"), "upstream does not use the 800ms restore timer");
  assert(!block.includes("}, 1000);"), "no second restore at 1000ms");
  assert(block.includes("localStorageHookFailed"), "falls back when localStorage hooks fail");
});

Deno.test("reloadTwitchPlayer skips paused players", () => {
  const start = pageSource.indexOf("function reloadTwitchPlayer");
  const end = pageSource.indexOf("function onContentLoaded", start);
  const block = pageSource.slice(start, end);
  assert(block.includes("player.isPaused() || player.core?.paused"), "paused players are left alone");
});

Deno.test("pause/resume path uses reloadTwitchPlayer(true)", () => {
  assert(pageSource.includes("reloadTwitchPlayer(true)"), "UboPauseResumePlayer path");
  assert(pageSource.includes("reloadTwitchPlayer(false)"), "UboReloadPlayer path");
  const start = pageSource.indexOf("function reloadTwitchPlayer");
  const end = pageSource.indexOf("function onContentLoaded", start);
  const block = pageSource.slice(start, end);
  assert(block.includes("if (isPausePlay)"), "pause/play branch");
  assert(block.includes("player.pause()"), "pause then play");
});

Deno.test("worker reload messages still reach reloadTwitchPlayer", () => {
  assert(pageSource.includes("UboReloadPlayer"), "reload message key");
  assert(pageSource.includes("UboPauseResumePlayer"), "pause/resume message key");
  assertEquals(
    pageSource.includes("claimReload") || pageSource.includes("reloadCeiling"),
    false,
    "hand-rewrite reload ceiling is not part of upstream",
  );
});
