# Kamu Bíróság – elkészült javítások és ellenőrzések

Állapot: az 1–3. fázis kódjavításai és a 4. fázis kész PNG/JPG grafikáinak beépítése elkészült. A teljes projekt-ZIP tartalmazza a csatolt v3 képeket és a régi SVG-ket, `node_modules` nélkül. Az öt képernyőméret böngészős elrendezésellenőrzése továbbra is nyitott, mert ebben a környezetben nem indítható hozzá böngésző.

## 1. fázis – stabilitás

- Minden saját JS-fájl szintaxisa ellenőrizve. A szerver a nyilvántartás mind a 12 tagját visszaadja; a kliensben betöltési hiba, ÚJRA gomb és vendégbelépés szerepel.
- A mappák azonnal mentik a kiválasztott módokat, az indítás teljes beállítást küld. Üres/hibás módlista nem indít csendben Buli játékot. A kör kártyái a kiválasztott mód paklijából jönnek, a közös kihívások/nehezítések kivételével.
- Saját kilépési modal, azonosítók törlése, szándékos kilépés jelző, kliens időzítők leállítása és szerveroldali játékostörlés. A böngésző vissza gombja nem léptet ki véletlenül.
- Kompakt színpad/fázis/tartalom elrendezés, egymás melletti szavazógombok, keskeny képernyőn összecsukható ponttábla.

Nyitott: a névkártyák tényleges böngészős megjelenése és az összes fázis görgetés/vezérlő-takarás mérése az öt kért méreten. Ebben a környezetben nem volt futtatható helyi Chromium, a rendelkezésre álló böngésző pedig blokkolta a helyi oldalt. Ez nincs sikeres ellenőrzésként elszámolva.

## 2. fázis – játékszabályok

- Helyes szerepszövegek; alibi/tanúkártya/saját kihívás csak felkészüléskor. Ügyész: 3 bizonyíték végig; védő: ugyanaz a 3 bizonyíték és 2 saját trükk. Kör végi közös felfedés és kibővített PNG-jegyzőkönyv.
- A bíró szerepe körbeforog, egymás után nem ismétlődik, és nem beszélő. Csak ő kalapácsolhat, dönthet a kihívásról vagy tiltakozásról; a szerver is ellenőrzi.
- Kihívásonként 20 mp, lejáratkor nem sikerült; siker +2, nehezítés +4. A szórakoztató reakció nem ad kihíváspontot. Az esküdtes ellenőrzési mód megmaradt.
- Teljes tiltakozási menet: 20 mp védekezés, 15 mp bírói döntés, lejáratkor elutasítás, helyes 20 mp-es levonás és a megállított beszéd folytatása. Bírócsere újraindítja a döntési időt. Botbíró 3–8 mp után dönt.
- Esküdt +1 az egyező szavazatra, döntetlennél minden szavazó +1. Rendezett ponttábla, szerepcímkék, pontváltozás és átrendeződés animációja; állandó, kinyitható vádsáv.
- A játékleírás a jelenlegi bírói, kártya-, tiltakozási és automatikai szabályokat írja le.

Értelmezés: a bírót a beszélő szerepek előtt választjuk, hogy 3 játékosnál se legyen ismétlődés vagy szerepütközés. A tanú már a felkészülés alatt megkapja saját kártyáját.

## 3. fázis – szobakezelés

- Host által kért, szerveren ellenőrzött kirúgás; saját magát nem rúghatja ki. Az érintett értesül, kikerül a szobából, aktív játékba nem léphet vissza.
- 20 mp kiesés után minden szerep átadható nem szereplő esküdtnek, ugyanazokkal a kártyákkal. A beszéd hátralévő ideje marad, legalább 15 mp. A helyettes korábbi szavazata is kikerül.
- Korai reconnect megtartja a szerepet; a késői visszatérő nem veszi vissza az átadott szerepet. Hostátadás 30 mp után, a legrégebben bent lévőnek. A 20/30 mp-es időzítők egymástól függetlenek.
- Explicit kilépés azonnali törléssel és hostátadással. A kilépő pontja néven megmarad, a ranglistában szerepelhet, ugyanazzal a névvel visszatérve visszakaphatja.
- Pótolhatatlan vádlott/ügyész esetén körkihagyás; három fő alatt lobby. Pótolhatatlan bíró esetén is körkihagyás, így nem marad olyan menet, amelyben nincs jogosult döntő játékos. A pótolhatatlan tanú kimarad.
- Szerveren futó 5 mp-es automatikus továbblépés és új játék, alapból bekapcsolva; kézi hostlépés, ÚJ JÁTÉK MOST és MEGÁLLÍT. Új játékban pontok/rotáció/paklik nullázódnak, beállítások maradnak.
- Szobaesemények és személyes állapotok szobánként elkülönítve. Privát visszacsatlakozási kulcs védi a nyilvános játékosazonosítókat; ez nem kerül a többi játékos állapotába.

## 4. fázis – a kész v3 grafika beépítve

- A csatolt `kamu_assets_v3.zip` mind a 8 átlátszó karakter-PNG-je és a tárgyalóterem JPG/PNG párja az `assets/` mappába került, bájtról bájtra változtatás nélkül. A 13 régi SVG megmaradt, de a színpad nem használja őket.
- A JPG a háttér, `cover`, `50% 45%` igazítással, sötétítő réteg nélkül. Bíró x 49%, ügyész 14%, vádlott 50%, védő 64%, tanú 70%, esküdtek 82%-tól. A tanú a saját képén lévő pulpitussal látszik; a bíró alját clip-path takarja.
- 1,2× nagyított, szerepszínében világító beszélő; a többiek enyhén halványabbak. A bíró teljes fényerejű. Név/avatar címkék és legalább 14 px-es szerepchipek; a bíró felett egyetlen bírócímke és üzenetbuborék.
- Kódból hajtott lélegzés, bólogatás, 450 ms-os beszéd-pulzálás, szót átvételkor felpattanás, bírói kalapács-rázkódás és 0,8 mp-es reakcióbuborék. A mentett Mozgás csökkentése kapcsoló és a rendszer prefers-reduced-motion beállítása kikapcsolja a mozgást.
- A nyitott szájú képek összes betöltése és váltása kikerült. A kliens csak a nyolc alap-PNG-t és a hátteret tölti elő; hiányzó karakterképnél kör-avatar és név látszik. Telefonon legfeljebb három esküdt és +N jelzés jelenik meg.
- A végleges képek arányát object-fit őrzi; nincs átméretezés vagy újrakivágás. Képgenerálás és Python képi utómunka nem történt. A korábban előkészített, opcionális feldolgozó forrás megmaradt, de nem szükséges a játékhoz.

Értelmezés: a felhasználó legutóbbi utasítása szerint a csatolt kész v3 képek a végleges források; a korábbi generálási és szájnyitás-szerkesztési terv nem része ennek a fázisnak. A részletes fájllista a `GRAPHICS_V4.md` fájlban található.

Nyitott: a tényleges böngészős elrendezés- és takarásellenőrzés az öt méreten. Az `npm run test:browser` elindult, de hiányzó Chromium-futtatható fájl miatt a mérés előtt leállt. A másik böngésző a helyi oldalt `ERR_BLOCKED_BY_CLIENT` hibával blokkolta. Ez nem sikeres vizuális teszt.

## Lefutott ellenőrzések

| Ellenőrzés | Jelenlegi eredmény |
| --- | --- |
| `node --check`, minden saját JS | 24/24 fájl sikeres |
| `npm test` | 18 sikeres, 0 hibás; minden lezárt kódfázis után lefutott |
| `npm run test:rules` | 12 tesztcsoport sikeres, 0 hibás |
| 6 mód × 20 kör, valamint Vegyes × 20 | Sikeres, ellenőrzött kártyák a saját pakliból |
| `test/phase2-runtime.js` | 27 ellenőrzés sikeres, virtuális időzítőkkel |
| `test/phase3-runtime.js` | 22 ellenőrzés sikeres, virtuális időzítőkkel |
| `npm run test:rooms` | 9 valódi Socket.io-ellenőrzés sikeres |
| `test/e2e-bots.js` | 22 sikeres, 0 hibás; valódi szerver/időzítők, 2 teljes kör, tiltakozás is |
| `test/stress-bots.js` | 6 teljes játék sikeres; 3–8 fő, 3 kör/játék, valódi BotManager virtuális órával |
| `test/deploy-check.js` | Sikeres: port, health, reconnect, szerver-újraindítás |
| `PORT=4567 npm start` | Elindult; `/health`, `/healthz`, `/`, `/help.json`: HTTP 200; mind a 10 kész kép HTTP 200 és eredetivel egyező bájtok |
| `scripts/prepare_assets_v4.py --self-test` | Korábbi szintetikus teszt sikeres; a kész v3 képekre nem futtattuk |
| `python test/assets-pipeline.py` | Korábbi szintetikus teszt sikeres; a jelenlegi grafikai beépítéshez nem szükséges |
| Böngészős mérés: 1366×768, 1643×600, 1920×1080, 390×844, 360×640 | Nem futott le; nyitott ellenőrzés |
| Kész grafikai csomag ellenőrzése | Ép csatolt ZIP; 8 valóban átlátszó RGBA karakter; 10 eredeti kép változtatás nélkül beépítve |

A végső lefutott tesztek között nincs bukás. Korábban az üres/hibás módlisták tesztjei jelezték a hibás visszaesést, ezt javítottuk. A szobánkénti eseményküldés és valódi játékostörlés után a régi tesztadapterek/állapotfeltevések is frissültek. A böngésző telepítése/futtatása ebben a környezetben nem sikerült; ebből nem készült hamis sikerjelentés.

## Helyi ellenőrzés

A teljes ZIP kicsomagolása után `npm install`, majd `npm start`. Az öt ellenőrzendő méret: 1366×768, 1643×600, 1920×1080, 390×844, 360×640. Playwrighttal a `test/README.md` szerint futtatható az automatizált böngészős ellenőrzés. A képi élek, bútorok melletti elhelyezés és névcímkék végső szemrevételezése ebben a környezetben nem volt lehetséges.
