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
  assert(!/\.currentTime\s*=/.test(source), "do not seek the picture");
  assert(!source.includes("playbackRate"), "do not fast-forward an ad");
  assert(!source.includes(".pause("), "do not freeze playback");
  assert(!source.includes("blankSegment"), "do not swap a blank frame");
  assert(!source.includes("nativeFetch(\""), "do not call a new host");
  assert(!source.includes("doubleclick"), "do not add an ad-network client");
  assert(source.includes("isInlinePlaybackNoAd"), "player requests opt out of scheduled ads");
  assert(source.includes('notice.textContent = "Blocking ads"'), "the player label says ads are being blocked");
  assertEquals(manifest.name, "twitch-adblock");
  assertEquals(manifest.version, "0.2.9");
  assertEquals(manifest.action.default_popup, "src/popup.html");
  assertEquals(manifest.permissions, ["storage", "declarativeNetRequest"]);
  assertEquals(manifest.host_permissions, undefined);
  assertEquals(manifest.optional_host_permissions, undefined);
  assertEquals(manifest.background.service_worker, "src/general-background.js");
  assertEquals(manifest.declarative_net_request.rule_resources[0].id, "general");
  assertEquals(manifest.declarative_net_request.rule_resources[0].enabled, true);
  assertEquals(manifest.declarative_net_request.rule_resources[0].path, "src/rules/general-network.json");
  assert(
    (manifest.web_accessible_resources || []).some((entry) =>
      (entry.resources || []).includes("src/cosmetic-hide.css")
    ),
    "leftover-box stylesheet is web accessible",
  );
  const youtube = manifest.content_scripts.find((script) => script.js.includes("src/youtube.js"));
  assert(youtube, "youtube has its own content script");
  assert(youtube.matches.includes("*://www.youtube.com/*"), "www.youtube.com");
  assertEquals(youtube.world, "MAIN");
  const twitch = manifest.content_scripts.find((script) =>
    (script.js || []).includes("src/vendor/video-swap-new.user.js")
  );
  assertEquals(twitch.js, ["src/vendor/video-swap-new.user.js"]);
  assertEquals(twitch.world, "MAIN");
  assertEquals(youtube.js, ["src/debug.js", "src/youtube.js"]);
  const bridge = manifest.content_scripts.find((script) => (script.js || []).includes("src/debug-bridge.js"));
  assert(bridge, "debug popup bridge is a content script");
  assert(bridge.world !== "MAIN", "debug bridge stays out of the page world");
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

Deno.test("search results drop sponsored cards and keep videos", () => {
  assertEquals(api.kindFor("https://www.youtube.com/youtubei/v1/search?prettyPrint=false"), "browse");
  assert(api.WATCH_AD_KEYS.includes("searchPyvRenderer"), "search ad item is an ad key");
  assert(api.HOME_FEED_AD_CSS.includes("ytd-search-pyv-renderer"), "search ad element is hidden if it still renders");
  const search = {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                contents: [
                  { videoRenderer: { videoId: "keep-search" } },
                  { searchPyvRenderer: { ads: [{ adSlotRenderer: { adSlotMetadata: { slotId: "slot" } } }] } },
                  { continuationItemRenderer: { token: "next-search" } },
                ],
              },
            }],
          },
        },
      },
    },
  };
  const stripped = api.stripResponseText(JSON.stringify(search), "https://www.youtube.com/youtubei/v1/search");
  assert(stripped.blocked, "search ads were removed");
  const items = JSON.parse(stripped.text)
    .contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0]
    .itemSectionRenderer.contents;
  assertEquals(items.map((item) => Object.keys(item)[0]), ["videoRenderer", "continuationItemRenderer"]);
  assertEquals(items[0].videoRenderer.videoId, "keep-search");
  assert(!stripped.text.includes("searchPyvRenderer"), "search promoted block is gone");
  assert(!stripped.text.includes("adSlotRenderer"), "search ad slot is gone");
  assert(source.includes('path.startsWith("/results")'), "search pages strip initial data like browse");
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

function encodeVarint(value) {
  const bytes = [];
  let rest = value;
  while (rest > 127) {
    bytes.push((rest & 127) | 128);
    rest = Math.floor(rest / 128);
  }
  bytes.push(rest);
  return bytes;
}

function decodeVarint(bytes, offset, end) {
  let value = 0;
  let factor = 1;
  let index = offset;
  while (index < end && factor <= 268435456) {
    const bite = bytes[index++];
    value += (bite & 127) * factor;
    if ((bite & 128) === 0) return { value, next: index };
    factor *= 128;
  }
  return null;
}

// Independent of the extension: how long the real player would sit on the
// black spinner. Part 35 field 4 is backoffTimeMs.
function spinnerHoldMs(bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] >= 128) return null;
    const type = bytes[offset];
    let size;
    let headerLen;
    if (bytes[offset + 1] < 128) {
      size = bytes[offset + 1];
      headerLen = 2;
    } else if (bytes[offset + 1] < 192) {
      size = (bytes[offset + 1] & 63) + 64 * bytes[offset + 2];
      headerLen = 3;
    } else {
      return null;
    }
    const start = offset + headerLen;
    const end = start + size;
    if (end > bytes.length) return null;
    if (type === 35) {
      let index = start;
      while (index < end) {
        const key = decodeVarint(bytes, index, end);
        if (!key) return null;
        const field = key.value >>> 3;
        const wire = key.value & 7;
        if (wire === 0) {
          const val = decodeVarint(bytes, key.next, end);
          if (!val) return null;
          if (field === 4) return val.value;
          index = val.next;
        } else if (wire === 2) {
          const len = decodeVarint(bytes, key.next, end);
          if (!len) return null;
          index = len.next + len.value;
        } else {
          return null;
        }
      }
    }
    offset = end;
  }
  return 0;
}

function umpPart(type, payload) {
  if (payload.length < 128) return Uint8Array.from([type, payload.length, ...payload]);
  const size = payload.length;
  const second = Math.floor(size / 64);
  const first = 128 + (size % 64);
  return Uint8Array.from([type, first, second, ...payload]);
}

function policyPart(backoffMs) {
  const cookie = [9, 8, 7, 6];
  const payload = [
    0x3a, cookie.length, ...cookie,
    0x08, ...encodeVarint(1500),
    0x20, ...encodeVarint(backoffMs),
  ];
  return { part: umpPart(35, payload), cookie };
}

Deno.test("clicking a video does not sit on a 10 second black loading spinner", () => {
  const { part, cookie } = policyPart(10000);
  const media = umpPart(21, Array.from({ length: 200 }, (_, index) => index & 255));
  const raw = new Uint8Array(media.length + part.length);
  raw.set(media, 0);
  raw.set(part, media.length);
  assertEquals(spinnerHoldMs(raw), 10000);
  const patched = api.patchUmpBackoff(raw);
  assertEquals(patched.length, raw.length, "the stream is not resized");
  assertEquals(spinnerHoldMs(patched), 0, "the player no longer waits out the backoff");
  assertEquals(Array.from(patched.subarray(0, media.length)), Array.from(media), "picture bytes stay");
  assert(Array.from(patched).join(",").includes(cookie.join(",")), "the playback cookie stays");
  assertEquals(api.isSabrPlayback("https://rr3---sn.googlevideo.com/videoplayback?id=1"), true);
  assertEquals(api.isSabrPlayback("https://www.youtube.com/watch?v=abc"), false);
  assert(source.includes("createUmpBackoffParser"), "playback responses go through the backoff parser");
  assert(!/\.currentTime\s*=/.test(source), "do not seek the picture");
});

Deno.test("a backoff split across stream chunks is still cleared", () => {
  const { part } = policyPart(10000);
  const parser = api.createUmpBackoffParser();
  const mid = 4;
  const head = parser.push(part.subarray(0, mid));
  const rest = parser.push(part.subarray(mid));
  const tail = parser.finish();
  const joined = new Uint8Array(head.length + rest.length + tail.length);
  joined.set(head, 0);
  joined.set(rest, head.length);
  joined.set(tail, head.length + rest.length);
  assertEquals(spinnerHoldMs(joined), 0);
  assertEquals(joined.length, part.length);
});

Deno.test("a normal media file is not rewritten as a SABR policy", () => {
  const mp4 = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  const patched = api.patchUmpBackoff(mp4);
  assertEquals(Array.from(patched), Array.from(mp4));
});

function holdsIn(bytes) {
  const found = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] >= 128) break;
    const type = bytes[offset];
    let size;
    let headerLen;
    if (offset + 1 >= bytes.length) break;
    if (bytes[offset + 1] < 128) {
      size = bytes[offset + 1];
      headerLen = 2;
    } else if (bytes[offset + 1] < 192 && offset + 2 < bytes.length) {
      size = (bytes[offset + 1] & 63) + 64 * bytes[offset + 2];
      headerLen = 3;
    } else {
      break;
    }
    const start = offset + headerLen;
    const end = start + size;
    if (end > bytes.length) break;
    if (type === 35) {
      let index = start;
      while (index < end) {
        const key = decodeVarint(bytes, index, end);
        if (!key) break;
        const field = key.value >>> 3;
        const wire = key.value & 7;
        if (wire === 0) {
          const val = decodeVarint(bytes, key.next, end);
          if (!val) break;
          if (field === 4) found.push(val.value);
          index = val.next;
        } else if (wire === 2) {
          const len = decodeVarint(bytes, key.next, end);
          if (!len || len.next + len.value > end) break;
          index = len.next + len.value;
        } else {
          break;
        }
      }
    }
    offset = end;
  }
  return found;
}

Deno.test("a later part 35 and an earlier backoff are both cleared", () => {
  const first = policyPart(10000).part;
  const second = policyPart(22000).part;
  const media = umpPart(21, [1, 2, 3, 4]);
  const raw = new Uint8Array(first.length + media.length + second.length);
  raw.set(first, 0);
  raw.set(media, first.length);
  raw.set(second, first.length + media.length);
  assertEquals(holdsIn(raw), [10000, 22000]);
  const patched = api.patchUmpBackoff(raw);
  assertEquals(patched.length, raw.length);
  assertEquals(holdsIn(patched), [0, 0]);
  assertEquals(Array.from(patched.subarray(first.length, first.length + media.length)), [21, 4, 1, 2, 3, 4]);
});

Deno.test("the first backoff stays cleared when a later field does not parse", () => {
  const payload = [0x20, ...encodeVarint(22000), 0x4f];
  const raw = umpPart(35, payload);
  assertEquals(spinnerHoldMs(raw), 22000);
  const patched = api.patchUmpBackoff(raw);
  assertEquals(patched.length, raw.length);
  assertEquals(spinnerHoldMs(patched), 0);
});

Deno.test("an earlier field 4 is cleared, because the player reads that one", () => {
  const payload = [0x20, ...encodeVarint(22000), 0x20, 0x00];
  const raw = umpPart(35, payload);
  assertEquals(holdsIn(raw), [22000, 0]);
  const patched = api.patchUmpBackoff(raw);
  assertEquals(patched.length, raw.length);
  assertEquals(holdsIn(patched), [0, 0]);
});

Deno.test("a cutoff part 35 still drops a backoff that already arrived", () => {
  const payload = [0x20, ...encodeVarint(22000), 0x3a, 4, 9, 8, 7, 6];
  const part = umpPart(35, payload);
  const parser = api.createUmpBackoffParser();
  const head = parser.push(part.subarray(0, part.length - 1));
  const tail = parser.finish();
  assertEquals(head.length, 0, "an unfinished policy stays buffered");
  assertEquals(tail.length, part.length - 1);
  const width = encodeVarint(22000);
  const zeroed = [0x20, ...width.map(() => 128)];
  zeroed[zeroed.length - 1] = 0;
  const flat = Array.from(tail).join(",");
  assert(flat.includes(zeroed.join(",")), "the arrived backoff is zero and the same width");
  assert(!flat.includes([0x20, ...width].join(",")), "the original backoff is gone");
});

function varintsInPart(bytes, partType, fieldNo) {
  const found = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes[offset] >= 128) break;
    const type = bytes[offset];
    let size;
    let headerLen;
    if (offset + 1 >= bytes.length) break;
    if (bytes[offset + 1] < 128) {
      size = bytes[offset + 1];
      headerLen = 2;
    } else if (bytes[offset + 1] < 192 && offset + 2 < bytes.length) {
      size = (bytes[offset + 1] & 63) + 64 * bytes[offset + 2];
      headerLen = 3;
    } else {
      break;
    }
    const start = offset + headerLen;
    const end = start + size;
    if (end > bytes.length) break;
    if (type === partType) {
      let index = start;
      while (index < end) {
        const key = decodeVarint(bytes, index, end);
        if (!key) break;
        const field = key.value >>> 3;
        const wire = key.value & 7;
        if (wire === 0) {
          const val = decodeVarint(bytes, key.next, end);
          if (!val) break;
          if (field === fieldNo) found.push(val.value);
          index = val.next;
        } else if (wire === 2) {
          const len = decodeVarint(bytes, key.next, end);
          if (!len || len.next + len.value > end) break;
          if (partType === 47 && (field === 1 || field === 2)) {
            let inner = len.next;
            const innerEnd = len.next + len.value;
            while (inner < innerEnd) {
              const innerKey = decodeVarint(bytes, inner, innerEnd);
              if (!innerKey) break;
              const innerField = innerKey.value >>> 3;
              const innerWire = innerKey.value & 7;
              if (innerWire !== 0) break;
              const innerVal = decodeVarint(bytes, innerKey.next, innerEnd);
              if (!innerVal) break;
              if (innerField === fieldNo) found.push(innerVal.value);
              inner = innerVal.next;
            }
          }
          index = len.next + len.value;
        } else {
          break;
        }
      }
    }
    offset = end;
  }
  return found;
}

function ajq(bandwidth, readahead) {
  return [0x08, ...encodeVarint(bandwidth), 0x10, ...encodeVarint(readahead)];
}

Deno.test("a newer playback part does not hide a later backoff", () => {
  const newer = umpPart(90, [1, 2, 3, 4, 5]);
  const policy = policyPart(22000).part;
  const raw = new Uint8Array(newer.length + policy.length);
  raw.set(newer, 0);
  raw.set(policy, newer.length);
  assertEquals(spinnerHoldMs(raw), 22000);
  const patched = api.patchUmpBackoff(raw);
  assertEquals(patched.length, raw.length);
  assertEquals(spinnerHoldMs(patched), 0);
  assertEquals(Array.from(patched.subarray(0, newer.length)), Array.from(newer));
});

Deno.test("the start-buffer wait and the video readahead target are cleared", () => {
  const start = ajq(1500, 12000);
  const resume = ajq(800, 11000);
  const payload = [0x0a, start.length, ...start, 0x12, resume.length, ...resume];
  const part = umpPart(47, payload);
  const backoff = policyPart(10000).part;
  const videoTarget = umpPart(35, [0x08, ...encodeVarint(1500), 0x10, ...encodeVarint(9000), 0x20, ...encodeVarint(10000)]);
  const raw = new Uint8Array(part.length + backoff.length + videoTarget.length);
  raw.set(part, 0);
  raw.set(backoff, part.length);
  raw.set(videoTarget, part.length + backoff.length);
  assertEquals(varintsInPart(raw, 47, 2), [12000, 11000]);
  assertEquals(varintsInPart(raw, 47, 1), [1500, 800]);
  assertEquals(varintsInPart(raw, 35, 2), [9000]);
  const patched = api.patchUmpBackoff(raw);
  assertEquals(patched.length, raw.length);
  assertEquals(varintsInPart(patched, 47, 2), [0, 0]);
  assertEquals(varintsInPart(patched, 47, 1), [1500, 800]);
  assertEquals(holdsIn(patched), [0, 0]);
  assertEquals(varintsInPart(patched, 35, 2), [0]);
  assertEquals(varintsInPart(patched, 35, 1), [1500, 1500]);
  assertEquals(api.isSabrPlayback("https://rr3---sn.googlevideo.com/initplayback?source=youtube"), true);
  assertEquals(api.isSabrPlayback("https://www.youtube.com/initplayback?source=youtube"), false);
});

Deno.test("a player response loses its start-buffer wait and keeps the video", () => {
  const body = {
    videoDetails: { videoId: "dQw4w9WgXcQ", title: "Same video" },
    streamingData: {
      formats: [{ url: playback, itag: 18 }],
      serverAbrStreamingUrl: playback,
    },
    playabilityStatus: { status: "OK" },
    playerConfig: {
      mediaCommonConfig: {
        useServerDrivenAbr: true,
        serverPlaybackStartConfig: {
          enable: true,
          playbackStartPolicy: {
            startMinReadaheadPolicy: [{ minReadaheadMs: 12000, minBandwidthBytesPerSec: 1500 }],
            resumeMinReadaheadPolicy: [
              { minReadaheadMs: 11000, minBandwidthBytesPerSec: 800 },
              { minReadaheadMs: 13000, minBandwidthBytesPerSec: 400 },
            ],
          },
        },
      },
    },
  };
  const stripped = api.stripResponseText(JSON.stringify(body), "https://www.youtube.com/youtubei/v1/player");
  assert(stripped.blocked, "the start wait is rewritten");
  const parsed = JSON.parse(stripped.text);
  const common = parsed.playerConfig.mediaCommonConfig;
  const config = common.serverPlaybackStartConfig;
  const policy = config.playbackStartPolicy;
  assertEquals(config.enable, false);
  assertEquals(common.useServerDrivenAbr, false);
  assertEquals(policy.startMinReadaheadPolicy[0].minReadaheadMs, 0);
  assertEquals(policy.startMinReadaheadPolicy[0].minBandwidthBytesPerSec, 1500);
  assertEquals(policy.resumeMinReadaheadPolicy[0].minReadaheadMs, 0);
  assertEquals(policy.resumeMinReadaheadPolicy[1].minReadaheadMs, 0);
  assertEquals(policy.resumeMinReadaheadPolicy[0].minBandwidthBytesPerSec, 800);
  assertEquals(parsed.streamingData.formats[0].url, playback);
  assertEquals(parsed.streamingData.serverAbrStreamingUrl, playback);
  assertEquals(parsed.videoDetails.videoId, "dQw4w9WgXcQ");
});

Deno.test("a listed start policy is cleared and a normal quality pick stays", () => {
  const listed = {
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    streamingData: { formats: [{ url: playback }], serverAbrStreamingUrl: playback },
    playabilityStatus: { status: "OK" },
    playerConfig: {
      mediaCommonConfig: {
        serverPlaybackStartConfig: {
          enable: true,
          playbackStartPolicy: [
            { minReadaheadMs: 12000, minBandwidthBytesPerSec: 1500 },
          ],
        },
      },
    },
  };
  const stripped = api.stripResponseText(JSON.stringify(listed), "https://www.youtube.com/youtubei/v1/player");
  const parsed = JSON.parse(stripped.text);
  const config = parsed.playerConfig.mediaCommonConfig.serverPlaybackStartConfig;
  assertEquals(config.enable, false);
  assertEquals(config.playbackStartPolicy[0].minReadaheadMs, 0);
  assertEquals(config.playbackStartPolicy[0].minBandwidthBytesPerSec, 1500);
  assertEquals(parsed.streamingData.serverAbrStreamingUrl, playback);
  const ordinary = {
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    streamingData: { formats: [{ url: playback }], serverAbrStreamingUrl: playback },
    playabilityStatus: { status: "OK" },
    playerConfig: { mediaCommonConfig: { useServerDrivenAbr: true } },
  };
  const text = JSON.stringify(ordinary);
  const left = api.stripResponseText(text, "https://www.youtube.com/youtubei/v1/player");
  assertEquals(left.blocked, false);
  assertEquals(left.text, text);
});

function matchesOne(node, selector) {
  if (selector === "yt-notification-action-renderer") return node.tag === "yt-notification-action-renderer";
  if (selector === "tp-yt-paper-toast") return node.tag === "tp-yt-paper-toast";
  if (selector === "tp-yt-paper-toast#toast") return node.tag === "tp-yt-paper-toast" && node.id === "toast";
  if (selector === "tp-yt-paper-toast.toast-button") {
    return node.tag === "tp-yt-paper-toast" && String(node.className).split(/\s+/).includes("toast-button");
  }
  const href = selector.match(/^a\[href\*="([^"]+)"\]$/);
  return Boolean(href && node.tag === "a" && String(node.href || "").includes(href[1]));
}

function matchesList(node, selector) {
  return String(selector).split(",").some((part) => matchesOne(node, part.trim()));
}

function walkNodes(node, out) {
  for (const child of node.children || []) {
    out.push(child);
    walkNodes(child, out);
  }
}

function toastNode(tag, props) {
  const node = {
    nodeType: 1,
    tag,
    id: props.id || "",
    className: props.className || "",
    textContent: props.text || "",
    href: props.href || "",
    children: props.children || [],
    parent: null,
    removed: false,
  };
  for (const child of node.children) child.parent = node;
  node.matches = (selector) => matchesList(node, selector);
  node.closest = (selector) => {
    let current = node;
    while (current) {
      if (current.matches && current.matches(selector)) return current;
      current = current.parent;
    }
    return null;
  };
  node.querySelector = (selector) => {
    const all = [];
    walkNodes(node, all);
    return all.find((item) => matchesList(item, selector)) || null;
  };
  node.querySelectorAll = (selector) => {
    const all = [];
    walkNodes(node, all);
    return all.filter((item) => matchesList(item, selector));
  };
  node.remove = () => {
    node.removed = true;
  };
  return node;
}

Deno.test("the interruptions toast is removed and other toasts stay", () => {
  const link = toastNode("a", { href: "https://www.youtube.com/#check_ad_blockers" });
  const interruptions = toastNode("yt-notification-action-renderer", {
    text: "Experiencing interruptions?",
    children: [toastNode("tp-yt-paper-toast", { id: "toast", className: "toast-button", text: "Experiencing interruptions?" })],
  });
  const hrefOnly = toastNode("yt-notification-action-renderer", {
    text: "Playback problem",
    children: [link],
  });
  const copied = toastNode("tp-yt-paper-toast", { id: "toast", text: "Copied to clipboard" });
  const root = toastNode("div", { children: [interruptions, hrefOnly, copied] });
  assert(api.isInterruptionsToast(interruptions), "the interruptions renderer matches");
  assert(api.isInterruptionsToast(hrefOnly), "a blocker link matches without the sentence");
  assert(!api.isInterruptionsToast(copied), "a clipboard toast is not the interruptions toast");
  api.removeInterruptionsToast(root);
  assert(interruptions.removed, "the interruptions renderer is removed");
  assert(hrefOnly.removed, "the blocker-link renderer is removed");
  assert(!copied.removed, "the clipboard toast stays");
  const remover = source.slice(
    source.indexOf("function removeInterruptionsToast"),
    source.indexOf("function shouldNudgeStart"),
  );
  assert(!remover.includes("notify"), "removing the toast does not start the Blocking ads chip");
  assert(!remover.includes("display:"), "the toast is removed, not hidden");
  assert(source.includes("api.removeInterruptionsToast()"), "the page watcher removes the toast");
  assert(source.includes("video.play()"), "a paused start can be asked to play");
  assert(source.includes("playVideo"), "the player play method is used when it exists");
  assert(!/\.currentTime\s*=/.test(source), "do not seek the picture");
  assert(!source.includes(".pause("), "do not freeze playback");
});

Deno.test("only a paused black start is asked to play", () => {
  const paused = {
    used: false,
    duration: 213,
    readyState: 2,
    paused: true,
    currentTime: 0,
    classes: "unstarted-mode",
    spinner: true,
  };
  assert(api.shouldNudgeStart(paused), "a paused start with the spinner up can play");
  assert(!api.shouldNudgeStart({ ...paused, paused: false }), "an unpaused hold is left to the buffer clear");
  assert(!api.shouldNudgeStart({ ...paused, currentTime: 4 }), "playback that has moved is left alone");
  assert(!api.shouldNudgeStart({ ...paused, classes: "ad-showing html5-video-player", spinner: true }), "an ad is not nudged");
  assert(!api.shouldNudgeStart({ ...paused, used: true }), "one nudge per video");
  assert(!api.shouldNudgeStart({ ...paused, readyState: 1, spinner: true }), "nothing plays before picture data exists");
  assert(!api.shouldNudgeStart({ ...paused, spinner: false, classes: "playing-mode" }), "a playing picture is left alone");
  assert(api.shouldNudgeStart({ ...paused, spinner: false, classes: "buffering-mode" }), "a paused buffer at the start can play");
});
