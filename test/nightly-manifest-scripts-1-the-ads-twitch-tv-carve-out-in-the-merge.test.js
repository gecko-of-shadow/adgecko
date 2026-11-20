// merge-dnr-rules.py carves ads.twitch.tv out of the Twitch allow (rule 2) so the
// lists can block Twitch's ad host. The packer drops every *.twitch.tv list line
// (never-block suffix), so the merger's extra tracker rule must block it, or the
// carve-out does nothing.
import { assert } from "jsr:@std/assert@1";
import rules from "../src/rules/general-network.json" with { type: "json" };
import { evaluate } from "./fixtures/dnr-matcher.js";

const REQ = { url: "https://edge.ads.twitch.tv/ads?x=1", type: "xmlhttprequest", frames: ["www.twitch.tv"] };

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

Deno.test("the Twitch allow carves out ads.twitch.tv (precondition)", () => {
  const allow = rules.find((r) => r.action.type === "allow" && (r.condition.requestDomains || []).includes("twitch.tv"));
  assert(allow && (allow.condition.excludedRequestDomains || []).includes("ads.twitch.tv"));
});

// Merger level: the rules the merger builds (stream allows + extra tracker
// rule) block edge.ads.twitch.tv from a Twitch page and still allow the
// other Twitch hosts. Imports the merger as a module; it writes nothing.
// Owner decision 2026-11-20: block ads.twitch.tv (EXTRA_TRACKER_DOMAINS in
// merge-dnr-rules.py). UNVERIFIED in Chrome: the Twitch player with this host
// blocked.
Deno.test({ name: "merger: the extra tracker rule blocks the carved-out ad host edge.ads.twitch.tv", fn: async () => {
  const script = [
    "import importlib.util, json",
    "from pathlib import Path",
    "spec = importlib.util.spec_from_file_location('mdr', Path('scripts/merge-dnr-rules.py'))",
    "m = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(m)",
    "extra = {'id': 99999, 'priority': m.BLOCK_PRIORITY, 'action': {'type': 'block'}, 'condition': {'requestDomains': list(m.EXTRA_TRACKER_DOMAINS)}}",
    "print(json.dumps(m.build_exclusion_rules() + m.build_youtube_ad_block_rules() + [extra]))",
  ].join("\n");
  const merged = JSON.parse(await runPython(script));
  const res = evaluate(merged, REQ);
  assert(res.action === "block", "edge.ads.twitch.tv from twitch.tv is " + res.action);
  for (const url of ["https://gql.twitch.tv/gql", "https://www.twitch.tv/x", "https://usher.ttvnw.net/x.m3u8"]) {
    const ok = evaluate(merged, { url, type: "xmlhttprequest", frames: ["www.twitch.tv"] });
    assert(ok.action !== "block", url + " must stay allowed: " + ok.action);
  }
} });

// Shipped file: the merger regenerated src/rules/general-network.json with
// ads.twitch.tv in the extra tracker rule.
Deno.test({
  name: "a shipped rule blocks the carved-out ad host edge.ads.twitch.tv",
  fn() {
    const res = evaluate(rules, REQ);
    assert(res.action === "block", "edge.ads.twitch.tv from twitch.tv is " + res.action + " (no block reached general-network.json)");
  },
});
