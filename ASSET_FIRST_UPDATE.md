# Asset-first update

- A magyar tárgyalóterem a meglévő `/assets/targyalotterem.jpg` raster artworköt használja.
- A korábbi, programozott SVG zászló/címer overlay ki lett kapcsolva és eltávolítva a runtime-ból.
- Hiányzó avatar×szerep kép esetén nincs SVG/CSS jelmezrajz: az eredeti avatar marad, csak egy kis HTML szerepjelvény jelenik meg.
- A role resolver továbbra is automatikusan felismeri az `assets/roles/avatar_NN_<role>.webp` fájlokat.
- Amint egy valódi role asset bekerül, automatikusan leváltja a fallback avatart.

## Várt role assetek
`judge`, `prosecutor`, `defendant`, `witness`, `juror` (plusz opcionális `defender`).

## Ellenőrzés
- `node test/avatar-roles.js`: 7/7 PASS
- `npm test`: 18/18 PASS
