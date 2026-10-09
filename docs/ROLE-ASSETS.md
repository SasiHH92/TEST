# Szerep-karakter képek (OpenArt → assets/roles → courtroom)

A játék a választott **avatár + a mostani szerep** alapján mutatja a karaktert a courtroomban (bíró, ügyész, vádlott, tanú, esküdt). A képek az
OpenArtból exportált, jóváhagyott 3D grafikák (raszter, **nem** SVG / CSS-rajz); a feldolgozásuk reprodukálható szkripttel történik.

## Állapot (az első integrációkor)

* A ZIP **73 képet** tartalmazott (1792 × 2400 PNG, `#00FF00` háttér), **15 karakter** × 5 szerep (a 20-as és a 25-ös karakternél egy-egy hiányzó esküdt).
* **72 szerep-kép** integrálva, **15 avatárhoz** (a `ROLE_ASSET_MANIFEST.json` `real` listája): `av01 av02 av03 av04 av05 av06 av07 av09 av10 av11 av20 av21 av22 av25 av29`.
* A többi **35 avatár × 5 szerep + 3 hiányzó kép** még a régi placeholder (az eredeti avatár képe): ezek NEM szerep-képek, a szerver nem hirdeti őket, a játék az
  eredeti avatár portréját + HTML szerep-jelvényt mutatja (soha nem törött kép). Amint új kép készül, a `SOURCE_MAP.json`-ba kerül, és a szkript újraépíti.
* A védőügyvédnek nincs saját képe (a ZIP nem tartalmaz védő-szerepet): az avatár portréja áll a helyén, ahogy eddig.

## Feldolgozás: `scripts/build-role-assets.js`

```
npm install --no-save sharp                         # csak az asset-feldolgozáshoz kell, a játékhoz nem
node scripts/build-role-assets.js <kicsomagolt-zip-mappa>   # → assets/roles/avatar_NN_<szerep>.webp + BUILD_REPORT.json + manifest
node scripts/build-role-assets.js <mappa> --out <ideiglenes mappa> --only av03,av04    # próba (a manifestet nem írja)
```

Lépések (képenként):

1. **Zöld háttér eltávolítása** (`scripts/lib/chroma-key.js`): a kép szélével összefüggő háttér + a zárt zöld zsebek (hajtincsek közt, kar és törzs közt) → valódi alfa;
   puha él (4 px), zöld-szivárgás csökkentés az éleken, a vékony, zöldbe oldódó hajszál-maradványok eltűnnek. **Nem** „minden zöld pixel nullázása”: a zöld ruha
   (tanú zakója) a kép szélétől független régió, ezért megmarad (a teszt a törzs tömörségét ellenőrzi).
2. **Fejméret-normalizálás**: az arc (bőr-folt) szélessége minden képen a vászon `FACE_W_TARGET` (30%) része, az áll a vászon 42%-án, az arc vízszintesen középen. Így a bíró,
   az ügyész stb. ugyanabból a karakterből ugyanakkora fejjel jön, és a teremben nincs „szerepenként más méretű” ugrálás. A szakállas / sapkás / napszemüveges arcoknál a
   bőr-folt keskenyebb a valódi fejnél: ott a `SOURCE_MAP.json` `headScale` szorzója finomít (kézzel, vizuális felvonulás alapján).
3. **Vászon**: 720 × 960 (3:4), átlátszó WebP (`quality 82`, `alphaQuality 92`), az alsó szél puhán elhalványul (derékig látszó „mellszobor”), a fej teteje legalább 10 px-re a vászon tetejétől.
4. **Manifest**: `ROLE_ASSET_MANIFEST.json` `real` (melyik kép igazi) + `version` (a képek tartalmából; ez kerül a `?v=` paraméterbe, így a 7 napos gyorsítótár nem ragad be).

### Forrás-azonosítás (`assets/roles/SOURCE_MAP.json`)

A ZIP nem tartalmazott metaadatot, ezért az azonosítás **kézi, vizuális** volt (a szerep a ruházat / kellék szerint: fekete talár + paróka + kalapács = bíró, bordó öltöny + mutató kéz = ügyész, narancs rabruha + bilincs =
vádlott, zöld ruha + esküre emelt kéz = tanú, lila ruha + JUROR jelvény = esküdt; az avatár a haj / arc / kiegészítők szerint, az 50 alap avatárral összevetve). Karakterenként `confidence`:

| karakter | avatár | bizonyosság | megjegyzés |
| --- | --- | --- | --- |
| A | av01 | közepes | barna, hátrafésült hajú fiatal férfi |
| B | av02 | **alacsony** | hosszú hullámos szőke, kék szemű nő – az av02 / av14 / av28 / av42 / av48 is hasonló, a sorszám ellenőrzendő |
| C | av03 | magas | sötét hajú férfi, az esküdt-képen a fekete sapka |
| D | av04 | magas | barna kontyos nő |
| E | av05 | magas | szakállas, napszemüveges férfi aranylánccal |
| F | av06 | magas | sötétbarna hajú férfi |
| G | av07 | magas | szőke nő napszemüveggel a fején |
| H | av25 | magas | szakállas, sárga sapkás férfi (az esküdt-kép hiányzik: a háttérben emberek állnak, a kulcs nem szedheti le őket – **kihagyva**) |
| I | av22 | magas | szőke kontyos nő |
| J | av21 | magas | szakállas, napszemüveges, fekete DR-sapkás férfi |
| K | av20 | magas | ősz, bajszos, szemüveges férfi (esküdt-kép nincs) |
| L | av11 | magas | szakállas férfi fekete, arany logós sapkával |
| M | av10 | közepes | szemüveges, barna hajú férfi (az av31-gyel keverhető) |
| N | av09 | **alacsony** | hosszú hullámos barna hajú nő arany karikával – az av09 / av19 / av44 / av50 is hasonló |
| O | av29 | **alacsony** | szakállas, barna hajú, kerek arcú férfi (a tanú-képen kerek szemüveg: gyanús, hogy nem ugyanaz a karakter) |

**Gyanús / hiányzó:** `av25 juror` (kihagyva), `av20 juror` (nincs kép), az O karakter tanú-képe (szemüveg), az „alacsony” bizonyosságú B, N, O karakterek **avatár-sorszáma**.
Ha a sorszám téves, elég a `SOURCE_MAP.json` `avatar` mezőjét átírni és újraépíteni – a képek nevei ebből készülnek.

## Futásidő

* `public/avatar-roles.js` – `getRoleAvatar(avatarId, role)` → `{kind: 'sprite' | 'portrait' | 'generic', src}`: szerep-kép, ennek hiányában az eredeti avatár (`/assets/avatars/…`), soha nem törött kép.
  `spriteFor` a `?v=` verzióval; `markMissing` kiveszi a készletből a betöltődni nem tudó képet (a következő rajzolás tartalékot használ).
* `GET /api/role-sprites` – csak a manifest `real` listáját hirdeti (+ `v`). A kliens egyszer tölti le; a képek `immutable`, 7 napos gyorsítótárral jönnek (a `?v=` ürít).
* `public/client.js` `renderStage()` / `characterFigure()` – a slotokat a jelenet-profil (`SCENES.hu.pos`) × a szerep elrendezése adja; a bíró ugyanígy.

### Elrendezés (`public/avatar-roles.js`)

```js
ROLE_LAYOUT   = { judge: { scale, x, y, z, depth }, prosecutor: …, defendant: …, defender: …, witness: …, juror: … }   // asztali alap
NARROW_LAYOUT = { prosecutor: { x, y }, defendant: { scale, y }, juror: { y } }                                          // < 1180 px széles asztali képernyő
MOBILE_LAYOUT = { judge: { scale, y }, … }                                                                               // ≤ 700 px
AVATAR_ROLE_ADJUSTMENTS = { av01: { prosecutor: { scale: 0.96, x: 2 } } }                                               // avatáronkénti finomhangolás
```

`scale` a jelenet-profil szerinti slot-magassághoz képest, `x` / `y` eltolás a slot méretének %-ában, `z` rétegsorrend, `depth` fényerő (a hátsó sor kicsit sötétebb). A mód (`desktop` / `narrow` /
`mobile`) a színpad szélességéből jön (`layoutMode`). Finomhangolás: az avatáros bejegyzés szorozza (`scale`) / adja (`x`, `y`, `z`) az alapot; érvénytelen szám nem rontja el.

### Megjelenítés (`public/court.css`, „Szerep-képek” szakasz)

* nincs kártya-, téglalap- vagy keret-háttér a karakter mögött; kontakt-árnyék a talpnál, enyhe `drop-shadow`, a hátsó sor (esküdtek) a bíró és a tanú MÖGÖTT áll, kicsit sötétebben;
* **belépő animáció** 250–450 ms (bíró: finom nagyítás + áttűnés, ügyész: balról csúszás, vádlott: alulról „ideges” pattanás, tanú: jobbról csúszás, esküdt: halk áttűnés) a burkolón (`.st-art`),
  `backwards` kitöltéssel: a beszélő-kiemelés nem ütközik vele, és a beszéd végén nem játszódik le újra; csökkentett mozgásnál (`prefers-reduced-motion` / a játék saját kapcsolója) nincs animáció;
* a kép **betöltésig rejtett** (`opacity: 0`), betöltés után lép be: nincs fehér / zöld villanás, nincs törött ikon; a slot helye foglalt (nincs layout shift); hiba esetén tartalékra vált;
* az esküdtek névtáblája szerep-képeknél nem rajzolódik (a bíró / tanú arcára kerülne); a nevek a ponttáblán és a figura `title`-jében vannak;
* a bal oldali szerep-füzet 1200 px alatt alapból összecsukva indul, a vád-sáv 1480 px alatt 2 sorra, alacsony / fekvő telefonon 1 sorra vágva (a teljes vád koppintásra kinyílik): ezek nem takarják az arcokat.

### Teljesítmény

Csak az éppen szükséges képek töltődnek (a kliens a játékosok avatárjaihoz tartozó szerep-képeket kéri; a `court.js` tétlen időben, 2 párhuzamos letöltéssel előtölti a mostani szerepeket + a valószínű következőket),
a manifest verziója miatt a böngésző-gyorsítótár hatékony, a képek 3:4 vásznon, átlagosan ~50 KB-osak (összesen ~3,7 MB az 72 kép).

## Tesztek

| parancs | mit ellenőriz |
| --- | --- |
| `npm run test:roles` | fájlok (WebP / alfa / 720 × 960), manifest ↔ SOURCE_MAP, a szerver csak a `real` listát hirdeti, resolver / elrendezés / tartalék; a `sharp`-pal (NODE_PATH) pixel-ellenőrzés: átlátszó sarkok, nincs levágott fej, nincs zöld halo, a tanú ruházata tömör |
| `npm run test:roles-ui` | böngészőben, valódi játékkal: 1920×1080, 1366×768, 1024×768, 390×844, 360×640, 844×390 (fekvő telefon): mind az 5 szerep a helyes képpel, nincs törött kép / levágott fej / takarás, tartalék, 404-es kép, lassú betöltés, csökkentett mozgás, szerepváltás, bíró-csere, F5, teli szoba, beszélő-kiemelés, hálózati kérések |

`ROLES_UI_SHOTS=./QA_SCREENSHOTS npm run test:roles-ui` képernyőképeket is ment.

## Kézi finomhangolást igénylő párok / ismert korlátok

* **Fekvő telefon (844 × 390):** a felső HUD-sávok a képernyő jelentős részét elfoglalják; a karakterek látszanak és a vád-sáv egy sorra szűkül, de a fejek egy része a HUD alá kerül (a jelenet a magasság szerint kicsi). Külön fekvő-elrendezés (ROLE_LAYOUT mód) később adható.
* **360 × 640:** a bíró feje a vád-sáv alatt kezd; a névtáblák kicsik. Elfogadható, a teljes vád koppintásra kinyílik.
* Az **O karakter tanú-képe** (kerek szemüveg) és a **B / N / O karakterek avatár-sorszáma** vizuálisan ellenőrzendő (lásd fent).
* Az **av03 bíró** és az **av06 bíró** kép a pulpitust is tartalmazza, ezért oldalt kb. 1–2% levágódik (a fej és a kellék nem érintett).
* A hiányzó 35 avatár × 5 szerep és a védő-szerep képei később ugyanezzel a szkripttel adhatók hozzá.
