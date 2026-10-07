import source from "../src/youtube.js" with { type: "text" };
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
const installYoutubeAdblock = new Function(`${source}\nreturn installYoutubeAdblock;`)();
installYoutubeAdblock(api);

const playback = "https://rr3---sn.googlevideo.com/videoplayback?id=content";

function playerResponse() {
  return {
    videoDetails: { videoId: "abc", title: "Same video" },
    streamingData: { formats: [{ url: playback, itag: 18 }] },
    playabilityStatus: { status: "OK" },
    adPlacements: [
      { adPlacementRenderer: { config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_START" } } } },
      { adPlacementRenderer: { config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_MILLISECONDS" } } } },
      { adPlacementRenderer: { config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_OVERLAY" } } } },
    ],
    playerAds: [{ playerAd: true }],
    adSlots: [
      { adSlotRenderer: { adSlotMetadata: { triggerEvent: "SLOT_TRIGGER_EVENT_BEFORE_CONTENT" } } },
      { adSlotRenderer: { adSlotMetadata: { triggerEvent: "SLOT_TRIGGER_EVENT_ON_MEDIA_TIME" } } },
    ],
    adBreakHeartbeatParams: "heartbeat",
  };
}

Deno.test("player responses drop pre-roll, mid-roll, and overlay ads and keep the video", () => {
  const original = playerResponse();
  const text = JSON.stringify(original);
  const stripped = api.stripResponseText(text, "https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
  assert(stripped.blocked, "ads were removed");
  const parsed = JSON.parse(stripped.text);
  assertEquals(parsed.videoDetails, original.videoDetails);
  assertEquals(parsed.streamingData, original.streamingData);
  assertEquals(parsed.playabilityStatus, original.playabilityStatus);
  assertEquals(parsed.adPlacements, undefined);
  assertEquals(parsed.playerAds, undefined);
  assertEquals(parsed.adSlots, undefined);
  assertEquals(parsed.adBreakHeartbeatParams, undefined);
  assert(!stripped.text.includes("AD_PLACEMENT_KIND_START"), "pre-roll placement is gone");
  assert(!stripped.text.includes("AD_PLACEMENT_KIND_MILLISECONDS"), "mid-roll placement is gone");
  assert(!stripped.text.includes("AD_PLACEMENT_KIND_OVERLAY"), "overlay placement is gone");
  assert(stripped.text.includes(playback), "the content stream url stays");
});

Deno.test("a nested player response is stripped without a blank media url", () => {
  const body = { playerResponse: playerResponse() };
  const stripped = api.stripResponseText(JSON.stringify(body), "/youtubei/v1/player");
  const parsed = JSON.parse(stripped.text);
  assertEquals(parsed.playerResponse.streamingData.formats[0].url, playback);
  assertEquals(parsed.playerResponse.adPlacements, undefined);
  assert(!stripped.text.includes("blank"), "no blank frame is substituted");
});

Deno.test("an ad-only player payload is left unchanged so the ad can play", () => {
  const text = JSON.stringify({
    adPlacements: [{ adPlacementRenderer: { config: { adPlacementConfig: { kind: "AD_PLACEMENT_KIND_START" } } } }],
    playerAds: [{ playerAd: true }],
  });
  const stripped = api.stripResponseText(text, "https://www.youtube.com/youtubei/v1/player");
  assertEquals(stripped.blocked, false);
  assertEquals(stripped.text, text);
});

Deno.test("malformed player json fails open", () => {
  const text = "{\"adPlacements\":";
  const stripped = api.stripResponseText(text, "https://www.youtube.com/youtubei/v1/player");
  assertEquals(stripped, { text, blocked: false });
});

Deno.test("video playback urls are not treated as player ads", () => {
  assertEquals(api.kindFor("https://rr3---sn.googlevideo.com/videoplayback?id=1"), "");
  assertEquals(api.kindFor("https://www.youtube.com/watch?v=abc"), "");
  assertEquals(api.kindFor("https://i.ytimg.com/vi/abc/hqdefault.jpg"), "");
  const text = JSON.stringify(playerResponse());
  const stripped = api.stripResponseText(text, "https://rr3---sn.googlevideo.com/videoplayback?id=1");
  assertEquals(stripped.blocked, false);
  assertEquals(stripped.text, text);
});

Deno.test("a player request asks YouTube not to schedule ads", () => {
  const body = JSON.stringify({
    videoId: "abc",
    context: { client: { clientName: "WEB" } },
    playbackContext: { contentPlaybackContext: { signatureTimestamp: 1, referer: "https://www.youtube.com/watch?v=abc" } },
  });
  const marked = api.applyNoAdPlayback(body);
  assert(marked.changed, "the player request is marked");
  const parsed = JSON.parse(marked.body);
  assertEquals(parsed.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, true);
  assertEquals(parsed.videoId, "abc");
  assertEquals(parsed.playbackContext.contentPlaybackContext.signatureTimestamp, 1);
  assertEquals(api.applyNoAdPlayback(marked.body).changed, false);
  assertEquals(api.applyNoAdPlayback("not-json").changed, false);
  assertEquals(api.applyNoAdPlayback(JSON.stringify({ videoId: "abc" })).body, JSON.stringify({ videoId: "abc" }));
});

Deno.test("shorts ads are removed and real shorts stay", () => {
  const sequence = {
    entries: [
      { command: { reelWatchEndpoint: { videoId: "keep-false", adClientParams: { isAd: false } } } },
      { command: { reelWatchEndpoint: { videoId: "drop-bool", adClientParams: { isAd: true } } } },
      { command: { reelWatchEndpoint: { videoId: "drop-type", videoType: "REEL_VIDEO_TYPE_AD" } } },
      { command: { reelWatchEndpoint: { videoId: "keep-plain" } } },
      { videoType: "REEL_VIDEO_TYPE_AD" },
      { command: { reelWatchEndpoint: { videoId: "keep-string", adClientParams: { isAd: "false" } } } },
      { navigationEndpoint: { reelWatchEndpoint: { videoId: "drop-nav", adClientParams: { isAd: true } } } },
    ],
  };
  const stripped = api.stripResponseText(
    JSON.stringify(sequence),
    "https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence",
  );
  assert(stripped.blocked, "shorts ads were removed");
  const ids = JSON.parse(stripped.text).entries.map((entry) => entry.command && entry.command.reelWatchEndpoint.videoId);
  assertEquals(ids, ["keep-false", "keep-plain", "keep-string"]);
});

Deno.test("watch page banner and overlay nodes are removed and videos stay", () => {
  const watch = {
    contents: {
      twoColumnWatchNextResults: {
        secondaryResults: {
          results: [
            { compactVideoRenderer: { videoId: "related" } },
            { adSlotRenderer: { renderingContent: { ad: true } } },
            { actionCompanionAdRenderer: { banner: true } },
            { content: { displayAdRenderer: { banner: true } } },
            { bannerPromoRenderer: { title: "banner" } },
          ],
        },
      },
    },
    playerResponse: playerResponse(),
  };
  const stripped = api.stripResponseText(JSON.stringify(watch), "https://www.youtube.com/youtubei/v1/next");
  const parsed = JSON.parse(stripped.text);
  const results = parsed.contents.twoColumnWatchNextResults.secondaryResults.results;
  assertEquals(results, [{ compactVideoRenderer: { videoId: "related" } }]);
  assertEquals(parsed.playerResponse.streamingData.formats[0].url, playback);
  assertEquals(parsed.playerResponse.adPlacements, undefined);
});

Deno.test("a clean player response is not rewritten", () => {
  const text = JSON.stringify({
    videoDetails: { videoId: "abc" },
    streamingData: { formats: [{ url: playback }] },
    playabilityStatus: { status: "OK" },
  });
  const stripped = api.stripResponseText(text, "https://m.youtube.com/youtubei/v1/player");
  assertEquals(stripped.blocked, false);
  assertEquals(stripped.text, text);
});

Deno.test("youtubei buffering skips failed and non-json responses", () => {
  assert(typeof api.shouldBufferYoutubei === "function", "buffer gate is exported");
  assertEquals(api.shouldBufferYoutubei({ ok: false, headers: { get() { return "application/json"; } } }), false);
  assertEquals(api.shouldBufferYoutubei({ ok: true, headers: { get() { return "image/jpeg"; } } }), false);
  assertEquals(api.shouldBufferYoutubei({ ok: true, headers: { get() { return "application/json"; } } }), true);
  assertEquals(api.shouldBufferYoutubei({ ok: true, headers: { get() { return ""; } } }), true);
  assert(source.includes("shouldBufferYoutubei(response)"), "fetch uses the buffer gate before clone");
});

Deno.test("player stripping leaves a feed card that is not a player response", () => {
  const card = { title: "feed", adSlots: [{ adSlotRenderer: { ad: true } }] };
  const stripped = api.stripValue(card, "player");
  assertEquals(stripped.blocked, false);
  assertEquals(card.adSlots.length, 1);
});

Deno.test("dom selectors remove banners and overlays and leave the video element", () => {
  const selectors = api.DOM_AD_SELECTORS.join(",");
  assert(selectors.includes(".ytp-ad-overlay-container"), "overlay ads");
  assert(selectors.includes("ytd-ad-slot-renderer"), "banner slots on the watch page");
  assert(selectors.includes("ytd-banner-promo-renderer"), "watch page banners");
  for (const selector of api.DOM_AD_SELECTORS) {
    assert(selector !== "video", selector);
    assert(selector !== "#movie_player", selector);
    assert(selector !== ".html5-video-player", selector);
    assert(selector !== "ytd-watch-flexy #player-ads", selector);
  }
  assert(source.includes('if (node.id === "player-ads") continue;'), "an empty player-ads shell stays");
  assert(source.includes("!node.childElementCount"), "an empty overlay is not removed");
});

Deno.test("the youtube script does not swap media or phone home", () => {
  assert(!source.includes(".currentTime"), "do not seek the picture");
  assert(!source.includes("playbackRate"), "do not fast-forward an ad");
  assert(!source.includes(".pause("), "do not freeze playback");
  assert(!source.includes("blankSegment"), "do not swap a blank frame");
  assert(!source.includes("nativeFetch(\""), "do not call a new host");
  assert(!source.includes("doubleclick"), "do not add an ad-network client");
  assert(source.includes("isInlinePlaybackNoAd"), "player requests opt out of scheduled ads");
  assert(source.includes('notice.textContent = "Blocking ads"'), "the player label says ads are being blocked");
  assertEquals(manifest.name, "twitch-adblock");
  assertEquals(manifest.version, "0.1.16");
  assertEquals(manifest.action.default_popup, undefined);
  const youtube = manifest.content_scripts.find((script) => script.js.includes("src/youtube.js"));
  assert(youtube, "youtube has its own content script");
  assert(youtube.matches.includes("*://www.youtube.com/*"), "www.youtube.com");
  assertEquals(youtube.world, "MAIN");
  const twitch = manifest.content_scripts.find((script) => script.js.includes("src/page.js"));
  assertEquals(twitch.js, ["src/playlist.js", "src/page.js"]);
  assert(twitch.matches.includes("*://*.twitch.tv/*"), "twitch live script stays");
});

Deno.test("home browse Sponsored cards are removed and videos stay", () => {
  const browse = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{
          tabRenderer: {
            content: {
              richGridRenderer: {
                contents: [
                  { richItemRenderer: { content: { videoRenderer: { videoId: "keep-home" } } } },
                  {
                    richItemRenderer: {
                      content: {
                        adSlotRenderer: {
                          fulfillmentContent: {
                            fulfilledLayout: {
                              inFeedAdLayoutRenderer: {
                                renderingContent: {
                                  promotedSparklesWebRenderer: {
                                    title: { simpleText: "Marriott" },
                                    subtitle: { simpleText: "Sponsored · Hotel" },
                                    description: { simpleText: "Book now" },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    richItemRenderer: {
                      content: {
                        promotedVideoRenderer: { videoId: "drop-promoted" },
                      },
                    },
                  },
                  {
                    richSectionRenderer: {
                      content: { statementBannerRenderer: { title: "promo" } },
                    },
                  },
                  { continuationItemRenderer: { token: "next-page" } },
                ],
              },
            },
          },
        }],
      },
    },
  };
  const stripped = api.stripResponseText(
    JSON.stringify(browse),
    "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
  );
  assert(stripped.blocked, "home Sponsored cards were removed");
  const items = JSON.parse(stripped.text)
    .contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
  assertEquals(items.length, 2, "video + continuation remain");
  assertEquals(items[0].richItemRenderer.content.videoRenderer.videoId, "keep-home");
  assertEquals(items[1].continuationItemRenderer.token, "next-page");
  assert(!stripped.text.includes("Marriott"), "hotel Sponsored card is gone");
  assert(!stripped.text.includes("promotedVideoRenderer"), "promoted video card is gone");
  assert(!stripped.text.includes("statementBannerRenderer"), "statement banner section is gone");
});

Deno.test("browse continuations drop in-feed ads and keep the continuation token", () => {
  const body = {
    onResponseReceivedActions: [{
      appendContinuationItemsAction: {
        continuationItems: [
          { richItemRenderer: { content: { videoRenderer: { videoId: "more" } } } },
          { richItemRenderer: { content: { inFeedAdLayoutRenderer: { ad: true } } } },
          { continuationItemRenderer: { token: "keep-scroll" } },
        ],
      },
    }],
  };
  const stripped = api.stripResponseText(JSON.stringify(body), "/youtubei/v1/browse");
  const items = JSON.parse(stripped.text).onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;
  assertEquals(items.map((item) => Object.keys(item)[0]), ["richItemRenderer", "continuationItemRenderer"]);
  assertEquals(items[1].continuationItemRenderer.token, "keep-scroll");
});

Deno.test("browse kind is recognized and home CSS targets Sponsored cards", () => {
  assertEquals(api.kindFor("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false"), "browse");
  assert(api.HOME_FEED_AD_CSS.includes("ytd-rich-item-renderer:has(ytd-ad-slot-renderer)"), "rich item with ad slot");
  assert(api.HOME_FEED_AD_CSS.includes("ytd-promoted-sparkles-web-renderer"), "sparkles sponsored card");
  assert(api.HOME_FEED_AD_CSS.includes("ytd-in-feed-ad-layout-renderer"), "in-feed ad layout");
  assert(api.WATCH_AD_KEYS.includes("promotedSparklesWebRenderer"), "sparkles key");
  assert(api.WATCH_AD_KEYS.includes("inFeedAdLayoutRenderer"), "in-feed key");
  assert(source.includes("injectHomeFeedCss"), "home CSS is injected");
  assert(source.includes('kind === "browse"'), "browse stripping is enabled");
  assert(!api.HOME_FEED_AD_CSS.includes("ytd-rich-item-renderer:has(ytd-rich-grid-media)"), "normal home videos are not hidden");
});
