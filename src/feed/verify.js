// Signed threat feed: signature verification, then parse, then schema.
// Pure code, no chrome.* and no network. Ed25519 via WebCrypto
// (crypto.subtle importKey "raw" + verify), Chrome 137+.
//
// Order is fixed: size/BOM/UTF-8 checks on the raw bytes -> parse the .sig
// file -> look up the pinned key by keyId -> crypto.subtle.verify over the
// EXACT bytes -> only then JSON.parse -> strict schema. A feed key can sign only
// feed documents; a kill key only the kill document. Nothing from an unverified
// body is parsed, logged or returned.
(function (root) {
  const C = () => root.GeckoFeedCanonical;
  const S = () => root.GeckoFeedSchema;

  async function importPublicKey(b64) {
    const raw = C().base64ToBytes(b64);
    if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
    return crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
  }

  // -> { keyId, role: "feed" | "kill" } after a good signature, else throws.
  async function verifySignature(feedBytes, sigText, keys) {
    const bytes = C().checkFeedBytes(feedBytes);
    const { keyId, signature } = C().parseSigFile(sigText);
    const feedKeys = (keys && keys.feedKeys) || {};
    const killKeys = (keys && keys.killKeys) || {};
    const inFeed = Object.prototype.hasOwnProperty.call(feedKeys, keyId);
    const inKill = Object.prototype.hasOwnProperty.call(killKeys, keyId);
    if (inFeed && inKill) throw new Error("key id " + keyId + " is pinned as both feed and kill key");
    if (!inFeed && !inKill) throw new Error("unknown key id " + keyId);
    const key = await importPublicKey(inFeed ? feedKeys[keyId] : killKeys[keyId]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, signature, bytes);
    if (!ok) throw new Error("bad signature");
    return { keyId, role: inFeed ? "feed" : "kill" };
  }

  // feedBytes: Uint8Array of feed.json; sigText: contents of feed.json.sig.
  // opts: { feedKeys, killKeys, now, storedSerial, storedKillSerial,
  //         extensionVersion, protectedReason }
  // -> { ok: true, kind: "feed" | "kill", keyId, doc } or { ok: false, error }
  async function verifyFeed(feedBytes, sigText, opts) {
    const o = opts || {};
    try {
      const { keyId, role } = await verifySignature(feedBytes, sigText, o);
      let doc;
      try {
        doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(C().checkFeedBytes(feedBytes)));
      } catch {
        throw new Error("signed feed is not valid JSON");
      }
      if (role === "kill") {
        return { ok: true, kind: "kill", keyId, doc: S().validateKill(doc, { storedKillSerial: o.storedKillSerial }) };
      }
      if (doc && typeof doc === "object" && "kill" in doc) throw new Error("a kill document must be signed by a kill key");
      const valid = S().validateFeed(doc, {
        now: o.now, storedSerial: o.storedSerial, extensionVersion: o.extensionVersion, protectedReason: o.protectedReason,
      });
      return { ok: true, kind: "feed", keyId, doc: valid };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  root.GeckoFeedVerify = Object.freeze({ importPublicKey, verifySignature, verifyFeed });
})(typeof self !== "undefined" ? self : globalThis);
