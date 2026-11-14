// Wave 2 "lists": AdGuard Base hide rules are used (cosmetic: true), the
// refresh writes the hide list only once all three cosmetic lists are parsed,
// and the packer rebuilds the bundled sheet (src/rules/cosmetic-rules.json)
// from the same three lists on every list pack.
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import source from "../src/general/update.js" with { type: "text" };
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});
const ROOT = new URL("..", import.meta.url);
const EXPECTED = ["easylist", "easyprivacy", "adguard_base"];

async function runPython(code) {
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  const tried = [];
  for (const [bin, ...pre] of bins) {
    try {
      const res = await new Deno.Command(bin, { args: [...pre, "-c", code], cwd: ROOT, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      const err = new TextDecoder().decode(res.stderr);
      if (res.code === 9009 || /Python was not found|Microsoft Store/.test(err)) { tried.push(bin + ": Store alias"); continue; }
      if (res.code !== 0) throw new Error(err);
      return new TextDecoder().decode(res.stdout);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) { tried.push(bin + ": not found"); continue; }
      throw e;
    }
  }
  throw new Error("no usable Python 3 (" + tried.join("; ") + ")");
}

Deno.test("the three cosmetic lists agree: update.js SOURCES, pack-cosmetic.mjs and the packer", async () => {
  const runtime = U.SOURCES.filter((s) => s.cosmetic).map((s) => s.name);
  assert(JSON.stringify(runtime) === JSON.stringify(EXPECTED), "runtime " + JSON.stringify(runtime));
  // Read as text: importing pack-cosmetic.mjs would run it.
  const packSrc = await Deno.readTextFile(new URL("scripts/pack-cosmetic.mjs", ROOT));
  const m = /export const COSMETIC_LISTS = (\[[^\]]*\]);/.exec(packSrc);
  assert(m && JSON.stringify(JSON.parse(m[1])) === JSON.stringify(EXPECTED), "pack-cosmetic " + (m && m[1]));
  // Same sites-only lists on both sides.
  const runtimeSites = U.SOURCES.filter((s) => s.cosmetic === "sites").map((s) => s.name);
  const ms = /export const SITES_ONLY_LISTS = (\[[^\]]*\]);/.exec(packSrc);
  assert(JSON.stringify(runtimeSites) === '["adguard_base"]', "runtime sites-only " + JSON.stringify(runtimeSites));
  assert(ms && JSON.stringify(JSON.parse(ms[1])) === JSON.stringify(runtimeSites), "pack-cosmetic sites-only " + (ms && ms[1]));
  // EasyList / EasyPrivacy keep the full parse (generic rules too).
  for (const n of ["easylist", "easyprivacy"]) assert(U.SOURCES.find((s) => s.name === n).cosmetic === true, n);
  const out = await runPython([
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "print(json.dumps({'lists': list(mod.COSMETIC_LISTS), 'cmd': mod.cosmetic_pack_command('2026-11-14T00:00:00Z'), 'src': Path('scripts/pack-filter-lists.py').read_text(encoding='utf-8')}))",
  ].join("\n"));
  const py = JSON.parse(out);
  assert(JSON.stringify(py.lists) === JSON.stringify(EXPECTED), "packer " + JSON.stringify(py.lists));
  assert(py.cmd[0] === "deno" && py.cmd.some((a) => /pack-cosmetic\.mjs$/.test(a)) && py.cmd.includes("--packed-at") && py.cmd.includes("2026-11-14T00:00:00Z") && py.cmd.includes("--cache"), JSON.stringify(py.cmd));
  // main() runs it: the cosmetic pack is part of every list pack.
  const main = py.src.slice(py.src.indexOf("def main() -> int:"));
  assert(/return run_cosmetic_pack\(fetched_at\)/.test(main), "main() runs the cosmetic pack");
});

const ADGUARD_TEXT = [
  "! Title: AdGuard Base (sample)",
  "example.test##.ad-slot",
  "##.adguard-generic-banner",
  "example.test##+js(set, x, 1)",
  "example.test##div:style(display:none !important)",
  "example.test##.promo:has-text(Sponsored)",
  "||adguard-only.example.com^$script,domain=example.test",
].join("\r\n");

Deno.test("AdGuard-style text: plain hide rules kept, scriptlets and procedural rules rejected", () => {
  const c = CP.parseCosmetic(ADGUARD_TEXT);
  assert(c.generic.includes(".adguard-generic-banner"), "generic kept: " + JSON.stringify(c.generic));
  const site = c.sites["example.test"] || [];
  assert(JSON.stringify(site) === '[".ad-slot"]', "site rules: " + JSON.stringify(site));
  assert(!JSON.stringify(c).includes("+js") && !JSON.stringify(c).includes(":style(") && !JSON.stringify(c).includes("has-text"), JSON.stringify(c));
});

Deno.test("sitesOnly: AdGuard generic ## / ~host## / #@# dropped, site hide rules and site exceptions kept", () => {
  const text = [
    "##.ag-generic",
    "~skip.test##.ag-generic-excl",
    "#@#.ag-generic-exc",
    "example.test##.ad-slot",
    "example.test,~sub.example.test##.ad-two",
    "other.test#@#.ad-slot",
    "*##.star-generic",
  ].join("\n");
  const c = CP.parseCosmetic(text, { sitesOnly: true });
  assert(c.generic.length === 0 && c.genericExceptions.length === 0, JSON.stringify(c));
  assert(JSON.stringify(c.sites["example.test"]) === '[".ad-slot",".ad-two"]', JSON.stringify(c.sites));
  assert(JSON.stringify(c.exceptions["other.test"]) === '[".ad-slot"]', JSON.stringify(c.exceptions));
  assert(JSON.stringify(c.exceptions["sub.example.test"]) === '[".ad-two"]', "site rule exclusion kept: " + JSON.stringify(c.exceptions));
  assert(!c.exceptions["skip.test"], "no stray exception from a dropped generic rule");
  assert(c.stats.genericDropped === 3, JSON.stringify(c.stats));
  // Default (EasyList) parse is unchanged: generic rules kept.
  const full = CP.parseCosmetic(text);
  assert(full.generic.includes(".ag-generic") && full.genericExceptions.includes(".ag-generic-exc"), JSON.stringify(full));
});

// Refresh harness, same shape as test/list-refresh.test.js.
const EXTRA_ID = mergeMeta.extra_tracker_rule_id;
function makeDeps(bodies) {
  const state = {}; let dynamic = []; const cosmetic = []; const data = {};
  return {
    cosmetic, data, t: 1e12,
    now() { return this.t; },
    getState: async () => JSON.parse(JSON.stringify(state)),
    setState: async (p) => Object.assign(state, p),
    fetch: async (url) => {
      const body = bodies(url);
      if (body === null) throw new Error("offline");
      return { ok: true, status: 200, headers: { get: () => "" }, text: async () => body };
    },
    loadBundled: async () => ({ rules: bundled, extraIds: [EXTRA_ID] }),
    getDynamicRules: async () => dynamic,
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async () => {},
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, data[n]])),
    setListData: async (n, p) => { data[n] = p; },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    enabled: () => true,
    cosmeticParse: CP,
    writeCosmetic: async (d) => { cosmetic.push(d); },
  };
}

function bigList(prefix, extra) {
  const lines = [];
  for (let i = 0; i < 30000; i++) lines.push("||" + prefix + i + ".example^");
  return lines.concat(extra || []).join("\n");
}
const BODIES = {
  easylist: bigList("el", ["example.com##.from-easylist", "##.easylist-generic"]),
  easyprivacy: bigList("ep", ["example.com##.from-easyprivacy"]),
  adguard_base: bigList("ag", ["example.com##.from-adguard", "##.adguard-generic", "example.com##+js(set, x, 1)"]),
};
const bodyFor = (offline) => (url) => {
  for (const [name, body] of Object.entries(BODIES)) {
    const src = U.SOURCES.find((s) => s.name === name);
    if (url === src.url || (src.mirrors || []).includes(url)) return offline.includes(name) ? null : body;
  }
  return bigList("other" + url.length);
};

Deno.test("refresh: hide list waits for AdGuard Base, then merges all three lists", async () => {
  let offline = ["adguard_base"];
  const d = makeDeps((url) => bodyFor(offline)(url));
  const r1 = await U.refresh(d, { manual: true });
  assert(r1.ok, JSON.stringify(r1));
  assert(d.cosmetic.length === 0, "no hide list with only two of three cosmetic lists: " + d.cosmetic.length);
  offline = [];
  d.t += 1;
  const r2 = await U.refresh(d, { manual: true });
  assert(r2.ok, JSON.stringify(r2));
  assert(d.cosmetic.length === 1, "written once all three are parsed: " + d.cosmetic.length);
  const out = d.cosmetic[0];
  const site = out.sites["example.com"] || [];
  for (const s of [".from-easylist", ".from-easyprivacy", ".from-adguard"]) assert(site.includes(s), s + " missing: " + JSON.stringify(site));
  assert(out.generic.includes(".easylist-generic"), "EasyList generic kept: " + JSON.stringify(out.generic));
  assert(!out.generic.includes(".adguard-generic"), "AdGuard generic dropped: " + JSON.stringify(out.generic));
  assert(!JSON.stringify(out).includes("+js"), "scriptlet rejected");
  assert(d.data.adguard_base && d.data.adguard_base.parser === U.PARSER_VERSION && d.data.adguard_base.cosmetic, "AdGuard payload carries its hide rules");
});

// pack-cosmetic.mjs, run for real on three tiny lists in a temp folder. The
// test process has no write permission: Python makes the folder and files and
// runs the script with --cache / --out, so src/rules is never touched.
async function packIn(lists, extraArgs) {
  const out = await runPython([
    "import json, shutil, subprocess, tempfile",
    "from pathlib import Path",
    `lists = json.loads(${JSON.stringify(JSON.stringify(lists))})`,
    "d = Path(tempfile.mkdtemp(prefix='adgecko-cos-'))",
    "try:",
    "    for name, text in lists.items():",
    "        (d / (name + '.txt')).write_text(text, encoding='utf-8')",
    "    out = d / 'out.json'",
    `    cmd = ['deno', 'run', '--allow-read', '--allow-write', 'scripts/pack-cosmetic.mjs', '--packed-at', '2026-11-14T01:02:03Z', '--cache', str(d), '--out', str(out)] + json.loads(${JSON.stringify(JSON.stringify(extraArgs || []))})`,
    "    res = subprocess.run(cmd, capture_output=True, text=True)",
    "    print(json.dumps({'code': res.returncode, 'stderr': res.stderr, 'out': json.loads(out.read_text(encoding='utf-8')) if out.exists() else None}))",
    "finally:",
    "    shutil.rmtree(d, ignore_errors=True)",
  ].join("\n"));
  return JSON.parse(out);
}

Deno.test("refresh: AdGuard hide rules over a cosmetic cap drop only its hide rules, never its network rules", async () => {
  const roots = [];
  for (let i = 0; i <= U.MAX_PAGE_ROOT_SITE_RULES; i++) roots.push("site" + i + ".test##html");
  const saved = BODIES.adguard_base;
  BODIES.adguard_base = bigList("ag", roots.concat(["example.com##.from-adguard"]));
  try {
    const d = makeDeps(bodyFor([]));
    const r = await U.refresh(d, { manual: true });
    assert(r.ok, JSON.stringify(r));
    const ag = d.data.adguard_base;
    assert(ag && ag.domains.length === 30000 && ag.domains.includes("ag0.example"), "AdGuard network rules stored");
    assert(ag.cosmetic && ag.cosmetic.generic.length === 0 && Object.keys(ag.cosmetic.sites).length === 0, "AdGuard hide part empty: " + JSON.stringify(ag.cosmetic).slice(0, 200));
    const st = await d.getState();
    assert(!(st.lastRejected || {}).adguard_base && !(st.lastErrors || {}).adguard_base, JSON.stringify({ rej: st.lastRejected, err: st.lastErrors }));
    assert(/hide rules skipped this refresh: too many whole-page hide rules/.test((st.lastNotes || {}).adguard_base || ""), JSON.stringify(st.lastNotes));
    assert(st.lists.adguard_base && st.lists.adguard_base.count === 30000, JSON.stringify(st.lists.adguard_base));
    // The hide list is still written, from EasyList / EasyPrivacy.
    assert(d.cosmetic.length === 1, "hide list written: " + d.cosmetic.length);
    const site = d.cosmetic[0].sites["example.com"] || [];
    assert(site.includes(".from-easylist") && !site.includes(".from-adguard"), JSON.stringify(site));
    assert(d.cosmetic[0].generic.includes(".easylist-generic"), "EasyList generic kept");
    assert(!d.cosmetic[0].sites["site0.test"], "AdGuard whole-page rules not shipped");
  } finally {
    BODIES.adguard_base = saved;
  }
});

Deno.test("refresh: an old AdGuard genericCount baseline never drops its site hide rules", async () => {
  const d = makeDeps(bodyFor([]));
  assert((await U.refresh(d, { manual: true })).ok, "first refresh");
  const st = await d.getState();
  st.lists.adguard_base.genericCount = 5000;
  st.lists.adguard_base.etag = "";
  await d.setState({ lists: st.lists });
  BODIES.adguard_base += "\nexample.com##.from-adguard-2";
  try {
    d.t += 10 * 86400000;
    const r = await U.refresh(d, { manual: true });
    assert(r.ok, JSON.stringify(r));
    const st2 = await d.getState();
    assert(!/hide rules skipped/.test(JSON.stringify(st2.lastNotes || {})), JSON.stringify(st2.lastNotes));
    const site = d.cosmetic[d.cosmetic.length - 1].sites["example.com"] || [];
    assert(site.includes(".from-adguard") && site.includes(".from-adguard-2"), JSON.stringify(site));
  } finally {
    BODIES.adguard_base = BODIES.adguard_base.replace("\nexample.com##.from-adguard-2", "");
  }
});

Deno.test("refresh: EasyList hide rules over a cosmetic cap still reject the whole list (unchanged)", async () => {
  const roots = [];
  for (let i = 0; i <= U.MAX_PAGE_ROOT_SITE_RULES; i++) roots.push("site" + i + ".test##html");
  const saved = BODIES.easylist;
  BODIES.easylist = bigList("el", roots);
  try {
    const d = makeDeps(bodyFor([]));
    await U.refresh(d, { manual: true });
    const st = await d.getState();
    assert(/too many whole-page hide rules/.test(((st.lastErrors || {}).easylist) || ""), JSON.stringify(st.lastErrors));
    assert(!d.data.easylist, "EasyList payload not stored");
  } finally {
    BODIES.easylist = saved;
  }
});

Deno.test("pack-cosmetic.mjs: reads the three cached lists (CRLF too), merges them, keeps the pack time", async () => {
  const res = await packIn({
    easylist: "example.com##.from-easylist\r\n##.el-generic\r\n",
    easyprivacy: "example.com##.from-easyprivacy\n",
    adguard_base: "example.com##.from-adguard\r\n##.ag-generic\r\nexample.com##+js(set, x, 1)\r\nexample.com##p:style(color:red)\r\n",
  });
  assert(res.code === 0, res.stderr);
  const o = res.out;
  assert(o.packed_at_utc === "2026-11-14T01:02:03Z", o.packed_at_utc);
  assert(JSON.stringify(o.sites["example.com"].slice().sort()) === JSON.stringify([".from-adguard", ".from-easylist", ".from-easyprivacy"]), JSON.stringify(o.sites));
  assert(o.generic.includes(".el-generic") && !o.generic.includes(".ag-generic"), "EasyList generic kept, AdGuard generic dropped: " + JSON.stringify(o.generic));
  assert(!JSON.stringify(o).includes("+js") && !JSON.stringify(o).includes(":style("), "procedural rejected");
  assert(!("stats" in o), "no parse stats in the bundle");
});

Deno.test("pack-cosmetic.mjs: a missing list or a list the refresh guard would reject writes nothing", async () => {
  const missing = await packIn({ easylist: "##.a\n", easyprivacy: "##.b\n" });
  assert(missing.code !== 0 && missing.out === null && /adguard_base/.test(missing.stderr), JSON.stringify(missing));
  const roots = [];
  for (let i = 0; i <= U.MAX_PAGE_ROOT_SITE_RULES; i++) roots.push("site" + i + ".test##html");
  const over = await packIn({ easylist: roots.join("\n"), easyprivacy: "##.b\n", adguard_base: "x.test##.c\n" });
  assert(over.code === 4 && over.out === null && /easylist\.txt: \d+ whole-page hide rules/.test(over.stderr), JSON.stringify(over));
});

Deno.test("pack-cosmetic.mjs: AdGuard Base over a cap loses only its hide rules; the sheet is still written", async () => {
  const roots = [];
  for (let i = 0; i <= U.MAX_PAGE_ROOT_SITE_RULES; i++) roots.push("site" + i + ".test##html");
  const res = await packIn({ easylist: "##.a\nexample.com##.el\n", easyprivacy: "##.b\n", adguard_base: roots.concat(["example.com##.ag"]).join("\n") });
  assert(res.code === 0 && res.out, JSON.stringify(res));
  assert(/hide rules dropped \(network rules unaffected\): adguard_base\.txt/.test(res.stderr), res.stderr);
  assert(JSON.stringify(res.out.sites["example.com"]) === '[".el"]' && !res.out.sites["site0.test"], JSON.stringify(res.out.sites));
  assert(res.out.generic.includes(".a") && res.out.generic.includes(".b"), JSON.stringify(res.out.generic));
});
