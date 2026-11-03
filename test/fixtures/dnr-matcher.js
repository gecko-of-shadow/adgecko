// A small declarativeNetRequest matcher for tests (documented precedence, not
// Chrome's code):
//   - the highest-priority matching rule wins;
//   - at equal priority: allow > allowAllRequests > block (> others);
//   - an allowAllRequests rule that matched a frame's own document request
//     (main_frame / sub_frame) is inherited by every request from that frame
//     and its child frames, at that rule's priority.
// Conditions: requestDomains / excludedRequestDomains and initiatorDomains /
// excludedInitiatorDomains (each also matches subdomains), resourceTypes
// (omitted = every type except main_frame), excludedResourceTypes,
// domainType (site = last two labels), requestMethods (omitted = all),
// regexFilter, simple urlFilter (||, ^, *, |).
const under = (h, d) => h === d || h.endsWith("." + d);
const anyUnder = (h, list) => (list || []).some((d) => under(h, d));
const site = (h) => String(h || "").split(".").slice(-2).join(".");
const ACTION_RANK = { allow: 3, allowAllRequests: 2, block: 1 };

function urlFilterToRegExp(f) {
  let s = f;
  let prefix = "";
  let suffix = "";
  if (s.startsWith("||")) { prefix = "^[a-z][a-z0-9+.-]*://(?:[^/?#]*\\.)?"; s = s.slice(2); }
  else if (s.startsWith("|")) { prefix = "^"; s = s.slice(1); }
  if (s.endsWith("|")) { suffix = "$"; s = s.slice(0, -1); }
  const body = s.split("").map((c) => (c === "*" ? ".*" : c === "^" ? "(?:[^a-zA-Z0-9_\\-.%]|$)" : c.replace(/[.+?${}()|[\]\\/]/g, "\\$&"))).join("");
  return new RegExp(prefix + body + suffix, "i");
}

export function ruleMatches(rule, req) {
  const c = rule.condition || {};
  const host = new URL(req.url).hostname;
  const type = req.type;
  if (c.requestDomains && !anyUnder(host, c.requestDomains)) return false;
  if (c.excludedRequestDomains && anyUnder(host, c.excludedRequestDomains)) return false;
  if (c.initiatorDomains && !(req.initiator && anyUnder(req.initiator, c.initiatorDomains))) return false;
  if (c.excludedInitiatorDomains && req.initiator && anyUnder(req.initiator, c.excludedInitiatorDomains)) return false;
  if (c.resourceTypes ? !c.resourceTypes.includes(type) : type === "main_frame") return false;
  if (c.excludedResourceTypes && c.excludedResourceTypes.includes(type)) return false;
  if (c.domainType) {
    const third = !!req.initiator && site(req.initiator) !== site(host);
    if ((c.domainType === "thirdParty") !== third) return false;
  }
  if (c.requestMethods && !c.requestMethods.includes(req.method || "get")) return false;
  if (c.regexFilter && !new RegExp(c.regexFilter).test(req.url)) return false;
  if (c.urlFilter && !urlFilterToRegExp(c.urlFilter).test(req.url)) return false;
  return true;
}

function best(cands) {
  let win = null;
  for (const r of cands) {
    if (!win || r.priority > win.priority || (r.priority === win.priority && (ACTION_RANK[r.action.type] || 0) > (ACTION_RANK[win.action.type] || 0))) win = r;
  }
  return win;
}

// rules: flat array of all enabled rules (static + dynamic + session).
// req: { url, type, method?, frames: [top host, ..., issuing frame host] }
// The initiator is the issuing frame's host (none for a top-level navigation).
// Returns { action: "allow" | "block" | "none", rule }.
export function evaluate(rules, req) {
  const frames = req.frames || [];
  // allowAllRequests inherited from the frame chain.
  let inherited = null;
  for (let i = 0; i < frames.length; i++) {
    const docReq = {
      url: "https://" + frames[i] + "/",
      type: i === 0 ? "main_frame" : "sub_frame",
      initiator: i === 0 ? null : frames[i - 1],
      method: "get",
    };
    const matched = rules.filter((r) => ruleMatches(r, docReq));
    const top = best(matched);
    if (top && top.action.type === "allowAllRequests" && (!inherited || top.priority > inherited.priority)) inherited = top;
    if (top && top.action.type === "block") break; // the frame itself would not load
  }
  const r = { url: req.url, type: req.type, method: req.method || "get", initiator: req.initiator !== undefined ? req.initiator : (frames.length ? frames[frames.length - 1] : null) };
  const cands = rules.filter((x) => ruleMatches(x, r));
  if (inherited) cands.push(inherited);
  const win = best(cands);
  if (!win) return { action: "none", rule: null };
  return { action: win.action.type === "block" ? "block" : "allow", rule: win };
}
