// Runs on Kick at document_start. In-player ads are skipped only when the
// IVS player can jump back to the stream. If a skip would rewind a long way,
// or the player cannot take it, the ad plays. The live video is never hidden,
// muted, or sped up. A separate post-roll cover can be paused.
function installKickAdblock(target) {
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
  const POSTROLL_OVERLAY = 'div:has(> video-player):has([data-testid="ima-ad-controls"])';

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
      if (String(child.tagName || "").toUpperCase() === "VIDEO") clips.push(child);
      else videosInside(child, clips);
    }
    return clips;
  }

  function bannerCollapseTarget(frame) {
    const parent = frame && frame.parentElement;
    if (!parent) return frame || null;
    if (videosInside(parent).length) return frame;
    return parent;
  }

  function chromeCss() {
    const hide = [...AD_CHROME_SELECTORS, ...BANNER_SELECTORS, POSTROLL_OVERLAY];
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

  function quietClip(video) {
    try {
      video.muted = true;
      if (typeof video.pause === "function" && !video.paused) video.pause();
    } catch (error) {
      console.log("twitch-adblock kick failed open", error);
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
      console.log("twitch-adblock kick failed open", error);
      return;
    }
    for (const node of controls) {
      const overlay = postRollOverlay(node);
      if (!overlay || !overlay.style) continue;
      overlay.style.setProperty("display", "none", "important");
      for (const video of videosInside(overlay)) quietClip(video);
    }
    for (const frame of frames) {
      const targetNode = bannerCollapseTarget(frame);
      if (targetNode && targetNode.style) targetNode.style.setProperty("display", "none", "important");
    }
  }

  function watchCovers() {
    settleCovers(document);
    const root = document.documentElement;
    if (!root || typeof MutationObserver !== "function") return;
    let scheduled = false;
    const observer = new MutationObserver((mutations) => {
      if (scheduled || !coverMutation(mutations)) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        settleCovers(document);
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
        if (typeof node.querySelector === "function" && node.querySelector('[data-testid="ima-ad-controls"], iframe[id^="google_ads_iframe"], video-player')) {
          return true;
        }
      }
    }
    return false;
  }

  function injectChromeCss() {
    try {
      if (typeof document === "undefined" || !document.createElement) return;
      if (document.getElementById && document.getElementById("twitch-adblock-kick-css")) return;
      const style = document.createElement("style");
      style.id = "twitch-adblock-kick-css";
      style.textContent = chromeCss();
      const parent = document.head || document.documentElement;
      if (!parent || typeof parent.appendChild !== "function") return;
      parent.appendChild(style);
    } catch (error) {
      console.log("twitch-adblock kick failed open", error);
    }
  }

  function postCommand(worker, command) {
    if (!worker || !command) return;
    try {
      worker.postMessage({ id: command.id, funcName: command.funcName, args: command.args });
    } catch (error) {
      console.log("twitch-adblock kick failed open", error);
    }
  }

  function watchIvsWorker(worker, bridge) {
    worker.addEventListener("message", (event) => {
      try {
        postCommand(worker, bridge.onIvsMessage(event && event.data));
      } catch (error) {
        console.log("twitch-adblock kick failed open", error);
      }
    });
  }

  function installWorkerHook(root, onIvsWorker) {
    const NativeWorker = root.Worker;
    if (typeof NativeWorker !== "function" || NativeWorker.__kickAdblock) return;
    function WrappedWorker(url, options) {
      const worker = arguments.length > 1 ? new NativeWorker(url, options) : new NativeWorker(url);
      try {
        if (isIvsWorkerUrl(url)) onIvsWorker(worker);
      } catch (error) {
        console.log("twitch-adblock kick failed open", error);
      }
      return worker;
    }
    WrappedWorker.prototype = NativeWorker.prototype;
    WrappedWorker.__kickAdblock = true;
    root.Worker = WrappedWorker;
  }

  function wrapMediaTailor(media, onDetail) {
    if (!media || media.__kickAdblock || typeof media.createSession !== "function") return media;
    const nativeCreate = media.createSession.bind(media);
    media.createSession = function (options) {
      return Promise.resolve(nativeCreate(options)).then((session) => {
        if (!session || session.__kickAdblock || typeof session.addEventListener !== "function") return session;
        const nativeAdd = session.addEventListener.bind(session);
        session.addEventListener = function (type, listener, listenerOptions) {
          return nativeAdd(type, function (event) {
            try {
              const detail = event && typeof event === "object" ? event.detail : null;
              onDetail(detail);
            } catch (error) {
              console.log("twitch-adblock kick failed open", error);
            }
            if (typeof listener === "function") return listener.call(this, event);
            if (listener && typeof listener.handleEvent === "function") return listener.handleEvent(event);
          }, listenerOptions);
        };
        session.__kickAdblock = true;
        return session;
      });
    };
    media.__kickAdblock = true;
    return media;
  }

  function installDatazoomHook(root, onDetail) {
    let sdk = root.datazoom;
    function wrapSdk(value) {
      if (!value || value.__kickAdblockSdk) return value;
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
        console.log("twitch-adblock kick failed open", error);
        wrapMediaTailor(media, onDetail);
      }
      value.__kickAdblockSdk = true;
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
      console.log("twitch-adblock kick failed open", error);
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
      watchIvsWorker(worker, bridge);
    });
    installDatazoomHook(window, (detail) => {
      postCommand(ivsWorker, bridge.onSessionDetail(detail));
    });
    injectChromeCss();
    watchCovers();
    console.log("twitch-adblock: watching Kick");
  }

  target.startKickAdblock = startKickAdblock;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const api = {};
  installKickAdblock(api);
  api.startKickAdblock();
}
