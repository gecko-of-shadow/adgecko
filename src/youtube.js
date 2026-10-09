// Runs on YouTube at document_start. Ads are removed from the player
// response so the same video keeps playing. Home-feed Sponsored cards
// are stripped from browse JSON and hidden with CSS. Nothing here
// replaces the picture with a blank frame.
function installYoutubeAdblock(target) {
  const nativeJSONParse = JSON.parse;
  const PLAYER_AD_FIELDS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams", "adBreakParams"];
  const WATCH_AD_KEYS = [
    "adSlotRenderer",
    "displayAdRenderer",
    "actionCompanionAdRenderer",
    "playerLegacyDesktopWatchAdsRenderer",
    "linearAdSequenceRenderer",
    "companionAdRenderer",
    "playerBytesAdLayoutRenderer",
    "instreamVideoAdRenderer",
    "bannerPromoRenderer",
    "promotedSparklesWebRenderer",
    "promotedVideoRenderer",
    "compactPromotedVideoRenderer",
    "inFeedAdLayoutRenderer",
    "carouselAdRenderer",
    "brandVideoShelfRenderer",
    "brandVideoSingletonRenderer",
    "statementBannerRenderer",
  ];
  const DOM_AD_SELECTORS = [
    ".ytp-ad-overlay-container",
    ".ytp-ad-overlay-slot",
    "ytd-watch-flexy ytd-ad-slot-renderer",
    "ytd-watch-flexy ytd-action-companion-ad-renderer",
    "ytd-watch-flexy ytd-display-ad-renderer",
    "ytd-watch-flexy ytd-player-legacy-desktop-watch-ads-renderer",
    "ytd-watch-flexy ytd-banner-promo-renderer",
    "ytd-reel-video-renderer ytd-ad-slot-renderer",
    "ytd-shorts ytd-ad-slot-renderer",
    "ytm-companion-ad-renderer",
    "ytm-promoted-sparkles-web-renderer",
  ];
  // Home-feed Sponsored cards (CSS hide; brief flash is OK).
  const HOME_FEED_AD_CSS = [
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
    "ytd-rich-item-renderer:has(ytd-display-ad-renderer)",
    "ytd-rich-item-renderer:has(ytd-promoted-sparkles-web-renderer)",
    "ytd-rich-item-renderer:has(ytd-promoted-video-renderer)",
    "ytd-rich-item-renderer:has(ytd-compact-promoted-video-renderer)",
    "ytd-rich-item-renderer:has(ytd-in-feed-ad-layout-renderer)",
    "ytd-rich-item-renderer:has(ytd-carousel-ad-renderer)",
    "ytd-rich-section-renderer:has(ytd-statement-banner-renderer)",
    "ytd-rich-section-renderer:has(ytd-brand-video-shelf-renderer)",
    "ytd-rich-section-renderer:has(ytd-brand-video-singleton-renderer)",
    "ytd-ad-slot-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-compact-promoted-video-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-carousel-ad-renderer",
    "ytd-statement-banner-renderer",
    "ytm-promoted-sparkles-web-renderer",
    "ytm-ad-slot-renderer",
  ].join(",");

  function kindFor(url) {
    let parsed;
    try {
      parsed = new URL(String(url || ""), "https://www.youtube.com");
    } catch {
      return "";
    }
    const host = parsed.hostname;
    if (host !== "www.youtube.com" && host !== "m.youtube.com" && host !== "youtube.com" && host !== "youtubei.googleapis.com") {
      return "";
    }
    const path = parsed.pathname;
    if (path.includes("/youtubei/v1/player") || path.includes("/youtubei/v1/get_midroll")) return "player";
    if (path.includes("/youtubei/v1/reel/")) return "reel";
    if (path.includes("/youtubei/v1/next") || path.includes("/youtubei/v1/get_watch")) return "watch";
    if (path.includes("/youtubei/v1/browse")) return "browse";
    return "";
  }

  function textLooksLikeAds(text) {
    const source = String(text || "");
    return source.includes('"adPlacements"')
      || source.includes('"playerAds"')
      || source.includes('"adSlots"')
      || source.includes('"adBreakHeartbeatParams"')
      || source.includes('"adBreakParams"')
      || source.includes('"adSlotRenderer"')
      || source.includes('"actionCompanionAdRenderer"')
      || source.includes('"displayAdRenderer"')
      || source.includes('"bannerPromoRenderer"')
      || source.includes('"promotedSparklesWebRenderer"')
      || source.includes('"promotedVideoRenderer"')
      || source.includes('"compactPromotedVideoRenderer"')
      || source.includes('"inFeedAdLayoutRenderer"')
      || source.includes('"carouselAdRenderer"')
      || source.includes('"brandVideoShelfRenderer"')
      || source.includes('"brandVideoSingletonRenderer"')
      || source.includes('"statementBannerRenderer"')
      || source.includes("REEL_VIDEO_TYPE_AD")
      || source.includes('"isAd":true')
      || source.includes('"isAd": true');
  }

  // Skip clone+buffer on failed or clearly non-JSON youtubei responses.
  // Still buffer OK JSON/text bodies — ad markers can appear anywhere in browse/watch.
  function shouldBufferYoutubei(response) {
    if (!response || !response.ok) return false;
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (!type) return true;
    return type.includes("json") || type.includes("text") || type.includes("javascript");
  }

  function hasRealAdField(node, field) {
    if (!Object.prototype.hasOwnProperty.call(node, field)) return false;
    const value = node[field];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.length > 0;
    return value != null;
  }

  function isPlayerCarrier(node) {
    return Boolean(
      node.videoDetails
      || node.streamingData
      || node.playabilityStatus
      || node.playerResponse
      || node.adPlacements
      || node.playerAds
      || node.adBreakHeartbeatParams
      || node.adBreakParams
    );
  }

  function hasVideoContent(item) {
    return Boolean(item.videoDetails || item.streamingData || item.videoRenderer || item.compactVideoRenderer || item.reelItemRenderer || item.lockupViewModel);
  }

  function rootHasPlayback(value) {
    if (!value || typeof value !== "object") return false;
    if (value.videoDetails || value.streamingData || value.playabilityStatus) return true;
    const nested = value.playerResponse;
    return Boolean(nested && (nested.videoDetails || nested.streamingData || nested.playabilityStatus));
  }

  function endpointIsAd(endpoint) {
    if (!endpoint || typeof endpoint !== "object") return false;
    if (endpoint.videoType === "REEL_VIDEO_TYPE_AD") return true;
    return Boolean(endpoint.adClientParams && endpoint.adClientParams.isAd === true);
  }

  function isShortsAdEntry(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if (item.videoType === "REEL_VIDEO_TYPE_AD") return true;
    const command = item.command || {};
    const navigation = item.navigationEndpoint || {};
    const reelItem = item.reelItemRenderer || {};
    const reelNavigation = reelItem.navigationEndpoint || {};
    const onTap = item.onTap || {};
    const tapCommand = onTap.innertubeCommand || {};
    return [
      item.reelWatchEndpoint,
      command.reelWatchEndpoint,
      navigation.reelWatchEndpoint,
      reelNavigation.reelWatchEndpoint,
      tapCommand.reelWatchEndpoint,
    ].some(endpointIsAd);
  }

  function isWatchAdNode(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    if (item.continuationItemRenderer) return false;
    if (hasVideoContent(item)) return false;
    if (WATCH_AD_KEYS.some((key) => item[key] != null)) return true;
    const content = item.content;
    if (content && !Array.isArray(content) && !hasVideoContent(content) && WATCH_AD_KEYS.some((key) => content[key] != null)) return true;
    const rich = item.richItemRenderer && item.richItemRenderer.content;
    if (rich && !hasVideoContent(rich) && WATCH_AD_KEYS.some((key) => rich[key] != null)) return true;
    const section = item.richSectionRenderer && item.richSectionRenderer.content;
    if (section && !hasVideoContent(section) && WATCH_AD_KEYS.some((key) => section[key] != null)) return true;
    return false;
  }

  function stripValue(value, kind) {
    let copy;
    try {
      copy = nativeJSONParse(JSON.stringify(value));
    } catch {
      return { value, blocked: false };
    }
    let blocked = false;
    const seen = new WeakSet();
    const dropEntries = kind === "reel" || kind === "watch" || kind === "browse";

    function visit(node) {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (let index = node.length - 1; index >= 0; index--) {
          const item = node[index];
          if (dropEntries && (isShortsAdEntry(item) || isWatchAdNode(item))) {
            node.splice(index, 1);
            blocked = true;
            continue;
          }
          visit(item);
        }
        return;
      }
      if (isPlayerCarrier(node)) {
        for (const field of PLAYER_AD_FIELDS) {
          if (!hasRealAdField(node, field)) continue;
          delete node[field];
          blocked = true;
        }
      } else if (kind === "reel" && hasRealAdField(node, "adSlots")) {
        delete node.adSlots;
        blocked = true;
      }
      if (dropEntries) {
        for (const key of WATCH_AD_KEYS) {
          if (node[key] == null || hasVideoContent(node)) continue;
          delete node[key];
          blocked = true;
        }
      }
      for (const key of Object.keys(node)) visit(node[key]);
    }

    visit(copy);
    return { value: blocked ? copy : value, blocked };
  }

  function stripResponseText(text, url) {
    const kind = kindFor(url);
    if (!kind || typeof text !== "string" || !textLooksLikeAds(text)) return { text, blocked: false };
    try {
      const parsed = nativeJSONParse(text);
      const stripped = stripValue(parsed, kind);
      if (!stripped.blocked) return { text, blocked: false };
      if (kind === "player" && !rootHasPlayback(stripped.value)) return { text, blocked: false };
      return { text: JSON.stringify(stripped.value), blocked: true };
    } catch {
      return { text, blocked: false };
    }
  }

  function applyNoAdPlayback(body) {
    if (typeof body !== "string" || !body.includes("contentPlaybackContext")) return { body, changed: false };
    let parsed;
    try {
      parsed = nativeJSONParse(body);
    } catch {
      return { body, changed: false };
    }
    const playback = parsed && parsed.playbackContext && parsed.playbackContext.contentPlaybackContext;
    if (!playback || typeof playback !== "object" || Array.isArray(playback)) return { body, changed: false };
    if (playback.isInlinePlaybackNoAd === true) return { body, changed: false };
    playback.isInlinePlaybackNoAd = true;
    try {
      return { body: JSON.stringify(parsed), changed: true };
    } catch {
      return { body, changed: false };
    }
  }

  Object.assign(target, {
    DOM_AD_SELECTORS,
    HOME_FEED_AD_CSS,
    PLAYER_AD_FIELDS,
    WATCH_AD_KEYS,
    kindFor,
    textLooksLikeAds,
    shouldBufferYoutubei,
    isShortsAdEntry,
    isWatchAdNode,
    rootHasPlayback,
    stripValue,
    stripResponseText,
    applyNoAdPlayback,
  });
}

function startYoutubeAdblock() {
  if (globalThis.__twitchAdblockYoutube) return;
  globalThis.__twitchAdblockYoutube = true;

  function trace(kind, detail) {
    try {
      const debug = globalThis.TwitchAdblockDebug;
      if (!debug || debug.on !== true) return;
      debug.trace(kind, detail);
    } catch {
      // Debug never changes playback.
    }
  }

  function logFailOpen(error) {
    console.log("twitch-adblock youtube failed open", error);
    trace("fail-open", "youtube");
  }

  const api = {};
  installYoutubeAdblock(api);
  const nativeFetch = window.fetch.bind(window);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeParse = JSON.parse;
  let hideTimer = 0;
  let noticeGeneration = 0;
  const retryTimers = new Set();

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function onWatchSurface() {
    const path = location.pathname || "";
    return path === "/watch" || path.startsWith("/shorts");
  }

  function isAdOnlyPlayer(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    if (api.rootHasPlayback(value)) return false;
    const keys = Object.keys(value);
    if (!keys.length) return false;
    const adKeys = new Set(["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams", "adBreakParams"]);
    return keys.every((key) => adKeys.has(key));
  }

  function playerRoot() {
    const active = document.querySelector("ytd-reel-video-renderer[is-active]");
    if (active) return active.querySelector("#player-container") || active.querySelector(".html5-video-player") || active;
    return document.querySelector("#movie_player")
      || document.querySelector("#shorts-player")
      || document.querySelector("ytd-watch-flexy #player");
  }

  function clearNoticeTimers() {
    clearTimeout(hideTimer);
    hideTimer = 0;
    for (const timer of retryTimers) clearTimeout(timer);
    retryTimers.clear();
  }

  function notify(blocking, attempt, generation) {
    if (blocking && !attempt) trace("youtube", "blocked");
    const existing = document.getElementById("twitch-adblock-notice");
    if (!blocking) {
      noticeGeneration += 1;
      clearNoticeTimers();
      if (existing) existing.remove();
      return;
    }
    const gen = generation == null ? noticeGeneration : generation;
    if (gen !== noticeGeneration) return;
    const player = playerRoot();
    if (!player) {
      const next = (attempt || 0) + 1;
      if (next <= 8) {
        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          notify(true, next, gen);
        }, 500);
        retryTimers.add(timer);
      }
      return;
    }
    const notice = existing || document.createElement("div");
    notice.id = "twitch-adblock-notice";
    notice.textContent = "Blocking ads";
    notice.style.cssText = "position:absolute;top:8px;left:8px;z-index:60;color:#fff;background:rgba(0,0,0,.75);padding:4px 8px;font:12px/1.2 sans-serif;pointer-events:none;";
    if (notice.parentElement !== player) player.appendChild(notice);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (gen === noticeGeneration) notify(false);
    }, 8000);
  }

  function removeDomAds() {
    if (!onWatchSurface()) return;
    const nodes = document.querySelectorAll(api.DOM_AD_SELECTORS.join(","));
    let removed = false;
    for (const node of nodes) {
      if (node.id === "player-ads") continue;
      const shadowChildren = node.shadowRoot ? node.shadowRoot.childElementCount : 0;
      if (!node.childElementCount && !shadowChildren && !(node.textContent || "").trim()) continue;
      node.remove();
      removed = true;
    }
    if (removed) notify(true);
  }

  function hookInitial(name, kind) {
    if (!kind) return;
    let current;
    try {
      current = window[name];
    } catch {
      current = undefined;
    }
    if (current && typeof current === "object") {
      try {
        const stripped = api.stripValue(current, kind);
        if (stripped.blocked && (kind !== "player" || api.rootHasPlayback(stripped.value))) {
          current = stripped.value;
          notify(true);
        }
      } catch (error) {
        logFailOpen(error);
      }
    }
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() {
          return current;
        },
        set(value) {
          current = value;
          if (!value || typeof value !== "object") return;
          try {
            const stripped = api.stripValue(value, kind);
            if (!stripped.blocked) return;
            if (kind === "player" && !api.rootHasPlayback(stripped.value)) return;
            current = stripped.value;
            notify(true);
          } catch (error) {
            logFailOpen(error);
            current = value;
          }
        },
      });
    } catch (error) {
      logFailOpen(error);
    }
  }

  function initialDataKind() {
    const path = location.pathname || "";
    if (path === "/watch") return "watch";
    if (path.startsWith("/shorts")) return "reel";
    if (path === "/" || path === "") return "browse";
    return "";
  }

  async function rewritePlayerBody(input, init) {
    if (init && typeof init.body === "string") {
      const marked = api.applyNoAdPlayback(init.body);
      if (!marked.changed) return { input, init };
      return { input, init: Object.assign({}, init, { body: marked.body }) };
    }
    if ((!init || init.body == null) && typeof Request !== "undefined" && input instanceof Request) {
      const text = await input.clone().text();
      const marked = api.applyNoAdPlayback(text);
      if (!marked.changed) return { input, init };
      return { input: new Request(input, { body: marked.body }), init };
    }
    return { input, init };
  }

  window.fetch = function (input, init) {
    const url = requestUrl(input);
    const kind = api.kindFor(url);
    if (!kind) return nativeFetch(input, init);
    const replay = input instanceof Request ? input.clone() : input;
    const prepare = kind === "player" ? rewritePlayerBody(input, init) : Promise.resolve({ input, init });
    return prepare.then((prepared) => nativeFetch(prepared.input, prepared.init).then((response) => {
      if (!api.shouldBufferYoutubei(response)) return response;
      return response.clone().text().then((text) => {
        const stripped = api.stripResponseText(text, url);
        if (!stripped.blocked) {
          if ((kind === "player" || kind === "reel") && !api.textLooksLikeAds(text)) notify(false);
          return response;
        }
        notify(true);
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(stripped.text, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }).catch((error) => {
        logFailOpen(error);
        return response;
      });
    })).catch((error) => {
      logFailOpen(error);
      return nativeFetch(replay, init);
    });
  };

  function installXhrStrip(xhr) {
    if (xhr.__ytAdblock) return;
    xhr.__ytAdblock = true;
    const textDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
    const responseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
    Object.defineProperty(xhr, "responseText", {
      configurable: true,
      get() {
        const raw = textDesc.get.call(xhr);
        if (xhr.readyState !== 4) return raw;
        if (xhr.__ytCacheGen === xhr.__ytGen) return xhr.__ytCacheText;
        const stripped = api.stripResponseText(raw, xhr.__ytUrl || "");
        xhr.__ytCacheText = stripped.blocked ? stripped.text : raw;
        xhr.__ytCacheGen = xhr.__ytGen;
        if (stripped.blocked) notify(true);
        else if ((api.kindFor(xhr.__ytUrl || "") === "player" || api.kindFor(xhr.__ytUrl || "") === "reel") && !api.textLooksLikeAds(raw)) notify(false);
        return xhr.__ytCacheText;
      },
    });
    Object.defineProperty(xhr, "response", {
      configurable: true,
      get() {
        if (xhr.responseType === "" || xhr.responseType === "text") return xhr.responseText;
        const raw = responseDesc.get.call(xhr);
        if (xhr.readyState !== 4 || xhr.responseType !== "json" || !raw || typeof raw !== "object") return raw;
        try {
          const stripped = api.stripValue(raw, api.kindFor(xhr.__ytUrl || ""));
          if (stripped.blocked && (api.kindFor(xhr.__ytUrl || "") !== "player" || api.rootHasPlayback(stripped.value))) {
            notify(true);
            return stripped.value;
          }
        } catch (error) {
          logFailOpen(error);
        }
        return raw;
      },
    });
  }

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ytUrl = String(url || "");
    this.__ytGen = (this.__ytGen || 0) + 1;
    if (api.kindFor(this.__ytUrl)) installXhrStrip(this);
    return nativeOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (api.kindFor(this.__ytUrl || "") === "player" && typeof body === "string") {
      try {
        const marked = api.applyNoAdPlayback(body);
        if (marked.changed) body = marked.body;
      } catch (error) {
        logFailOpen(error);
      }
    }
    return nativeSend.call(this, body);
  };

  JSON.parse = function (text, reviver) {
    const value = nativeParse.call(this, text, reviver);
    if (typeof text !== "string" || !api.textLooksLikeAds(text)) return value;
    const path = location.pathname || "";
    const kind = path.startsWith("/shorts")
      ? "reel"
      : (path === "/watch" ? "watch" : ((path === "/" || path === "") ? "browse" : "player"));
    try {
      if (isAdOnlyPlayer(value)) return value;
      const stripped = api.stripValue(value, kind);
      if (!stripped.blocked) return value;
      // Browse/watch/reel only drop ad entries. Player payloads must stay playable.
      if (kind === "browse" || kind === "watch" || kind === "reel") {
        notify(true);
        return stripped.value;
      }
      if (!api.rootHasPlayback(stripped.value) && !api.rootHasPlayback(value)) return value;
      if (kind === "player" && !api.rootHasPlayback(stripped.value)) return value;
      notify(true);
      return stripped.value;
    } catch (error) {
      logFailOpen(error);
      return value;
    }
  };

  hookInitial("ytInitialPlayerResponse", "player");
  hookInitial("ytInitialData", initialDataKind());

  function injectHomeFeedCss() {
    try {
      if (typeof document === "undefined" || !document.createElement) return;
      if (document.getElementById && document.getElementById("twitch-adblock-yt-home-css")) return;
      const style = document.createElement("style");
      style.id = "twitch-adblock-yt-home-css";
      style.textContent = api.HOME_FEED_AD_CSS + "{display:none!important;}";
      const parent = document.head || document.documentElement;
      if (!parent || typeof parent.appendChild !== "function") return;
      parent.appendChild(style);
    } catch (error) {
      logFailOpen(error);
    }
  }

  function watchDom() {
    injectHomeFeedCss();
    const root = document.documentElement;
    if (!root || typeof MutationObserver !== "function") return;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        removeDomAds();
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    removeDomAds();
  }

  injectHomeFeedCss();
  document.addEventListener("yt-navigate-start", () => notify(false), true);
  document.addEventListener("yt-navigate-finish", () => {
    injectHomeFeedCss();
    removeDomAds();
  }, true);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchDom, { once: true });
  } else {
    watchDom();
  }

  console.log("twitch-adblock: watching YouTube");
}

if (typeof document !== "undefined" && typeof window !== "undefined") startYoutubeAdblock();
