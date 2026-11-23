// Owner decision 2026-11-22: an unanswered "Test with the ad lists off" ends
// after 24 hours. The test wrote an Allow (enabled:false on the host's own
// siteOverrides entry) and a popupFix entry with lists:true. After the time
// limit the worker takes that Allow off and drops the record, so a site does
// not stay allowed by accident.
import "../src/settings/features.js";
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";

function assert(c, l) { if (!c) throw new Error(l); }
function assertEquals(a, b, l) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((l || "expected equal") + "\n" + JSON.stringify(a) + "\n" + JSON.stringify(b));
}

const F = globalThis.GeckoFeatures;
const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

Deno.test("expireListTests: the time limit is 24 hours", () => {
  assertEquals(F.LIST_TEST_TTL_MS, DAY);
});

Deno.test("expireListTests: an unanswered list test older than 24 hours takes its Allow off and drops its record", () => {
  const fix = { host: "news.example", at: NOW - DAY - 1, prev: {}, lists: true };
  const r = F.expireListTests(fix, { "news.example": { enabled: false }, "kept.example": { enabled: false } }, NOW);
  assertEquals(r, { fix: null, overrides: { "kept.example": { enabled: false } } }, "only the test's Allow ends");
});

Deno.test("expireListTests: a younger test, a first-step Fix and an empty record change nothing", () => {
  assertEquals(F.expireListTests({ host: "a.example", at: NOW - DAY + 1000, prev: {}, lists: true }, { "a.example": { enabled: false } }, NOW), null);
  assertEquals(F.expireListTests({ host: "a.example", at: NOW - 2 * DAY, prev: { cosmetic: true } }, {}, NOW), null, "the first step is not a list test");
  assertEquals(F.expireListTests(undefined, {}, NOW), null);
});

Deno.test("expireListTests: the per-site switches on the entry stay; only enabled:false goes", () => {
  const r = F.expireListTests({ host: "a.example", at: NOW - 2 * DAY, prev: {}, lists: true }, { "a.example": { enabled: false, features: { guardPopups: true } } }, NOW);
  assertEquals(r.overrides, { "a.example": { features: { guardPopups: true } } });
});

Deno.test("expireListTests: an expired test under others ends, and the other questions stay in place", () => {
  const fix = {
    host: "shop.example", at: NOW - 1000, prev: { cosmetic: true },
    others: { "news.example": { at: NOW - 2 * DAY, prev: {}, lists: true }, "blog.example": { at: NOW - 5000, prev: {}, lists: true } },
  };
  const r = F.expireListTests(fix, { "news.example": { enabled: false }, "blog.example": { enabled: false } }, NOW);
  assertEquals(r.overrides, { "blog.example": { enabled: false } });
  assertEquals(r.fix, { host: "shop.example", at: NOW - 1000, prev: { cosmetic: true }, others: { "blog.example": { at: NOW - 5000, prev: {}, lists: true } } });
});

Deno.test("expireListTests: when the top test expires, the newest other question moves to the top", () => {
  const fix = { host: "news.example", at: NOW - 2 * DAY, prev: {}, lists: true, others: { "shop.example": { at: NOW - 1000, prev: { cosmetic: true } } } };
  const r = F.expireListTests(fix, { "news.example": { enabled: false } }, NOW);
  assertEquals(r.fix, { host: "shop.example", at: NOW - 1000, prev: { cosmetic: true } });
  assertEquals(r.overrides, {});
});

Deno.test("worker: an expired list test ends at worker start and on the siteInfo the popup asks for", async () => {
  const old = Date.now() - DAY - 60_000;
  const w = loadWorker({ store: {
    settings: { v: 1, enabled: true, features: {} },
    siteOverrides: { "news.example": { enabled: false } },
    popupFix: { host: "news.example", at: old, prev: {}, lists: true },
  } });
  await settle(150);
  assertEquals(w.store.siteOverrides, {}, "the Allow is off at worker start");
  assert(!("popupFix" in w.store), "the record is gone");

  // A test that expires while the worker runs: siteInfo ends it and says so.
  w.store.siteOverrides = { "news.example": { enabled: false } };
  w.store.popupFix = { host: "news.example", at: old, prev: {}, lists: true };
  const info = await w.send({ source: "adgecko-general", type: "siteInfo", origin: "https://news.example" });
  assertEquals([info.ok, info.listTestExpired, info.siteEnabled], [true, true, true], "siteInfo reports the end and a protected site");
  assertEquals(w.store.siteOverrides, {});
});
