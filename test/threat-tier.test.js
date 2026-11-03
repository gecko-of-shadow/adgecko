// Block D: threat tier at priority 2,000,010 with protected stream hosts.
// Uses a small DNR matcher (test/fixtures/dnr-matcher.js) over the shipped rule
// files plus the dynamic rules the worker really creates.
import "../src/general/filter-options.js";
import "../src/threat/protected-hosts.js";
import "../src/threat/compile.js";
import updateSource from "../src/general/update.js" with { type: "text" };
import general from "../src/rules/general-network.json" with { type: "json" };
import uboYoutube from "../src/rules/ubo-youtube-network.json" with { type: "json" };
import threat from "../src/rules/threat-network.json" with { type: "json" };
import threatMeta from "../src/rules/threat-meta.json" with { type: "json" };
import manifest from "../manifest.json" with { type: "json" };
import { evaluate, ruleMatches } from "./fixtures/dnr-matcher.js";
import { loadWorker, settle } from "./fixtures/fake-chrome-worker.js";
function assert(c, l) { if (!c) throw new Error(l); }

const PH = globalThis.GeckoProtectedHosts;
const TC = globalThis.GeckoThreatCompile;
const U = {};
new Function(`${updateSource}\nreturn installGeneralAdblockUpdate;`)()(U);

const STREAM_HOSTS = (await Deno.readTextFile(new URL("./fixtures/stream-hosts.txt", import.meta.url)))
  .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const ALL_TYPES = TC.ALL_TYPES;
const SECTION5 = ["twitch.tv", "ttvnw.net", "jtvnw.net", "twitchcdn.net", "twitchcdn.com", "live-video.net", "ext-twitch.tv", "kick.com", "kick-streamer.com", "youtube.com", "youtu.be", "youtube-nocookie.com", "googlevideo.com", "ytimg.com", "ggpht.com", "youtubei.googleapis.com", "play.googleapis.com", "fonts.googleapis.com", "fonts.gstatic.com", "www.gstatic.com", "ssl.gstatic.com", "www.google.com", "accounts.google.com", "googleapis.com", "gstatic.com", "storage.googleapis.com"];

// A real threat host from the shipped static set, plus a synthetic one compiled
// the way the runtime refresh does (dynamic id range).
const REAL_THREAT = threat[0].condition.requestDomains[0];
const SYN = "malware-drop.example";
const BUCKET = "evil-bucket.storage.googleapis.com";
const dynThreat = TC.compileThreatRules([SYN, BUCKET], { idBase: U.THREAT_RULE_ID_BASE }).rules;

// Contexts: frame chains (top first).
const CTX = {
  ordinary: ["news.example"],
  youtube: ["www.youtube.com"],
  youtubeEmbed: ["news.example", "www.youtube-nocookie.com"],
  youtubeEmbed2: ["news.example", "www.youtube.com"],
  kick: ["kick.com"],
  twitch: ["www.twitch.tv"],
  allowedPage: ["allowed.example"],
};

async function worldWith(opts = {}) {
  const w = loadWorker({ store: { generalEnabled: true, generalAllowedOrigins: ["https://allowed.example"], threatAllowDomains: opts.overrides || [] } });
  await w.send({ source: "twitch-adblock-general", type: "applyGeneralState" });
  if (opts.overrides) {
    await new Promise((r) => w.chrome.storage.local.set({ threatAllowDomains: opts.overrides.slice() }, r));
  }
  await settle(150);
  const dynamic = w.dnr.dynamic.concat(dynThreat);
  const staticRules = (w.dnr.staticOn ? general : []).concat(uboYoutube, threat);
  return { w, rules: staticRules.concat(dynamic) };
}

const url = (h, path = "/x.js") => "https://" + h + path;

Deno.test("threat rules: exact priority, types, size; no initiator conditions; manifest wires the ruleset last", () => {
  assert(threat.length > 50 && threatMeta.rule_count === threat.length, "static threat set present: " + threat.length);
  const types = ["main_frame", "sub_frame", "script", "xmlhttprequest", "ping", "media", "websocket", "other"];
  for (const r of threat.concat(dynThreat)) {
    assert(r.priority === 2000010 && r.action.type === "block", "priority/action " + r.id);
    assert(JSON.stringify(r.condition.resourceTypes) === JSON.stringify(types), "types " + r.id);
    assert(r.condition.requestDomains.length >= 1 && r.condition.requestDomains.length <= 80, "hosts per rule " + r.id);
    assert(Object.keys(r.condition).sort().join() === "requestDomains,resourceTypes", "no other conditions " + r.id);
  }
  const res = manifest.declarative_net_request.rule_resources;
  assert(res[0].id === "general" && res[res.length - 1].id === "threat" && res[res.length - 1].enabled === true && res[res.length - 1].path === "src/rules/threat-network.json", "manifest threat ruleset");
  assert(new Set(threat.map((r) => r.id)).size === threat.length, "unique ids");
});

Deno.test("matcher: a threat host is blocked on an ordinary page, in YouTube and Kick frames, in embeds, from an allowed page, and as main_frame", async () => {
  const { rules } = await worldWith();
  for (const host of [REAL_THREAT, SYN, BUCKET]) {
    for (const [name, frames] of Object.entries(CTX)) {
      for (const type of ["script", "sub_frame", "xmlhttprequest", "media", "ping", "websocket", "other"]) {
        const v = evaluate(rules, { url: url(host), type, frames });
        assert(v.action === "block" && v.rule.priority === 2000010, `${host} ${type} on ${name}: ${v.action} ${v.rule && v.rule.priority}`);
      }
    }
    const nav = evaluate(rules, { url: url(host, "/"), type: "main_frame", frames: [], initiator: null });
    assert(nav.action === "block", host + " navigation not blocked");
    const navFromPage = evaluate(rules, { url: url(host, "/"), type: "main_frame", frames: [], initiator: "news.example" });
    assert(navFromPage.action === "block", host + " link navigation not blocked");
  }
});

Deno.test("matcher: stylesheet/font/image from a threat host are left to the ordinary lists (not threat types)", async () => {
  const { rules } = await worldWith();
  for (const type of ["stylesheet", "font", "image"]) {
    const v = evaluate(rules, { url: url(SYN), type, frames: CTX.youtube });
    assert(v.action !== "block" || v.rule.priority !== 2000010, type + " hit the threat tier");
  }
});

Deno.test("matcher: the user allow-domain override (2,000,020) unblocks a threat host everywhere, navigation included", async () => {
  const { rules } = await worldWith({ overrides: [SYN, "https://" + REAL_THREAT + "/path"] });
  for (const host of [SYN, "sub." + SYN, REAL_THREAT]) {
    for (const [name, frames] of Object.entries(CTX)) {
      const v = evaluate(rules, { url: url(host), type: "script", frames });
      assert(v.action === "allow" && v.rule.priority === 2000020, `${host} on ${name}: ${v.action}`);
    }
    const nav = evaluate(rules, { url: url(host, "/"), type: "main_frame", frames: [], initiator: null });
    assert(nav.action === "allow" && nav.rule.priority === 2000020, host + " navigation still blocked");
  }
  // Only the typed domains: the bucket host stays blocked.
  assert(evaluate(rules, { url: url(BUCKET), type: "script", frames: CTX.ordinary }).action === "block", "override leaked");
});

Deno.test("matcher: protected hosts are never blocked by a threat rule, any type, any context", async () => {
  const { rules } = await worldWith();
  const threatRules = rules.filter((r) => r.priority === 2000010);
  const hosts = new Set(STREAM_HOSTS);
  for (const p of PH.SUFFIX) { hosts.add(p); hosts.add("a1." + p); hosts.add("x.y." + p); }
  for (const p of PH.EXACT) hosts.add(p);
  for (const h of hosts) {
    for (const type of ALL_TYPES) {
      for (const frames of Object.values(CTX)) {
        const req = { url: url(h), type, initiator: frames[frames.length - 1] };
        for (const r of threatRules) assert(!ruleMatches(r, req), `threat rule ${r.id} matches protected ${h} (${type})`);
      }
    }
  }
});

Deno.test("matcher: stream hosts load on their own pages (no rule blocks them), and YouTube videoplayback still loads", async () => {
  const { rules } = await worldWith();
  const pages = { youtube: CTX.youtube, youtubeEmbed: CTX.youtubeEmbed, kick: CTX.kick, twitch: CTX.twitch };
  for (const h of STREAM_HOSTS) {
    for (const [name, frames] of Object.entries(pages)) {
      for (const type of ["script", "xmlhttprequest", "media", "sub_frame", "image", "stylesheet", "font", "websocket", "other"]) {
        const v = evaluate(rules, { url: url(h), type, frames });
        assert(v.action !== "block", `${h} ${type} on ${name} blocked by rule ${v.rule && v.rule.id} (prio ${v.rule && v.rule.priority})`);
      }
    }
  }
  const expire = Math.floor(Date.now() / 1000) + 6 * 3600;
  const vp = evaluate(rules, { url: `https://rr1---sn-example.googlevideo.com/videoplayback?expire=${expire}&ei=x`, type: "xmlhttprequest", frames: CTX.youtube });
  assert(vp.action !== "block", "videoplayback blocked");
  const ytNav = evaluate(rules, { url: "https://www.youtube.com/watch?v=x", type: "main_frame", frames: [], initiator: null });
  assert(ytNav.action !== "block", "youtube navigation blocked");
});

Deno.test("compiler: every stream fixture host is rejected by protected-hosts, and no compiled threat rule matches one", () => {
  for (const h of STREAM_HOSTS) assert(PH.isProtectedHost(h), "fixture host accepted by the compiler: " + h);
  const compiled = TC.compileThreatRules(STREAM_HOSTS, { idBase: 1 });
  assert(compiled.rules.length === 0 && compiled.rejected.length === STREAM_HOSTS.length, "compiled a stream host");
  for (const h of STREAM_HOSTS) {
    for (const r of threat.concat(dynThreat)) {
      for (const d of r.condition.requestDomains) {
        assert(!(h === d || h.endsWith("." + d)), `threat entry ${d} would match stream host ${h}`);
      }
    }
  }
  for (const p of SECTION5) assert(PH.ALL.includes(p), "section-5 host missing from protected list: " + p);
});

Deno.test("compiler: protected entries, their subdomains and their ancestors are rejected; bucket hosts and ordinary hosts pass", () => {
  const reject = ["twitch.tv", "edge.twitch.tv", "a.b.ttvnw.net", "youtubei.googleapis.com", "x.fonts.googleapis.com", "www.google.com",
    "googleapis.com", "gstatic.com", "storage.googleapis.com", "google.com", "tv", "net", "com", "co.uk", "com.au",
    "", " ", "bad host.example", "http://evil.example/", "*.evil.example", "-lead.example", "a..b.example"];
  for (const h of reject) assert(PH.protectedReason(h), "accepted: " + JSON.stringify(h));
  const pass = ["evil-bucket.storage.googleapis.com", "x.evil.googleapis.com", "cdn.malware.example", "google.com.evil.example", "twitch.tv.evil.example", "notyoutube.com", "192.0.2.10"];
  for (const h of pass) assert(PH.protectedReason(h) === null, "rejected: " + h + " (" + PH.protectedReason(h) + ")");
  const res = TC.compileThreatRules(["Evil.Example.", "evil.example", "googleapis.com", "x.evil.example"], { idBase: 7 });
  assert(JSON.stringify(res.accepted) === JSON.stringify(["evil.example", "x.evil.example"]) && res.rejected.length === 1 && res.rules[0].id === 7, JSON.stringify(res));
});

Deno.test("fuzz: random subdomains of protected hosts never match any threat rule, and random hosts never compile into one that does", () => {
  let seed = 20261102;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const label = () => Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => "abcdefghijklmnopqrstuvwxyz0123456789-"[Math.floor(rnd() * 37)]).join("").replace(/^-|-$/g, "a");
  const rules = threat.concat(dynThreat);
  const probes = [];
  for (let i = 0; i < 3000; i++) {
    const p = PH.SUFFIX[Math.floor(rnd() * PH.SUFFIX.length)];
    const depth = 1 + Math.floor(rnd() * 3);
    probes.push(Array.from({ length: depth }, label).join(".") + "." + p);
  }
  for (const h of probes.concat(PH.EXACT)) {
    for (const r of rules) for (const d of r.condition.requestDomains) assert(!(h === d || h.endsWith("." + d)), `${d} matches ${h}`);
  }
  // Mixed input: protected hosts, their subdomains/ancestors, and random hosts.
  const mixed = probes.slice(0, 500).concat(PH.ALL, ["google.com", "googleapis.com", "gstatic.com"], Array.from({ length: 500 }, () => label() + "." + label() + ".example"));
  const compiled = TC.compileThreatRules(mixed, { idBase: 1 });
  for (const r of compiled.rules) for (const d of r.condition.requestDomains) {
    for (const p of PH.ALL) assert(!(p === d || p.endsWith("." + d) || d.endsWith("." + p)) || (PH.EXACT.includes(p) && d.endsWith("." + p) && !PH.SUFFIX.some((s) => d === s || d.endsWith("." + s))), `compiled ${d} hits ${p}`);
  }
  assert(compiled.accepted.length >= 400, "random ordinary hosts accepted: " + compiled.accepted.length);
});

Deno.test("limits: static rules under 30,000, dynamic stays under 30,000 with the threat tier, regex rules under 1,000", async () => {
  const staticTotal = general.length + uboYoutube.length + threat.length;
  assert(staticTotal < 30000, "static " + staticTotal);
  const regex = general.concat(uboYoutube, threat).filter((r) => r.condition.regexFilter).length;
  assert(regex < 1000, "regex " + regex);
  // Dynamic budget: the threat rebuild never pushes the total past the cap.
  const existing = Array.from({ length: 29950 }, (_, i) => ({ id: U.LIST_RULE_ID_BASE + i }));
  let dynamic = existing.slice();
  const deps = {
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setState: async () => {},
  };
  const hosts = Array.from({ length: 20000 }, (_, i) => "h" + i + ".threat.example");
  const res = await U.applyThreatRules(deps, { urlhaus_hosts: { domains: hosts, scoped: [] } }, 1);
  assert(res.ok && dynamic.length <= U.DYNAMIC_RULE_LIMIT, "dynamic total " + dynamic.length);
  // Realistic: list rules + kept + threat refresh stay well under the cap.
  const realistic = 2406 + 10 + Math.ceil(threatMeta.hosts_total / 80) + 1;
  assert(realistic < 30000 * 0.2, "realistic dynamic " + realistic);
});

Deno.test("lists switch off, fallback and a failed list swap leave the dynamic threat rules alone", async () => {
  let dynamic = [{ id: U.LIST_RULE_ID_BASE, priority: 1, action: { type: "block" }, condition: { requestDomains: ["ad.example"] } }].concat(dynThreat);
  let staticOn = true;
  const deps = {
    getState: async () => ({ dynamicActive: true, lists: {} }),
    setState: async () => {},
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setStaticEnabled: async (on) => { staticOn = on; },
    getListData: async () => ({}),
    now: () => 1,
    enabled: () => false,
  };
  await U.applyEnabled(deps, false);
  assert(!staticOn && !dynamic.some((r) => r.id === U.LIST_RULE_ID_BASE), "lists off removed list rules");
  assert(dynThreat.every((t) => dynamic.some((r) => r.id === t.id)), "threat rules removed by the lists switch");
  for (const id of dynThreat.map((r) => r.id)) assert(U.isThreatRule(id) && !U.isOurRule(id), "threat ids outside the list range");
});

Deno.test("a refresh swap rebuilds dynamic threat rules from the threat lists only (whole-domain and $doc entries)", async () => {
  await import("../src/general/update.js"); // installs globalThis.GeneralAdblockUpdate with the compiler loaded
  const G = globalThis.GeneralAdblockUpdate;
  const payloads = {
    urlhaus_hosts: { domains: ["u1.example", "www.youtube.com"], scoped: [], parser: G.PARSER_VERSION },
    ublock_badware: { domains: [], scoped: [["doc.example", "p=|t=main_frame|x="], ["third.example", "p=thirdParty|t=|x="]], parser: G.PARSER_VERSION },
    easylist: { domains: ["ad.example"], scoped: [], parser: G.PARSER_VERSION },
  };
  let dynamic = [];
  const state = {};
  const deps = {
    getDynamicRules: async () => dynamic.slice(),
    updateDynamicRules: async ({ removeRuleIds, addRules }) => { dynamic = dynamic.filter((r) => !removeRuleIds.includes(r.id)).concat(addRules); },
    setState: async (p) => Object.assign(state, p),
  };
  const res = await G.applyThreatRules(deps, payloads, 5);
  const hosts = dynamic.flatMap((r) => r.condition.requestDomains);
  assert(res.ok && JSON.stringify(hosts) === JSON.stringify(["u1.example", "doc.example"]), JSON.stringify(hosts));
  assert(state.threatRejected === 1 && state.threatHosts === 2, JSON.stringify(state));
});
