// With the packed rules alone (fresh install before the first download,
// after Revert lists), the packed lists' `@@||sub.host^` exceptions under a
// blocked parent still get their allow rules: applyEnabled's static path
// writes them from packed-cross.json (syncPackedAllows).
import { assert, assertEquals } from "jsr:@std/assert@1";
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };

const install = new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)();
// One worker each: the wanted rules are kept for the worker's life.
function fresh() {
  const U = {};
  install(U);
  return U;
}

function deps(bundled, dynamic = []) {
  const d = {
    dynamic,
    writes: 0,
    staticOn: false,
    getState: async () => ({}),
    setState: async () => {},
    getDynamicRules: async () => d.dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => {
      d.writes += 1;
      d.dynamic = d.dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules);
    },
    setStaticEnabled: async (on) => { d.staticOn = on; },
    loads: 0,
    loadBundled: async () => { d.loads += 1; return bundled; },
    enabled: () => true,
    now: () => 0,
  };
  return d;
}

const bundled = {
  rules: [
    { id: 100, priority: 1, action: { type: "block" }, condition: { requestDomains: ["2o7.net", "tracker.example"] } },
    { id: 5, priority: 2000000, action: { type: "allow" }, condition: { requestDomains: ["player.example"] } },
  ],
  extraIds: [],
  packedCross: { lists: { adguard_base: { allow: ["alllaw.112.2o7.net", "tracker.example", "free.example"] } } },
};

Deno.test("packed only: a subdomain exception under a packed block becomes a priority-1 allow rule", async () => {
  const U = fresh();
  const d = deps(bundled);
  const r = await U.applyEnabled(d, true);
  assertEquals(r.mode, "static");
  assert(d.staticOn, "packed rules on");
  const ours = d.dynamic.filter((x) => U.isOurRule(x.id));
  assertEquals(ours.length, 1);
  assertEquals(ours[0].action.type, "allow");
  assertEquals(ours[0].priority, 1);
  // free.example has no block to lift, so it gets no rule.
  assertEquals(ours[0].condition.requestDomains, ["alllaw.112.2o7.net", "tracker.example"]);
});

Deno.test("packed only: a second run writes nothing and does not load the packed rules again", async () => {
  const U = fresh();
  const d = deps(bundled);
  await U.applyEnabled(d, true);
  const writes = d.writes;
  await U.applyEnabled(d, true);
  assertEquals(d.writes, writes);
  assertEquals(d.loads, 1);
});

Deno.test("packed only: no exception for a blocked host means no list-range rules, and old ones go", async () => {
  const U = fresh();
  const none = Object.assign({}, bundled, { packedCross: { lists: {} } });
  const stale = [{ id: U.LIST_RULE_ID_BASE, priority: 1, action: { type: "allow" }, condition: { requestDomains: ["old.example"] } }];
  const user = { id: U.ALLOW_RULE_ID_BASE, priority: 10000, action: { type: "allow" }, condition: { initiatorDomains: ["a.example"] } };
  const d = deps(none, stale.concat(user));
  await U.applyEnabled(d, true);
  assertEquals(d.dynamic.filter((x) => U.isOurRule(x.id)).length, 0);
  assert(d.dynamic.some((x) => x.id === U.ALLOW_RULE_ID_BASE), "the user's allow rule stays");
});

Deno.test("packed only: lists switched off leaves no list-range rules", async () => {
  const U = fresh();
  const d = deps(bundled);
  await U.applyEnabled(d, true);
  await U.applyEnabled(d, false);
  assertEquals(d.dynamic.filter((x) => U.isOurRule(x.id)).length, 0);
});

Deno.test("packed only: the shipped packed data gives the 2o7.net subdomain allows", async () => {
  const U = fresh();
  const rules = JSON.parse(await Deno.readTextFile(new URL("../src/rules/general-network.json", import.meta.url)));
  const packedCross = JSON.parse(await Deno.readTextFile(new URL("../src/rules/packed-cross.json", import.meta.url)));
  const meta = JSON.parse(await Deno.readTextFile(new URL("../src/rules/meta.json", import.meta.url)));
  const d = deps({ rules, extraIds: meta.extra_tracker_rule_id ? [meta.extra_tracker_rule_id] : [], packedCross });
  await U.applyEnabled(d, true);
  const hosts = d.dynamic.filter((x) => U.isOurRule(x.id)).flatMap((x) => x.condition.requestDomains);
  assert(hosts.includes("alllaw.112.2o7.net") && hosts.includes("puma.112.2o7.net"), JSON.stringify(hosts));
  assert(d.dynamic.every((x) => x.action.type === "allow" && x.priority === 1), "allow rules only");
});
