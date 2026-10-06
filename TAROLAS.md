# Tartós tárolás a Renderen (ingyenes Postgres)

Az ingyenes Render csomag fájlrendszere ideiglenes: újraindításkor, új telepítéskor és alvás utáni
felébredéskor minden helyben írt fájl elvész. A játék ezért a fiókokat, a statisztikát (elítélve /
felmentve) és az avatár-választásokat egy külső, ingyenes Postgres adatbázisban is eltárolja.
A játékot továbbra is a Render futtatja, az adatbázis csak a tárolóhely.

## Hogyan működik

- Indításkor (`npm start` → `hydrate.js`) az adatbázisból visszakerülnek a fájlok a szerverre.
- Minden mentés után a fájl tartalma feltöltődik az adatbázisba (fél másodperc késleltetéssel).
- Leálláskor (új telepítés, újraindítás) a függő mentések még kiíródnak.
- Ha a `DATABASE_URL` nincs megadva, minden a régi módon, csak helyi fájlokban működik (helyi fejlesztés, tesztek).
- Ha az adatbázis indításkor nem érhető el, a játék **nem indul el** (a Render újrapróbálja). Így egy üres
  állapot sosem írja felül az adatbázis tartalmát.
- Nem kerül az adatbázisba: a szobák és az éppen futó játékok (ezek csak memóriában élnek).

## Beállítás Neonnal (ingyenes Postgres)

1. Regisztrálj a [neon.tech](https://neon.tech) oldalon, és hozz létre egy projektet (régió: Frankfurt vagy a legközelebbi EU).
2. A projekt **Connection details** részében másold ki a kapcsolati sztringet. Valahogy így néz ki:
   `postgresql://felhasznalo:jelszo@ep-valami-123.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. A Renderen: a szolgáltatás **Environment** fülén add hozzá:

   | Kulcs | Érték |
   | --- | --- |
   | `DATABASE_URL` | az előbb kimásolt kapcsolati sztring |
   | `AUTH_BASE_URL` | a játék pontos címe, pl. `https://kamu-birosag.onrender.com` |
   | `AUTH_TRUST_PROXY` | `1` |

4. Mentsd, és a Render újraindítja a szolgáltatást. A naplóban ilyen sort kell látnod:
   `[hydrate] adatbázis rendben: {...}`

A kapcsolati sztring titok: ne tedd a repóba, és ne oszd meg.

Az ingyenes Neon projekt egy idő után alvó módba megy, az első kapcsolat ilyenkor 1–2 másodperccel lassabb;
a `hydrate.js` ezt 5 újrapróbálkozással kezeli.

## Ellenőrzés

- Regisztrálj egy tesztfiókot, majd a Renderen kattints a **Manual Deploy → Restart** (újraindítás) gombra.
  Utána be tudsz lépni ugyanazzal a fiókkal: az adat megmaradt.
- A statisztika és az avatárok ugyanígy megmaradnak.
- Helyi teszt: `npm run test:storage` (memóriában futó Postgres-emulátorral, külső szolgáltatás nélkül).

## Rendszeres mentés (pillanatképek)

A Neon ingyenes csomagja csak rövid ideig tartja meg a korábbi állapotot, ezért a játék maga is mentést készít:

- Indulás után egy perccel, majd óránként ellenőrzi, van-e legfeljebb 23 órás mentés. Ha nincs, pillanatképet készít a `kb_store` összes dokumentumáról (fiókok, statisztika, avatárok, privát üzenetek) a `kb_backup` táblába. Naponta tehát egy készül (a Render alvása miatt akkor, amikor valaki épp játszik vagy a szerver felébred).
- A legutóbbi **14** pillanatkép marad meg, a régebbiek törlődnek. A hibanapló nem része a mentésnek.
- Üres adatbázisról nem készül mentés. A pillanatkép az adatbázis tartalmából készül, nem a szerver memóriájából.
- Az `/admin` oldalon (lásd lent) látod a mentések listáját, és a **Mentés most** gombbal kézzel is készíthetsz egyet (például nagyobb frissítés előtt).
- Az automatikus mentés hibája a hibanaplóba kerül (`storage` típus).

### Saját, helyi másolat

```powershell
$env:DATABASE_URL = '<a Neon kapcsolati sztring>'   # csak a saját gépeden, ne oszd meg
npm run db-backup                                    # backups/kb-ÉÉÉÉHHNN-ÓÓPPMM.json
```

A fájl jelszó-hash-eket és privát üzeneteket tartalmaz: tartsd magadnál. A `backups/` mappa `.gitignore`-ban van.

### Visszaállítás

1. A Renderen **Suspend** (a futó szerver felülírná a visszaállított adatot a saját memóriájából).
2. A saját gépeden:

   ```powershell
   $env:DATABASE_URL = '<a Neon kapcsolati sztring>'
   npm run db-restore                          # felsorolja a mentéseket
   npm run db-restore -- <azonosító> --apply   # visszaállítja; előtte „prerestore" mentés készül a mostani állapotról
   ```

3. A Renderen **Resume**. Indításkor a szerver az adatbázisból tölti vissza az adatokat.

## Admin oldal és hibanapló

Az `/admin` oldal csak akkor működik, ha a Renderen megadsz egy `ADMIN_TOKEN` környezeti változót (legalább 24 karakter, véletlen; például `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). Nélküle minden admin útvonal 404-et ad. A token csak a böngésző aktuális füléig marad meg, rossz tokennel 10 próba / 10 perc után az IP ideiglenesen tiltva van.

- **Áttekintés:** adatbázis, mentések, levélküldés és hibák állapota.
- **Hibák:** a váratlan szerverhibák (socket-kezelők, HTTP-útvonalak, nem elkapott kivételek, sikertelen adatbázis-mentés vagy levélküldés) és a böngészőben elkapott hibák, összevonva, darabszámmal. E-mail címek, hosszú tokenek és adatbázis-címek kimaradnak belőlük. Fájlban és az adatbázisban is megmaradnak, így újraindítás után is megvannak.
- **Mentések:** lista és „Mentés most".
- **Levélküldés:** próbalevél, lásd az `AUTH_BEALLITAS.md` „Elfelejtett jelszó" részét.
- **Kézi jelszó-visszaállító link** a levélküldés nélküli időszakra.

## Discord-belépés

Külön be kell állítani, lásd az `AUTH_BEALLITAS.md` Discord-fejezetét. Redirect URI a Renderen:
`https://A-TE-APPOD.onrender.com/api/auth/discord/callback`, és az `AUTH_DISCORD_CLIENT_ID` /
`AUTH_DISCORD_CLIENT_SECRET` változók a Render Environment fülén. A fiókok (a Discordhoz kötöttek is)
a fenti adatbázisban maradnak meg.
