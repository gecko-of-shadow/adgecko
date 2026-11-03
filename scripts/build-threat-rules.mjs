#!/usr/bin/env -S deno run --allow-read --allow-write
// Build the static `threat` ruleset (src/rules/threat-network.json) from the
// threat lists downloaded by scripts/pack-filter-lists.py.
//
//   deno run --allow-read --allow-write scripts/build-threat-rules.mjs [--cache <dir>]
//
// Offline: reads the packer's cache (scripts/.list-cache/<list>.txt, written by
// the same packer run) and never fetches. The packer runs this at its end so
// the threat ruleset never goes stale next to general-network.json.
// Parsing is the runtime's own (general/filter-options.js + general/update.js
// parseEntries) and compiling is src/threat/compile.js, which rejects every
// protected stream host (src/threat/protected-hosts.js). One implementation,
// shared with the runtime refresh.
// Exits non-zero (and writes nothing) if a threat list is missing from the cache.
const ROOT = new URL("..", import.meta.url);
const arg = (k, d) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : d; };
const cacheDir = arg("--cache", null);
const CACHE = cacheDir ? new URL(cacheDir.replace(/\\/g, "/").replace(/\/?$/, "/"), "file:///") : new URL("scripts/.list-cache/", ROOT);

await import(new URL("src/general/filter-options.js", ROOT).href);
await import(new URL("src/general/update.js", ROOT).href);
await import(new URL("src/threat/protected-hosts.js", ROOT).href);
await import(new URL("src/threat/compile.js", ROOT).href);
const U = globalThis.GeneralAdblockUpdate;
const TC = globalThis.GeckoThreatCompile;
const meta = JSON.parse(await Deno.readTextFile(new URL("src/rules/meta.json", ROOT)));

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const sources = {};
const hosts = [];
const popupHosts = [];
const seen = new Set();
for (const name of TC.THREAT_LISTS) {
  let text;
  try {
    text = await Deno.readTextFile(new URL(name + ".txt", CACHE));
  } catch (e) {
    console.error(`threat list ${name} missing from the cache (${e.message}); run scripts/pack-filter-lists.py first`);
    Deno.exit(2);
  }
  // The packer writes the cache with the platform's line endings; normalise
  // before comparing with the hash of the downloaded bytes in meta.json.
  const norm = text.replace(/\r\n/g, "\n");
  const packed = meta.sources && meta.sources[name] && meta.sources[name].sha256;
  const parsed = U.parseEntries(norm);
  const candidates = TC.threatHostsFromEntries(parsed);
  let added = 0;
  for (const h of candidates) if (!seen.has(h)) { seen.add(h); hosts.push(h); added++; }
  // $popup-only filters: main_frame-only threat rules (Block J).
  const popups = (parsed.popup || []).filter((h) => !seen.has(h));
  popupHosts.push(...popups);
  sources[name] = {
    sha256_matches_meta: packed ? (await sha256Hex(norm)) === packed : null,
    whole_domains: parsed.domains.length,
    scoped_entries: parsed.scoped.length,
    threat_hosts: candidates.length,
    popup_only_hosts: (parsed.popup || []).length,
    added,
  };
  if (!candidates.length) {
    console.error(`threat list ${name} produced no hosts; refusing to write a partial ruleset`);
    Deno.exit(3);
  }
}

const compiled = TC.compileThreatRules(hosts, { idBase: 1, popupHosts });
const reasons = {};
for (const r of compiled.rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
const out = {
  built_at_utc: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  lists_packed_at_utc: meta.packed_at_utc,
  priority: TC.THREAT_PRIORITY,
  resource_types: TC.THREAT_TYPES,
  hosts_per_rule: TC.HOSTS_PER_RULE,
  scopes_used: TC.THREAT_SCOPES,
  sources,
  hosts_total: compiled.accepted.length,
  popup_only_hosts_total: compiled.popupAccepted.length,
  rule_count: compiled.rules.length,
  rejected_total: compiled.rejected.length,
  rejected_by_reason: reasons,
  rejected: compiled.rejected.slice(0, 200),
};
await Deno.writeTextFile(new URL("src/rules/threat-network.json", ROOT), JSON.stringify(compiled.rules) + "\n");
// Offline fallback for the signed feed client (src/feed/client.js): the same
// hosts in feed-entry form. Used only when a feed is configured and its saved
// copy is missing or expired.
const snapshot = {
  format: 1,
  snapshot: true,
  createdAt: out.built_at_utc,
  dnr: compiled.rules.map((r, i) => (r.condition.resourceTypes.length === TC.THREAT_TYPES.length
    ? { id: i + 1, requestDomains: r.condition.requestDomains }
    : { id: i + 1, requestDomains: r.condition.requestDomains, resourceTypes: r.condition.resourceTypes })),
};
if (snapshot.dnr.length > 4500) {
  console.error("threat snapshot has more than 4500 entries");
  Deno.exit(4);
}
await Deno.writeTextFile(new URL("src/rules/threat-snapshot.json", ROOT), JSON.stringify(snapshot) + "\n");
await Deno.writeTextFile(new URL("src/rules/threat-meta.json", ROOT), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ hosts: out.hosts_total, rules: out.rule_count, rejected: out.rejected_total, sources }, null, 1));
