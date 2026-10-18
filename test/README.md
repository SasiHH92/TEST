# Ellenőrzések

```bash
npm test
npm run test:auth
npm run test:rules
npm run test:rooms
npm run test:bots
npm run test:ops       # hibanapló, admin felület, böngészős hibajelentés, kézi jelszó-link
npm run test:storage   # adatbázis-tárolás és a napi pillanatképek (memóriában futó Postgres)
node test/deploy-check.js
```

Az alapteszt és a hálózati bot-teszt statisztikát írhat, ezért egymás után fusson. A `test:rules` a játékszabályokat, titkos kártyák címzettjeit, bírórotációt, tiltakozást, kihívást, szerepátadást és automatikát ellenőrzi. A stresszteszt a valódi BotManager hívásait futtatja virtuális órával, hat teljes, háromkörös játékban, 3–8 fővel.

## Elrendezés-teszt telefonon és gépen (Playwright)

```bash
npm run test:layout
```

A `test/layout.js` valódi böngészőben, 7 méreten (320×568-tól 1366×768-ig) végigviszi a belépőoldalt, a névválasztót, a menüt, a lobbit, a csevegőt és egy botokkal játszott tárgyalást (több fázison át), valamint egy fiókkal belépett nézetet. Minden képernyőn ellenőrzi, hogy nincs vízszintes görgetés, a rögzített elemek (infó-gomb, sarok-kapcsolók, barát- és csevegő-gomb, panelek, HUD-sávok) nem lógnak ki és nem fedik egymást, és nincs JavaScript-hiba a konzolon. Emellett ellenőrzi a lobbibeli „kevesebb mozgás" és hang-kapcsolót, valamint az ítélet-effektek (galambok, rázkódás) viselkedését teljes és csökkentett mozgásnál. Futási ideje kb. 2 perc, ezért nincs a `npm run test:rules` csoportban.

- Böngésző: `CHROMIUM_PATH=<futtatható fájl>`, egyébként a gépen lévő Edge vagy Chrome (a `playwright-core` nem tölt le böngészőt), végül a Playwright Chromiumja (`npx playwright install chromium`). Ha egyik sincs, a teszt `SKIP` üzenettel 0-val kilép; `LAYOUT_REQUIRE=1` mellett hibával.
- Képernyőképek: `LAYOUT_SHOTS=./QA_SCREENSHOTS npm run test:layout`.
- A játékbeli mérés csak olyan hibát jelez, ami két egymás utáni mérésben is megvan (az átmeneti animációk nem), és a vád-sáv nyitó animációját szándékosan figyelmen kívül hagyja.

A régebbi `test/browser-check.js` (`npm run test:browser`) a többi böngészős teszthez hasonlóan a `playwright-core`-t használja a gépen lévő Edge-dzsel / Chrome-mal (vagy `CHROMIUM_PATH`). Ellenőrzi a belépőoldalt 5 méreten (1366×768, 1643×600, 1920×1080, 390×844, 360×640), a regisztrációt (16+ elfogadással), a hibás / helyes jelszót, a megjegyzést, az újratöltést, a kijelentkezést, a vendég-belépést, a lobbit botokkal, az EGYÉNI JÁTÉK módválasztását, az indítást, a kilépést és az újratöltést, JavaScript- és képhiba nélkül. A teszt-szerver minden adatot ideiglenes fájlba ír (a `data/` mappát és az adatbázist nem érinti).

A régi „15 fázis × 5 méret” elrendezés-mérése egy korábbi képernyőtervre épül, és sosem futott végig sikeresen; ezt ma a `test/layout.js`, a `test/cinema.js` és a `test/landscape-phone.js` méri a mai felületen. Alapból kimarad, `QA_LEGACY_LAYOUT=1` kapcsolja be (jelenleg a régi gombnevek miatt hibát jelez). `QA_SCREENSHOTS` megadásával képeket is menthet.

A korábban készített, opcionális képfeldolgozó teszt szintetikus bemenetet használ. A csatolt v3 képeket változtatás nélkül használjuk; a játék futtatásához vagy a kész grafikák beépítéséhez ez a Python-teszt nem szükséges:

```bash
python -m pip install -r scripts/graphics-requirements.txt
python test/assets-pipeline.py
```

## Filmes réteg (`npm run test:cinema`)

Valódi böngészőben (Playwright + Edge/Chrome) és valódi szerverrel, 45 ellenőrzés: `/api/media` lista (üres / szűrt), belépő videó-háttér (nincs fájl, nem elérhető fájl, csökkentett mozgás, keskeny képernyő, elérhető – a teszt maga rögzít egy kis WebM-et –, a valódi `assets/video/login-loop.mp4` (felismerés, bájtazonosság, Range, lejátszás, cover, poster, telefon, hibaág), eltávolítás a belépőoldal elhagyásakor), lobbi-belépés és szobakód, szerep-felfedés (mind a 6 szerep, kép, időtartam, Esc, újratöltés), stinger, kihívás-eredmény, ítélet-idővonal (kalapács-sorrend, BŰNÖS! / ÁRTATLAN!, egyszeri), kör-összegző (count-up), játék vége (pódium, győztes, gombok), reakciók (anchor, korlátok, takarítás), idle-mozgás (amplitúdó, fázisok), kártya-animációk, hang-architektúra (fájl > szintetizált, némítás, hook-dokumentáció), csökkentett mozgás, szivárgás (eseményfigyelők CDP-vel, időzítők, DOM) és reszponzív rétegek 1920×1080 / 1366×768 / 1024×768 / 390×844 felbontáson. Böngésző nélkül a böngészős rész SKIP (`CINEMA_REQUIRE=1` esetén hiba); `CINEMA_SHOTS=./QA_SCREENSHOTS` képernyőképeket ment.
