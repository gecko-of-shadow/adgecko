// Chrome writes `_metadata/` (indexed rule sets) into the folder of an
// unpacked extension. Loading the repository root must not leave a new folder
// in `git status`.
function assert(c, l) { if (!c) throw new Error(l); }

Deno.test("git ignores the _metadata folder that Chrome writes into the unpacked extension", async () => {
  const out = await new Deno.Command("git", {
    args: ["check-ignore", "--no-index", "-q", "_metadata/generated_indexed_rulesets/_ruleset1"],
    cwd: new URL("..", import.meta.url),
  }).output();
  assert(out.code === 0, "git check-ignore exit code " + out.code + " (0 = ignored)");
});

Deno.test("git ignores packed .crx files", async () => {
  const out = await new Deno.Command("git", {
    args: ["check-ignore", "--no-index", "-q", "adgecko.crx"],
    cwd: new URL("..", import.meta.url),
  }).output();
  assert(out.code === 0, "git check-ignore exit code " + out.code + " (0 = ignored)");
});
