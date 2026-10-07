# KAMU BÍRÓSÁG — GRAPHICS / CLAUDE HANDOFF

## Source of truth
The repository code is the functional source of truth. The visual target is `assets/KAMU_UI_TARGET_REFERENCE.png`. `assets/KAMU_ASSET_STYLE_REFERENCE.png` is a secondary style sheet.

## Non-negotiable asset policy
- Courtroom, characters, avatars and main artwork are raster assets (PNG/WebP/JPG), never recreated as SVG/CSS figures.
- SVG is allowed only for small conventional UI icons.
- Missing role art falls back to the base avatar. Never synthesize an SVG person.
- Existing legacy character SVG files may remain for backwards compatibility but must not be referenced by the new runtime.

## Role asset contract
Place final role art in `assets/roles/`:
- `avatar_01_judge.webp`
- `avatar_01_prosecutor.webp`
- `avatar_01_defendant.webp`
- `avatar_01_witness.webp`
- `avatar_01_juror.webp`
... through avatar 50.

The face/identity of each base avatar must remain recognizably the same. Transparent background, consistent crop and lighting. The resolver and API already discover valid files automatically.

## Already prepared presentation layers
- cinematic camera/focus
- ambient light and dust
- phase HUD
- trial intro
- evidence folder
- challenge card
- guilty/acquitted verdict stamp
- reduced-motion fallbacks

## Claude/Codex responsibility after handoff
Integrate game state and polish layout/realtime behavior. Do not redraw artwork. Preserve server-authoritative state and existing auth/guest/room/scoring systems.
