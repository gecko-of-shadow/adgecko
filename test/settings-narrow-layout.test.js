// Settings page at narrow widths (360 px, Chrome for Testing 155): list rows
// hold prose ("Fixed – hidden ad boxes and page guards off") as well as long
// domain names. `word-break: break-all` split ordinary words ("box|es"); the
// rows must wrap at spaces and break a long name only where it would overflow.
import html from "../src/settings.html" with { type: "text" };
function assert(c, l) { if (!c) throw new Error(l); }
const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

Deno.test("settings list rows break long names without splitting words", () => {
  const li = style.match(/^\s*li\s*\{([^}]*)\}/m);
  assert(li, "li rule present");
  assert(!/word-break\s*:\s*break-all/.test(li[1]), "no break-all on list rows: " + li[1]);
  assert(/overflow-wrap\s*:\s*anywhere/.test(li[1]), "long names still break: " + li[1]);
});

// The Allow this domain box (placeholder "example.com or paste the address",
// 227 px in the page font) shrank to 124 px next to its button at 360 px and
// cut the placeholder off. A flex basis wide enough for the placeholder makes
// the button wrap below the box on narrow screens instead.
Deno.test("settings text box keeps room for its placeholder (flex basis, may wrap)", () => {
  const rule = style.match(/^\s*input\[type="text"\]\s*\{([^}]*)\}/m);
  assert(rule, "text input rule present");
  const flex = rule[1].match(/flex\s*:\s*1\s+1\s+(\d+(?:\.\d+)?)em/);
  assert(flex && Number(flex[1]) >= 17.5, "flex basis >= 17.5em (245 px at 14 px): " + rule[1]);
  assert(/min-width\s*:\s*0/.test(rule[1]), "still shrinks below the basis on very narrow screens");
  assert(/\.row\s*\{[^}]*flex-wrap\s*:\s*wrap/.test(style), "the row wraps");
});
