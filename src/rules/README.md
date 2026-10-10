# General adblock list / DNR artifacts (MV3)

| File | Purpose |
|------|---------|
| `general-network.json` | Merged static DNR rules: stream exclusions + list-pack blocks |
| `LICENSES.md` | EasyList / Peter Lowe / urlhaus-filter credits |
| `CREDIT-EasyList.txt` | Short EasyList credit for the zip |
| `meta.json` | List-pack hashes + manifest hint (`ruleset id: general`) |
| `dnr-merge-meta.json` | Exclusion merge stamp from `scripts/merge-dnr-rules.py` |
| `cosmetic-sample.json` | Sample cosmetics for the cosmetic agent (not shipped in zip by default) |

Rebuild blocks: `python scripts/pack-filter-lists.py` then merge:
`python scripts/merge-dnr-rules.py scripts/.dnr-cache/general-network.blocks.json`

Do not edit Twitch / YouTube / Kick playback files when wiring these.
