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

// Review fix: a scoped `$important` block (`||host^$script,third-party,important`)
// was not recorded as important, so `@@||host^` or `@@||sub.host^` became an
// allow rule and lifted it. An `@@||host^` rule also covers the subdomains, so
// an `$important` block on a subdomain stops it too.
const IMP_EASYLIST = [
  "||adsfoo.example^$script,third-party,important",
  "||tracksite.example^",
  "||deep.tracksite.example^$script,important",
  "||wholeimp.example^$important",
  "||par.example^",
  "||x.sub.par.example^$important",
].join("\n");
const IMP_ADGUARD = [
  "@@||adsfoo.example^",
  "@@||sub.adsfoo.example^",
  "@@||tracksite.example^",
  "@@||x.wholeimp.example^",
  "@@||sub.par.example^",
].join("\n");

Deno.test("exception allow rules: a scoped $important block is not lifted, on the host, a subdomain or a parent", () => {
  const { allows, rules } = refreshedRules({ easylist: IMP_EASYLIST, adguard_base: IMP_ADGUARD });
  assert(allows.whole.length === 0 && allows.scoped.length === 0, "no allow rule under a $important block: " + JSON.stringify(allows));
  assert(!rules.some((r) => r.action.type === "allow"), "allow rules: " + JSON.stringify(rules.filter((r) => r.action.type === "allow")));
  const verdict = (url, type) => evaluate(rules, { url, type, frames: ["www.site.example"] }).action;
  assert(verdict("https://adsfoo.example/x.js", "script") === "block", "adsfoo.example script lifted");
  assert(verdict("https://sub.adsfoo.example/x.js", "script") === "block", "sub.adsfoo.example script lifted");
  assert(verdict("https://deep.tracksite.example/x.js", "script") === "block", "deep.tracksite.example script lifted by @@||tracksite.example^");
  assert(verdict("https://x.wholeimp.example/x.js", "script") === "block", "whole-domain $important lifted");
  // A whole-domain $important block on a subdomain stops the parent's
  // exception too (its allow rule would cover that subdomain).
  assert(verdict("https://x.sub.par.example/x.js", "script") === "block", "whole-domain $important on a subdomain lifted by @@||sub.par.example^");
  assert(verdict("https://sub.par.example/x.js", "script") === "block", "sub.par.example got an allow rule over a $important subdomain");
  // Whole-domain behaviour is unchanged: the same-host exception still lifts
  // the plain whole-domain block of tracksite.example (keepWhole).
  assert(verdict("https://tracksite.example/x.gif", "image") !== "block", "the same-host exception no longer lifts the plain whole-domain block of tracksite.example");
  const p = U.parseEntriesFull(IMP_EASYLIST);
  assert(JSON.stringify(p.importantScoped) === JSON.stringify(["adsfoo.example", "deep.tracksite.example"]), "importantScoped: " + JSON.stringify(p.importantScoped));
  assert(JSON.stringify(p.important) === JSON.stringify(["wholeimp.example", "x.sub.par.example"]), "important: " + JSON.stringify(p.important));
  assert(!("importantScoped" in U.parseEntries(IMP_EASYLIST)), "per-list fixture output unchanged");
  // A scoped $important block that a $badfilter cancels protects nothing.
  const gone = U.parseEntriesFull(IMP_EASYLIST + "\n||adsfoo.example^$script,third-party,important,badfilter");
  assert(JSON.stringify(gone.importantScoped) === JSON.stringify(["deep.tracksite.example"]), "cancelled importantScoped: " + JSON.stringify(gone.importantScoped));
});

// Review fix: `@@||host^$badfilter` and `@@||host^$type,badfilter` withdraw an
// exception (uBO applies $badfilter to exceptions too). The withdrawn
// exception must not become an allow rule, whichever list holds the
// $badfilter line and in whichever order.
Deno.test("exception allow rules: an exception withdrawn by @@...$badfilter gets no allow rule (whole-host and type-only)", () => {
  const lists = {
    easylist: "||nrfoo.example^",
    adguard_base: "@@||c.nrfoo.example^$xmlhttprequest\n@@||w.nrfoo.example^\n@@||k.nrfoo.example^$subdocument,xmlhttprequest\n@@||keep.nrfoo.example^",
    easyprivacy: "@@||c.nrfoo.example^$xmlhttprequest,badfilter\n@@||w.nrfoo.example^$badfilter",
  };
  const { allows, rules } = refreshedRules(lists);
  assert(JSON.stringify(allows.whole) === JSON.stringify(["keep.nrfoo.example"]), "whole: " + JSON.stringify(allows.whole));
  assert(JSON.stringify(allows.scoped) === JSON.stringify([["k.nrfoo.example", "p=|t=sub_frame,xmlhttprequest|x="]]), "scoped: " + JSON.stringify(allows.scoped));
  const verdict = (url, type) => evaluate(rules, { url, type, frames: ["www.site.example"] }).action;
  assert(verdict("https://c.nrfoo.example/x", "xmlhttprequest") === "block", "withdrawn type-only exception still allows");
  assert(verdict("https://w.nrfoo.example/x.js", "script") === "block", "withdrawn whole-host exception still allows");
  assert(verdict("https://keep.nrfoo.example/x.js", "script") !== "block", "an exception with no $badfilter is honoured");
  // Same list, $badfilter line first; option order does not matter.
  const one = refreshedRules({ easylist: "||nrfoo.example^", adguard_base: "@@||k.nrfoo.example^$xmlhttprequest,subdocument,badfilter\n@@||k.nrfoo.example^$subdocument,xmlhttprequest" });
  assert(one.allows.scoped.length === 0, "same-list cancel: " + JSON.stringify(one.allows.scoped));
  const p = U.parseEntriesFull(lists.easyprivacy);
  assert(JSON.stringify(p.cancelAllow) === JSON.stringify(["c.nrfoo.example\np=|t=xmlhttprequest|x=", "w.nrfoo.example\n"]), "cancelAllow: " + JSON.stringify(p.cancelAllow));
  assert(!p.allowScoped && !p.allow, "a $badfilter exception is no exception itself");
  assert(!("cancelAllow" in U.parseEntries(lists.easyprivacy)), "per-list fixture output unchanged");
});

// The two new payload fields are stored with each list and used by swap():
// one real refresh, not only the pure functions.
function refreshDeps(texts) {
  const state = {};
  let dynamic = [];
  const data = {};
  const filler = (tag) => Array.from({ length: 30000 }, (_, i) => `||${tag}${i}.example.com^`).join("\n");
  const byUrl = Object.fromEntries(U.SOURCES.map((s) => [s.url, s.name]));
  const deps = {
    data,
    get dynamic() { return dynamic; },
    fetch: async (url) => {
      const name = byUrl[url] || "x";
      const body = "! Expires: 4 days\n" + filler(name.replace(/[^a-z]/g, "")) + "\n" + (texts[name] || "");
      return { ok: true, status: 200, headers: new Headers({ ETag: "\"e\"" }), text: async () => body };
    },
    now: () => 1e12,
    getState: async () => structuredClone(state),
    setState: async (p) => Object.assign(state, structuredClone(p)),
    getListData: async (names) => Object.fromEntries(names.filter((n) => data[n]).map((n) => [n, structuredClone(data[n])])),
    setListData: async (name, payload) => { data[name] = structuredClone(payload); },
    removeListData: async (names) => { for (const n of names) delete data[n]; },
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async () => {},
    loadBundled: async () => ({ rules: bundled, extraIds: [] }),
    enabled: () => true,
  };
  return deps;
}

Deno.test("refresh: stored payloads keep importantScoped and cancelAllow, and the swap writes no allow rule for them", async () => {
  const texts = {
    easylist: IMP_EASYLIST + "\n||nrfoo.example^",
    adguard_base: IMP_ADGUARD + "\n@@||c.nrfoo.example^$xmlhttprequest\n@@||w.nrfoo.example^\n@@||keep.nrfoo.example^",
    easyprivacy: "@@||c.nrfoo.example^$xmlhttprequest,badfilter\n@@||w.nrfoo.example^$badfilter",
  };
  const d = refreshDeps(texts);
  const r = await U.refresh(d, { manual: true });
  assert(r.ok && r.ran, "refresh ran: " + JSON.stringify(r));
  assert(JSON.stringify(d.data.easylist.importantScoped) === JSON.stringify(["adsfoo.example", "deep.tracksite.example"]), "stored importantScoped: " + JSON.stringify(d.data.easylist.importantScoped));
  assert(Array.isArray(d.data.easyprivacy.cancelAllow) && d.data.easyprivacy.cancelAllow.length === 2, "stored cancelAllow: " + JSON.stringify(d.data.easyprivacy.cancelAllow));
  const allowHosts = d.dynamic.filter((x) => U.isOurRule(x.id) && x.action.type === "allow").flatMap((x) => x.condition.requestDomains || []);
  for (const h of ["adsfoo.example", "sub.adsfoo.example", "tracksite.example", "x.wholeimp.example", "c.nrfoo.example", "w.nrfoo.example"]) {
    assert(!allowHosts.includes(h), "allow rule for " + h + ": " + JSON.stringify(allowHosts));
  }
  assert(allowHosts.includes("keep.nrfoo.example"), "the plain exception keeps its allow rule: " + JSON.stringify(allowHosts));
});
