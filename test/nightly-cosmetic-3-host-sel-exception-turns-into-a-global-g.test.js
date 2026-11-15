import "../src/settings/features.js";
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };

const P = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

Deno.test("'~a.com#@#sel' never removes the hide on the excluded host a.com", () => {
  const parsed = P.parseCosmetic("~a.com#@#.ad\n##.ad");
  const stored = P.toStorage(parsed, {});
  const css = P.buildPageCss("a.com", stored, "");
  // An exception that excludes a.com must leave a.com's ".ad" hide in place.
  assert(css.includes(".ad{display:none!important}"),
    `a.com lost its .ad hide; parsed=${JSON.stringify({ generic: parsed.generic, sites: parsed.sites, exceptions: parsed.exceptions })} css=${JSON.stringify(css)}`);
});
