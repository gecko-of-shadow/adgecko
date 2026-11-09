import updateSource from "../src/general/update.js" with { type: "text" };
import generalRules from "../src/rules/general-network.json" with { type: "json" };
import threatRules from "../src/rules/threat-network.json" with { type: "json" };
import threatSnapshot from "../src/rules/threat-snapshot.json" with { type: "json" };
import youtubeRules from "../src/rules/ubo-youtube-network.json" with { type: "json" };

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function runPython(script) {
  const root = new URL("..", import.meta.url);
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  let out = null;
  const tried = [];
  for (const [bin, ...pre] of bins) {
    try {
      const res = await new Deno.Command(bin, { args: [...pre, "-c", script], cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      if (res.code === 9009 || /Python was not found|Microsoft Store/.test(new TextDecoder().decode(res.stderr))) {
        tried.push(bin + ": Store alias, not a real Python");
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
  return new TextDecoder().decode(out.stdout).replace(/\r/g, "").trim();
}

Deno.test("packer never-blocks hCaptcha hosts (whole-domain and scoped) and keeps lookalikes", async () => {
  const script = [
    "import importlib.util",
    "from pathlib import Path",
    "p = Path('scripts/pack-filter-lists.py')",
    "spec = importlib.util.spec_from_file_location('pfl', p)",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "whole_text = '''||hcaptcha.com^",
    "||a.hcaptcha.com^",
    "||sentry.hcaptcha.com^",
    "||stats.hcaptcha.com^",
    "||nothcaptcha.com^",
    "||hcaptcha.com.evil.example^'''",
    "scoped_text = '''||hcaptcha.com^$script",
    "||a.hcaptcha.com^$script",
    "||sentry.hcaptcha.com^$script",
    "||stats.hcaptcha.com^$script",
    "||scopedlook.example^$script",
    "||nothcaptcha.org^$script",
    "||hcaptcha.com.evil.test^$script'''",
    "merged, _s = mod.merge_domains({'peter_lowe': mod.extract_domains(whole_text)})",
    "entries = mod.extract_entries(scoped_text)[1]",
    "scoped, _t = mod.merge_scoped({'peter_lowe': entries}, [])",
    "print(','.join(merged))",
    "print(','.join(sorted(d for d, _k in scoped)))",
  ].join("\n");
  const lines = (await runPython(script)).split("\n");
  assert(lines[0] === "nothcaptcha.com,hcaptcha.com.evil.example", "whole: " + JSON.stringify(lines[0]));
  assert(
    lines[1] === "hcaptcha.com.evil.test,nothcaptcha.org,scopedlook.example",
    "scoped: " + JSON.stringify(lines[1]),
  );
});

Deno.test("merger drops hCaptcha hosts from stale block rules, in memory only", async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "p = Path('scripts/merge-dnr-rules.py')",
    "spec = importlib.util.spec_from_file_location('mdr', p)",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "def rule(i, domains, extra=None):",
    "    cond = {'requestDomains': domains}",
    "    cond.update(extra or {})",
    "    return {'id': i, 'priority': 1, 'action': {'type': 'block'}, 'condition': cond}",
    "blocks = [",
    "    rule(1, ['hcaptcha.com', 'a.hcaptcha.com', 'keep.example', 'nothcaptcha.com']),",
    "    rule(2, ['sentry.hcaptcha.com', 'stats.hcaptcha.com']),",
    "    rule(3, ['stats.hcaptcha.com', 'hcaptcha.com.evil.example'], {'resourceTypes': ['script']}),",
    "]",
    "out, removed = mod.drop_hcaptcha(blocks)",
    "print(json.dumps({'out': out, 'removed': removed}))",
  ].join("\n");
  const res = JSON.parse(await runPython(script));
  const isH = (d) => d === "hcaptcha.com" || d.endsWith(".hcaptcha.com");
  for (const r of res.out) {
    for (const d of r.condition.requestDomains) assert(!isH(d), "hCaptcha host left: " + d);
  }
  assert(res.removed === 5, "removed count: " + res.removed);
  assert(res.out.length === 2, "the all-hCaptcha rule is dropped: " + res.out.length);
  const all = res.out.flatMap((r) => r.condition.requestDomains);
  assert(all.includes("keep.example"), "ordinary host kept");
  assert(all.includes("nothcaptcha.com"), "nothcaptcha.com kept");
  assert(all.includes("hcaptcha.com.evil.example"), "hcaptcha.com.evil.example kept");
  assert(res.out[1].condition.resourceTypes[0] === "script", "scope kept on the surviving scoped rule");
});

Deno.test("parity: captcha never-block list matches across packer, runtime, merger, threat hosts and meta.json", async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "spec2 = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
    "merger = importlib.util.module_from_spec(spec2)",
    "spec2.loader.exec_module(merger)",
    "print(json.dumps([list(mod.NEVER_BLOCK_CAPTCHA), 'hcaptcha.com' in mod.NEVER_BLOCK_SUFFIXES, list(merger.HCAPTCHA_SUFFIXES)]))",
  ].join("\n");
  const py = JSON.parse(await runPython(script));
  assert(JSON.stringify(py[0]) === '["hcaptcha.com"]', "packer captcha list: " + JSON.stringify(py[0]));
  assert(py[1] === false, "packer NEVER_BLOCK_SUFFIXES still holds hcaptcha.com");
  assert(JSON.stringify(py[2]) === JSON.stringify(py[0]), "merger captcha list drifted: " + JSON.stringify(py[2]));
  const c = /const NEVER_BLOCK_CAPTCHA = \[([\s\S]*?)\];/.exec(updateSource);
  const runtime = JSON.parse("[" + c[1].replace(/,\s*$/, "") + "]");
  assert(JSON.stringify(runtime) === JSON.stringify(py[0]), "runtime captcha list: " + JSON.stringify(runtime));
  const m = /const NEVER_BLOCK_SUFFIXES = \[([\s\S]*?)\];/.exec(updateSource);
  assert(m && !/"hcaptcha\.com"/.test(m[1]), "runtime NEVER_BLOCK_SUFFIXES still holds hcaptcha.com");
  const ph = await Deno.readTextFile(new URL("../src/threat/protected-hosts.js", import.meta.url));
  const cap = /const CAPTCHA = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(ph);
  const threat = JSON.parse("[" + cap[1].replace(/,\s*$/, "") + "]");
  assert(JSON.stringify(threat) === JSON.stringify(py[0]), "threat captcha list: " + JSON.stringify(threat));
  const meta = JSON.parse(await Deno.readTextFile(new URL("../src/rules/meta.json", import.meta.url)));
  for (const host of py[0]) assert(meta.never_block_suffixes.includes(host), "meta.json never_block_suffixes omits " + host);
  const stream = new Set(meta.never_block_suffixes.filter((host) => !py[0].includes(host)));
  assert(stream.size === meta.never_block_suffixes.length - py[0].length, "captcha host listed twice in meta");
});

Deno.test("merger: an allow rule naming hcaptcha.com survives unchanged, a matching block rule is cleaned", async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "def rule(i, t, domains):",
    "    return {'id': i, 'priority': 1, 'action': {'type': t}, 'condition': {'requestDomains': domains}}",
    "allow = rule(1, 'allow', ['hcaptcha.com', 'a.hcaptcha.com'])",
    "block = rule(2, 'block', ['hcaptcha.com', 'keep.example'])",
    "out, removed = mod.drop_hcaptcha([allow, block])",
    "print(json.dumps({'allow': allow, 'out': out, 'removed': removed}))",
  ].join("\n");
  const res = JSON.parse(await runPython(script));
  assert(res.out.length === 2, "both rules kept: " + res.out.length);
  assert(JSON.stringify(res.out[0]) === JSON.stringify(res.allow), "allow rule unchanged");
  assert(JSON.stringify(res.out[1].condition.requestDomains) === '["keep.example"]', "block rule cleaned");
  assert(res.removed === 1, "removed count: " + res.removed);
});

function isHcaptchaHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  return h === "hcaptcha.com" || h.endsWith(".hcaptcha.com");
}

Deno.test("shipped block rules name no hCaptcha host", () => {
  const sets = [["general", generalRules], ["threat", threatRules], ["youtube", youtubeRules]];
  for (const [name, rules] of sets) {
    for (const rule of rules) {
      if (!rule.action || rule.action.type !== "block") continue;
      for (const host of (rule.condition && rule.condition.requestDomains) || []) {
        assert(!isHcaptchaHost(host), name + " blocks " + host);
      }
      const uf = rule.condition && rule.condition.urlFilter;
      if (typeof uf === "string") assert(!/(^|\|\|)(\*\.)?hcaptcha\.com([\/^:*?]|$)/i.test(uf), name + " urlFilter " + uf);
      const rf = rule.condition && rule.condition.regexFilter;
      if (typeof rf === "string") assert(!/(?<![a-z0-9])hcaptcha\\.com(?![a-z0-9.-])/i.test(rf.replace(/\\\./g, ".")), name + " regexFilter");
    }
  }
  const snap = JSON.stringify(threatSnapshot);
  assert(!/(^|[^a-z0-9-])hcaptcha\.com(?![a-z0-9.-])/i.test(snap), "threat snapshot names an hCaptcha host");
});

Deno.test("runtime isNeverBlock, mergeDomains and mergeScoped drop hCaptcha hosts and keep lookalikes", () => {
  for (const h of ["hcaptcha.com", "a.hcaptcha.com", "sentry.hcaptcha.com", "stats.hcaptcha.com", "A.HCAPTCHA.COM."]) {
    assert(U.isNeverBlock(h), "should never block " + h);
  }
  for (const h of ["nothinghcaptcha.com", "nothcaptcha.com", "hcaptcha.com.evil.example"]) {
    assert(!U.isNeverBlock(h), "should stay blockable " + h);
  }
  const hosts = ["hcaptcha.com", "a.hcaptcha.com", "sentry.hcaptcha.com", "stats.hcaptcha.com", "nothinghcaptcha.com", "hcaptcha.com.evil.example"];
  const merged = U.mergeDomains({ peter_lowe: hosts });
  assert(JSON.stringify(merged) === '["nothinghcaptcha.com","hcaptcha.com.evil.example"]', "mergeDomains: " + JSON.stringify(merged));
  const scoped = U.mergeScoped({ peter_lowe: hosts.map((h) => [h, "p=|t=script|x="]) }, []);
  const names = scoped.map((e) => e[0]);
  assert(JSON.stringify(names) === '["nothinghcaptcha.com","hcaptcha.com.evil.example"]', "mergeScoped: " + JSON.stringify(names));
});

Deno.test("merger urlFilter and regex gaps: case, https anchor, port, wildcard and a subdomain the probe list omitted", async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "def rule(i, cond):",
    "    return {'id': i, 'priority': 1, 'action': {'type': 'block'}, 'condition': cond}",
    "blocks = [",
    "    rule(1, {'urlFilter': '||HCAPTCHA.COM^'}),",
    "    rule(2, {'urlFilter': '|https://widget.hcaptcha.com/1/api.js'}),",
    "    rule(3, {'urlFilter': '||hcaptcha.com:443/'}),",
    "    rule(4, {'urlFilter': '||*.hcaptcha.com^'}),",
    "    rule(5, {'regexFilter': r'imgs\\.hcaptcha\\.com/captcha'}),",
    "    rule(6, {'urlFilter': '||nothcaptcha.com^'}),",
    "    rule(7, {'urlFilter': '||hcaptcha.com.evil.example^'}),",
    "    rule(8, {'regexFilter': r'nothcaptcha\\.com'}),",
    "    rule(9, {'regexFilter': r'hcaptcha\\.com\\.evil\\.example'}),",
    "]",
    "out, dropped = mod.drop_hcaptcha_filter_rules(blocks)",
    "print(json.dumps({'ids': [r['id'] for r in out], 'dropped': dropped}))",
  ].join("\n");
  const res = JSON.parse(await runPython(script));
  assert(res.dropped === 5, "dropped count: " + res.dropped);
  assert(JSON.stringify(res.ids) === "[6,7,8,9]", "kept ids: " + JSON.stringify(res.ids));
});

Deno.test("merger drops hCaptcha block rules by urlFilter and regexFilter, keeps lookalikes and non-block rules", async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "def rule(i, cond, t='block'):",
    "    return {'id': i, 'priority': 1, 'action': {'type': t}, 'condition': cond}",
    "blocks = [",
    "    rule(1, {'urlFilter': '||hcaptcha.com^'}),",
    "    rule(2, {'urlFilter': '||sentry.hcaptcha.com/1/api.js'}),",
    "    rule(3, {'urlFilter': '||stats.hcaptcha.com'}),",
    "    rule(4, {'urlFilter': '||a.hcaptcha.com*'}),",
    "    rule(5, {'regexFilter': r'^https?://([a-z]+\\.)?hcaptcha\\.com/'}),",
    "    rule(6, {'regexFilter': r'hcaptcha\\.com/1/api\\.js'}),",
    "    rule(7, {'urlFilter': '||nothcaptcha.com^'}),",
    "    rule(8, {'urlFilter': '||hcaptcha.com.evil.example^'}),",
    "    rule(9, {'regexFilter': r'^https?://nothcaptcha\\.com/'}),",
    "    rule(10, {'urlFilter': '||hcaptcha.com^'}, 'allow'),",
    "    rule(11, {'requestDomains': ['keep.example']}),",
    "]",
    "out, dropped = mod.drop_hcaptcha_filter_rules(blocks)",
    "print(json.dumps({'ids': [r['id'] for r in out], 'dropped': dropped}))",
  ].join("\n");
  const res = JSON.parse(await runPython(script));
  assert(res.dropped === 6, "dropped count: " + res.dropped);
  assert(JSON.stringify(res.ids) === "[7,8,9,10,11]", "kept ids: " + JSON.stringify(res.ids));
});

Deno.test("merger: requestDomains, urlFilter and regexFilter hCaptcha block rules all vanish from merged output", async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "def rule(i, cond):",
    "    return {'id': i, 'priority': 1, 'action': {'type': 'block'}, 'condition': cond}",
    "blocks = [",
    "    rule(1, {'requestDomains': ['hcaptcha.com', 'a.hcaptcha.com', 'nothcaptcha.com']}),",
    "    rule(2, {'urlFilter': '||stats.hcaptcha.com^'}),",
    "    rule(3, {'regexFilter': r'^https?://sentry\\.hcaptcha\\.com/'}),",
    "    rule(4, {'urlFilter': '||hcaptcha.com.evil.example^'}),",
    "]",
    "b, _r = mod.drop_hcaptcha(blocks)",
    "b, _d = mod.drop_hcaptcha_filter_rules(b)",
    "print(json.dumps(b))",
  ].join("\n");
  const out = JSON.parse(await runPython(script));
  assert(out.length === 2, "rules left: " + out.length);
  assert(JSON.stringify(out[0].condition.requestDomains) === '["nothcaptcha.com"]', "lookalike kept in requestDomains");
  assert(out[1].condition.urlFilter === "||hcaptcha.com.evil.example^", "lookalike urlFilter kept");
});
