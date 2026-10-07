# Kamu Bíróság – UI/gameplay audit és megvalósítási terv

Ez a dokumentum a „nagy gameplay + UI/UX fejlesztés” **előtti** állapotot rögzíti, majd az implementációs tervet és a
haladást. A cél: a meglévő működő rendszerek megőrzése, a játék „élő magyar tárgyalótermi TV-show” élménnyé alakítása.

## 1. Meglévő rendszer (audit)

### Frontend
- **Stack:** build nélküli, klasszikus böngészős JavaScript (nincs bundler, nincs framework). Egy `index.html`, egy közös
  `style.css` (~3700 sor), a logika globális szkriptekben (`client.js` ~3200 sor: játék, `auth.js`, `shop.js`, `friends.js`,
  `chat.js`, `ranking.js`, `report.js`). A szkriptek globális változókon át (`S` = utolsó állapot, `MY`, `socket`, `SFX`)
  és `window.kb*` objektumokon át kapcsolódnak. Szigorú CSP: csak saját szkript, nincs inline szkript.
- **Állapot:** a szerver minden változáskor `state` eseményt küld (`publicState(viewerId)` játékosonként szűrve); a kliens
  `renderGame()` újrarajzolja a HUD-ot, a színpadot és a fázis-tartalmat. A kliens soha nem dönt a játékállapotról.
- **Színpad:** `#stage` (a `.stage-zone` teljes képernyős réteg): `targyalotterem.jpg` háttér, `#judge` (bíró), `#stageSlots`
  (ügyész / vádlott / védő / tanú / esküdtek), `#sceneFurniture` (a háttér képéből kivágott bútorlapok, amelyek a karakterek
  alját takarják), `#stagePlates` (névtáblák, ütközés-kerülő elhelyezéssel), `#judgeBubble`. A pozíciók a háttérkép
  méretéből számolt `sceneGeometry()` / `scenePosition()` szerint, százalékban.
- **Karakterek:** a játékos választott avatárja (`av01`…`av50`, `assets/avatars/avatar_NN.webp`, ~5 KB-os portré) áll a
  színpadon (`.av-figure`); avatár nélküli játékosnál a fix szerepfigura (`biro.png`, `ugyesz.png`, `vadlott.png`, `tanu.png`,
  `vedougyved.png`, `eskudt1-3.png`). **Szerep-specifikus avatár-sprite nincs** (az 50×5 készlet hiányzik).
- **Karakter-animáció:** `charAnim` (egyetlen rAF-ciklus, legfeljebb 3 mozgó karakter, lélegzés, bólogatás), reduced-motion
  támogatással (`kb_reducedMotion` + `prefers-reduced-motion`).
- **HUD:** `.info-bar`, `#roleBanner` (fázis-cím + beszélő), `#accusationTicker` (vád, nyitó-animációval), időzítő-gyűrű
  (`timerHtml`), `#myCardsBar` (saját titkos kártyák), jobb oldali `#scoreSidebar` (ponttábla / csevegő / reakciók).
- **Hang:** WebAudio-szintetizált `SFX` (gavel, objection, accepted, rejected, reaction, drumTick, applause, whisper, ding,
  fanfare, chat, dm, guilty, acquit, vote); némítás + hangerő `localStorage`-ban (`kb_muted`, `kb_volume`). Fájl-asset nincs.
- **Újrafelhasználható elemek:** `confettiBurst`, `flyEmoji` (reakciók), `releaseDoves`, `verdictCue`, `showToast`,
  `showConnBar`, `avatarEmoji()`/`avatarSrc()`, kozmetikum-keretek (`cos-frame-*`), `.btn`, `.mug-card`, modalok (`.avatar-modal`).
- **Design tokenek:** a `style.css` `:root`-jában vannak (`--gold`, `--red`, `--ink`, `--font-disp` …), de a komponensek
  sok helyen saját színt írnak.

### Backend / realtime
- Node + Express + Socket.io (`server.js`), játékmotor `game.js` (`Game` osztály, fázisgép: lobby → accusation → prep →
  prosecution → defense → defender → witness → final_* → verdict_vote → (challenge_*) → verdict → round_results → game_over),
  botok `bots.js`. A szoba memóriában él; a fiókok / statisztika / üzenetek / moderáció fájlban és Neon Postgresben.
- **Szerver-authoritatív:** a szerver ellenőrzi a jogosultságot (házigazda / bíró / szavazó), az időzítőket és a pontozást.
  Játékos-azonosítás: szerver-oldali munkamenet (`sockets` map) + szoba-token; fiók: süti + egyszer használatos jegy.
- **Auth:** e-mail+jelszó, Google, Discord, vendég; fiók-törlés és adatkérés; CSP/HSTS fejlécek; moderáció.
- **Pontozás (nem változik):** ítélet (ügyész: bűnös szavazatok száma / vádlott + védő: ártatlan szavazatok), egyhangú bónusz
  +1, esküdt-pont +1 (egyező szavazat), kihívás +2/+4, közönségkedvenc +1.

### Assetek
`assets/`: `targyalotterem.jpg/png/svg` (tárgyalóterem), `terem-hatter.webp` (belépő), szerep-PNG-k (6+3), `*_beszel.svg`
(régi beszélő-rajzok), `avatars/avatar_01..50.webp`. Összesen ~2,8 MB.

### Kockázatos területek
1. **Színpad-geometria:** `sceneGeometry`, `scenePosition`, `layoutStagePlates` (a névtáblák ütközés-kerülése a HUD-sávokkal) –
   törékeny; a színpad elemeire alkalmazott transzformáció méréseket torzíthat.
2. **Z-sorrend:** bútorlapok (z 34–74), karakterek (`--z`·10), névtáblák (100), buborék (99), villanás (94).
3. **`renderGame()` gyakori újrarajzolása:** az animációknak túl kell élniük az újrarajzolást (kulcs-alapú frissítés).
4. **Mobil:** külön geometria (≤700 px), felcsúszó ponttábla, vád-sáv / buborék elhelyezés.
5. **CSP:** inline szkript/eseménykezelő tilos; minden új kód külön fájlban.

## 2. Megvalósítási terv (sorrend, külön commit mindegyik)

| # | Lépés | Állapot |
| --- | --- | --- |
| 1 | Audit + design tokenek (`court.css`) + kamera-keret a színpad körül | ✅ |
| 2 | Avatár × szerep megfeleltetés (`avatar-roles.js`, `/api/role-sprites`, hiányzó képnél az eredeti avatár + HTML jelvény) | ✅ |
| 3 | Szerver (visszafelé kompatibilis): `scoreEvents`, `set_ready` / `ready`, mért díj-számlálók | ✅ (`test/gamestate.js`) |
| 4 | Élő terem (fény, por, sodródás), kamera-fókusz fázisonként, HUD (alcím + szerver-idő a szerepsávban) | ✅ |
| 5 | Kör-intro (kihagyható), ítélet-pecsét (race-védett), pont-felrepülés a szerver eseményeiből, bizonyíték- és kihívás-kártya (egyszerre egy) | ✅ |
| 6 | Lobbi: GYORS / EGYÉNI játék, játékoskártyák (HOST, VENDÉG, KÉSZ), "kész vagyok" valós időben | ✅ |
| 7 | Avatárválasztó (VÉLETLEN + "KARAKTER KIVÁLASZTVA"), végeredmény: érmek, dobogó-fények, díjak a mért értékkel | ✅ |
| 8 | Hang-architektúra: `kbSound.play(név)` → WebAudio-szintézis, csendes tartalék, némítás + hangerő megmarad | ✅ (hangfájl nincs) |
| 9 | Kapcsolat-UX: megszakadt / újrapróbálkozás (n. próba, ébredő szerver) / helyreállt; oldal-újratöltés a szobába visszatér | ✅ |
| 10 | Reszponzív + akadálymentesség + tesztek (`test/flow.js`, `test/layout.js`) | ✅ |

Jelölés: ⬜ még nincs, ✅ kész és ellenőrizve (teszt + böngészős próba). Az állapot lépésenként frissül.

## 3. Asset-leltár és SVG-audit (a ZIP-átvétel után)

**Leltár (a repó és a szülőmappa, node_modules nélkül):** PNG 9 + 1 referencia-tábla, JPG 1, WebP 51 (50 avatár + `terem-hatter.webp`) + 250 szerep-kép
(`assets/roles/`, átmeneti placeholderek), SVG 13 (régi `assets/*.svg`), ZIP 1 (`files.zip`, régi SVG-k). **Hang-asset nincs.**

| Kategória | Elemek |
| --- | --- |
| **ORIGINAL ASSETS USED** | `terem-hatter.webp` (a játék jelenete és a belépő háttere, a magyar tárgyalóterem), `avatars/avatar_NN.webp`, `roles/avatar_NN_<szerep>.webp`, a szerep-PNG-k (`biro.png`, `ugyesz.png`, `vadlott.png`, `tanu.png`, `vedougyved.png`, `eskudt1-3.png`) avatár nélküli játékosnak |
| **KEPT UI SVG** | az időzítő-gyűrű (`<svg viewBox="0 0 118 118">`, 2 helyen a `client.js`-ben), a lobbi piros fonalai (`createElementNS`, vonalrajz), a favicon (data URI) |
| **REMOVED / REPLACED SVG ARTWORK** | a magyar zászló + címer SVG-overlay (korábbi `court.js` decor) és a szerep-jelmez SVG-k (korábbi `avatar-roles.js`): eltávolítva; helyettük a raszter terem-kép, és hiányzó szerep-képnél az eredeti avatár + kis HTML szerepjelvény |
| **LEGACY (nincs hivatkozva)** | `assets/*.svg` (13 db), `files.zip`; a futó kód nem hivatkozik rájuk (`test/asset-policy.js` ellenőrzi) |
| **MISSING ASSET** | végleges szerep-specifikus avatár-képek (a 250 placeholder ugyanazokra a fájlnevekre cserélendő), külön dosszié / bizonyíték / kihívás-kártya raszter-artwork (HTML/CSS pergamen-kártya a tartalék), hangfájlok (csendes tartalék), a régi `targyalotterem.jpg` amerikai zászlót tartalmaz: ezért a jelenet a `terem-hatter.webp`-t használja |

**Jelenet-profil:** a `client.js` `SCENES.hu` a `terem-hatter.webp` cím nélküli alsó részét (cropTop 300) mutatja; a kép az aljához igazított, a teteje sötétbe
halványul (itt van a HUD). A `window.kbCourtConfig = { scene: 'legacy' }` a régi képet kapcsolja vissza. Ha a grafikai munkafolyamat új, magyar `targyalotterem.jpg`-t ad,
elég a `SCENES.legacy` koordinátáit hozzáigazítani, és ezt állítani alapértelmezettnek.


## 4. Végső integráció: a megjelenítés a szerver állapotából (a kliens semmit nem dönt el)

**Adatfolyam.** `socket 'state'` → `S` → `renderGame()` → `courtSnapshot()` (csak a megjelenítéshez szükséges kivonat: kör, ügyszám, vád, nevek, saját szerep, saját privát kártyák, ítélet, pontesemények) →
`kbCourt.update()`. Az időzítő-ciklus (`startTimerLoop`) a szerver lejáratából (`phaseEndsAt − (Date.now() + serverOffset)`) számolja a HUD-időt és hívja a `kbCourt.tick()`-et (3-2-1). Nincs második játékmotor,
nincs kliens-oldali óra, pontozás, szerep- vagy ítélet-döntés.

| Terület | Forrás a szerverről | Megjelenítés |
| --- | --- | --- |
| Szerepek | `prosecutorId / defendantId / defenderId / witnessId / currentJudgeId` | színpadi pozíció + `assets/roles/avatar_NN_<szerep>.webp` (hiányzik → az eredeti avatár + HTML jelvény) |
| Fázis → kamera | `phase` (+ `objectionData.phase`) | `court.js PHASE_UI / CAMERA`: ügyész, vádlott, védő, tanú, bíró, széles; mozgás-csökkentésnél a kamera áll |
| HUD | `phase`, `phaseEndsAt` | szerepsáv: cím + beszélő + alcím + idő; 10 mp-től sárga, 5 mp-től piros, utolsó 3 mp-ben nagy 3-2-1 |
| Kör-intro | `round`, `totalRounds`, `caseNo`, `accusationText`, vádlott neve | "N. TÁRGYALÁS – AZ ÁLLAM vs. X – VÁD", kihagyható (kattintás / Esc), majd "A TÁRGYALÁS MEGKEZDŐDIK!" + a bíró kalapácsa; újratöltéskor nem ismétlődik |
| Bizonyíték | `evidence` (csak az ügyésznek / védőnek küldi a szerver), `revealedCards` (kör végén mindenkinek) | dosszié-kártya; más játékos privát adata soha nem kerül a kliensre |
| Kihívás | `myChallenge`, `challengeReview`, `challengeVote` | egyszerre egy kártya, a bizonyíték után |
| Ítélet | `verdict.guilty` (+ szavazatszám, `unanimous`) | bíró-fókusz → kalapács → pecsét (BŰNÖS / FELMENTVE) + rázkódás → vádlott-fókusz; ha közben fázis vált, a réteg kecsesen elhal |
| Pontok | `scoreEvents` (ki, mennyi, miért) | felrepülő "+N" az okkal; a ponttábla sora pulzál; semmi sem jelenik meg, ami nincs az eseményben |
| Reakciók | `reaction` esemény (a szerver szűri a fázist, az emojit és a sebességet) | legfeljebb 14 egyszerre; mozgás-csökkentésnél rövid, álló jelzés |
| Díjak | `gameOver.awards` (csak pozitív mért értékre) | díjkártya + a mért érték (pont, elítélés, nevetés, kihívás, elítélt ügy, felmentés, jó ítélet) |
| Lobbi | `players[].ready / isHost / profile.acct` | KÉSZ / HOST / VENDÉG jelvény, "Készen áll: X / Y" |

**Hang-hookok** (`kbSound.play(név)`): `gavel, intro, intro-open, evidence, challenge, points, countdown, verdict-guilty, verdict-acquitted, join, ready, vote, objection, ding`. Mind WebAudio-szintézis (nincs letöltött hang); AudioContext vagy hangerő
hiányában csend. A némítás és a hangerő `localStorage`-ban él (`kb_muted`, `kb_volume`).

**Tesztek.** `npm run test:flow` (3 emberi böngésző + 2 bot: lobbi, indítás, intro, szerepek, HUD-idő, kamera, 3-2-1, bizonyíték-szivárgás, reakció-korlát, ítélet-pecsét = szerver ítélet, Σ pontesemény = pontszám, szerepcsere
újratöltés nélkül, kapcsolat-megszakadás és újracsatlakozás, F5 a játékban, végeredmény + díjak, JS-hiba nélkül); `npm run test:layout` (11 méret); `test/gamestate.js`, `test/asset-policy.js`, `test/avatar-roles.js`.

**Nyitott / nem automatizált.** (1) A végleges szerep-képek: a 250 `assets/roles/*.webp` ideiglenes placeholder (azonos az alap-avatárral) – a kód a névkonvencióra épül, csere = fájlok felülírása. (2) Hangfájlok nincsenek (csendes / szintetizált tartalék).
(3) Valódi, több géppel / mobilhálózaton végzett próba nem futtatható ebben a környezetben (BLOCKED): a tesztek egy gépen, több böngésző-környezettel szimulálják a játékosokat.

## 5. KÁRTYÁIM (fizikai kártya-kéz) + időzítő- és takarás-tisztítás

### Audit (a módosítás előtt)
| Kérdés | Megállapítás |
| --- | --- |
| Mi szerver-authoritatív? | A kártyák tartalma és láthatósága (`game.js publicState(viewerId)`: `evidence` csak az ügyésznek és a védőnek, `tricks` a védőnek, `alibi` a vádlottnak, `witnessCard` a tanúnak, `myChallenge` a szereplőnek, `judgeWatch` a bírónak; `test/card-visibility.js` védi), az időzítő (`phaseEndsAt`, a tiltakozásnál `defenderEndsAt` / `judgeEndsAt`), a fázisok, a pontok. |
| Mi kliens-oldali megjelenítés? | A kéz (zárt / nyitott / kijelölt), a nagyító, az "ÚJ KÁRTYA" jelzés, a hang-hookok, a HUD, a panel elrendezése. Játékeseményt a kártya-réteg nem küld, a láthatóságot nem dönti el. |
| Melyik kártya interaktív? | Egyik sem: a játékban nincs kijátszható kártya, ezért nincs akció-gomb. A komponens támogatja az `isUsable` / `actionLabel` mezőt (HASZNÁLHATÓ jelzés), de semmi nem köti hozzá. |
| Mikor érkezik / tűnik el? | A kártyák a felkészülés elején érkeznek (a szerver `state`-jében), az ítéletig látszanak; a kör végén (`round_results`) mindenki látja az összes kártyát a "felfedés" panelben. Eventek: nincs külön kártya-event, minden a `state`-ben jön. |
| Régi probléma | A "KÁRTYÁIM" lenyíló, webes widget volt; a felkészülés alatt a nagy alsó panel (gyűrűs időzítő + szöveg) ugyanazt az időt ismételte, mint a felső sáv, és takarta a vádlottat; a szerep-útmutató a panel közepén jelent meg; a kihívás-ellenőrzésnél két teljes méretű kihívás-felület állt egymás mellett. |

### Megvalósítás
- **`public/cards.js` + `public/cards.css`** (vanilla, a meglévő architektúrán): `CourtCard` (arc + típus-stílus), `CardHand` (zárt pakli ⇄ nyitott legyező ⇄ kijelölt, mobilon alsó tálca), `CardPreview` (nagyító a kéz fölött, ‹ › léptetés, ✕ / Esc). Papír-kezelés csak HTML/CSS: pergamen-színátmenet, kopott szél (belső árnyék), hajtott sarok, ujjlenyomat-folt, kapocs (bizonyíték), piros BIZALMAS / AKTÁBA VÉVE pecsét, bohóc-szalag (kihívás). **Nincs SVG, nincs új artwork.**
- **Típusok:** `evidence` (dosszié, piros pecsét, sorszám), `witness` (zöld TANÚ jelvény, BIZALMAS), `challenge` (piros-arany bohóc-szalag), `alibi` (VÁDLOTT), `trick` (VÉDŐ); a `role` (SZIGORÚAN BIZALMAS, sötét papír) és a `special` (arany) stílus előkészítve, de **játékhoz nem kötött** (nincs ilyen kártya). A leírókat `client.js myCardList()` építi KIZÁRÓLAG a szerver által nekem küldött mezőkből (a tanúkártya szövege az állapotból jön, nincs beégetett "villager").
- **Interakció:** zárt pakli (2–4 lap, eltérő elforgatás) → kattintás / koppintás: legyező (felfelé és jobbra; legfeljebb 4 lap + "+N" lap) → lap: előre jön + nagyító; hover: emelkedés és kiegyenesedés (semmi fontos nincs csak hover mögött); a kézen kívüli kattintás becsukja. Billentyűzet: Tab a szalagra, Enter / Space nyit, ← → lapok közt, Enter kijelöl, Esc előbb a nagyítót, aztán a kezet zárja; látható fókusz; a privát lapok hozzáférhető címkéje "titkos kártya, csak te látod".
- **ÚJ KÁRTYA:** a megérkező lap becsúszik a pakliba, rövid ragyogás + "ÚJ KÁRTYA" jelzés (~2 s); nem modal, nem szakítja meg a játékot. A felkészülés elején a pakli magától kinyílik (olvasni kell), a végén becsukódik, ha a játékos nem nyúlt hozzá.
- **Hang-hookok:** `card-open`, `card-new`, `card-select` (WebAudio-szintézis, nincs hangfájl).
- **Reszponzív:** desktop: bal alsó sarok; tablet: kisebb pakli; mobil: kis pakli → alsó vízszintes tálca → nagyító (nincs 5 nagy lap a fél képernyőn); a ponttábla-sáv fölött áll.
- **Időzítő:** a nagy alsó gyűrűs időzítő megszűnt MINDEN fázisban; az idő egyetlen helye a felső fázis-sáv (HUD; 10 mp sárga, 5 mp piros, 3-2-1). A szerver-idő és az időzítő-ciklus érintetlen (`hudEndsAt()` olvassa a szerver lejáratát; a tiltakozás időzítője is ide került).
- **Szerep-füzet** (bal felső, a BÍRÓI FIGYELŐ általánosítva): a panelből kikerült szerep-útmutatók egyetlen helye (bíró: figyeld a feleket / jegyezd meg a kihívásokat / a kör végén te értékelsz; esküdt, ügyész, vádlott, védő, tanú: rövid felkészülési útmutató). Összecsukható, a felkészülésnél (nem mobilon) magától nyílik.
- **Kompakt fázispanel:** üres panel nem rajzolódik (felkészülés; beszédfázis nézőknek); beszédfázisban csak a saját gomb (VÉGEZTEM / TILTAKOZOM); vádemelés, szavazás, tiltakozás, kihívás-ellenőrzés (✓ SIKERÜLT / ✕ NEM SIKERÜLT, a "SZÓRAKOZÁS" pontot nem adó külön csoport), kihívás-szavazás, ítélet (ítélet-szó + mondat + gombok, a szavazatok és kihívások lenyithatók) és kör vége (a ponttáblával dupla pontlista nincs széles képernyőn) mind alacsony sáv a jelenet alján, a bal alsó kéz mellett / fölött.
- **Overlay-menedzser** (`court.js`): egyszerre legfeljebb EGY nagy overlay (intro, ítélet, kihívás-kártya, bizonyíték); az intro és az ítélet kritikus (átveszi a helyet), a többi sorban vár, fázisváltáskor elmarad. A kihívás-kártya 2,2 mp-ig látszik, aztán csak a kompakt ellenőrző sáv marad; a bemutató alatt a kapcsolódó sáv és a vád-sáv elhalványul.
- **Z-rétegek** (dokumentálva a `court.css` 15. szakaszában): jelenet 0 → fázis-gombok 70 → kéz + szerep-füzet 74 → HUD 76 → ponttábla 85 → nagyító 90 → reakciók 92 → jelenet-overlayek 120–128 → pont-felrepülés 140 → értesítések 150 → rendszer-ablakok 200.

### Tesztek
`npm run test:cards` (`test/cards.js`): kéz-komponens (zárt / nyitott / kijelölt / nagyító / billentyűzet / hosszú szöveg / +N / típusok / ÚJ KÁRTYA / csökkentett mozgás), mobil tálca, és egy valódi játék 1366×768, 1920×1080, 1024×768 és 390×844 méreten: nincs időzítő-gyűrű, az idő egyszer látszik és a szerver idejéhez igazodik, a felkészülés alatt nincs panel, tartós panel nem takarja a karaktereket (biztonságos zónák, ≤ 12 %), egyszerre legfeljebb egy nagy overlay, a kihívás-kártya és az ellenőrző sáv nem látszik egyszerre. `npm run test:flow` kiegészítve: a kéz tartalma = a szerver által küldött kártyák, és más játékos privát kártyája nem jelenik meg a képernyőn.
