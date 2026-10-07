# Kamu Bíróság — Claude graphics handoff

## Current state
- 50 base avatar raster assets are present.
- 250 role asset paths are now present under `assets/roles/`.
- IMPORTANT: these 250 role files are TEMPORARY PLACEHOLDERS and intentionally reuse the corresponding base avatar.
- The purpose is to let gameplay, role switching, layout, responsive behavior, animation and realtime integration be completed and tested now.
- They are NOT final role artwork.

## Mandatory asset policy
1. Do not create SVG people, SVG courtroom artwork, or SVG replacements for characters.
2. Existing raster courtroom and avatar artwork is the visual source of truth.
3. SVG is permitted only for small functional UI icons.
4. Use the role resolver and the files under `assets/roles/`.
5. When final role artwork arrives, it will overwrite these files without requiring gameplay changes.

## Naming contract
`avatar_01_judge.webp`
`avatar_01_prosecutor.webp`
`avatar_01_defendant.webp`
`avatar_01_witness.webp`
`avatar_01_juror.webp`
... through avatar_50.

## Your responsibility
Continue CODE integration: gameplay states, realtime role changes, CourtroomScene positioning, phase HUD, intro, evidence/challenge presentation, verdict, score feedback, reactions, responsive behavior, accessibility, audio hooks and tests.

Do not redesign or regenerate the artwork.
