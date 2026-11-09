// H-2: filter options are converted faithfully (scope kept or filter dropped,
// never widened to a whole-domain block), by ONE table used by the runtime
// refresh and the packer. Both sides must give identical output for the shared
// fixture test/fixtures/filter-options-cases.json.
import "../src/general/filter-options.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import cases from "./fixtures/filter-options-cases.json" with { type: "json" };
import generalRules from "../src/rules/general-network.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }
const FO = globalThis.GeneralFilterOptions;
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

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
  "cases = json.loads(Path('test/fixtures/filter-options-cases.json').read_text(encoding='utf-8'))",
].join("\n");

Deno.test("shared table: JS conversion matches every fixture line", () => {
  for (const c of cases.lines) {
    const got = FO.convertLine(c.line);
    assert(JSON.stringify(got) === JSON.stringify(c.expect), c.line + " -> " + JSON.stringify(got) + " expected " + JSON.stringify(c.expect));
  }
});

Deno.test("shared table: Python packer gives identical output for every fixture line and list", async () => {
  const out = await runPython(PY_LOAD + "\n" + [
    "lines = [mod.convert_line(c['line']) for c in cases['lines']]",
    "lists = []",
    "for c in cases['lists']:",
    "    whole, scoped = mod.extract_entries(c['text'])",
    "    lists.append({'domains': whole, 'scoped': scoped})",
    "print(json.dumps({'lines': lines, 'lists': lists}))",
  ].join("\n"));
  const py = JSON.parse(out);
  cases.lines.forEach((c, i) => {
    assert(JSON.stringify(py.lines[i]) === JSON.stringify(c.expect), "python: " + c.line + " -> " + JSON.stringify(py.lines[i]));
  });
  cases.lists.forEach((c, i) => {
    assert(JSON.stringify(py.lists[i]) === JSON.stringify(c.expect), "python list " + i + ": " + JSON.stringify(py.lists[i]));
    const js = U.parseEntries(c.text);
    assert(JSON.stringify(js) === JSON.stringify(c.expect), "js list " + i + ": " + JSON.stringify(js));
  });
});

// Bug 2 (2026-11-03): a key with only excluded types must turn into a DNR
// condition that also excludes main_frame, on both sides; keys round-trip.
const canon = (o) => JSON.stringify(Object.fromEntries(Object.keys(o || {}).sort().map((k) => [k, o[k]])));
Deno.test("shared cases: scope keys turn into the expected DNR conditions in JS and in Python", async () => {
  const withCond = cases.lines.filter((c) => c.condition && c.expect);
  assert(withCond.length >= 12, "condition cases present");
  for (const c of withCond) {
    const got = FO.keyToCondition(c.expect[1]);
    assert(canon(got) === canon(c.condition), "js " + c.line + " -> " + canon(got) + " expected " + canon(c.condition));
    assert(FO.conditionKey(got) === c.expect[1], "js round trip " + c.line + " -> " + FO.conditionKey(got));
  }
  const out = await runPython(PY_LOAD + "\nprint(json.dumps([mod.key_to_condition(c['expect'][1]) for c in cases['lines'] if c.get('condition') is not None and c['expect']]))");
  const py = JSON.parse(out);
  withCond.forEach((c, i) => assert(canon(py[i]) === canon(c.condition), "python " + c.line + " -> " + canon(py[i]) + " expected " + canon(c.condition)));
});

Deno.test("conditionKey: packed excluded-only rules from before and after the main_frame fix give the same key", () => {
  assert(FO.conditionKey({ requestDomains: ["a.example"], excludedResourceTypes: ["script"] }) === "p=|t=|x=script", "old packed shape");
  assert(FO.conditionKey({ requestDomains: ["a.example"], excludedResourceTypes: ["main_frame", "script"] }) === "p=|t=|x=script", "new packed shape");
  assert(FO.conditionKey({ domainType: "thirdParty", excludedResourceTypes: ["main_frame", "stylesheet"] }) === "p=thirdParty|t=|x=stylesheet", "party + excluded");
  assert(FO.conditionKey({ excludedResourceTypes: ["main_frame"] }) === "", "only main_frame excluded = whole domain");
  assert(FO.conditionKey({ resourceTypes: ["main_frame"] }) === "p=|t=main_frame|x=", "explicit $doc key untouched");
});

Deno.test("Python reads the same option table as the runtime", async () => {
  const out = await runPython(PY_LOAD + "\nprint(json.dumps(mod.OPTION_TABLE, sort_keys=True))");
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  assert(JSON.stringify(sorted(JSON.parse(out))) === JSON.stringify(sorted(FO.TABLE)), "table differs");
});

Deno.test("scoped keys round-trip to DNR conditions, and rules group by scope", () => {
  for (const c of cases.lines) {
    if (!c.expect || !c.expect[1]) continue;
    const cond = FO.keyToCondition(c.expect[1]);
    assert(FO.conditionKey(cond) === c.expect[1], "round trip " + c.expect[1]);
    for (const t of [].concat(cond.resourceTypes || [], cond.excludedResourceTypes || [])) {
      assert(["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"].includes(t), "valid DNR type " + t);
    }
    // Only an explicit $doc/$document filter may block navigations.
    if ((cond.resourceTypes || []).includes("main_frame")) assert(/\$doc(ument)?$/.test(c.line) && cond.resourceTypes.length === 1, "main_frame only from $doc: " + c.line);
  }
  const rules = U.buildListRules(["w1.example", "w2.example"], [["s.example", "p=|t=ping|x="], ["t.example", "p=thirdParty|t=sub_frame|x="], ["u.example", "p=|t=ping|x="]]);
  assert(rules.length === 3, "1 whole + 2 scope groups: " + JSON.stringify(rules));
  assert(!rules[0].condition.resourceTypes && rules[0].condition.requestDomains.length === 2, "whole batch");
  const ping = rules.find((r) => r.condition.resourceTypes && r.condition.resourceTypes[0] === "ping");
  assert(ping && ping.condition.requestDomains.join() === "s.example,u.example" && !ping.condition.domainType, "ping group");
  const frame = rules.find((r) => r.condition.domainType === "thirdParty");
  assert(frame && frame.condition.resourceTypes.join() === "sub_frame", "third-party frame group");
});

Deno.test("merge: a scoped entry for a domain that is also a whole-domain block is dropped; never-block hosts dropped", () => {
  const scoped = U.mergeScoped({ easylist: [["dup.example", "p=|t=script|x="], ["only.example", "p=|t=script|x="], ["cdn.youtube.com", "p=|t=script|x="]] }, ["dup.example"]);
  assert(JSON.stringify(scoped) === JSON.stringify([["only.example", "p=|t=script|x="]]), JSON.stringify(scoped));
});

// Known widened domains (analysis/notes/widened-domains.txt, checked 2026-11-02):
// each existed in the shipped rules only because of a scoped filter.
const WIDENED = ["soundcloud.com", "s1.wp.com", "onetrust.com", "a2zapk.com", "brightline.tv", "objects.tremormedia.com", "go.onelink.me", "click.alibaba.com", "bookingdragon.com", "parts.akibablog.net"];

Deno.test("regression: known widened domains are no longer whole-domain blocks in the packed rules", () => {
  const wholeBlocked = new Set();
  for (const r of generalRules) {
    if (r.action.type !== "block" || r.priority !== 1) continue;
    const c = r.condition;
    if (c.resourceTypes || c.excludedResourceTypes || c.domainType || c.initiatorDomains) continue;
    for (const d of c.requestDomains || []) wholeBlocked.add(d);
  }
  assert(wholeBlocked.size > 1000, "sanity: packed whole-domain blocks present");
  for (const d of WIDENED) assert(!wholeBlocked.has(d), d + " is still a whole-domain block");
});

Deno.test("regression: the runtime parser keeps those filters scoped (never whole-domain)", () => {
  const text = [
    "||soundcloud.com^$ping",
    "||s1.wp.com^$subdocument,third-party",
    "||onetrust.com^$ping",
    "||brightline.tv^$third-party,~xmlhttprequest",
  ].join("\n");
  const { domains, scoped } = U.parseEntries(text);
  assert(domains.length === 0, "widened: " + domains.join());
  assert(scoped.length === 4, JSON.stringify(scoped));
  const rules = U.buildListRules(domains, scoped);
  for (const r of rules) assert(r.condition.resourceTypes || r.condition.excludedResourceTypes || r.condition.domainType, "rule without scope: " + JSON.stringify(r));
});
