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

A régebbi, részletesebb `test/browser-check.js` opcionális Playwrightot és Chromiumot igényel:

A fiókteszt 31 HTTP-alapú esetet ellenőriz elkülönített, utána törölt fióktárban. A Google/Discord és a levélküldés teszt-transportot használ; éles bejelentkezéshez a saját beállítások szükségesek. A böngészőteszt belépési/regisztrációs utakat, tíz belépőoldali nézetet, a tárgyalási HUD-t és 25 képernyőképet is ellenőriz. A `QA_SCREENSHOTS` és `CHROMIUM_PATH` változók továbbra is használhatók.

```bash
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

Ez a 12 névkártya, vendég/módválasztás/kilépés és 15 fázis × 5 képernyőméret ellenőrzésére szolgál: 1366×768, 1643×600, 1920×1080, 390×844 és 360×640. A 4. fázis végén a parancsot újra elindítottuk, de a Chromium futtatható fájlja hiányzott. A másik böngésző a helyi oldalt `ERR_BLOCKED_BY_CLIENT` hibával blokkolta. A méretek tényleges mérése ezért nem futott le; a teszt forrása nem jelent sikeres vizuális eredményt. `QA_SCREENSHOTS` megadásával képeket is menthet.

A korábban készített, opcionális képfeldolgozó teszt szintetikus bemenetet használ. A csatolt v3 képeket változtatás nélkül használjuk; a játék futtatásához vagy a kész grafikák beépítéséhez ez a Python-teszt nem szükséges:

```bash
python -m pip install -r scripts/graphics-requirements.txt
python test/assets-pipeline.py
```

## Filmes réteg (`npm run test:cinema`)

Valódi böngészőben (Playwright + Edge/Chrome) és valódi szerverrel, 40 ellenőrzés: `/api/media` lista (üres / szűrt), belépő videó-háttér (nincs fájl, nem elérhető fájl, csökkentett mozgás, keskeny képernyő, elérhető – a teszt maga rögzít egy kis WebM-et –, eltávolítás a belépőoldal elhagyásakor), lobbi-belépés és szobakód, szerep-felfedés (mind a 6 szerep, kép, időtartam, Esc, újratöltés), stinger, kihívás-eredmény, ítélet-idővonal (kalapács-sorrend, BŰNÖS! / ÁRTATLAN!, egyszeri), kör-összegző (count-up), játék vége (pódium, győztes, gombok), reakciók (anchor, korlátok, takarítás), idle-mozgás (amplitúdó, fázisok), kártya-animációk, hang-architektúra (fájl > szintetizált, némítás, hook-dokumentáció), csökkentett mozgás, szivárgás (eseményfigyelők CDP-vel, időzítők, DOM) és reszponzív rétegek 1920×1080 / 1366×768 / 1024×768 / 390×844 felbontáson. Böngésző nélkül a böngészős rész SKIP (`CINEMA_REQUIRE=1` esetén hiba); `CINEMA_SHOTS=./QA_SCREENSHOTS` képernyőképeket ment.
