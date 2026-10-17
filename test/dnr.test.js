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
  assertEquals(mergeMeta.allow_rules, 3);
});

function allowsHost(rule, host) {
  const domains = rule.condition?.requestDomains || [];
  const excluded = rule.condition?.excludedRequestDomains || [];
  const covered = domains.some((domain) => host === domain || host.endsWith("." + domain));
  const skipped = excluded.some((domain) => host === domain || host.endsWith("." + domain));
  return covered && !skipped;
}

Deno.test("buildDnrExclusionRules matches packed high-priority allows", () => {
  const built = api.buildDnrExclusionRules({ idStart: 1, priority: 2_000_000 });
  assertEquals(built.length, 3);
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
  for (const host of api.VIDEO_CDN_DOMAINS) {
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
    assert(!api.isExcludedHost(host), `${host} is not a stream host`);
  }
  const allowBlob = JSON.stringify(rules.filter((rule) => rule.priority >= 9000));
  for (const host of extra) {
    assert(!allowBlob.includes(host), `${host} stays off the high-priority allow`);
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
      assert(domain !== "live-video.net" && !domain.endsWith(".live-video.net"), `live-video ${domain}`);
    }
  }
});

Deno.test("permissions stay DNR + storage; no host_permissions / background", () => {
  assertEquals(manifest.permissions?.slice().sort(), ["declarativeNetRequest", "storage"].sort());
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
