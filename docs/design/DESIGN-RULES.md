# Gecko Adblock design rules (the owner, 2026-11-02) - for AFTER the current build
- Icon: concept E, neon Twitch-purple gecko head snapping its tongue at a glitchy ad pixel (icon-E-gecko-snap.jpg). No shields.
- Popup: popup-1 style (popup-1-picked.jpg). "ads snapped today" counter needs real counting code; permission need UNVERIFIED.
- Simple and clean: show only what's needed. No animations, no mood icons, no tour.
- Zero setup: works on install; one small "you're protected" card on first open.
- Folded by default: gecko + site name + one status line + one big button (Allow this site / Block again). "Show more" unfolds.
- "Something broke?" -> one tap turns off extra filters for that site only, then asks "Did that fix it?".
- Twitch/YouTube/Kick stream-safe is baked in (core rule, not a setting): always play uninterrupted, fast, no ads.
- Quiet alerts: no pop-ups; threat blocks show only as a small magenta dot on the icon.
- Advanced toggles and per-site list hidden behind a small gear (options page, loads only when opened).
- Themes: the owner's purple + one high-contrast accessibility theme (auto on with Windows high contrast / forced-colors, plus manual switch).
- States mockup: popup-states.jpg; high contrast: popup-high-contrast.jpg.

## Update 2026-11-02 (the owner)
The owner: only the "Something broke? / Fix this site" card is useful, plus an Allow button.
New single popup layout (replaces the 4 state cards):
- header: icon + name + gear
- site name
- one-line status (small text, not a card)
- "Something broke?" card with **Fix this site** button (after tap: "Did that fix it? Yes / No")
- **Allow this site** button (toggles to "Block again" when allowed)
- Show more fold stays (default folded)
- Status line copy (the owner): "streams untouched" was confusing, dropped. Use just "✅ Protected" / "Allowed – not blocking here". No jargon in status text.
