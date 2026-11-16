import { FC, NOW, DAY, iso, feedDoc, world, publish, hostsOf, feedPair, killPair, generateKeyPair } from "./harness.mjs";
const H = 3600000;

Deno.test("A: stolen feed key pins serial at 2^31-1; kill + update with new key cannot recover", async () => {
  const w = world();
  await publish(w, feedDoc(5, ["good.example"]));
  console.log("legit", (await FC.checkFeed(w.deps)).mode, w.store.feedState.serial);
  // attacker doc 1: tiny lifetime
  w.t += 3 * H;
  await publish(w, feedDoc(6, [], { createdAt: iso(w.t - 60000), notBefore: iso(w.t - 60000), notAfter: iso(w.t + 60000) }));
  console.log("atk1", JSON.stringify(await FC.checkFeed(w.deps)), w.store.feedState.serial);
  w.t += 3 * H;
  await publish(w, feedDoc(2147483647, [], { createdAt: iso(w.t - 60000), notBefore: iso(w.t - 60000), notAfter: iso(w.t + 10 * DAY) }));
  console.log("atk2", JSON.stringify(await FC.checkFeed(w.deps)), w.store.feedState.serial);
  // owner kills
  w.t += 3 * H;
  await publish(w, { format: 1, kill: true, serial: 1, createdAt: iso(w.t) }, killPair);
  console.log("kill", JSON.stringify(await FC.checkFeed(w.deps)));
  // update ships new feed key
  const newPair = await generateKeyPair("feed-new", "feed");
  w.deps.keys = { feedKeys: { "feed-new": newPair.publicKey }, killKeys: w.deps.keys.killKeys };
  w.deps.extensionVersion = "0.2.22";
  console.log("applyCached", JSON.stringify(await FC.applyCached(w.deps)));
  w.t += 3 * H;
  await publish(w, feedDoc(2147483647, ["new.example"], { createdAt: iso(w.t - H), notBefore: iso(w.t - H), notAfter: iso(w.t + 10 * DAY) }), newPair);
  const r = await FC.checkFeed(w.deps);
  console.log("new key feed", JSON.stringify(r), w.store.feedState.lastError);
  for (let i = 0; i < 3; i++) { w.t += 15 * DAY; await publish(w, feedDoc(2147483647, ["new.example"], { createdAt: iso(w.t - H), notBefore: iso(w.t - H), notAfter: iso(w.t + 10 * DAY) }), newPair); console.log("later", (await FC.checkFeed(w.deps)).reason); }
});

Deno.test("B: date-like serial across New Year rejected until old doc expires", async () => {
  const w = world();
  await publish(w, feedDoc(2026123101, ["a.example"]));
  console.log("dec31", (await FC.checkFeed(w.deps)).mode);
  w.t += 12 * H;
  await publish(w, feedDoc(2027010101, ["b.example"], { createdAt: iso(w.t - H), notBefore: iso(w.t - H), notAfter: iso(w.t + 10 * DAY) }));
  const r = await FC.checkFeed(w.deps);
  console.log("jan1", JSON.stringify(r), hostsOf(w));
});

Deno.test("C: date-like kill serial: second kill a year later is rejected forever", async () => {
  const w = world();
  await publish(w, { format: 1, kill: true, serial: 2026111001, createdAt: iso(w.t) }, killPair);
  console.log("kill1", (await FC.checkFeed(w.deps)).mode);
  w.deps.extensionVersion = "0.2.22"; // update releases latch
  await FC.applyCached(w.deps);
  w.t += 400 * DAY;
  await publish(w, feedDoc(10, ["x.example"], { createdAt: iso(w.t - H), notBefore: iso(w.t - H), notAfter: iso(w.t + 10 * DAY) }));
  console.log("feed", (await FC.checkFeed(w.deps)).mode, hostsOf(w));
  w.t += 3 * H;
  await publish(w, { format: 1, kill: true, serial: 2027121501, createdAt: iso(w.t) }, killPair);
  const r = await FC.checkFeed(w.deps);
  console.log("kill2", JSON.stringify(r), hostsOf(w));
});

Deno.test("D: rollback document re-served -> false replay warning every check", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["one.example"])); await FC.checkFeed(w.deps);
  w.t += 3 * H; await publish(w, feedDoc(2, ["two.example"])); await FC.checkFeed(w.deps);
  w.t += 3 * H; await publish(w, feedDoc(3, [], { rollbackTo: 1 }));
  console.log("rb", (await FC.checkFeed(w.deps)).mode);
  w.t += 3 * H;
  const r = await FC.checkFeed(w.deps);
  console.log("recheck", JSON.stringify(r), "|", w.store.feedState.text, "| lastCheckAt moved:", w.store.feedState.lastCheckAt === w.t, "fetchedAt:", w.store.feedState.fetchedAt === w.t);
});

Deno.test("E: kill document has no age limit: years-old kill doc latches a fresh install", async () => {
  const w = world();
  await publish(w, { format: 1, kill: true, serial: 1, createdAt: "2020-01-01T00:00:00Z" }, killPair);
  console.log("old kill", JSON.stringify(await FC.checkFeed(w.deps)));
  await publish(w, { format: 1, kill: true, serial: 2, createdAt: "2099-01-01T00:00:00Z" }, killPair);
  w.deps.extensionVersion = "0.2.22"; await FC.applyCached(w.deps);
  console.log("future kill", JSON.stringify(await FC.checkFeed(w.deps)));
});
