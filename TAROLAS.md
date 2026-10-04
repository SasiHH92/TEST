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

## Discord-belépés

Külön be kell állítani, lásd az `AUTH_BEALLITAS.md` Discord-fejezetét. Redirect URI a Renderen:
`https://A-TE-APPOD.onrender.com/api/auth/discord/callback`, és az `AUTH_DISCORD_CLIENT_ID` /
`AUTH_DISCORD_CLIENT_SECRET` változók a Render Environment fülén. A fiókok (a Discordhoz kötöttek is)
a fenti adatbázisban maradnak meg.
