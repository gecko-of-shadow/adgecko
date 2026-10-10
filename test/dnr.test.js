import manifest from "../manifest.json" with { type: "json" };
import rules from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };
import excludeSource from "../src/general-exclude-hosts.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\n${left}\n${right}`);
}

const api = {};
const install = new Function(`${excludeSource}\nreturn installGeneralExcludeHosts;`)();
install(api);

Deno.test("ruleset id is general (popup contract) pointing at general-network.json", () => {
  const resource = manifest.declarative_net_request.rule_resources[0];
  assertEquals(resource.id, "general");
  assertEquals(resource.enabled, true);
  assertEquals(resource.path, "src/rules/general-network.json");
  assertEquals(mergeMeta.ruleset_id, "general");
});

Deno.test("merged DNR rules stay under Chrome's 30k floor", () => {
  assert(rules.length <= 30000, `count ${rules.length}`);
  assertEquals(mergeMeta.rule_count, rules.length);
  assert(mergeMeta.block_rules >= 1000, "list-pack blocks present");
  assertEquals(mergeMeta.allow_rules, 2);
});

Deno.test("buildDnrExclusionRules matches packed high-priority allows", () => {
  const built = api.buildDnrExclusionRules({ idStart: 1, priority: 2_000_000 });
  assertEquals(built.length, 2);
  assertEquals(rules[0].action.type, "allowAllRequests");
  assertEquals(rules[1].action.type, "allow");
  assertEquals(rules[0].priority, 2_000_000);
  assertEquals(rules[1].priority, 2_000_000);
  for (const host of api.SITE_DOMAINS) {
    assert(rules[0].condition.requestDomains.includes(host), `site ${host}`);
  }
  for (const host of api.VIDEO_CDN_DOMAINS) {
    assert(rules[1].condition.requestDomains.includes(host), `cdn ${host}`);
  }
});

Deno.test("block rules never target protected stream hosts", () => {
  const excluded = api.ALL_EXCLUDED;
  for (const rule of rules) {
    if (rule.action?.type !== "block") continue;
    for (const domain of rule.condition?.requestDomains || []) {
      assert(!api.isExcludedHost(domain), `must not block ${domain}`);
      for (const suf of excluded) {
        assert(domain !== suf && !domain.endsWith("." + suf), `block hit ${domain}`);
      }
    }
  }
});

Deno.test("permissions stay DNR + storage; no host_permissions / background", () => {
  assertEquals(manifest.permissions?.slice().sort(), ["declarativeNetRequest", "storage"].sort());
  assertEquals(manifest.host_permissions, undefined);
  assertEquals(manifest.background, undefined);
});
