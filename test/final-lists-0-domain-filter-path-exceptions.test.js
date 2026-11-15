// Final review #0 (0.3.5): $domain= filters were converted, but the path /
// option exceptions that limit them upstream were still ignored.
// EasyPrivacy line 4160 `||adobedtm.com^$third-party,domain=~adobe.com|~costco.com`
// is limited by `@@||adobedtm.com/launch-$script,xmlhttprequest` (56436) and
// the satelliteLib / -source.min.js site lists; without them Adobe Launch was
// blocked on every other site (login and checkout pages break).
// Fix (packer and runtime, same rules):
//  (a) an exclusion-only `$domain=~a|~b` filter is dropped again, as in 0.3.4;
//  (b) a $domain= filter is dropped when any list has an `@@||host...`
//      exception with a path or options for its host, a subdomain or a parent.
// Shared cases: test/fixtures/filter-options-cases.json "cross".
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import cases from "./fixtures/filter-options-cases.json" with { type: "json" };
import { evaluate } from "./fixtures/dnr-matcher.js";

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

// The runtime path swap() takes: parseEntriesFull -> crossListRules ->
// crossScoped -> mergeDomains / mergeScoped.
export function runtimeCross(lists) {
  const payloads = {};
  for (const [n, t] of Object.entries(lists)) payloads[n] = U.parseEntriesFull(t);
  const cross = U.crossListRules(payloads);
  const perList = {};
  const perScoped = {};
  for (const [n, p] of Object.entries(payloads)) {
    perList[n] = p.domains.filter((d) => cross.keepWhole(d));
    perScoped[n] = U.crossScoped(cross, p.scoped);
  }
  const domains = U.mergeDomains(perList);
  return { domains, scoped: U.mergeScoped(perScoped, domains) };
}

const PY_CROSS = [
  "import importlib.util, json",
  "from collections import OrderedDict",
  "from pathlib import Path",
  "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
  "mod = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(mod)",
  "cases = json.loads(Path('test/fixtures/filter-options-cases.json').read_text(encoding='utf-8'))['cross']",
  "out = []",
  "for c in cases:",
  "    names = [n for n in mod.SOURCES if n in c['lists']]",
  "    buckets = OrderedDict(); scoped = OrderedDict(); lists = []",
  "    for n in names:",
  "        e = mod.extract_list(c['lists'][n]); lists.append(e)",
  "        buckets[n], scoped[n] = e",
  "    buckets, scoped = mod.apply_cross_list(buckets, scoped, lists)",
  "    domains, _ = mod.merge_domains(buckets)",
  "    sc, _ = mod.merge_scoped(scoped, domains)",
  "    out.append({'domains': domains, 'scoped': sc})",
  "print(json.dumps(out))",
].join("\n");

Deno.test("#0 (a): exclusion-only $domain=~ filters are dropped again (adobedtm.com), JS and Python", async () => {
  const line = "||adobedtm.com^$third-party,domain=~adobe.com|~costco.com";
  assert(FO.convertLine(line) === null, "JS converts " + JSON.stringify(FO.convertLine(line)));
  assert(FO.convertOptions("$domain=~a.test") === null, "JS plain exclusion-only");
  // A positive host keeps the filter, with its ~ exclusions.
  assert(JSON.stringify(FO.convertLine("||ads.example.com^$script,domain=a.test|~b.a.test")) === '["ads.example.com","p=|t=script|x=|i=a.test|n=b.a.test",false]', "include + exclude kept");
  const py = JSON.parse(await runPython([
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    `print(json.dumps([mod.convert_line(${JSON.stringify(line)}), mod.convert_options('$domain=~a.test')]))`,
  ].join("\n")));
  assert(py[0] === null && py[1] === null, "Python converts " + JSON.stringify(py));
});

Deno.test("#0 (b): path / option exceptions drop the $domain= filters of that host (shared cross case, JS and Python)", async () => {
  const py = JSON.parse(await runPython(PY_CROSS));
  cases.cross.forEach((c, i) => {
    const js = runtimeCross(c.lists);
    assert(JSON.stringify(js) === JSON.stringify(c.expect), "js cross " + i + ": " + JSON.stringify(js));
    assert(JSON.stringify(py[i]) === JSON.stringify(c.expect), "python cross " + i + ": " + JSON.stringify(py[i]));
  });
});

Deno.test("#0: adobedtm.com, anyclip and viously are not blocked from other sites; unrelated $domain= rules still block", () => {
  const { domains, scoped } = runtimeCross(cases.cross[0].lists);
  const rules = U.buildListRules(domains, scoped);
  const req = (url, type, initiator) => evaluate(rules, { url, type, method: "get", initiator }).action;
  assert(req("https://assets.adobedtm.com/launch-abc.min.js", "script", "americanexpress.com") === "none", "Adobe Launch blocked on americanexpress.com");
  assert(req("https://assets.adobedtm.com/x.js", "script", "news.test") === "none", "adobedtm subdomain filter kept");
  assert(req("https://player.anyclip.com/player.js", "script", "zerotackle.com") === "none", "anyclip blocked on zerotackle.com");
  assert(req("https://viously.com/a.js", "script", "clubic.com") === "none", "viously blocked on clubic.com");
  assert(req("https://other.example/a.js", "script", "news.test") === "block", "control $domain= rule missing");
  assert(req("https://typed.limited.example/a.js", "script", "site.test") === "block", "a typed (no $domain=) filter is not touched");
  // The per-list fixture shape never carries the new field.
  assert(!("limit" in U.parseEntries("@@||a.example/x.js")), "parseEntries has no limit");
  assert(JSON.stringify(U.parseEntriesFull("@@||a.example/x.js\n@@||b.example^$script\n@@||c.example^").limit) === '["a.example","b.example"]', "limit hosts");
});
