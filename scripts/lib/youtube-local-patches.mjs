// Local YouTube patches kept across scripts/sync-ubo-youtube.mjs.
// Upstream text is not edited here; the sync applies these after it builds.
import neverBlockCaptcha from "../../src/rules/never-block-captcha.json" with { type: "json" };

// uBO's /player prune drops adPlacements and adSlots and leaves playerAds.
// A 0.3.1 live watch then still had one playerAds entry in getPlayerResponse.
const PLAYER_PRUNE_PAIRS = [
  [
    'jsonPruneFetchResponse("adPlacements adSlots playerResponse.adPlacements playerResponse.adSlots [].playerResponse.adPlacements [].playerResponse.adSlots"',
    'jsonPruneFetchResponse("playerAds adPlacements adSlots playerResponse.playerAds playerResponse.adPlacements playerResponse.adSlots [].playerResponse.playerAds [].playerResponse.adPlacements [].playerResponse.adSlots"',
  ],
  [
    'jsonPruneXhrResponse("adPlacements adSlots playerResponse.adPlacements playerResponse.adSlots [].playerResponse.adPlacements [].playerResponse.adSlots"',
    'jsonPruneXhrResponse("playerAds adPlacements adSlots playerResponse.playerAds playerResponse.adPlacements playerResponse.adSlots [].playerResponse.playerAds [].playerResponse.adPlacements [].playerResponse.adSlots"',
  ],
];

export function ensurePlayerAdsPruned(source) {
  let out = String(source);
  let patched = 0;
  for (const [from, to] of PLAYER_PRUNE_PAIRS) {
    if (out.includes(to)) continue;
    if (!out.includes(from)) {
      throw new Error("ensurePlayerAdsPruned: player prune call changed shape; update scripts/lib/youtube-local-patches.mjs");
    }
    out = out.replace(from, to);
    patched += 1;
  }
  return { source: out, patched };
}

// The uBO *_ad_ media rule is a substring match. A made-up hCaptcha URL that
// contains _ad_ would match it. DNR excludedRequestDomains also covers subdomains.
// The ONE captcha list (src/rules/never-block-captcha.json); the packer, the
// merger and the runtime read the same file.
export const CAPTCHA_EXCLUDED = Object.freeze([...neverBlockCaptcha.suffixes]);

export function excludeCaptchaFromAdMediaRule(rules) {
  for (const rule of rules || []) {
    if (rule?.action?.type !== "block" || rule.condition?.urlFilter !== "_ad_") continue;
    const excluded = new Set(rule.condition.excludedRequestDomains || []);
    for (const host of CAPTCHA_EXCLUDED) excluded.add(host);
    rule.condition.excludedRequestDomains = [...excluded];
  }
  return rules;
}
