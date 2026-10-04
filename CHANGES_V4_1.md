# v4.1 – elrendezés-javítások (böngészőben mérve)

Mérve: Chromium, 5 méret (1366x768, 1643x600, 1920x1080, 390x844, 360x640) x 15 fázis = 75 kombináció.
Első futás: 15 hiba (gombok a tartalomzónán kívül). Javítás után: 75/75 sikeres.

- public/style.css (a fájl végén): a fázistartalom biztonsági görgetést kapott (csak extrém esetben), a műveleti gombok (TOVÁBB, ÚJ JÁTÉK MOST...) alul ragadnak; tömörebb ítélet / kihívás-ellenőrzés / kihívás-szavazás; kis telefonon kevesebb keret.
- test/browser-check.js: a mérés megvárja a fázis-animációkat (550 ms), különben az animáció közbeni elcsúszás hamis hibát jelzett; a Chromium útvonala a CHROMIUM_PATH környezeti változóból jöhet.
- Játéklogikához, szerverhez, kártyákhoz nem nyúltunk. Tesztek: npm test 18/0, test:rules 12 csoport/0, test:rooms 9/9, test:bots 22/0, stress-bots 6/6.

Futtatás: npm install --no-save playwright; CHROMIUM_PATH=<chromium útvonal> npm run test:browser
