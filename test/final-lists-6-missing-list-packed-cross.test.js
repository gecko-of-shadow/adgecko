// Final review #6 (0.3.5): crossListRules() read $badfilter / @@ data only
// from lists with a current parsed copy. When AdGuard Base (which carries
// `||totaladblock.com^$badfilter` and `$document,badfilter`) failed on the
// first refresh after the upgrade, the fresh EasyList put totaladblock.com
// back into the dynamic rules, page block included.
// Fix: the packer writes each list's cross-list data into
// src/rules/packed-cross.json; swap() passes the names of lists with no
// current copy to crossListRules(), which uses their packed part in place of
// the payload.
// Edited for 0.3.5: the packer kept only the entries that removed or narrowed
// something at pack time, so a missing list's $badfilter / @@ / limit data did
// not cover a filter that another list added after the pack. It now stores
// each list's FULL cross-list data (cancel, allow, limit, important), and
// alldoc for the hosts that some list's allow set names.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
import { evaluate } from "./fixtures/dnr-matcher.js";

function assert(c, l) { if (!c) throw new Error(l); }
const FO = globalThis.GeneralFilterOptions;
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

async function runPython(code) {
  const root = new URL("..", import.meta.url);
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  const tried = [];
  for (const [bin, ...pre] of bins) {
    try {
      const res = await new Deno.Command(bin, { args: [...pre, "-c", code], cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
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

const EASYLIST = "||totaladblock.com^\n||totaladblock.com^$document\n||jwplayer.com^$domain=tennis.com|variety.com\n||ok.example.com^";
const ADGUARD = "||totaladblock.com^$badfilter\n||totaladblock.com^$document,badfilter\n||jwplayer.com^$domain=tennis.com,badfilter\n||unused.example^$badfilter";
const DOC = "p=|t=main_frame|x=";

// Run fn with FO.PACKED_CROSS replaced (the packer's block for these lists).
async function withPacked(data, fn) {
  const saved = FO.PACKED_CROSS;
  FO.PACKED_CROSS = data;
  try {
    return await fn();
  } finally {
    FO.PACKED_CROSS = saved;
  }
}

async function packedFor(texts) {
  const out = await runPython([
    "import importlib.util, json",
    "from collections import OrderedDict",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    `texts = json.loads(${JSON.stringify(JSON.stringify(texts))})`,
    "named = OrderedDict((n, mod.extract_list(t)) for n, t in texts.items())",
    "print(json.dumps(mod.packed_cross_data(named)))",
  ].join("\n"));
  return JSON.parse(out);
}

const ADGUARD_MORE = ADGUARD + "\n@@||lift.example^\n@@||limited.example/path$script";

Deno.test("#6: the packer stores each list's full cross-list data", async () => {
  const data = await packedFor({ easylist: EASYLIST, adguard_base: ADGUARD_MORE });
  const ag = data.lists.adguard_base;
  assert(data.version === 1, "version");
  // `||unused.example^$badfilter` cancels nothing at pack time: kept anyway.
  assert(JSON.stringify(ag.cancel) === JSON.stringify(["jwplayer.com\np=|t=|x=|i=tennis.com", "totaladblock.com\n", "totaladblock.com\n" + DOC, "unused.example\n"]), JSON.stringify(ag));
  assert(JSON.stringify(ag.allow) === '["lift.example"]', "allow kept although no list blocks the host: " + JSON.stringify(ag.allow));
  assert(JSON.stringify(ag.limit) === '["limited.example"]', "limit kept although no $domain= filter names the host: " + JSON.stringify(ag.limit));
  assert(!data.lists.easylist, "easylist has no cross-list data: " + JSON.stringify(data.lists.easylist));
});

// alldoc acts only with an allow entry for the same host, and the full set
// (about 12,000 malware hosts) put the zip over the 8 MB release-gate cap.
Deno.test("#6 (0.3.5): the packer keeps alldoc only for hosts some list allows", async () => {
  const data = await packedFor({
    easylist: "||lift.example^$all\n||kept-blocked.example^$all",
    adguard_base: "@@||lift.example^",
  });
  const el = data.lists.easylist || {};
  assert(JSON.stringify(el.alldoc) === '["lift.example"]', "alldoc filtered to allowed hosts: " + JSON.stringify(el));
  const size = Deno.statSync(new URL("../src/rules/packed-cross.json", import.meta.url)).size;
  assert(size < 150000, "packed-cross.json is " + size + " bytes");
});

Deno.test("#6 (0.3.5): a missing list's packed data covers filters other lists add after the pack", async () => {
  const packed = await packedFor({ easylist: EASYLIST, adguard_base: ADGUARD_MORE });
  // EasyList after the pack: three new filters that AdGuard's data answers.
  const later = U.parseEntriesFull(EASYLIST + "\n||unused.example^\n||lift.example^\n||limited.example^$domain=site.test");
  const control = U.crossListRules({ easylist: later }, []);
  assert(control.keepWhole("unused.example") && control.keepWhole("lift.example") && control.keepScoped("limited.example", "p=|t=|x=|i=site.test"), "control: kept without AdGuard data");
  const cross = U.crossListRules({ easylist: later }, ["adguard_base"], packed);
  assert(!cross.keepWhole("unused.example"), "packed $badfilter cancels a filter added later");
  assert(!cross.keepWhole("lift.example"), "packed @@||host^ lifts a block added later");
  assert(!cross.keepScoped("limited.example", "p=|t=|x=|i=site.test"), "packed limit drops a $domain= filter added later");
  assert(cross.keepWhole("ok.example.com"), "control host");
  const present = U.crossListRules({ easylist: later, adguard_base: U.parseEntriesFull("||x.example^") }, [], packed);
  assert(present.keepWhole("unused.example") && present.keepWhole("lift.example"), "a present list's own copy wins");
});

Deno.test("#6: a missing list's packed $badfilter still applies; a present list's own copy wins", async () => {
  const packed = await packedFor({ easylist: EASYLIST, adguard_base: ADGUARD });
  await withPacked(packed, () => {
    const payloads = { easylist: U.parseEntriesFull(EASYLIST) };
    const noPacked = U.crossListRules(payloads);
    assert(noPacked.keepWhole("totaladblock.com"), "control: without the packed part the host is kept");
    const cross = U.crossListRules(payloads, ["adguard_base"]);
    assert(!cross.keepWhole("totaladblock.com") && !cross.keepScoped("totaladblock.com", DOC), "packed badfilter ignored");
    assert(cross.scopeOf("jwplayer.com", "p=|t=|x=|i=tennis.com,variety.com") === "p=|t=|x=|i=variety.com", "packed per-initiator badfilter ignored");
    assert(cross.keepWhole("ok.example.com"), "control host");
    // AdGuard present (its fresh copy dropped the badfilter): packed part unused.
    const both = U.crossListRules({ easylist: payloads.easylist, adguard_base: U.parseEntriesFull("||x.example^") }, []);
    assert(both.keepWhole("totaladblock.com"), "packed part used although AdGuard has a current copy");
  });
});

Deno.test("#6: refresh with AdGuard unreachable does not block totaladblock.com (swap end to end)", async () => {
  const packed = await packedFor({ easylist: EASYLIST, adguard_base: ADGUARD });
  let dynamic = [];
  const state = {}; const data = {};
  const big = (p) => Array.from({ length: 30000 }, (_, i) => "||" + p + i + ".example^").join("\n");
  const bodies = (url) => {
    const src = U.SOURCES.find((s) => s.url === url || (s.mirrors || []).includes(url));
    if (!src || src.name === "adguard_base") return null;
    if (src.name === "easylist") return big("el") + "\n" + EASYLIST;
    return big(src.name);
  };
  const deps = {
    t: 1e12,
    now() { return this.t; },
    getState: async () => JSON.parse(JSON.stringify(state)),
    setState: async (p) => Object.assign(state, p),
    fetch: async (url) => {
      const body = bodies(url);
      if (body === null) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, headers: { get: () => "" }, text: async () => body };
    },
    loadBundled: async () => ({ rules: bundled, extraIds: [mergeMeta.extra_tracker_rule_id] }),
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
    writeCosmetic: async () => {},
  };
  const run = () => withPacked(packed, () => U.refresh(deps, { manual: true }));
  const r = await run();
  assert(r.ok && r.rules > 0, JSON.stringify(r));
  assert(state.lastErrors && state.lastErrors.adguard_base, "AdGuard failed: " + JSON.stringify(state.lastErrors));
  const listRules = dynamic.filter((x) => x.id >= U.LIST_RULE_ID_BASE && x.id < U.KEPT_RULE_ID_BASE);
  const req = (url, type, initiator) => evaluate(listRules, { url, type, method: "get", initiator }).action;
  assert(req("https://totaladblock.com/", "main_frame", null) === "none", "page blocked again");
  assert(req("https://totaladblock.com/a.js", "script", "site.test") === "none", "host blocked again");
  assert(req("https://cdn.jwplayer.com/x.js", "script", "tennis.com") === "none", "jwplayer on tennis.com");
  assert(req("https://cdn.jwplayer.com/x.js", "script", "variety.com") === "block", "jwplayer on variety.com kept");
  assert(req("https://ok.example.com/a.js", "script", "site.test") === "block", "control host");
});

Deno.test("#6: the shipped PACKED_CROSS block is well formed and names only known lists", () => {
  const p = JSON.parse(Deno.readTextFileSync(new URL("../src/rules/packed-cross.json", import.meta.url)));
  assert(p && p.version === 1 && p.lists && typeof p.lists === "object", JSON.stringify(p).slice(0, 200));
  const names = new Set(U.SOURCES.map((s) => s.name));
  for (const [n, part] of Object.entries(p.lists)) {
    assert(names.has(n), "unknown list " + n);
    for (const [k, v] of Object.entries(part)) {
      assert(["cancel", "allow", "limit", "important", "alldoc", "importantScoped", "cancelAllow"].includes(k), n + ": field " + k);
      assert(Array.isArray(v) && v.every((x) => typeof x === "string"), n + "." + k);
    }
  }
});

// The shipped data lives in src/rules/packed-cross.json (ad-network names stay
// inside src/rules/, release gate). The worker's loadBundled() reads it and
// swap() passes it to crossListRules as its third argument.
Deno.test("#6: the shipped packed-cross.json reaches crossListRules as an argument (no PACKED_CROSS global needed)", () => {
  const FO = globalThis.GeneralFilterOptions;
  assert(FO.PACKED_CROSS === null, "filter-options.js carries no host data");
  const packed = JSON.parse(Deno.readTextFileSync(new URL("../src/rules/packed-cross.json", import.meta.url)));
  const payloads = { easylist: U.parseEntriesFull("||totaladblock.com^\n||keep.example^") };
  const without = U.crossListRules(payloads, ["adguard_base"]);
  assert(without.keepWhole("totaladblock.com"), "no packed data passed: kept");
  const cross = U.crossListRules(payloads, ["adguard_base"], packed);
  assert(!cross.keepWhole("totaladblock.com"), "AdGuard's packed $badfilter cancels totaladblock.com while AdGuard is missing");
  assert(cross.keepWhole("keep.example"), "other hosts kept");
  const present = U.crossListRules({ ...payloads, adguard_base: U.parseEntriesFull("||x.example^") }, [], packed);
  assert(present.keepWhole("totaladblock.com"), "a present list's own copy wins over the packed data");
});

Deno.test("#6: the worker's loadBundled fetches src/rules/packed-cross.json", () => {
  const bg = Deno.readTextFileSync(new URL("../src/general-background.js", import.meta.url));
  assert(/getURL\("src\/rules\/packed-cross\.json"\)/.test(bg) && /packedCross/.test(bg), "loadBundled reads packed-cross.json");
  assert(/crossListRules\(payloads, missing, bundled\.packedCross\)/.test(updateSource), "swap passes it on");
});

// Review fix (PR 36 follow-up): the packer also writes importantScoped (hosts
// of scoped `$important` blocks) and cancelAllow (exceptions that an
// `@@...$badfilter` line withdraws), as parseEntriesFull() does. Without them
// a missing list's scoped $important block or withdrawn exception was lost,
// and an exception from another list could still get an allow rule.
const PARITY = {
  easylist: [
    "||adsfoo.example^$script,third-party,important",
    "||deep.tracksite.example^$image,important",
    "||gone.example^$script,important",
    "||gone.example^$script,important,badfilter",
    "||wholeimp.example^$important",
  ].join("\n"),
  easyprivacy: [
    "@@||c.nrfoo.example^$xmlhttprequest,badfilter",
    "@@||w.nrfoo.example^$badfilter",
    "@@||k.nrfoo.example^$subdocument,xmlhttprequest,badfilter",
    "@@||keep.nrfoo.example^",
  ].join("\n"),
};

Deno.test("packer parity: importantScoped and cancelAllow match parseEntriesFull()", async () => {
  const data = await packedFor(PARITY);
  for (const [name, text] of Object.entries(PARITY)) {
    const js = U.parseEntriesFull(text);
    const py = data.lists[name] || {};
    for (const k of ["importantScoped", "cancelAllow"]) {
      const a = JSON.stringify((js[k] || []).slice().sort());
      const b = JSON.stringify(py[k] || []);
      assert(a === b, name + " " + k + ": JS " + a + ", packer " + b);
    }
  }
  assert(JSON.stringify(data.lists.easylist.importantScoped) === '["adsfoo.example","deep.tracksite.example"]', "importantScoped: " + JSON.stringify(data.lists.easylist));
  assert(data.lists.easyprivacy.cancelAllow.length === 3, "cancelAllow: " + JSON.stringify(data.lists.easyprivacy));
});

Deno.test("packed importantScoped and cancelAllow of a missing list stop the allow rules of a present list", async () => {
  const packed = await packedFor(PARITY);
  const adguard = U.parseEntriesFull("@@||x.adsfoo.example^\n@@||c.nrfoo.example^$xmlhttprequest\n@@||w.nrfoo.example^\n@@||keep2.nrfoo.example^");
  const blocked = new Set(["adsfoo.example", "nrfoo.example"]);
  const without = U.exceptionAllows(U.crossListRules({ adguard_base: adguard }, [], { lists: {} }), blocked);
  assert(JSON.stringify(without.whole) === JSON.stringify(["keep2.nrfoo.example", "w.nrfoo.example", "x.adsfoo.example"]) && without.scoped.length === 1, "control: " + JSON.stringify(without));
  const cross = U.crossListRules({ adguard_base: adguard }, ["easylist", "easyprivacy"], packed);
  const allows = U.exceptionAllows(cross, blocked);
  assert(JSON.stringify(allows.whole) === JSON.stringify(["keep.nrfoo.example", "keep2.nrfoo.example"]), "whole: " + JSON.stringify(allows.whole));
  assert(allows.scoped.length === 0, "scoped: " + JSON.stringify(allows.scoped));
});

// `@@||host^$badfilter` withdraws the exception: keepWhole no longer lifts the
// same-host block for it, and the `$all` page entry stays. JS and packer.
const WITHDRAWN = {
  easylist: "||wf.example^\n||wfall.example^$all\n||kept.example^",
  adguard_base: "@@||wf.example^\n@@||wfall.example^\n@@||kept.example^",
  easyprivacy: "@@||wf.example^$badfilter\n@@||wfall.example^$badfilter",
};

Deno.test("keepWhole: an exception withdrawn by @@||host^$badfilter lifts no block (JS and packer)", async () => {
  const payloads = Object.fromEntries(Object.entries(WITHDRAWN).map(([n, t]) => [n, U.parseEntriesFull(t)]));
  const control = U.crossListRules({ easylist: payloads.easylist, adguard_base: payloads.adguard_base }, [], { lists: {} });
  assert(!control.keepWhole("wf.example") && !control.keepScoped("wfall.example", DOC), "control: the exception lifts the blocks");
  const cross = U.crossListRules(payloads, [], { lists: {} });
  assert(cross.keepWhole("wf.example"), "withdrawn exception still lifts the whole-domain block");
  assert(cross.keepWhole("wfall.example") && cross.keepScoped("wfall.example", DOC), "withdrawn exception still lifts the $all page entry");
  assert(!cross.keepWhole("kept.example"), "an exception with no $badfilter still lifts its block");
  // A missing list's packed cancelAllow does the same.
  const packed = await packedFor(WITHDRAWN);
  const fromPacked = U.crossListRules({ easylist: payloads.easylist, adguard_base: payloads.adguard_base }, ["easyprivacy"], packed);
  assert(fromPacked.keepWhole("wf.example") && fromPacked.keepScoped("wfall.example", DOC), "packed cancelAllow ignored");
  const out = JSON.parse(await runPython([
    "import importlib.util, json",
    "from collections import OrderedDict",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    `texts = json.loads(${JSON.stringify(JSON.stringify(WITHDRAWN))})`,
    "ex = [mod.extract_list(t) for t in texts.values()]",
    "b = OrderedDict((n, e[0]) for n, e in zip(texts, ex))",
    "s = OrderedDict((n, e[1]) for n, e in zip(texts, ex))",
    "nb, ns = mod.apply_cross_list(b, s, ex)",
    "print(json.dumps({'whole': nb['easylist'], 'scoped': ns['easylist']}))",
  ].join("\n")));
  assert(JSON.stringify(out.whole) === JSON.stringify(["wf.example", "wfall.example"]), "packer whole: " + JSON.stringify(out.whole));
  assert(JSON.stringify(out.scoped) === JSON.stringify([["wfall.example", DOC]]), "packer scoped: " + JSON.stringify(out.scoped));
});
