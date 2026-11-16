// Wave 2 "lists": $domain= / $from= (initiator scope), $method, $denyallow and
// a plain $all are converted into exact DNR conditions instead of being
// dropped (or, for $all, instead of leaving out the page itself). Never
// widened: a filter that cannot be written exactly is dropped. Checked end to
// end: list text -> parseEntries -> mergeScoped -> buildListRules -> a DNR
// matcher, on the runtime side, and the same rules from the Python packer.
import "../src/threat/psl.js";
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import "../src/general/update.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import { evaluate } from "./fixtures/dnr-matcher.js";

function assert(c, l) { if (!c) throw new Error(l); }
const FO = globalThis.GeneralFilterOptions;
const U = globalThis.GeneralAdblockUpdate;
const TC = globalThis.GeckoThreatCompile;

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

const PY_LOAD = (file, name) => [
  "import importlib.util, json, sys",
  "from pathlib import Path",
  `spec = importlib.util.spec_from_file_location('${name}', Path('${file}'))`,
  "mod = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(mod)",
].join("\n");

// One list text through the runtime pipeline (one list, named easylist).
function rulesFor(text) {
  const parsed = U.parseEntries(text);
  const domains = U.mergeDomains({ easylist: parsed.domains });
  const scoped = U.mergeScoped({ easylist: parsed.scoped }, domains);
  return { parsed, domains, scoped, rules: U.buildListRules(domains, scoped) };
}
const req = (rules, url, type, initiator, method) =>
  evaluate(rules, { url, type, method: method || "get", initiator: initiator === undefined ? null : initiator }).action;

// Parser version 5 since 0.3.6 (WP-14: $generichide / $elemhide page exceptions).
Deno.test("table version 2 and parser version 5 (stored copies parsed by the old table are refetched)", () => {
  assert(FO.TABLE.version === 2, "table version " + FO.TABLE.version);
  assert(U.PARSER_VERSION === 5, "parser version " + U.PARSER_VERSION);
});

Deno.test("$domain=: blocks only from the listed sites, never from excluded subsites, never a navigation", () => {
  const { rules } = rulesFor("||ads.example.com^$script,domain=news.test|~sub.news.test");
  assert(rules.length === 1, JSON.stringify(rules));
  const c = rules[0].condition;
  assert(JSON.stringify(c.initiatorDomains) === '["news.test"]' && JSON.stringify(c.excludedInitiatorDomains) === '["sub.news.test"]', JSON.stringify(c));
  assert(req(rules, "https://ads.example.com/a.js", "script", "news.test") === "block", "script from news.test");
  assert(req(rules, "https://ads.example.com/a.js", "script", "www.news.test") === "block", "script from a subdomain of news.test");
  assert(req(rules, "https://ads.example.com/a.js", "script", "sub.news.test") === "none", "excluded subsite");
  assert(req(rules, "https://ads.example.com/a.js", "script", "other.test") === "none", "other site");
  assert(req(rules, "https://ads.example.com/a.png", "image", "news.test") === "none", "other type");
  assert(req(rules, "https://ads.example.com/", "main_frame", null) === "none", "navigation");
});

Deno.test("$domain= with $document never blocks a navigation; entity and bad hosts never widen", () => {
  for (const line of [
    "||doc.example.com^$document,domain=news.test", // navigation-only scope: dropped
    "||ent.example.com^$domain=google.*", // only include is an entity: dropped
    "||entx.example.com^$domain=~google.*", // excluded entity: dropped
    "||regex.example.com^$domain=/news/", // regex include: dropped
  ]) {
    const { rules } = rulesFor(line);
    assert(rules.length === 0, line + " -> " + JSON.stringify(rules));
  }
  const { rules } = rulesFor("||mixed.example.com^$doc,script,domain=news.test");
  assert(rules.length === 1 && JSON.stringify(rules[0].condition.resourceTypes) === '["script"]', JSON.stringify(rules));
  assert(req(rules, "https://mixed.example.com/", "main_frame", null) === "none", "navigation not blocked");
  // A skipped entity include leaves the other include in place (narrower, never wider).
  const r2 = rulesFor("||entin.example.com^$domain=google.*|news.test").rules;
  assert(r2.length === 1 && JSON.stringify(r2[0].condition.initiatorDomains) === '["news.test"]', JSON.stringify(r2));
  assert(req(r2, "https://entin.example.com/x", "xmlhttprequest", "google.com") === "none", "entity site not blocked");
});

Deno.test("merge: a whole-domain block covers its $domain= entries; never-block and captcha hosts stay unblocked", () => {
  const { scoped, rules } = rulesFor([
    "||whole.example.com^",
    "||whole.example.com^$script,domain=news.test",
    "||cdn.youtube.com^$script,domain=news.test",
    "||hcaptcha.com^$script,domain=news.test",
    "||newassets.hcaptcha.com^$script,domain=news.test",
  ].join("\n"));
  assert(JSON.stringify(scoped) === "[]", JSON.stringify(scoped));
  assert(rules.length === 1 && !rules[0].condition.initiatorDomains, JSON.stringify(rules));
});

Deno.test("$method: requestMethods / excludedRequestMethods; unknown or mixed methods drop the filter", () => {
  const { rules } = rulesFor(["||post.example.com^$method=post", "||nget.example.com^$xhr,method=~get"].join("\n"));
  assert(rules.length === 2, JSON.stringify(rules));
  assert(req(rules, "https://post.example.com/c", "xmlhttprequest", "site.test", "post") === "block", "POST blocked");
  assert(req(rules, "https://post.example.com/c", "xmlhttprequest", "site.test", "get") === "none", "GET allowed");
  assert(req(rules, "https://nget.example.com/c", "xmlhttprequest", "site.test", "get") === "none", "~get: GET allowed");
  assert(req(rules, "https://nget.example.com/c", "xmlhttprequest", "site.test", "post") === "block", "~get: POST blocked");
  for (const line of ["||m1.example.com^$method=bogus", "||m2.example.com^$method=post|~get"]) {
    assert(rulesFor(line).rules.length === 0, line);
  }
});

Deno.test("$denyallow: the listed hosts are excluded from the block; ~host or entities drop the filter", () => {
  const { rules } = rulesFor("||deny.example.com^$script,denyallow=cdn.deny.example.com");
  assert(rules.length === 1 && JSON.stringify(rules[0].condition.excludedRequestDomains) === '["cdn.deny.example.com"]', JSON.stringify(rules));
  assert(req(rules, "https://deny.example.com/a.js", "script", "site.test") === "block", "host blocked");
  assert(req(rules, "https://x.deny.example.com/a.js", "script", "site.test") === "block", "other subdomain blocked");
  assert(req(rules, "https://cdn.deny.example.com/a.js", "script", "site.test") === "none", "denyallow host passes");
  for (const line of ["||d1.example.com^$denyallow=~a.test", "||d2.example.com^$denyallow=foo.*"]) {
    assert(rulesFor(line).rules.length === 0, line);
  }
});

Deno.test("$all: whole-domain block plus the page itself; exempt and stream hosts keep navigation; badfilter cancels both", () => {
  const { domains, scoped, rules } = rulesFor([
    "||all.example.com^$all",
    "||x.redirectingat.com^$all",
    "||gone.example.com^$all",
    "||gone.example.com^$all,badfilter",
  ].join("\n"));
  assert(JSON.stringify(domains) === '["all.example.com","x.redirectingat.com"]', JSON.stringify(domains));
  assert(JSON.stringify(scoped) === '[["all.example.com","p=|t=main_frame|x="]]', JSON.stringify(scoped));
  assert(req(rules, "https://all.example.com/", "main_frame", null) === "block", "navigation blocked");
  assert(req(rules, "https://all.example.com/a.js", "script", "site.test") === "block", "script blocked");
  assert(req(rules, "https://x.redirectingat.com/", "main_frame", null) === "none", "navigation-exempt host opens");
  assert(req(rules, "https://x.redirectingat.com/a.js", "script", "site.test") === "block", "exempt host still blocked as a resource");
  assert(req(rules, "https://gone.example.com/", "main_frame", null) === "none" && req(rules, "https://gone.example.com/a.js", "script", "s.test") === "none", "badfilter");
  // With a party or a domain= the page itself is never added.
  assert(rulesFor("||p.example.com^$all,3p").rules.every((r) => !(r.condition.resourceTypes || []).includes("main_frame")), "party");
  assert(rulesFor("||dd.example.com^$all,domain=news.test").rules.every((r) => !(r.condition.resourceTypes || []).includes("main_frame")), "domain=");
});

// Two lists through the runtime cross-list path (parseEntriesFull ->
// crossListRules -> merge -> rules), as swap() runs it.
function crossRulesFor(listA, listB) {
  const payloads = { easylist: U.parseEntriesFull(listA), easyprivacy: U.parseEntriesFull(listB) };
  const cross = U.crossListRules(payloads);
  const perList = {};
  const perListScoped = {};
  for (const [n, p] of Object.entries(payloads)) {
    perList[n] = p.domains.filter((d) => cross.keepWhole(d));
    perListScoped[n] = (p.scoped || []).filter(([d, k]) => cross.keepScoped(d, k));
  }
  const domains = U.mergeDomains(perList);
  const scoped = U.mergeScoped(perListScoped, domains);
  return { domains, scoped, rules: U.buildListRules(domains, scoped) };
}

const CROSS_CASES = [
  // [list A, list B, main_frame blocked?, script blocked?]
  ["||h.example^$all", "@@||h.example^", false, false],
  ["||h.example^$all,important", "@@||h.example^", true, true],
  ["||h.example^$all\n||h.example^$document", "@@||h.example^", true, false],
  ["||h.example^$all", "@@||h.example^\n||h.example^$document", true, false],
  ["||h.example^$document", "@@||h.example^", true, false],
  ["||h.example^$all", "@@||h.example^$script", true, true],
];

Deno.test("cross-list: a plain @@||host^ also lifts the page entry of that host's $all (not $important, not $document)", () => {
  for (const [a, b, nav, script] of CROSS_CASES) {
    const { rules } = crossRulesFor(a, b);
    const tag = JSON.stringify([a, b]) + " " + JSON.stringify(rules);
    assert(req(rules, "https://h.example/", "main_frame", null) === (nav ? "block" : "none"), "main_frame " + tag);
    assert(req(rules, "https://h.example/a.js", "script", "site.test") === (script ? "block" : "none"), "script " + tag);
  }
  // The per-list shape (fixture) never carries the marker.
  assert(!("alldoc" in U.parseEntries("||h.example^$all")), "parseEntries has no alldoc");
  assert(JSON.stringify(U.parseEntriesFull("||h.example^$all").alldoc) === '["h.example"]', "parseEntriesFull alldoc");
});

Deno.test("cross-list $all lift: Python packer (apply_cross_list) gives the same rules", async () => {
  const js = CROSS_CASES.map(([a, b]) => crossRulesFor(a, b).rules.map((r) => r.condition));
  const out = await runPython(PY_LOAD("scripts/pack-filter-lists.py", "pfl") + "\n" + [
    `cases = json.loads(${JSON.stringify(JSON.stringify(CROSS_CASES.map(([a, b]) => [a, b])))})`,
    "res = []",
    "for a, b in cases:",
    "    la, lb = mod.extract_list(a), mod.extract_list(b)",
    "    buckets = {'easylist': la[0], 'easyprivacy': lb[0]}",
    "    scoped = {'easylist': la[1], 'easyprivacy': lb[1]}",
    "    buckets, scoped = mod.apply_cross_list(buckets, scoped, [la, lb])",
    "    domains, _ = mod.merge_domains(buckets)",
    "    sc, _ = mod.merge_scoped(scoped, domains)",
    "    res.append([r['condition'] for r in mod.domains_to_dnr_rules(domains, sc)])",
    "print(json.dumps(res))",
  ].join("\n"));
  const py = JSON.parse(out);
  const canon = (arr) => arr.map((c) => JSON.stringify(Object.fromEntries(Object.keys(c).sort().map((k) => [k, c[k]])))).sort();
  CROSS_CASES.forEach((c, i) => {
    assert(JSON.stringify(canon(py[i])) === JSON.stringify(canon(js[i])), JSON.stringify(c) + "\npython " + JSON.stringify(py[i]) + "\njs " + JSON.stringify(js[i]));
  });
  assert(py[0].length === 0, "first case blocks nothing: " + JSON.stringify(py[0]));
});

Deno.test("$all: threat lists still promote the host to the threat tier (key '' kept)", () => {
  const parsed = U.parseEntries("||bad-all.example.com^$all\n||bad-doc.example.com^$doc\n||bad-3p.example.com^$all,3p");
  const hosts = TC.threatHostsFromEntries(parsed);
  assert(JSON.stringify(hosts) === '["bad-all.example.com","bad-doc.example.com"]', JSON.stringify(hosts));
});

Deno.test("packed rules with the new fields round-trip through conditionKey (swap fallback keeps their scope)", () => {
  const { rules } = rulesFor([
    "||a.example.com^$script,third-party,domain=news.test|~sub.news.test,method=get,denyallow=cdn.test",
    // Was `$domain=~x.test`: exclusion-only filters are dropped since final
    // review #0, so an include + exclude form keeps the n= round trip tested.
    "||b.example.com^$domain=y.test|~x.y.test",
  ].join("\n"));
  for (const r of rules) {
    const key = FO.conditionKey(r.condition);
    assert(JSON.stringify(FO.keyToCondition(key)) === JSON.stringify(Object.fromEntries(Object.entries(r.condition).filter(([k]) => k !== "requestDomains"))), key);
  }
});

const PARITY_TEXT = [
  "||w.example.com^",
  "||w.example.com^$script,domain=a.test",
  "||s1.example.com^$script,domain=a.test|b.test",
  "||s2.example.com^$domain=b.test|a.test,script",
  "||s3.example.com^$image,domain=c.test|~d.c.test", // was domain=~c.test (exclusion-only, dropped since final review #0)
  "||s4.example.com^$method=post",
  "||s5.example.com^$xhr,denyallow=cdn.s5.example.com",
  "||s6.example.com^$all",
  "||cdn.youtube.com^$script,domain=a.test",
  "||s7.example.com^$doc,domain=a.test",
].join("\n");

Deno.test("Python packer builds the same block rules as the runtime for the same list", async () => {
  const js = rulesFor(PARITY_TEXT).rules.map((r) => r.condition);
  const out = await runPython(PY_LOAD("scripts/pack-filter-lists.py", "pfl") + "\n" + [
    `text = ${JSON.stringify(PARITY_TEXT)}`,
    "whole, scoped = mod.extract_entries(text)",
    "domains, _ = mod.merge_domains({'easylist': whole})",
    "sc, _ = mod.merge_scoped({'easylist': scoped}, domains)",
    "print(json.dumps([r['condition'] for r in mod.domains_to_dnr_rules(domains, sc)]))",
  ].join("\n"));
  const py = JSON.parse(out);
  const canon = (arr) => arr.map((c) => JSON.stringify(Object.fromEntries(Object.keys(c).sort().map((k) => [k, c[k]])))).sort();
  assert(JSON.stringify(canon(py)) === JSON.stringify(canon(js)), "python " + JSON.stringify(py) + "\njs " + JSON.stringify(js));
  // s1 and s2 share one rule (same sorted initiator list); s7 is dropped.
  const shared = js.find((c) => (c.requestDomains || []).includes("s1.example.com"));
  assert(shared && shared.requestDomains.join() === "s1.example.com,s2.example.com", JSON.stringify(js));
  assert(!js.some((c) => (c.requestDomains || []).includes("s7.example.com")), "doc + domain= dropped");
});

Deno.test("merger copies every narrowing field and refuses a field it does not know", async () => {
  const out = await runPython(PY_LOAD("scripts/merge-dnr-rules.py", "mdr") + "\n" + [
    "cond = {'requestDomains': ['a.example.com'], 'resourceTypes': ['script'], 'domainType': 'thirdParty',",
    "        'initiatorDomains': ['a.test'], 'excludedInitiatorDomains': ['b.a.test'], 'requestMethods': ['get'],",
    "        'excludedRequestMethods': ['post'], 'excludedRequestDomains': ['cdn.test'], 'excludedResourceTypes': ['image']}",
    "rules = mod.renumber_blocks([{'id': 1, 'priority': 1, 'action': {'type': 'block'}, 'condition': cond}])",
    "try:",
    "    mod.renumber_blocks([{'id': 2, 'priority': 1, 'action': {'type': 'block'}, 'condition': {'requestDomains': ['x.test'], 'urlFilter': '/ad'}}])",
    "    refused = False",
    "except ValueError:",
    "    refused = True",
    "print(json.dumps({'cond': rules[0]['condition'], 'keys': list(mod.SCOPED_CONDITION_KEYS), 'refused': refused}))",
  ].join("\n"));
  const res = JSON.parse(out);
  assert(Object.keys(res.cond).length === 9, JSON.stringify(res.cond));
  assert(res.refused, "unknown field refused");
  // Every field keyToCondition can emit is one the merger copies.
  const all = FO.keyToCondition("p=thirdParty|t=script|x=image|i=a.test|n=b.test|m=get|mx=post|d=c.test");
  for (const k of Object.keys(all)) assert(res.keys.includes(k), "merger drops " + k);
});

Deno.test("packer: no silent cut at the rule budget (main() refuses an over-budget pack instead)", async () => {
  const out = await runPython(PY_LOAD("scripts/pack-filter-lists.py", "pfl") + "\n" + [
    "mod.MAX_DNR_RULES = 2",
    "rules = mod.domains_to_dnr_rules(['a%d.example.com' % i for i in range(81)], [['s.example.com', 'p=|t=script|x=|i=a.test']])",
    "src = Path('scripts/pack-filter-lists.py').read_text(encoding='utf-8')",
    "print(json.dumps({'n': len(rules), 'check': 'if len(rules) > MAX_DNR_RULES:' in src and src.index('if len(rules) > MAX_DNR_RULES:') < src.index('blocks_path.write_text(')}))",
  ].join("\n"));
  const res = JSON.parse(out);
  assert(res.n === 3, "all rules returned: " + res.n);
  assert(res.check, "budget checked before the block file is written");
});
