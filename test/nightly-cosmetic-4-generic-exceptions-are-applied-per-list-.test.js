import "../src/settings/features.js";
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };

const P = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// update.js parses EasyList and EasyPrivacy separately and merges them with
// mergeCosmetic (writeCosmetic then merges the bundled extras the same way).
Deno.test("a generic '#@#sel' in one list cancels '##sel' from another list after merge", () => {
  const easylist = P.parseCosmetic("##.ad-safe\n##.ad-other");
  const easyprivacy = P.parseCosmetic("#@#.ad-safe");
  const merged = P.mergeCosmetic([easylist, easyprivacy]);
  const css = P.buildPageCss("example.com", P.toStorage(merged, {}), "");
  assert(css.includes(".ad-other{display:none!important}"), "control selector missing: " + JSON.stringify(css));
  assert(!merged.generic.includes(".ad-safe"),
    `generic exception lost at merge: merged.generic=${JSON.stringify(merged.generic)}`);
  assert(!css.includes(".ad-safe{"), "page css still hides .ad-safe: " + JSON.stringify(css));
});

