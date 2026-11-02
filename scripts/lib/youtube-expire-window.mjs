// Local widening of uBO's "absurd expiry" decoy rule for YouTube video links.
//
// uAssets ships a DNR rule (via uBO's own converter) that blocks
//   .googlevideo.com/videoplayback?expire=<n>&...
// whenever <n> (epoch seconds) falls OUTSIDE a small allowed window. Real links
// expire about 6 h after they are issued, so the window must always cover "now".
// Upstream only widens the window AFTER real links start failing (the last bump,
// 2026-05-30, landed about 34 h after the crossing), so a plain re-sync never
// fixes it ahead of time. Window shipped in uAssets@69831a8 and still upstream on
// 2026-11-02:
//   (?:[02-9]\d+|1[1-68-9]\d+|17[1-7]\d+)  -> allows 10.., 170.., 178.., 179..
// It blocks every real link from expire=1800000000 (2027-01-15 08:00 UTC; links
// issued from about 02:00 UTC that day).
//
// This module rewrites the window to
//   (?:[02-9]\d+|1[1-6]\d+|17[1-7]\d+)
// which keeps every decoy block for values starting 0 or 2-9 and the past ranges
// 11-16 and 171-177, and additionally allows 18.. and 19.., i.e. real expiries up
// to 1999999999 (2033-05-18). It can only ALLOW more requests, never block more.
//
// Used by scripts/sync-ubo-youtube.mjs; tested by test/ubo-youtube.test.js.

export const EXPIRE_PREFIX = "\\.googlevideo\\.com\\/videoplayback\\?expire=";
export const EXPIRE_SUFFIX = "&";
export const UPSTREAM_WINDOW = "(?:[02-9]\\d+|1[1-68-9]\\d+|17[1-7]\\d+)";
export const WIDENED_WINDOW = "(?:[02-9]\\d+|1[1-6]\\d+|17[1-7]\\d+)";

const isExpireRule = (r) => typeof r?.condition?.regexFilter === "string" && r.condition.regexFilter.includes("videoplayback\\?expire=");

// Which 4-digit prefixes of a 10-digit expire value a window blocks. Coarse but
// enough to compare windows that are written as digit-prefix alternations.
function blockedPrefixes(windowSrc) {
  const re = new RegExp("^" + windowSrc + "&");
  const out = new Set();
  for (let p = 0; p < 10000; p++) {
    const v = String(p).padStart(4, "0") + "500000";
    if (re.test(v + "&")) out.add(p);
  }
  return out;
}
const isSubset = (a, b) => { for (const x of a) if (!b.has(x)) return false; return true; };

// Returns { rules, action } where action is one of
//   "none"      no expire rule present (dropped upstream; nothing to widen)
//   "widened"   upstream window replaced with WIDENED_WINDOW
//   "unchanged" already widened, or upstream's window is at least as permissive
// Throws on any shape it does not recognise, so the generator stops instead of
// writing a possibly-broken rule.
export function widenYoutubeExpireWindow(rules) {
  if (!Array.isArray(rules)) throw new Error("widenYoutubeExpireWindow: rules must be an array");
  const hits = rules.filter(isExpireRule);
  if (hits.length === 0) return { rules, action: "none" };
  if (hits.length > 1) throw new Error(`widenYoutubeExpireWindow: expected one videoplayback?expire= rule, found ${hits.length}; update scripts/lib/youtube-expire-window.mjs`);
  const rule = hits[0];
  const src = rule.condition.regexFilter;
  if (rule.action?.type !== "block") throw new Error(`widenYoutubeExpireWindow: expire rule is not a block rule (${rule.action?.type}); update scripts/lib/youtube-expire-window.mjs`);
  if (!src.startsWith(EXPIRE_PREFIX) || !src.endsWith(EXPIRE_SUFFIX)) {
    throw new Error("widenYoutubeExpireWindow: unrecognised regexFilter shape: " + src + "; update scripts/lib/youtube-expire-window.mjs");
  }
  const win = src.slice(EXPIRE_PREFIX.length, src.length - EXPIRE_SUFFIX.length);
  if (!/^\(\?:[0-9\[\]\-\\d+|]+\)$/.test(win)) {
    throw new Error("widenYoutubeExpireWindow: unrecognised expire window: " + win + "; update scripts/lib/youtube-expire-window.mjs");
  }
  if (win === WIDENED_WINDOW) return { rules, action: "unchanged" };
  let next;
  if (win === UPSTREAM_WINDOW) {
    next = WIDENED_WINDOW;
  } else {
    // Upstream moved its window. Keep whichever blocks a subset of the other.
    const up = blockedPrefixes(win);
    const ours = blockedPrefixes(WIDENED_WINDOW);
    if (isSubset(up, ours)) return { rules, action: "unchanged" };
    if (isSubset(ours, up)) next = WIDENED_WINDOW;
    else throw new Error("widenYoutubeExpireWindow: upstream window " + win + " is not comparable with " + WIDENED_WINDOW + "; update scripts/lib/youtube-expire-window.mjs");
  }
  const out = rules.map((r) => (r === rule ? { ...r, condition: { ...r.condition, regexFilter: EXPIRE_PREFIX + next + EXPIRE_SUFFIX } } : r));
  return { rules: out, action: "widened" };
}
