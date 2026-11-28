import manifest from "../manifest.json" with { type: "json" };
import rules from "../src/rules/general-network.json" with { type: "json" };
import mergeMeta from "../src/rules/dnr-merge-meta.json" with { type: "json" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEquals(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label || "expected equal"}\n${left}\n${right}`);
}

// Stream page hosts and their video CDNs: the lists the merger used
// (scripts/merge-dnr-rules.py records them in dnr-merge-meta.json). The
// merger checks them against STREAM_SITES in src/settings/features.js, the one
// stream-host list (CONCERNS M1; the test below runs that check). The packed
// high-priority allow rules must cover them, and no block rule may target
// them. One exception: the Twitch ad host ads.twitch.tv (owner decision
// 2026-11-20) is blocked, and only by the merger's extra tracker rule
// (isApprovedStreamBlock).
const APPROVED_STREAM_BLOCK = "ads.twitch.tv";
function isApprovedStreamBlock(rule, domain) {
  return rule.id === mergeMeta.extra_tracker_rule_id && domain === APPROVED_STREAM_BLOCK;
}
const SITE_DOMAINS = Object.freeze(mergeMeta.site_domains.slice());
const VIDEO_CDN_DOMAINS = Object.freeze(mergeMeta.video_cdn_domains.slice());
const ALL_EXCLUDED = Object.freeze([...new Set(SITE_DOMAINS.concat(VIDEO_CDN_DOMAINS))]);
function isExcludedHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  return ALL_EXCLUDED.some((d) => h === d || h.endsWith("." + d));
}

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
  assertEquals(mergeMeta.allow_rules, 3);
});

function allowsHost(rule, host) {
  const domains = rule.condition?.requestDomains || [];
  const excluded = rule.condition?.excludedRequestDomains || [];
  const covered = domains.some((domain) => host === domain || host.endsWith("." + domain));
  const skipped = excluded.some((domain) => host === domain || host.endsWith("." + domain));
  return covered && !skipped;
}

Deno.test("packed high-priority allows cover the stream sites and their video CDNs", () => {
  assertEquals(mergeMeta.allow_rules, 3);
  assertEquals(rules[0].action.type, "allowAllRequests");
  assertEquals(rules[1].action.type, "allow");
  assertEquals(rules[2].action.type, "allow");
  assert(!rules[0].condition.requestDomains.includes("twitch.tv"), "twitch is not allowAllRequests");
  for (const host of ["youtube.com", "youtu.be", "kick.com"]) {
    assert(rules[0].condition.requestDomains.includes(host), `frame allow ${host}`);
  }
  assert(allowsHost(rules[1], "gql.twitch.tv"), "gql stays allowed");
  assert(allowsHost(rules[1], "www.twitch.tv"), "twitch pages stay allowed");
  assert(!allowsHost(rules[1], "edge.ads.twitch.tv"), "directory ad host is not force-allowed");
  for (const host of VIDEO_CDN_DOMAINS) {
    assert(rules[2].condition.requestDomains.includes(host), `cdn ${host}`);
  }
  assert(allowsHost(rules[2], "usher.ttvnw.net"), "usher stays allowed");
  const high = rules.filter((rule) => (rule.priority || 0) >= 9000);
  for (const rule of high) {
    assert(!allowsHost(rule, "s.amazon-adsystem.com"), "amazon ads are not allowed");
    assert(!allowsHost(rule, "amazon-adsystem.com"), "amazon ads apex is not allowed");
  }
  const blocked = new Set(
    rules.filter((rule) => rule.action?.type === "block")
      .flatMap((rule) => rule.condition?.requestDomains || []),
  );
  assert(blocked.has("amazon-adsystem.com"), "amazon-adsystem stays on the block list");
});

Deno.test("extra tracker hosts are blocked and are not stream allows", () => {
  const extra = ["facebook.net", "fundingchoicesmessages.google.com", "imasdk.googleapis.com"];
  const blocks = rules.filter((rule) => rule.action?.type === "block");
  const blocked = new Set(blocks.flatMap((rule) => rule.condition?.requestDomains || []));
  for (const host of extra) {
    assert(blocked.has(host), `block ${host}`);
    assert(!isExcludedHost(host), `${host} is not a stream host`);
  }
  const allowBlob = JSON.stringify(rules.filter((rule) => rule.priority >= 9000));
  for (const host of extra) {
    assert(!allowBlob.includes(host), `${host} stays off the high-priority allow`);
  }
});

Deno.test("block rules never target protected stream hosts", () => {
  const excluded = ALL_EXCLUDED;
  let approved = 0;
  for (const rule of rules) {
    if (rule.action?.type !== "block") continue;
    for (const domain of rule.condition?.requestDomains || []) {
      if (isApprovedStreamBlock(rule, domain)) {
        approved += 1;
        continue;
      }
      assert(!isExcludedHost(domain), `must not block ${domain}`);
      for (const suf of excluded) {
        assert(domain !== suf && !domain.endsWith("." + suf), `block hit ${domain}`);
      }
      assert(domain !== "live-video.net" && !domain.endsWith(".live-video.net"), `live-video ${domain}`);
    }
  }
  assertEquals(approved, 1, "the extra tracker rule blocks " + APPROVED_STREAM_BLOCK);
  assert(mergeMeta.extra_tracker_domains.includes(APPROVED_STREAM_BLOCK), "merge meta names " + APPROVED_STREAM_BLOCK);
});

// Review 2026-11-16 WP-09 item 4: the check above uses the merger's allow
// lists (dnr-merge-meta.json). Those lists do not have ext-twitch.tv,
// twitchcdn.com, kickusercontent.com or kick-streamer.com (the merger names
// them in STREAM_SITES_NOT_ALLOWED). This test uses the live registry
// (GeckoFeatures.isStreamHost, src/settings/features.js) as the oracle.
//
// Owner decision 16 (2026-11-20): ubo-youtube-network.json rule 1 blocks
// ads.youtube.com. The uBO filter does this on purpose. The registry lists
// the host because it is under youtube.com. The owner chose a named exception
// and kept the registry. Each exception names one ruleset and one host.
// scripts/sync-ubo-youtube.mjs makes that ruleset. Thus a test fails if a new
// sync blocks a different stream host, or does not block this host any more
// (a stale exception).
//
// Owner decision (2026-11-20): the general ruleset blocks ads.twitch.tv, but
// only in the merger's extra tracker rule (ruleId pins the exception to that
// rule). The threat ruleset has no exception.
const STREAM_HOST_BLOCK_EXCEPTIONS = Object.freeze([
  Object.freeze({
    name: "ubo-youtube-ads-host",
    ruleset: "ubo-youtube",
    domain: "ads.youtube.com",
    why: "uAssets filter ||ads.youtube.com^$domain=~ads.youtube.com (an ad host, not a video or page host); owner decision 16",
  }),
  Object.freeze({
    name: "twitch-ads-host",
    ruleset: "general",
    ruleId: mergeMeta.extra_tracker_rule_id,
    domain: APPROVED_STREAM_BLOCK,
    why: "Twitch ad host, blocked by the extra tracker rule; owner decision 2026-11-20",
  }),
]);

// Returns the block requestDomains of a ruleset that are stream hosts and that
// no exception covers, and the names of the exceptions that it used.
function streamHostBlocks(F, ruleset, set, exceptions) {
  const violations = [];
  const used = new Set();
  let checked = 0;
  for (const rule of set) {
    if (rule.action?.type !== "block") continue;
    for (const domain of rule.condition?.requestDomains || []) {
      checked += 1;
      if (!F.isStreamHost(domain)) continue;
      const ex = exceptions.find((e) => e.ruleset === ruleset && e.domain === F.normalizeHost(domain) && (e.ruleId === undefined || e.ruleId === rule.id));
      if (ex) used.add(ex.name);
      else violations.push(`${ruleset} rule ${rule.id} blocks stream host ${domain}`);
    }
  }
  return { violations, used, checked };
}

Deno.test("shipped block rules never target a STREAM_SITES host, except the named exceptions (live registry oracle)", async () => {
  await import("../src/settings/features.js");
  const F = globalThis.GeckoFeatures;
  assert(F && typeof F.isStreamHost === "function", "GeckoFeatures loaded");
  for (const host of ["ext-twitch.tv", "a.twitchcdn.com", "files.kickusercontent.com", "kick-streamer.com"]) {
    assert(F.isStreamHost(host), "oracle knows " + host);
  }
  const { default: threatRules } = await import("../src/rules/threat-network.json", { with: { type: "json" } });
  const { default: uboRules } = await import("../src/rules/ubo-youtube-network.json", { with: { type: "json" } });
  const rulesets = [["general", rules], ["threat", threatRules], ["ubo-youtube", uboRules]];
  const ids = manifest.declarative_net_request.rule_resources.map((r) => r.id);
  for (const [name] of rulesets) assert(ids.includes(name), "manifest has no ruleset " + name + ": " + JSON.stringify(ids));
  const used = new Set();
  for (const [name, set] of rulesets) {
    const r = streamHostBlocks(F, name, set, STREAM_HOST_BLOCK_EXCEPTIONS);
    assert(r.checked > 0, name + ": no block domain checked");
    assert(r.violations.length === 0, r.violations.join("; "));
    for (const n of r.used) used.add(n);
  }
  for (const ex of STREAM_HOST_BLOCK_EXCEPTIONS) {
    assert(F.isStreamHost(ex.domain), `exception ${ex.name}: ${ex.domain} is not a stream host, remove the exception`);
    assert(used.has(ex.name), `exception ${ex.name} is stale: no ${ex.ruleset} block rule names ${ex.domain}`);
  }
});

Deno.test("stream-host block exceptions: ubo-youtube rule 1 fails without its exception; the exception covers one host in one ruleset", async () => {
  await import("../src/settings/features.js");
  const F = globalThis.GeckoFeatures;
  const { default: uboRules } = await import("../src/rules/ubo-youtube-network.json", { with: { type: "json" } });
  const none = streamHostBlocks(F, "ubo-youtube", uboRules, []);
  assert(none.violations.some((v) => v.includes("ads.youtube.com")), "no violation without the exception: " + JSON.stringify(none.violations));
  const block = (id, domain) => ({ id, action: { type: "block" }, condition: { requestDomains: [domain] } });
  const other = streamHostBlocks(F, "ubo-youtube", [block(9, "www.youtube.com"), block(10, "rr1.googlevideo.com")], STREAM_HOST_BLOCK_EXCEPTIONS);
  assert(other.violations.length === 2, "exception covers another stream host: " + JSON.stringify(other.violations));
  const general = streamHostBlocks(F, "general", [block(11, "ads.youtube.com")], STREAM_HOST_BLOCK_EXCEPTIONS);
  assert(general.violations.length === 1, "exception covers another ruleset: " + JSON.stringify(general.violations));
});

Deno.test("permissions stay DNR + storage + alarms; only list host_permissions", () => {
  assertEquals(manifest.permissions?.slice().sort(), ["alarms", "declarativeNetRequest", "storage"].sort());
  assertEquals(manifest.host_permissions, ["https://easylist.to/*", "https://pgl.yoyo.org/*", "https://malware-filter.gitlab.io/*", "https://ublockorigin.github.io/*", "https://easylist-downloads.adblockplus.org/*", "https://secure.fanboy.co.nz/*", "https://raw.githubusercontent.com/hagezi/dns-blocklists/*", "https://raw.githubusercontent.com/DandelionSprout/adfilt/*", "https://filters.adtidy.org/extension/ublock/*"], "only the filter-list hosts");
  assertEquals(manifest.background?.service_worker, "src/general-background.js");
});

Deno.test("YouTube-only doubleclick block: outranks the YouTube frame allow, scoped to YouTube initiators", () => {
  const yt = rules.filter((r) => r.action.type === "block" && (r.condition.requestDomains || []).includes("doubleclick.net") && r.condition.initiatorDomains);
  assertEquals(yt.length, 1, "exactly one YouTube-scoped doubleclick rule (no duplicates)");
  assertEquals(yt[0].condition.requestDomains, ["doubleclick.net"]);
  const r = yt[0];
  const frameAllow = rules.find((x) => x.action.type === "allowAllRequests");
  assert(r.priority > frameAllow.priority, "must outrank allowAllRequests on youtube frames");
  assertEquals(r.condition.initiatorDomains, ["youtube.com", "youtube-nocookie.com", "youtubekids.com"]);
  assert(!r.condition.resourceTypes, "default types (not main_frame) so youtube itself still loads");
  for (const h of ["googleads.g.doubleclick.net", "static.doubleclick.net", "ad.doubleclick.net"]) assert(h.endsWith("." + r.condition.requestDomains[0]), h);
  // Nothing YouTube needs is covered.
  for (const h of ["youtube.com", "www.google.com", "rr2---sn-x.googlevideo.com", "i.ytimg.com", "www.gstatic.com", "pagead2.googlesyndication.com"]) {
    assert(!r.condition.requestDomains.some((d) => h === d || h.endsWith("." + d)), h);
  }
  assertEquals(mergeMeta.youtube_ad_block_rules, 1);
  assertEquals(new Set(rules.map((x) => x.id)).size, rules.length, "unique ids");
});

// CONCERNS M1 (L-6): the merger's allow lists were a hand copy of the stream
// hosts, and this file had a second copy. Now the merger checks its lists
// against STREAM_SITES in src/settings/features.js (check_stream_hosts) and
// stops before it writes when they differ; this file reads the merger's lists
// from dnr-merge-meta.json.
async function runPython(script) {
  const root = new URL("..", import.meta.url);
  const bins = Deno.build.os === "windows" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
  for (const [bin, ...pre] of bins) {
    try {
      const out = await new Deno.Command(bin, { args: [...pre, "-c", script], cwd: root, env: { PYTHONDONTWRITEBYTECODE: "1" } }).output();
      if (out.code === 9009 || /Python was not found|Microsoft Store/.test(new TextDecoder().decode(out.stderr))) continue;
      assert(out.code === 0, new TextDecoder().decode(out.stderr));
      return new TextDecoder().decode(out.stdout);
    } catch (_err) { /* next binary */ }
  }
  throw new Error("no usable Python 3");
}
const MERGER = [
  "import importlib.util, json, io, contextlib",
  "from pathlib import Path",
  "spec = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
  "m = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(m)",
  "def err(sites):",
  "    try:",
  "        m.check_stream_hosts(sites)",
  "        return ''",
  "    except ValueError as e:",
  "        return str(e)",
].join("\n");

Deno.test("merger stream hosts: one list (STREAM_SITES), each host in an allow rule or named as not allowed, as recorded in the meta", async () => {
  await import("../src/settings/features.js");
  const F = globalThis.GeckoFeatures;
  const out = JSON.parse(await runPython(MERGER + "\n" + [
    "sites = m.read_stream_sites()",
    "print(json.dumps({'sites': sites, 'site': m.SITE_DOMAINS, 'cdn': m.VIDEO_CDN_DOMAINS, 'not': m.STREAM_SITES_NOT_ALLOWED, 'err': err(None),",
    "  'extra': err(sites + ['newstream.example']), 'gone': err([s for s in sites if s != 'kick.com'])}))",
  ].join("\n")));
  assertEquals(out.sites, [...F.STREAM_SITES], "the merger reads the live registry");
  assertEquals(out.err, "", "the shipped lists agree");
  assertEquals([out.site, out.cdn], [mergeMeta.site_domains, mergeMeta.video_cdn_domains], "the meta records the merger's lists");
  assertEquals(new Set([...out.site, ...out.cdn, ...out.not]).size, F.STREAM_SITES.length, "every stream host has exactly one place");
  assertEquals(out.not, ["twitchcdn.com", "ext-twitch.tv", "kickusercontent.com", "kick-streamer.com"], "the hosts that no static allow names stay named");
  assert(out.extra.includes("STREAM_SITES host with no decision here: newstream.example"), "a new stream host stops the merger: " + out.extra);
  assert(out.gone.includes("not in STREAM_SITES: kick.com"), "a removed stream host stops the merger: " + out.gone);
});

Deno.test("merger: main() stops before it reads or writes anything when the stream hosts differ", async () => {
  const out = JSON.parse(await runPython(MERGER + "\n" + [
    "real = m.read_stream_sites",
    "m.read_stream_sites = lambda text=None: real() + ['newstream.example']",
    "m.LIST_BLOCKS = Path('scripts/.no-such-dir/blocks.json')",
    "buf = io.StringIO()",
    "with contextlib.redirect_stderr(buf):",
    "    code = m.main()",
    "print(json.dumps({'code': code, 'stderr': buf.getvalue()}))",
  ].join("\n")));
  assertEquals(out.code, 2, "non-zero exit");
  assert(out.stderr.includes("newstream.example") && !out.stderr.includes("missing block rules"), "stopped at the host check: " + out.stderr);
});

