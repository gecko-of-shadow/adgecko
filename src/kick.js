// Runs on Kick at document_start. In-player ads are skipped only when the
// IVS player can jump back to the stream. If a skip would rewind a long way,
// or the player cannot take it, the ad plays. The live video is never hidden,
// muted, or sped up. A separate post-roll cover can be paused.
// Wrapped in one function so the page sees no globals from this file (L-18).
(() => {
function installKickAdblock(target) {
  // Neutral ids, no marker properties on page objects (wrapped objects are
  // remembered in a WeakSet), and no page-console output unless DEBUG.
  const DEBUG = false;
  // The chrome-hiding style element is kept by reference (no id for the page
  // to look up).
  let chromeCssEl = null;
  const wrapped = new WeakSet();
  const debugLog = (...args) => {
    if (DEBUG) console.log(...args);
  };
  const AD_BREAK_STARTED = "PlayerAdBreakStarted";
  const AD_BREAK_ENDED = "PlayerAdBreakEnded";
  const TIME_UPDATE = "PlayerTimeUpdate";
  const SKIP_LIMIT = 2;
  const SKIP_WINDOW_MS = 60000;
  const HOLD_MS = 8000;
  const AD_CHROME_SELECTORS = [
    '[data-testid="ad-click-overlay"]',
    '[data-testid="ad-learn-more"]',
    '[data-testid="ad-learn-more-mobile"]',
    '[data-testid="ad-fullscreen"]',
    '[data-testid="ad-skip-countdown"]',
    '[aria-label="Ad progress"]',
    '[aria-label="Visit advertiser"]',
    '[data-testid="ima-ad-controls"]',
  ];
  const BANNER_SELECTORS = [
    "#consolidated_header",
    "#native_feed_ad",
    'iframe[id^="google_ads_iframe"]',
  ];
  // Security review L-14 (second half): the post-roll cover (a DIV with a
  // direct <video-player> child and IMA ad controls) is hidden by
  // settleCovers() only, never by the stylesheet: a CSS rule cannot see
  // srcObject or a video's duration, so it could hide a cover that holds the
  // live player. Elements that mark a cover (or hold one) for coverMutation:
  // ("video": a player may mount its <video> inside a wrapper element.)
  const COVER_NODES = '[data-testid="ima-ad-controls"], iframe[id^="google_ads_iframe"], video-player, video';

  function onKickHost(host) {
    const value = String(host || "").toLowerCase();
    return value === "kick.com" || value.endsWith(".kick.com");
  }

  function isIvsWorkerUrl(url) {
    return String(url || "").includes("amazon-ivs-wasmworker");
  }

  function emptyState() {
    return { attempts: [], position: null, playerId: null, holdUntil: 0, holdAction: "" };
  }

  function copyState(state) {
    const source = state || emptyState();
    return {
      attempts: Array.isArray(source.attempts) ? source.attempts.slice() : [],
      position: source.position,
      playerId: source.playerId,
      holdUntil: source.holdUntil || 0,
      holdAction: source.holdAction || "",
    };
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function readSkipTarget(detail) {
    if (!detail || typeof detail !== "object") return null;
    const adObject = detail.adObject;
    const metadata = detail.metadata;
    const candidates = [
      adObject && adObject.targetPlayheadForAdSkip,
      metadata && metadata.targetPlayheadForAdSkip,
      detail.targetPlayheadForAdSkip,
    ];
    for (const candidate of candidates) {
      const number = finiteNumber(candidate);
      if (number != null && number >= 0) return number;
    }
    return null;
  }

  // A short step backward is how a skip leaves an ad. A jump back to the
  // start of a long live timeline is not.
  function seekWouldRewind(position, targetTime) {
    const place = finiteNumber(position);
    const targetSeconds = finiteNumber(targetTime);
    if (place == null || targetSeconds == null) return false;
    const back = place - targetSeconds;
    if (back <= 15) return false;
    if (targetSeconds < 5 && place > 30) return true;
    return back > 120;
  }

  function freshAttempts(attempts, now) {
    const kept = [];
    const list = Array.isArray(attempts) ? attempts : [];
    for (const stamp of list) {
      if (typeof stamp === "number" && now - stamp < SKIP_WINDOW_MS) kept.push(stamp);
    }
    return kept;
  }

  function chooseSkip(input) {
    const now = input.now;
    const attempts = freshAttempts(input.attempts, now);
    if (attempts.length >= SKIP_LIMIT) return { action: "play", attempts };
    const targetTime = readSkipTarget(input.detail);
    if (targetTime != null && !seekWouldRewind(input.position, targetTime)) {
      attempts.push(now);
      return { action: "seek", target: targetTime, attempts };
    }
    if (input.allowSkipAd && input.hasSkipAd) {
      attempts.push(now);
      return { action: "skipAd", attempts };
    }
    return { action: "play", attempts };
  }

  // A seek is the precise skip. It may follow one player skipAd. A second
  // seek, or a skipAd after a seek, waits so the break cannot loop.
  function suppress(state, now, action) {
    if (!(state.holdUntil > now)) return false;
    if (state.holdAction === "seek") return true;
    return action !== "seek";
  }

  function reduceIvsMessage(state, data, now) {
    const next = copyState(state);
    if (!data || typeof data !== "object") return { state: next, command: null };
    if (data.id != null) next.playerId = data.id;
    if (data.type === TIME_UPDATE) {
      const place = finiteNumber(data.arg);
      if (place != null) next.position = place;
      return { state: next, command: null };
    }
    if (data.type === AD_BREAK_ENDED) {
      next.holdUntil = 0;
      next.holdAction = "";
      return { state: next, command: null };
    }
    if (data.type !== AD_BREAK_STARTED || data.id == null) {
      return { state: next, command: null };
    }
    const choice = chooseSkip({
      detail: data.arg,
      position: next.position,
      hasSkipAd: true,
      allowSkipAd: true,
      now,
      attempts: next.attempts,
    });
    if (choice.action === "play" || suppress(next, now, choice.action)) {
      return { state: next, command: null };
    }
    next.attempts = choice.attempts;
    next.holdUntil = now + HOLD_MS;
    next.holdAction = choice.action;
    if (choice.action === "seek") {
      return { state: next, command: { id: data.id, funcName: "seekTo", args: [choice.target] } };
    }
    return { state: next, command: { id: data.id, funcName: "skipAd", args: undefined } };
  }

  function reduceSessionDetail(state, detail, now) {
    const next = copyState(state);
    if (next.playerId == null) return { state: next, command: null };
    const choice = chooseSkip({
      detail,
      position: next.position,
      hasSkipAd: false,
      allowSkipAd: false,
      now,
      attempts: next.attempts,
    });
    if (choice.action !== "seek" || suppress(next, now, choice.action)) {
      return { state: next, command: null };
    }
    next.attempts = choice.attempts;
    next.holdUntil = now + HOLD_MS;
    next.holdAction = "seek";
    return { state: next, command: { id: next.playerId, funcName: "seekTo", args: [choice.target] } };
  }

  function directChild(element, tagName) {
    const children = element && element.children;
    if (!children) return false;
    for (const child of children) {
      if (String(child.tagName || "").toUpperCase() === tagName) return true;
    }
    return false;
  }

  function postRollOverlay(node) {
    let current = node && node.parentElement;
    while (current) {
      if (String(current.tagName || "").toUpperCase() === "DIV" && directChild(current, "VIDEO-PLAYER")) return current;
      current = current.parentElement;
    }
    return null;
  }

  function videosInside(element, found) {
    const clips = found || [];
    const children = element && element.children;
    if (!children) return clips;
    for (const child of children) {
      if (String(child.tagName || "").toUpperCase() === "VIDEO") {
        clips.push(child);
      } else {
        videosInside(child, clips);
        // A custom player element may keep its <video> in an open shadow
        // root. A closed one stays invisible (UNVERIFIED whether Kick uses one).
        if (child.shadowRoot) videosInside(child.shadowRoot, clips);
      }
    }
    return clips;
  }

  function bannerCollapseTarget(frame) {
    const parent = frame && frame.parentElement;
    if (!parent) return frame || null;
    if (videosInside(parent).length) return frame;
    return parent;
  }

  // Plain attribute and id selectors only (no :has()): one invalid selector
  // would drop the whole rule.
  function chromeCss() {
    const hide = [...AD_CHROME_SELECTORS, ...BANNER_SELECTORS];
    return `${hide.join(",")}{display:none!important;pointer-events:none!important;}`;
  }

  target.onKickHost = onKickHost;
  target.isIvsWorkerUrl = isIvsWorkerUrl;
  target.emptyState = emptyState;
  target.readSkipTarget = readSkipTarget;
  target.seekWouldRewind = seekWouldRewind;
  target.chooseSkip = chooseSkip;
  target.reduceIvsMessage = reduceIvsMessage;
  target.reduceSessionDetail = reduceSessionDetail;
  target.chromeCss = chromeCss;
  target.AD_CHROME_SELECTORS = AD_CHROME_SELECTORS;
  target.BANNER_SELECTORS = BANNER_SELECTORS;
  target.postRollOverlay = postRollOverlay;
  target.videosInside = videosInside;
  target.bannerCollapseTarget = bannerCollapseTarget;
  target.AD_BREAK_STARTED = AD_BREAK_STARTED;
  target.SKIP_LIMIT = SKIP_LIMIT;
  target.SKIP_WINDOW_MS = SKIP_WINDOW_MS;
  target.HOLD_MS = HOLD_MS;

  // Clips quieted by settleCovers -> whether they were muted before, so a
  // <video> that later turns out to be the live player gets its sound back.
  const quieted = new WeakMap();

  function quietClip(video) {
    try {
      if (!quieted.has(video)) quieted.set(video, video.muted === true);
      video.muted = true;
      if (typeof video.pause === "function" && !video.paused) video.pause();
    } catch (error) {
      debugLog("kick failed open", error);
    }
  }

  // Sound is given back only while the element is paused: Chrome pauses a
  // playing element that is unmuted without a user gesture, and a playing
  // element may have been muted again by the page or the visitor. Play state
  // is left to the player (a new source resets it anyway).
  function unquiet(video) {
    try {
      if (!quieted.has(video)) return;
      const wasMuted = quieted.get(video);
      quieted.delete(video);
      if (video.paused && video.muted && !wasMuted) video.muted = false;
    } catch (error) {
      debugLog("kick failed open", error);
    }
  }

  // Security review L-14 (second half): what a <video> inside a post-roll
  // cover is. "live": the IVS player's video (live and VOD) plays from Media
  // Source Extensions or a stream object, so it has a blob: source or a
  // srcObject, and live it reports an endless duration. "clip": a plain URL
  // source of its own whose metadata says it ends (an ad clip). "unknown":
  // no source yet, a plain URL whose duration is not known yet (it could
  // still be a stream), or a read that throws. UNVERIFIED on live Kick: that
  // the IVS video always looks "live" here and which element plays the
  // post-roll clip (needs a live check).
  function videoKind(video) {
    try {
      if (video.srcObject) return "live";
      const attr = typeof video.getAttribute === "function" ? video.getAttribute("src") : "";
      const sources = [video.currentSrc, video.src, attr].map((s) => String(s || ""));
      if (sources.some((s) => s.startsWith("blob:"))) return "live";
      const duration = video.duration;
      if (duration === Infinity) return "live";
      if (!sources.some((s) => s !== "")) return "unknown";
      return Number.isFinite(duration) ? "clip" : "unknown";
    } catch {
      return "unknown";
    }
  }

  // A cover is hidden (and its clips quieted) only when every <video> in it
  // is a clip. A cover without any <video> we can see is hidden as before
  // (an ad slate or a video in a closed shadow root: UNVERIFIED which).
  function coverContent(overlay) {
    const content = { live: false, unknown: false, clips: [], liveVideos: [], videos: [] };
    try {
      content.videos = videosInside(overlay);
      for (const video of content.videos) {
        const kind = videoKind(video);
        if (kind === "live") {
          content.live = true;
          content.liveVideos.push(video);
        } else if (kind === "unknown") {
          content.unknown = true;
        } else {
          content.clips.push(video);
        }
      }
    } catch {
      // Cannot tell: treat it as holding the live player.
      content.live = true;
    }
    return content;
  }

  // Covers hidden by settleCovers: the inline display each had before our
  // hide (WeakMap: kept while the element lives, also if it is moved), and
  // the set of covers hidden now (so they can be shown again; covers that
  // left the page are dropped from it on every pass).
  const hiddenBefore = new WeakMap();
  const hiddenCovers = new Set();
  const isOurHide = (style) => style.getPropertyValue("display") === "none" && style.getPropertyPriority("display") === "important";

  function hideCover(overlay) {
    const style = overlay.style;
    // Snapshot again when the page changed display since our last write.
    if (!hiddenBefore.has(overlay) || !isOurHide(style)) {
      hiddenBefore.set(overlay, { value: style.getPropertyValue("display"), priority: style.getPropertyPriority("display") });
    }
    style.setProperty("display", "none", "important");
    hiddenCovers.add(overlay);
  }

  // Undo our own hide only: a newer display value set by the page is kept.
  function showCover(overlay) {
    hiddenCovers.delete(overlay);
    const before = hiddenBefore.get(overlay);
    if (!before) return;
    hiddenBefore.delete(overlay);
    const style = overlay.style;
    if (!isOurHide(style)) return;
    if (before.value) style.setProperty("display", before.value, before.priority);
    else style.removeProperty("display");
  }

  // Show a cover again and give its paused clips their sound back.
  function releaseCover(overlay) {
    try {
      showCover(overlay);
      for (const video of videosInside(overlay)) unquiet(video);
    } catch (error) {
      hiddenCovers.delete(overlay);
      debugLog("kick failed open", error);
    }
  }

  // Kick switch off: every cover we hid is shown again.
  function releaseCovers() {
    for (const overlay of Array.from(hiddenCovers)) releaseCover(overlay);
  }

  // A new source or new metadata on a <video> is not a DOM mutation, so each
  // <video> seen in a cover gets two listeners of its own (loadstart: a new
  // src or srcObject; durationchange: metadata, e.g. a stream's endless
  // duration) that run the pass again. Once per element; no polling.
  const watchedMedia = new WeakSet();
  let coversOn = () => true;

  function watchMedia(video) {
    try {
      if (watchedMedia.has(video) || typeof video.addEventListener !== "function") return;
      watchedMedia.add(video);
      const recheck = () => {
        if (coversOn()) settleCovers(document);
      };
      video.addEventListener("loadstart", recheck);
      video.addEventListener("durationchange", recheck);
    } catch (error) {
      debugLog("kick failed open", error);
    }
  }

  function settleCovers(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    let controls;
    let frames;
    try {
      controls = root.querySelectorAll('[data-testid="ima-ad-controls"]');
      frames = root.querySelectorAll('iframe[id^="google_ads_iframe"]');
    } catch (error) {
      debugLog("kick failed open", error);
      return;
    }
    for (const overlay of Array.from(hiddenCovers)) {
      if (overlay.isConnected === false) hiddenCovers.delete(overlay);
    }
    const seen = new Set();
    for (const node of controls) {
      const overlay = postRollOverlay(node);
      if (!overlay || !overlay.style) continue;
      seen.add(overlay);
      try {
        const content = coverContent(overlay);
        for (const video of content.videos) watchMedia(video);
        if (content.live) {
          // Holds the live player (perhaps attached after an earlier pass
          // hid the cover): leave it, undo our hide, give back its sound.
          showCover(overlay);
          for (const video of content.liveVideos) unquiet(video);
          continue;
        }
        if (content.unknown) {
          // A video that may still become the live player: the cover stays
          // visible (our earlier hide undone) until its source and metadata
          // say otherwise (watchMedia runs the pass again then).
          showCover(overlay);
          continue;
        }
        hideCover(overlay);
        for (const video of content.clips) quietClip(video);
      } catch (error) {
        debugLog("kick failed open", error);
      }
    }
    // A cover we hid whose ad controls are gone: the ad is over and the cover
    // may hold the stream now, so it is shown again.
    for (const overlay of Array.from(hiddenCovers)) {
      if (!seen.has(overlay)) releaseCover(overlay);
    }
    for (const frame of frames) {
      try {
        const targetNode = bannerCollapseTarget(frame);
        if (targetNode && targetNode.style) targetNode.style.setProperty("display", "none", "important");
      } catch (error) {
        debugLog("kick failed open", error);
      }
    }
  }

  // The kick switch changed: off shows our covers again (and gives their
  // paused clips sound back); on runs a pass at once.
  function coversSwitched(on) {
    try {
      if (on) settleCovers(document);
      else releaseCovers();
    } catch (error) {
      debugLog("kick failed open", error);
    }
  }

  // isOn: the "kick" switch (security review L-14): with it off, covers are
  // left alone like every other Kick helper.
  function watchCovers(isOn = () => true) {
    coversOn = isOn;
    if (isOn()) settleCovers(document);
    const root = document.documentElement;
    if (!root || typeof MutationObserver !== "function") return;
    let scheduled = false;
    const observer = new MutationObserver((mutations) => {
      if (scheduled || !isOn() || !coverMutation(mutations)) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        if (isOn()) settleCovers(document);
      });
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function coverMutation(mutations) {
    for (const mutation of mutations) {
      const nodes = mutation.addedNodes;
      if (!nodes) continue;
      for (const node of nodes) {
        if (!node || node.nodeType !== 1) continue;
        const tag = String(node.tagName || "");
        if (tag === "IFRAME" || tag === "VIDEO" || tag === "VIDEO-PLAYER") return true;
        try {
          // The added node itself may be the ad controls.
          if (typeof node.matches === "function" && node.matches(COVER_NODES)) return true;
          if (typeof node.querySelector === "function" && node.querySelector(COVER_NODES)) return true;
        } catch (error) {
          debugLog("kick failed open", error);
        }
      }
    }
    return false;
  }

  function injectChromeCss() {
    try {
      if (typeof document === "undefined" || !document.createElement) return;
      if (chromeCssEl && chromeCssEl.isConnected !== false) return;
      const style = document.createElement("style");
      style.textContent = chromeCss();
      const parent = document.head || document.documentElement;
      if (!parent || typeof parent.appendChild !== "function") return;
      parent.appendChild(style);
      chromeCssEl = style;
    } catch (error) {
      debugLog("kick failed open", error);
    }
  }

  function removeChromeCss() {
    try {
      if (chromeCssEl) chromeCssEl.remove();
    } catch {
      // already gone
    }
    chromeCssEl = null;
  }

  function postCommand(worker, command) {
    if (!worker || !command) return;
    try {
      worker.postMessage({ id: command.id, funcName: command.funcName, args: command.args });
    } catch (error) {
      debugLog("kick failed open", error);
    }
  }

  function watchIvsWorker(worker, bridge) {
    worker.addEventListener("message", (event) => {
      try {
        postCommand(worker, bridge.onIvsMessage(event && event.data));
      } catch (error) {
        debugLog("kick failed open", error);
      }
    });
  }

  function installWorkerHook(root, onIvsWorker) {
    const NativeWorker = root.Worker;
    if (typeof NativeWorker !== "function" || wrapped.has(NativeWorker)) return;
    function WrappedWorker(url, options) {
      const worker = arguments.length > 1 ? new NativeWorker(url, options) : new NativeWorker(url);
      try {
        if (isIvsWorkerUrl(url)) onIvsWorker(worker);
      } catch (error) {
        debugLog("kick failed open", error);
      }
      return worker;
    }
    WrappedWorker.prototype = NativeWorker.prototype;
    wrapped.add(WrappedWorker);
    root.Worker = WrappedWorker;
  }

  function wrapMediaTailor(media, onDetail) {
    if (!media || wrapped.has(media) || typeof media.createSession !== "function") return media;
    const nativeCreate = media.createSession.bind(media);
    media.createSession = function (options) {
      return Promise.resolve(nativeCreate(options)).then((session) => {
        if (!session || wrapped.has(session) || typeof session.addEventListener !== "function") return session;
        const nativeAdd = session.addEventListener.bind(session);
        const nativeRemove = typeof session.removeEventListener === "function" ? session.removeEventListener.bind(session) : null;
        // One wrapper per (type, listener), so the page can remove its
        // listener again and a repeated add is still deduplicated (M-16).
        const wrappers = new Map();
        const wrapperFor = (type, listener) => {
          let byListener = wrappers.get(type);
          if (!byListener) wrappers.set(type, (byListener = new WeakMap()));
          let w = byListener.get(listener);
          if (!w) {
            w = function (event) {
              try {
                const detail = event && typeof event === "object" ? event.detail : null;
                onDetail(detail);
              } catch (error) {
                debugLog("kick failed open", error);
              }
              if (typeof listener === "function") return listener.call(this, event);
              if (listener && typeof listener.handleEvent === "function") return listener.handleEvent(event);
            };
            byListener.set(listener, w);
          }
          return w;
        };
        session.addEventListener = function (type, listener, listenerOptions) {
          if (!listener || (typeof listener !== "function" && typeof listener !== "object")) return nativeAdd(type, listener, listenerOptions);
          return nativeAdd(type, wrapperFor(type, listener), listenerOptions);
        };
        if (nativeRemove) {
          session.removeEventListener = function (type, listener, listenerOptions) {
            const byListener = wrappers.get(type);
            const w = listener && byListener ? byListener.get(listener) : null;
            return nativeRemove(type, w || listener, listenerOptions);
          };
        }
        wrapped.add(session);
        return session;
      });
    };
    wrapped.add(media);
    return media;
  }

  function installDatazoomHook(root, onDetail) {
    let sdk = root.datazoom;
    function wrapSdk(value) {
      if (!value || wrapped.has(value)) return value;
      let media = value.mediatailor;
      try {
        Object.defineProperty(value, "mediatailor", {
          configurable: true,
          enumerable: true,
          get() {
            media = wrapMediaTailor(media, onDetail);
            return media;
          },
          set(next) {
            media = next;
          },
        });
      } catch (error) {
        debugLog("kick failed open", error);
        wrapMediaTailor(media, onDetail);
      }
      wrapped.add(value);
      return value;
    }
    try {
      Object.defineProperty(root, "datazoom", {
        configurable: true,
        enumerable: true,
        get() {
          return sdk;
        },
        set(value) {
          sdk = wrapSdk(value);
        },
      });
    } catch (error) {
      debugLog("kick failed open", error);
      if (sdk) wrapSdk(sdk);
      return;
    }
    if (sdk) sdk = wrapSdk(sdk);
  }

  function startKickAdblock() {
    let host = "";
    try {
      host = location.hostname;
    } catch {
      return;
    }
    if (!onKickHost(host) || typeof window === "undefined") return;
    // Feature switch "kick" (src/settings/flags.js, ISOLATED world): read at
    // use time, ON until a flag says otherwise (fail-open). Off stops the next
    // skip command and drops the chrome CSS; hooks stay installed (inert).
    // Flags come only over the private port flags.js hands over at
    // document_start, never as window messages (the page can forge those).
    let kickOn = true;
    try {
      const PORT_EVENT = "gk-p1";
      let port = null;
      // Read events through MessageEvent getters captured now, before any page
      // script runs: a page that later redefines MessageEvent.prototype.data or
      // .ports can then neither rewrite nor read the flags (review of M-1). Outside
      // a browser (tests) plain property reads are used.
      const applyFn = Reflect.apply;
      const meGetter = (k) => {
        const d = Object.getOwnPropertyDescriptor(MessageEvent.prototype, k);
        return d && typeof d.get === "function" ? d.get : null;
      };
      const dataGet = meGetter("data");
      const portsGet = meGetter("ports");
      const dataOf = dataGet ? (m) => applyFn(dataGet, m, []) : (m) => m && m.data;
      const portsOf = portsGet ? (e) => applyFn(portsGet, e, []) : (e) => e && e.ports;
      const flagsOf = (m) => {
        const d = dataOf(m);
        return d && typeof d === "object" ? d.f : null;
      };
      const take = (event) => {
        const ps = portsOf(event);
        const p = ps && ps[0];
        if (port || !p) return;
        port = p;
        window.removeEventListener(PORT_EVENT, take, true);
        p.addEventListener("message", (m) => {
          const f = flagsOf(m);
          if (!f || typeof f !== "object" || typeof f.kick !== "boolean") return;
          kickOn = f.kick;
          if (!kickOn) {
            removeChromeCss();
          } else {
            injectChromeCss();
          }
          coversSwitched(kickOn);
        });
        p.start();
      };
      window.addEventListener(PORT_EVENT, take, true);
      window.dispatchEvent(new Event("gk-r1"));
    } catch {
      // no flags: stays on
    }
    const bridge = {
      state: emptyState(),
      onIvsMessage(data) {
        const result = reduceIvsMessage(this.state, data, Date.now());
        this.state = result.state;
        return result.command;
      },
      onSessionDetail(detail) {
        const result = reduceSessionDetail(this.state, detail, Date.now());
        this.state = result.state;
        return result.command;
      },
    };
    let ivsWorker = null;
    installWorkerHook(window, (worker) => {
      ivsWorker = worker;
      watchIvsWorker(worker, {
        onIvsMessage: (data) => {
          const command = bridge.onIvsMessage(data);
          return kickOn ? command : null;
        },
      });
    });
    installDatazoomHook(window, (detail) => {
      const command = bridge.onSessionDetail(detail);
      if (kickOn) postCommand(ivsWorker, command);
    });
    injectChromeCss();
    watchCovers(() => kickOn);
    debugLog("watching Kick");
  }

  target.watchCovers = watchCovers;
  target.videoKind = videoKind;
  target.coverContent = coverContent;
  target.releaseCovers = releaseCovers;
  target.coversSwitched = coversSwitched;
  target.startKickAdblock = startKickAdblock;
  target.wrapMediaTailor = wrapMediaTailor;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const api = {};
  installKickAdblock(api);
  api.startKickAdblock();
}
})();
