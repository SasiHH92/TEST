# Kamu Bíróság – Discord setup bot

Egyetlen parancs (`/setup`) felépíti a teljes hivatalos Discord szervert: role-ok, kategóriák,
csatornák, jogosultságok, fórumok, magyar nyelvű embedek. A bot utána futva maradhat, és később
„⚖️ ÚJ TÁRGYALÁS” értesítéseket is küldhet. A játék kódját (`../server.js` stb.) nem érinti:
a bot külön mappában, külön `package.json`-nal él.

## Összekötés a játékkal (tárgyalások)

A bot a webes játékkal is össze van kötve: a weben nyitott tárgyaláshoz Discord-panel jelenik meg a 🎮・játék-kereső
csatornában (jelentkezés gombbal), a sorsolt szerepek ideiglenes `Kamu | …` role-okként kerülnek ki. Az állapot a
**backendben** él, a bot csak megjeleníti. Részletek, végpontok, telepítés: [../DISCORD_OSSZEKOTES.md](../DISCORD_OSSZEKOTES.md).
Bekapcsolás: a `.env`-ben `BACKEND_URL` és `BOT_SERVICE_TOKEN` (ugyanaz, mint a Render webszolgáltatáson). Nélkülük csak a
`/setup` parancsok működnek. Játékosoknak: `/kapcsol kod:<kód>` (a kódot a weboldal menüjében, az **Összekötés** gombbal kapják).

## Moderáció (automatikus, opcionális)

A bot a Discord-szerver üzeneteit is moderálja: **szabályalapú szűrés** (mindig pontos, magyarázható), és **opcionálisan MI-alapú szöveg- és képértelmezés**.
Alapból KI van kapcsolva (`MODERATION=0`), a játék-integrációt és a `/setup`-ot nem érinti.

**Bekapcsolás (egyszer):**
1. Developer Portal → a bot → **Bot** fül → **Privileged Gateway Intents** → **MESSAGE CONTENT INTENT = BE** → Save. (Enélkül a bot moderáció nélkül indul újra, és ezt naplózza.)
2. Új jogok: **Manage Messages** (törlés) és **Moderate Members** (ideiglenes némítás). `npm run invite` → az új link → ugyanazt a szervert válaszd (a meglévő bot megkapja a jogokat). A bot role-ja legyen a role-lista tetején (különben nem tud némítani).
3. `MODERATION=1` (a Renderen: Environment; önálló botnál: `.env`), majd újraindítás. Futtasd a `/setup-repair` parancsot: létrehozza a **🛡️・mod-napló** csatornát (csak Tulajdonos / Fejlesztő / Moderátor látja).

**Mit szűr (szabályok):**
| Szabály | Súlyosság | Példa |
|---|---|---|
| Gyűlöletbeszéd, uszítás (ragozva, „leet”-ben, szétszórt betűkkel is) | súlyos | rasszista / homofób szidalom, „dögölj meg” |
| Átverés, adathalászat, IP-naplózó, hasonmás-domain, tömeges említés, több csatornás spam, veszélyes melléklet (.exe, .bat…) | súlyos | „ingyen Nitro” + link, `dlscord-gift.com`, 5+ említés |
| Idegen Discord-meghívó, üzenet-áradat, ismételt üzenet | közepes | |
| Durva káromkodás, csupa nagybetű, emoji-áradat, karakter-ismétlés, zalgo-szöveg, szövegfal, rövidített link | enyhe | |

**Büntetési létra** (24 órás ablak, pontok: enyhe 1, közepes 2, súlyos 4): minden találat → az üzenet törlése + a tag értesítése (DM; ha tiltott, rövid, magától eltűnő jelzés a csatornában).
4 pont → 10 perc némítás, 7 pont → 1 óra, 10 pont → 24 óra; **súlyos** találatnál azonnal legalább 1 óra. A stáb (Tulajdonos / Fejlesztő / Moderátor role, Administrator, szerver-tulajdonos) és a botok **kivételek**.
Minden intézkedés a **🛡️・mod-naplóba** kerül (tag, csatorna, ok, tartalom-részlet), a némítás ott a **↩ Visszavonás** gombbal feloldható (a pontok is törlődnek). A szerkesztett üzenetet is újraellenőrzi. `/moderacio` (admin): állapot és statisztika.

**MI-réteg (opcionális):** `MOD_AI=1` + `ANTHROPIC_API_KEY`. A bot ilyenkor a **képmellékleteket** (jpg/png/gif/webp, max. 5 MB, üzenetenként 3) és a **szöveget** is Claude-dal értékelteti: a szöveg-értelmezés a kerülő megfogalmazást, zaklatást, fenyegetést, öngyilkosságra uszítást, a képellenőrzés az explicit, véres vagy gyűlölet-szimbólumos képeket fogja meg.
Az utasítás védi a játék humorát (játékbeli „vádak”, évődés nem szabálysértés). Csak **egyértelmű** (2–3 súlyosság), **magabiztos** (≥ 0,7) találat töröl; kétség esetén az üzenet átmegy. Szöveg alapból csak az 1 hétnél frissebb tagoknál megy az MI-hez (`MOD_AI_TEXT=new`; `all` / `off`), kép mindig. Legfeljebb 20 hívás/perc, hiba / időtúllépés esetén az üzenet átmegy (a chat sosem akad el).
**Költség és adatvédelem:** a vizsgált szöveg / kép-link az Anthropic API-hoz kerül; a használat díjköteles. Ezt érdemes a 📜・szabályzatban jelezni a tagoknak. A kulcsot csak a környezetben (Render Environment / `.env`) add meg, soha ne commitold.

**Korlátok (őszintén):** a szólista kiindulópont, nem tökéletes (téves riasztás és kihagyás előfordulhat); a `MOD_WORDLIST_FILE` JSON-nal bővíthető (`{"hate":[],"profanity":[],"allow":[]}`, a `*` végű szó tő). A büntetőpontok memóriában élnek (újraindításkor nullázódnak). Súlyos esetet (pl. kiskorút veszélyeztető tartalom) a Discord Trust & Safety felé is jelentsd. A Discord saját védelmeit (Server Settings → Safety Setup / AutoMod: explicit képszűrő, szülői beállítások) érdemes kézzel is bekapcsolni, a bot ezeket kiegészíti.

## Parancsok

| Parancs | Mit csinál |
|---|---|
| `/setup` | Felépít mindent, ami hiányzik; a bot saját embedjeit frissíti. Újrafuttatható, nem duplikál. |
| `/setup-status` | Csak ellenőriz: role-ok, hierarchia, csatornák, fórum-címkék, jogosultságok, embedek, bot-jogok. |
| `/targyalas` | Bárkinek (összekötött fiókkal): új tárgyalás nyitása, a szobát a rendszer automatikusan létrehozza. |
| `/moderacio` | Admin: az automatikus moderáció állapota. |
| `/kapcsol kod:` | Bárkinek: a Discord-fiókot a Kamu Bíróság fiókjához köti (egyszer használatos, 10 perces kód a weboldalról). |
| `/setup-repair` | Csak pótol: hiányzó elemeket és elromlott jogokat javít, meglévő üzenetet nem ír át. |

Mindhárom csak a **szerver tulajdonosának** vagy **Administrator** jogú tagnak működik (a Discord
alapból is elrejti másoknak, és a bot külön ellenőrzi). A bot **soha nem töröl** csatornát, role-t
vagy üzenetet, és a közösségi tartalomhoz nem nyúl.

## 1. Alkalmazás létrehozása a Developer Portalon

1. Nyisd meg: <https://discord.com/developers/applications>, jelentkezz be.
2. **New Application** → név: `Kamu Bíróság` → Create.
3. **General Information** fülön másold ki az **Application ID**-t (ez a `DISCORD_CLIENT_ID`, nem titok).

## 2. Bot létrehozása

1. Bal menü: **Bot**.
2. **Reset Token** → **Copy**. Ez a `DISCORD_BOT_TOKEN`. **Titok:** ne küldd el senkinek, ne írd chatbe,
   ne commitold. Ha kiszivárog, ugyanitt a **Reset Token** érvényteleníti a régit.
3. **Public Bot**: kapcsold ki (csak te hívhasd meg).

## 3. Intents és jogok

- **Privileged Gateway Intents**: mind maradjon **KI** (Presence, Server Members, Message Content).
  A bot egyetlen intentet használ: `Guilds` (az nem privilegizált).
- Jogok (nem Administrator!) – a meghívó link pontosan ezeket kéri:

| Jog | Miért |
|---|---|
| Manage Roles | role-ok létrehozása, rendezése |
| Manage Channels | kategóriák, csatornák, felülírások, fórum-címkék |
| View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History | embedek küldése, saját korábbi üzenet megtalálása (nincs duplikálás) |
| Manage Threads | a sablon-poszt kitűzése a fórumokban |
| Attach Files, Add Reactions, Connect, Speak | a Discord csak olyan jogot enged egy csatornán beállítani, amellyel a bot is rendelkezik (stáb-, bétás és hang-jogosultságokhoz) |

A pontos lista bármikor kiírható: `npm run invite`.

## 4. Meghívó link

```bash
cd discord-bot
npm install
copy .env.example .env      # Windows (macOS/Linux: cp .env.example .env)
```

Töltsd ki a `.env`-et (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`), majd:

```bash
npm run invite
```

Megnyitod a kiírt linket, kiválasztod az **üres** szervert, **Authorize**. (Kézzel is összerakható:
`https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot%20applications.commands&permissions=<szám>`
– a `<szám>` a `npm run invite` kimenetében szereplő link.)

## 5. Indítás

```bash
npm start
```

Siker esetén: `[bot] bejelentkezve: ...` és `[bot] parancsok regisztrálva: <szervernév>`. A terminálnak
nyitva kell maradnia, amíg használod. A parancsok a szerveren azonnal megjelennek.

## 6. `/setup`

1. **Ajánlott előtte:** Server Settings → **Enable Community** (a Discord varázslója kér egy szabályzat- és egy
   frissítés-csatornát – bármit kijelölhetsz, később átállítható). Csak Community szerveren lehet **fórum**
   csatorna (🐛 hibajelentés, 💡 ötletek). Ha kihagyod, a bot sima szövegcsatornát hoz létre, és szól;
   később Community bekapcsolása után a `/setup-repair` létrehozza a fórumokat (a régi szövegcsatornát nem
   törli, azt te törölheted).
2. **Server Settings → Roles**: a bot role-ját (neve a bot neve) húzd a lista **tetejére**. Ha a setup
   szól, hogy a bot role-ja nem a legmagasabb, ezt kell megtenni. (A Discord csak a saját role-jai alatti
   role-okat engedi kezelni.)
3. Bármelyik csatornában: `/setup`. Egy-két perc, a válasz elmondja, mi jött létre.
4. `/setup-status` – ellenőrzés. Ha hiányt jelez: `/setup-repair`.

### Mit épít fel?

- **Role-ok** (fentről lefelé): 👑 Tulajdonos, 🛠️ Fejlesztő, 🛡️ Moderátor, 🧪 Tesztelő, ⚖️ Játékos, 🤖 Bot.
  A bot magának is kiosztja a 🤖 Bot role-t. Az üdvözlünk csatornán lévő **Játékos leszek** gomb a ⚖️ Játékos
  role-t adja a kattintónak.
- **📜 BÍRÓSÁG**: 👋 üdvözlünk, 📜 szabályzat, 📢 bejelentések, 📰 frissítések, ❓ gyik (mind csak olvasható
  a játékosoknak; írhat: Tulajdonos, Fejlesztő, Moderátor és a bot).
- **⚖️ KÖZÖSSÉG**: 💬 általános, 😂 mémek, 📸 képek-videók, 💡 ötletek (fórum, címkékkel).
- **🎮 JÁTÉK**: 🎮 játék-kereső (30 mp lassított mód), 🔑 szobakódok (15 mp), 🏆 eredmények (csak olvasható,
  a bot posztol), 3 db 🔊 Tárgyalóterem (Connect/Speak engedélyezve).
- **🧪 BÉTA / FEJLESZTÉS**: csak Tulajdonos, Fejlesztő, Moderátor, Tesztelő látja; 🧪 tesztelők, 🐛 hibajelentés
  (fórum, címkékkel), 💭 teszt-visszajelzés, 📋 ismert-hibák.
- **Embedek** (magyarul): üdvözlünk, szabályzat, gyik, játék-kereső; a hibajelentés és ötletek fórumban kitűzött
  sablon-poszt. A hibajelentés sablon: Eszköz/böngésző, Mi történt, Mit kellett volna történnie,
  Megismételhető-e, Szobakód, Kép/videó.

### Fontos tudnivalók

- A Discord szabálya: a bot csak olyan jogot adhat egy role-nak, amilyen neki is van. Mivel a bot nem
  Administrator, a role-ok **jogok nélküliek** (megjelenés + csatorna-hozzáférés). Ha a Moderátoroknak
  kick/timeout/üzenetkezelés kell, add meg kézzel: Server Settings → Roles → 🛡️ Moderátor → Permissions.
  A Tulajdonos a szerver tényleges tulajdonosa, nem role-on múlik.
- A hangcsatornákhoz nem kell, hogy a bot hangba lépjen.
- Az `.env` nincs a Gitben (`.gitignore`), a token sehol nincs a kódban.

## Futtatás hosszú távon

A bot egy külön, folyamatosan futó folyamat. Helyben az `npm start`, éles használatra pl. Render
**Background Worker** (a játék webszolgáltatásától külön) vagy egy VPS. A Render ingyenes csomagja
háttérfolyamatot nem futtat. A `/setup` egyszeri; utána a bot akár le is állítható, a szerver megmarad.

## Későbbi integráció a játékkal

`src/announcer.js` két kész függvényt exportál (a bot kliensét az `index.js` köti be):

```js
const { announceNewTrial, announceResult } = require('./announcer');
await announceNewTrial({ roomCode: 'ABCD', host: 'Józsi', mode: 'Vadak', joinUrl: 'https://…' });
await announceResult({ title: '🏆 Ítélet', description: 'A vádlott bűnös!' });
```

`announceNewTrial` a 🎮・játék-kereső és a 🔑・szobakódok csatornába küld „⚖️ ÚJ TÁRGYALÁS” embedet.
Mivel a bot külön folyamat, a játékszerver és a bot összekötése (pl. egy védett belső végpont) külön lépés,
és a játék jelenlegi kódjában nincs bekötve.

## Fejlesztés

```bash
npm run lint   # szintaxis + titokellenőrzés
npm test       # 33 offline teszt (setup + moderáció) memóriában élő hamis Discord-szerveren (nincs hálózat, nincs token)
```

## Hibaelhárítás

- **A parancsok nem jelennek meg**: a bot fusson, és olyan szerveren legyen, ahová a `applications.commands`
  scope-pal hívtad meg. Ha `DISCORD_GUILD_ID` be van állítva, csak ott működik.
- **„A botnak hiányzó jogai vannak”**: hívd meg újra a `npm run invite` linkkel (ugyanazt a szervert választva).
- **„A bot role-ja nem a legmagasabb”**: lásd 6/2.
- **Fórum helyett szövegcsatorna**: a szerver nem Community; lásd 6/1.
