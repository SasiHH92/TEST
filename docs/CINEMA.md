# Filmes játékélmény – a bemutató-réteg (cinema pass)

A játék **szabályait és állapotát a szerver adja**; ez a réteg csak *megjeleníti*: nem dönt el semmit, nem módosít időzítőt, pontot vagy szerepet.
A kliens a szerver állapotából (`courtSnapshot()` → `kbCourt.update(snapshot)`) rajzol. Ha az animáció elmarad vagy hibázik, a játék ugyanúgy végigjátszható.

## Áttekintés: mi mikor jelenik meg

| Pillanat | Mi látszik | Hossz | Hang (hook) | Hol |
| --- | --- | --- | --- | --- |
| Belépőoldal | opcionális videó-háttér (ha van fájl), vignetta | hurok | – | `media.js`, `cinema.css` |
| Lobbi | plakátok „lepattannak” a falra, avatár-felvillanás, kimásolható szobakód, állapot-jelvények (készen / házigazda / offline) | 0,5 s | `join`, `ready`, `ui-click` | `client.js`, `cinema.css` |
| Tárgyalás kezdete | **szerep-felfedés**: „TE VAGY A BÍRÓ / AZ ÜGYÉSZ / A VÁDLOTT / A VÉDŐÜGYVÉD / A TANÚ / AZ ESKÜDT”, a saját avatár szerep-képével, por-részecskék | 2,7 s (csökkentett mozgásnál 1,5 s), kihagyható (kattintás / Esc / Enter / szóköz) | `reveal` | `court.js` (`showReveal`) |
| utána | kör-intro (sorban vár, nem egyszerre) | – | `intro`, `intro-open` | `court.js` |
| Fázisváltás (ügyész, vádlott, védő, tanú, zárószavak, esküdtszék, kihívás-ellenőrzés) | vékony **stinger-sáv** a jelenet felső harmadában, színkódolt | 1,2 s (alcímes: 1,5 s) | `stinger` | `court.js` (`stinger`, `STINGERS`) |
| Bizonyíték / kihívás-kártya | a lap a KÁRTYÁIM-ból „emelkedik fel” a jelenet felé, pecsét | 2,2–2,8 s | `card-play`, `evidence`, `challenge` | `court.js` (`cardOverlay`) |
| Kihívás eredménye | **✓ SIKERÜLT** (arany, szikrák) / **✕ NEM SIKERÜLT** (vörös, rázkódás) | 1,2–1,5 s | `challenge-success`, `challenge-fail` | `court.js` (`challengeResultFx`, `trackReview`) |
| Ítélet | elsötétülés + bíró-fókusz + „ÍTÉLETHIRDETÉS” (1 s) → kalapács-ütés, rázkódás, villanás → **BŰNÖS! / ÁRTATLAN!** + pecsét + szavazat-arány → vádlott-fókusz → pontok felrepülése | ≈ 3,7 s | `stinger`, `gavel`, `verdict-guilty` / `verdict-acquitted`, `points` | `court.js` (`showVerdict`), `client.js` (`judgeSmash`, `verdictCue`) |
| Reakció (emoji) | a **küldő** karaktere fölött felpattan, felszáll, elhalványul, 5 szikra | 1,4 s | `reaction` | `client.js` (`popReaction`) |
| Kör-összegző | sorok csúsznak be, „+N” + ok a szerver eseményeiből, az összpont felpörög, a vezető 👑 | ≈ 1,6 s | – | `client.js` (`round_results`, `runCountUp`) |
| Játék vége | **győztes-spotlight** (nagy karakter, korona, konfetti), pódium (arany / ezüst / bronz), díjak, ÚJ TÁRGYALÁS / KILÉPÉS | tartós | `victory` | `court.js` (`showWinner`), `client.js` (`game_over`) |
| Mindig | idle-lebegés a szerep-képeken (≤ 2,6 px, ≤ 0,3°, karakterenként eltérő fázis), beszélő-kiemelés | folyamatos | – | `cinema.css` (`spr-idle`), `client.js` (`idleVars`) |

**Egyszerre egy nagy felület:** az overlay-menedzser (`court.js` → `OVL`, `present`, `ovStart` / `ovEnd`) csak egy „major” overlayt enged (szerep-felfedés, intro, ítélet, kihívás, bizonyíték, győztes);
a `document.body.dataset.courtMajor` jelzi. A kritikusak (felfedés, intro, ítélet) azonnal átveszik a helyet, a többi sorban vár, és ha közben fázis váltott, **elmarad** (elavult kártyát nem mutatunk).
A stinger vékony, nem „major”: nagy overlay alatt kimarad.

**Elhelyezés:** a rétegek a `#stage`-en belül élnek; 900 px fölött a jobb oldali pontsáv (280 px) a színpad fölött áll, ezért a nagy rétegek `right: var(--rail)` eltolással a szabad színpadra igazodnak (`renderStage` állítja a `--rail`-t). A szerep-felfedés címe a szó hosszához méreteződik (container query + `--len`), a győztes-réteg a lenti eredmény-panel tetejéig tart (`fitWinner`), így a név és a pont nem csúszik alá.

**A kör-intro** nem fázishoz kötött: ha a szerep-felfedés (2,7 s) alatt a játék már továbblépett (gyors vád-felolvasás), az intro akkor is lejátszódik, rövidített első lépéssel (2 s).

## Hangarchitektúra

* Kategóriák: `ui`, `card`, `paper`, `challenge`, `reaction`, `stinger`, `gavel`, `verdict`, `score`, `victory` (lásd `kbMedia.CATEGORIES`).
* Minden hang a `kbSound.play('<hook>')` hívással szól. **Sorrend:** (1) feltöltött fájl `assets/audio/<hook>.ogg|mp3|m4a|wav` → (2) szintetizált WebAudio hang → (3) csend. Egyik hiánya sem hiba.
* A `GET /api/media` megmondja, melyik fájl létezik (nincs 404-zaj); a lista 60 mp-ig gyorsítótárazott. Tesztre: `KB_AUDIO_DIR`, `KB_VIDEO_DIR`.
* Mester-hangerő és **némítás** (🔊 gomb + csúszka) a fájlokra és a szintetizált hangokra is érvényes; a csevegő-hangjelzés külön kapcsolható.
* **Autoplay:** az első kattintás/érintés élesíti az audio-környezetet (`ensureAudio`); addig a hívások csendben elmaradnak.
* A hook-nevek, az időzítés és a hangulat: **`assets/audio/README.md`** (a teszt ellenőrzi, hogy minden hook dokumentált).

## Videó-háttér a belépőoldalon

Lásd `assets/video/README.md`. A végleges `assets/video/login-loop.mp4` (2560×1440, 8 s) a projektben van, a belépőoldal automatikusan használja (`/api/media` listázza); a statikus háttérkép a poster és a tartalék. Telefonon mobil-fájl nélkül a statikus háttér marad. További fájlok (`.webm`, `-mobile`, `login-poster.webp`) opcionálisak.
Visszaesik a statikus háttérre: nincs fájl, csökkentett mozgás, adattakarékos/2G, keskeny képernyő mobil-fájl nélkül, hiba, 6 mp-nél lassabb indulás, rejtett lap.
A videó csak a belépőoldalon él; elhagyásakor `remove()` (nincs szivárgás).

## Csökkentett mozgás

`body.reduced-motion` (a játék saját kapcsolója) vagy `prefers-reduced-motion: reduce`:
nincs idle-lebegés, rázkódás, por/szikra, kamera-mozgás; a felfedés 1,5 s, az ítélet 220 ms után jön; az összpontok azonnal a végértéken állnak.
Minden **információ** (szerep, ítélet, pontok, győztes) ugyanúgy látszik.

## Teljesítmény-szabályok

* Csak `transform` / `opacity` (a két helyen használt `translate`/`rotate`/`scale` tulajdonság is kompozitor-barát) – nincs layout-animáció.
* Belépő-animációk `backwards` kitöltéssel, hogy a plakátok `--tilt` dőlése és a beszélő-kiemelés ne íródjon felül.
* Minden időzítő a `later()`-en megy (`st.timers`), a `reset()` mindet törli; a figyelők egyszer kötődnek (delegált), a videó/audio elem nem szivárog.
* Reakciók: játékosonként legfeljebb 2 él, összesen ≤ 14; a szerver sebességkorlátja változatlan.
* A szerep-képek lustán, tétlen időben, két párhuzamos letöltéssel töltődnek (`preloadRoles`), nem mind a 250.
* Teszt: `npm run test:cinema` (J blokk: eseményfigyelők CDP-vel, időzítők, DOM-csomópontok ismételt ciklusok után).

## Fájlok

| Fájl | Szerep |
| --- | --- |
| `public/court.js` | overlay-menedzser, szerep-felfedés, stinger, kihívás-eredmény, ítélet-idővonal, győztes-spotlight, pont-felrepülés |
| `public/cinema.css` | az összes új stílus (betöltés: `cards.css` után) |
| `public/media.js` | `window.kbMedia`: `/api/media`, login-videó, hangfájl-lejátszás, kategóriák |
| `public/client.js` | hang-hookok, reakció-pop, idle-változók, kör-összegző / játék vége blokk, lobbi-belépés, szobakód-másolás |
| `public/cards.js` | kártya-hover hang (delegált) |
| `server.js` | `GET /api/media` (kizárólag listáz; játéklogikához nem nyúl) |
| `assets/audio/README.md`, `assets/video/README.md` | a várt fájlok, **ASSET NEEDED** |
| `test/cinema.js` | `npm run test:cinema` |

## Ismert korlátok

* **VISSZA A LOBBYBA:** a szervernek nincs „vissza a lobbiba” eseménye (a `new_game` azonnal új játékot indít, csak a házigazda). A kliens ezt nem hamisítja; a játék végén ÚJ TÁRGYALÁS (házigazda) és KILÉPÉS van.
* Hangfájl nincs a projektben (minden hang szintetizált). A belépő videó valódi (`login-loop.mp4`), a lejátszását asztali felbontásokon teszt ellenőrzi; mobilra nincs videó (mobil-fájl hiányában statikus háttér).
* Fekvő telefon (844×390): a felső sáv és a nagy overlay-címek szoros helyen vannak; ott a felfedés/győztes cím a sávhoz közel ül (nem takarja az információt).
