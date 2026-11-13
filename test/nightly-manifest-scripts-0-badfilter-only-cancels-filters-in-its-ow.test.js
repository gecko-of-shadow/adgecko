// $badfilter in one list (AdGuard Base "without EasyList") must cancel the same
// filter coming from another list (EasyList), as uBO does across loaded lists.
// Real case: AdGuard 2_without_easylist.txt "! Fixed totaladblock.com site" has
// ||totaladblock.com^$badfilter and ||totaladblock.com^$document,badfilter,
// while EasyList has ||totaladblock.com^ and ||totaladblock.com^$document.
// Test edited by the fix: the original called only the per-list
// extract_entries() and then merge_domains(), so it had no place for a
// cross-list step. It now runs the same pipeline as main() (extract_list ->
// apply_cross_list -> merge). The assertions are unchanged.
function assert(condition, label) {
  if (!condition) throw new Error(label);
}

Deno.test("packer: $badfilter cancels the same filter from another list", async () => {
  const script = [
    "import importlib.util, json",
    "from collections import OrderedDict",
    "from pathlib import Path",
    "p = Path('scripts/pack-filter-lists.py')",
    "spec = importlib.util.spec_from_file_location('pfl', p)",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "texts = OrderedDict()",
    "texts['adguard_base'] = '''! Fixed totaladblock.com site",
    "||totaladblock.com^$badfilter",
    "||totaladblock.com^$document,badfilter",
    "||shieldload.neoseeker.com^$badfilter'''",
    "texts['easylist'] = '''||totaladblock.com^",
    "||totaladblock.com^$document",
    "||shieldload.neoseeker.com^",
    "||ok.example.com^'''",
    // The cross-list step runs between extraction and merging, as in main().
    "buckets = OrderedDict(); scoped = OrderedDict(); lists = []",
    "for n, t in texts.items():",
    "    e = mod.extract_list(t); lists.append(e)",
    "    buckets[n], scoped[n] = e",
    "buckets, scoped = mod.apply_cross_list(buckets, scoped, lists)",
    "domains, _ = mod.merge_domains(buckets)",
    "sc, _ = mod.merge_scoped(scoped, domains)",
    "print(json.dumps({'domains': domains, 'scoped': sc}))",
  ].join("\n");
  const root = new URL("..", import.meta.url);
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  let out = null;
  const tried = [];
  for (const [bin, ...pre] of bins) {
    try {
      const res = await new Deno.Command(bin, { args: [...pre, "-c", script], cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      if (res.code === 9009 || /Python was not found|Microsoft Store/.test(new TextDecoder().decode(res.stderr))) {
        tried.push(bin + ": Store alias");
        continue;
      }
      out = res;
      break;
    } catch (err) {
      tried.push(bin + ": " + String(err && err.message || err));
    }
  }
  assert(out, "no usable Python 3 (" + tried.join("; ") + ")");
  assert(out.code === 0, new TextDecoder().decode(out.stderr));
  const res = JSON.parse(new TextDecoder().decode(out.stdout));
  assert(res.domains.includes("ok.example.com"), "control filter missing: " + JSON.stringify(res));
  const shipped = res.domains.filter((d) => d === "totaladblock.com" || d === "shieldload.neoseeker.com")
    .concat(res.scoped.filter(([d]) => d === "totaladblock.com" || d === "shieldload.neoseeker.com").map((e) => e.join("$")));
  assert(shipped.length === 0, "badfilter'd entries from another list still ship: " + JSON.stringify(shipped));
});

// Runtime refresh: the same cross-list cancel (parseEntriesFull + crossListRules, as swap() uses them).
Deno.test("runtime: $badfilter cancels the same filter from another list", async () => {
  await import("../src/general/filter-options.js");
  await import("../src/threat/psl.js");
  await import("../src/general/never-block-captcha.js");
  const src = await Deno.readTextFile(new URL("../src/general/update.js", import.meta.url));
  const U = {};
  new Function(`${src}\nreturn installGeneralAdblockUpdate;`)()(U);
  const payloads = {
    easylist: U.parseEntriesFull("||totaladblock.com^\n||totaladblock.com^$document\n||shieldload.neoseeker.com^\n||ok.example.com^"),
    adguard_base: U.parseEntriesFull("||totaladblock.com^$badfilter\n||totaladblock.com^$document,badfilter\n||shieldload.neoseeker.com^$badfilter"),
  };
  const cross = U.crossListRules(payloads);
  const perList = {};
  const perScoped = {};
  for (const [n, p] of Object.entries(payloads)) {
    perList[n] = p.domains.filter((d) => cross.keepWhole(d));
    perScoped[n] = p.scoped.filter(([d, k]) => cross.keepScoped(d, k));
  }
  const domains = U.mergeDomains(perList);
  const scoped = U.mergeScoped(perScoped, domains);
  assert(domains.includes("ok.example.com"), "control filter missing");
  const shipped = domains.filter((d) => d !== "ok.example.com").concat(scoped.map((e) => e.join("$")));
  assert(shipped.length === 0, "runtime: badfilter'd entries from another list still ship: " + JSON.stringify(shipped));
});
