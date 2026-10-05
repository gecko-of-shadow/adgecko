// Playlist helpers for live Twitch HLS. Loaded as a classic script before page.js.
function installTwitchAdblockPlaylist(target) {
  function linesOf(text) {
    return String(text || "").replaceAll("\r", "").split("\n");
  }

  function parseAttributes(header) {
    const body = String(header || "");
    const attrs = {};
    const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    let match = pattern.exec(body);
    while (match) {
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      attrs[match[1]] = value;
      match = pattern.exec(body);
    }
    return attrs;
  }

  function hasStitchedAd(text) {
    const source = String(text || "");
    return source.includes("stitched-ad")
      || source.includes("twitch-stitched")
      || source.includes("twitch-maf-ad")
      || source.includes('CLASS="twitch-trigger"')
      || source.includes("#EXT-X-CUE-OUT");
  }

  function isMidroll(text) {
    return /"midroll"/i.test(String(text || ""));
  }

  function isMasterPlaylist(text) {
    return String(text || "").includes("#EXT-X-STREAM-INF");
  }

  function isLivePlaylistUrl(url) {
    const value = String(url || "");
    if (value.includes("/vod/")) return false;
    return value.includes(".m3u8") || value.includes("/playlist/") || value.includes("/channel/hls/");
  }

  function channelFromPlaylistUrl(url) {
    try {
      const path = new URL(url, "https://usher.ttvnw.net").pathname;
      const match = path.match(/\/channel\/hls\/([^/]+)\.m3u8$/i);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function readServerTime(text) {
    const source = String(text || "");
    const session = source.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
    if (session) return session[1];
    const legacy = source.match(/SERVER-TIME="([0-9.]+)"/);
    return legacy ? legacy[1] : null;
  }

  function writeServerTime(text, time) {
    const source = String(text || "");
    if (!time) return source;
    if (source.includes('DATA-ID="SERVER-TIME"')) {
      return source.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${time}$2`);
    }
    return source.replace(/(SERVER-TIME=")[0-9.]+(")/, `$1${time}$2`);
  }

  function listVariants(text) {
    const lines = linesOf(text);
    const variants = [];
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const url = lines[i + 1].trim();
      if (!url || url.startsWith("#")) continue;
      const attrs = parseAttributes(lines[i]);
      variants.push({
        resolution: attrs.RESOLUTION || "",
        frameRate: attrs["FRAME-RATE"] || "",
        codecs: attrs.CODECS || "",
        url,
      });
    }
    return variants;
  }

  function partsOf(resolution) {
    const parts = String(resolution).split("x").map(Number);
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return [0, 0];
    return parts;
  }

  function area(resolution) {
    const [width, heightValue] = partsOf(resolution);
    return width * heightValue;
  }

  function height(resolution) {
    return partsOf(resolution)[1];
  }

  function pickVariant(text, wanted) {
    const variants = listVariants(text);
    if (!variants.length) return null;
    if (!wanted || !wanted.resolution) return variants[0].url;
    let exact = null;
    let exactRate = false;
    let closest = variants[0];
    let closestHeight = Infinity;
    const wantedHeight = height(wanted.resolution);
    for (const variant of variants) {
      if (variant.resolution === wanted.resolution) {
        const rateMatches = Boolean(wanted.frameRate) && variant.frameRate === String(wanted.frameRate);
        if (!exact || (rateMatches && !exactRate)) {
          exact = variant;
          exactRate = rateMatches;
        }
      }
      const heightGap = Math.abs(height(variant.resolution) - wantedHeight);
      if (heightGap < closestHeight || (heightGap === closestHeight && area(variant.resolution) > area(closest.resolution))) {
        closest = variant;
        closestHeight = heightGap;
      }
    }
    return (exact || closest).url;
  }

  function mapVariantsToBackup(mainText, backupText, backupBase) {
    const lines = linesOf(mainText);
    const backupVariants = listVariants(backupText);
    if (!backupVariants.length) return String(mainText || "");
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
      const current = lines[i + 1].trim();
      if (!current || current.startsWith("#")) continue;
      const attrs = parseAttributes(lines[i]);
      const backupUrl = pickVariant(backupText, {
        resolution: attrs.RESOLUTION,
        frameRate: attrs["FRAME-RATE"],
      });
      if (!backupUrl) continue;
      const backupVariant = backupVariants.find((item) => item.url === backupUrl);
      if (backupVariant && attrs.CODECS && backupVariant.codecs && attrs.CODECS.slice(0, 3) !== backupVariant.codecs.slice(0, 3)) {
        lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${backupVariant.codecs}"`);
      }
      let resolved = backupUrl;
      if (backupBase) {
        try {
          resolved = new URL(backupUrl, backupBase).href;
        } catch {
          resolved = backupUrl;
        }
      }
      lines[i + 1] = `${resolved}#tab${i + 1}`;
    }
    return lines.join("\n");
  }

  function isAdInf(line) {
    return line.startsWith("#EXTINF") && (!line.includes(",live") || line.includes("Amazon"));
  }

  function isAdSegmentUrl(url) {
    return url.includes("/adsquared/") || url.includes("/_404/") || url.includes("/processing/");
  }

  function stripAds(text) {
    const lines = linesOf(text);
    const marked = lines.some((line, index) => {
      if (hasStitchedAd(line) || (line.startsWith("#EXTINF") && line.includes("Amazon"))) return true;
      const next = lines[index + 1] || "";
      return line.startsWith("#EXTINF") && isAdSegmentUrl(next);
    });
    if (!marked) return { text: lines.join("\n"), adUrls: [], stripped: false };

    let anchor = "";
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXTINF") || !lines[i].includes(",live") || lines[i].includes("Amazon")) continue;
      if (!lines[i + 1] || lines[i + 1].startsWith("#")) continue;
      if (isAdSegmentUrl(lines[i + 1].trim())) continue;
      anchor = lines[i + 1].trim();
      break;
    }

    const adUrls = [];
    const kept = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
        .replaceAll(/(X-TV-TWITCH-AD-URL=")[^"]*(")/g, "$1https://twitch.tv$2")
        .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")/g, "$1https://twitch.tv$2");
      if (line.startsWith("#EXT-X-TWITCH-PREFETCH:")) continue;
      if (line.startsWith("#") && hasStitchedAd(line)) continue;
      const nextUrl = lines[i + 1] && !lines[i + 1].startsWith("#") ? lines[i + 1].trim() : "";
      const adSegment = line.startsWith("#EXTINF") && Boolean(nextUrl) && (isAdInf(line) || isAdSegmentUrl(nextUrl));
      if (adSegment) {
        const duration = line.slice("#EXTINF:".length).split(",")[0];
        const adUrl = nextUrl;
        kept.push(`#EXTINF:${duration},live`);
        if (anchor) {
          kept.push(anchor);
        } else {
          kept.push(adUrl);
          adUrls.push(adUrl);
        }
        i += 1;
        continue;
      }
      kept.push(line);
    }
    return { text: kept.join("\n"), adUrls, stripped: true };
  }

  function blankSegmentBytes() {
    const packet = new Uint8Array(188);
    packet[0] = 0x47;
    packet[1] = 0x1f;
    packet[2] = 0xff;
    packet[3] = 0x10;
    const packets = new Uint8Array(188 * 8);
    for (let i = 0; i < 8; i++) packets.set(packet, i * 188);
    return packets;
  }

  Object.assign(target, {
    parseAttributes,
    hasStitchedAd,
    isMidroll,
    isMasterPlaylist,
    isLivePlaylistUrl,
    channelFromPlaylistUrl,
    readServerTime,
    writeServerTime,
    listVariants,
    pickVariant,
    mapVariantsToBackup,
    stripAds,
    blankSegmentBytes,
  });
}

installTwitchAdblockPlaylist(globalThis.TwitchAdblockPlaylist = globalThis.TwitchAdblockPlaylist || {});
