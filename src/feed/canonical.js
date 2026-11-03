// Signed threat feed: the exact bytes and the signature file. Pure code, no
// chrome.* and no network. Classic script (sets a global) because the service
// worker is a classic worker that loads it with importScripts; tests import it.
//
// The feed is two files:
//   feed.json      UTF-8, no BOM, at most 512 KB. The signature covers these
//                  EXACT bytes (no JSON canonicalisation, nothing re-encoded).
//   feed.json.sig  line 1 "keyId=<id>", line 2 the base64 Ed25519 signature.
(function (root) {
  const MAX_FEED_BYTES = 512 * 1024;
  const MAX_SIG_BYTES = 1024;
  const KEY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

  function base64ToBytes(b64) {
    const s = String(b64 || "").trim();
    if (!s || s.length % 4 !== 0 || !B64_RE.test(s)) throw new Error("bad base64");
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    throw new Error("feed bytes must be a Uint8Array or ArrayBuffer");
  }

  // Size, BOM and UTF-8 checks on the raw bytes. Returns the bytes.
  function checkFeedBytes(input) {
    const bytes = toBytes(input);
    if (bytes.length === 0) throw new Error("empty feed");
    if (bytes.length > MAX_FEED_BYTES) throw new Error("feed larger than 512 KB (" + bytes.length + " bytes)");
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new Error("feed starts with a BOM");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("feed is not valid UTF-8");
    }
    return bytes;
  }

  // "keyId=<id>\n<base64>\n" -> { keyId, signature: Uint8Array(64) }
  function parseSigFile(text) {
    const raw = String(text == null ? "" : text);
    if (raw.length > MAX_SIG_BYTES) throw new Error("signature file too large");
    const lines = raw.replace(/\r\n/g, "\n").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length !== 2) throw new Error("signature file must have exactly two lines");
    const m = /^keyId=(.+)$/.exec(lines[0]);
    if (!m || !KEY_ID_RE.test(m[1])) throw new Error("bad keyId line");
    const signature = base64ToBytes(lines[1]);
    if (signature.length !== 64) throw new Error("Ed25519 signature must be 64 bytes");
    return { keyId: m[1], signature };
  }

  function formatSigFile(keyId, signature) {
    if (!KEY_ID_RE.test(keyId)) throw new Error("bad keyId");
    return "keyId=" + keyId + "\n" + bytesToBase64(toBytes(signature)) + "\n";
  }

  root.GeckoFeedCanonical = Object.freeze({
    MAX_FEED_BYTES, MAX_SIG_BYTES, KEY_ID_RE,
    base64ToBytes, bytesToBase64, checkFeedBytes, parseSigFile, formatSigFile,
  });
})(typeof self !== "undefined" ? self : globalThis);
