// Which list rules may block opening a page (main_frame), checked with the DNR
// matcher that follows Chrome (test/fixtures/dnr-matcher.js; Chrome for Testing
// 155 probe 2026-11-03, BUILD-PROGRESS "NEXT BUILD 2").
// Bug 2: negated-only types (`$~script`, `$~stylesheet,third-party`) used to
// become rules with only excludedResourceTypes, which Chrome also matches for
// main_frame, so following a link to e.g. prime.rambler.ru or (third-party)
// eloqua.com failed although the lists only meant their page parts.
import "../src/general/filter-options.js";
import source from "../src/general/update.js" with { type: "text" };
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
    setStaticEnabled: async () => {}, loadBundled: async () => ({ rules: bundled, extraIds: [EXTRA_ID] }),
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
