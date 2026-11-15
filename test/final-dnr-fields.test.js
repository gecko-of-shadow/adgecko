// Final review (0.3.5): Chrome refuses a whole static ruleset (and so loads
// none of its rules) when one rule breaks the declarativeNetRequest field
// rules. This test checks every rule of every static ruleset in manifest.json
// against those rules, so a list pack cannot ship a ruleset Chrome rejects:
//  - id: an integer >= 1, unique in its ruleset; priority (when present): an
//    integer >= 1.
//  - action.type in the enum; allowAllRequests only for main_frame / sub_frame.
//  - requestDomains, excludedRequestDomains, initiatorDomains,
//    excludedInitiatorDomains: non-empty arrays when present, each entry a
//    lowercase ASCII host name (no scheme, path, port, wildcard or empty label).
//  - requestMethods / excludedRequestMethods: valid enum values, not both.
//  - resourceTypes / excludedResourceTypes: valid enum values, non-empty when
//    present, no type in both.
//  - domainType: firstParty or thirdParty.
//  - urlFilter and regexFilter: not both; no unknown condition keys.
function assert(c, l) { if (!c) throw new Error(l); }

const ROOT = new URL("..", import.meta.url);
const manifest = JSON.parse(Deno.readTextFileSync(new URL("manifest.json", ROOT)));
const RESOURCES = (manifest.declarative_net_request || {}).rule_resources || [];
const EXPECTED_PATHS = ["src/rules/general-network.json", "src/rules/threat-network.json", "src/rules/ubo-youtube-network.json"];

const RESOURCE_TYPES = new Set(["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"]);
const METHODS = new Set(["connect", "delete", "get", "head", "options", "patch", "post", "put", "other"]);
const ACTIONS = new Set(["block", "redirect", "allow", "upgradeScheme", "modifyHeaders", "allowAllRequests"]);
const DOMAIN_KEYS = ["requestDomains", "excludedRequestDomains", "initiatorDomains", "excludedInitiatorDomains"];
const CONDITION_KEYS = new Set([
  ...DOMAIN_KEYS, "domains", "excludedDomains", "urlFilter", "regexFilter", "isUrlFilterCaseSensitive",
  "requestMethods", "excludedRequestMethods", "resourceTypes", "excludedResourceTypes", "domainType",
  "tabIds", "excludedTabIds", "responseHeaders", "excludedResponseHeaders", "topDomains", "excludedTopDomains",
]);
// Lowercase ASCII labels; Chrome canonicalizes and refuses upper case and
// non-ASCII (an IDN host must be punycode, xn--).
const LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;
function hostProblem(h) {
  if (typeof h !== "string" || !h) return "empty";
  if (h.length > 253) return "longer than 253";
  if (/[^\x21-\x7e]/.test(h)) return "not ASCII";
  if (h !== h.toLowerCase()) return "not lowercase";
  for (const label of h.split(".")) if (!LABEL_RE.test(label)) return "bad label '" + label + "'";
  return null;
}

function ruleProblems(r, seen) {
  const p = [];
  if (!Number.isInteger(r.id) || r.id < 1) p.push("id " + r.id + " is not an integer >= 1");
  else if (seen.has(r.id)) p.push("duplicate id");
  seen.add(r.id);
  if ("priority" in r && (!Number.isInteger(r.priority) || r.priority < 1)) p.push("priority " + r.priority);
  const a = r.action || {};
  if (!ACTIONS.has(a.type)) p.push("action " + a.type);
  const c = r.condition;
  if (!c || typeof c !== "object") return p.concat("no condition");
  for (const k of Object.keys(c)) if (!CONDITION_KEYS.has(k)) p.push("unknown condition key " + k);
  for (const k of DOMAIN_KEYS.concat(["domains", "excludedDomains"])) {
    if (!(k in c)) continue;
    if (!Array.isArray(c[k]) || !c[k].length) { p.push(k + " is empty or not an array"); continue; }
    for (const h of c[k]) {
      const why = hostProblem(h);
      if (why) p.push(k + " '" + h + "': " + why);
    }
  }
  if (c.requestMethods && c.excludedRequestMethods) p.push("requestMethods and excludedRequestMethods both set");
  for (const k of ["requestMethods", "excludedRequestMethods"]) {
    if (!(k in c)) continue;
    if (!Array.isArray(c[k]) || !c[k].length) p.push(k + " is empty or not an array");
    else for (const m of c[k]) if (!METHODS.has(m)) p.push(k + " '" + m + "'");
  }
  for (const k of ["resourceTypes", "excludedResourceTypes"]) {
    if (!(k in c)) continue;
    if (!Array.isArray(c[k]) || (k === "resourceTypes" && !c[k].length)) p.push(k + " is empty or not an array");
    else for (const t of c[k]) if (!RESOURCE_TYPES.has(t)) p.push(k + " '" + t + "'");
  }
  if (Array.isArray(c.resourceTypes) && Array.isArray(c.excludedResourceTypes)) {
    const both = c.resourceTypes.filter((t) => c.excludedResourceTypes.includes(t));
    if (both.length) p.push("resource types both included and excluded: " + both.join(","));
  }
  if ("domainType" in c && c.domainType !== "firstParty" && c.domainType !== "thirdParty") p.push("domainType " + c.domainType);
  if ("urlFilter" in c && "regexFilter" in c) p.push("urlFilter and regexFilter both set");
  if ("urlFilter" in c && (typeof c.urlFilter !== "string" || !c.urlFilter || /[^\x00-\x7f]/.test(c.urlFilter))) p.push("urlFilter empty or not ASCII");
  if (a.type === "allowAllRequests") {
    const types = c.resourceTypes || [];
    if (!types.length || types.some((t) => t !== "main_frame" && t !== "sub_frame")) p.push("allowAllRequests needs main_frame / sub_frame only");
  }
  return p;
}

Deno.test("manifest static rulesets are the three checked here", () => {
  const paths = RESOURCES.map((r) => r.path).sort();
  assert(JSON.stringify(paths) === JSON.stringify(EXPECTED_PATHS), "rule_resources: " + JSON.stringify(paths));
});

for (const res of RESOURCES) {
  Deno.test("DNR field rules: every rule in " + res.path, () => {
    const rules = JSON.parse(Deno.readTextFileSync(new URL(res.path, ROOT)));
    assert(Array.isArray(rules) && rules.length > 0, res.path + " is not a non-empty array");
    const seen = new Set();
    const bad = [];
    for (const r of rules) {
      const p = ruleProblems(r, seen);
      if (p.length) bad.push("rule " + r.id + ": " + p.slice(0, 3).join("; "));
    }
    assert(!bad.length, res.path + ": " + bad.length + " invalid rules\n  " + bad.slice(0, 15).join("\n  "));
  });
}

Deno.test("the checker catches each field-rule break (self-test)", () => {
  const ok = { id: 1, priority: 1, action: { type: "block" }, condition: { requestDomains: ["ads.example.com"], resourceTypes: ["script"] } };
  assert(!ruleProblems(ok, new Set()).length, "a valid rule passes: " + ruleProblems(ok, new Set()).join("; "));
  const cases = [
    [{ id: 0 }, "id"],
    [{ priority: 0 }, "priority"],
    [{ action: { type: "drop" } }, "action"],
    [{ condition: { requestDomains: [] } }, "requestDomains is empty"],
    [{ condition: { initiatorDomains: ["Example.com"] } }, "not lowercase"],
    [{ condition: { excludedRequestDomains: ["bücher.example"] } }, "not ASCII"],
    [{ condition: { excludedInitiatorDomains: ["a..b"] } }, "bad label"],
    [{ condition: { requestDomains: ["https://a.example/"] } }, "bad label"],
    [{ condition: { requestDomains: ["a.example"], requestMethods: ["get"], excludedRequestMethods: ["post"] } }, "both set"],
    [{ condition: { requestDomains: ["a.example"], requestMethods: ["fetch"] } }, "requestMethods 'fetch'"],
    [{ condition: { requestDomains: ["a.example"], resourceTypes: ["scripts"] } }, "resourceTypes 'scripts'"],
    [{ condition: { requestDomains: ["a.example"], resourceTypes: ["script"], excludedResourceTypes: ["script"] } }, "both included and excluded"],
    [{ condition: { requestDomains: ["a.example"], domainType: "third" } }, "domainType"],
    [{ condition: { requestDomains: ["a.example"], resourceTypes: [] } }, "resourceTypes is empty"],
  ];
  for (const [patch, want] of cases) {
    const r = Object.assign({}, ok, patch);
    const p = ruleProblems(r, new Set());
    assert(p.some((x) => x.includes(want)), JSON.stringify(patch) + " not caught as '" + want + "': " + JSON.stringify(p));
  }
  const seen = new Set([1]);
  assert(ruleProblems(ok, seen).some((x) => x === "duplicate id"), "duplicate id caught");
});
