import { FC, NOW, DAY, iso, feedDoc, world, publish, hostsOf } from "./harness.mjs";
const H = 3600000;
Deno.test("F: setCache quota failure after replaceRules -> worker restart reverts to old rules; state says old serial", async () => {
  const w = world();
  await publish(w, feedDoc(1, ["old.example"])); await FC.checkFeed(w.deps);
  w.t += 3 * H;
  await publish(w, feedDoc(2, ["new.example"]));
  const real = w.deps.setCache;
  w.deps.setCache = async () => { throw new Error("QUOTA_BYTES quota exceeded"); };
  const r = await FC.checkFeed(w.deps);
  console.log("check", JSON.stringify(r), "rules now", hostsOf(w), "state serial", w.store.feedState.serial, "status", w.store.feedState.status);
  w.deps.setCache = real;
  const a = await FC.applyCached(w.deps);
  console.log("worker restart", JSON.stringify(a), "rules now", hostsOf(w));
});
Deno.test("G: base64 cache size for two 512 KB feeds", () => {
  const n = 512 * 1024; const b64 = Math.ceil(n / 3) * 4;
  console.log("one entry b64 chars", b64, "two", 2 * b64, "plus PEAK_LIMIT 9e6 =", 9e6 + 2 * b64, "quota", 10485760);
});
