# Szerep-specifikus avatár-képek

Az avatár azonosítója (`av01` … `av50`) **nem változik**: ugyanaz a karakter jelenik meg a teremben a szerepének megfelelő változatban.
A kép nevét az avatár sorszáma és a szerep adja:

| Szerep | Fájlnév (az 17-es avatárra) | Megjelenés |
| --- | --- | --- |
| bíró | `avatar_17_judge.webp` | fekete talár, fehér bírói paróka, középen az emelvényen |
| ügyész | `avatar_17_prosecutor.webp` | piros elegáns öltöny, határozott testtartás, bal oldalon |
| vádlott | `avatar_17_defendant.webp` | narancssárga rabruha, szükség esetén bilincs, jobb oldalon |
| tanú | `avatar_17_witness.webp` | zöld / semleges ruha, esküre emelt kéz, a tanúpadnál |
| esküdt | `avatar_17_juror.webp` | lila ruházat, ESKÜDT jelvény, az esküdtszékben |
| védőügyvéd (opcionális) | `avatar_17_defender.webp` | kék öltöny |

Az alapkészlet 50 × 5 kép. Formátum: WebP, átlátszó háttér, teljes alak, a talp a kép alján, kb. 600 × 900 px ajánlott
(a megjelenítés `object-fit: contain`, a fix szerepfigurákhoz hasonlóan).

## Hogyan kerül be a játékba?

1. Tedd a fájlt ebbe a mappába a fenti névvel. Kód nem kell hozzá: a szerver a mappa tartalmából (`GET /api/role-sprites`, 60 mp-es
   gyorsítótár) megmondja a kliensnek, melyik kép van meg, és a kliens azonnal azt használja.
2. Ahol az adott avatár × szerep képe még hiányzik, **tartalék** működik: a meglévő portré marad, a szerepnek megfelelő jelmez-sáv
   (talár + jabot, piros öltöny, narancs rabruha számtáblával, kék öltöny, zöld mellény, lila esküdt-szalag) kerül a portré aljára.
   Ez a hiányzó képek miatt sosem tesz tönkre semmit, a vegyes állapot (néhány avatárnak van szerep-képe, másoknak nincs) is jó.
3. Ellenőrzés: a böngésző konzolján `kbAvatarRoles.coverage()` megadja, hány kép van meg és melyek hiányoznak.
4. A képeket a szerver 7 napig gyorsítótárazhatja a böngészőben; kicserélt képnél érdemes új fájlnevet használni (vagy megvárni a lejáratot).

A teszteléshez a `KB_ROLE_SPRITES_DIR` környezeti változóval másik mappa is megadható.
