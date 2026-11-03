// Signed threat feed: where it lives. EMPTY = dormant (no feed host chosen
// yet, decision D-1). The feed client refuses to run unless ALL of these hold:
//   1. FEED_ORIGIN is set (an https origin, no path, e.g. "https://feed.<your domain>")
//   2. src/feed/keys.js FEED_KEYS holds at least one public key
//   3. manifest.json host_permissions contains FEED_ORIGIN + "/*"
// Steps: docs/feed-setup.md. Do not invent a domain here.
(function (root) {
  const FEED_ORIGIN = "";
  const FEED_PATH = "/feed.json";
  const SIG_PATH = "/feed.json.sig";
  root.GeckoFeedConfig = Object.freeze({ FEED_ORIGIN, FEED_PATH, SIG_PATH });
})(typeof self !== "undefined" ? self : globalThis);
