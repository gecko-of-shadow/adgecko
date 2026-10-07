// Runs in the page at document_start and swaps stitched Twitch ads for another player stream.
(function () {
  if (globalThis.__twitchAdblockInstalled) return;
  globalThis.__twitchAdblockInstalled = true;

  const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
  const FORCED_PLAYER_TYPE = "popout";
  let deviceId = readCookie("unique_id");
  let clientIntegrity = "";
  let authorization = "";

  const nativeFetch = window.fetch.bind(window);
  warnConflictOnce(window.fetch, window.Worker);
  const guard = createPlaylistGuard({
    fetch: nativeFetch,
    gql: pageGql,
    reload: reloadPlayer,
    status: setNotice,
  });

  window.fetch = async function (input, init) {
    const replay = input instanceof Request ? input.clone() : input;
    try {
      const request = await rewritePlaybackRequest(input, init);
      return await guard(request.input, request.init);
    } catch (error) {
      console.log("twitch-adblock failed open", error);
      return nativeFetch(replay, init);
    }
  };
  const ourFetch = window.fetch;

  const NativeWorker = window.Worker;
  const workerBlobs = typeof FinalizationRegistry === "function"
    ? new FinalizationRegistry((heldUrl) => {
        try {
          URL.revokeObjectURL(heldUrl);
        } catch {
          // The blob URL was already revoked.
        }
      })
    : null;
  function TwitchAdblockWorker(url, options) {
    const scriptUrl = String(url || "");
    if (!isTwitchWorker(scriptUrl) || (options && options.type === "module")) {
      return new NativeWorker(url, options);
    }
    let source = "";
    try {
      source = readTextSync(scriptUrl);
    } catch (error) {
      console.log("twitch-adblock could not read the player worker", error);
    }
    if (!source) return new NativeWorker(url, options);
    // Chat and other page workers also use twitch.tv blob URLs. Only inject into
    // workers that look like the live player so their fetch/GQL path stays native.
    if (!isPlayerWorkerSource(source)) return new NativeWorker(url, options);
    const blobUrl = URL.createObjectURL(new Blob([workerPrelude() + "\n" + source], { type: "text/javascript" }));
    const worker = new NativeWorker(blobUrl, options);
    let released = false;
    function releaseWorker() {
      if (released) return;
      released = true;
      URL.revokeObjectURL(blobUrl);
      worker.removeEventListener("message", onWorkerMessage, true);
    }
    worker.addEventListener("message", onWorkerMessage, true);
    worker.addEventListener("error", releaseWorker);
    const nativeTerminate = worker.terminate;
    worker.terminate = function () {
      releaseWorker();
      return nativeTerminate.call(worker);
    };
    // The worker reads the blob during construction. Drop the URL after that
    // so a replaced player does not keep the bytes for the life of the tab.
    setTimeout(releaseBlobOnly, 1000);
    function releaseBlobOnly() {
      if (released) return;
      URL.revokeObjectURL(blobUrl);
    }
    if (workerBlobs) workerBlobs.register(worker, blobUrl);
    return worker;
  }
  TwitchAdblockWorker.prototype = NativeWorker.prototype;
  window.Worker = TwitchAdblockWorker;
  const ourWorker = window.Worker;
  queueMicrotask(() => {
    if (window.fetch !== ourFetch || window.Worker !== ourWorker) {
      warnConflictOnce(null, null, true);
    }
  });

  console.log("twitch-adblock: watching Twitch");

  function isNativeFunction(fn) {
    try {
      return typeof fn === "function" && Function.prototype.toString.call(fn).includes("[native code]");
    } catch {
      return false;
    }
  }

  function warnConflictOnce(fetchFn, workerFn, forced) {
    if (globalThis.__twitchAdblockConflictWarned) return;
    const fetchHooked = forced || (fetchFn && !isNativeFunction(fetchFn));
    const workerHooked = forced || (typeof workerFn === "function" && !isNativeFunction(workerFn));
    if (!fetchHooked && !workerHooked) return;
    globalThis.__twitchAdblockConflictWarned = true;
    console.warn(
      "twitch-adblock: another script already patched fetch or Worker (for example uBlock Origin's twitch-videoad). Disable that filter while using twitch-adblock so only one ad script runs.",
    );
  }

  function workerPrelude() {
    return [
      installTwitchAdblockPlaylist.toString(),
      "installTwitchAdblockPlaylist(globalThis.TwitchAdblockPlaylist = {});",
      rewritePlaybackBody.toString(),
      createPlaylistGuard.toString(),
      startTwitchAdblockWorker.toString(),
      "startTwitchAdblockWorker();",
    ].join("\n");
  }

  function onWorkerMessage(event) {
    const data = event.data;
    if (!data || data.source !== "twitch-adblock") return;
    event.stopImmediatePropagation();
    if (data.type === "gql") {
      const worker = event.currentTarget;
      pageGql(data.body).then(
        (text) => worker.postMessage({ source: "twitch-adblock", type: "gql-result", id: data.id, ok: true, text }),
        (error) => worker.postMessage({ source: "twitch-adblock", type: "gql-result", id: data.id, ok: false, error: String(error) }),
      );
      return;
    }
    if (data.type === "reload") reloadPlayer();
    if (data.type === "status") setNotice(Boolean(data.blocking));
  }

  async function pageGql(body) {
    const headers = {
      "Client-Id": CLIENT_ID,
      "Content-Type": "text/plain; charset=UTF-8",
    };
    if (deviceId) {
      headers["Device-ID"] = deviceId;
      headers["X-Device-Id"] = deviceId;
    }
    if (clientIntegrity) headers["Client-Integrity"] = clientIntegrity;
    if (authorization) headers["Authorization"] = authorization;
    const response = await nativeFetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return response.text();
  }

  async function rewritePlaybackRequest(input, init) {
    captureHeaders(init, input);
    const url = requestUrl(input);
    // Cheap URL gate before any Request body read — most page fetches are not GQL.
    if (!url.includes("gql")) return { input, init };
    let body = "";
    let fromRequest = false;
    if (init && typeof init.body === "string") body = init.body;
    else if (typeof Request !== "undefined" && input instanceof Request) {
      body = await input.clone().text();
      fromRequest = true;
    }
    if (!body.includes("PlaybackAccessToken")) return { input, init };
    const rewritten = rewritePlaybackBody(body);
    if (!rewritten.changed) return { input, init };
    if (rewritten.droppedPip) console.log("twitch-adblock: dropping the picture-by-picture player token");
    if (rewritten.rewrittenType) console.log("twitch-adblock: using the popout player token");
    if (!fromRequest) return { input, init: Object.assign({}, init, { body: rewritten.body }) };
    return { input: new Request(input, { body: rewritten.body }), init };
  }

  function captureHeaders(init, input) {
    const fromInit = init && init.headers;
    const fromRequest = typeof Request !== "undefined" && input instanceof Request ? input.headers : null;
    const foundDevice = headerValue(fromInit, "X-Device-Id") || headerValue(fromInit, "Device-ID") || headerValue(fromRequest, "X-Device-Id") || headerValue(fromRequest, "Device-ID");
    const foundIntegrity = headerValue(fromInit, "Client-Integrity") || headerValue(fromRequest, "Client-Integrity");
    const foundAuthorization = headerValue(fromInit, "Authorization") || headerValue(fromRequest, "Authorization");
    if (foundDevice) deviceId = foundDevice;
    if (foundIntegrity) clientIntegrity = foundIntegrity;
    if (foundAuthorization) authorization = foundAuthorization;
  }

  function headerValue(headers, name) {
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
    const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
    return match ? headers[match] : "";
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function isTwitchWorker(url) {
    try {
      const parsed = new URL(url, location.href);
      const host = parsed.hostname || new URL(parsed.origin).hostname;
      return parsed.protocol === "blob:" && (host === "twitch.tv" || host.endsWith(".twitch.tv"));
    } catch {
      return false;
    }
  }

  function isPlayerWorkerSource(source) {
    const text = String(source || "");
    return /usher\.ttvnw\.net|PlaybackAccessToken|\/channel\/hls\/|#EXTM3U|stitched-ad|amazon-ivs/i.test(text);
  }

  function readTextSync(url) {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send();
    return request.responseText || "";
  }

  function readCookie(name) {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function findPlayer() {
    const rootElement = document.querySelector("#root");
    if (!rootElement) return null;
    const key = Object.keys(rootElement).find((name) => name.startsWith("__reactContainer") || name.startsWith("__reactFiber"));
    if (!key || !rootElement[key]) return null;
    const playerNode = walkFiber(rootElement[key], (node) => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
    let player = playerNode && playerNode.props ? playerNode.props.mediaPlayerInstance : null;
    if (player && player.playerInstance) player = player.playerInstance;
    const state = walkFiber(rootElement[key], (node) => typeof node.setSrc === "function" && typeof node.setInitialPlaybackSettings === "function");
    return { player, state };
  }

  function walkFiber(node, predicate) {
    while (node) {
      if (node.stateNode && predicate(node.stateNode)) return node.stateNode;
      if (node.child) {
        const child = walkFiber(node.child, predicate);
        if (child) return child;
      }
      node = node.sibling;
    }
    return null;
  }

  function reloadPlayer() {
    const found = findPlayer();
    if (!found || !found.player || !found.state) {
      console.log("twitch-adblock could not find the player");
      return;
    }
    // A stalled midroll player often reports paused. Skipping reload left the viewer
    // stuck on the backup with a spinner after the ad ended — always refresh.
    const quality = safeGet("video-quality");
    const muted = safeGet("video-muted");
    const volume = safeGet("volume");
    try {
      found.state.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
      if (typeof found.player.play === "function") found.player.play();
    } catch (error) {
      console.log("twitch-adblock reload failed", error);
      return;
    }
    setTimeout(() => {
      if (quality) safeSet("video-quality", quality);
      if (muted) safeSet("video-muted", muted);
      if (volume) safeSet("volume", volume);
    }, 800);
  }


  function safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return "";
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Twitch can lock storage while the player reloads.
    }
  }

  let noticeBlocks = 0;
  let noticeOn = false;
  function setNotice(blocking) {
    if (blocking) {
      if (!noticeOn) noticeBlocks += 1;
      noticeOn = true;
    } else {
      noticeOn = false;
    }
    const existing = document.getElementById("twitch-adblock-notice");
    if (!noticeOn) {
      if (existing) existing.remove();
      return;
    }
    const player = document.querySelector(".video-player");
    if (!player) return;
    const notice = existing || document.createElement("div");
    notice.id = "twitch-adblock-notice";
    notice.textContent = `Blocking ads (${noticeBlocks})`;
    notice.style.cssText = "position:absolute;top:8px;left:8px;z-index:20;color:#fff;background:rgba(0,0,0,.75);padding:4px 8px;font:12px/1.2 sans-serif;pointer-events:none;";
    if (notice.parentElement !== player) player.appendChild(notice);
  }

  // Twitch pauses a background tab when document.hidden is true. Keep the
  // stream playing through an ad break. visibilityState is left alone.
  try {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get() {
        return false;
      },
    });
  } catch {
    // Another script already defined it.
  }
  // Do not stopImmediatePropagation — Twitch chat/pubsub reconnect after a
  // player reload listens for visibilitychange. hidden is already spoofed.
  document.addEventListener("visibilitychange", () => {
    const video = document.querySelector("video");
    if (video && video.paused && !video.ended) {
      video.play().catch(() => {});
    }
  }, true);

  try {
    const playerKeys = ["video-quality", "video-muted", "volume", "lowLatencyModeEnabled", "persistenceEnabled"];
    const cachedSettings = new Map(playerKeys.map((key) => [key, localStorage.getItem(key)]));
    const nativeGetItem = localStorage.getItem.bind(localStorage);
    const nativeSetItem = localStorage.setItem.bind(localStorage);
    localStorage.getItem = function (key) {
      if (cachedSettings.has(key)) return cachedSettings.get(key);
      return nativeGetItem(key);
    };
    localStorage.setItem = function (key, value) {
      if (cachedSettings.has(key)) cachedSettings.set(key, value);
      return nativeSetItem(key, value);
    };
  } catch {
    // Firefox can refuse these hooks. The reload path still restores quality.
  }
})();

function startTwitchAdblockWorker() {
  const pending = new Map();
  const gqlWaitMs = 15000;
  self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "twitch-adblock" || data.type !== "gql-result") return;
    event.stopImmediatePropagation();
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    clearTimeout(waiter.timer);
    if (data.ok) waiter.resolve(data.text);
    else waiter.reject(new Error(data.error || "gql failed"));
  });

  const nativeFetch = fetch;
  const guard = createPlaylistGuard({
    fetch: nativeFetch.bind(self),
    gql(body) {
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error("gql timed out"));
        }, gqlWaitMs);
        pending.set(id, { timer, resolve, reject });
        postMessage({ source: "twitch-adblock", type: "gql", id, body });
      });
    },
    reload() {
      postMessage({ source: "twitch-adblock", type: "reload" });
    },
    status(blocking) {
      postMessage({ source: "twitch-adblock", type: "status", blocking });
    },
  });
  self.fetch = async function (input, init) {
    const replay = typeof Request !== "undefined" && input instanceof Request ? input.clone() : input;
    try {
      let nextInput = input;
      let nextInit = init;
      const url = typeof input === "string" ? input : (input && input.url) || "";
      // Gate on GQL URL before reading a Request body.
      if (url.includes("gql")) {
        let body = init && typeof init.body === "string" ? init.body : "";
        if (!body && typeof Request !== "undefined" && input instanceof Request) body = await input.clone().text();
        if (body.includes("PlaybackAccessToken")) {
          const rewritten = rewritePlaybackBody(body);
          if (rewritten.changed) {
            if (init && typeof init.body === "string") nextInit = Object.assign({}, init, { body: rewritten.body });
            else if (typeof Request !== "undefined" && input instanceof Request) nextInput = new Request(input, { body: rewritten.body });
          }
        }
      }
      return await guard(nextInput, nextInit);
    } catch (error) {
      console.log("twitch-adblock failed open", error);
      return nativeFetch(replay, init);
    }
  };
}

function rewritePlaybackBody(body) {
  const source = String(body || "");
  if (!source.includes("PlaybackAccessToken")) return { body: source, changed: false, droppedPip: false, rewrittenType: false };
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { body: source, changed: false, droppedPip: false, rewrittenType: false };
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const kept = [];
  let changed = false;
  let droppedPip = false;
  let rewrittenType = false;
  for (const item of items) {
    const name = item && item.operationName ? String(item.operationName) : "";
    const isPlayback = Boolean(item && item.variables && name.includes("PlaybackAccessToken") && !name.includes("Prefetch"));
    if (!isPlayback) {
      kept.push(item);
      continue;
    }
    if (item.variables.playerType === "picture-by-picture") {
      droppedPip = true;
      changed = true;
      continue;
    }
    if (item.variables.playerType && item.variables.playerType !== "popout") {
      item.variables.playerType = "popout";
      rewrittenType = true;
      changed = true;
    }
    kept.push(item);
  }
  if (!changed) return { body: source, changed: false, droppedPip: false, rewrittenType: false };
  if (!kept.length) return { body: "", changed: true, droppedPip, rewrittenType };
  return { body: JSON.stringify(Array.isArray(parsed) ? kept : kept[0]), changed: true, droppedPip, rewrittenType };
}

function createPlaylistGuard(env) {
  const playlist = globalThis.TwitchAdblockPlaylist;
  const sessions = new Map();
  const streamByUrl = new Map();
  const blockedSegments = new Map();
  const variantLimit = 64;
  const sessionLimit = 8;
  const sessionTtl = 120000;
  // Match TwitchAdSolutions video-swap-new try order (lower quality while blocked is OK).
  const backupTypes = ["autoplay", "picture-by-picture", "embed"];
  const handoffGraceMs = env.handoffGraceMs == null ? 150 : Number(env.handoffGraceMs);
  const playbackHash = "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";
  const playbackQuery = "query PlaybackAccessToken($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } }";

  let reloadQueued = false;
  function scheduleReload() {
    if (reloadQueued) return;
    reloadQueued = true;
    // Macrotask: the clean playlist Response must reach the player before setSrc
    // resets usher. A microtask can run reload too early and leave a spinner.
    setTimeout(() => {
      reloadQueued = false;
      env.reload();
    }, 0);
  }


  function backupMatchScore(mainText, backupText) {
    const main = playlist.listVariants(mainText);
    if (!main.length) return 0;
    const backupVariants = playlist.listVariants(backupText);
    let score = 0;
    for (const variant of main) {
      const picked = playlist.pickVariant(backupText, {
        resolution: variant.resolution,
        frameRate: variant.frameRate,
        video: variant.video,
      });
      if (!picked) continue;
      const match = backupVariants.find((item) => item.url === picked);
      if (!match) continue;
      if (variant.resolution && match.resolution === variant.resolution) score += 100;
      else score += 1;
      if (variant.frameRate && match.frameRate === String(variant.frameRate)) score += 10;
    }
    return score;
  }

  function pickBestBackup(candidates) {
    return candidates.slice().sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return backupTypes.indexOf(left.playerType) - backupTypes.indexOf(right.playerType);
    })[0] || null;
  }

  function canonical(url) {
    const hash = url.indexOf("#");
    return (hash === -1 ? url : url.slice(0, hash)).trim();
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    return "";
  }

  function textResponse(body, contentType) {
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": contentType || "application/vnd.apple.mpegurl" },
    });
  }

  function rememberBlocked(urls) {
    const now = Date.now();
    for (const url of urls) blockedSegments.set(url, now);
    for (const [url, seen] of blockedSegments) {
      if (seen < now - 120000) blockedSegments.delete(url);
    }
  }

  function tokenFrom(json) {
    const data = json && json.data;
    // Embed responses sometimes put the token on the root instead of under data.
    const token = (data && data.streamPlaybackAccessToken) || (json && json.streamPlaybackAccessToken);
    if (!token || !token.value || !token.signature) return null;
    return token;
  }

  function absoluteVariant(url, base) {
    try {
      const resolved = new URL(url, base);
      resolved.hash = "";
      return canonical(resolved.href);
    } catch {
      return canonical(String(url || ""));
    }
  }

  function sessionIsFinished(session) {
    return !session.usingBackup && !session.served && session.requestedAds.size === 0 && session.tried.size === 0;
  }

  function forgetChannelUrls(channel) {
    for (const [url, owner] of streamByUrl) {
      if (owner === channel) streamByUrl.delete(url);
    }
  }

  function dropSession(channel) {
    if (!sessions.has(channel)) return;
    sessions.delete(channel);
    forgetChannelUrls(channel);
  }

  function evictSessions(now, keepChannel) {
    for (const [channel, session] of [...sessions]) {
      if (channel === keepChannel) continue;
      if (now - session.seenAt >= sessionTtl) dropSession(channel);
    }
    if (sessions.size <= sessionLimit) return;
    const ranked = [];
    for (const [channel, session] of sessions) {
      if (channel === keepChannel) continue;
      ranked.push([channel, session]);
    }
    ranked.sort((left, right) => {
      const leftFinished = sessionIsFinished(left[1]) ? 0 : 1;
      const rightFinished = sessionIsFinished(right[1]) ? 0 : 1;
      if (leftFinished !== rightFinished) return leftFinished - rightFinished;
      return left[1].seenAt - right[1].seenAt;
    });
    for (const [channel] of ranked) {
      if (sessions.size <= sessionLimit) break;
      dropSession(channel);
    }
  }

  function ensureSession(channel) {
    let session = sessions.get(channel);
    if (!session) {
      session = {
        tried: new Set(),
        retryAt: 0,
        usingBackup: false,
        movingOffBackup: false,
        served: "",
        reloadedForBackup: false,
        requestedAds: new Set(),
        variants: new Map(),
        backupUrls: new Set(),
        masterUrl: "",
        liveMaster: "",
        mainVariantUrl: "",
        mainProbeFails: 0,
        seenAt: Date.now(),
      };
      sessions.set(channel, session);
    }
    session.seenAt = Date.now();
    evictSessions(session.seenAt, channel);
    return session;
  }

  function rememberVariant(session, channel, abs, meta, backup) {
    streamByUrl.delete(abs);
    streamByUrl.set(abs, channel);
    session.variants.delete(abs);
    session.variants.set(abs, meta);
    if (backup) session.backupUrls.add(abs);
    while (session.variants.size > variantLimit) {
      const oldest = session.variants.keys().next().value;
      session.variants.delete(oldest);
      session.backupUrls.delete(oldest);
      if (streamByUrl.get(oldest) === channel) streamByUrl.delete(oldest);
    }
  }

  function indexStreamUrls(channel, text, base, backup) {
    const session = sessions.get(channel);
    if (!session) return;
    for (const variant of playlist.listVariants(text)) {
      const abs = absoluteVariant(variant.url, base);
      if (!abs) continue;
      rememberVariant(session, channel, abs, {
        resolution: variant.resolution,
        frameRate: variant.frameRate,
        video: variant.video,
      }, backup);
    }
  }

  function rememberMain(session, channel, masterUrl, liveText) {
    session.masterUrl = masterUrl;
    session.liveMaster = liveText;
    const sample = playlist.pickVariant(liveText, null);
    if (sample) session.mainVariantUrl = absoluteVariant(sample, masterUrl);
    indexStreamUrls(channel, liveText, masterUrl, false);
  }

  async function fetchPlaylist(url) {
    try {
      const response = await env.fetch(url);
      if (!response.ok) return null;
      const body = await response.text();
      if (!body.startsWith("#EXTM3U")) return null;
      return body;
    } catch {
      return null;
    }
  }

  function consumePreroll(session, text) {
    if (playlist.isMidroll(text)) return;
    const adUrl = playlist.firstAdSegmentUrl(text);
    if (!adUrl || session.requestedAds.has(adUrl)) return;
    session.requestedAds.add(adUrl);
    env.fetch(adUrl).then((response) => response.arrayBuffer()).catch(() => {});
  }

  function leaveBackup(session) {
    const wasUsing = session.usingBackup;
    // video-swap-new IsMovingOffBackupEncodings: ignore ad tags until the next
    // master poll so leave+reload cannot immediately re-enter backup.
    if (wasUsing) session.movingOffBackup = true;
    session.usingBackup = false;
    session.served = "";
    session.backupUrls.clear();
    session.tried.clear();
    session.reloadedForBackup = false;
    session.requestedAds.clear();
    session.mainProbeFails = 0;
    env.status(false);
    if (wasUsing) scheduleReload();
  }

  async function maybeReturnToMain(session) {
    if (!session.usingBackup) return;

    // Prefer the cached main media URL when it still resolves.
    if (session.mainVariantUrl) {
      const body = await fetchPlaylist(session.mainVariantUrl);
      if (body != null) {
        session.mainProbeFails = 0;
        if (playlist.hasAdBreak(body)) {
          consumePreroll(session, body);
          return;
        }
        leaveBackup(session);
        return;
      }
    }

    // CDN rungs rotate: refresh the live master and probe again before staying on backup.
    if (session.masterUrl) {
      const master = await fetchPlaylist(session.masterUrl);
      if (master != null) {
        const channel = playlist.channelFromPlaylistUrl(session.masterUrl);
        if (channel) rememberMain(session, channel, session.masterUrl, master);
        const ads = await sampleHasAds(master, session.masterUrl, session.mainVariantUrl);
        if (ads === true) {
          session.mainProbeFails = 0;
          return;
        }
        if (ads === false) {
          leaveBackup(session);
          return;
        }
      }
    }

    // Fail open: do not freeze on a dead backup when main/master probes keep failing.
    session.mainProbeFails += 1;
    if (session.mainProbeFails >= 3) leaveBackup(session);
  }

  async function playbackToken(channel, playerType) {
    const body = {
      operationName: "PlaybackAccessToken",
      variables: {
        isLive: true,
        login: channel,
        isVod: false,
        vodID: "",
        playerType,
        platform: playerType === "autoplay" ? "android" : "web",
      },
      extensions: {
        persistedQuery: { version: 1, sha256Hash: playbackHash },
      },
    };
    // Backup tokens use env.gql, which calls the original fetch. The page hook
    // that drops picture-by-picture never sees this request.
    let json = JSON.parse(await env.gql(body));
    if (!tokenFrom(json) && JSON.stringify(json.errors || json).toLowerCase().includes("persist")) {
      json = JSON.parse(await env.gql({
        operationName: "PlaybackAccessToken",
        query: playbackQuery,
        variables: body.variables,
      }));
    }
    return tokenFrom(json);
  }

  async function sampleHasAds(masterText, masterUrl, knownUrl, knownBody) {
    const variants = playlist.listVariants(masterText);
    if (!variants.length) return playlist.hasAdBreak(masterText) || null;
    // Prefer a known media body / the first listed rung, then the rest. Stop on the
    // first successfully loaded clean playlist — Twitch stitches ads across live
    // rungs together, so probing every quality on a clean poll only wastes fetches.
    const ordered = [];
    const seen = new Set();
    function enqueue(variant) {
      const abs = absoluteVariant(variant.url, masterUrl);
      if (!abs || seen.has(abs)) return;
      seen.add(abs);
      ordered.push(variant);
    }
    if (knownUrl) {
      const known = variants.find((variant) => absoluteVariant(variant.url, masterUrl) === knownUrl);
      if (known) enqueue(known);
    }
    if (variants[0]) enqueue(variants[0]);
    for (const variant of variants) enqueue(variant);

    let sawPlaylist = false;
    for (const variant of ordered) {
      const variantUrl = absoluteVariant(variant.url, masterUrl);
      let body = "";
      if (knownBody && knownUrl && variantUrl === knownUrl) body = knownBody;
      else {
        try {
          const response = await env.fetch(variantUrl);
          if (!response.ok) continue;
          body = await response.text();
        } catch {
          continue;
        }
      }
      if (!body.startsWith("#EXTM3U")) continue;
      sawPlaylist = true;
      if (playlist.hasAdBreak(body)) return true;
      return false;
    }
    return sawPlaylist ? false : null;
  }

  async function backupMaster(masterUrl, liveText, knownUrl, knownBody) {
    const channel = playlist.channelFromPlaylistUrl(masterUrl);
    if (!channel) return null;
    let session = ensureSession(channel);
    while (session.inflight) {
      await session.inflight;
      session = sessions.get(channel) || ensureSession(channel);
    }
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    session.inflight = gate;
    try {
      return await runBackup(session, channel, masterUrl, liveText, knownUrl, knownBody);
    } finally {
      release();
      if (session.inflight === gate) session.inflight = null;
    }
  }

  async function runBackup(session, channel, masterUrl, liveText, knownUrl, knownBody) {
    rememberMain(session, channel, masterUrl, liveText);
    if (session.movingOffBackup) {
      if (!session.usingBackup) env.status(false);
      return null;
    }
    const ads = await sampleHasAds(liveText, masterUrl, knownUrl, knownBody);
    if (ads === false) {
      leaveBackup(session);
      if (sessionIsFinished(session)) dropSession(channel);
      return null;
    }
    if (ads === null) {
      if (!session.usingBackup) env.status(false);
      if (session.usingBackup && session.served) indexStreamUrls(channel, session.served, masterUrl, true);
      return session.usingBackup ? session.served : null;
    }

    if (session.usingBackup && session.served && Date.now() < session.retryAt) {
      indexStreamUrls(channel, session.served, masterUrl, true);
      return session.served;
    }
    if (session.tried.size >= backupTypes.length) {
      if (Date.now() < session.retryAt) return session.served || null;
      session.tried.clear();
    }

    const best = await findCleanBackup(session, channel, masterUrl, liveText);
    if (best) {
      session.served = playlist.mapVariantsToBackup(liveText, best.master, best.href);
      session.usingBackup = true;
      session.retryAt = Date.now() + 30000;
      session.tried.clear();
      indexStreamUrls(channel, session.served, best.href, true);
      return session.served;
    }

    session.retryAt = Date.now() + 30000;
    return session.served || null;
  }

  async function probeBackupType(channel, masterUrl, liveText, playerType) {
    try {
      const token = await playbackToken(channel, playerType);
      if (!token) return null;
      const url = new URL(masterUrl);
      url.searchParams.set("sig", token.signature);
      url.searchParams.set("token", token.value);
      url.searchParams.delete("parent_domains");
      const response = await env.fetch(url.href);
      if (!response.ok) return null;
      const master = await response.text();
      const probe = await sampleHasAds(master, url.href);
      if (probe === null || probe === true) return null;
      return {
        playerType,
        master,
        href: url.href,
        score: backupMatchScore(liveText, master),
      };
    } catch (error) {
      console.log("twitch-adblock backup failed", playerType, error);
      return null;
    }
  }

  async function findCleanBackup(session, channel, masterUrl, liveText) {
    const pending = backupTypes.filter((playerType) => !session.tried.has(playerType));
    for (const playerType of pending) session.tried.add(playerType);
    if (!pending.length) return null;

    return await new Promise((resolve) => {
      const clean = [];
      let remaining = pending.length;
      let graceTimer = null;
      let done = false;
      function finish() {
        if (done) return;
        done = true;
        if (graceTimer != null) clearTimeout(graceTimer);
        resolve(pickBestBackup(clean));
      }
      function onResult(result) {
        remaining -= 1;
        if (result) {
          clean.push(result);
          if (graceTimer == null && handoffGraceMs > 0) {
            graceTimer = setTimeout(finish, handoffGraceMs);
          } else if (handoffGraceMs <= 0) {
            finish();
          }
        }
        if (remaining === 0) finish();
      }
      for (const playerType of pending) {
        probeBackupType(channel, masterUrl, liveText, playerType).then(onResult, () => onResult(null));
      }
    });
  }

  async function backupMedia(url, text) {
    const channel = streamByUrl.get(url);
    if (!channel) return null;
    const session = sessions.get(channel);
    if (!session || !session.masterUrl || !session.liveMaster) return null;
    session.seenAt = Date.now();
    if (session.backupUrls.has(url)) {
      await maybeReturnToMain(session);
      return session.usingBackup ? text : null;
    }
    if (session.movingOffBackup) return null;
    if (!playlist.hasAdBreak(text)) return null;
    const mapped = await backupMaster(session.masterUrl, session.liveMaster, url, text);
    if (!mapped || !session.usingBackup) return null;
    const picked = playlist.pickVariant(mapped, session.variants.get(url) || null);
    if (!picked) return null;
    const body = await fetchPlaylist(absoluteVariant(picked, session.masterUrl));
    if (body == null || playlist.hasAdBreak(body)) return null;
    if (!session.reloadedForBackup) {
      session.reloadedForBackup = true;
      // Let the clean media response reach the player before forcing a src refresh.
      scheduleReload();
    }
    return body;
  }

  async function handlePlaylist(url, init) {
    const response = await env.fetch(url, init);
    if (!response.ok) return response;
    const text = await response.text();
    if (!text.startsWith("#EXTM3U")) {
      return textResponse(text, response.headers.get("content-type") || "text/plain");
    }
    try {
      if (playlist.channelFromPlaylistUrl(url) && playlist.isMasterPlaylist(text)) {
        const channel = playlist.channelFromPlaylistUrl(url);
        // Same reset point as video-swap-new after encodings m3u8: handoff complete.
        const existing = channel ? sessions.get(channel) : null;
        if (existing) existing.movingOffBackup = false;
        const replacement = await backupMaster(url, text);
        const timed = playlist.writeServerTime(replacement || text, playlist.readServerTime(text));
        const session = channel ? sessions.get(channel) : null;
        if (session) env.status(Boolean(session.usingBackup));
        return textResponse(playlist.stripAds(timed).text);
      }
      const swapped = await backupMedia(url, text);
      const stripped = playlist.stripAds(swapped || text);
      if (stripped.adUrls.length) rememberBlocked(stripped.adUrls);
      // Gold banner is !!BackupEncodings — only while we are on a backup stream.
      const channel = streamByUrl.get(url);
      const session = channel ? sessions.get(channel) : null;
      env.status(Boolean(session && session.usingBackup));
      return textResponse(stripped.text);
    } catch (error) {
      console.log("twitch-adblock playlist failed", error);
      return textResponse(text);
    }
  }

  return async function guardedFetch(input, init) {
    const raw = requestUrl(input);
    if (!raw) return env.fetch(input, init);
    const url = canonical(raw);
    if (blockedSegments.has(url)) {
      return new Response(playlist.blankSegmentBytes(), {
        status: 200,
        headers: { "Content-Type": "video/mp2t" },
      });
    }
    if (!playlist.isLivePlaylistUrl(url) && !streamByUrl.has(url)) return env.fetch(input, init);
    if (url.includes("/channel/hls/")) {
      const parentless = new URL(url);
      parentless.searchParams.delete("parent_domains");
      return handlePlaylist(parentless.href, init);
    }
    return handlePlaylist(url, init);
  };
}
