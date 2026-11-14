// Final review, second pass (0.3.5): the fixes for #0 (path / option
// exceptions limit $domain= filters) and #1 (per-initiator $badfilter) were
// in the packer and the runtime, but the shipped static ruleset was not
// repacked. update.js keeps the packed "general" ruleset on next to the
// refreshed rules, so the old rules stayed active after every refresh:
// rule 2590 (adobedtm.com, excludedInitiatorDomains adobe.com/costco.com),
// 2594 (anyclip.com), 3038 (sonar.viously.com) and 2888 (jwplayer.com with
// tennis.com in initiatorDomains).
// Fix: repack from the same list snapshot (scripts/.list-cache, the bytes
// that meta.json hashes). These checks read only the shipped files, so they
// need no list cache.
import "../src/general/filter-options.js";
import network from "../src/rules/general-network.json" with { type: "json" };
import meta from "../src/rules/meta.json" with { type: "json" };

function assert(c, l) { if (!c) throw new Error(l); }
const FO = globalThis.GeneralFilterOptions;
const BLOCK_ID_START = 100; // scripts/merge-dnr-rules.py

// The packer's list rules only (the merger's own YouTube / stream / tracker
// rules may carry initiators on purpose).
function listRules() {
  return network.filter((r) => r.id >= BLOCK_ID_START && r.id < BLOCK_ID_START + meta.dnr_rules_total);
}

Deno.test("final-lists-7: list-rule range holds only block rules", () => {
  const rules = listRules();
  assert(rules.length === meta.dnr_rules_total, "rule count " + rules.length + " vs meta " + meta.dnr_rules_total);
  for (const r of rules) assert(r.action && r.action.type === "block", "rule " + r.id + " is not a block rule");
});

Deno.test("final-lists-7: no exclusion-only $domain=~ list rule is shipped (#0 a)", () => {
  for (const r of listRules()) {
    const c = r.condition || {};
    assert(!(c.excludedInitiatorDomains && !c.initiatorDomains),
      "rule " + r.id + " blocks " + (c.requestDomains || []).slice(0, 3).join(",") + " on every site but a few");
  }
});

Deno.test("final-lists-7: no shipped $domain= list rule names a host that a path exception limits (#0 b)", () => {
  const hosts = new Set();
  for (const part of Object.values(FO.PACKED_CROSS.lists)) for (const h of part.limit || []) hosts.add(h);
  assert(hosts.size > 0, "PACKED_CROSS has limit hosts");
  const index = FO.limitIndex(hosts);
  const bad = [];
  for (const r of listRules()) {
    const c = r.condition || {};
    if (!c.initiatorDomains && !c.excludedInitiatorDomains) continue;
    for (const d of c.requestDomains || []) {
      if (FO.limitsScoped(index, d, "p=|t=|x=|i=example.org")) bad.push(r.id + ":" + d);
    }
  }
  assert(!bad.length, "limited hosts still shipped: " + bad.slice(0, 10).join(" "));
});

Deno.test("final-lists-7: the reviewed hosts have no list rule left", () => {
  const named = ["adobedtm.com", "anyclip.com", "sonar.viously.com", "jwplayer.com"];
  for (const r of listRules()) {
    const c = r.condition || {};
    if (!c.initiatorDomains && !c.excludedInitiatorDomains) continue;
    for (const h of named) assert(!(c.requestDomains || []).includes(h), "rule " + r.id + " still blocks " + h);
  }
  // jwplayer.com with tennis.com as initiator, in any rule at all.
  for (const r of network) {
    const c = r.condition || {};
    if (r.action.type !== "block") continue;
    assert(!((c.requestDomains || []).includes("jwplayer.com") && (c.initiatorDomains || []).includes("tennis.com")),
      "rule " + r.id + " blocks jwplayer.com on tennis.com");
  }
});
