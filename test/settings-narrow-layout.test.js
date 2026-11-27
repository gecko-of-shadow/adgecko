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
