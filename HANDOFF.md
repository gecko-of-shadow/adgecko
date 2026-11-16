# Handoff

Last updated: 2026-11-16.

## State

- Branch `claude/festive-dirac-a043po` starts at `main` (aa5f5af, version 0.3.5).
- A general code review was done on 2026-11-16 (11 review lenses, each finding checked by an adversarial verifier).
  - 64 findings are confirmed: 3 high, 17 medium, 44 low.
  - 15 findings are rejected.
- The correction plan is in `docs/review-2026-11-16/PLAN.md` (25 work packages, WP-01 to WP-25).
- All finding data is in `docs/review-2026-11-16/findings.json`.
- Reproduction scripts from the review are in `docs/review-2026-11-16/repros/`.

## Next step

- A new session does the plan. It examines why each current choice was made, then does, changes or discards each work package. It stops when version 0.3.6 is ready to push.
- That session must update this file after each work package.

## Facts

- Checked in the review session: `deno test` on 0.3.5 gave 776 passed, 0 failed, 9 ignored (Deno 2.9.6, Linux container). The privacy check passed on the review files.
- Not checked: no finding was tested on Bran's PC or on live sites. All findings are UNVERIFIED until a run on Bran's PC proves them.

## Owner decisions open

- See section 3 of `docs/review-2026-11-16/PLAN.md`.

## Deletion candidates (Bran must approve; nothing was deleted)

- See section 3 of `docs/review-2026-11-16/PLAN.md`.
