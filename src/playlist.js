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

  // Twitch "maf" breaks are one DATERANGE on a playlist whose segments stay live; the
  // player draws the ad itself. Only that line goes: segments and numbering stay, and
  // it is never an ad break, so it cannot start a backup swap or a reload.
  function removeMafAds(text) {
    const source = String(text || "");
    if (!source.includes("twitch-maf-ad")) return { text: source, removed: 0 };
    let removed = 0;
    const kept = source.split("\n").filter((line) => {
      if (!line.startsWith("#EXT-X-DATERANGE:") || !line.includes('CLASS="twitch-maf-ad"')) return true;
      removed += 1;
      return false;
    });
    return { text: kept.join("\n"), removed };
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
    let parsed;
    try {
      parsed = new URL(value, "https://usher.ttvnw.net");
    } catch {
      return false;
    }
    const host = parsed.hostname;
    if (host !== "usher.ttvnw.net" && !host.endsWith(".ttvnw.net")) return false;
    const path = parsed.pathname;
    return path.includes("/channel/hls/") || path.includes("/playlist/") || path.endsWith(".m3u8");
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
        video: attrs.VIDEO || "",
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
    if (!wanted) return variants[0].url;
    if (!wanted.resolution) {
      if (wanted.video) {
        const named = variants.find((variant) => variant.video === wanted.video);
        if (named) return named.url;
      }
      const unresolved = variants.find((variant) => !variant.resolution);
      return unresolved ? unresolved.url : null;
    }
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
        video: attrs.VIDEO,
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

  function adWindows(lines) {
    const windows = [];
    for (const line of lines) {
      if (!line.startsWith("#EXT-X-DATERANGE:") || !hasStitchedAd(line)) continue;
      const attrs = parseAttributes(line);
      const start = Date.parse(attrs["START-DATE"] || "");
      if (!Number.isFinite(start)) continue;
      let end = Date.parse(attrs["END-DATE"] || "");
      if (!Number.isFinite(end)) {
        const duration = Number(attrs.DURATION);
        if (Number.isFinite(duration) && duration > 0) end = start + Math.round(duration * 1000);
      }
      if (!Number.isFinite(end) || end <= start) continue;
      windows.push([start, end]);
    }
    return windows;
  }

  function segmentTimes(lines) {
    const times = new Map();
    let cursor = NaN;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
        const parsed = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length).trim());
        if (Number.isFinite(parsed)) cursor = parsed;
        continue;
      }
      if (!line.startsWith("#EXTINF")) continue;
      const next = (lines[i + 1] || "").trim();
      if (!next || next.startsWith("#")) continue;
      if (Number.isFinite(cursor)) times.set(i, cursor);
      const duration = Number(line.slice("#EXTINF:".length).split(",")[0]);
      if (Number.isFinite(cursor) && Number.isFinite(duration)) cursor += Math.round(duration * 1000);
    }
    return times;
  }

  function inAdWindow(time, windows) {
    return windows.some(([start, end]) => time >= start && time < end);
  }

  // A stitched range that starts after the newest listed segment is a break that
  // has only reached the prefetch lines. video-swap-new reacts to the ad tag itself.
  const upcomingHorizonMs = 10000;
  function hasUpcomingAd(windows, times) {
    let newest = NaN;
    for (const time of times.values()) {
      if (!Number.isFinite(newest) || time > newest) newest = time;
    }
    if (!Number.isFinite(newest)) return false;
    return windows.some(([start]) => start > newest && start - newest <= upcomingHorizonMs);
  }

  function isAdSegmentLine(lines, index, windows, times) {
    const line = lines[index];
    if (!line || !line.startsWith("#EXTINF")) return false;
    const next = (lines[index + 1] || "").trim();
    if (!next || next.startsWith("#")) return false;
    if (isAdInf(line) || isAdSegmentUrl(next)) return true;
    const time = times.get(index);
    return Number.isFinite(time) && inAdWindow(time, windows);
  }

  function hasAdBreak(text) {
    const lines = linesOf(text);
    const windows = adWindows(lines);
    const times = segmentTimes(lines);
    for (let i = 0; i < lines.length - 1; i++) {
      if (isAdSegmentLine(lines, i, windows, times)) return true;
    }
    return hasUpcomingAd(windows, times);
  }

  function mediaSequence(lines) {
    const line = lines.find((item) => item.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
    if (!line) return 0;
    const value = Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length).trim());
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }

  function createStripLedger() {
    return { dropped: new Set(), base: 0, first: NaN, passing: false };
  }

  function droppedBelow(book, sequence) {
    let count = book.base;
    for (const value of book.dropped) {
      if (value < sequence) count += 1;
    }
    return count;
  }

  // A window this many segments behind the newest one (a stale edge, another
  // rendition) is read through the ledger; a bigger jump back is a new stream.
  const staleWindow = 15;

  // Drop ad slots that live video follows, and renumber through a ledger kept
  // across refreshes so no live segment is listed twice or replayed. A break at the
  // live edge passes through unmodified until it ends: dropping it starves the player.
  // readOnly applies earlier drops and numbering without dropping anything new.
  function stripAds(text, ledger, readOnly) {
    const lines = linesOf(text);
    const unchanged = lines.join("\n");
    const numbered = lines.some((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
    const book = numbered && ledger && ledger.dropped instanceof Set ? ledger : createStripLedger();
    const windows = adWindows(lines);
    const times = segmentTimes(lines);
    const firstSequence = mediaSequence(lines);
    let frozen = readOnly === true;
    if (Number.isFinite(book.first) && firstSequence < book.first) {
      if (book.first - firstSequence > staleWindow) {
        if (frozen) return { text: unchanged, adUrls: [], stripped: false, passed: false };
        book.dropped.clear();
        book.base = 0;
        book.passing = false;
        book.first = NaN;
      } else {
        frozen = true;
      }
    }
    if (!frozen) {
      book.first = firstSequence;
      for (const value of [...book.dropped]) {
        if (value >= firstSequence - staleWindow) continue;
        book.dropped.delete(value);
        book.base += 1;
      }
    }

    const segments = [];
    for (let i = 0; i < lines.length - 1; i++) {
      if (!lines[i].startsWith("#EXTINF")) continue;
      const next = lines[i + 1].trim();
      if (!next || next.startsWith("#")) continue;
      const sequence = firstSequence + segments.length;
      segments.push({ index: i, sequence, ad: book.dropped.has(sequence) || isAdSegmentLine(lines, i, windows, times) });
    }
    const upcoming = hasUpcomingAd(windows, times);
    const anyAd = upcoming || segments.some((segment) => segment.ad);
    if (!anyAd && !frozen) book.passing = false;
    const lastLive = segments.reduce((last, segment) => (segment.ad ? last : segment.index), -1);
    const fresh = segments.filter((segment) => segment.ad && !book.dropped.has(segment.sequence));
    const dropNow = frozen || book.passing || upcoming ? [] : fresh.filter((segment) => segment.index < lastLive);
    for (const segment of dropNow) book.dropped.add(segment.sequence);
    const passedAds = fresh.filter((segment) => !book.dropped.has(segment.sequence));
    if ((passedAds.length || upcoming) && !frozen) book.passing = true;

    const dropped = new Set(segments.filter((segment) => book.dropped.has(segment.sequence)).map((segment) => segment.index));
    const firstKept = segments.find((segment) => !dropped.has(segment.index));
    const outSequence = firstKept ? firstKept.sequence - droppedBelow(book, firstKept.sequence) : firstSequence - book.base;
    // Ad markers stay while any ad still plays so Twitch's ad UI can finish cleanly.
    const cleanMarkers = dropped.size > 0 && !passedAds.length && !upcoming;
    const passed = anyAd && (book.passing || passedAds.length > 0 || upcoming);
    if (!dropped.size && !cleanMarkers && outSequence === firstSequence) {
      return { text: unchanged, adUrls: [], stripped: false, passed };
    }

    const kept = [];
    let held = [];
    let carryBreak = false;
    let wroteSequence = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        kept.push(`#EXT-X-MEDIA-SEQUENCE:${outSequence}`);
        wroteSequence = true;
        continue;
      }
      if (cleanMarkers) {
        if (line.startsWith("#EXT-X-TWITCH-PREFETCH:")) continue;
        if (line.startsWith("#") && hasStitchedAd(line)) continue;
        line = line
          .replaceAll(/(X-TV-TWITCH-AD-URL=")[^"]*(")/g, "$1https://twitch.tv$2")
          .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")/g, "$1https://twitch.tv$2");
      }
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") || line.trim() === "#EXT-X-DISCONTINUITY") {
        held.push(line);
        continue;
      }
      if (dropped.has(i)) {
        // The live video after a dropped slot still starts a new timeline.
        if (held.some((tag) => tag.trim() === "#EXT-X-DISCONTINUITY")) carryBreak = true;
        held = [];
        i += 1;
        continue;
      }
      if (line.startsWith("#EXTINF")) {
        if (carryBreak && !held.some((tag) => tag.trim() === "#EXT-X-DISCONTINUITY")) kept.push("#EXT-X-DISCONTINUITY");
        carryBreak = false;
      }
      kept.push(...held, line);
      held = [];
    }
    kept.push(...held);
    if (!wroteSequence && outSequence !== firstSequence) kept.splice(1, 0, `#EXT-X-MEDIA-SEQUENCE:${outSequence}`);
    return { text: kept.join("\n"), adUrls: [], stripped: dropped.size > 0 || cleanMarkers, passed };
  }

  function mpegCrc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 24;
      for (let bit = 0; bit < 8; bit++) {
        if (crc & 0x80000000) crc = ((crc << 1) ^ 0x04c11db7) >>> 0;
        else crc = (crc << 1) >>> 0;
      }
    }
    return crc >>> 0;
  }

  function withCrc(section) {
    const crc = mpegCrc32(section);
    const full = new Uint8Array(section.length + 4);
    full.set(section);
    full[section.length] = (crc >>> 24) & 0xff;
    full[section.length + 1] = (crc >>> 16) & 0xff;
    full[section.length + 2] = (crc >>> 8) & 0xff;
    full[section.length + 3] = crc & 0xff;
    return full;
  }

  function sectionPacket(pid, section) {
    const packet = new Uint8Array(188);
    packet[0] = 0x47;
    packet[1] = 0x40 | ((pid >> 8) & 0x1f);
    packet[2] = pid & 0xff;
    packet[3] = 0x10;
    packet[4] = 0x00;
    packet.set(section, 5);
    packet.fill(0xff, 5 + section.length);
    return packet;
  }

  function firstAdSegmentUrl(text) {
    const lines = linesOf(text);
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (!line.startsWith("#EXTINF") || line.includes(",live")) continue;
      const next = lines[i + 1].trim();
      if (!next || next.startsWith("#")) continue;
      return next;
    }
    return "";
  }

  function blankSegmentBytes() {
    const pat = withCrc(Uint8Array.from([
      0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00,
    ]));
    const pmt = withCrc(Uint8Array.from([
      0x02, 0xb0, 0x12, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x01, 0xf0, 0x00, 0x1b, 0xe1, 0x01, 0xf0, 0x00,
    ]));
    const pes = Uint8Array.from([
      0x00, 0x00, 0x01, 0xe0, 0x00, 0x09, 0x80, 0x80, 0x05, 0x21, 0x00, 0x01, 0x00, 0x01, 0x00,
    ]);
    const video = new Uint8Array(188);
    video[0] = 0x47;
    video[1] = 0x41;
    video[2] = 0x01;
    video[3] = 0x30;
    const adaptationLength = 188 - 5 - pes.length;
    video[4] = adaptationLength;
    video[5] = 0x00;
    video.fill(0xff, 6, 5 + adaptationLength);
    video.set(pes, 5 + adaptationLength);
    const packets = new Uint8Array(188 * 3);
    packets.set(sectionPacket(0x0000, pat), 0);
    packets.set(sectionPacket(0x0100, pmt), 188);
    packets.set(video, 376);
    return packets;
  }

  Object.assign(target, {
    parseAttributes,
    hasStitchedAd,
    removeMafAds,
    hasAdBreak,
    isMidroll,
    isMasterPlaylist,
    isLivePlaylistUrl,
    channelFromPlaylistUrl,
    readServerTime,
    writeServerTime,
    listVariants,
    pickVariant,
    mapVariantsToBackup,
    createStripLedger,
    stripAds,
    firstAdSegmentUrl,
    blankSegmentBytes,
  });
}

installTwitchAdblockPlaylist(globalThis.TwitchAdblockPlaylist = globalThis.TwitchAdblockPlaylist || {});
