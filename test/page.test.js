import source from "../src/vendor/video-swap-new.user.js" with { type: "text" };

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

Deno.test("Twitch MAIN script is unmodified TwitchAdSolutions video-swap-new userscript", () => {
  assert(source.includes("// @name         TwitchAdSolutions (video-swap-new)"), "userscript name");
  assert(source.includes("// @version      1.55"), "userscript version 1.55");
  assert(source.includes("ourTwitchAdSolutionsVersion = 23"), "upstream conflict version");
  assert(source.includes("hookWorkerFetch (video-swap-new)"), "worker fetch hook log");
  assert(!source.includes("function createPlaylistGuard"), "hand rewrite guard is gone");
  assert(!source.includes("failOpenShowAds"), "hand rewrite fail-open helper is gone");
});

Deno.test("backup player types match upstream OPT_BACKUP_PLAYER_TYPES order", () => {
  assert(
    source.includes("OPT_BACKUP_PLAYER_TYPES = [ 'autoplay', 'picture-by-picture', /*'autoplay-ALT',*/ 'embed' ]"),
    "try autoplay, then picture-by-picture, then embed",
  );
  assert(!source.includes("handoffGraceMs"), "no parallel grace-window rewrite");
  assert(!source.includes("backupMatchScore"), "no score-ranked backup rewrite");
  assert(!source.includes("findCleanBackups"), "no parallel clean-backup race");
});

Deno.test("onFoundAd accepts the last backup even when dirty, then fails open when exhausted", () => {
  assert(source.includes("i >= playerTypes.length - 1"), "last player type is accepted even with ad tags");
  assert(
    source.includes("if (streamInfo.BackupEncodingsStatus.size >= playerTypes.length)"),
    "exhausted backup map returns the real playlist text",
  );
  const start = source.indexOf("async function onFoundAd");
  const end = source.indexOf("function stripAdSegments", start);
  const block = source.slice(start, end);
  assert(block.includes("return textStr;"), "exhausted path returns the incoming playlist");
  assert(block.includes("BackupEncodingsStatus.set(playerType, 0)"), "dirty non-final types are marked tried");
  assert(block.includes("BackupEncodingsStatus.set(playerType, 1)"), "accepted backup type is latched");
});

Deno.test("processM3U8 uses AD_SIGNIFIER and reloads off backup when main is clean", () => {
  assert(source.includes("AD_SIGNIFIER = 'stitched-ad'"), "ad tag matches upstream");
  assert(source.includes("LIVE_SIGNIFIER = ',live'"), "live EXTINF signifier matches upstream");
  assert(source.includes("IsMovingOffBackupEncodings"), "moving-off guard matches upstream");
  assert(source.includes("No more ads on main stream. Triggering player reload"), "leave-backup reload log");
  assert(source.includes("postMessage({key:'UboReloadPlayer'})"), "worker asks the page to reload");
});

Deno.test("stripAdSegments blanks cached ad fetches instead of rewriting the live ladder away", () => {
  assert(source.includes("function stripAdSegments"), "upstream strip helper present");
  assert(source.includes("AdSegmentCache"), "ad segment cache present");
  assert(source.includes("data:video/mp4;base64,"), "blank mp4 response for cached ad segments");
});

Deno.test("access token force and backup gql match upstream", () => {
  assert(source.includes("OPT_FORCE_ACCESS_TOKEN_PLAYER_TYPE = 'popout'"), "forced player type is popout");
  assert(source.includes("ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"), "PlaybackAccessToken hash");
  assert(
    source.includes("platform: realPlayerType == 'autoplay' ? 'android' : 'web'"),
    "autoplay tokens use the android platform",
  );
  assert(source.includes("parent_domains"), "embed parent_domains stripping stays");
});

Deno.test("reloadTwitchPlayer matches upstream setSrc handoff", () => {
  const start = source.indexOf("function reloadTwitchPlayer");
  assert(start !== -1, "reloadTwitchPlayer exists");
  const end = source.indexOf("function onContentLoaded", start);
  const block = source.slice(start, end);
  assert(block.includes("setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true })"), "setSrc refreshes usher");
  assert(block.includes("player.play()"), "play after setSrc");
  assert(!block.includes("getHTMLVideoElement"), "no HTMLVideoElement play nudge");
  assert(!block.includes("claimReload"), "no hand-rewrite reload ceiling inside upstream reload");
});
