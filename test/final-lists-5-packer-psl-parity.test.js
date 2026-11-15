// Final review #5 (0.3.5): the packer's public-suffix check no longer
// matched the runtime. src/threat/psl.js gained icannDeep (k12.ca.us,
// act.edu.au), wildcardBases (*.kawasaki.jp) and icannExceptions
// (!city.kawasaki.jp, !www.ck); runtime isIcannSuffix uses them, the packer's
// is_public_suffix read only `suffixes` + `wildcardTlds`. So `||k12.ca.us^`
// would ship as a whole-domain block that the first refresh removes.
// Fix: is_public_suffix mirrors isIcannSuffix. Shared case:
// test/fixtures/filter-options-cases.json "psl".
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import cases from "./fixtures/filter-options-cases.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l); }
const PS = globalThis.GeckoPublicSuffix;
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

Deno.test("#5: runtime isIcannSuffix and packer is_public_suffix agree on the shared hosts and list", async () => {
  const hosts = Object.keys(cases.psl.hosts);
  for (const h of hosts) assert(PS.isIcannSuffix(h) === cases.psl.hosts[h], "js " + h + " -> " + PS.isIcannSuffix(h));
  const js = U.parseEntries(cases.psl.list);
  assert(JSON.stringify(js) === JSON.stringify(cases.psl.expect), "js list " + JSON.stringify(js));
  const py = JSON.parse(await runPython([
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "c = json.loads(Path('test/fixtures/filter-options-cases.json').read_text(encoding='utf-8'))['psl']",
    "whole, scoped = mod.extract_entries(c['list'])",
    "print(json.dumps({'hosts': {h: mod.is_public_suffix(h) for h in c['hosts']}, 'list': {'domains': whole, 'scoped': scoped}}))",
  ].join("\n")));
  for (const h of hosts) assert(py.hosts[h] === cases.psl.hosts[h], "python " + h + " -> " + py.hosts[h]);
  assert(JSON.stringify(py.list) === JSON.stringify(cases.psl.expect), "python list " + JSON.stringify(py.list));
});
