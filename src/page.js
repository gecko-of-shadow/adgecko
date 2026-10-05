// Runs in the page at document_start and swaps stitched Twitch ads for another player stream.
(function () {
  if (globalThis.__twitchAdblockInstalled) return;
  globalThis.__twitchAdblockInstalled = true;

  const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
  const FORCED_PLAYER_TYPE = "popout";
  let deviceId = readCookie("unique_id");
  let clientIntegrity = "";
  let authorization = "";

  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get() {
        return "visible";
      },
    });
  } catch {
    // Leave the page's own visibility state in place when it cannot be redefined.
  }

  const nativeFetch = window.fetch.bind(window);
  const guard = createPlaylistGuard({
    fetch: nativeFetch,
    gql: pageGql,
    reload: reloadPlayer,
    status: setNotice,
  });

  window.fetch = function (input, init) {
    const request = rewritePlaybackRequest(input, init);
    return guard(request.input, request.init).catch((error) => {
      console.log("twitch-adblock failed open", error);
      return nativeFetch(input, init);
    });
  };

  const NativeWorker = window.Worker;
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
    const blobUrl = URL.createObjectURL(new Blob([workerPrelude() + "\n" + source], { type: "text/javascript" }));
    const worker = new NativeWorker(blobUrl, options);
    worker.addEventListener("message", onWorkerMessage, true);
    return worker;
  }
  TwitchAdblockWorker.prototype = NativeWorker.prototype;
  window.Worker = TwitchAdblockWorker;

  console.log("twitch-adblock: watching Twitch");

  function workerPrelude() {
    return [
      installTwitchAdblockPlaylist.toString(),
      "installTwitchAdblockPlaylist(globalThis.TwitchAdblockPlaylist = {});",
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
      "X-Twitch-Adblock": "1",
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

  function rewritePlaybackRequest(input, init) {
    captureHeaders(init);
    const url = requestUrl(input);
    if (!init || typeof init.body !== "string" || !url.includes("gql") || !init.body.includes("PlaybackAccessToken")) {
      return { input, init };
    }
    if (headerValue(init.headers, "X-Twitch-Adblock")) return { input, init };
    try {
      const parsed = JSON.parse(init.body);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      let changed = false;
      for (const item of items) {
        const name = item && item.operationName ? item.operationName : "";
        if (!item || !item.variables || !name.includes("PlaybackAccessToken") || name.includes("Prefetch")) continue;
        if (item.variables.playerType && item.variables.playerType !== FORCED_PLAYER_TYPE) {
          item.variables.playerType = FORCED_PLAYER_TYPE;
          changed = true;
        }
      }
      if (!changed) return { input, init };
      console.log("twitch-adblock: using the popout player token");
      return { input, init: Object.assign({}, init, { body: JSON.stringify(parsed) }) };
    } catch {
      return { input, init };
    }
  }

  function captureHeaders(init) {
    if (!init || !init.headers) return;
    const foundDevice = headerValue(init.headers, "X-Device-Id") || headerValue(init.headers, "Device-ID");
    const foundIntegrity = headerValue(init.headers, "Client-Integrity");
    const foundAuthorization = headerValue(init.headers, "Authorization");
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
    if (typeof found.player.isPaused === "function" && found.player.isPaused()) return;
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
    }, 3000);
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

  function setNotice(blocking) {
    const existing = document.getElementById("twitch-adblock-notice");
    if (!blocking) {
      if (existing) existing.remove();
      return;
    }
    const player = document.querySelector(".video-player");
    if (!player) return;
    const notice = existing || document.createElement("div");
    notice.id = "twitch-adblock-notice";
    notice.textContent = "Blocking ads";
    notice.style.cssText = "position:absolute;top:8px;left:8px;z-index:20;color:#fff;background:rgba(0,0,0,.75);padding:4px 8px;font:12px/1.2 sans-serif;pointer-events:none;";
    if (notice.parentElement !== player) player.appendChild(notice);
  }
})();

function startTwitchAdblockWorker() {
  const pending = new Map();
  self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "twitch-adblock" || data.type !== "gql-result") return;
    event.stopImmediatePropagation();
    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    if (data.ok) waiter.resolve(data.text);
    else waiter.reject(new Error(data.error || "gql failed"));
  });

  const nativeFetch = fetch;
  const guard = createPlaylistGuard({
    fetch: nativeFetch.bind(self),
    gql(body) {
      const id = Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
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
  self.fetch = function (input, init) {
    return guard(input, init).catch((error) => {
      console.log("twitch-adblock failed open", error);
      return nativeFetch(input, init);
    });
  };
}

function createPlaylistGuard(env) {
  const playlist = globalThis.TwitchAdblockPlaylist;
  const sessions = new Map();
  const blockedSegments = new Map();
  const backupTypes = ["mobile_web", "embed"];
  const playbackHash = "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";
  const playbackQuery = "query PlaybackAccessToken($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) { value signature __typename } }";

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
    const token = json && json.data && json.data.streamPlaybackAccessToken;
    if (!token || !token.value || !token.signature) return null;
    return token;
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

  async function sampleHasAds(masterText, masterUrl) {
    if (playlist.hasStitchedAd(masterText)) return true;
    const sample = playlist.pickVariant(masterText, null);
    if (!sample) return false;
    const response = await env.fetch(new URL(sample, masterUrl).href);
    if (!response.ok) return false;
    return playlist.hasStitchedAd(await response.text());
  }

  async function backupMaster(masterUrl, liveText) {
    const channel = playlist.channelFromPlaylistUrl(masterUrl);
    if (!channel) return null;
    let session = sessions.get(channel);
    if (!session) {
      session = { tried: new Set(), retryAt: 0, usingBackup: false, served: "" };
      sessions.set(channel, session);
    }

    const ads = await sampleHasAds(liveText, masterUrl);
    if (!ads) {
      if (session.usingBackup) env.reload();
      session.usingBackup = false;
      session.served = "";
      session.tried.clear();
      env.status(false);
      return null;
    }

    env.status(true);
    if (session.usingBackup && session.served && Date.now() < session.retryAt) return session.served;
    if (session.tried.size >= backupTypes.length) {
      if (Date.now() < session.retryAt) return session.served || null;
      session.tried.clear();
    }

    for (const playerType of backupTypes) {
      if (session.tried.has(playerType)) continue;
      session.tried.add(playerType);
      try {
        const token = await playbackToken(channel, playerType);
        if (!token) continue;
        const url = new URL(masterUrl);
        url.searchParams.set("sig", token.signature);
        url.searchParams.set("token", token.value);
        url.searchParams.delete("parent_domains");
        const response = await env.fetch(url.href);
        if (!response.ok) continue;
        const master = await response.text();
        const clean = !(await sampleHasAds(master, url.href));
        if (!clean && playerType !== backupTypes[backupTypes.length - 1]) continue;
        session.served = playlist.mapVariantsToBackup(liveText, master, url.href);
        session.usingBackup = true;
        session.retryAt = Date.now() + 30000;
        return session.served;
      } catch (error) {
        console.log("twitch-adblock backup failed", playerType, error);
      }
    }

    session.retryAt = Date.now() + 30000;
    return session.served || null;
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
        const replacement = await backupMaster(url, text);
        const timed = playlist.writeServerTime(replacement || text, playlist.readServerTime(text));
        return textResponse(playlist.stripAds(timed).text);
      }
      const stripped = playlist.stripAds(text);
      if (stripped.adUrls.length) rememberBlocked(stripped.adUrls);
      if (stripped.stripped) env.status(true);
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
    if (!playlist.isLivePlaylistUrl(url)) return env.fetch(input, init);
    if (url.includes("/channel/hls/")) {
      const parentless = new URL(url);
      parentless.searchParams.delete("parent_domains");
      return handlePlaylist(parentless.href, init);
    }
    return handlePlaylist(url, init);
  };
}
