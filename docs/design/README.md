# Gecko Adblock artwork: how the art was chosen

This folder keeps the design pictures and the record of how the icon and the
popup look were picked. It is documentation only: `docs/` is not part of the
extension package (`scripts/lib/package_files.py` derives the package from
`manifest.json`, the worker's `importScripts` and the extension pages; the zip
holds only `manifest.json`, `src/` and `icons/`).

- Date of the decisions: 2026-11-02.
- Who decided: the project owner. Every pick below is the owner's.
- Anything that was not written down at the time is marked **not recorded**
  or **UNVERIFIED**. Nothing here is invented.

## Files

| File | What it is |
|---|---|
| `icon-E-gecko-snap.jpg` | **The picked icon (concept E).** Neon purple gecko head snapping an "ad" made of pixels. |
| `popup-1-picked.jpg` | **The picked popup style (popup 1).** Dark panel, purple accents, rounded cards, one wide purple button. |
| `popup-single.jpg` | The single-popup layout from the owner's change (normal and "Allowed" states). **This layout wins.** |
| `popup-high-contrast.jpg` | The default theme next to the high-contrast theme (white art, yellow button). |
| `popup-states.jpg` | The older four-card states mockup. **Superseded** by `popup-single.jpg`. |
| `DESIGN-RULES.md` | The owner's written design rules (copy of the project notes with the name and time zone taken out, plus an as-built note). The written rules win over the pictures. |
| `icon-E-compare.png` | The original concept E picture next to the hand-drawn SVG icon rendered at 128, 48 and 16 px (added with the redrawn icon). |
| `screenshots/` | The real popup and settings page in each state and theme, with its own README (added with the popup alignment). |
| `rejected/` | Every option the owner did not pick, kept as the decision trail. |

## The decision record

1. **Start.** The owner asked for new artwork for the extension ("all": icon,
   popup look, names): an abstract shield-style logo, gamer style, Twitch
   purple, and new product names.

2. **Round 1: three shield concepts** (all in `rejected/`):
   - **A** `icon-A-slashed-shield.jpg`: a neon-purple shield cut by a diagonal
     slash, on a dark rounded square.
   - **B** `icon-B-hex-shield-play-cutout.jpg`: a hexagon shield with a
     play-button cutout, purple and magenta halves.
   - **C** `icon-C-esports-lightning-shield.jpg`: an "esports" shield with a
     lightning bolt in purple and cyan, white outline.

   The owner liked **A** the most. Name ideas offered with them
   (StreamWard, Purple Aegis, Clutch Shield, HexGuard) are in the project
   decision notes. **The final product name is NOT decided** (the manifest
   still says `twitch-adblock`, the UI says "Gecko Adblock").

3. **Why shields were dropped.** The owner changed course: every ad blocker
   uses a shield, so a shield makes the extension look like all the rest. The
   owner wanted something with a character of its own, tied to the product name
   (Gecko).

4. **Round 2: four gecko-and-ad concepts.** Only the pick's letter (E) is
   recorded; the letters of the other three are **not recorded (UNVERIFIED)**,
   so they are named by content:
   - **E** `icon-E-gecko-snap.jpg` (**THE PICK**): a neon Twitch-purple gecko
     head in line art on a dark rounded square, tongue flicking out and
     snapping a glitchy "ad" made of pixels.
   - "Play-button slash" `rejected/icon-r2-sliced-play-triangle.jpg`: a purple
     block shape and a magenta play triangle sliced by a bright diagonal laser
     line, with pixel debris.
   - "Low-poly gecko" `rejected/icon-r2-lowpoly-gecko.jpg`: a geometric
     full-body gecko seen from above, star-shaped feet, curled tail.
   - "Reptile eye" `rejected/icon-r2-reptile-eye.jpg`: a reptile eye with a
     purple iris, slit pupil, scaly lids and glitch scan-lines.

5. **The owner picked E.** The owner's reason is **not recorded verbatim**. The
   reasons below are **INFERRED** from the pictures and the owner's stated rules
   (not the owner's words):
   - it is the only one that shows the product doing its job (a gecko
     snapping an ad);
   - it has no shield;
   - it keeps the purple gamer look the owner asked for;
   - it is a one-colour line drawing that can be redrawn cleanly as a vector.

   And, also inferred, why the others fit less well: the play-slice reads like
   a video-player icon; the low-poly gecko has too many tiny parts for 16 px;
   the eye is a dark textured picture that would not shrink well.

6. **Popup.** Four popup looks were drawn:
   - "Ring with ON button" `rejected/popup-alt-ring-ON-button.jpg`: the gecko
     in a big purple ring, a large "ON", feature chips, "Allow this page".
   - "Status banner with icon toggles" `rejected/popup-alt-status-banner-toggles.jpg`:
     a green "Protected on twitch.tv" banner and a toggle row per feature.
   - "Retro terminal" `rejected/popup-alt-terminal-style.jpg`: pixel font,
     green terminal text, magenta outlined buttons.
   - **popup 1** `popup-1-picked.jpg` (**THE PICK**): header with the gecko,
     name and version, a big purple counter card, toggles, one wide purple
     button, a small "Update lists".

   Which popup number each rejected one had is **UNVERIFIED**. The owner picked
   popup 1 for its simple, clean, dark purple layout.

7. **Rules the owner gave after picking** (all in `DESIGN-RULES.md`):
   - simple and clean, only what is needed;
   - no animations, no gecko mood icons, no tour;
   - zero setup; one small "You're protected" card on first open;
   - folded by default;
   - "Something broke?" -> one tap turns off the extra filters for that site
     only, then asks "Did that fix it?";
   - Twitch / YouTube / Kick stream-safe is baked in (a core rule, not a
     setting);
   - quiet alerts only: a small magenta dot on the icon;
   - advanced options behind a small gear;
   - two themes: the owner's purple and one high-contrast theme (on
     automatically with Windows high contrast / forced colours, plus a manual
     switch).

8. **The owner's change.** Only the "Something broke? / Fix this
   site" card is useful, plus an Allow button. New single-popup layout
   (`popup-single.jpg`, `popup-high-contrast.jpg`); `popup-states.jpg` is the
   older four-card version and is superseded. The words "streams untouched"
   were confusing and were dropped: the status is just "✅ Protected" or
   "Allowed – not blocking here". The mockups still show "streams untouched"
   and the "ads snapped today" counter: **the written rules win**. The counter
   would need the `declarativeNetRequestFeedback` permission, which this
   project does not use, so it is **out of scope and must not be built**.

9. **Status.**
   - The popup was rebuilt to these rules in commit `8e9567d` (2026-11-03).
   - The icon art was not done then: `icons/` had not changed since `08b94c0`
     ("New gecko icon", 2026-10-28), a green gecko with an amber eye, and the
     build notes listed the final concept E art as SVG (normal/working/off + a
     16 px pixel-grid cut) as waiting on the owner (reworded here to leave the
     name out). The owner then required that all artwork be in before the next
     push.
   - The 2026-11-03 build (art + filter fixes) redraws the icon as concept E
     (see "The icon as built" below) and aligns the popup with the mockups.

## The icon as built (2026-11-03)

The JPEG is a lossy 1024 px picture with a baked-in background and glow, so it
is not used directly. The icon is a hand-written, path-based SVG recreation:
`icons/source/gecko.svg` (rendered at 48 and 128 px) and
`icons/source/gecko-16.svg` (a simpler cut drawn on the 16 px grid). No
embedded picture, no tracing.

What it keeps from the picture: the dark rounded-square tile, the gecko head in
profile facing left, the spiky crest on the back of the head, the angled eye
with a slit pupil, the nostril, the mouth and lower-jaw lines, the neck lines
with their small spikes, the long wavy tongue flicking out to the right, and
the cluster of pixel squares at its tip (the "ad" being snapped).

States (the `data-state` attribute the build script sets on the SVG root):

| State | Used when | Look |
|---|---|---|
| `normal` | the extension's own icon (`manifest.json` `icons`: extensions page, store) | full purple art; the pixel "ad" in the same purple |
| `working` | the toolbar icon and the popup header while ordinary-site blocking is on | same art, the pixel "ad" lit up (white / pale lilac squares) |
| `off` | the toolbar icon and the popup header while ordinary-site blocking is off | grey art, dimmer tongue, unlit pixels |

The working icon is the one people see most (the toolbar default), so the lit
"ad" says "it is snapping ads right now"; grey says "not blocking".

Glow: the picture's soft glow muddies tiny sizes and blurs on white toolbars,
so the 48 / 128 px art has at most a subtle glow and the 16 px cut has none.

How close it is (see `icon-E-compare.png`): at 128 px the silhouette, crest,
eye, mouth, neck and tongue sit on the picture's own lines (checked by laying
the SVG outline over the JPEG). Simplified on purpose:
- lines are about 25 % thicker than in the picture and mostly even in width
  (the picture's brush strokes taper), so 48 px is not hairline;
- the dark shading under the brow and around the eye is left out; the iris is
  one flat purple;
- the pixel "ad" is about 1.6 times larger than in the picture so the lit
  squares still show at 48 px;
- the 16 px cut keeps only the outline with three crest spikes, a two-pixel
  eye, the mouth and jaw lines, two neck strokes, the tongue and four "ad"
  pixels.

Rebuild the PNGs with `node scripts/build-icons.mjs` (set `CHROME_PATH` to a
local Chrome / Chrome for Testing, or install Playwright).
