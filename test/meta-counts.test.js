// Packed metadata must describe the packed files that ship: the post-merge
// file count is the source of truth (0.3.2 shipped meta 2,536 list rules next
// to 2,541 rules in general-network.json with nothing tying the two together).
import generalRules from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
import meta from "../src/rules/meta.json" with { type: "json" };
import threatRules from "../src/rules/threat-network.json" with { type: "json" };
import threatMeta from "../src/rules/threat-meta.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

const listRules = generalRules.filter((r) => r.id >= mergeMeta.block_id_start && r.id < mergeMeta.extra_tracker_rule_id);
const isWhole = (r) => Object.keys(r.condition).length === 1 && Array.isArray(r.condition.requestDomains);

Deno.test("meta.json carries the post-merge rule count of general-network.json", () => {
  assert(Number.isInteger(meta.general_network_rules_total), "general_network_rules_total missing: run scripts/merge-dnr-rules.py");
  assert(meta.general_network_rules_total === generalRules.length, "meta " + meta.general_network_rules_total + " vs file " + generalRules.length);
  assert(mergeMeta.rule_count === generalRules.length, "dnr-merge-meta rule_count " + mergeMeta.rule_count + " vs file " + generalRules.length);
  assert(typeof meta.general_network_merged_at_utc === "string" && meta.general_network_merged_at_utc === mergeMeta.merged_at_utc, "merged_at mismatch");
});

Deno.test("meta.json list-rule and entry totals match the list rules in the packed file", () => {
  assert(listRules.length === meta.dnr_rules_total, "list rules " + listRules.length + " vs meta.dnr_rules_total " + meta.dnr_rules_total);
  const whole = listRules.filter(isWhole).reduce((n, r) => n + r.condition.requestDomains.length, 0);
  const scoped = listRules.filter((r) => !isWhole(r)).reduce((n, r) => n + r.condition.requestDomains.length, 0);
  assert(whole === meta.domains_total, "whole-domain entries " + whole + " vs meta.domains_total " + meta.domains_total);
  assert(scoped === meta.scoped_entries_total, "scoped entries " + scoped + " vs meta.scoped_entries_total " + meta.scoped_entries_total);
  for (const r of listRules) assert(r.condition.requestDomains.length <= meta.domains_per_rule, "rule " + r.id + " over domains_per_rule");
});

Deno.test("dnr-merge-meta.json parts add up to the file, and the extra tracker rule is the last one", () => {
  assert(mergeMeta.allow_rules + mergeMeta.youtube_ad_block_rules + mergeMeta.block_rules === mergeMeta.rule_count, "parts do not add up");
  assert(mergeMeta.block_rules === listRules.length + 1, "block_rules = list rules + the extra tracker rule");
  const extra = generalRules.find((r) => r.id === mergeMeta.extra_tracker_rule_id);
  assert(extra && JSON.stringify(extra.condition.requestDomains) === JSON.stringify(mergeMeta.extra_tracker_domains), "extra tracker rule");
  assert(Math.max(...generalRules.map((r) => r.id)) === mergeMeta.extra_tracker_rule_id, "extra tracker rule has the highest id");
});

Deno.test("threat-meta.json matches threat-network.json", () => {
  assert(threatMeta.rule_count === threatRules.length, "threat rule_count " + threatMeta.rule_count + " vs file " + threatRules.length);
  const hosts = threatRules.reduce((n, r) => n + r.condition.requestDomains.length, 0);
  assert(threatMeta.hosts_total === hosts, "threat hosts_total " + threatMeta.hosts_total + " vs file " + hosts);
});
