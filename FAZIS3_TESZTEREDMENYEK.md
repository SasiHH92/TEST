# Kamu Bíróság – 3. fázis, belépés és regisztráció

**A fázis elkészült.** A teljes projekt tartalmazza a korábban átadott teljes képernyős tárgyalási HUD-t és az új fiókos belépést. Az alap a ténylegesen csatolt `Kamu-Birosag-v4.1.zip`.

## Elkészült

- A csatolt minta alapján teljes háttérképes belépőoldal: arany cím, rendőrségi szalag, papírhatású belépő/regisztráló űrlap, a meglévő bíró és ügyész figurája. A kész képeket használja; nem generáltunk és nem vágtunk ki grafikát.
- Valódi e-mail/jelszavas regisztráció és belépés. Egyedi felhasználónév/e-mail, 12–128 karakteres jelszó, jelszómegerősítés, megjelenítés/elrejtés és érthető hibák.
- „Emlékezz rám”, kijelentkezés, fiókmenü, Google/Discord OAuth belépés és meglévő fiókhoz való összekapcsolás. A vendégmód és a karakterválasztó megmaradt.
- Jelszó-visszaállítás egyszer használható, egyórás e-mail-linkkel, beállított Resend küldő esetén. Beállítás nélkül a külső gombok és a levélkérés nem aktívak.
- Külön fiókmodul: sózott scrypt-jelszóhash, HttpOnly/SameSite süti, HTTPS-nél Secure, tokenek hash-elve tárolva, session-rotáció, eredetellenőrzés, próbálkozási korlát. Az alap fiók-session 8 óra, megjegyezve 30 nap.
- Telefonon váltófülek, 16 px beviteli szöveg és legalább 48 px fő vezérlők. A belépőoldal hosszabb tartalma függőlegesen görgethető.
- A böngészőteszt kezeli az új belépési útvonalat és elkülönített tesztfióktárat használ. A tárgyalási takarás-ellenőrzések megmaradtak.
- Beállítási útmutató: `AUTH_BEALLITAS.md`; másolható példa: `.env.example`.

A játékszabályok, kártyák és pontozás forrása változatlan. A `server.js` csak a külön fiókmodul betöltését és `/api/auth` útvonalának felcsatolását kapta. Az előző PNG/JPG/SVG assetek megmaradtak. A fiók és a régi szoba-session külön áll; a játék továbbra is enged vendégeket, a pontozást nem írtuk át fiókokhoz.

## Lefutott ellenőrzések

| Ellenőrzés | Eredmény |
| --- | --- |
| `node --check` minden saját JS-fájlon | **27/27 sikeres**, 0 hiba |
| `npm test` – teljes megerősítő futás | **18/18 sikeres**, 0 hiba |
| `npm run test:auth` | **31/31 sikeres**, 0 hiba |
| Valódi `server.js` HTTP smoke | **4/4 sikeres**: belépőoldal, nyilvános auth-kliens, kép, regisztráció/session/kijelentkezés |
| Forrás- és csomagellenőrzés | Egyedi HTML-azonosítók, változatlan játék/kártyák/pontozás, eredeti assetek, az új háttér azonos a csatolttal |
| `npm run test:browser` | **Elindítva, blokkolt**, kilépési kód 1: nincs Chromium futtatható fájl |

A 31 fiókteszt valódi helyi HTTP-kéréseket használ: regisztráció, belépési hibák, egyediség, sütik, munkamenet-rotáció/lejárat/újraindulás/kijelentkezés, jelszó-visszaállítás és session-visszavonás, Origin/JSON/méret/próbálkozási korlát, sérült tár, `.env`, Google/Discord kódváltás, state/PKCE/egyszeri visszatérés, ellenőrzött e-mail, fiók-összekapcsolás és szolgáltatói/levélküldési hibák. A külső válaszok teszt-transportból jöttek; valódi e-mail nem ment ki.

Az első fiókteszt-kör 29 sikeres és 2 hibás esetet adott: egy `.env`-megjegyzéskezelési hibát javítottunk; a másik ellenőrzés tévesen a nyilvános `passwordReset` kapcsolót is titkos jelszónak tekintette, ezt pontosítottuk. A végső futásban nincs fennmaradó teszthiba. Egy ismételt játékteszt naplója hat ellenőrzés után teljes összegzés nélkül zárult; azt nem számítottuk teljes sikernek, és a külön megerősítő futás 18/18-cal lezárult.

A tesztek által változtatott `data/stats.json` és `test/e2e-log.txt` eredeti tartalmát a kiadás előtt visszaállítottuk. A fióktesztek ideiglenes tárát töröltük. Tesztfiók, aktív session vagy saját szolgáltatói titok nem kerül a ZIP-be.

## Nem futott le

A Playwright csomag elérhető volt, de a böngészőindítás a Chromium binárisának hiányán elakadt. A korábbi telepítési kísérlet hibás/üres letöltéssel végződött; a másik böngésző a helyi címet blokkolta. A mérés emiatt nem jutott el az oldalhoz.

| Tervezett méret | Tárgyalási 15 fázis és belépőoldal vizuális mérése | Képernyőképek |
| --- | --- | --- |
| 1366×768 | Nem futott le | Nem készültek |
| 1643×600 | Nem futott le | Nem készültek |
| 1920×1080 | Nem futott le | Nem készültek |
| 390×844 | Nem futott le | Nem készültek |
| 360×640 | Nem futott le | Nem készültek |

Elvégzett böngészős elrendezésmérés: **0**. Elkészült képernyőkép: **0**. A script 75 alap tárgyalási nézetet, kiegészítő HUD-változatokat, tíz belépőoldali nézetet, valamint 20 tárgyalási és 5 belépőoldali képet tervez. Ezekre a ZIP nem állít vizuális tesztsikert.

Saját Google-/Discord OAuth-azonosítók és hitelesített levélküldő nélkül az **éles külső bejelentkezést és a valódi levélkézbesítést nem ellenőriztük**. A bekötés és hibakezelése a helyi HTTP-tesztekben sikeres volt.

## Használat

A ZIP-et csomagold ki, majd a projekt mappájában `npm install`, `npm start`; az e-mailes regisztráció önállóan működik. A `.env.example` másolható `.env` néven. Helyben az alap beállítással `http://localhost:3000` a cím. A Google/Discord redirect-címeket, kulcsokat, a levélküldőt és a tartós fióktárat az `AUTH_BEALLITAS.md` részletezi. A JSON fióktár egy szerverpéldányhoz készült, tárhelyen tartós lemez kell hozzá.

Böngészős újrafuttatás Windows PowerShellből:

```powershell
npm install --no-save playwright
npx playwright install chromium
$env:QA_SCREENSHOTS = '.\QA_SCREENSHOTS'
# Saját böngészőnél: $env:CHROMIUM_PATH = 'C:\utvonal\chrome.exe'
npm run test:browser
```

A teljes projekt ZIP-je `node_modules`, saját `.env` és fióktár nélkül készült. Az eredeti karakterek, hátterek és SVG-k, a HUD, a szerver, a játékadatok, a tesztek és a beállítási útmutatók benne vannak.
