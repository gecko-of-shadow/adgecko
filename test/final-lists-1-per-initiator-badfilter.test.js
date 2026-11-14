// Final review #1 (0.3.5): a cross-list $badfilter only cancelled an
// identical key, so AdGuard's `||jwplayer.com^$domain=tennis.com,badfilter`
// never reached EasyList's 15-site `||jwplayer.com^$domain=...|tennis.com|...`
// (easylist.txt 65954): JW Player stayed blocked on tennis.com.
// Fix (packer apply_cross_list and runtime crossListRules, same rules): a
// $badfilter with an i= part removes those initiators from every scoped
// entry of the same domain whose other key parts are equal; the entry goes
// when no initiator is left. Shared case: filter-options-cases.json "cross"[1]
// (Python parity runs in final-lists-0).
import "../src/general/filter-options.js";
import "../src/threat/psl.js";
import "../src/general/never-block-captcha.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import cases from "./fixtures/filter-options-cases.json" with { type: "json" };
import { evaluate } from "./fixtures/dnr-matcher.js";

function assert(c, l) { if (!c) throw new Error(l); }
const FO = globalThis.GeneralFilterOptions;
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

function runtimeCross(lists) {
  const payloads = {};
  for (const [n, t] of Object.entries(lists)) payloads[n] = U.parseEntriesFull(t);
  const cross = U.crossListRules(payloads);
  const perList = {};
  const perScoped = {};
  for (const [n, p] of Object.entries(payloads)) {
    perList[n] = p.domains.filter((d) => cross.keepWhole(d));
    perScoped[n] = U.crossScoped(cross, p.scoped);
  }
  const domains = U.mergeDomains(perList);
  return { domains, scoped: U.mergeScoped(perScoped, domains) };
}

Deno.test("#1: helpers remove only the named initiators and never widen", () => {
  assert(JSON.stringify(FO.initiatorSplit("p=|t=script|x=|i=a.test,b.test|m=get")) === '["p=|t=script|x=|m=get",["a.test","b.test"]]', "split");
  assert(FO.initiatorSplit("p=|t=script|x=") === null, "no i= part");
  assert(FO.removeInitiators("p=|t=|x=|i=a.test,b.test", new Set(["b.test"])) === "p=|t=|x=|i=a.test", "one removed");
  assert(FO.removeInitiators("p=|t=|x=|i=a.test", new Set(["a.test"])) === null, "empty i= list drops the entry");
  assert(FO.removeInitiators("p=|t=|x=|i=a.test", new Set(["c.test"])) === "p=|t=|x=|i=a.test", "unchanged");
});

Deno.test("#1: jwplayer.com is no longer blocked on tennis.com, still blocked on the other listed sites", () => {
  const c = cases.cross[1];
  const got = runtimeCross(c.lists);
  assert(JSON.stringify(got) === JSON.stringify(c.expect), JSON.stringify(got));
  const rules = U.buildListRules(got.domains, got.scoped);
  const req = (url, initiator) => evaluate(rules, { url, type: "script", method: "get", initiator }).action;
  assert(req("https://cdn.jwplayer.com/libraries/x.js", "tennis.com") === "none", "tennis.com still blocked");
  assert(req("https://cdn.jwplayer.com/libraries/x.js", "variety.com") === "block", "variety.com no longer blocked");
  assert(req("https://y.example/a.js", "a.test") === "none" && req("https://y.example/a.js", "b.test") === "none", "all initiators removed: entry gone");
  assert(evaluate(rules, { url: "https://z.example/a.png", type: "image", method: "get", initiator: "a.test" }).action === "block", "different type: badfilter does not apply");
  assert(req("https://w.example/a.js", "a.test") === "block", "a $domain= badfilter does not cancel a whole-domain block");
});

Deno.test("#1: swap's packed fallback narrows a packed rule the same way (scopeOf)", () => {
  const cross = U.crossListRules({ adguard_base: U.parseEntriesFull("||jwplayer.com^$domain=tennis.com,badfilter") });
  assert(cross.scopeOf("jwplayer.com", "p=|t=|x=|i=tennis.com,variety.com") === "p=|t=|x=|i=variety.com", "narrowed");
  assert(cross.scopeOf("jwplayer.com", "p=|t=|x=|i=tennis.com") === null, "dropped");
  assert(cross.keepScoped("jwplayer.com", "p=|t=|x=|i=tennis.com,variety.com"), "keepScoped stays a predicate");
});
