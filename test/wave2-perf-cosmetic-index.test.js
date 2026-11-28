// Wave 2 / perf: the cosmetic key index moved out of cosMeta (which every
// frame reads) into cosKeys (worker only), and ensureCosmetic() reads cosMeta
// before it fetches the 0.8 MB bundled cosmetic-rules.json.
import "../src/settings/features.js";
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import bundle from "../src/rules/cosmetic-rules.json" with { type: "json" };
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";
function assert(c, l) { if (!c) throw new Error(l); }
const P = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});
const HOUR = 3600000;
const VERSION = JSON.parse(Deno.readTextFileSync(new URL("../manifest.json", import.meta.url))).version;
const COSMETIC_URL = "src/rules/cosmetic-rules.json";
const cosmeticFetches = (w) => w.fetched.filter((u) => u.endsWith(COSMETIC_URL)).length;
const readBytes = (st, keys) => JSON.stringify(Object.fromEntries(keys.filter((k) => k in st).map((k) => [k, st[k]]))).length;
// What 0.3.4's toStorage() put in cosMeta.
function oldMetaFor(items, meta) {
  const keys = Object.keys(items).filter((k) => k !== P.KEY_META && k !== P.KEY_INDEX).concat(P.KEY_META);
  return Object.assign({ keys }, meta);
}
async function until(fn, tries = 100) {
  for (let i = 0; i < tries && !fn(); i++) await settle(50);
  return fn();
}

Deno.test("cosMeta size drop: a subframe read is the compact frame sheet, a top frame read is about cosG", () => {
  const meta = { source: "bundled", packedAt: bundle.packed_at_utc, extVersion: VERSION };
  const st = P.toStorage(bundle, meta);
  const oldMeta = oldMetaFor(st, meta);
  const oldBytes = JSON.stringify(oldMeta).length;
  const newBytes = JSON.stringify(st[P.KEY_META]).length;
  const sub = P.keysForHost("sub.example.org", false);
  const top = P.keysForHost("example.org", true);
  const subRead = readBytes(st, sub);
  const topRead = readBytes(st, top);
  const oldSubRead = readBytes(Object.assign({}, st, { [P.KEY_META]: oldMeta }), sub);
  console.log(JSON.stringify({ oldMetaKB: +(oldBytes / 1e3).toFixed(1), newMetaB: newBytes, oldSubframeReadKB: +(oldSubRead / 1e3).toFixed(1), subframeReadB: subRead, topReadKB: +(topRead / 1e3).toFixed(1), cosGKB: +(st[P.KEY_GENERIC].length / 1e3).toFixed(1) }));
  assert(oldBytes > 100000, "the bundle gives a large old index: " + oldBytes);
  assert(newBytes < 300, "cosMeta is small: " + newBytes);
  assert(!("keys" in st[P.KEY_META]), "no key list in cosMeta");
  assert(sub.includes(P.KEY_GENERIC_FRAME) && !sub.includes(P.KEY_GENERIC), "subframes read cosGF, not the full list");
  assert(top.includes(P.KEY_GENERIC) && !top.includes(P.KEY_GENERIC_FRAME), "the top frame reads the full list only");
  const frameBytes = JSON.stringify(st[P.KEY_GENERIC_FRAME] || "").length;
  assert(subRead < 1.1 * frameBytes + 2048, "subframe read is the compact sheet plus a little: " + subRead + " vs " + frameBytes);
  assert(subRead < 0.5 * JSON.stringify(st[P.KEY_GENERIC]).length, "the compact sheet is much smaller than the full list: " + subRead);
  assert(topRead < 1.1 * JSON.stringify(st[P.KEY_GENERIC]).length, "top read is about the generic sheet: " + topRead);
  assert(!sub.includes(P.KEY_INDEX) && !top.includes(P.KEY_INDEX), "pages never read cosKeys");
  // The index lists every stored key, itself and cosMeta included.
  const idx = st[P.KEY_INDEX];
  assert(Array.isArray(idx) && idx.length === Object.keys(st).length, "index covers every key");
  for (const k of Object.keys(st)) assert(idx.includes(k), "index misses " + k);
  assert(st[P.KEY_META].count === Object.keys(st).length - 2, "count = rule keys");
  // A caller meta with .keys cannot bring the list back into cosMeta.
  assert(!("keys" in P.toStorage({ generic: [".a"] }, { keys: ["x"], source: "refresh" })[P.KEY_META]), "meta.keys dropped");
});

Deno.test("fresh install: cosKeys written, cosMeta small and set after every rule key, and stamped with the version", async () => {
  const order = [];
  const w = loadWorker({ store: {}, setError: (items) => { order.push(Object.keys(items)); return null; } });
  await settle(20);
  w.install({ reason: "install" });
  assert(await until(() => w.store.cosMeta && Array.isArray(w.store.cosKeys)), "cosmetic seeded");
  const meta = w.store.cosMeta;
  assert(meta.source === "bundled" && meta.packedAt === bundle.packed_at_utc && meta.extVersion === VERSION, "meta " + JSON.stringify(meta));
  assert(JSON.stringify(meta).length < 300 && !meta.keys, "small meta " + JSON.stringify(meta).length);
  const metaAt = order.findIndex((ks) => ks.includes("cosMeta"));
  const lastRule = order.reduce((n, ks, i) => (ks.some((k) => k === "cosG" || k.startsWith("cosS:") || k.startsWith("cosE:")) ? i : n), -1);
  assert(metaAt > lastRule && lastRule >= 0, "cosMeta after rule keys: meta " + metaAt + ", last rule " + lastRule);
  for (const k of w.store.cosKeys) assert(k in w.store, "index names a missing key " + k);
  assert(cosmeticFetches(w) === 1, "one bundle fetch: " + cosmeticFetches(w));
});

Deno.test("a bundled set this version already checked: no fetch of cosmetic-rules.json on later runs", async () => {
  const w = loadWorker({ store: {} });
  await settle(20);
  w.install({ reason: "install" });
  assert(await until(() => w.store.cosMeta && w.store.cosMeta.extVersion === VERSION), "seeded");
  await settle(100);
  const before = cosmeticFetches(w);
  w.install({ reason: "update" });
  await settle(300);
  assert(cosmeticFetches(w) === before, "fetched again: " + cosmeticFetches(w) + " vs " + before);
});

Deno.test("refresh alarm (throttled) with a refreshed cosmetic set: no fetch of cosmetic-rules.json", async () => {
  const recent = { schema: 2, lastRunAt: Date.now() - 1 * HOUR, lists: {} };
  const w = loadWorker({
    store: { generalEnabled: true, generalAllowedOrigins: [], listState: recent, cosMeta: { source: "refresh", updatedAt: 1 }, cosKeys: ["cosMeta", "cosKeys"] },
    listFetch: () => { throw new TypeError("offline"); }, captureWarnings: true,
  });
  await settle(50);
  w.fireAlarm("gecko-refresh");
  await settle(400);
  assert(cosmeticFetches(w) === 0, "bundle fetched on a throttled alarm: " + w.fetched.join(", "));
  assert(w.store.cosMeta.source === "refresh" && w.store.cosMeta.updatedAt === 1, "refreshed meta kept");
});

Deno.test("upgrade from 0.3.4 (refreshed set): index moved to cosKeys without a fetch, and stale cleanup still finds old keys", async () => {
  const oldMeta = { source: "refresh", updatedAt: 5, keys: ["cosG", "cosS:gone.com", "cosE:gone.com", "cosS:keep.com", "cosMeta"] };
  const order = [];
  const w = loadWorker({
    store: { cosG: ".x", "cosS:gone.com": [".g"], "cosE:gone.com": [".h"], "cosS:keep.com": [".k"], cosMeta: oldMeta },
    setError: (items) => { order.push(Object.keys(items)); return null; }, captureWarnings: true,
  });
  await settle(20);
  w.install({ reason: "update" });
  assert(await until(() => w.store.cosMeta && !w.store.cosMeta.keys), "meta slimmed");
  await settle(100);
  assert(cosmeticFetches(w) === 0, "no bundle fetch for a refreshed set");
  assert(w.store.cosMeta.source === "refresh" && w.store.cosMeta.updatedAt === 5, "meta kept: " + JSON.stringify(w.store.cosMeta));
  for (const k of oldMeta.keys) assert(w.store.cosKeys.includes(k), "cosKeys has " + k);
  assert(w.store["cosS:gone.com"] && w.store["cosS:keep.com"], "no rule key touched by the slimming");
  const cosOrder = order.filter((ks) => ks.includes("cosKeys") || ks.includes("cosMeta"));
  // Exactly three writes, in this order: the index moves, the frame sheet is
  // backfilled (with its index entry), and cosMeta comes last, because a
  // cosMeta change re-runs every frame and cosGF must exist by then.
  assert(JSON.stringify(cosOrder) === JSON.stringify([["cosKeys"], ["cosGF", "cosKeys"], ["cosMeta"]]), "write order: " + JSON.stringify(cosOrder));
  assert(w.store.cosGF === ".x", "the compact frame sheet is backfilled from cosG");
  // A later cosmetic write (here: Revert to packed lists) removes the old keys.
  await w.send({ source: "adgecko-general", type: "revertLists" });
  assert(await until(() => w.store.cosMeta && w.store.cosMeta.source === "bundled"), "reverted");
  await settle(100);
  assert(!("cosS:gone.com" in w.store) && !("cosE:gone.com" in w.store) && !("cosS:keep.com" in w.store), "stale keys removed");
  assert(!w.store.cosKeys.includes("cosS:gone.com"), "index final");
  assert(w.store.cosMeta.extVersion === VERSION, "revert stamps the version");
});

Deno.test("upgrade from 0.3.4 (older bundled set): reseeded, old keys removed, cosMeta slim", async () => {
  const oldMeta = { source: "bundled", packedAt: "2000-01-01T00:00:00Z", keys: ["cosG", "cosS:gone.com", "cosMeta"] };
  const w = loadWorker({ store: { cosG: ".x", "cosS:gone.com": [".g"], cosMeta: oldMeta } });
  await settle(20);
  w.install({ reason: "update" });
  assert(await until(() => w.store.cosMeta && w.store.cosMeta.packedAt === bundle.packed_at_utc), "reseeded");
  await settle(100);
  assert(!("cosS:gone.com" in w.store), "stale key removed");
  assert(!w.store.cosMeta.keys && JSON.stringify(w.store.cosMeta).length < 300, "slim meta");
  assert(Array.isArray(w.store.cosKeys) && !w.store.cosKeys.includes("cosS:gone.com"), "index");
});

Deno.test("upgrade from 0.3.4 (same bundled snapshot): only cosKeys and cosMeta are written, then no more fetches", async () => {
  const seeded = P.toStorage(P.mergeCosmetic([bundle, { generic: bundle.extras || [] }]), {});
  delete seeded.cosKeys;
  const meta = { source: "bundled", packedAt: bundle.packed_at_utc };
  seeded.cosMeta = oldMetaFor(seeded, meta);
  const written = [];
  const w = loadWorker({ store: seeded, setError: (items) => { written.push(...Object.keys(items)); return null; } });
  await settle(20);
  w.install({ reason: "update" });
  assert(await until(() => w.store.cosMeta && w.store.cosMeta.extVersion === VERSION), "stamped");
  await settle(100);
  const cos = written.filter((k) => k.startsWith("cos"));
  assert(cos.length === 2 && cos.includes("cosKeys") && cos.includes("cosMeta"), "only two cosmetic writes: " + cos.slice(0, 5).join());
  assert(!w.store.cosMeta.keys && w.store.cosKeys.length === seeded.cosMeta.keys.length, "index moved");
  const before = cosmeticFetches(w);
  w.install({ reason: "update" });
  await settle(300);
  assert(cosmeticFetches(w) === before, "fetched again after the stamp");
});

Deno.test("a failed cosMeta write leaves the stale keys listed in cosKeys, and the next run removes them", async () => {
  const oldMeta = { source: "bundled", packedAt: "2000-01-01T00:00:00Z", keys: ["cosG", "cosS:gone.com", "cosMeta"] };
  let failMeta = true;
  const w = loadWorker({
    store: { cosG: ".x", "cosS:gone.com": [".g"], cosMeta: oldMeta },
    setError: (items) => (failMeta && "cosMeta" in items ? "IO error" : null),
    captureWarnings: true,
  });
  await settle(20);
  w.install({ reason: "update" });
  assert(await until(() => Array.isArray(w.store.cosKeys) && w.store.cosKeys.length > 3), "rule keys written");
  await settle(200);
  assert("cosS:gone.com" in w.store && w.store.cosKeys.includes("cosS:gone.com"), "stale key still indexed: " + w.store.cosKeys.includes("cosS:gone.com"));
  failMeta = false;
  w.install({ reason: "update" });
  assert(await until(() => !("cosS:gone.com" in w.store)), "stale key removed on the next run");
  await settle(100);
  assert(!w.store.cosKeys.includes("cosS:gone.com") && !w.store.cosMeta.keys, "final index and meta");
});

Deno.test("a cosMeta written by a list refresh during the upgrade step is not overwritten by the slim meta", async () => {
  const oldMeta = { source: "refresh", updatedAt: 5, keys: ["cosG", "cosS:a.com", "cosMeta"] };
  const newer = { source: "refresh", updatedAt: 9 };
  let w = null;
  w = loadWorker({
    store: { cosG: ".x", "cosS:a.com": [".a"], cosMeta: oldMeta },
    // A refresh writes its new cosMeta between the slim step's two writes.
    setError: (items) => { if ("cosKeys" in items && w.store.cosMeta.keys) w.store.cosMeta = newer; return null; },
  });
  await settle(20);
  w.install({ reason: "update" });
  assert(await until(() => Array.isArray(w.store.cosKeys)), "index written");
  await settle(200);
  assert(w.store.cosMeta === newer, "newer meta kept: " + JSON.stringify(w.store.cosMeta));
});

Deno.test("two ensureCosmetic calls at the same time share one run (one bundle fetch)", async () => {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: [], listState: { schema: 2, lastRunAt: Date.now(), lists: {} } }, listFetch: () => { throw new TypeError("offline"); }, captureWarnings: true });
  await settle(20);
  w.install({ reason: "install" });
  w.install({ reason: "install" });
  assert(await until(() => w.store.cosMeta && w.store.cosMeta.extVersion === VERSION), "seeded");
  await settle(200);
  assert(cosmeticFetches(w) === 1, "bundle fetches: " + cosmeticFetches(w));
});

Deno.test("ensureCosmetic backfills the compact frame sheet on a stored copy that lacks it", async () => {
  const st = P.toStorage(bundle, { source: "bundled", packedAt: bundle.packed_at_utc, extVersion: VERSION });
  const want = st[P.KEY_GENERIC_FRAME];
  assert(want && want.includes("#AdContent") && want.includes(".ad-slot"), "packed list has the short selectors");
  const store = Object.assign({}, st);
  delete store[P.KEY_GENERIC_FRAME];
  store[P.KEY_INDEX] = (store[P.KEY_INDEX] || []).filter((k) => k !== P.KEY_GENERIC_FRAME);
  const w = loadWorker({ store });
  await settle(20);
  w.install({ reason: "update" });
  assert(await until(() => w.store[P.KEY_GENERIC_FRAME] === want), "backfilled: " + String(w.store[P.KEY_GENERIC_FRAME]).slice(0, 80));
  assert(cosmeticFetches(w) === 0, "no bundle fetch: " + cosmeticFetches(w));
});
