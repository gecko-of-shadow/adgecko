// Which list rules may block opening a page (main_frame), checked with the DNR
// matcher that follows Chrome (test/fixtures/dnr-matcher.js; Chrome for Testing
// 155 probe 2026-11-03, BUILD-PROGRESS "NEXT BUILD 2").
// Bug 2: negated-only types (`$~script`, `$~stylesheet,third-party`) used to
// become rules with only excludedResourceTypes, which Chrome also matches for
// main_frame, so following a link to e.g. prime.rambler.ru or (third-party)
// eloqua.com failed although the lists only meant their page parts.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import source from "../src/general/update.js" with { type: "text" };
import backgroundSource from "../src/general-background.js" with { type: "text" };
import settingsHtml from "../src/settings.html" with { type: "text" };
import threatRules from "../src/rules/threat-network.json" with { type: "json" };
import mergeCases from "./fixtures/merge-scope-cases.json" with { type: "json" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
import { ruleMatches, evaluate } from "./fixtures/dnr-matcher.js";
function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${source}\nreturn installGeneralAdblockUpdate;`)()(U);
const FO = globalThis.GeneralFilterOptions;

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
const PY_LOAD = [
  "import importlib.util, json, sys",
  "from pathlib import Path",
  "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
  "mod = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(mod)",
].join("\n");

// A typed URL (no initiator) and a link followed from another site.
const typed = (host) => ({ url: `https://${host}/`, type: "main_frame", initiator: null });
const clicked = (host) => ({ url: `https://${host}/`, type: "main_frame", initiator: "news.example" });
const sub = (host, type) => ({ url: `https://${host}/x`, type, initiator: "news.example" });
const blocks = (rules, req) => rules.some((r) => r.action.type === "block" && ruleMatches(r, req));
const opensPage = (rules, host) => !blocks(rules, typed(host)) && !blocks(rules, clicked(host));

const NEGATED_LIST = [
  "||prime.rambler.ru^$~script",
  "||eloqua.com^$~stylesheet,third-party",
  "||exacttarget.com^$~subdocument,third-party",
  "||noimg.example^$~image",
].join("\n");

function checkNegated(rules, label) {
  for (const h of ["prime.rambler.ru", "eloqua.com", "exacttarget.com", "noimg.example"]) {
    assert(opensPage(rules, h), `${label}: opening ${h} must not be blocked`);
  }
  // ...but the page parts the lists meant stay blocked.
  assert(blocks(rules, sub("prime.rambler.ru", "image")) && blocks(rules, sub("prime.rambler.ru", "sub_frame")), `${label}: prime.rambler.ru image/frame blocked`);
  assert(!blocks(rules, sub("prime.rambler.ru", "script")), `${label}: prime.rambler.ru scripts allowed`);
  assert(blocks(rules, sub("eloqua.com", "image")) && blocks(rules, sub("eloqua.com", "script")), `${label}: eloqua.com third-party image/script blocked`);
  assert(!blocks(rules, sub("eloqua.com", "stylesheet")), `${label}: eloqua.com stylesheets allowed`);
  assert(!blocks(rules, { url: "https://eloqua.com/x", type: "image", initiator: "eloqua.com" }), `${label}: eloqua.com first-party image allowed`);
  assert(blocks(rules, sub("exacttarget.com", "image")) && !blocks(rules, sub("exacttarget.com", "sub_frame")), `${label}: exacttarget.com image blocked, frames allowed`);
  assert(blocks(rules, sub("noimg.example", "script")) && !blocks(rules, sub("noimg.example", "image")), `${label}: noimg.example`);
}

Deno.test("bug 2, runtime: negated-type filters block the page parts but never opening the page", () => {
  const { domains, scoped } = U.parseEntries(NEGATED_LIST);
  assert(domains.length === 0 && scoped.length === 4, JSON.stringify({ domains, scoped }));
  checkNegated(U.buildListRules(domains, scoped), "update.js");
});

Deno.test("bug 2, packer: the same filters give rules with the same behaviour", async () => {
  const out = await runPython(PY_LOAD + "\n" + [
    `whole, scoped = mod.extract_entries(${JSON.stringify(NEGATED_LIST)})`,
    "print(json.dumps(mod.domains_to_dnr_rules(whole, scoped)))",
  ].join("\n"));
  checkNegated(JSON.parse(out), "packer");
});

// Guards against an over-broad matcher fix: no resourceTypes AND no excluded
// types (whole-domain, party-only) still never matches a navigation.
Deno.test("whole-domain and third-party-only rules never match opening a page", () => {
  const rules = U.buildListRules(["whole.example"], [["party.example", "p=thirdParty|t=|x="]]);
  for (const h of ["whole.example", "party.example"]) assert(opensPage(rules, h), h + " navigation must not be blocked");
  assert(blocks(rules, sub("whole.example", "image")) && blocks(rules, sub("party.example", "script")), "subresources still blocked");
});

// The runtime rebuilds the packed rules (swap() packed fallback: conditionKey
// -> key -> keyToCondition). Whatever the packed file holds, no rebuilt list
// rule may match a navigation unless it lists main_frame on purpose.
Deno.test("runtime rebuild of the packed rules: only explicit main_frame rules can block opening a page", async () => {
  const EXTRA_ID = mergeMeta.extra_tracker_rule_id;
  let dynamic = [];
  const state = {};
  const deps = {
    t: 1e12, now: () => deps.t,
    fetch: async (url) => {
      if (url.endsWith("/easylist.txt")) return { ok: true, status: 200, headers: new Headers({}), text: async () => "! Expires: 4 days\n" + Array.from({ length: 12000 }, (_, i) => `||tiny${i}.example^`).join("\n") };
      throw new TypeError("network error");
    },
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async () => ({}), setListData: async () => {}, removeListData: async () => {},
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    // The shipped bundle plus rules in the pre-fix packed shape (excluded-only
    // without main_frame, as packed before 861a3ad), so the rebuild guards the
    // converter whatever the current file holds.
    setStaticEnabled: async () => {}, loadBundled: async () => ({ rules: bundled.concat([
      { id: 99001, priority: 1, action: { type: "block" }, condition: { requestDomains: ["oldneg.example"], excludedResourceTypes: ["script"] } },
      { id: 99002, priority: 1, action: { type: "block" }, condition: { requestDomains: ["oldneg3p.example"], domainType: "thirdParty", excludedResourceTypes: ["stylesheet"] } },
    ]), extraIds: [EXTRA_ID] }),
    enabled: () => true, cosmeticParse: null, writeCosmetic: async () => {},
  };
  const r = await U.refresh(deps, { manual: true });
  assert(r.ok && r.ran, "swap ran: " + JSON.stringify(r));
  const list = dynamic.filter((x) => x.id >= U.LIST_RULE_ID_BASE && x.id < U.KEPT_RULE_ID_BASE);
  assert(list.length > 2000, "rebuilt list rules: " + list.length);
  const excludedOnly = list.filter((x) => x.condition.excludedResourceTypes && !x.condition.resourceTypes);
  assert(excludedOnly.length > 0, "the packed data has excluded-only scopes to check");
  let navRules = 0;
  for (const rule of list) {
    const d = rule.condition.requestDomains[0];
    const nav = ruleMatches(rule, typed(d)) || ruleMatches(rule, clicked(d));
    const deliberate = (rule.condition.resourceTypes || []).includes("main_frame");
    assert(nav === deliberate, `rule ${rule.id} ${JSON.stringify(FO.conditionKey(rule.condition))} navigation=${nav}`);
    if (deliberate) navRules++;
  }
  assert(navRules > 0, "the explicit $doc rules are still there");
  for (const rule of excludedOnly) assert(rule.condition.excludedResourceTypes.includes("main_frame"), "excluded-only rule excludes main_frame: " + rule.id);
  for (const h of ["oldneg.example", "oldneg3p.example"]) {
    assert(list.some((x) => x.condition.requestDomains.includes(h)), "old-shape packed rule rebuilt: " + h);
    assert(opensPage(list, h), "old-shape packed rule no longer blocks opening " + h);
  }
});

Deno.test("matcher follows Chrome: excluded-only matches navigations, third-party includes typed URLs", () => {
  const ex = { id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["a.example"], excludedResourceTypes: ["script"] } };
  assert(ruleMatches(ex, typed("a.example")) && ruleMatches(ex, clicked("a.example")), "Chrome 155 blocked these navigations (probe case a)");
  const exNav = { ...ex, condition: { ...ex.condition, excludedResourceTypes: ["main_frame", "script"] } };
  assert(!ruleMatches(exNav, typed("a.example")) && ruleMatches(exNav, sub("a.example", "image")), "probe case b");
  const doc3p = { id: 2, priority: 1, action: { type: "block" }, condition: { requestDomains: ["f.example"], domainType: "thirdParty", resourceTypes: ["main_frame"] } };
  assert(ruleMatches(doc3p, typed("f.example")) && ruleMatches(doc3p, clicked("f.example")), "probe case f: typed URL counts as third-party");
  assert(evaluate([ex], typed("a.example")).action === "block", "evaluate agrees");
});

// ---------------------------------------------------------------------------
// Bug 1: an explicit `$document` filter blocks opening the page even when
// another list (or the same one) also blocks the host as a whole domain; a
// whole-domain rule alone never matches main_frame.
const TC = globalThis.GeckoThreatCompile;
const STREAM_HOSTS = (await Deno.readTextFile(new URL("./fixtures/stream-hosts.txt", import.meta.url)))
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

Deno.test("bug 1, shared merge cases: JS scopeForMerge / mergeScoped and the packer agree", async () => {
  for (const c of mergeCases.cases) {
    const got = FO.scopeForMerge(...c.in);
    assert(got === c.expect, "js " + JSON.stringify(c.in) + " -> " + got + " expected " + c.expect);
  }
  for (const l of mergeCases.lists) {
    const got = U.mergeScoped({ easylist: l.scoped }, l.whole);
    assert(JSON.stringify(got) === JSON.stringify(l.expect), "js mergeScoped " + JSON.stringify(got));
  }
  const out = await runPython(PY_LOAD + "\n" + [
    "cases = json.loads(Path('test/fixtures/merge-scope-cases.json').read_text(encoding='utf-8'))",
    "one = [mod.scope_for_merge(*c['in']) for c in cases['cases']]",
    "lists = [mod.merge_scoped({'easylist': l['scoped']}, l['whole'])[0] for l in cases['lists']]",
    "print(json.dumps({'one': one, 'lists': lists, 'exempt': mod.NAV_EXEMPT}))",
  ].join("\n"));
  const py = JSON.parse(out);
  mergeCases.cases.forEach((c, i) => assert(py.one[i] === c.expect, "python " + JSON.stringify(c.in) + " -> " + py.one[i]));
  mergeCases.lists.forEach((l, i) => assert(JSON.stringify(py.lists[i]) === JSON.stringify(l.expect), "python merge_scoped " + JSON.stringify(py.lists[i])));
  assert(JSON.stringify(py.exempt) === JSON.stringify(FO.NAV_EXEMPT), "packer and runtime read the same exempt list");
});

const DOC_AND_WHOLE = [
  "||a-ads.example^",
  "||a-ads.example^$document",
  "||docframe.example^",
  "||docframe.example^$document,subdocument",
  "||doc3p.example^$document,third-party",
  "||doc3p.example^",
  "||plain.example^",
  "||party.example^$third-party",
  "0.0.0.0 dns.example",
  "||redirectingat.com^",
  "||redirectingat.com^$document",
].join("\n");

function checkDocAndWhole(rules, label) {
  for (const h of ["a-ads.example", "docframe.example", "doc3p.example"]) {
    assert(blocks(rules, typed(h)) && blocks(rules, clicked(h)), `${label}: opening ${h} is blocked`);
    assert(blocks(rules, sub(h, "image")) && blocks(rules, sub(h, "script")), `${label}: ${h} page parts still blocked`);
  }
  // party scope kept: a navigation inside the same site is first-party
  assert(!blocks(rules, { url: "https://doc3p.example/next", type: "main_frame", initiator: "doc3p.example" }), `${label}: doc3p.example first-party navigation allowed`);
  for (const h of ["plain.example", "party.example", "dns.example"]) assert(opensPage(rules, h), `${label}: ${h} (no $document) opens`);
  assert(opensPage(rules, "redirectingat.com") && blocks(rules, sub("redirectingat.com", "script")), `${label}: exempt host opens, its scripts stay blocked`);
  const mf = rules.filter((r) => (r.condition.resourceTypes || []).includes("main_frame"));
  assert(mf.every((r) => r.condition.resourceTypes.length === 1), `${label}: whole-domain hosts keep a main_frame-only scope`);
}

function mergeLikePacker(text) {
  const { domains, scoped } = U.parseEntries(text);
  const whole = U.mergeDomains({ easylist: domains });
  return U.buildListRules(whole, U.mergeScoped({ easylist: scoped }, whole));
}

Deno.test("bug 1, runtime: $document next to a whole-domain block keeps a navigation rule; nothing else gains one", () => {
  checkDocAndWhole(mergeLikePacker(DOC_AND_WHOLE), "update.js");
});

Deno.test("bug 1, packer: same input, same behaviour", async () => {
  const out = await runPython(PY_LOAD + "\n" + [
    `whole, scoped = mod.extract_entries(${JSON.stringify(DOC_AND_WHOLE)})`,
    "domains, _ = mod.merge_domains({'easylist': whole})",
    "merged, _ = mod.merge_scoped({'easylist': scoped}, domains)",
    "print(json.dumps(mod.domains_to_dnr_rules(domains, merged)))",
  ].join("\n"));
  checkDocAndWhole(JSON.parse(out), "packer");
});

function fakeSwapDeps(bundledRules, lists = {}) {
  let dynamic = [];
  const state = {};
  const deps = {
    t: 1e12, now: () => deps.t,
    fetch: async (url) => {
      const body = lists[url.split("/").pop()];
      if (body !== undefined) return { ok: true, status: 200, headers: new Headers({}), text: async () => body };
      throw new TypeError("network error");
    },
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async () => ({}), setListData: async () => {}, removeListData: async () => {},
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async () => {}, loadBundled: async () => ({ rules: bundledRules, extraIds: [] }),
    enabled: () => true, cosmeticParse: null, writeCosmetic: async () => {},
    get dynamic() { return dynamic; },
  };
  return deps;
}

Deno.test("bug 1, swap fallback: packed $document rules of whole-domain hosts survive a partial refresh", async () => {
  const filler = Array.from({ length: 12000 }, (_, i) => `||fill${i}.example^`).join("\n");
  const bundle = [
    { id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["a-ads.example", "doc3p.example", "redirectingat.com"] } },
    { id: 2, priority: 1, action: { type: "block" }, condition: { requestDomains: ["a-ads.example"], resourceTypes: ["main_frame"] } },
    { id: 3, priority: 1, action: { type: "block" }, condition: { requestDomains: ["doc3p.example"], domainType: "thirdParty", resourceTypes: ["main_frame"] } },
    { id: 4, priority: 1, action: { type: "block" }, condition: { requestDomains: ["redirectingat.com"], resourceTypes: ["main_frame"] } },
  ];
  const deps = fakeSwapDeps(bundle, { "easylist.txt": "! Expires: 4 days\n" + filler });
  const r = await U.refresh(deps, { manual: true });
  assert(r.ok && r.ran, JSON.stringify(r));
  const rules = deps.dynamic.filter((x) => x.id >= U.LIST_RULE_ID_BASE && x.id < U.KEPT_RULE_ID_BASE);
  assert(blocks(rules, typed("a-ads.example")) && blocks(rules, sub("a-ads.example", "image")), "a-ads.example: both rules after the swap");
  assert(blocks(rules, typed("doc3p.example")) && !blocks(rules, { url: "https://doc3p.example/n", type: "main_frame", initiator: "doc3p.example" }), "party scope kept");
  assert(opensPage(rules, "redirectingat.com") && blocks(rules, sub("redirectingat.com", "image")), "exempt host: packed main_frame rule not carried over");
});

Deno.test("bug 1: stream and never-block hosts never get a navigation block (guard)", async () => {
  const text = STREAM_HOSTS.flatMap((h) => [`||${h}^`, `||${h}^$document`, `||ads.${h}^$document`]).join("\n");
  const rules = mergeLikePacker(text);
  for (const h of STREAM_HOSTS) assert(opensPage(rules, h) && opensPage(rules, "ads." + h), "stream host navigation blocked: " + h);
  const out = await runPython(PY_LOAD + "\n" + [
    `whole, scoped = mod.extract_entries(${JSON.stringify(text)})`,
    "domains, _ = mod.merge_domains({'easylist': whole})",
    "merged, _ = mod.merge_scoped({'easylist': scoped}, domains)",
    "print(json.dumps(mod.domains_to_dnr_rules(domains, merged)))",
  ].join("\n"));
  const py = JSON.parse(out);
  for (const h of STREAM_HOSTS) assert(opensPage(py, h) && opensPage(py, "ads." + h), "packer: stream host navigation blocked: " + h);
  const arrays = JSON.parse(await runPython(PY_LOAD + "\nprint(json.dumps([mod.PROTECTED_SUFFIX, mod.PROTECTED_EXACT]))"));
  const PH = globalThis.GeckoProtectedHosts;
  assert(JSON.stringify(arrays) === JSON.stringify([PH.SUFFIX, PH.EXACT]), "packer reads the same protected-host list");
});

Deno.test("bug 1: Allow this domain (2,000,020) lifts a list navigation block; per-site Allow lifts it for links from that site", () => {
  const rules = mergeLikePacker(DOC_AND_WHOLE);
  assert(blocks(rules, typed("a-ads.example")), "blocked before");
  assert(TC.userDomainReason("a-ads.example").domain === "a-ads.example", "the box accepts an ordinary-list $document host");
  const userAllow = TC.buildUserAllowRules(["a-ads.example"], 950000, 1000);
  for (const req of [typed("a-ads.example"), clicked("a-ads.example"), sub("a-ads.example", "image")]) {
    assert(evaluate(rules.concat(userAllow), req).action === "allow", "allow box beats the list rule: " + JSON.stringify(req));
  }
  // The per-site Allow rule shape the worker writes (general-background.js).
  assert(/priority: 10000,\s*action: \{ type: "allow" \},\s*condition: \{\s*initiatorDomains: \[host\],\s*resourceTypes: \[\s*"main_frame"/.test(backgroundSource), "per-site allow shape");
  const siteAllow = [{ id: 900000, priority: 10000, action: { type: "allow" }, condition: { initiatorDomains: ["news.example"], resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "other"] } }];
  assert(evaluate(rules.concat(siteAllow), clicked("a-ads.example")).action === "allow", "link followed from the allowed site opens");
  assert(evaluate(rules.concat(siteAllow), typed("a-ads.example")).action === "block", "typed URL has no initiator: still blocked (recovery = Allow this domain)");
});

Deno.test("exempt list: one-word reasons, no threat-tier host, real-engagement hosts open but stay blocked for page parts", () => {
  const threat = new Set(threatRules.flatMap((r) => r.condition.requestDomains || []));
  const under = (h, set) => { const p = h.split("."); for (let i = 0; i < p.length - 1; i++) if (set.has(p.slice(i).join("."))) return true; return false; };
  const hosts = Object.entries(FO.NAV_EXEMPT.hosts);
  assert(hosts.length >= 1, "exempt hosts listed");
  for (const [h, why] of hosts) {
    assert(/^[a-z]+$/.test(why), "one-word reason for " + h);
    assert(!under(h, threat), "exempt host is in the threat tier: " + h);
    const rules = mergeLikePacker(`||${h}^\n||${h}^$document\n||sub.${h}^$document`);
    assert(opensPage(rules, h) && opensPage(rules, "sub." + h), "exempt host opens: " + h);
    assert(blocks(rules, sub(h, "script")), "exempt host page parts still blocked: " + h);
    assert(FO.isNavExempt("deep.sub." + h) && !FO.isNavExempt("not" + h), "subdomains only: " + h);
  }
});

Deno.test("settings text: the allow box covers ordinary-list navigation blocks too", () => {
  const box = settingsHtml.slice(settingsHtml.indexOf('id="h-allow"'), settingsHtml.indexOf('id="h-sites"'));
  assert(!/\(threat tier\)<\/h2>/.test(box), "heading no longer limited to the threat tier");
  assert(/blocked page/i.test(box) && /filter lists/i.test(box), "explains it also opens pages the filter lists block");
});

// The shipped static ruleset (BLOCK 6 repack, 2026-11-03).
Deno.test("packed general rules: only deliberate $document rules block opening a page; exempt and stream hosts never", () => {
  let nav = 0;
  const navHosts = new Set();
  for (const r of bundled) {
    if (r.action.type !== "block") continue;
    const c = r.condition;
    const deliberate = (c.resourceTypes || []).includes("main_frame");
    if (c.excludedResourceTypes && !c.resourceTypes) assert(c.excludedResourceTypes.includes("main_frame"), "excluded-only rule without main_frame: " + r.id);
    const d = c.requestDomains[0];
    const hits = ruleMatches(r, typed(d)) || ruleMatches(r, clicked(d));
    assert(hits === deliberate, `rule ${r.id} ${FO.conditionKey(c)} navigation=${hits}`);
    if (!deliberate) continue;
    nav++;
    for (const h of c.requestDomains) {
      navHosts.add(h);
      assert(!FO.isNavExempt(h) && !FO.isNavProtected(h), "navigation block on an exempt / stream host: " + h);
    }
  }
  assert(nav > 0 && navHosts.size > 2500, "the $document rules are there: " + navHosts.size);
  // bug 1 sample from the review: whole-domain AND navigation-blocked now
  const whole = new Set(bundled.filter((r) => r.action.type === "block" && r.priority === 1 && !FO.conditionKey(r.condition)).flatMap((r) => r.condition.requestDomains));
  for (const h of ["a-ads.com", "popcash.net", "adblock-360.com"]) assert(whole.has(h) && navHosts.has(h), "bug 1 host " + h);
  for (const h of ["prime.rambler.ru", "eloqua.com", "exacttarget.com"]) assert(opensPage(bundled, h), "bug 2 host opens: " + h);
});
