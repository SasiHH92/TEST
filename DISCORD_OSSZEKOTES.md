# Kamu Bíróság ↔ Discord összekötés

A webes játék és a Discord bot **ugyanannak a rendszernek két felülete**. A backend (`courts.js`) a hiteles forrás:
a jelentkezők, a sorsolt szerepek és az állapot ott élnek. A Discordon és a weben látható minden adat innen jön.

```
KAMU BÍRÓSÁG WEB ──► BACKEND (courts.js, data/courts.json ⇄ Neon) ◄──► DISCORD BOT ──► Discord játékosok
        ▲  socket.io `court_update`        │  SSE /api/bot/stream + REST /api/bot/*
        └──────────────────────────────────┘
```

## Mi változott

| Fájl | Változás |
|---|---|
| `courts.js` (új) | tárgyalás-munkamenetek, állapotgép, fair szerepsorsolás, Discord↔Kamu kapcsolatok, események |
| `courts-api.js` (új) | webes végpontok (süti-bejelentkezés) + bot végpontok (szolgáltatás-token) + SSE |
| `server.js` | bekötés: `courts`, szoba-híd (`courtRooms`), életciklus-horog, `player.userId` (csak szerver tölti), indítás sorsolt szerepekkel |
| `game.js` | **3 kis, visszafelé kompatibilis horog**: `Game.setLifecycleHook`, `takePresetRoles` (csak az 1. körre, érvénytelen megadásnál a régi sorsolás fut), `emitLifecycle` (indul / vége / lobbiba tört / megszűnt) |
| `storage.js` | új tároló kulcs: `courts` (`data/courts.json`, a `DATABASE_URL`-es Neon `kb_store` táblába is feltöltődik) |
| `auth.js` | `directory.byProvider` (csak olvasás: Discord-belépéssel kötött fiók felismerése) |
| `public/courts.js`, `courts.css`, `index.html` | lobbi-panel (jelentkezők, szerepek, állapot, Discord-kapcsolat) + „Discord összekötés” doboz a menüben |
| `discord-bot/src/backend.js`, `court.js` (új) | backend-kliens + SSE; panel, gombok, role-ok, `/kapcsol` |
| `discord-bot/src/index.js`, `commands.js` | bekötés, új `/kapcsol` parancs |

A játékmenet, a pontozás és a meglévő végpontok **nem változtak** (a teljes meglévő tesztcsomag lefut).

## Adatbázis-migráció

**Nincs séma-migráció.** A tárgyalások a meglévő `kb_store` (név → jsonb) táblában egy új sorként (`courts`) élnek.
Az első indításnál a `hydrate.js` „üres”-ként kezeli, mentés után feltöltődik. Régi verzióra visszaváltáskor a sor
egyszerűen figyelmen kívül marad. Napi Neon-pillanatkép (`kb_backup`) a `courts` sort is tartalmazza.

## Végpontok

Webes (bejelentkezés kell; POST-nál JSON + azonos eredet):

| Végpont | Jog |
|---|---|
| `GET /api/discord/link` | saját kapcsolat állapota |
| `POST /api/discord/link/start` | egyszer használatos, **10 perces** 8 karakteres kód |
| `POST /api/discord/link/remove` | kapcsolat bontása |
| `POST /api/court-sessions` `{roomCode}` | csak a szoba házigazdája |
| `GET /api/court-sessions/mine`, `/by-room/:code`, `/:id` | bejelentkezett felhasználó |
| `POST /api/court-sessions/:id/join` · `leave` | bárki (fiókkal) |
| `…/lock` · `unlock` · `draw` · `start` · `finish` · `cancel` · `rebind` | a tárgyalás vezetője |

Bot (`Authorization: Bearer <BOT_SERVICE_TOKEN>`, előtag `/api/bot`): `GET /stream` (SSE), `GET /sessions`,
`GET /sessions/:id`, `POST /sessions/:id/{join,leave,lock,unlock,draw,start,finish,cancel}`
`{discordUserId, discordUsername, staff, requestId}`, `POST /sessions/:id/{panel,announce,applied-roles}`, `POST /link`.

## Hogyan kommunikál a Discord ↔ backend

1. **Gomb a Discordon** → bot → `POST /api/bot/sessions/:id/<művelet>` `{discordUserId, …}`.
2. A **szerver** a Discord-azonosítóból oldja fel a Kamu-fiókot (kapcsolat vagy Discord-belépés). A bot által küldött
   felhasználó-azonosítót a szerver figyelmen kívül hagyja. Nincs kapcsolat → `409 not_linked`, a bot útmutatót küld.
3. A szerver ellenőrzi a jogot (vezető / stáb) és az állapotgépet, módosít, menti, és **eseményt** ad.
4. Az esemény két helyre megy: **socket.io `court_update`** (a szoba és a jelentkezők fiók-szobája → a web azonnal frissül,
   újratöltés nélkül) és **SSE** a botnak. Az SSE csak „kopogtat”: a bot a friss állapotot kérdezi le és ahhoz igazítja a
   panelt, a role-okat. Újracsatlakozáskor és percenként teljes egyeztetés is fut, ezért elveszett esemény nem okoz eltérést.
5. **Web → Discord**: a weben indított/befejezett/lemondott tárgyalás ugyanígy eseményt ad, a bot átírja a panelt, üzenetet küld.
6. A **játékszoba** a játék indulásáról/végéről szól a tárgyalásnak (horog): weben indított játék is `IN_PROGRESS`-re állít.

Események: `COURT_SESSION_CREATED`, `PLAYER_JOINED`, `PLAYER_LEFT`, `SESSION_LOCKED/UNLOCKED`, `ROLES_ASSIGNED`,
`ROLES_CLEARED`, `SESSION_STARTED`, `SESSION_FINISHED`, `SESSION_CANCELLED`, `SESSION_REBOUND`.
Állapotok: `WAITING → LOCKED → DRAWING → READY → IN_PROGRESS → FINISHED`, bármelyik élőből `CANCELLED`.

## Szerepsorsolás

3 fő: Bíró, Ügyész, Vádlott. 4 fő: + Tanú. 5+ fő: + Védőügyvéd. A többiek Esküdtek (max. 8 fő).
Fair: a szerepet az kapja, akinek eddig a legkevesebbszer volt, döntetlennél akinek az előző szerepe más volt, végül véletlen
(`crypto.randomInt`). A statisztika (`roleStats`) csak elindult tárgyalás után frissül. A sorsolás **idempotens** (második
kattintás nem sorsol újra), újrasorsolás csak a vezetőnek, READY állapotból (`force`).

**Az 1. kört a motor a sorsolt szerepekkel játssza** (bíró, ügyész, vádlott, védő, tanú); a következő körökben a játék
saját, kör-alapú forgatása dönt (ahogy eddig), de tudja, ki mit játszott az 1. körben. A Discord-role-ok az 1. kör szerepei.

## Egyidejűség, újraindítás

* Minden módosítás egy szinkron lépés (`transact`), a Node egyszálú → két egyszerre érkező kérés sorban fut, a második
  érvénytelen lépést az állapotgép elutasítja (nincs dupla szerep, dupla indítás, túlcsordulás). A `requestId` (a Discord
  `interaction.id`) ismételt kérésre az eredeti választ adja. **Feltétel: egyetlen webes példány** (a Render ingyenes
  csomagja ilyen). Több példányhoz sor-szintű adatbázis-zárolás kellene.
* **Bot újraindul:** semmi nem vész el; a panel azonosítója, a jelentkezők, szerepek, „alkalmazott role-ok” a backendben
  vannak. Az új bot ugyanazt a panelt szerkeszti (ha törölték, újat tesz ki), és a role-okat is rendbe teszi.
* **Web újraindul / telepítés:** a tárgyalások a fájlból/Neonból visszatöltődnek; a bot SSE-je újracsatlakozik és egyeztet.
  A **játékszobák memóriában élnek** (ez eddig is így volt), ezért a telepítés a szobát megszünteti. A tárgyalás
  (jelentkezők, szerepek, Discord-panel) megmarad: a vezető új szobát nyit, és a lobbiban az **„Ehhez a szobához kötöm”**
  gombbal köti hozzá (`rebind`), a panel az új szobakódot mutatja. Új Discord-lobbit nem kell nyitni.
* Elavult élő tárgyalás 6 óra inaktivitás után lemondódik; lezárt tárgyalás 30 nap után törlődik.

## Biztonság

* A bot **nem admin**: csak a `/api/bot/*` végpontokat éri el, szolgáltatás-tokennel (időzítés-biztos összehasonlítás;
  token nélkül a Discord-integráció ki van kapcsolva, `503`). Nincs általános admin-hozzáférés, a fiókokhoz sem.
* Minden Discord-művelet: szerveroldali Discord-ID → kapcsolt Kamu-fiók → jog (vezető / bot által hitelesen jelzett stáb) →
  állapot. A kliens `staff`/`isAdmin` mezője a webes végpontokon **nem számít**.
* Fiók-összekötés: egyszer használatos, 10 perces kód, a kód a weboldalon bejelentkezve keletkezik, a Discordon a `/kapcsol`
  használja el. Más Discord-fiókot username alapján nem lehet hozzákötni; egy Discord csak egy Kamu-fiókhoz, egy fiók egy
  Discordhoz tartozik. Az elsődleges azonosító a **Discord ID** (a username csak címke). A korábbi „Belépés Discorddal”
  (OAuth) is kapcsolatnak számít. Fiók törlésekor a kapcsolat és a jelentkezések is törlődnek.
* A weboldal soha nem kapja meg a Discord-azonosítókat. A tokenek nincsenek a kódban/Gitben (`.env`, Render Environment).
* Staff/admin Discord-role-hoz a bot nem nyúl: csak a `Kamu | …` nevű, jog nélküli, a bot role-ja alatti role-okat adja/veszi.

## Környezeti változók

| Változó | Hová | Érték |
|---|---|---|
| `BOT_SERVICE_TOKEN` | **Render webszolgáltatás** (Environment) **és** a bot `.env`-je | ugyanaz a véletlen titok, ≥ 32 karakter. Generálás: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BACKEND_URL` | a bot `.env`-je | `https://test-1-ndkt.onrender.com` |
| `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID` | a bot `.env`-je | a Developer Portalról (lásd `discord-bot/README.md`) |
| `KAMU_GAME_URL` | a bot `.env`-je | a játék címe (a panel linkjéhez); alapból a `BACKEND_URL` |
| `KB_COURTS_FILE` | opcionális, csak fejlesztés/teszt | alapértelmezett: `data/courts.json` |

A Render webszolgáltatásnak **csak** a `BOT_SERVICE_TOKEN` az új változója.

## Kell-e külön bot-szolgáltatás?

**Igen, a bot külön, folyamatosan futó folyamat.** A játék Render webszolgáltatása nem futtathat Discord-botot a
kérések mellett megbízhatóan (az ingyenes csomag alszik). Lehetőségek: **Render Background Worker** (fizetős, a
`discord-bot` mappából: build `npm install`, start `npm start`), egy VPS vagy a saját gép (`npm start`). A `/setup` egyszeri;
a tárgyalás-integrációhoz a botnak futnia kell. Ha a bot áll, a web működik tovább, a Discord-panelek az újraindulás után
(az első egyeztetéskor) beállnak a pillanatnyi állapotra.

## Discord Developer Portal

* **Intents:** semmilyen privilegizált nem kell (a bot egyetlen intentje: `Guilds`). A tagok lekérése egyenként (REST) történik.
* **Jogok:** változatlanul a `npm run invite` listája (Manage Roles, Manage Channels, View Channels, Send Messages, Send Messages
  in Threads, Embed Links, Read Message History, Manage Threads, Attach Files, Add Reactions, Connect, Speak). Új jog nem kell.
  A bot role-ja legyen a lista **tetején** (különben a `Kamu | …` role-ok nem adhatók ki; a bot ezt naplózza).
* Az új `/kapcsol` parancs a bot következő indításakor automatikusan regisztrálódik.

## Kézi teendők

1. `BOT_SERVICE_TOKEN` generálása, beírása a Render Environmentbe **és** a `discord-bot/.env`-be, majd a Render újraindítása.
2. `BACKEND_URL` kitöltése a `discord-bot/.env`-ben, a bot újraindítása.
3. (Egyszeri) A Discordon: bot role-ja felülre; `/setup` (ha még nem futott).
4. Játékosonként: weboldal → menü → **Összekötés** → a kapott kódot a Discordon: `/kapcsol kod:<kód>`.
5. Tárgyalás: lobbi → **Discord-tárgyalás nyitása** → a 🎮・játék-kereső csatornában megjelenik a panel.
6. A tárgyalás vezetője a sorsolás után **nem indíthat**, amíg a sorsolt játékosok mind be nem léptek a szobába (a szoba
   kódját/linkjét a panel mutatja). A szoba beállításai (ügyiratmappák) a weben vannak; ha a Discordról indítják és nincs
   kiválasztott mód, a „GYORS JÁTÉK” (minden ügytípus) indul.

## Tesztek

```bash
npm run test:court   # 16 magteszt + 6 motor-teszt + 21 lépéses körút (valódi szerver + valódi bot-logika + hamis Discord)
cd discord-bot && npm test   # 13 setup-teszt
```

A körút-teszt lefedi: fiók-összekötés, panel megjelenése, jelentkezés (Discord → web, élő socket-eseménnyel), egyidejű
jelentkezés és sorsolás, jogosultságok, sorsolás → szerepek a weben és ideiglenes Discord-role-ok, indítás (a motor az 1. körben
a sorsolt szerepeket használja), befejezés (web → Discord: role-ok lekerülnek, panel lezárul), **bot-újraindulás**,
**webszerver-újraindulás** (telepítés) és az új szobához kötés.

**Amit nem tudtam ellenőrizni:** a valódi Discord API-t (a teszt hamis, memóriában élő szervert használ: a tényleges
jogosultság-hibák, rate limitek, az üzenet-szerkesztési korlátok csak éles használatban derülnek ki), a Render telepítését és
a böngészők közötti megjelenést Safari/telefonon.
