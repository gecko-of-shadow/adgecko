// Block 3 (owner decision #17): the code is GPLv3, the brand (name + gecko
// icon) is not covered; third-party notices stay.
import license from "../LICENSE" with { type: "text" };
import readme from "../README.md" with { type: "text" };
import manifest from "../manifest.json" with { type: "json" };
function assert(c, l) { if (!c) throw new Error(l); }

Deno.test("root LICENSE: copyright line, the unmodified GPLv3 text from gnu.org, third-party notices", async () => {
  const text = license.replace(/\r\n/g, "\n");
  assert(text.startsWith("Gecko Adblock (repository twitch-adblock)\nCopyright (C) 2026 gecko-of-shadow\n"), "copyright line");
  const gpl = text.slice(text.indexOf("                    GNU GENERAL PUBLIC LICENSE\n"));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(gpl))), (b) => b.toString(16).padStart(2, "0")).join("");
  // sha256 of https://www.gnu.org/licenses/gpl-3.0.txt (fetched 2026-11-03).
  assert(hash === "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986", "GPLv3 text changed: " + hash);
  for (const f of ["src/vendor/LICENSE-TwitchAdSolutions", "src/vendor/LICENSE-uBlock.md", "src/vendor/LICENSE-uBlock-GPLv3.txt", "src/LICENSE-EasyList.txt", "src/rules/CREDIT-EasyList.txt", "src/rules/LICENSES.md"]) {
    assert(text.includes(f), "notice names " + f);
    await Deno.stat(new URL("../" + f, import.meta.url));
  }
});

Deno.test("README: license and brand note; the product name in the manifest is unchanged", () => {
  const section = readme.slice(readme.indexOf("## License and brand"), readme.indexOf("## Links"));
  assert(/GNU General Public License version 3/.test(section) && /\[LICENSE\]\(LICENSE\)/.test(section), "licence");
  assert(/"Gecko Adblock" and the gecko icon are gecko-of-shadow's brand/.test(section) && /not covered by the code licence/.test(section), "brand note");
  assert(/one Curben list used \(curbengh's urlhaus-filter: URLhaus data, CC0\)/.test(section), "the one urlhaus-filter exception");
  assert(manifest.name === "twitch-adblock", "manifest name unchanged");
});
