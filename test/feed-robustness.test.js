// Review 2026-11-16, WP-20: feed robustness. (1) A cache write failure after
// the rule swap puts the rules of the saved file back. (2) With the threat
// tier off, the packed snapshot is not installed. (3) A re-served rollback
// document is "unchanged", not a replay. (4) A worker wake does not rewrite
// rules that are already in place. Based on docs/review-2026-11-16/repros/
// repro2.test.mjs F and G, repro.test.mjs D and perf.test.mjs.
import { FC, H, DAY, NOW, assert, feedDoc, world, publish, hostsOf, snapshot } from "./fixtures/feed-world.js";
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";

Deno.test("(1) setCache throws after the rule swap: the rules match the saved file, also after a worker restart (repro2 F)", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["old.example"]));
  await FC.checkFeed(w.deps);
  w.t += 3 * H;
  await publish(w, feedDoc(2, ["new.example"], {}, w.t));
  const real = w.deps.setCache;
  w.deps.setCache = async () => { throw new Error("QUOTA_BYTES quota exceeded"); };
  const r = await FC.checkFeed(w.deps);
  assert(!r.ok && /QUOTA_BYTES/.test(w.store.feedState.lastError), JSON.stringify(r));
  assert(hostsOf(w).join() === "old.example", "rules after the failed cache write: " + hostsOf(w));
  assert(w.store.feedState.serial === 1 && w.store.feedCache.current.serial === 1, "state and cache stay at serial 1");
  w.deps.setCache = real;
  await FC.applyCached(w.deps);
  assert(hostsOf(w).join() === "old.example", "after a worker restart: " + hostsOf(w));
  // The next check succeeds and applies serial 2.
  assert((await FC.checkFeed(w.deps)).mode === "applied" && hostsOf(w).join() === "new.example", "retry");
});

Deno.test("(1) setCache throws in the rollback path: the rules stay those of the saved current file", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["one.example"])); await FC.checkFeed(w.deps);
  await publish(w, feedDoc(2, ["two.example"])); await FC.checkFeed(w.deps);
  await publish(w, feedDoc(3, [], { rollbackTo: 1 }));
  w.deps.setCache = async () => { throw new Error("QUOTA_BYTES quota exceeded"); };
  const r = await FC.checkFeed(w.deps);
  assert(!r.ok && hostsOf(w).join() === "two.example" && w.store.feedCache.current.serial === 2, "rollback with a failed cache write: " + hostsOf(w));
});

Deno.test("(2) threat tier off: no valid feed file means no feed rules, not the packed snapshot", async () => {
  const w = world();
  let allowed = false;
  w.deps.snapshotAllowed = async () => allowed;
  const a = await FC.applyCached(w.deps);
  assert(a.ok && w.session.length === 0 && w.store.feedState.source === "none" && w.store.feedState.ruleCount === 0, "tier off: " + JSON.stringify(a) + " " + w.session.length);
  assert(/threat tier is off/.test(FC.statusText(w.store.feedState)), FC.statusText(w.store.feedState));
  allowed = true;
  const b = await FC.applyCached(w.deps);
  assert(b.mode === "snapshot" && w.session.length === snapshot.dnr.length, "tier on: " + JSON.stringify(b));
  allowed = false;
  await FC.applyCached(w.deps);
  assert(w.session.length === 0, "tier off again removes the snapshot rules");
  // A valid signed feed file still applies (the feed is its own switch).
  await publish(w, feedDoc(1, ["evil.example"]));
  await FC.checkFeed(w.deps);
  assert(hostsOf(w).join() === "evil.example", "signed feed with the tier off");
});

Deno.test("(2) worker: threat tier off and feed on: the snapshot is not installed; tier on installs it", async () => {
  const ORIGIN = "https://feed.example.test";
  const saved = { cfg: globalThis.GeckoFeedConfig, keys: globalThis.GeckoFeedKeys };
  const settings = (tier, feed) => ({ enabled: true, features: { threatTier: tier, threatFeed: feed } });
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: { schema: 2, lastRunAt: Date.now(), lists: {} }, settings: settings(false, false) } });
  try {
    await settle(150);
    // Configure the feed in this worker only (no cached file: the fallback path).
    // The pinned key is a dummy: nothing is fetched or verified in this test.
    globalThis.GeckoFeedConfig = Object.freeze({ FEED_ORIGIN: ORIGIN, FEED_PATH: "/feed.json", SIG_PATH: "/feed.json.sig" });
    globalThis.GeckoFeedKeys = Object.freeze({ FEED_KEYS: { "feed-test": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }, KILL_KEYS: {} });
    const real = w.chrome.runtime.getManifest;
    w.chrome.runtime.getManifest = () => Object.assign(real(), { host_permissions: [ORIGIN + "/*"] });
    // Feed switched on, threat tier stays off: feedPaused changes and the feed re-applies.
    await new Promise((r) => w.chrome.storage.local.set({ settings: settings(false, true) }, r));
    await settle(400);
    assert(w.store.feedPaused === false, "feed not paused");
    assert(w.dnr.session.length === 0, "tier off: snapshot rules installed: " + w.dnr.session.length);
    await new Promise((r) => w.chrome.storage.local.set({ settings: settings(true, true) }, r));
    await settle(400);
    assert(w.dnr.session.length === snapshot.dnr.length, "tier on: " + w.dnr.session.length);
  } finally {
    globalThis.GeckoFeedConfig = saved.cfg;
    globalThis.GeckoFeedKeys = saved.keys;
  }
});

Deno.test("(3) a re-served rollback document is 'unchanged', not a replay warning (repro D)", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["one.example"])); await FC.checkFeed(w.deps);
  w.t += 3 * H; await publish(w, feedDoc(2, ["two.example"], {}, w.t)); await FC.checkFeed(w.deps);
  w.t += 3 * H; await publish(w, feedDoc(3, [], { rollbackTo: 1 }, w.t));
  assert((await FC.checkFeed(w.deps)).mode === "rollback", "rollback");
  w.t += 3 * H;
  const r = await FC.checkFeed(w.deps);
  assert(r.ok && r.mode === "unchanged" && !w.store.feedState.lastError && w.store.feedState.fetchedAt === w.t, "recheck: " + JSON.stringify(r) + " " + w.store.feedState.lastError);
  assert(hostsOf(w).join() === "one.example", "rules stay rolled back");
  // A rollback that was ignored ("not stored") keeps its note when served again.
  w.t += 3 * H; await publish(w, feedDoc(4, [], { rollbackTo: 2 }, w.t)); await FC.checkFeed(w.deps); // 2 is stored as previous
  w.t += 3 * H; await publish(w, feedDoc(6, [], { rollbackTo: 5 }, w.t));
  assert(!(await FC.checkFeed(w.deps)).ok && /not stored/.test(w.store.feedState.lastError), "ignored rollback");
  w.t += 3 * H;
  const again = await FC.checkFeed(w.deps);
  assert(again.mode === "unchanged" && /not stored/.test(w.store.feedState.lastError) && !/replay/.test(w.store.feedState.lastError), "ignored rollback served again: " + JSON.stringify(again) + " " + w.store.feedState.lastError);
  // Other bytes with the same serial are still a replay.
  await publish(w, feedDoc(6, [], { rollbackTo: 1, notAfter: new Date(w.t + DAY).toISOString().replace(/\.\d+Z$/, "Z") }, w.t));
  const other = await FC.checkFeed(w.deps);
  assert(!other.ok && /not newer than 6/.test(other.reason), "same serial, other bytes: " + JSON.stringify(other));
});

Deno.test("(4) a worker wake does not rewrite feed rules that are already in place (perf repro)", async () => {
  // Snapshot path.
  const w = world();
  await FC.applyCached(w.deps);
  const u = w.updates;
  const s = w.stateWrites;
  for (let i = 0; i < 5; i++) await FC.applyCached(w.deps);
  assert(w.updates === u && w.stateWrites === s && w.snapshotLoads === 1, "snapshot wakes: updates " + (w.updates - u) + " state writes " + (w.stateWrites - s) + " loads " + w.snapshotLoads);
  // Browser restart (session rules gone): applied again.
  w.session = [];
  await FC.applyCached(w.deps);
  assert(w.session.length === snapshot.dnr.length, "restart re-applies");
  // Feed path.
  await publish(w, feedDoc(1, ["evil.example"]));
  await FC.checkFeed(w.deps);
  const u2 = w.updates;
  const s2 = w.stateWrites;
  for (let i = 0; i < 5; i++) await FC.applyCached(w.deps);
  assert(w.updates === u2 && w.stateWrites === s2, "feed wakes: updates " + (w.updates - u2) + " state writes " + (w.stateWrites - s2));
  // The saved file expires while the browser runs: the next wake falls back.
  w.t = NOW + 11 * DAY;
  const b = await FC.applyCached(w.deps);
  assert(b.mode === "snapshot" && w.store.feedState.source === "snapshot", "expired: " + JSON.stringify(b));
  // An extension update (other version) applies again even with rules in place.
  w.deps.extensionVersion = "0.3.7";
  const u3 = w.updates;
  await FC.applyCached(w.deps);
  assert(w.updates === u3 + 1, "new version re-applies");
  // Paused: the second wake writes nothing.
  w.store.feedPaused = true;
  await FC.applyCached(w.deps);
  const s4 = w.stateWrites;
  await FC.applyCached(w.deps);
  assert(w.stateWrites === s4 && w.session.length === 0, "paused wake writes nothing");
});
