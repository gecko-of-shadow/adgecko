import source from "../src/kick.js" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal values"}\n${left}\n${right}`);
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const api = {};
const installKickAdblock = new Function(`${source}\nreturn installKickAdblock;`)();
installKickAdblock(api);

const detail = {
  adObject: { targetPlayheadForAdSkip: 130, adClickthroughUrl: "https://ads.example/click" },
};

Deno.test("kick hosts are only kick.com", () => {
  assert(api.onKickHost("kick.com"), "apex");
  assert(api.onKickHost("www.kick.com"), "www");
  assert(api.onKickHost("player.kick.com"), "player embed");
  assert(!api.onKickHost("notkick.com"), "suffix lookalike");
  assert(!api.onKickHost("kick.com.evil.test"), "prefix lookalike");
  assert(!api.onKickHost(""), "empty");
});

Deno.test("skip targets come from the ad object and ignore junk", () => {
  assertEquals(api.readSkipTarget(detail), 130);
  assertEquals(api.readSkipTarget({ metadata: { targetPlayheadForAdSkip: 12 } }), 12);
  assertEquals(api.readSkipTarget({ targetPlayheadForAdSkip: 0 }), 0);
  assertEquals(api.readSkipTarget({ targetPlayheadForAdSkip: -1 }), null);
  assertEquals(api.readSkipTarget({ targetPlayheadForAdSkip: Number.NaN }), null);
  assertEquals(api.readSkipTarget({ targetPlayheadForAdSkip: "130" }), null);
  assertEquals(api.readSkipTarget(null), null);
  assertEquals(api.readSkipTarget("PlayerAdBreakStarted"), null);
});

Deno.test("a long rewind is refused and a short skip is kept", () => {
  assert(api.seekWouldRewind(4000, 0), "live edge back to zero");
  assert(api.seekWouldRewind(500, 10), "far backward");
  assert(!api.seekWouldRewind(100, 90), "short step back");
  assert(!api.seekWouldRewind(100, 140), "forward to the end of the break");
  assert(!api.seekWouldRewind(10, 0), "early preroll");
  assert(!api.seekWouldRewind(null, 0), "unknown position does not invent a rewind");
});

Deno.test("an ad break seeks forward when it can, otherwise asks the player to skip", () => {
  const seek = api.chooseSkip({
    detail,
    position: 100,
    hasSkipAd: true,
    allowSkipAd: true,
    now: 1000,
    attempts: [],
  });
  assertEquals(seek.action, "seek");
  assertEquals(seek.target, 130);

  const skip = api.chooseSkip({
    detail: { metadata: { sessionId: "abc" } },
    position: 100,
    hasSkipAd: true,
    allowSkipAd: true,
    now: 1000,
    attempts: [],
  });
  assertEquals(skip.action, "skipAd");

  const rewind = api.chooseSkip({
    detail: { targetPlayheadForAdSkip: 0 },
    position: 4000,
    hasSkipAd: false,
    allowSkipAd: false,
    now: 1000,
    attempts: [],
  });
  assertEquals(rewind.action, "play");
  assertEquals(rewind.attempts, []);
});

Deno.test("two skips in a minute is the cap", () => {
  const first = api.chooseSkip({
    detail: {},
    position: 10,
    hasSkipAd: true,
    allowSkipAd: true,
    now: 1000,
    attempts: [],
  });
  const second = api.chooseSkip({
    detail: {},
    position: 10,
    hasSkipAd: true,
    allowSkipAd: true,
    now: 2000,
    attempts: first.attempts,
  });
  const third = api.chooseSkip({
    detail,
    position: 10,
    hasSkipAd: true,
    allowSkipAd: true,
    now: 3000,
    attempts: second.attempts,
  });
  assertEquals(first.action, "skipAd");
  assertEquals(second.action, "skipAd");
  assertEquals(third.action, "play");
  assertEquals(third.attempts.length, api.SKIP_LIMIT);
  const later = api.chooseSkip({
    detail: {},
    position: 10,
    hasSkipAd: true,
    allowSkipAd: true,
    now: 3000 + api.SKIP_WINDOW_MS + 1,
    attempts: third.attempts,
  });
  assertEquals(later.action, "skipAd");
});

Deno.test("worker messages skip a break once and keep the playhead", () => {
  let state = api.emptyState();
  const time = api.reduceIvsMessage(state, { id: 4, type: "PlayerTimeUpdate", arg: 100 }, 1000);
  assertEquals(time.command, null);
  assertEquals(time.state.position, 100);
  assertEquals(time.state.playerId, 4);

  const started = api.reduceIvsMessage(time.state, { id: 4, type: "PlayerAdBreakStarted", arg: detail }, 1100);
  assertEquals(started.command, { id: 4, funcName: "seekTo", args: [130] });

  const again = api.reduceIvsMessage(started.state, { id: 4, type: "PlayerAdBreakStarted", arg: detail }, 1200);
  assertEquals(again.command, null, "the same break does not seek twice");

  const ended = api.reduceIvsMessage(again.state, { id: 4, type: "PlayerAdBreakEnded" }, 2000);
  assertEquals(ended.state.holdUntil, 0);
  const next = api.reduceIvsMessage(
    { ...api.emptyState(), playerId: 4, position: 100 },
    { id: 4, type: "PlayerAdBreakStarted", arg: { metadata: { sessionId: "s" } } },
    5000,
  );
  assertEquals(next.command, { id: 4, funcName: "skipAd", args: undefined });
  const precise = api.reduceSessionDetail(next.state, detail, 5100);
  assertEquals(precise.command, { id: 4, funcName: "seekTo", args: [130] }, "a real skip point still wins after skipAd");
  const third = api.reduceIvsMessage(precise.state, { id: 4, type: "PlayerAdBreakStarted", arg: {} }, 5200);
  assertEquals(third.command, null, "skipAd does not run again after the seek");
});

Deno.test("a stitched target seeks only when the player id is known and the jump is safe", () => {
  const missing = api.reduceSessionDetail(api.emptyState(), detail, 1000);
  assertEquals(missing.command, null);
  assertEquals(missing.state.attempts, []);

  const ready = api.reduceSessionDetail({ ...api.emptyState(), playerId: 7, position: 100 }, detail, 1000);
  assertEquals(ready.command, { id: 7, funcName: "seekTo", args: [130] });

  const rewind = api.reduceSessionDetail({ ...api.emptyState(), playerId: 7, position: 4000 }, { targetPlayheadForAdSkip: 0 }, 1000);
  assertEquals(rewind.command, null);
  assertEquals(rewind.state.attempts, []);
});

Deno.test("junk worker messages do not throw", () => {
  const junk = [null, undefined, "", 0, { type: "PlayerError", arg: { code: 1 } }, { id: 1 }];
  let state = api.emptyState();
  for (const message of junk) {
    const result = api.reduceIvsMessage(state, message, 50);
    state = result.state;
    assertEquals(result.command, null);
  }
  const session = api.reduceSessionDetail(state, { adObject: null }, 60);
  assertEquals(session.command, null);
});

Deno.test("ad chrome is hidden and the video element is not", () => {
  const css = api.chromeCss();
  assert(css.includes('[data-testid="ad-click-overlay"]'), "click catcher");
  assert(css.includes('[aria-label="Ad progress"]'), "progress bar");
  assert(css.includes("#consolidated_header"), "header banner slot");
  assert(css.includes("#native_feed_ad"), "feed banner slot");
  assert(css.includes('iframe[id^="google_ads_iframe"]'), "banner frame");
  assert(css.includes('div:has(> video-player):has([data-testid="ima-ad-controls"])'), "post-roll cover");
  assert(!css.includes("video{"), "video stays visible");
  assert(!css.includes("video,"), "video is not in the hide list");
  for (const selector of api.AD_CHROME_SELECTORS) {
    assert(selector !== "video", selector);
  }
});

function node(tag, children) {
  const element = { tagName: tag, children: children || [], parentElement: null };
  for (const child of element.children) child.parentElement = element;
  return element;
}

Deno.test("the post-roll cover is separate from the live video", () => {
  const live = node("VIDEO");
  const slate = node("VIDEO");
  const player = node("VIDEO-PLAYER", [slate]);
  const controls = node("DIV");
  const overlay = node("DIV", [player, controls]);
  const shell = node("DIV", [live, overlay]);
  assert(api.postRollOverlay(controls) === overlay, "cover is the post-roll box");
  assert(api.postRollOverlay(controls) !== shell, "shell stays");
  assertEquals(api.videosInside(overlay).map((item) => item.tagName), ["VIDEO"]);
  assert(api.videosInside(overlay)[0] === slate, "slate clip");
  assert(!api.videosInside(overlay).includes(live), "live video is outside the cover");
});

Deno.test("a banner frame collapses its box unless that box also holds video", () => {
  const frame = node("IFRAME");
  const slot = node("DIV", [frame]);
  assert(api.bannerCollapseTarget(frame) === slot, "empty slot collapses");
  const live = node("VIDEO");
  const shell = node("DIV", [live, frame]);
  assert(api.bannerCollapseTarget(frame) === frame, "a box with video keeps the frame only");
  assert(shell.children.includes(live));
});

Deno.test("the kick script does not mute, rate-change, or phone home", () => {
  assert(source.includes("PlayerAdBreakStarted"), "ivs ad break");
  assert(source.includes("skipAd"), "player skip");
  assert(source.includes("targetPlayheadForAdSkip"), "stitched skip point");
  assert(source.includes("amazon-ivs-wasmworker"), "only the ivs worker is watched");
  assert(!source.includes('querySelectorAll("video")'), "do not grab every video");
  assert(source.includes("videosInside(overlay)"), "only clips inside the post-roll cover are paused");
  assert(!source.includes("playbackRate"), "do not fast-forward");
  assert(!source.includes(".currentTime"), "do not seek the video element");
  assert(!source.includes("innerHTML"), "no html injection");
  assert(!source.includes("doubleclick"), "no ad-network client");
  assert(!source.includes("chrome."), "no extension api");
  assert(!api.isIvsWorkerUrl("https://kick.com/api/v1/stream/1/playback"), "playback api is not the worker");
  assert(api.isIvsWorkerUrl("/ivs/1.2.3/amazon-ivs-wasmworker.min.js"), "same-origin worker");
});

Deno.test("kick has its own content script", () => {
  const kick = manifest.content_scripts.find((script) => script.js.includes("src/kick.js"));
  assert(kick, "kick script");
  assertEquals(kick.js, ["src/kick.js"]);
  assertEquals(kick.world, "MAIN");
  assertEquals(kick.run_at, "document_start");
  assertEquals(kick.all_frames, true);
  assert(kick.matches.includes("*://kick.com/*"), "apex match");
  assert(kick.matches.includes("*://*.kick.com/*"), "subdomain match");
  const twitch = manifest.content_scripts.find((script) => script.js.includes("src/vendor/video-swap-new.user.js"));
  assertEquals(twitch.js, ["src/vendor/video-swap-new.user.js"]);
});
