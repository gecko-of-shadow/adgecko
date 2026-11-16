// Review 2026-11-16, WP-11: the stored feed serial is bound to the key that
// signed it, so a key rotation recovers a feed whose serial is at the cap; a
// short-lived document does not open the large serial step; kill serials have
// no step limit. Based on docs/review-2026-11-16/repros/repro.test.mjs A and C.
import { FC, H, DAY, NOW, MAX_SERIAL, assert, iso, feedDoc, killDoc, world, publish, hostsOf, killPair, generateKeyPair } from "./fixtures/feed-world.js";

const S = globalThis.GeckoFeedSchema;

Deno.test("key rotation: kill, then an update with a new feed key; serial 1 from the new key is accepted (repro A)", async () => {
  const w = world();
  // Serial at the cap (a stolen key, or a publisher typo; both are in bounds).
  await publish(w, feedDoc(MAX_SERIAL - 600000, ["a.example"]));
  assert((await FC.checkFeed(w.deps)).mode === "applied", "first");
  w.t += 3 * H;
  await publish(w, feedDoc(MAX_SERIAL, ["b.example"], {}, w.t));
  assert((await FC.checkFeed(w.deps)).mode === "applied" && w.store.feedState.serial === MAX_SERIAL, "at the cap");
  // The owner kills the feed, then ships an update with a new feed key.
  w.t += 3 * H;
  await publish(w, killDoc(1, w.t), killPair);
  assert((await FC.checkFeed(w.deps)).mode === "killed", "killed");
  const newPair = await generateKeyPair("feed-new", "feed");
  w.deps.keys = { feedKeys: { "feed-new": newPair.publicKey }, killKeys: w.deps.keys.killKeys };
  w.deps.extensionVersion = "0.3.7";
  await FC.applyCached(w.deps);
  w.t += 3 * H;
  await publish(w, feedDoc(1, ["new.example"], {}, w.t), newPair);
  const r = await FC.checkFeed(w.deps);
  assert(r.ok && r.mode === "applied" && hostsOf(w).join() === "new.example" && w.store.feedState.serial === 1, "new key: " + JSON.stringify(r) + " " + w.store.feedState.lastError);
  assert(w.store.feedState.serialKeyId === "feed-new", "serial bound to the new key " + JSON.stringify(w.store.feedState.serialKeyId));
  // A later update with a third key also recovers.
  const third = await generateKeyPair("feed-3", "feed");
  w.deps.keys = { feedKeys: { "feed-3": third.publicKey }, killKeys: w.deps.keys.killKeys };
  w.t += 3 * H;
  await publish(w, feedDoc(1, ["third.example"], {}, w.t), third);
  assert((await FC.checkFeed(w.deps)).mode === "applied" && hostsOf(w).join() === "third.example", "third key");
});

Deno.test("no rotation, no reset: after a kill and an update with the SAME key, an old serial is still refused", async () => {
  const w = world();
  await publish(w, feedDoc(50, ["a.example"]));
  await FC.checkFeed(w.deps);
  const old = { bytes: w.files["/feed.json"], sig: w.files["/feed.json.sig"] };
  w.t += 3 * H;
  await publish(w, killDoc(1, w.t), killPair);
  await FC.checkFeed(w.deps);
  w.deps.extensionVersion = "0.3.7"; // releases the latch, same pinned keys
  await FC.applyCached(w.deps);
  w.files["/feed.json"] = old.bytes; w.files["/feed.json.sig"] = old.sig; // a pre-kill file served again
  const r = await FC.checkFeed(w.deps);
  assert(!r.ok && /not newer than 50/.test(r.reason) && !hostsOf(w).includes("a.example"), "pre-kill replay: " + JSON.stringify(r));
  // The old key is still pinned, so the stored serial must still bind it.
  await publish(w, feedDoc(1, ["low.example"], {}, w.t));
  assert(!(await FC.checkFeed(w.deps)).ok, "serial 1 from the same key is refused");
});

Deno.test("a removed key cannot sign any more; the reset gives it nothing", async () => {
  const w = world();
  await publish(w, feedDoc(10, ["a.example"]));
  await FC.checkFeed(w.deps);
  const newPair = await generateKeyPair("feed-new", "feed");
  w.deps.keys = { feedKeys: { "feed-new": newPair.publicKey }, killKeys: w.deps.keys.killKeys };
  w.deps.extensionVersion = "0.3.7";
  w.session = [];
  await FC.applyCached(w.deps);
  await publish(w, feedDoc(11, ["stolen.example"], {}, w.t)); // signed with the old (removed) key
  const r = await FC.checkFeed(w.deps);
  assert(!r.ok && /unknown key id feed-test/.test(r.reason) && !hostsOf(w).includes("stolen.example"), JSON.stringify(r));
});

Deno.test("kill key rotation resets the kill serial too", async () => {
  const w = world();
  await publish(w, killDoc(MAX_SERIAL), killPair);
  assert((await FC.checkFeed(w.deps)).mode === "killed", "kill at the cap");
  const newKill = await generateKeyPair("kill-new", "kill");
  w.deps.keys = { feedKeys: w.deps.keys.feedKeys, killKeys: { "kill-new": newKill.publicKey } };
  w.deps.extensionVersion = "0.3.7";
  await FC.applyCached(w.deps);
  await publish(w, killDoc(1, w.t), newKill);
  const r = await FC.checkFeed(w.deps);
  assert(r.ok && r.mode === "killed" && w.store.feedState.killSerial === 1, "new kill key: " + JSON.stringify(r) + " " + w.store.feedState.lastError);
});

Deno.test("a stored document with a 60 s life that expires does not open a jump to 2^31-1 (repro A, first half)", async () => {
  const w = world();
  await publish(w, feedDoc(5, ["good.example"]));
  await FC.checkFeed(w.deps);
  w.t += 3 * H;
  await publish(w, feedDoc(6, [], { createdAt: iso(w.t - 60000), notBefore: iso(w.t - 60000), notAfter: iso(w.t + 60000) }));
  assert((await FC.checkFeed(w.deps)).mode === "applied", "short-lived document applied");
  w.t += 3 * H;
  await publish(w, feedDoc(MAX_SERIAL, ["x.example"], {}, w.t));
  const r = await FC.checkFeed(w.deps);
  assert(!r.ok && /jumps from 6 to 2147483647/.test(r.reason) && w.store.feedState.serial === 6, "jump after a 60 s document: " + JSON.stringify(r));
});

Deno.test("the expiry escape still works after a document that lived at least 24 h (serial scheme change)", async () => {
  const w = world();
  await publish(w, feedDoc(5, ["good.example"], {}, NOW, 2 * DAY));
  await FC.checkFeed(w.deps);
  w.t += 3 * DAY; // the stored document has expired
  await publish(w, feedDoc(2026111001, ["dated.example"], {}, w.t));
  const r = await FC.checkFeed(w.deps);
  assert(r.ok && r.mode === "applied" && w.store.feedState.serial === 2026111001, JSON.stringify(r) + " " + w.store.feedState.lastError);
  // Schema level: the escape needs storedNotBefore and a lifetime of 24 h.
  const doc = feedDoc(2026111001, ["dated.example"], {}, NOW);
  const ctx = (nb, na) => ({ now: NOW, storedSerial: 5, storedNotBefore: nb, storedNotAfter: na, protectedReason: () => null });
  S.validateFeed(doc, ctx(NOW - 3 * DAY, NOW - 2 * DAY)); // lived 24 h, expired: accepted
  let err = "";
  try { S.validateFeed(doc, ctx(NOW - 3 * DAY, NOW - 3 * DAY + 23 * H)); } catch (e) { err = e.message; }
  assert(/jumps from 5/.test(err), "23 h life must not open the escape: " + err);
  err = "";
  try { S.validateFeed(doc, ctx(0, NOW - DAY)); } catch (e) { err = e.message; }
  assert(/jumps from 5/.test(err), "unknown notBefore must not open the escape: " + err);
});

Deno.test("kill serials have no step limit: stored kill serial 2026111001, then 2027121501 is accepted (repro C)", async () => {
  const w = world();
  await publish(w, killDoc(2026111001), killPair);
  assert((await FC.checkFeed(w.deps)).mode === "killed", "kill 1");
  w.deps.extensionVersion = "0.3.7"; // the update releases the latch
  await FC.applyCached(w.deps);
  w.t += 400 * DAY;
  await publish(w, feedDoc(10, ["x.example"], {}, w.t));
  assert((await FC.checkFeed(w.deps)).mode === "applied" && hostsOf(w).join() === "x.example", "feed back on");
  w.t += 3 * H;
  await publish(w, killDoc(2027121501, w.t), killPair);
  const r = await FC.checkFeed(w.deps);
  assert(r.ok && r.mode === "killed" && w.session.length === 0, "second kill: " + JSON.stringify(r));
  // The cap and "must increase" stay.
  let err = "";
  try { S.validateKill(killDoc(MAX_SERIAL + 1), { storedKillSerial: 0 }); } catch (e) { err = e.message; }
  assert(/above 2147483647/.test(err), "cap: " + err);
  err = "";
  try { S.validateKill(killDoc(5), { storedKillSerial: 5 }); } catch (e) { err = e.message; }
  assert(/not newer/.test(err), "increase: " + err);
});

Deno.test("feed-sign.mjs warns when a serial is near the 2^31-1 cap", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const pair = await generateKeyPair("sign-test", "feed");
    await Deno.writeTextFile(dir + "/k.json", JSON.stringify(pair.privateRecord));
    const run = async (serial) => {
      const now = Date.now();
      await Deno.writeTextFile(dir + "/feed.json", JSON.stringify(feedDoc(serial, ["evil.example"], {}, now)));
      const out = await new Deno.Command(Deno.execPath(), {
        args: ["run", "--no-lock", "--allow-read", "--allow-write", "scripts/feed-sign.mjs", "--key", dir + "/k.json", "--feed", dir + "/feed.json"],
        cwd: new URL("..", import.meta.url), stdout: "piped", stderr: "piped",
      }).output();
      return { code: out.code, err: new TextDecoder().decode(out.stderr) };
    };
    const high = await run(MAX_SERIAL - 5);
    assert(high.code === 0 && /near the cap/.test(high.err), "warning for a high serial: " + JSON.stringify(high));
    const normal = await run(2026111001);
    assert(normal.code === 0 && !/near the cap/.test(normal.err), "no warning for a date-like serial: " + JSON.stringify(normal));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
