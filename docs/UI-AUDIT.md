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
|---|---|---|
| 1 | Audit + design tokenek (`court.css`) + kamera-keret a színpad körül | ✅ |
| 2 | Avatár × szerep megfeleltetés (`avatar-roles.js`, manifest, fallback) | ⬜ |
| 3 | Szerver (visszafelé kompatibilis): `scoreEvents`, `exhibit` (bizonyíték), `ready`, díj-számlálók | ⬜ |
| 4 | Élő terem (parallax, fény, por), cinematic fókusz, szerep-bevezetés, fázis-HUD | ⬜ |
| 5 | Kör-intro, ítélet-pecsét, pontok felrepülése, bizonyíték- és kihívás-kártya a jelenetben | ⬜ |
| 6 | Lobbi: GYORS / EGYÉNI játék, játékoskártyák (ready, HOST, VENDÉG) | ⬜ |
| 7 | Avatárválasztó (random, pecsét), ponttábla-dobogó, humoros díjak | ⬜ |
| 8 | Hang-architektúra (név-alapú leképezés, fallback) | ⬜ |
| 9 | Kapcsolat-UX (újracsatlakozás, helyreállt, házigazda kiesett, szoba megszűnt) | ⬜ |
| 10 | Reszponzív + akadálymentesség + tesztek + takarítás | ⬜ |

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
