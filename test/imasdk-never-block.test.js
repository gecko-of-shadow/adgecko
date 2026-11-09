// Static vs dynamic agreement for ad hosts under a broad never-block suffix.
// The packed ruleset blocks imasdk.googleapis.com (merger extra tracker rule)
// while googleapis.com as a whole is a never-block suffix. The packer and the
// runtime refresh must carve out the same exceptions, so a refreshed list
// keeps blocking the IMA ad SDK host and never blocks the player API hosts.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import "../src/threat/protected-hosts.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import generalRules from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };

const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

async function runPython(script) {
  const root = new URL("..", import.meta.url);
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  let out = null;
  for (const [bin, ...pre] of bins) {
    try {
      out = await new Deno.Command(bin, { args: [...pre, "-c", script], cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      if (out.code === 9009) { out = null; continue; }
      break;
    } catch (_err) { /* try the next binary */ }
  }
  assert(out, "no usable Python 3");
  assert(out.code === 0, new TextDecoder().decode(out.stderr));
  return new TextDecoder().decode(out.stdout).replace(/\r/g, "").trim();
}

const EXC = ["imasdk.googleapis.com"];
const STILL_PROTECTED = ["googleapis.com", "youtubei.googleapis.com", "fonts.googleapis.com", "play.googleapis.com", "www.googleapis.com", "gstatic.com"];

Deno.test("runtime: imasdk.googleapis.com is not never-blocked, the rest of googleapis.com still is", () => {
  assert(JSON.stringify(U.NEVER_BLOCK_EXCEPTIONS) === JSON.stringify(EXC), "exceptions: " + JSON.stringify(U.NEVER_BLOCK_EXCEPTIONS));
  for (const h of EXC) assert(!U.isNeverBlock(h) && !U.isNeverBlock("a." + h) && !U.isNeverBlock(h.toUpperCase() + "."), h + " must stay blockable");
  for (const h of STILL_PROTECTED) assert(U.isNeverBlock(h), h + " must stay never-block");
  const merged = U.mergeDomains({ peter_lowe: ["imasdk.googleapis.com", "youtubei.googleapis.com", "fonts.googleapis.com", "ads.example"] });
  assert(JSON.stringify(merged) === '["imasdk.googleapis.com","ads.example"]', "mergeDomains: " + JSON.stringify(merged));
  // The threat tier never protected the SDK host, so the protected-hits guard does not count it either.
  const PH = globalThis.GeckoProtectedHosts;
  assert(PH.protectedReason("imasdk.googleapis.com") === null, "threat tier protects imasdk");
});

Deno.test("packer: the same exception list, same decisions as the runtime", async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('pfl', Path('scripts/pack-filter-lists.py'))",
    "mod = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(mod)",
    "spec2 = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
    "merger = importlib.util.module_from_spec(spec2)",
    "spec2.loader.exec_module(merger)",
    "hosts = " + JSON.stringify(EXC.concat(["a." + EXC[0]], STILL_PROTECTED, ["ads.example"])),
    "print(json.dumps({'exceptions': list(mod.NEVER_BLOCK_EXCEPTIONS), 'never': {h: mod.is_never_block(h) for h in hosts},",
    "  'extra': list(merger.EXTRA_TRACKER_DOMAINS)}))",
  ].join("\n");
  const py = JSON.parse(await runPython(script));
  assert(JSON.stringify(py.exceptions) === JSON.stringify(EXC), "packer exceptions: " + JSON.stringify(py.exceptions));
  for (const [h, v] of Object.entries(py.never)) assert(v === U.isNeverBlock(h), "packer and runtime disagree on " + h);
  for (const h of EXC) assert(py.extra.includes(h), "merger extra tracker rule omits " + h);
});

Deno.test("packed general ruleset blocks imasdk.googleapis.com and no other googleapis.com host", () => {
  const blocks = generalRules.filter((r) => r.action && r.action.type === "block");
  const blocked = blocks.flatMap((r) => (r.condition && r.condition.requestDomains) || []);
  const google = blocked.filter((d) => d === "googleapis.com" || d.endsWith(".googleapis.com"));
  assert(google.length > 0 && google.every((d) => d === "imasdk.googleapis.com"), "googleapis hosts in packed blocks: " + JSON.stringify(google));
  const extraRule = generalRules.find((r) => r.id === mergeMeta.extra_tracker_rule_id);
  assert(extraRule && extraRule.action.type === "block" && extraRule.condition.requestDomains.includes("imasdk.googleapis.com"), "extra tracker rule");
  assert(mergeMeta.extra_tracker_domains.includes("imasdk.googleapis.com"), "merge meta extra domains");
});
