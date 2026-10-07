# ⚖️ KAMU BÍRÓSÁG

Új belépés és regisztráció: [AUTH_BEALLITAS.md](AUTH_BEALLITAS.md). Az e-mailes fiókok önállóan működnek; a Google-, Discord- és jelszó-visszaállítási beállításokat ez az útmutató tartalmazza. Vendégként továbbra is lehet játszani.

Online multiplayer party játék 3–8 játékosnak, **Discord hanggal**.

A játék a tárgyalást vezeti le: kiosztja a szerepeket, megmutatja a vádat és a titkos kártyákat, méri, ki mennyi ideig beszélhet, és lebonyolítja a szavazást. A vádbeszéd és a védekezés **élőszóban, Discordon** zajlik – a játékban nincs se gépelés, se chat. A hangulat teljesen komolytalan, de "hivatalos" bírósági körítéssel – ráadásul **rendőrségi nyilvántartásos lobbyval**: körözési plakátokkal, bögrefotó-kártyákkal és futószalagos rendőrségi hírekkel.

## A lobby: rendőrségi faliújság

- **KI VAGY TE, GYANÚSÍTOTT?** – nem kell gépelni: a baráti társaság tagjai **bögrefotó-kártyákon** jelennek meg (magasságmérő csíkos háttér, névtábla, jelvény, titulus, eddigi számai). Rákattintasz, és ezzel a névvel lépsz be. Aki már bent van egy szobában, annak a kártyája szürke, **„MÁR ŐRIZETBEN"** pecséttel.
- **Új gyanúsított** – vendégek saját nevet írhatnak; ők „Ismeretlen tettes" titulust és random vicces priuszt kapnak.
- A bent lévők **KÖRÖZÉS – WANTED plakátokon** látszanak a faliújságon: név, jelvény, titulus, priusz, **vérdíj** (a pontszámból: pl. „3 lángos és egy sör"), és „Elítélve: Xx | Felmentve: Yx". Új plakát rajzszög-animációval tűződik fel, kilépő leesik. A legtöbbet elítéltnek **„KÖZELLENSÉG №1"** szalag jár, a házigazdának **„A TÁRGYALÁS VEZETŐJE"** pecsét. Pár plakátot **piros nyomozós fonál** köt össze.
- A játékmód-választó **ügyiratmappa**: „ÜGYSZÁM: MINECRAFT" stb., a kiválasztottakon piros **AKTÍV ÜGY** pecsét.
- A szobakód **„ÜGYIRAT SZÁMA"** dobozban van, mellette Discord-link másoló és **QR-kód**: a telefonnal beolvasva azonnal a szobába kerülsz (kattintásra nagyít).
- **AFK-védelem** is épül a menetbe: a vádemelés, a szavazás és a kihívás-szavazás **automatikusan lezárul** (2–3 perc), ha valaki nem reagál – az ítéletet a leadott szavazatok döntik el, a hiányzó kihívás-szavazatok nem teljesítettnek számítanak, így egy kiesett játékos nem állítja le az estét.
- Lent **futószalag** fut a véletlenszerű rendőrségi hírekkel a bent lévőkről („RENDKÍVÜLI: [név] ismét 'pill'-t írt…").

## Bűnügyi nyilvántartás (data/stats.json)

A szerver név szerint megjegyzi az előre megadott játékosokra: **hányiszor volt vádlott, hányszor bűnös, hányszor ártatlan, hány díjat nyert**. Ez a `data/stats.json`-be íródik, és a bögrefotókon + plakátokon jelenik meg. (Ha az ingyenes tárhely újraindul és a fájl elveszik, lenullázódik – ez nem baj.) Törlésed/zerozni a fájlt üres `{}`-re állítva tudod.

## A játék menete (minden kör)

1. **VÁDEMELÉS** – mindenki képernyőjén megjelenik az abszurd vád. Bárki megnyomhatja a „Felolvastam!" gombot.
2. **FELKÉSZÜLÉS (30 mp)** – az ügyész titokban **3 bizonyítékkártyát** kap, a vádlott **1 alibikártyát**, a védőügyvéd **2 trükkkártyát**. Ezeket csak ők látják!
3. **VÁDBESZÉD (60 mp)** – nagy felirat: „AZ ÜGYÉSZ BESZÉL" + visszaszámláló. „Végeztem" gombbal időt lehet spórolni.
4. **VÉDEKEZÉS (60 mp)** – ugyanígy, a vádlottal.
5. **VÉDŐÜGYVÉD (45 mp)** – 5+ játékosnál: a védőügyvéd trükkjeivel erősíti a védelmet.
6. **MEGLEPETÉS TANÚ (30 mp)** – egy esküdt titokban tanúkártyát kap, és ő dönti el, kinek segít. (A házigazda ki-be kapcsolhatja.)
7. **ZÁRÓSZÓ (20–20 mp)** – először az ügyész, aztán a vádlott.
8. **ÍTÉLET** – az esküdtek titkosan szavaznak: BŰNÖS vagy ÁRTATLAN. Dobpergés, kalapácsütés, majd a bíró kihirdeti az eredményt *és azt is, ki hogyan szavazott*.

> **AFK-védelem:** a fenti 1. (vádemelés) és a 8. (szavazás) lépés, valamint a kihívás-szavazás időzítővel is rendelkezik – lejáratkor automatikusan továbblép, az ítéletet a leadott szavazatok döntik el, a hiányzó kihívás-szavazat nem teljesítettnek számít.

## Extrák

- **TILTAKOZOM!** – az ellenfél a beszéd alatt tiltakozhat a másik beszéde közben: nagy animáció + hang, a beszédóra megáll, a beszélő 20 mp-ig védekezik, majd a kör bírója fixen 15 mp-en belül dönt. Jogos: a tiltakozó mindig +30 mp-et kap a következő saját beszédéhez. Nem jogos (vagy a bíró nem dönt időben): a tiltakozó a következő saját beszédének 30%-át elveszíti. Ha a tiltakozónak nincs több beszéde, nincs hatása; a megszakított beszélő ideje nem változik. Játékosonként beszédfázisonként 1, körönként legfeljebb 2 tiltakozás.
- **Reakciógombok** az esküdteknek (😂 💀 🤡 🔥 👏) – az emoji átrepül mindenki képernyőjén. A legtöbb 😂-t kapó beszélő **Közönségkedvenc** bónuszt kap.
- **Kihíváskártyák** – ügyész és vádlott titkos beszéd-kihívást kap („Suttogva beszélj", „Használd a 'pogácsa' szót háromszor"…). Alapból a kör bírója dönt, kihívásonként 20 mp alatt; időtúllépés = nem sikerült. Teljesítés +2, nehezítés +4 pont. Az esküdtek szavazása a lobbyban választható.
- **„Rendet a teremben!"** – csak a kör bírója használhatja, kalapácsütéssel.
- **Hang- és képi visszajelzés az ítéletnél** – a kalapácsütés után a BŰNÖS lehangoló akkordot, vörös villanást és rázkódást, a FELMENTÉS csillogó dúr futamot, zöld villanást és szálló békegalambokat kap (egyhangú ítéletnél fanfár is); a szavazógomb kattintásra visszajelez. A **hang-némítás** és a **„kevesebb mozgás"** kapcsoló a játékban az info-sávban, a névválasztón/menün/lobbin a bal felső sarokban érhető el, közös állapotot (`kb_muted`, `kb_reducedMotion`) használnak; kevesebb mozgásnál a rázkódás, galambok és konfetti elmaradnak, a hang marad.
- **Vicces ítéletek** – bűnösség esetén 60-féle büntetés („3 hónap közösségi munka egy kacsaúsztatóban"), felmentés esetén gyanakvó felmentő szövegek.
- **Bírósági jegyzőkönyv** – minden tárgyalás után letölthető PNG-kép, amit be lehet dobni a Discordra.
- **Játék vége** – ranglista, konfetti és díjak: A legjobb ügyvéd, A legnagyobb bűnöző, Közönségkedvenc, Kihívás bajnok. + „Új tárgyalás" gomb.

## Tartalom – data/cards.json

A teljes tartalom (vádak, kártyák, kihívások, büntetések) a **[data/cards.json](data/cards.json)** fájlban van, játékmódok szerint rendezve. A kódban nincs beégetett tartalom – új kártyát ott tudsz hozzáadni.

### Játékmódok

- **R.E.P.O.**, **CS:GO/CS2**, **PUBG**, **Minecraft**, **Roblox és ingyenes játékok**, **Buli**
- A házigazda a lobbyban több módot is bejelölhet, és van **VEGYES** gomb (mindet bejelöli) – több mód esetén körönként sorsolódik, melyik vezeti a tárgyalást.
- A kiválasztott módon belül minden szerep csak az ahhoz a módhoz tartozó kártyákat kapja.
- A **„Minden módban használható kihívások"** (`altalanos` blokk) bármelyik módhoz hozzákeverednek; a **nehezítések** ritkábban jönnek (kb. 20% eséllyel) és **dupla pontot** érnek.
- A `[játékos]` jelölés helyére véletlen másik játékos (sosem a vádlott) neve kerül, a `[vádlott]` helyére a vádlotté.
- Ha egy mód kártyái elfogynak, a pakli automatikusan újrakeveredik.

### Új játékos (barát) hozzáadása a nyilvántartáshoz

Nyisd meg a `data/players.json`-t, és vegyél fel egy új bejegyzést a `players` tömbbe:

```json
{
  "nev": "ÚjBarát [KLUB]",
  "jelveny": "KLUB",
  "titulus": "A titokzatos újonc",
  "priusz": "Amit tett, azt nem mondjuk el itt."
}
```

- `jelveny` lehet üres string (`""`), ha nincs.
- A `priusz` a plakáton kézzel írt jegyzetként jelenik meg.
- A statisztikáját (elítélve/felmentve) a játék magától kezdi számolni a `stats.json`-ben, a név alapján.
- Újraindítás (`npm start`) után már választható a bögrefotóképernyőn.
- Priusz-sablonok a vendégeknek: a `vendeg_priuszok` lista ugyanebben a fájlban.

### Új kártya hozzáadása

Nyisd meg a `data/cards.json` fájlt, és írd az új szöveget a megfelelő mód listájába. Példa:

```json
"minecraft": {
  "vadak": [
    "Felgyújtotta [játékos] házát, mert \"csak meg akarta nézni, ég-e a fa\".",
    "IDE ÍRD AZ ÚJ VÁDAT"
  ]
}
```

- A módok kulcsai: `repo`, `cs`, `pubg`, `minecraft`, `roblox`, `buli`, és az `altalanos` (közös kihívások + nehezítések).
- Minden módhoz tartozhat: `vadak`, `bizonyitekok`, `alibik`, `trukkok` (védőügyvéd), `tanuk`, `kihivasok`, `buntetesek`.
- Indítsd újra a szervert (`npm start`) a módosítás után.
- A szövegekben a `[játékos]` és `[vádlott]` helyőrzőket használhatod.

### Napi küldetések és bolt

- **Pénznem:** pogácsa 🍪, a fiók pénztárcájában (`user.shop` a fiókfájlban / az adatbázisban). Csak bejelentkezett fiók kaphat jutalmat.
- **Küldetések:** `data/quests.json` (három szint: könnyű 40, közepes 70, nehéz 120 pogácsa, szintenként 12 sablon; a napi bónusz +50, a `bonusJutalom`). A `quests.js` a naptári nap (Europe/Budapest) alapján, determinisztikusan, a `2026-01-01` kezdőnaptól számolva választ: naponta 3 küldetés, bármelyik napra (365 napra és tovább) előre kiszámolható; a legrégebben használt sablon kerül sorra, így egyenletesen forognak, egymást követő napokon nincs ismétlés, és egy napon belül nincs két azonos mérőszám. A haladást a szerver a játékból számolja (`daily` számlálók a `stats.json`-ben).
- **Bolt:** `data/shop.json` (tárgyak: kártyakeret, kártyaháttér, névhatás, pecsét, felirat; ár, ritkaság). Új tárgyhoz: vegyél fel egy bejegyzést a `targyak` tömbbe (a keretek, hátterek és névhatások CSS osztálya `cos-frame-<név>`, `cos-bg-<név>`, `cos-name-<név>` a `public/style.css`-ben; a pecsét és a felirat `text` mezője a megjelenő szöveg).
- **Szezonális tárgyak:** a `targyak` bejegyzésén `"szezon": "<azonosító>"`, a szezonokat a `szezonok` tömb írja le (`tol` / `ig`: `"HH-NN"`, minden évben ismétlődik, az évhatáron átnyúló is jó, pl. `12-15` … `01-06`). Szezonon kívül a tárgy nem vehető és nem ajándékozható (a szerver dönt, `seasonInfo` a `shop.js`-ben); a már megvett tárgy megmarad. Jelenleg: Halloween (okt. 20 – nov. 2: `frame_pumpkin`, `bg_haunted`), Karácsony (dec. 15 – jan. 6: `frame_holly`, `bg_snowfall`).
- **Ajándékozás:** `POST /api/shop/gift { friendId, itemId }` – csak kölcsönös barátnak, a küldő fizeti az árat, a tárgy a barát tulajdonába kerül (egy mentésben), ha neki még nincs meg; naponta legfeljebb 5 ajándék. A barát privát üzenetet (`🎁 Ajándékot küldtem neked: …`) és `gift_received` értesítést kap.
- **Biztonság:** a vásárlás, felvétel és jutalom-átvétel a szerveren dől el (`shop.js`); a többi játékoshoz csak a ténylegesen megvásárolt, felvett tárgy jut el, a szerver a bejelentkezett fiók alapján teszi a profilra.
- **Tesztek:** `npm run test:shop` (a `test/rules.js` is futtatja).

### Barátlista

- **Kapcsolatok:** a fiókban (`user.social`: barátok, beérkező/elküldött kérések, letiltottak, láthatóság). A fiókfájllal együtt mentődnek (és kerülnek a külső adatbázisba), a kérések offline állapotban is megmaradnak.
- **Online állapot:** memóriában (`social.js`), a socketekből. A socket a bejelentkezett fiókjával egy rövid életű, egyszer használható jeggyel azonosítja magát (`POST /api/friends/ticket`, majd `identify` socket-esemény), mert a süti a socket létrejöttekor rögzül. Ugyanez adja a bolt-tárgyak és a `profile.acct` jelző hitelességét. A barát állapota a láthatósági beállítása szerint szűkített: `all` (online + szoba), `online` (csak online), `hidden` (offline-nak látszik).
- **Valós idejű frissítés:** `friends_refresh` socket-esemény a barátoknak, ha valaki online lesz/kilép/szobát vált; `friend_invite` a szobai meghívó (csak lobbiból, csak barátnak, 15 mp-es korlát).
- **Végpontok:** `/api/friends/` `state`, `ticket`, `request`, `accept`, `decline`, `cancel`, `remove`, `block`, `unblock`, `settings` (mind bejelentkezést kér, JSON + eredet-ellenőrzés, sebességkorlát). Limitek: 100 barát, 30 függő kérés, 100 letiltott.
- **Privát üzenetek:** csak kölcsönös barátok között (`GET /api/friends/dm/:userId`, `POST /dm/send`, `POST /dm/read`; `dm_msg` / `dm_sent` socket-esemény). A tároló a `dms.js` (`data/dms.json`, beszélgetésenként az utolsó 60 üzenet, olvasási jelölők); mentés után a külső adatbázisba is feltöltődik (`dms` dokumentum), így újraindítás után is megvan. 500 karakter, vezérlő- és bidi-karakterek kiszedve (`textclean.js`), 0,7 mp köz. A barátság megszűnésekor (eltávolítás / letiltás) a beszélgetés törlődik.
- **Online értesítés:** ha egy barát offline → online lép (és nem láthatatlan), a barátai `friend_online` eseményt kapnak, ha be van kapcsolva (`notifyOnline`, alapból igen). Újracsatlakozásokra 5 percig nem szólunk újra.
- **Tesztek:** `npm run test:social` és `npm run test:dm` (valódi szerver, HTTP + socket); a `test/rules.js` is futtatja.

### Ranglista (heti és összesített)

- **Végpont:** `GET /api/leaderboard?period=heti|osszes&metric=pont|gyozelem|artatlan|kihivas|jatek&me=<név>` (nyilvános, csak olvasható, percenként 60 kérés / cím). Válasz: a top 20 (helyezés, név, érték, `legend` jelző), a `me` név helyezése akkor is, ha nincs az élmezőnyben, a hét kezdete és a heti nullázásig hátralévő idő.
- **Számok:** a statisztika (`data/stats.json`, név szerint) mellé minden esemény a heti számlálót is növeli (`weekly: { week, counts }`, a hét hétfőtől vasárnapig tart, Budapest szerint); új héten a régi számok már nem számítanak. A logika a `leaderboard.js` tiszta modulban van (azonos érték: a kevesebb játékkal elért előz, egyenlők azonos helyezést kapnak). Csak a saját mutató-kulcsok érvényesek (`__proto__` stb. nem).
- **Kliens:** `public/ranking.js` (🏆 RANGLISTA gomb a profilnál). **Tesztek:** `npm run test:leaderboard`.

### Fiók a legendás tesztelőknek (igénylő-link)

Minden legendás tesztelő a saját kártyájához kapcsolt fiókot kaphat: egy egyszer használható **igénylő-linket** küldesz neki, megnyitja, a saját e-mail címével és jelszavával regisztrál, és a fiókja a legenda pontos nevén jön létre (a név, a keret, a háttér és a statisztika az övé). A jelszavakat te sem látod.

1. **Titok beállítása a tárhelyen:** a Renderen egy új környezeti változó: `LEGEND_SECRET` = egy hosszú, véletlen szöveg (legalább 16 karakter). Ezt csak te ismered, ne commitold, ne oszd meg.
2. **Linkek előállítása a gépeden** (ugyanazzal a titokkal):
   ```powershell
   $env:LEGEND_SECRET = '<a titok>'; node scripts/legend-links.js https://test-1-ndkt.onrender.com
   ```
   A szkript mind a 12 legendának kiír egy linket (`/?legend=<név>&claim=<kód>`). A kód a titokból és a névből számolt HMAC, a szerver újraszámolja, nincs tárolt kód.
3. **A tesztelő** megnyitja a linkjét → a regisztrációs űrlapon a neve zárolva van, megadja az e-mailjét és jelszavát → kész. Egy legendát egyszer lehet igényelni. Az igényelt kártyát attól kezdve csak a gazdája használhatja (bejelentkezve); a névválasztón mások számára „A GAZDÁJÁÉ” felirattal zárolt. A neve nem módosítható, a vicces szövegei igen. Később Google/Discord is összekapcsolható a fiókhoz.
4. **Tesztek:** `npm run test:claims`.

### Csevegő és névszabály

- **Csevegő:** `chat_send` socket-esemény (csak szobában), a szoba tagjai `chat_msg`-ként kapják. A szerver az utolsó 80 üzenetet tartja a szoba memóriájában (`game.chatLog`), belépéskor/újracsatlakozáskor a join válasz `chat` mezője hozza. Szűrés: 280 karakter, vezérlő- és irány-átíró karakterek kiszedve, 4 üzenet / 6 mp, azonos üzenet 4 mp-en belül nem ismételhető. A kliens mindent szövegként (escape-elve) jelenít meg. A bejelentkezett játékos letiltottjának üzenete nem megy neki (élőben és az előzményben sem), az ilyen szűrés szerveren történik, a belső fiók-azonosító nem kerül ki.
- **Közös tér (globális csevegő + hirdetőtábla):** `board_sub` (feliratkozás: előzmény + aktuális hirdetések), `board_send`, `board_ad`, `board_ad_remove`; `board_msg` / `board_ads` jönnek vissza. A közös téren használt nevet a szerver adja (szobában a játékos neve, bejelentkezve a fiók neve, vendégnél a szabad megadott név; legenda nevén vendég nem írhat). A hirdetés a hirdető szobájának kódját teszi közzé (a kódot a szerver adja): csak lobbiból, szobánként egy, 3 percenként egy hirdetés / fiók, legfeljebb 20 percig él, és lekerül, ha a szoba elindult, megtelt vagy kiürült. Üzenetkorlát: 240 karakter, 1,5 mp köz, 6 üzenet / 30 mp. Az utolsó 100 üzenet a memóriában él.
- **Elhelyezés (kliens, `public/chat.js`):** lebegő panel (névválasztó, menü, keskeny lobbi), dokkolt (lobbi, ≥1560 px: a tartalom odébb tolódik, nem takar), beágyazott (játék: a ponttábla-oldalsáv CSEVEGŐ füle).
- **Névszabály (szerver, `nameProblem` a `server.js`-ben):** regisztrált játékos nevét csak a bejelentkezett tulajdonosa használhatja; a nyilvántartott (legendás) nevek csak pontosan, a kártyájukkal; a kis/nagybetűs, ékezet-egyesített változat tilos (`kyrashi`, `KYRASHI`); a vendég-névmezőbe a legenda pontos neve sem írható (`check_name` + `guest`). A szobában a nevek eleve egyediek. A szabály `create_room` / `join_room` (új belépő) esetén is érvényes, nem csak a kliensben.
- **Tesztek:** `npm run test:chat` (a `test/rules.js` is futtatja).

### Védőügyvéd

5 vagy több játékosnál a körben megjelenik a **védőügyvéd**: 2 titkos trükkkártyát kap, a vádlott után **45 mp-et** beszél, és **ártatlan ítéletnél ő is pontot kap** a vádlottal együtt.

### Üzemeltetés: hibanapló, mentések, admin oldal

- **Hibanapló** (`errorlog.js`): a váratlan hibák (socket-kezelők, HTTP-útvonalak, nem elkapott kivételek, sikertelen adatbázis-mentés / levélküldés) és a böngészőben elkapott hibák (`public/report.js` → `POST /api/client-error`, percenként 8 jelentés IP-nként) egy bejegyzésbe vonva, darabszámmal. Fajtánként 50 bejegyzés; az e-mail címek, hosszú tokenek és adatbázis-címek kimaradnak. Fájl: `data/errors.json` (`KB_ERRORS_FILE`), és az adatbázisban is megmarad.
- **Admin oldal** (`/admin`, `admin.js`): az `ADMIN_TOKEN` környezeti változó (legalább 24 karakter) bekapcsolja; nélküle 404. Áttekintés, hibák, mentések, próbalevél, kézi jelszó-visszaállító link. Rossz tokennel 10 próba / 10 perc.
- **Adatbázis-mentés**: naponta egy pillanatkép a Neonban (`kb_backup`, a legutóbbi 14 marad), `npm run db-backup` helyi másolathoz, `npm run db-restore` visszaállításhoz – részletek a **[TAROLAS.md](TAROLAS.md)**-ben.
- **Jelszó-visszaállító levél**: Resend; a beállítás lépései az **[AUTH_BEALLITAS.md](AUTH_BEALLITAS.md)**-ben. Levélküldés nélkül az admin oldalon kézi link készíthető.
- Teszt: `npm run test:ops` (17 ellenőrzés), a mentésekre a `npm run test:storage` (14).

### Visszaélés-védelem (mit ellenőriz a szerver, és mit nem hisz el a kliensnek)

- **Kiléted a szerver tudja:** minden játékeseményt a socket szerver-oldali munkamenetéhez kötött `playerId` alapján dönt el, a kliens csak a kérést küldi. Szavazni csak a kör szavazó-esküdtjei tudnak, **egyszer** (a szavazat végleges); a kihívást és a tiltakozást csak az adott ügy bírója dönti el; indítás, beállítás, kirúgás, bot, továbblépés csak a házigazdáé; „Rendet a teremben" csak a körbíróé.
- **Ülés-átvétel:** egy játékos ülésére csak a szobától kapott munkamenet-token birtokosa térhet vissza. A botok ülését senki nem veheti át, és a kliens nem adhat magának `bot_` azonosítót.
- **Mass assignment:** a kliens profiljából csak a vicces cím, a priusz és a jelvény fogadható el; a fiók-jelzést, a kozmetikumokat és a legenda-kereteket kizárólag a szerver állítja (azonosított fiók alapján). A beállítások és a saját vádak fertőtlenítve, határok közé szorítva érkeznek.
- **Sebességkorlátok:** 20 socket-esemény/mp kapcsolatonként; csevegő, közös tér, privát üzenet, ajándék, barátkérés, hibajelentés, ranglista, QR és admin-próbálkozás külön korláttal; reakciók ~4/mp játékosonként; az avatár-mentés 3 mp-enként.
- **Szoba- és kapcsolat-spam:** egy címről egyszerre legfeljebb 6 szoba (`MAX_ROOMS_PER_IP`) és 60 nyitott kapcsolat (`MAX_SOCKETS_PER_IP`) lehet; a szándékosan elhagyott, üres lobbi-szoba azonnal megszűnik, így a szoba-spam nem tölti meg a 50 helyet.
- **Közönségkedvenc:** a beszélő (és a csapattársa) nevetése nem számít, más játékostól körönként egy beszélőnek legfeljebb 5 😂.
- **HTTP-fejlécek** (`security-headers.js`, minden válaszra): `Content-Security-Policy` (`script-src 'self'`: csak a saját szkriptek futnak, nincs inline szkript és eval; stílus inline is lehet, a betűtípus a Google Fontsról jön; kapcsolat csak a saját oldalra), `frame-ancestors 'none'` + `X-Frame-Options: DENY` (az oldal nem ágyazható be), `nosniff`, `Referrer-Policy`, `Permissions-Policy` (nincs kamera / mikrofon / hely / fizetés), HSTS csak HTTPS-en (fél év, aldomain nélkül). **Új külső szkriptet vagy inline `<script>`-et / `on…=` eseménykezelőt ne adj az oldalhoz**: a CSP letiltja (a `test/security.js` ezt ellenőrzi). Ha mégis blokkol valamit, a böngésző `securitypolicyviolation` jelzése az `/admin` hibalistájába kerül („CSP: …").
- **Titkok:** az API-kulcsok, az adatbázis-cím, az `ADMIN_TOKEN` és a `LEGEND_SECRET` csak a szerver környezeti változóiban élnek; a böngészőbe, a repóba és a naplóba nem kerülnek. A játék nem hív fizetős külső (AI) szolgáltatást, és nincs fizetés sem.
- **Adatbázis:** csak a szerver éri el (a kliens soha nem kapcsolódik közvetlenül a Neonhoz), ezért sorszintű hozzáférés-szabály (RLS) nem szükséges.
- **Adatvédelem – adatkérés és fiók-törlés** (a profil ablak FIÓK részében, a súgóban az ADATVÉDELEM szakasz írja le a felhasználónak):
  - `GET /api/account/export`: a bejelentkezett felhasználó saját adatai JSON-ban (fiók, barátok, bolt, statisztika, privát üzenetek); jelszó-hash, munkamenet és token nincs benne; 10 percenként legfeljebb 5 kérés.
  - `POST /api/auth/delete`: végleges törlés újra-azonosítással (jelszavas fióknál `password`, jelszó nélkülinél – Google/Discord – a felhasználónév begépelése: `confirmName`). Egy mentésben megszűnik a fiók, a munkamenetei és a tokenjei, és kikerül a többi fiók barátlistájából / kéréseiből / tiltásaiból; utána a `server.js` `onDelete` kezelője törli a privát üzeneteket (`dms.purgeUser`) és a névhez kötött statisztikát, bontja az élő kapcsolatokat, és frissíti a barátok listáját. A legendás kártya statisztikája megmarad (azt a kártyán játszott játékok adják), a legenda újra igényelhető. A Neon-pillanatképekben a törölt adat legfeljebb 14 napig még szerepelhet.
- Teszt: `npm run test:privacy` (9 ellenőrzés: adatkérés, törlés, barátok, üzenetek, statisztika, legenda, CSRF); `npm run test:security` (15 ellenőrzés: ülés-átvétel, szoba- és kapcsolat-spam, avatár, szavazat, nevetés, QR, fejlécek).

## Botokkal tesztelés

Egyedül is ki tudod próbálni a teljes játékot: a házigazda a lobbyban botokat adhat a szobához, és ők önállóan levezetik a tárgyalást.

- **🤖 Bot hozzáadása** – a lobbyban, csak a házigazda láthatja (max. 8 fő összesen, beleértve téged is). A botok rendőrségi plakátot kapnak **„🤖 TESZT-BOT"** pecséttel: *Robi, a Robot*, *Géza, a Gép*, *Szintetikus Sári* és *Kábeles Károly*.
- **🤖 Bot eltávolítása** – egyet kivesz a szobából (lobbi fázisban).
- A botok **mindent megcsinálnak helyetted**: felolvasják a vádat, tartják a beszédet, tiltakoznak, reagálnak, tanúnak állnak, szavaznak és leveszik a kihívás-szavazást is. Te csak nézed – vagy szólász be Discordon.
- A botok **nem íródnak be a `data/stats.json`-be**, és nem rontják el a barátaid számaiét.
- A botok szerveroldali játékosok: nem kell hozzájuk böngésző-ablak sem.

> Tipp: a leggyorsabb egyedüli teszt – hozz létre egy szobát, nyomj 3× **Bot hozzáadása**, majd **Tárgyalás indítása**. Az egész tárgyalás így is végigfut, amíg a botok időzítői engedik.

## Helyi futtatás

```bash
npm install
npm start
```

Ezután nyisd meg: **http://localhost:3000**

A port átírható: `PORT=8080 npm start`

### Tesztelés

```bash
npm test                  # nyilvántartás, vendég és játék/pontírás (18 ellenőrzés)
npm run test:rules        # 12 szabály- és időzítési tesztcsoport
npm run test:rooms        # valódi Socket.io: jogosultságok, kirúgás, kilépés
node test/e2e-bots.js     # 1 ember + 4 bot, 2 kör botokkal (22 ellenőrzés)
node test/stress-bots.js  # 6 teljes, háromkörös botjáték virtuális órával (3–8 fő)
npm run test:layout       # valódi böngésző (Playwright), 7 méret: átfedés, kilógás, hang/mozgás kapcsolók (kb. 2 perc)
```

A hálózati bot-teszt valós szerveren, valós időzítőkkel játszik két kört. A stresszteszt a valódi BotManager időzített műveleteit futtatja virtuális órával; mind a hat játékmódot és a 3–8 fős szobákat ellenőrzi.

A kész v3 karakter-PNG-k és a tárgyalóterem JPG/PNG háttere az `assets/` mappában van. A színpad ezekkel működik, külön beszélőképek és Python utómunka nélkül. A `GRAPHICS_V4.md` írja le a beépítést; a `CHANGES_V4.md` az elkészült javításokat, teszteket és a helyben ellenőrizendő böngészős elrendezést.

## Online üzem ingyen: Render.com

A projekt fel van készítve a [Render.com](https://render.com) **ingyenes Web Service**-ére (a gyökérben van egy `render.yaml` Blueprint is).

### 1. Töltsd fel a projektet GitHubra

```bash
git init
git add .
git commit -m "Kamu Bíróság – online üzem"
git remote add origin https://github.com/FELHASZNALONEV/kamu-birosag.git
git push -u origin main
```

A `.gitignore` kihagyja a `node_modules/`-t, a `.env`-et, a `data/stats.json`-t és a naplófájlokat – csak a forrás megy fel.

### 2. Hozd létre a Web Service-et a Renderen

1. Jelentkezz be a [dashboard.render.com](https://dashboard.render.com) oldalra, és kösd be a GitHub fiókod.
2. **New → Web Service** → válaszd ki a `kamu-birosag` repót.
3. Beállítások (a `render.yaml` is ezt tartalmazza):
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
   - **Health check path:** `/health`
4. **Create Web Service** – a Render lefuttatja az `npm install`-t, elindítja a szervert, és kb. 1–2 perc után megkapod az `https://kamu-birosag-xxxx.onrender.com` linket.
5. Környezeti változó **nem kötelező**. Ha mégis be akarnád állítani (Environment fül):
   - `PORT` – a Render automatikusan beállítja, ne írd felül.
   - `ALLOWED_ORIGIN` – csak akkor kell, ha egy KÜLÖN domainről is engedélyeznéd a csatlakozást (alapban csak a saját oldal – azonos eredet – engedélyezett).

### 3. Oszd meg a linket

A kapott `https://…onrender.com` linket dobd be a Discord szobába. A szobakód link (`?room=XXXX`) is ezen a domainen működik.

### 4. Amit az ingyenes csomagról érdemes tudni ⚠️

- **Alvás:** kb. **15 perc inaktivitás** után a Render leállítja a szervert. Az első látogató **kb. 30–60 mp-et vár**, míg újraindul. Játék előtt nyissa meg a linket a házigazda, várja meg, míg betölt, és utána hívja be a többieket.
- **Újraindulás = szobák elvesznek:** a szobák a memóriában élnek, így a szerver alvás/újraterelés után üresen indít. A játék közben megszakadó kapcsolatnál a kliens **automatikusan újracsatlakozik** („Kapcsolat megszakadt, újracsatlakozás…” sáv); ha a szoba már nem létezik, a kliens értelmes hibát kap („A szoba megszűnt, hozz létre egy újat!”) és vissza tud lépni a menübe.
- **A lemez ideiglenes:** a fiókok, a statisztika (`data/stats.json`) és az avatárok újraindításkor elveszhetnek. Tartós tárolásra a `DATABASE_URL` megadásával egy ingyenes külső Postgres használható, lásd **[TAROLAS.md](TAROLAS.md)**.
- **Frissítés (deploy):** minden `git push` után a Render újraindítja a szervert – **a futó játékok megszakadnak**. Frissítést érdemes játék szünetében tenni.
- **Alacsony processzor-limit:** az ingyenes példány lassabban ébred, és nagy terhelésnél lassíthat – 8 fős társasjátékhoz bőven elég.

## Feltöltés ingyen: Railway

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**.
2. A Railway automatikusan felismeri a Node.js projektet (`npm start`).
3. **Settings → Networking → Generate Domain** – ezzel a linkkel lehet csatlakozni.

> A `PORT` környezeti változót a platform adja – a kód ezt automatikusan kezeli. Az adatbázis nélküli, fájlalapú tárolás miatt a Railway-n is érvényes a fenti „ideiglenes lemez” megjegyzés a `data/stats.json`-re.

## Hogyan játszd Discordon?

1. Nyiss egy Discord hangcsatornát, és mindenki csatlakozzon hanggal.
2. A házigazda indít egy szobát, a 4 betűs kódot vagy a linket beírja a Discord szobába.
3. Mindenki a telefonján/gépén nyitja meg a linket, becenév + avatar, csatlakozás.
4. A házigazda beállít (beszédidők, körök, tanú, kihívások) és elindítja a tárgyalást.
5. A képernyő mutatja, **ki beszél és mennyi ideje van** – a beszéd élőszóban megy a Discordon.

## Technikai felépítés

- **Backend:** Node.js + Express + Socket.io
- **Frontend:** sima HTML/CSS/JavaScript (nincs build lépés)
- **Minden játéklogika szerveren fut:** időzítők, szerepkiosztás, titkos kártyák, szavazás, pontozás. A titkos kártyák csak az adott játékos böngészőjébe kerülnek – a többiek state-jében soha nem utaznak.
- **Visszacsatlakozás:** a kliens saját azonosítót és privát munkamenetkulcsot használ. 20 mp-en belül megtartja a szerepét, utána átadás történik, legalább 15 mp hátralévő idővel. A pontok a kilépő nevén megmaradnak. Hostátadás: 30 mp.

```
kamu-birosag/
├── server.js          # Express + Socket.io szerver, szobák, bot-események
├── game.js            # játékmotor: fázisgép, időzítők, pontozás
├── bots.js            # BotManager: a botok viselkedése (beszéd, szavazás, tiltakozás)
├── data/
│   ├── cards.json     # vádak, kártyák, kihívások, büntetések játékmódok szerint (hu)
│   ├── players.json   # a baráti társaság: név, jelvény, titulus, priusz
│   └── stats.json     # bűnügyi nyilvántartás (automatikusan íródik)
├── public/
│   ├── index.html     # UI képernyők
│   ├── style.css      # rendőrségi nyilvántartás stílus
│   └── client.js      # kliens logika, hangok, animációk
└── test/
    ├── e2e.js         # teljes játék 4 virtuális játékossal
    ├── e2e-bots.js    # teljes játék botokkal (1 ember + 4 bot)
    └── stress-bots.js # bot-megbízhatósági szimuláció (6 futás)
```
