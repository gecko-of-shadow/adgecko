// Pinned public keys for the signed threat feed. EMPTY until the owner adds the
// production public key (see docs/feed-setup.md). While FEED_KEYS is empty the
// feed client stays dormant.
//
// Format: { "<keyId>": "<base64 of the 32-byte raw Ed25519 public key>" }
// FEED_KEYS sign feed.json documents. KILL_KEYS are a SEPARATE key pair that
// may sign only the kill document {format:1, kill:true, serial, createdAt}.
// A key id must not appear in both. Never put a private key in this repo.
(function (root) {
  const FEED_KEYS = Object.freeze({});
  const KILL_KEYS = Object.freeze({});
  root.GeckoFeedKeys = Object.freeze({ FEED_KEYS, KILL_KEYS });
})(typeof self !== "undefined" ? self : globalThis);
