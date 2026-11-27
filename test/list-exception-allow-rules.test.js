// List `@@` exceptions that keepWhole cannot apply (it only drops a block of
// the SAME host) become DNR allow rules: a subdomain of a blocked parent
// (AdGuard `@@||alllaw.112.2o7.net^` under `||2o7.net^`) and a type-only
// exception (EasyPrivacy
// `@@||chart-embed.service.newrelic.com^$subdocument,xmlhttprequest`). uBO
// applies both. The allow rules are priority 1, so they also beat the packed
// ruleset, which stays on next to the refreshed rules. `$important` blocks
// still win; hosts that nothing blocks get no rule.
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import bundled from "../src/rules/general-network.json" with { type: "json" };
import { evaluate } from "./fixtures/dnr-matcher.js";

function assert(c, l) { if (!c) throw new Error(l); }
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

const EASYPRIVACY = [
  "||2o7.net^",
  "||service.newrelic.com^",
  "@@||chart-embed.service.newrelic.com^$subdocument,xmlhttprequest",
  "||imp.example^$important",
  "@@||path.example^/x/$script",
].join("\n");
const ADGUARD = [
  "@@||alllaw.112.2o7.net^",
  "@@||puma.112.2o7.net^",
  "@@||x.imp.example^",
  "@@||nothing-blocks-this.example^",
  "@@||wide.example^$domain=a.example",
].join("\n");

// The same steps as swap(), without storage.
function refreshedRules(texts) {
  const payloads = Object.fromEntries(Object.entries(texts).map(([n, t]) => [n, U.parseEntriesFull(t)]));
  const cross = U.crossListRules(payloads, [], { lists: {} });
  const perList = {};
  const perScoped = {};
  for (const [n, p] of Object.entries(payloads)) {
    perList[n] = p.domains.filter((d) => cross.keepWhole(d));
    perScoped[n] = U.crossScoped(cross, p.scoped);
  }
  const domains = U.mergeDomains(perList);
  const scoped = U.mergeScoped(perScoped, domains);
  const blocked = new Set(domains);
  for (const e of scoped) blocked.add(e[0]);
  const allows = U.exceptionAllows(cross, blocked);
  return { payloads, allows, rules: U.buildListRules(domains, scoped, allows) };
}

Deno.test("parser: a type-only exception is kept as allowScoped; an exception with $domain= or a path is not", () => {
  const p = U.parseEntriesFull(EASYPRIVACY + "\n" + ADGUARD);
  assert(JSON.stringify(p.allowScoped) === JSON.stringify([["chart-embed.service.newrelic.com", "p=|t=sub_frame,xmlhttprequest|x="]]), "allowScoped: " + JSON.stringify(p.allowScoped));
  assert(p.allow.includes("alllaw.112.2o7.net") && !p.allow.includes("wide.example"), "allow: " + JSON.stringify(p.allow));
  assert(!("allowScoped" in U.parseEntries(EASYPRIVACY)), "per-list fixture output unchanged");
});

Deno.test("exception allow rules: parent-domain and type-only exceptions are honoured; $important and unrelated hosts are not touched", () => {
  const { allows, rules } = refreshedRules({ easyprivacy: EASYPRIVACY, adguard_base: ADGUARD });
  assert(JSON.stringify(allows.whole) === JSON.stringify(["alllaw.112.2o7.net", "puma.112.2o7.net"]), "whole: " + JSON.stringify(allows.whole));
  const allowRules = rules.filter((r) => r.action.type === "allow");
  assert(allowRules.length === 2 && allowRules.every((r) => r.priority === 1), "two priority-1 allow rules: " + JSON.stringify(allowRules));
  const all = bundled.concat(rules);
  const blocked = (url, type) => evaluate(all, { url, type, frames: ["www.site.example"] }).action === "block";
  assert(!blocked("https://alllaw.112.2o7.net/b/ss/x", "image"), "alllaw.112.2o7.net blocked");
  assert(!blocked("https://puma.112.2o7.net/b/ss/x", "image"), "puma.112.2o7.net blocked");
  assert(blocked("https://other.112.2o7.net/b/ss/x", "image"), "the rest of 2o7.net must stay blocked");
  assert(!blocked("https://chart-embed.service.newrelic.com/x", "xmlhttprequest"), "chart-embed xhr blocked");
  assert(!blocked("https://chart-embed.service.newrelic.com/x", "sub_frame"), "chart-embed frame blocked");
  assert(blocked("https://chart-embed.service.newrelic.com/x.js", "script"), "chart-embed script must stay blocked (exception is type-scoped)");
  assert(blocked("https://other.service.newrelic.com/x", "xmlhttprequest"), "the rest of service.newrelic.com must stay blocked");
  assert(blocked("https://x.imp.example/a.js", "script"), "an exception lifted a $important block");
  assert(!rules.some((r) => (r.condition.requestDomains || []).includes("nothing-blocks-this.example")), "allow rule for a host nothing blocks");
});

// The cases of the ignored shipped-ruleset test: with the real packed rules
// on and the exceptions of the lists, they are no longer blocked.
Deno.test("exception allow rules over the packed ruleset: 2o7.net subdomains and the New Relic chart embed are not blocked", () => {
  const packedBlocked = (req) => evaluate(bundled, req).action === "block";
  const CASES = [
    { url: "https://alllaw.112.2o7.net/b/ss/x", type: "image", frames: ["www.alllaw.com"] },
    { url: "https://puma.112.2o7.net/b/ss/x", type: "image", frames: ["us.puma.com"] },
    { url: "https://chart-embed.service.newrelic.com/x", type: "xmlhttprequest", frames: ["docs.newrelic.com"] },
  ];
  assert(CASES.every(packedBlocked), "control: the packed ruleset blocks all three");
  const lists = {
    easyprivacy: "@@||chart-embed.service.newrelic.com^$subdocument,xmlhttprequest\n||newrelic.com^$third-party",
    adguard_base: "@@||alllaw.112.2o7.net^\n@@||puma.112.2o7.net^\n||2o7.net^",
  };
  const { rules } = refreshedRules(lists);
  const still = CASES.filter((req) => evaluate(bundled.concat(rules), req).action === "block").map((r) => new URL(r.url).hostname);
  assert(still.length === 0, "still blocked: " + still.join(", "));
});
