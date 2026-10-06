# Kamu Bíróság – belépés és regisztráció

A csatolt kép alapján elkészült belépőoldal a valódi e-mail/jelszavas fiókokat, a Google- és Discord-belépést, az „Emlékezz rám” funkciót, a kijelentkezést és a jelszó-visszaállítást kezeli. A tárgyalási HUD előző változtatásai is benne vannak a projektben.

A háttér a kapott `assets/terem-hatter.webp`; a két figura a meglévő `biro.png` és `ugyesz.png`. A mezők, gombok és feliratok HTML-elemek. Telefonon fülekkel váltható a belépés és a regisztráció, a hosszabb űrlap függőlegesen görgethető.

## Indítás helyben

Node.js 18 vagy újabb kell. A projekt mappájában:

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Nyisd meg: **http://localhost:3000**. A regisztráció és a jelszavas belépés Google-, Discord- és levélküldő kulcs nélkül is működik. A külső belépés gombjai beállítás nélkül látszanak, de le vannak tiltva. A nem elérhető jelszó-visszaállítás sem ígér levélküldést.

Az `.env` fájl `AUTH_` kezdetű sorait a szerver betölti; a tárhelyen már megadott környezeti változók elsőbbséget élveznek. Módosítás után indítsd újra a szervert. Az `AUTH_BASE_URL` legyen a játék pontos, böngészőben használt címe, elérési út nélkül. Helyben a `localhost`/`127.0.0.1` HTTP is használható; külső címen HTTPS szükséges. A másik eredetről érkező űrlapkérések elutasításra kerülnek.

## Google-belépés

1. A Google Cloud Console-ban állítsd be az alkalmazás OAuth-hozzáférését és beleegyezési képernyőjét. Teszt módban a használni kívánt Google-fiókok legyenek tesztfelhasználók.
2. Hozz létre **Web application** típusú OAuth 2.0 kliensazonosítót.
3. Az engedélyezett redirect URI pontosan egyezzen a szerver címével:

| Környezet | Redirect URI |
| --- | --- |
| Helyi, az alap `.env.example` szerint | `http://localhost:3000/api/auth/google/callback` |
| Saját tárhely | `https://SAJAT-DOMAIN/api/auth/google/callback` |

4. Állítsd be az `AUTH_GOOGLE_CLIENT_ID` és `AUTH_GOOGLE_CLIENT_SECRET` értékeket a szerveren.

A belépés a Google oldalán történik; a játék nem kéri a Google-jelszót. Az alkalmazás `openid email profile` hozzáférést kér. Egyszer használatos, böngészőhöz kötött state és S256 PKCE védi a visszatérést. Csak ellenőrzött szolgáltatói e-maillel jön létre fiók.

Hivatalos leírás: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

## Discord-belépés

1. A [Discord Developer Portal](https://discord.com/developers/applications) alatt hozz létre alkalmazást.
2. Az OAuth2-beállításokban add meg az engedélyezett redirect URI-t:

| Környezet | Redirect URI |
| --- | --- |
| Helyi, az alap `.env.example` szerint | `http://localhost:3000/api/auth/discord/callback` |
| Saját tárhely | `https://SAJAT-DOMAIN/api/auth/discord/callback` |

3. Állítsd be az `AUTH_DISCORD_CLIENT_ID` és `AUTH_DISCORD_CLIENT_SECRET` értékeket. Botot nem kell meghívni a játékhoz.

A játék az `identify email` hozzáférést kéri a Discord belépőoldalán; ellenőrzött e-mail cím szükséges. A kódváltás szerveren történik, a kliens titka nem kerül a böngészőbe.

Hivatalos leírás: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).

## Már létező fiók összekapcsolása

Az azonos e-mail cím önmagában nem kapcsol össze fiókokat. Ha e-mail/jelszavas fiókod már létezik, előbb lépj be abba, majd a karakterválasztó vagy a szobamenü **FIÓKOM** menüjében válaszd a Google/Discord összekapcsolását. A már másik játékoshoz kötött szolgáltatói fiók nem vehető át. Összekapcsolás után ugyanabba a játékfiókba lépsz be a külső gombbal is.

## Elfelejtett jelszó

A beépített küldő a [Resend Email API](https://resend.com/docs/api-reference/emails/send-email). Állíts be:

```dotenv
AUTH_MAIL_API_KEY=SAJAT_RESEND_API_KULCS
AUTH_MAIL_FROM=Kamu Bíróság <belepes@SAJAT-HITELESITETT-DOMAIN>
```

### Beállítás lépésről lépésre (Resend)

1. Regisztrálj a [resend.com](https://resend.com) oldalon (az ingyenes csomag napi 100 levelet engedélyez, ez a játékhoz bőven elég).
2. **Domains → Add Domain**: add meg a saját domainedet, és a Resend által kiírt DNS-rekordokat (SPF, DKIM) vidd fel a domain szolgáltatódnál. Amíg a Resend nem jelzi a domaint „Verified"-nek, a levelek más címzetteknek **nem** mennek ki. (Domain nélkül a Resend csak a saját fiókod e-mail címére enged próbalevelet küldeni, a játékosoknak nem – erre lásd a „Kézi link" részt lent.)
3. **API Keys → Create API Key** („Sending access" elég). A kulcsot csak egyszer mutatja meg; **ne oszd meg, ne írd a repóba**.
4. A Renderen, a szolgáltatás **Environment** fülén add meg (a kulcsot te írd be, ne küldd el senkinek):

   | Kulcs | Érték |
   | --- | --- |
   | `AUTH_MAIL_API_KEY` | a Resend API-kulcs |
   | `AUTH_MAIL_FROM` | `Kamu Bíróság <belepes@SAJAT-DOMAIN>` (a hitelesített domainről) |
   | `AUTH_BASE_URL` | a játék pontos címe (már megvan) |
   | `ADMIN_TOKEN` | legalább 24 karakteres véletlen titok az admin oldalhoz (lásd TAROLAS.md / README „Üzemeltetés") |

5. Mentés után a Render újraindul. Nyisd meg az `/admin` oldalt, lépj be az `ADMIN_TOKEN`-nel, és a **Levélküldés** résznél küldj próbalevelet magadnak. Ha nem sikerül, az oldal pontosan kiírja a Resend válaszát (pl. „domain not verified"), és a hiba a **Hibák** listába is bekerül.

### Kézi link (amíg nincs levélküldés)

Ha egy játékos elfelejtette a jelszavát, de a levélküldés nincs beállítva: az `/admin` oldal **Kézi jelszó-visszaállító link** részében add meg a játékos e-mail címét, a kapott linket pedig küldd el neki (például Discordon). A link 1 óráig érvényes, egyszer használható, és belépés után azonnal új jelszót kér. Ezt csak az `ADMIN_TOKEN` birtokosa teheti meg.

A feladó legyen a Resendnél hitelesített cím/domain. Az `AUTH_BASE_URL` itt is a böngészőben elérhető címed. A levélben egy óráig, egyszer használható link van; a titkos token csak a link töredékében (`#reset=…`) szerepel. Új jelszó mentése az összes korábbi fiók-munkamenetet visszavonja. A válasz nem árulja el, hogy egy megadott címhez van-e fiók. A regisztráció nem küld külön e-mailes megerősítő levelet.

## Fióktár és üzemeltetés

- Alapértelmezett fióktár: `data/accounts.json`. Első regisztrációkor keletkezik. Jelszó helyett külön sóval készült scrypt-hash, session/reset-token helyett SHA-256 hash kerül a fájlba. Atomikus írás; Linuxon 0600 fájljogosultság.
- `AUTH_STORE_PATH` lehet abszolút útvonal tartós lemezen. Például Renderen: `/var/data/accounts.json`. Fiókokhoz tartós lemez szükséges; átmeneti tárhelyen telepítés vagy újraindulás során elveszhet a fájl.
- A JSON-tár **egyetlen szerverfolyamathoz** készült. Több példányhoz közös adatbázis és megosztott OAuth-state/rate-limit tár kell.
- Az alap belépés szerveroldalon 8 óráig él, böngésző-munkamenet sütit használ. „Emlékezz rám”: 30 nap. A süti HttpOnly, SameSite=Lax; HTTPS címen Secure is.
- `AUTH_TRUST_PROXY=1` csak megbízható reverse proxy mögött használható a fiókkérések IP-korlátjához. Alapértelmezésben a közvetlen kapcsolat címe számít. Végpontonként 20 próbálkozás/10 perc a korlát; jelszóhash-számításból kettő futhat egyszerre.
- Az `.env`, `data/accounts.json` és ideiglenes fióktár-fájlok nem tartoznak a kiadási ZIP-be. Meglévő telepítés frissítésekor a saját `.env`-t és fióktárat őrizd meg. Kulcsokat ne tegyél a `public/` mappába.

## Kapcsolat a meglévő játékkal

A vendégként játszás és a nyilvántartásból választott karakterek megmaradtak. Fiókkal a saját felhasználóneved is elő van töltve a karakterválasztóban. A fiókazonosítás külön áll a régi szoba-sessiontől: a játék továbbra is enged vendégeket. A szobák, kártyák, pontozás és játékszabályok nem lettek fiókokhoz átírva; a pontok korábbi működése megmarad. Fiókváltás/kijelentkezés törli a böngésző előző szobaazonosítóit.

## Ellenőrzések

```powershell
Get-ChildItem -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch 'node_modules' } | ForEach-Object { node --check $_.FullName }
npm test
npm run test:auth
npm install --no-save playwright
npx playwright install chromium
$env:QA_SCREENSHOTS = '.\QA_SCREENSHOTS'
# Saját Chromium esetén: $env:CHROMIUM_PATH = 'C:\utvonal\chrome.exe'
npm run test:browser
```

A fiókteszt valódi helyi HTTP-kéréseket és elkülönített, törölt tesztfióktárat használ. A külső szolgáltatói és levélküldési válaszok szimuláltak: valódi OAuth-azonosítók és feladó nélkül éles külső belépés/levélküldés nem ellenőrizhető. A böngészőteszt a korábbi 75 fázis/méret alapnézetet, kiegészítő HUD-nézeteket, az új fiókos/vendég belépést, tíz belépőoldali nézetet és 25 képernyőképet tervez. Indítási akadály esetén a jelentés `blocked`, az el nem végzett mérések nem sikeres tesztként szerepelnek.
