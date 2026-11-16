import sys,pathlib
root=pathlib.Path(".")
covered=set(["src/vendor/video-swap-new.user.js","src/youtube.js","src/vendor/ubo-youtube.js","src/vendor/ubo-youtube-isolated.js","src/kick.js","src/guards/clipboard.js","src/guards/popups.js","src/general/update.js","src/general/filter-options.js",
"src/popup.js","src/general-settings.js","src/general-background.js","src/cosmetic.js","src/settings.js","src/settings/features.js","src/settings/flags.js","src/twitch-directory-ads.js","src/general/cosmetic-parse.js"])
covered|={str(p.relative_to(root)) for d in ("src/threat","src/feed") for p in (root/d).glob("*.js")}
for f in open(sys.argv[1]).read().split():
    if f not in covered: print("NOT SCOPED:", f)
