import source from "../src/vendor/video-swap-new.user.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

Deno.test("backup probes are sequential in OPT_BACKUP_PLAYER_TYPES order", () => {
  const start = source.indexOf("async function onFoundAd");
  const end = source.indexOf("function stripAdSegments", start);
  const block = source.slice(start, end);
  assert(block.includes("for (let i = 0; i < playerTypes.length; i++)"), "sequential for-loop over player types");
  assert(block.includes("const playerType = playerTypes[i];"), "uses index order, not a race");
  assert(block.includes("if (streamInfo.BackupEncodingsStatus.get(playerType) === 1)"), "stops after the first accepted type");
  assert(block.includes("break;"), "breaks out once a backup latches");
});

Deno.test("a dirty non-final backup is skipped; the final type is used anyway", () => {
  const start = source.indexOf("async function onFoundAd");
  const end = source.indexOf("function stripAdSegments", start);
  const block = source.slice(start, end);
  assert(
    block.includes("(!backTextStr.includes(AD_SIGNIFIER)") && block.includes("|| i >= playerTypes.length - 1)"),
    "clean OR last-index accepts the backup media body",
  );
  assert(block.includes("streamInfo.BackupEncodingsStatus.set(playerType, 0)"), "failed earlier types stay in the map as 0");
});

Deno.test("when every backup type has been tried, the real midroll playlist is returned", () => {
  const start = source.indexOf("async function onFoundAd");
  const end = source.indexOf("function stripAdSegments", start);
  const block = source.slice(start, end);
  const early = block.indexOf("BackupEncodingsStatus.size >= playerTypes.length");
  const ret = block.indexOf("return textStr;", early);
  assert(early !== -1 && ret !== -1 && ret - early < 120, "exhausted status returns textStr immediately");
});

Deno.test("already-latched BackupEncodings keeps serving the backup ladder", () => {
  const start = source.indexOf("async function onFoundAd");
  const end = source.indexOf("function stripAdSegments", start);
  const block = source.slice(start, end);
  assert(block.includes("streamInfo.BackupEncodings && !streamInfo.BackupEncodings.includes(url)"), "reuses latched encodings");
  assert(block.includes("getStreamUrlForResolution(streamInfo.BackupEncodings, resolutionInfo)"), "resolution mapped onto backup");
});

Deno.test("master encodings merge keeps the main UI resolution list on a low-res backup", () => {
  assert(source.includes("The stream doesn't load unless each url line is unique"), "unique URL lines for merged encodings");
  assert(source.includes("mapVariantsToBackup") === false, "hand-rewrite mapper is not used");
  assert(source.includes("lowResUrl + ' '.repeat(j + 1)"), "upstream unique-suffix merge");
});
