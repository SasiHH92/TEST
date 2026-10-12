# E-mailek a Kamu Bíróságban (Resend)

A játék hat, egységes arculatú magyar levelet küld. A levelek táblázatalapú, inline CSS-es HTML-ek (Gmail, Outlook, mobil), 600 px szélesek, külső CSS / JavaScript nélkül; kép nélkül is olvashatók, és minden levélnek van szöveges változata is.

| # | Levél | Mikor megy | Tárgy |
|---|-------|-----------|-------|
| 1 | Regisztráció megerősítése | új jelszavas regisztráció után | ⚖️ Kamu Bíróság – Megérkezett az idézésed! |
| 2 | Üdvözlő levél | az e-mail-cím megerősítése után (és külső – Google / Discord – regisztrációkor) | ⚖️ Üdv a Kamu Bíróságon, *név*! |
| 3 | Elfelejtett jelszó | „Elfelejtett jelszó?” kérésre | ⚖️ Kamu Bíróság – Új jelszó beállítása |
| 4 | Jelszó megváltoztatva | sikeres jelszócsere / visszaállítás után | ⚖️ Kamu Bíróság – A jelszavad megváltozott |
| 5 | Játékmeghívó | a lobbiban a „✉️ Meghívó e-mailben” gombbal | ⚖️ Beidéztek a Kamu Bíróságra! |
| 6 | Biztonsági értesítő | új belépési mód (Google / Discord) összekötésekor | ⚖️ Kamu Bíróság – Biztonsági értesítés |

## Mit állíts be?

### 1. A Resendben (egyszer)

1. Regisztrálj a [resend.com](https://resend.com) oldalon.
2. **Domains → Add Domain**: add meg a domainedet (pl. `kamubirosag.com`). A Resend kiírja a DNS-rekordokat (SPF, DKIM, esetleg DMARC): vidd fel őket a domain DNS-kezelőjénél (nálad: Cloudflare → DNS). Amíg a domain nem **Verified**, a levelek csak a saját Resend-fiókod címére mennek ki.
3. **API Keys → Create API Key**: jogosultság „Sending access”, a domainre szűkítve. A kulcsot (`re_...`) azonnal másold ki: csak egyszer látszik. **Ne küldd el senkinek, ne írd be sehová a tárolóba.**

### 2. A Renderen (Environment fül)

| Változó | Érték | Kötelező |
|---------|-------|----------|
| `RESEND_API_KEY` | a Resend API-kulcsa | igen (titkos) |
| `EMAIL_FROM` | `Kamu Bíróság <noreply@kamubirosag.com>` (a hitelesített domainről) | igen |
| `AUTH_BASE_URL` | `https://kamubirosag.com` (a linkek ebből készülnek; már be van állítva) | igen |
| `EMAIL_HEADER_IMAGE_URL` | a fejléc-kép https címe (lásd lent) | nem |
| `DISCORD_INVITE_URL` | a láblécben megjelenő meghívó (alapból a szerver meghívója) | nem |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `0` kikapcsolja a regisztráció e-mailes megerősítését | nem |

A régi `AUTH_MAIL_API_KEY` / `AUTH_MAIL_FROM` nevek továbbra is működnek. Mentés után a Render újraindul.

A levélküldés akkor „él”, ha **kulcs + feladó + AUTH_BASE_URL** mind megvan. Addig minden úgy működik, mint eddig: a regisztráció azonnal belép, és nem megy ki levél.

> ⚠️ Amint a levélküldés él, az **új** regisztrációkhoz e-mail-megerősítés kell (a megerősítő levél linkje nélkül nem lehet belépni). A meglévő fiókokat ez nem érinti. Ha a Resend beállítása még nincs kész, ne add meg a kulcsot, vagy állítsd `AUTH_REQUIRE_EMAIL_VERIFICATION=0`-ra.

## Teszt-email küldése

**Az admin oldalon** (legegyszerűbb): `/admin` → belépés az `ADMIN_TOKEN`-nel → **Levélküldés** → címzett + a levél kiválasztása → **PRÓBALEVÉL**. A próbalevél a sablon mintaadataival megy (valódi token nélkül). Ha a Resend elutasítja, az oldal kiírja az okát (pl. „domain not verified”).

**A saját gépedről** (PowerShell):

```powershell
$env:RESEND_API_KEY="re_..."
$env:EMAIL_FROM="Kamu Bíróság <noreply@kamubirosag.com>"
$env:AUTH_BASE_URL="https://kamubirosag.com"
node scripts/send-test-email.js te@example.com welcome
```

A sablon neve: `welcome`, `confirmEmail`, `passwordReset`, `passwordChanged`, `gameInvite`, `securityNotice`.

**Küldés nélkül, csak megnézni** (nem megy ki levél): `npm run email:preview`, majd nyisd meg az `email-preview/index.html` fájlt a böngészőben. Fejlesztéshez az `EMAIL_DRY_RUN=1` is használható: ilyenkor a szerver nem küld levelet, hanem a konzolra és az `EMAIL_OUTBOX_FILE` fájlba írja. Éles szerveren ne állítsd be.

## A fejléc grafikájának cseréje

A fejléc-kép nélkül szöveges fejléc látszik (bordó sáv, arany „KAMU BÍRÓSÁG” felirat). Amikor kész az OpenArttal készített kép:

1. Mentsd JPEG vagy PNG formátumban, **600 px széles** (retinára 1200 px is jó, a levél 600 px-re méretezi), lehetőleg 150 KB alatt.
2. Tedd fel egy nyilvános, **https** címre. A legegyszerűbb: tedd az `assets/` mappába (pl. `assets/email-fejlec.jpg`), és push után a címe `https://kamubirosag.com/assets/email-fejlec.jpg`.
3. A Renderen állítsd be: `EMAIL_HEADER_IMAGE_URL=https://kamubirosag.com/assets/email-fejlec.jpg`. Újraindítás után minden levél ezt használja.

Csak https cím fogadható el (a http és más sémák kimaradnak). Ha a levelező letiltja a képeket, az alt-szöveg és a levél többi része így is olvasható. Kipróbálás előre: `node scripts/preview-emails.js --header https://kamubirosag.com/assets/email-fejlec.jpg`.

## Biztonság

- **Megerősítő token:** 32 véletlen bájt, a levélben a linkben (`/#verify=...`) van; a szerver csak a lenyomatát tárolja. 24 óráig érvényes, egyszer használható; új kérés érvényteleníti a régit. Hibás, lejárt vagy már felhasznált link érthető hibát ad.
- **Jelszó-visszaállítás:** külön token (`/#reset=...`), 1 óráig, egyszer használható. A válasz ugyanaz, akár van ilyen fiók, akár nincs. A visszaállító levél megérkezése a címet is igazolja.
- **A megerősítetlen fiók** nem léphet be (a hibaüzenet csak a helyes jelszóval érkezik), és 7 nap után, ha soha nem lépett be, felszabadítja a nevet és a címet.
- **Korlátok:** megerősítő levél címenként 1/perc és napi 5; jelszó-visszaállító levél címenként óránként 3; játékmeghívó fiókonként óránként 3, naponta 10, ugyanarra a címre ugyanabból a szobából óránként 1; ezen felül a meglévő IP-alapú próbálkozási korlát az egész fiók-API-n.
- **Játékmeghívó:** csak bejelentkezett fiók küldhet, csak a saját (lobbi-fázisú) szobájához; a szobakódot és a tagságot a szerver ellenőrzi. A levélben a küldő neve és a szoba linkje szerepel.
- **Hibakezelés:** a küldési hiba nem állítja le a játékot. A hiba oka (kulcs és e-mail-cím nélkül) a szerver naplójába és az admin **Hibák** listájába kerül. A regisztrációnál a felhasználó azt látja, hogy a levelet nem sikerült elküldeni, és az újraküldés gombbal próbálkozhat.
- Az API-kulcs soha nem kerül a böngészőbe, a naplóba vagy a levélbe.

## Fájlok

`mail-templates.js` (sablonok), `mailer.js` (Resend SDK, beállítások, száraz futtatás), `auth.js` (megerősítés, értesítők), `server.js` (játékmeghívó-végpont), `public/auth.js` (megerősítő link, újraküldés), `public/invite-mail.js` (meghívó-gomb), `scripts/preview-emails.js`, `scripts/send-test-email.js`, `test/email.js` (`npm run test:email`).
