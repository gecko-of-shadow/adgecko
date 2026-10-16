// Runs on YouTube at document_start. Ads are removed from the player
// response so the same video keeps playing. Home-feed Sponsored cards
// are stripped from browse JSON and hidden with CSS. Nothing here
// replaces the picture with a blank frame. A SABR next-request policy
// can still hold that player on a black loading spinner for the ad-length
// backoff (often 10 seconds) after a click. The same wait is in the first
// /initplayback response and in the start-buffer policy. Both are cleared
// below, and player requests ask YouTube not to schedule the slot.
function uboLayerPresent() {
  try {
    return globalThis[Symbol.for("twitch-adblock.ubo")] === true;
  } catch {
    return false;
  }
}

function installYoutubeAdblock(target) {
  const nativeJSONParse = JSON.parse;
  // A/B toggles for how visible our edits are to YouTube's ad-block checks.
  // emptyAdFields: ad fields become [] (array fields) instead of being deleted.
  // zeroStartPolicies: zero the start/resume readahead waits (old behaviour).
  // patchUmpBackoff: rewrite backoff fields inside the SABR media stream.
  // failoverOn403: try other hosts on a 403 (useless: 403 = flagged url).
  const STEALTH = { emptyAdFields: true, zeroStartPolicies: false, patchUmpBackoff: false, failoverOn403: false };
  // uBO layer (src/vendor/ubo-youtube.js, uBlock Origin's own YouTube filters)
  // loads first. When present it owns player-response ad pruning, so our
  // homemade player ad-field strip and ytInitialPlayerResponse trap stand down.
  // Read live, not cached at install: the MAIN-world uBO bundle may be
  // injected after this script (826a054 log: cached false -> 2s reloads).
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
    "searchPyvRenderer",
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
    "ytd-search-pyv-renderer",
  ].join(",");
  // The bottom-left interruptions toast. :has() keeps "Saved" and clipboard
  // toasts on screen. Deleting the node makes YouTube open a new one.
  const INTERRUPTIONS_TOAST_CSS = [
    "yt-notification-action-renderer:has(yt-formatted-string[split-lines*=\"Experiencing interruptions\"])",
    "yt-notification-action-renderer:has(a[href*=\"3037019\"])",
    "yt-notification-action-renderer:has(a[href*=\"ad_block\"])",
    "yt-notification-action-renderer:has(a[href*=\"blocker\"])",
    "yt-notification-action-renderer:has(a[href*=\"check_ad_blockers\"])",
    "tp-yt-paper-toast#toast:has(yt-formatted-string[split-lines*=\"Experiencing interruptions\"])",
    "tp-yt-paper-toast#toast:has(a[href*=\"3037019\"])",
    "tp-yt-paper-toast#toast:has(a[href*=\"ad_block\"])",
    "tp-yt-paper-toast#toast:has(a[href*=\"blocker\"])",
    "tp-yt-paper-toast#toast:has(a[href*=\"check_ad_blockers\"])",
    "ytd-popup-container:has(yt-formatted-string[split-lines*=\"Experiencing interruptions\"])",
    "ytd-popup-container:has(a[href*=\"3037019\"])",
    "ytd-popup-container:has(a[href*=\"ad_block\"])",
    "ytd-popup-container:has(a[href*=\"check_ad_blockers\"])",
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
    if (path.includes("/youtubei/v1/browse") || path.includes("/youtubei/v1/search")) return "browse";
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
      || source.includes('"searchPyvRenderer"')
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

  // The player will not show the first picture until minReadaheadMs of media
  // is buffered. That wait lives on the start and resume policies, including
  // when those policies are arrays. Zeroing it leaves the bandwidth floor and
  // the video urls alone. The server start switch stays on. Turning it off
  // leaves the player on the black spinner with the interruptions toast.
  // Server ABR stays on: a video that has only a SABR url still has a stream.
  function zeroPolicyList(list) {
    const items = Array.isArray(list) ? list : list && typeof list === "object" ? [list] : null;
    if (!items) return false;
    let changed = false;
    for (const item of items) {
      if (Array.isArray(item)) {
        if (zeroPolicyList(item)) changed = true;
        continue;
      }
      if (!item || typeof item !== "object") continue;
      if (zeroReadaheadNumbers(item)) changed = true;
      if (item.startMinReadaheadPolicy && item.startMinReadaheadPolicy !== list && zeroPolicyList(item.startMinReadaheadPolicy)) {
        changed = true;
      }
      if (item.resumeMinReadaheadPolicy && item.resumeMinReadaheadPolicy !== list && zeroPolicyList(item.resumeMinReadaheadPolicy)) {
        changed = true;
      }
    }
    return changed;
  }

  function zeroStartPolicies(node) {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return zeroPolicyList(node);
    let changed = false;
    if (zeroPolicyList(node.startMinReadaheadPolicy)) changed = true;
    if (zeroPolicyList(node.resumeMinReadaheadPolicy)) changed = true;
    if (zeroReadaheadNumbers(node)) changed = true;
    const policy = node.playbackStartPolicy;
    if (policy && typeof policy === "object" && policy !== node && zeroStartPolicies(policy)) changed = true;
    const start = node.serverPlaybackStartConfig;
    if (start && typeof start === "object" && !Array.isArray(start) && start !== node && zeroStartPolicies(start)) {
      changed = true;
    }
    return changed;
  }

  // minReadaheadMs is the JSON start wait. minVideoReadaheadMs and
  // minAudioReadaheadMs are the same wait when the player response uses the
  // SABR names. The audio target and the request keepalive are not waits.
  function zeroReadaheadNumbers(item) {
    if (!item || typeof item !== "object") return false;
    let changed = false;
    for (const key of ["minReadaheadMs", "minVideoReadaheadMs", "minAudioReadaheadMs"]) {
      if (typeof item[key] === "number" && item[key] !== 0) {
        item[key] = 0;
        changed = true;
      }
    }
    return changed;
  }

  function textHasStartHold(text) {
    if (!STEALTH.zeroStartPolicies) return false;
    const source = String(text || "");
    return source.includes("startMinReadaheadPolicy")
      || source.includes("resumeMinReadaheadPolicy")
      || source.includes("serverPlaybackStartConfig")
      || source.includes('"minReadaheadMs"')
      || source.includes('"minVideoReadaheadMs"')
      || source.includes('"minAudioReadaheadMs"');
  }

  // Normal no-ad responses carry empty lists, so keep the key and its type.
  function clearAdField(node, field) {
    if (STEALTH.emptyAdFields && Array.isArray(node[field])) node[field] = [];
    else delete node[field];
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
    const dropEntries = !uboLayerPresent() && (kind === "reel" || kind === "watch" || kind === "browse");

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
      if (isPlayerCarrier(node) && !uboLayerPresent()) {
        for (const field of PLAYER_AD_FIELDS) {
          if (!hasRealAdField(node, field)) continue;
          clearAdField(node, field);
          blocked = true;
        }
      } else if (kind === "reel" && !uboLayerPresent() && hasRealAdField(node, "adSlots")) {
        clearAdField(node, "adSlots");
        blocked = true;
      }
      if (dropEntries) {
        for (const key of WATCH_AD_KEYS) {
          if (node[key] == null || hasVideoContent(node)) continue;
          delete node[key];
          blocked = true;
        }
      }
      if (STEALTH.zeroStartPolicies && zeroStartPolicies(node)) blocked = true;
      for (const key of Object.keys(node)) visit(node[key]);
    }

    visit(copy);
    return { value: blocked ? copy : value, blocked };
  }

  function stripResponseText(text, url) {
    const kind = kindFor(url);
    if (!kind || typeof text !== "string") return { text, blocked: false };
    if (!textLooksLikeAds(text) && !textHasStartHold(text)) return { text, blocked: false };
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

  function bodyText(body) {
    if (typeof body === "string") return body;
    try {
      if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
      if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
    } catch {
      return "";
    }
    return "";
  }

  function applyNoAdPlayback(body) {
    const text = bodyText(body);
    if (!text || !text.includes("contentPlaybackContext")) return { body, changed: false };
    let parsed;
    try {
      parsed = nativeJSONParse(text);
    } catch {
      return { body, changed: false };
    }
    const playback = parsed && parsed.playbackContext && parsed.playbackContext.contentPlaybackContext;
    if (!playback || typeof playback !== "object" || Array.isArray(playback)) return { body, changed: false };
    if (playback.isInlinePlaybackNoAd === true) return { body, changed: false };
    // Rebuild this object. A locker can freeze the property on YouTube's own
    // object so a direct assignment never reaches the request. A fresh parse
    // has no locker, and stringify writes the flag the server actually reads.
    const fresh = nativeJSONParse(text);
    fresh.playbackContext = nativeJSONParse(JSON.stringify(fresh.playbackContext));
    fresh.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd = true;
    try {
      return { body: JSON.stringify(fresh), changed: true };
    } catch {
      return { body, changed: false };
    }
  }

  // Object.assign builds the fetch init before fetch runs. YouTube locks
  // window.fetch in some sessions, so this is the path that still runs.
  function markPlaybackRequest(value) {
    if (!value || typeof value !== "object" || typeof value.body !== "string") return value;
    const marked = applyNoAdPlayback(value.body);
    if (marked.changed) value.body = marked.body;
    return value;
  }

  // YouTube's web player reads SABR (UMP) from googlevideo /videoplayback
  // and from /initplayback, which can carry the same policy before picture
  // bytes. Part type 35 is the next-request policy. Protobuf field 4 of that
  // part is backoffTimeMs: the player waits that long on a black spinner
  // before it asks for picture. 10000 is the common preroll-sized hold.
  // Part type 47 is the start-buffer policy. The part header is YouTube's
  // hpI integer, not a protobuf varint. A part type above 127 is not UMP.
  function isSabrPlayback(url) {
    const text = String(url || "");
    if (!text.includes("videoplayback") && !text.includes("initplayback")) return false;
    let parsed;
    try {
      parsed = new URL(text, "https://www.youtube.com");
    } catch {
      return false;
    }
    const host = parsed.hostname;
    return host === "googlevideo.com" || host.endsWith(".googlevideo.com");
  }


  // ---- googlevideo fallback ----
  // A media URL looks like rr2---sn-h9jk2mn5.googlevideo.com/videoplayback?...&mn=sn-h9jk2mn5,sn-n5pqrstu&fvip=2
  // "mn" lists the edge servers YouTube itself falls back across. redirector.googlevideo.com
  // takes the same path and query and redirects to a server that is up.
  const GV_HOST = /^rr?(\d+)---(sn-[a-z0-9-]+)\.googlevideo\.com$/i;
  const badGvHosts = new Map(); // failed host -> replacement host
  const BAD_HOST_TTL_MS = 10 * 60 * 1000;

  function isRetryableStatus(status) {
    return status === 403 || status === 404 || status === 410 || status === 429 || (status >= 500 && status <= 599);
  }

  function googlevideoFallbacks(url) {
    let parsed;
    try {
      parsed = new URL(String(url || ""));
    } catch {
      return [];
    }
    if (!isSabrPlayback(parsed.href)) return [];
    const out = [];
    const seen = new Set([parsed.hostname.toLowerCase()]);
    const match = parsed.hostname.match(GV_HOST);
    const fvip = parsed.searchParams.get("fvip");
    const rr = (fvip && /^\d+$/.test(fvip)) ? fvip : (match ? match[1] : "");
    const servers = String(parsed.searchParams.get("mn") || "").split(",").map((x) => x.trim()).filter((x) => /^sn-[a-z0-9-]+$/i.test(x));
    const push = (host, count) => {
      const key = host.toLowerCase();
      if (seen.has(key)) return;
      const bad = badGvHosts.get(key);
      if (bad && Date.now() - bad.at <= BAD_HOST_TTL_MS) return;
      seen.add(key);
      const next = new URL(parsed.href);
      next.hostname = host;
      next.searchParams.set("fallback_count", String(count));
      out.push(next.href);
    };
    let count = Number(parsed.searchParams.get("fallback_count") || 0) || 0;
    // 1. The other edge servers YouTube lists in mn (only real "sn-" ids).
    if (rr) for (const server of servers) push("rr" + rr + "---" + server + ".googlevideo.com", ++count);
    if (match) {
      const curRr = match[1];
      const sn = match[2];
      // 2. Same server under its other DNS names: a DNS failure on
      //    rr5---sn-x is often just that one name (r5---sn-x, or the fvip rr).
      push("r" + curRr + "---" + sn + ".googlevideo.com", ++count);
      if (fvip && /^\d+$/.test(fvip) && fvip !== curRr) push("rr" + fvip + "---" + sn + ".googlevideo.com", ++count);
      push("rr" + curRr + "---" + sn + ".googlevideo.com", ++count);
    }
    // 3. Last: the redirector (it often answers 403 for flagged IPs).
    if (parsed.hostname.toLowerCase() !== "redirector.googlevideo.com") push("redirector.googlevideo.com", ++count);
    return out.slice(0, 5);
  }

  function rememberBadHost(failedUrl, workingUrl) {
    try {
      const from = new URL(failedUrl).hostname.toLowerCase();
      const to = workingUrl ? new URL(workingUrl).hostname.toLowerCase() : "";
      if (!from || from === to) return;
      const back = to ? badGvHosts.get(to) : null;
      badGvHosts.set(from, { to: back && back.to === from ? "" : to, at: Date.now() });
    } catch {
      // Ignore a URL that does not parse.
    }
  }

  // Requests to a host that already failed go straight to its working replacement.
  function mapBadHost(url) {
    let parsed;
    try {
      parsed = new URL(String(url || ""));
    } catch {
      return url;
    }
    if (!isSabrPlayback(parsed.href)) return url;
    let hops = 0;
    let changed = false;
    while (hops < 4) {
      const entry = badGvHosts.get(parsed.hostname.toLowerCase());
      if (!entry || !entry.to || Date.now() - entry.at > BAD_HOST_TTL_MS) break;
      parsed.hostname = entry.to;
      changed = true;
      hops++;
    }
    return changed ? parsed.href : url;
  }

  // Decoy stream urls: when YouTube suspects ad stripping it can hand out
  // videoplayback urls whose signed "expire" (unix seconds) is long past
  // (seen: 2017) on hosts that do not exist. Real urls expire hours in the
  // future. Such a url can never play, so failover is pointless: reload.
  const DECOY_EXPIRE_SLACK_S = 24 * 60 * 60;
  const DECOY_FUTURE_MAX_S = 7 * 24 * 60 * 60;
  function isDecoyStreamUrl(url, nowMs) {
    let parsed;
    try {
      parsed = new URL(String(url || ""));
    } catch {
      return false;
    }
    if (!isSabrPlayback(parsed.href) || parsed.pathname !== "/videoplayback") return false;
    const raw = parsed.searchParams.get("expire");
    if (!raw || !/^\d{9,11}$/.test(raw)) return false;
    const now = (nowMs == null ? Date.now() : nowMs) / 1000;
    // Seen: 2017 (past) and 2273 (future). Real urls expire ~6h out.
    return Number(raw) < now - DECOY_EXPIRE_SLACK_S || Number(raw) > now + DECOY_FUTURE_MAX_S;
  }

  // Scans a player response (text) for decoy media urls before any media
  // request is made: streamingData formats/adaptiveFormats url or
  // signatureCipher, and serverAbrStreamingUrl. Returns
  // { expire, videoId } or null. Only the first few urls are checked.
  const MEDIA_EXPIRE = /videoplayback(?:\?|%3F)[^"\s]*?expire(?:=|%3D)(\d{9,11})/g;
  function findDecoyInPlayerText(text, nowMs) {
    const source = typeof text === "string" ? text : "";
    if (!source.includes("videoplayback") || !source.includes("expire")) return null;
    const now = (nowMs == null ? Date.now() : nowMs) / 1000;
    MEDIA_EXPIRE.lastIndex = 0;
    let match;
    let checked = 0;
    let decoy = null;
    while ((match = MEDIA_EXPIRE.exec(source)) && checked < 8) {
      checked++;
      const expire = Number(match[1]);
      if (expire >= now - DECOY_EXPIRE_SLACK_S && expire <= now + DECOY_FUTURE_MAX_S) return null; // a real url: not a decoy response
      decoy = decoy || String(expire);
    }
    if (!decoy) return null;
    const id = /"videoId"\s*:\s*"([\w-]{11})"/.exec(source);
    return { expire: decoy, videoId: id ? id[1] : "" };
  }

  function errorKind(error) {
    const text = String((error && (error.message || error.name)) || error || "");
    if (/name_not_resolved|dns/i.test(text)) return "dns";
    return "network";
  }

  // Tries the URL, then up to 3 fallbacks, within budgetMs. A failed response is
  // never read or cloned, so a dead host costs one round trip, not a wait.
  // doFetch(url, attemptIndex) must return a Promise<Response>.
  async function fetchWithFallback(url, doFetch, options) {
    const opts = options || {};
    const budgetMs = opts.budgetMs == null ? 4500 : opts.budgetMs;
    const now = opts.now || (() => Date.now());
    const started = now();
    const first = mapBadHost(url);
    let candidates = [first].concat(googlevideoFallbacks(first));
    // The first host already failed DNS/connect this session: try the others first.
    try {
      const dead = badGvHosts.get(new URL(first).hostname.toLowerCase());
      if (dead && !dead.to && Date.now() - dead.at <= BAD_HOST_TTL_MS && candidates.length > 1) {
        candidates = candidates.slice(1).concat([first]);
      }
    } catch {
      // keep order
    }
    const failures = [];
    let lastResponse = null;
    let lastError = null;
    for (let i = 0; i < candidates.length; i++) {
      if (i > 0 && now() - started > budgetMs) break;
      const candidate = candidates[i];
      try {
        const response = await doFetch(candidate, i);
        if (response && response.status === 403 && !(opts.failoverOn403 == null ? STEALTH.failoverOn403 : opts.failoverOn403)) {
          for (const failure of failures) {
            if (failure.reason === "dns" || failure.reason === "network") rememberBadHost(failure.url, "");
          }
          failures.push({ url: candidate, reason: "http 403" });
          return { response, url: candidate, failures, exhausted: false, flagged: true, ms: now() - started };
        }
        if (response && isRetryableStatus(response.status)) {
          failures.push({ url: candidate, reason: "http " + response.status });
          lastResponse = response;
          continue;
        }
        for (const failure of failures) rememberBadHost(failure.url, candidate);
        return { response, url: candidate, failures, exhausted: false, ms: now() - started };
      } catch (error) {
        if (error && error.name === "AbortError") throw error;
        failures.push({ url: candidate, reason: errorKind(error) });
        lastError = error;
      }
    }
    // No working host found: hosts that did not resolve / connect are skipped
    // next time (no replacement mapping); HTTP failures are left alone, the
    // reload brings new urls.
    for (const failure of failures) {
      if (failure.reason === "dns" || failure.reason === "network") rememberBadHost(failure.url, "");
    }
    if (lastResponse) return { response: lastResponse, url: candidates[candidates.length - 1], failures, exhausted: true, ms: now() - started };
    const error = lastError || new TypeError("Failed to fetch");
    error.ytFailures = failures;
    error.ytExhausted = true;
    throw error;
  }

  function concatBytes(parts) {
    let length = 0;
    for (let i = 0; i < parts.length; i++) length += parts[i].length;
    const out = new Uint8Array(length);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  function readHpI(bytes, offset) {
    if (offset >= bytes.length) return null;
    const first = bytes[offset];
    const width = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5;
    if (offset + width > bytes.length) return null;
    if (width === 1) return { value: first, next: offset + 1 };
    if (width === 2) return { value: (first & 63) + 64 * bytes[offset + 1], next: offset + 2 };
    if (width === 3) {
      return {
        value: (first & 31) + 32 * (bytes[offset + 1] + 256 * bytes[offset + 2]),
        next: offset + 3,
      };
    }
    if (width === 4) {
      return {
        value: (first & 15) + 16 * (bytes[offset + 1] + 256 * (bytes[offset + 2] + 256 * bytes[offset + 3])),
        next: offset + 4,
      };
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4);
    return { value: view.getUint32(0, true), next: offset + 5 };
  }

  function readProtoVarint(bytes, offset, end) {
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

  function readUmpHeader(bytes) {
    const type = readHpI(bytes, 0);
    if (!type) return bytes.length >= 10 ? { invalid: true } : { need: true };
    const size = readHpI(bytes, type.next);
    if (!size) return bytes.length >= type.next + 5 ? { invalid: true } : { need: true };
    if (type.value < 1 || type.value > 127 || size.value > 16000000) return { invalid: true };
    return { type: type.value, size: size.value, headerLen: size.next };
  }

  // NextRequestPolicy varints, from the SABR proto:
  //   1 targetAudioReadaheadMs stays (audio target, not the black-screen wait)
  //   2 targetVideoReadaheadMs is zeroed
  //   3 maxTimeSinceLastRequestMs stays (request keepalive)
  //   4 backoffTimeMs is zeroed
  //   5 minAudioReadaheadMs is zeroed
  //   6 minVideoReadaheadMs is zeroed (picture stays black until this much
  //     video is buffered; 10000 is the common preroll-sized hold)
  // The playback cookie and video id are length-delimited and stay. The
  // player reads the first backoff and stops, so a later unknown field must
  // not put that wait back. A walk that stops early still keeps the zeros.
  function zeroBackoffFields(bytes, start, end) {
    let index = start;
    while (index < end) {
      const key = readProtoVarint(bytes, index, end);
      if (!key || key.value < 8) return;
      const field = key.value >>> 3;
      const wire = key.value & 7;
      if (wire === 0) {
        const val = readProtoVarint(bytes, key.next, end);
        if (!val) return;
        if (field === 2 || field === 4 || field === 5 || field === 6) zeroVarint(bytes, key.next, val.next);
        index = val.next;
      } else if (wire === 2) {
        const len = readProtoVarint(bytes, key.next, end);
        if (!len || len.next + len.value > end) return;
        index = len.next + len.value;
      } else if (wire === 5) {
        if (key.next + 4 > end) return;
        index = key.next + 4;
      } else if (wire === 1) {
        if (key.next + 8 > end) return;
        index = key.next + 8;
      } else {
        return;
      }
    }
  }

  // Part 47 is the playback-start policy. Nested field 2 is minReadaheadMs.
  // A large value holds the first picture until that much media is buffered,
  // which is the black "loading" screen after backoffTimeMs is already 0.
  function zeroReadaheadMs(bytes, start, end) {
    let index = start;
    while (index < end) {
      const key = readProtoVarint(bytes, index, end);
      if (!key || key.value < 8) return;
      const field = key.value >>> 3;
      const wire = key.value & 7;
      if (wire === 0) {
        const val = readProtoVarint(bytes, key.next, end);
        if (!val) return;
        if (field === 2) zeroVarint(bytes, key.next, val.next);
        index = val.next;
      } else if (wire === 2) {
        const len = readProtoVarint(bytes, key.next, end);
        if (!len || len.next + len.value > end) return;
        index = len.next + len.value;
      } else if (wire === 5) {
        if (key.next + 4 > end) return;
        index = key.next + 4;
      } else if (wire === 1) {
        if (key.next + 8 > end) return;
        index = key.next + 8;
      } else {
        return;
      }
    }
  }

  function zeroStartReadahead(bytes, start, end) {
    let index = start;
    while (index < end) {
      const key = readProtoVarint(bytes, index, end);
      if (!key || key.value < 8) return;
      const field = key.value >>> 3;
      const wire = key.value & 7;
      if (wire === 0) {
        const val = readProtoVarint(bytes, key.next, end);
        if (!val) return;
        index = val.next;
      } else if (wire === 2) {
        const len = readProtoVarint(bytes, key.next, end);
        if (!len || len.next + len.value > end) return;
        if (field === 1 || field === 2) zeroReadaheadMs(bytes, len.next, len.next + len.value);
        index = len.next + len.value;
      } else if (wire === 5) {
        if (key.next + 4 > end) return;
        index = key.next + 4;
      } else if (wire === 1) {
        if (key.next + 8 > end) return;
        index = key.next + 8;
      } else {
        return;
      }
    }
  }

  function zeroVarint(bytes, start, end) {
    const width = end - start;
    if (width <= 0) return;
    if (width === 1) {
      bytes[start] = 0;
      return;
    }
    for (let index = start; index < end - 1; index++) bytes[index] = 128;
    bytes[end - 1] = 0;
  }

  function createUmpBackoffParser() {
    let pending = new Uint8Array(0);
    let skip = 0;
    let passthrough = false;

    function push(chunk) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk || 0);
      if (passthrough) return bytes;
      pending = pending.length ? concatBytes([pending, bytes]) : bytes;
      const ready = [];
      while (true) {
        if (skip > 0) {
          if (!pending.length) break;
          const take = Math.min(skip, pending.length);
          ready.push(pending.subarray(0, take));
          pending = pending.subarray(take);
          skip -= take;
          continue;
        }
        const header = readUmpHeader(pending);
        if (header.need) break;
        if (header.invalid) {
          passthrough = true;
          ready.push(pending);
          pending = new Uint8Array(0);
          break;
        }
        if ((header.type === 35 || header.type === 47) && header.size <= 65536) {
          const total = header.headerLen + header.size;
          if (pending.length < total) break;
          const part = pending.slice(0, total);
          if (header.type === 35) zeroBackoffFields(part, header.headerLen, total);
          else zeroStartReadahead(part, header.headerLen, total);
          ready.push(part);
          pending = pending.subarray(total);
          continue;
        }
        ready.push(pending.subarray(0, header.headerLen));
        pending = pending.subarray(header.headerLen);
        skip = header.size;
      }
      return ready.length ? concatBytes(ready) : new Uint8Array(0);
    }

    function finish() {
      if (!passthrough && skip === 0 && pending.length) {
        const header = readUmpHeader(pending);
        if (header && !header.need && !header.invalid && (header.type === 35 || header.type === 47)) {
          const copy = pending.slice();
          if (header.type === 35) zeroBackoffFields(copy, header.headerLen, copy.length);
          else zeroStartReadahead(copy, header.headerLen, copy.length);
          pending = copy;
        }
      }
      const tail = pending;
      pending = new Uint8Array(0);
      skip = 0;
      return tail;
    }

    return { push, finish };
  }

  function isInterruptionsToast(node) {
    if (!node || node.nodeType !== 1) return false;
    const text = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (!/Experiencing interruptions\?/i.test(text)) {
      const link = typeof node.querySelector === "function"
        ? node.querySelector('a[href*="3037019"], a[href*="ad_block"], a[href*="blocker"], a[href*="check_ad_blockers"]')
        : null;
      if (!link) return false;
    }
    if (typeof node.matches === "function") {
      if (node.matches("yt-notification-action-renderer, tp-yt-paper-toast")) return true;
    }
    return !!(node.closest && node.closest("yt-notification-action-renderer, tp-yt-paper-toast"));
  }

  function removeInterruptionsToast(root) {
    const scope = root || (typeof document !== "undefined" ? document : null);
    if (!scope || typeof scope.querySelectorAll !== "function") return;
    let candidates;
    try {
      candidates = scope.querySelectorAll(
        "yt-notification-action-renderer, tp-yt-paper-toast#toast, tp-yt-paper-toast.toast-button"
      );
    } catch {
      return;
    }
    for (const node of candidates) {
      if (!isInterruptionsToast(node)) continue;
      const outer = (node.closest && node.closest("yt-notification-action-renderer")) || node;
      // Keep the node. Removing it makes the popup open again on the next frame.
      outer.hidden = true;
      const style = outer.style;
      if (style && typeof style.setProperty === "function") {
        style.setProperty("display", "none", "important");
        style.setProperty("pointer-events", "none", "important");
      }
    }
  }

  // True only for the black start stall: metadata and a little media are in,
  // the picture has not moved, and the player is still spinning. A later
  // user pause is not this state.
  function shouldNudgeStart(state) {
    if (!state || state.used === true) return false;
    if (!(state.duration > 0) || state.readyState < 2 || state.paused !== true) return false;
    if (!(state.currentTime < 0.25)) return false;
    const classes = String(state.classes || "");
    if (classes.includes("ad-showing") || classes.includes("ad-interrupting")) return false;
    if (classes.includes("paused-mode") && state.currentTime > 0) return false;
    return state.spinner === true || classes.includes("unstarted-mode") || classes.includes("buffering-mode");
  }

  function patchUmpBackoff(bytes) {
    const parser = createUmpBackoffParser();
    const head = parser.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0));
    const tail = parser.finish();
    if (!tail.length) return head;
    if (!head.length) return tail;
    return concatBytes([head, tail]);
  }

  Object.defineProperty(target, "UBO_LAYER", { get: uboLayerPresent, enumerable: true, configurable: true });
  Object.assign(target, {
    STEALTH,
    DOM_AD_SELECTORS,
    HOME_FEED_AD_CSS,
    INTERRUPTIONS_TOAST_CSS,
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
    markPlaybackRequest,
    textHasStartHold,
    isSabrPlayback,
    createUmpBackoffParser,
    patchUmpBackoff,
    isRetryableStatus,
    googlevideoFallbacks,
    mapBadHost,
    rememberBadHost,
    fetchWithFallback,
    isDecoyStreamUrl,
    findDecoyInPlayerText,
    badGvHosts,
    isInterruptionsToast,
    removeInterruptionsToast,
    shouldNudgeStart,
  });
}

function startYoutubeAdblock() {
  // Non-enumerable symbol guard: no string-keyed global for the page to spot.
  const GUARD = Symbol.for("twitch-adblock.yt");
  if (globalThis[GUARD]) return;
  try { Object.defineProperty(globalThis, GUARD, { value: true, configurable: true }); } catch { return; }

  // Start switches. Defaults aim at a fast start; override for live A/B with
  // localStorage["twitch-adblock-yt-opts"] = '{"noAdFlag":true}' and reload.
  //  noAdFlag:    send isInlinePlaybackNoAd on player requests (uBO keeps this disabled).
  //  assignHook:  wrap the global Object.assign to mark player requests (costly, page-wide).
  //  stallReload: reload the video (at most twice) if a stripped start sits at 0:00 with no data.
  const OPTS = { noAdFlag: false, assignHook: false, stallReload: true, stallMs: 2000, stallQuietMs: 1500, stallPollMs: 250, stallFailoverGraceMs: 1000, stallGiveUpMs: 30000, stallSecondGapMs: 5000, stallUboMs: 10000, umpBackoff: false, diag: true, decoyReloadMs: 150, decoyGapMs: 1500 };
  try {
    const saved = JSON.parse(localStorage.getItem("twitch-adblock-yt-opts") || "{}");
    for (const key of Object.keys(OPTS)) if (typeof saved[key] === typeof OPTS[key]) OPTS[key] = saved[key];
  } catch {
    // Defaults stay.
  }


  function logFailOpen(error) {
    console.log("twitch-adblock youtube failed open", error);
  }

  // Timing breadcrumbs relative to the last navigation, for start-delay logs.
  function diag(msg) {
    if (!OPTS.diag) return;
    try {
      console.log("twitch-adblock: [+" + (Date.now() - navAt) + "ms] " + msg);
    } catch {
      // Logging is optional.
    }
  }

  const api = {};
  installYoutubeAdblock(api);
  // SABR backoff zeroing stays off: on the owner's PC (2026-10-16, 5e24b4f) it made
  // the player busy-poll videoplayback and starts got slower (5-9s). The wait
  // is server-side; see the get_watch adPlacements rule in the uBO layer.
  // Opt in with {"umpBackoff":true}.
  api.STEALTH.patchUmpBackoff = OPTS.umpBackoff;
  const nativeFetch = window.fetch.bind(window);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const nativeParse = JSON.parse;
  // Stealth: every hook is a Proxy over the native function (name, length,
  // prototype pass through) and Function.prototype.toString answers with the
  // native source, the same shape uBO's proxyApplyFn uses. XHR state lives in
  // a WeakMap so no instance grows own properties.
  const cloaked = new WeakMap();
  const baseToString = Function.prototype.toString;
  const toStringProxy = new Proxy(baseToString, {
    apply(target, self, args) {
      return Reflect.apply(target, cloaked.has(self) ? cloaked.get(self) : self, args);
    },
  });
  cloaked.set(toStringProxy, baseToString);
  try { Function.prototype.toString = toStringProxy; } catch {}
  function cloak(fn, impl) {
    const proxy = new Proxy(fn, {
      apply(target, self, args) {
        return impl.apply(self, args);
      },
    });
    cloaked.set(proxy, fn);
    return proxy;
  }
  const xhrState = new WeakMap();
  function X(xhr) {
    let st = xhrState.get(xhr);
    if (!st) xhrState.set(xhr, st = {});
    return st;
  }
  const nativeAssign = Object.assign;
  if (OPTS.assignHook) try {
    Object.assign = function (target) {
      const result = nativeAssign.apply(Object, arguments);
      try {
        api.markPlaybackRequest(result);
      } catch (error) {
        logFailOpen(error);
      }
      return result;
    };
  } catch (error) {
    logFailOpen(error);
  }
  let hideTimer = 0;
  let noticeGeneration = 0;
  // One announcement per video. Later player/DOM strips must not restart the hide.
  let noticeLatched = false;
  let startNudged = false;
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
    if (blocking && !strippedThisVideo) {
      strippedThisVideo = true;
      // With the uBO layer, our strips are watch/browse renderer drops only:
      // they say nothing about the start, so they no longer arm the watchdog.
      if (!api.UBO_LAYER) armStall(undefined, "ads stripped");
    }
    if (blocking && noticeLatched) return;
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
    // Latch before returning so a mutation caused by this insert cannot extend the timer.
    noticeLatched = true;
    if (hideTimer) return;
    hideTimer = setTimeout(() => {
      hideTimer = 0;
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

  function nudgeStart() {
    if (!onWatchSurface()) return;
    let video;
    let player;
    try {
      player = playerRoot();
      video = player && typeof player.querySelector === "function" ? player.querySelector("video") : null;
    } catch {
      return;
    }
    if (!video) return;
    const classes = player && player.className ? String(player.className) : "";
    let spinner = false;
    try {
      spinner = !!(player.querySelector(".ytp-spinner, .ytp-spinner-container"));
    } catch {
      spinner = false;
    }
    if (!api.shouldNudgeStart({
      used: startNudged,
      duration: video.duration,
      readyState: video.readyState,
      paused: video.paused,
      currentTime: video.currentTime,
      classes,
      spinner,
    })) return;
    startNudged = true;
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === "function") pending.catch(function () {});
    } catch (error) {
      logFailOpen(error);
    }
    try {
      if (typeof player.playVideo === "function") player.playVideo();
    } catch (error) {
      logFailOpen(error);
    }
  }

  let stalledReloaded = 0;
  let stallTimer = 0;
  let navAt = Date.now();
  let startLogged = false;
  let strippedThisVideo = false;

  // Only after this script stripped ads (or media servers failed) for this
  // video: a start that sits at 0:00 with no progress gets a loadVideoById
  // (uBO-style reload of the same video), at most twice. It does not seek,
  // pause, or touch an ad. The check polls every stallPollMs and fires only
  // when at least stallMs passed since arming AND currentTime, buffered end
  // and readyState have not moved for stallQuietMs, so a slow-but-loading
  // start is never reloaded.
  let stallArmedAt = 0;
  let stallLastSig = "";
  let stallLastProgressAt = 0;
  let lastFailoverAt = 0;
  let mediaExhaustedNow = false;
  let lastReloadAt = 0;
  let lastMediaEventAt = 0;
  // Set once any watch video reports playback; survives same-video
  // yt-navigate events so a started video is never reloaded.
  let startedVideoId = "";
  const playbackSeen = { any: false };

  function currentVideoId(player) {
    try {
      return (player && typeof player.getVideoData === "function" && (player.getVideoData() || {}).video_id) || "";
    } catch {
      return "";
    }
  }

  // Signs the player is (or was) actually moving, from the player API too,
  // not only from the first <video> element found.
  function playerMoving(player, video) {
    if (video && (video.currentTime > 0.1 || video.readyState >= 2)) return true;
    try {
      if (typeof player.getCurrentTime === "function" && player.getCurrentTime() > 0.1) return true;
      if (typeof player.getPlayerState === "function" && player.getPlayerState() === 1) return true;
    } catch {
      // optional
    }
    return false;
  }

  function stallSignature(video) {
    let end = 0;
    try {
      const b = video.buffered;
      if (b && b.length) end = b.end(b.length - 1);
    } catch {
      end = 0;
    }
    return (Math.round((video.currentTime || 0) * 10)) + "|" + Math.round(end * 10) + "|" + (video.readyState || 0);
  }

  function stopStall() {
    clearTimeout(stallTimer);
    stallTimer = 0;
    stallArmedAt = 0;
  }

  function checkStall() {
    stallTimer = 0;
    if (!OPTS.stallReload || stalledReloaded >= 2 || startLogged || playbackSeen.any || (!strippedThisVideo && !mediaFailed && !uboLayerPresent()) || !onWatchSurface()) return stopStall();
    const now = Date.now();
    if (now - navAt > OPTS.stallGiveUpMs) return stopStall();
    const again = () => { stallTimer = setTimeout(checkStall, OPTS.stallPollMs); };
    let player;
    let video;
    try {
      player = playerRoot();
      video = player && player.querySelector ? player.querySelector("video") : null;
    } catch {
      return again();
    }
    if (!player || !video) return again();
    if (startedVideoId && currentVideoId(player) === startedVideoId) return stopStall();
    // Healthy or already moving: stop watching this video.
    if (playerMoving(player, video)) return stopStall();
    const sig = stallSignature(video);
    if (sig !== stallLastSig || lastMediaEventAt > stallLastProgressAt) {
      stallLastSig = sig;
      stallLastProgressAt = Math.max(now, lastMediaEventAt);
    }
    const classes = String(player.className || "");
    // Conditions that pause the clock instead of firing.
    let hold = classes.includes("ad-showing") || classes.includes("ad-interrupting") || document.hidden === true;
    if (!hold && classes.includes("paused-mode") && !classes.includes("buffering-mode") && !classes.includes("unstarted-mode")) {
      try {
        if (typeof player.getPlayerState === "function" && player.getPlayerState() === 2) hold = true;
      } catch {
        // State is optional.
      }
    }
    // A host fallback is still being tried: let it finish unless all hosts failed.
    if (!hold && !mediaExhaustedNow && now - lastFailoverAt < OPTS.stallFailoverGraceMs) hold = true;
    if (hold) {
      stallLastProgressAt = now;
      return again();
    }
    // uBO layer and no media failure seen: the player may be legitimately
    // retrying internally (SABR); give it OPTS.stallUboMs before we reload.
    // uBO layer: floor for every reason, decoys included.
    if (api.UBO_LAYER && now - navAt < OPTS.stallUboMs) return again();
    // uBO: once a reload got a fresh /player answer, never reload again.
    if (api.UBO_LAYER && stalledReloaded >= 1 && lastPlayerAt > lastReloadAt) {
      diag("no 2nd reload: /player answered " + (lastPlayerAt - lastReloadAt) + "ms after reload 1");
      return stopStall();
    }
    // A /player answer is progress: the reloaded start is loading.
    if (lastPlayerAt > stallLastProgressAt) stallLastProgressAt = lastPlayerAt;
    if (now - navAt < OPTS.stallMs || now - stallArmedAt < OPTS.stallMs || now - stallLastProgressAt < OPTS.stallQuietMs) return again();
    if (lastReloadAt && now - lastReloadAt < OPTS.stallSecondGapMs) return again();
    if (typeof player.loadVideoById !== "function" || typeof player.getVideoData !== "function") return stopStall();
    let id = "";
    try {
      id = (player.getVideoData() || {}).video_id || "";
    } catch {
      id = "";
    }
    if (!id) return again();
    diag("reload reason: no progress " + (now - stallLastProgressAt) + "ms, armed " + (now - stallArmedAt) + "ms ago, decoyThisNav=" + decoyThisNav + ", mediaFailed=" + mediaFailed + ", uBO=" + api.UBO_LAYER + ", reloads=" + stalledReloaded);
    reloadVideo(player, id, now, "start stalled at 0:00" + (mediaFailed ? " after media server failures" : ""));
  }

  function reloadVideo(player, id, now, why) {
    stalledReloaded += 1;
    lastReloadAt = now;
    console.log("twitch-adblock: [+" + (now - navAt) + "ms] YouTube " + why + ", reloading the video (" + stalledReloaded + "/2)");
    mediaFailed = false;
    mediaExhaustedNow = false;
    try {
      player.loadVideoById(id, 0);
    } catch (error) {
      logFailOpen(error);
    }
    // Watch the reloaded start too, giving it a little longer.
    if (stalledReloaded < 2) armStall(OPTS.stallSecondGapMs, "after reload");
    else stopStall();
  }

  function armStall(minMs, why) {
    if (!OPTS.stallReload || stalledReloaded >= 2 || startLogged || playbackSeen.any) return;
    diag("stall watchdog armed" + (why ? " (" + why + ")" : "") + (api.UBO_LAYER && !decoyThisNav ? ", uBO floor " + OPTS.stallUboMs + "ms" : ""));
    clearTimeout(stallTimer);
    const now = Date.now();
    // minMs shortens/lengthens the earliest fire time relative to stallMs.
    stallArmedAt = now - (OPTS.stallMs - (minMs == null ? OPTS.stallMs : minMs));
    stallLastSig = "";
    stallLastProgressAt = now;
    stallTimer = setTimeout(checkStall, OPTS.stallPollMs);
  }

  // Every fallback host failed: get a fresh player response soon instead of
  // waiting out the player's own long retry backoff.
  let mediaFailed = false;
  let lastExhaustedAt = 0;
  // Per-navigation evidence; reset on yt-navigate-start.
  let decoyThisNav = false;
  let lastPlayerAt = 0;
  function onMediaExhausted() {
    mediaFailed = true;
    mediaExhaustedNow = true;
    const now = Date.now();
    if (now - lastExhaustedAt < 3000) return;
    lastExhaustedAt = now;
    armStall(stalledReloaded ? OPTS.stallSecondGapMs : 500, "all media hosts failed");
  }

  // Decoy media url seen: reload right away (shared 2-reload cap with the
  // stall watchdog, one per 1.5s), instead of failover + stall timer.
  let decoyTimer = 0;
  // A player response arrived with only decoy media urls: reload before
  // the player even tries them.
  function inspectPlayerText(text) {
    try {
      if (typeof text !== "string" || text.length < 200 || !text.includes("streamingData")) return;
      const hit = api.findDecoyInPlayerText(text);
      if (hit) onDecoyUrl("", "player response has decoy stream urls (expire=" + hit.expire + ")", hit.videoId);
    } catch (error) {
      logFailOpen(error);
    }
  }

  function onDecoyUrl(url, why, wantId) {
    // uBO layer: its DNR rule already fails decoys and the player recovers on
    // its own (eb034fd log: a fast reload here cost ~10s). Only the 10s floor applies.
    if (api.UBO_LAYER) {
      diag("decoy seen, uBO present: not reloading" + (url ? " (expire=" + (/[?&]expire=(\d+)/.exec(url) || [])[1] + ")" : ""));
      return;
    }
    decoyThisNav = true;
    diag("decoy seen: " + (why || "decoy stream url") + (url ? " expire=" + (/[?&]expire=(\d+)/.exec(url) || [])[1] : ""));
    if (!OPTS.stallReload || decoyTimer || stalledReloaded >= 2 || startLogged || playbackSeen.any || !onWatchSurface()) return;
    if (lastReloadAt && Date.now() - lastReloadAt < OPTS.decoyGapMs) return;
    mediaFailed = true;
    let tries = 0;
    const fire = () => {
      decoyTimer = 0;
      try {
        if (stalledReloaded >= 2 || startLogged || playbackSeen.any || !onWatchSurface()) return;
        const player = playerRoot();
        const id = currentVideoId(player);
        // The response may land before the player switched to that video.
        if ((!player || !id || (wantId && id !== wantId)) && tries++ < 12) {
          decoyTimer = setTimeout(fire, OPTS.decoyReloadMs);
          return;
        }
        if (!player || typeof player.loadVideoById !== "function" || !id || (wantId && id !== wantId)) return armStall(500, "decoy, player not ready");
        clearTimeout(stallTimer);
        reloadVideo(player, id, Date.now(), why || ("got a decoy stream url (expire=" + new URL(url).searchParams.get("expire") + ")"));
      } catch (error) {
        logFailOpen(error);
      }
    };
    decoyTimer = setTimeout(fire, OPTS.decoyReloadMs);
  }

  const loggedHosts = new Set();
  function logFallback(result) {
    try {
      if (result.failures && result.failures.length) lastFailoverAt = Date.now();
      for (const failure of result.failures) {
        const host = new URL(failure.url).hostname;
        if (loggedHosts.has(host + failure.reason)) continue;
        loggedHosts.add(host + failure.reason);
        console.log("twitch-adblock: googlevideo " + host + " failed (" + failure.reason + ")");
      }
      if (!result.exhausted && result.failures.length) {
        console.log("twitch-adblock: media recovered on " + new URL(result.url).hostname + " in " + result.ms + "ms");
      }
    } catch {
      // Logging is optional.
    }
  }

  document.addEventListener("playing", (event) => {
    try {
      if (!event.target || event.target.tagName !== "VIDEO") return;
      playbackSeen.any = true;
      stopStall();
      if (!startedVideoId) startedVideoId = currentVideoId(playerRoot());
      if (startLogged) return;
      startLogged = true;
      const ms = Date.now() - navAt;
      console.log("twitch-adblock: YouTube playback started " + ms + "ms after navigation" + (strippedThisVideo ? " (ads stripped)" : ""));
    } catch {
      // Timing is optional.
    }
  }, true);

  // Progressive (itag=18) starts put the googlevideo url straight into
  // <video src>, which bypasses fetch/XHR. Check the element itself.
  for (const type of ["loadstart", "error"]) {
    document.addEventListener(type, (event) => {
      try {
        const el = event.target;
        if (!el || el.tagName !== "VIDEO") return;
        const src = String(el.currentSrc || el.src || "");
        if (!api.isSabrPlayback(src)) return; // blob: (MSE) and others: not ours
        if (api.isDecoyStreamUrl(src)) onDecoyUrl(src, "video element got a decoy stream url (expire=" + new URL(src).searchParams.get("expire") + ")");
        else if (type === "error") onDecoyUrl(src, "video element failed on its stream url");
      } catch {
        // optional
      }
    }, true);
  }

  // Any media activity counts as progress for the stall watchdog.
  for (const type of ["timeupdate", "progress", "loadeddata", "canplay", "waiting", "seeking"]) {
    document.addEventListener(type, (event) => {
      if (event.target && event.target.tagName === "VIDEO") lastMediaEventAt = Date.now();
    }, true);
  }

  function inspectPlayerValue(value) {
    try {
      if (!value || typeof value !== "object" || !value.streamingData) return;
      inspectPlayerText(JSON.stringify({ videoDetails: { videoId: (value.videoDetails || {}).videoId || "" }, streamingData: value.streamingData, pad: "x".repeat(200) }));
    } catch {
      // optional
    }
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
      if (kind === "player") inspectPlayerValue(current);
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
          if (kind === "player") inspectPlayerValue(value);
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
    if (path === "/" || path === "" || path.startsWith("/results")) return "browse";
    return "";
  }

  async function rewritePlayerBody(input, init) {
    if (!OPTS.noAdFlag) return { input, init };
    const stream = typeof ReadableStream !== "undefined" && init && init.body instanceof ReadableStream;
    if (init && init.body != null && !stream) {
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

  function wrapSabrBody(response) {
    if (!response || !response.body || typeof TransformStream !== "function") return response;
    const parser = api.createUmpBackoffParser();
    const stream = new TransformStream({
      transform(chunk, controller) {
        const out = parser.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
        if (out.length) controller.enqueue(out);
      },
      flush(controller) {
        const tail = parser.finish();
        if (tail.length) controller.enqueue(tail);
      },
    });
    return new Response(response.body.pipeThrough(stream), {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
  }

  window.fetch = cloak(window.fetch, function (input, init) {
    const url = requestUrl(input);
    const kind = api.kindFor(url);
    if (!kind) {
      if (!api.isSabrPlayback(url)) return nativeFetch(input, init);
      const isReq = typeof Request !== "undefined" && input instanceof Request;
      const streamBody = typeof ReadableStream !== "undefined" && init && init.body instanceof ReadableStream;
      // A streamed body cannot be sent twice: one try, still mapped off known-bad hosts.
      const base = isReq ? input.clone() : null;
      const doFetch = (target, attempt) => {
        if (attempt === 0 && target === url) return nativeFetch(input, init);
        if (isReq) return nativeFetch(new Request(target, base.clone()), init);
        if (streamBody && attempt > 0) return Promise.reject(new TypeError("stream body not replayable"));
        return nativeFetch(target, init);
      };
      if (api.isDecoyStreamUrl(url)) {
        onDecoyUrl(url);
        return nativeFetch(input, init).catch((error) => {
          diag("decoy fetch failed (" + String(error && error.message || error) + ")");
          throw error;
        });
      }
      return api.fetchWithFallback(url, doFetch).then((result) => {
        if (result.flagged) {
          onDecoyUrl(url, "got HTTP 403 on the stream url");
          return result.response;
        }
        logFallback(result);
        if (result.exhausted) onMediaExhausted();
        const response = result.response;
        if (!response || !response.ok || !api.STEALTH.patchUmpBackoff) return response;
        try {
          return wrapSabrBody(response);
        } catch (error) {
          logFailOpen(error);
          return response;
        }
      }, (error) => {
        if (error && error.ytFailures) {
          logFallback({ failures: error.ytFailures, exhausted: true });
          onMediaExhausted();
        }
        throw error;
      });
    }
    const replay = input instanceof Request ? input.clone() : input;
    if (kind === "player") diag("/player requested (fetch)");
    const prepare = kind === "player" ? rewritePlayerBody(input, init) : Promise.resolve({ input, init });
    return prepare.then((prepared) => nativeFetch(prepared.input, prepared.init).then((response) => {
      if (!api.shouldBufferYoutubei(response)) return response;
      return response.clone().text().then((text) => {
        if (kind === "player") {
          lastPlayerAt = Date.now();
          diag("/player response read (" + text.length + " chars)");
          inspectPlayerText(text);
        }
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
  });

  function stripXhrText(xhr, raw) {
    const st = X(xhr);
    if (xhr.readyState !== 4) return raw;
    if (st.cacheGen === st.gen) return st.cacheText;
    const url = st.url || "";
    if (api.kindFor(url) === "player") {
      lastPlayerAt = Date.now();
      inspectPlayerText(raw);
    }
    const stripped = api.stripResponseText(raw, url);
    st.cacheText = stripped.blocked ? stripped.text : raw;
    st.cacheGen = st.gen;
    if (stripped.blocked) notify(true);
    else if ((api.kindFor(url) === "player" || api.kindFor(url) === "reel") && !api.textLooksLikeAds(raw)) notify(false);
    return st.cacheText;
  }

  // Patched once on the prototype (descriptor shape unchanged, getters cloaked).
  function installXhrGetters() {
    const proto = XMLHttpRequest.prototype;
    const textDesc = Object.getOwnPropertyDescriptor(proto, "responseText");
    const responseDesc = Object.getOwnPropertyDescriptor(proto, "response");
    if (!textDesc || !responseDesc || typeof textDesc.get !== "function" || typeof responseDesc.get !== "function") return;
    const textGet = textDesc.get;
    const responseGet = responseDesc.get;
    Object.defineProperty(proto, "responseText", Object.assign({}, textDesc, {
      get: cloak(textGet, function () {
        const raw = textGet.call(this);
        const st = xhrState.get(this);
        if (!st || !st.strip) return raw;
        try { return stripXhrText(this, raw); } catch (error) { logFailOpen(error); return raw; }
      }),
    }));
    Object.defineProperty(proto, "response", Object.assign({}, responseDesc, {
      get: cloak(responseGet, function () {
        const raw = responseGet.call(this);
        const st = xhrState.get(this);
        if (!st || !st.strip || this.readyState !== 4) return raw;
        try {
          if (this.responseType === "" || this.responseType === "text") return typeof raw === "string" ? stripXhrText(this, raw) : raw;
          if (this.responseType !== "json" || !raw || typeof raw !== "object") return raw;
          const kind = api.kindFor(st.url || "");
          const stripped = api.stripValue(raw, kind);
          if (stripped.blocked && (kind !== "player" || api.rootHasPlayback(stripped.value))) {
            notify(true);
            return stripped.value;
          }
        } catch (error) {
          logFailOpen(error);
        }
        return raw;
      }),
    }));
  }
  installXhrGetters();

  function installSabrPatch(xhr) {
    if (!api.STEALTH.patchUmpBackoff) return;
    if (!X(xhr).sabr) {
      X(xhr).sabr = true;
      const responseDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
      if (responseDesc && typeof responseDesc.get === "function") {
        let assigned;
        let hasAssigned = false;
        Object.defineProperty(xhr, "response", {
          configurable: true,
          get() {
            if (hasAssigned) return assigned;
            const raw = responseDesc.get.call(xhr);
            if (xhr.responseType !== "arraybuffer" || !(raw instanceof ArrayBuffer) || !raw.byteLength) return raw;
            try {
              const patched = api.patchUmpBackoff(new Uint8Array(raw));
              return patched.byteOffset === 0 && patched.byteLength === patched.buffer.byteLength
                ? patched.buffer
                : patched.slice().buffer;
            } catch (error) {
              logFailOpen(error);
              return raw;
            }
          },
          set(value) {
            hasAssigned = true;
            assigned = value;
          },
        });
      }
    }
    const fetchFn = xhr.fetch;
    if (!X(xhr).sabrFetch && typeof fetchFn === "function" && fetchFn.length === 3) {
      X(xhr).sabrFetch = true;
      xhr.fetch = function (onChunk, onDone, body) {
        const parser = api.createUmpBackoffParser();
        return fetchFn.call(xhr, function (chunk) {
          let bytes = null;
          if (chunk instanceof Uint8Array) bytes = chunk;
          else if (chunk instanceof ArrayBuffer) bytes = new Uint8Array(chunk);
          else if (ArrayBuffer.isView(chunk)) bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          if (!bytes) {
            if (typeof onChunk === "function") onChunk(chunk);
            return;
          }
          const out = parser.push(bytes);
          if (out.length && typeof onChunk === "function") onChunk(out);
        }, function () {
          const tail = parser.finish();
          if (tail.length && typeof onChunk === "function") onChunk(tail);
          if (typeof onDone === "function") onDone();
        }, body);
      };
    }
  }

  // XHR cannot be retried in place, so a failed host is mapped to its first
  // fallback and the player's own retry goes there.
  function watchXhrFailure(xhr) {
    if (X(xhr).gvWatch) return;
    X(xhr).gvWatch = true;
    let aborted = false;
    xhr.addEventListener("abort", () => {
      aborted = true;
    });
    xhr.addEventListener("loadstart", () => {
      aborted = false;
    });
    xhr.addEventListener("loadend", () => {
      try {
        if (aborted) return;
        const status = xhr.status;
        if (status !== 0 && !api.isRetryableStatus(status)) return;
        const url = X(xhr).url || "";
        if (api.isDecoyStreamUrl(url)) return onDecoyUrl(url);
        if (status === 403 && !api.STEALTH.failoverOn403) return onDecoyUrl(url, "got HTTP 403 on the stream url");
        const next = api.googlevideoFallbacks(url)[0];
        api.rememberBadHost(url, next || "");
        logFallback({ failures: [{ url, reason: status ? "http " + status : "network" }], exhausted: !next });
        if (next) console.log("twitch-adblock: next media requests use " + new URL(next).hostname);
        else onMediaExhausted();
      } catch {
        // Never break the player's own error handling.
      }
    });
  }

  XMLHttpRequest.prototype.open = cloak(nativeOpen, function (method, url) {
    X(this).url = String(url || "");
    X(this).gen = (X(this).gen || 0) + 1;
    if (api.kindFor(X(this).url) === "player") diag("/player requested (xhr)");
    X(this).strip = !!api.kindFor(X(this).url);
    if (api.isSabrPlayback(X(this).url)) {
      if (api.isDecoyStreamUrl(X(this).url)) onDecoyUrl(X(this).url);
      const mapped = api.mapBadHost(X(this).url);
      if (mapped !== X(this).url) {
        const args = Array.prototype.slice.call(arguments);
        args[1] = mapped;
        X(this).url = mapped;
        installSabrPatch(this);
        watchXhrFailure(this);
        return nativeOpen.apply(this, args);
      }
      installSabrPatch(this);
      watchXhrFailure(this);
    }
    return nativeOpen.apply(this, arguments);
  });

  XMLHttpRequest.prototype.send = cloak(nativeSend, function (body) {
    if (OPTS.noAdFlag && api.kindFor(X(this).url || "") === "player" && body != null) {
      try {
        const marked = api.applyNoAdPlayback(body);
        if (marked.changed) body = marked.body;
      } catch (error) {
        logFailOpen(error);
      }
    }
    if (api.isSabrPlayback(X(this).url || "")) installSabrPatch(this);
    return nativeSend.call(this, body);
  });

  JSON.parse = cloak(nativeParse, function (text, reviver) {
    const value = nativeParse.call(this, text, reviver);
    if (typeof text === "string" && text.length > 2000 && text.includes("serverAbrStreamingUrl")) inspectPlayerText(text);
    if (typeof text !== "string" || (!api.textLooksLikeAds(text) && !api.textHasStartHold(text))) return value;
    const path = location.pathname || "";
    const kind = path.startsWith("/shorts")
      ? "reel"
      : (path === "/watch" ? "watch" : ((path === "/" || path === "" || path.startsWith("/results")) ? "browse" : "player"));
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
  });

  // uBO's set-constant owns ytInitialPlayerResponse when its layer is present.
  if (!api.UBO_LAYER) hookInitial("ytInitialPlayerResponse", "player");
  // With uBO, nothing in ytInitialData is ours to strip: no window accessor.
  if (!api.UBO_LAYER) hookInitial("ytInitialData", initialDataKind());

  let homeCssEl = null;
  function injectHomeFeedCss() {
    try {
      if (typeof document === "undefined" || !document.createElement) return;
      if (homeCssEl && homeCssEl.isConnected) return;
      const style = document.createElement("style");
      homeCssEl = style;
      style.textContent = api.HOME_FEED_AD_CSS + "{display:none!important;}"
        + api.INTERRUPTIONS_TOAST_CSS + "{display:none!important;pointer-events:none!important;}";
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
        api.removeInterruptionsToast();
        nudgeStart();
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    removeDomAds();
    api.removeInterruptionsToast();
  }

  injectHomeFeedCss();
  document.addEventListener("yt-navigate-start", () => {
    noticeLatched = false;
    startNudged = false;
    stalledReloaded = 0;
    clearTimeout(decoyTimer);
    decoyTimer = 0;
    mediaFailed = false;
    decoyThisNav = false;
    lastPlayerAt = 0;
    lastExhaustedAt = 0;
    stalledReloaded = 0;
    strippedThisVideo = false;
    startLogged = false;
    playbackSeen.any = false;
    lastReloadAt = 0;
    lastMediaEventAt = 0;
    navAt = Date.now();
    mediaExhaustedNow = false;
    lastFailoverAt = 0;
    stopStall();
    notify(false);
  }, true);
  document.addEventListener("yt-navigate-finish", () => {
    diag("navigation finished");
    // uBO layer: nothing of ours arms the watchdog on a clean start, so arm it
    // here; checkStall still waits OPTS.stallUboMs unless media failed.
    if (api.UBO_LAYER && onWatchSurface()) armStall(undefined, "watch navigation");
    injectHomeFeedCss();
    removeDomAds();
    api.removeInterruptionsToast();
    setTimeout(nudgeStart, 1000);
    setTimeout(nudgeStart, 3000);
  }, true);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchDom, { once: true });
  } else {
    watchDom();
  }

  console.log("twitch-adblock: watching YouTube");
}

if (typeof document !== "undefined" && typeof window !== "undefined") startYoutubeAdblock();
