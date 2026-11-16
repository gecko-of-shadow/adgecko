// Nested :is()/:where() must not make the cosmetic parser take exponential
// time. A list line runs through parseCosmetic in the service worker before
// the list-change guard can reject the list, so a slow parse blocks the worker.
import cosSource from "../src/general/cosmetic-parse.js" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const CP = new Function("self", `${cosSource}\nreturn self.GeneralCosmeticParse;`)({});

const chain = (pseudo, depth, inner) => `:${pseudo}(`.repeat(depth) + inner + ")".repeat(depth);

Deno.test("cosmetic nesting: the unscoped check is not exponential in the :is() depth", () => {
  for (const pseudo of ["is", "where"]) {
    const sel = chain(pseudo, 22, ".a");
    const t = performance.now();
    const unscoped = CP.isUnscopedSelector(sel);
    const ms = performance.now() - t;
    assert(unscoped === false, `${pseudo} chain with a class must count as scoped`);
    assert(ms < 250, `isUnscopedSelector on a depth-22 :${pseudo}() chain took ${Math.round(ms)} ms`);
  }
  assert(CP.isUnscopedSelector(chain("is", 22, "html")) === true, "a deep :is(html) chain is still unscoped");
});

Deno.test("cosmetic nesting: a 118-level :is() line parses fast and is not kept", () => {
  const sel = chain("is", 118, ".a");
  assert(sel.length <= CP.MAX_SELECTOR_LEN, "the test selector must fit the length limit");
  const t = performance.now();
  const parsed = CP.parseCosmetic("##" + sel + "\n##.ok");
  const ms = performance.now() - t;
  assert(ms < 100, `parseCosmetic took ${Math.round(ms)} ms`);
  assert(!parsed.generic.includes(sel), "a 118-level selector must be rejected");
  assert(parsed.generic.includes(".ok"), "the other rules of the list stay");
});

Deno.test("cosmetic nesting: the sanitizer rejects deep nesting and keeps normal depth", () => {
  assert(CP.sanitizeSelector(chain("is", 30, ".a")) === "", "a depth-30 selector must be rejected");
  assert(CP.sanitizeSelector(chain("is", 9, ".a")) === "", "a depth-9 selector must be rejected");
  const ok8 = chain("is", 8, ".a");
  assert(CP.sanitizeSelector(ok8) === ok8, "a depth-8 selector is kept");
  const real = "div:has(> a[href^=\"https://ads.\"]):not(:has(.x))";
  assert(CP.sanitizeSelector(real) === real, "real EasyList forms (depth 2) are kept");
  // Parentheses inside quotes do not count as nesting.
  const quoted = `a[title="${"(".repeat(20)}"]`;
  assert(CP.sanitizeSelector(quoted) === quoted, "parentheses in quotes are not nesting");
});
