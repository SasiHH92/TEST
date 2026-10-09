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

Az alapkészlet 50 × 5 fájl. **Igazi szerep-kép** (az OpenArt grafikákból, `scripts/build-role-assets.js`): a `ROLE_ASSET_MANIFEST.json` `real` listájában szereplők (jelenleg 72 kép, 15 avatár) –
a többi fájl még placeholder (az eredeti avatár képe), azt a szerver NEM hirdeti szerep-képnek (tartalék: portré + jelvény). Formátum: átlátszó WebP, **720 × 960 (3:4)** vászon, derékig látszó (mellszobor) karakter,
az arc mindenhol ugyanakkora és ugyanott (az áll a magasság 42%-án), az alsó szél puhán elhalványul. Részletek, a forrás-azonosítás és a kézi finomhangolás: [docs/ROLE-ASSETS.md](../../docs/ROLE-ASSETS.md).
Új / cserélt kép: `SOURCE_MAP.json` bejegyzés + `node scripts/build-role-assets.js <mappa>` (a manifest verziója frissül, a böngésző-gyorsítótár ürül).

## Hogyan kerül be a játékba?

1. Tedd a fájlt ebbe a mappába a fenti névvel. Kód nem kell hozzá: a szerver a mappa tartalmából (`GET /api/role-sprites`, 60 mp-es
   gyorsítótár) megmondja a kliensnek, melyik kép van meg, és a kliens azonnal azt használja.
2. Ahol az adott avatár × szerep képe még hiányzik, **tartalék** működik: a meglévő portré marad, a szerepnek megfelelő jelmez-sáv
   (talár + jabot, piros öltöny, narancs rabruha számtáblával, kék öltöny, zöld mellény, lila esküdt-szalag) kerül a portré aljára.
   Ez a hiányzó képek miatt sosem tesz tönkre semmit, a vegyes állapot (néhány avatárnak van szerep-képe, másoknak nincs) is jó.
3. Ellenőrzés: a böngésző konzolján `kbAvatarRoles.coverage()` megadja, hány kép van meg és melyek hiányoznak.
4. A képeket a szerver 7 napig gyorsítótárazhatja a böngészőben; kicserélt képnél érdemes új fájlnevet használni (vagy megvárni a lejáratot).

A teszteléshez a `KB_ROLE_SPRITES_DIR` környezeti változóval másik mappa is megadható.
