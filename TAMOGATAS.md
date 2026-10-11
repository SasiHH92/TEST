# ❤️ Támogasd a Kamu Bíróságot! – Ko-fi

**Röviden:** a `https://kamubirosag.com/tamogatas` oldal egy bemutató oldal, amelynek **egyetlen fő gombja a Ko-fi oldalra visz**: `https://ko-fi.com/kamubirosag`
(új lapon, `rel="noopener noreferrer"`). **A fizetés teljes egészében a Ko-fi felületén történik.** A Kamu Bíróság rendszerében nincs fizetési logika, nincs webhook,
nincs „köszönjük” / támogatás-visszaigazoló képernyő, és nem tárolunk semmit (kártyaadat, PayPal- vagy Stripe-adat, Ko-fi belépési adat). A szerver nem is állíthat, hogy valaki támogatott,
mert erről nincs információja.

> Ez a dokumentum nem jogi vagy adótanács.

## 1. Mi van az oldalon

| Elem | Tartalom |
|---|---|
| Hős | valódi 3D bíró-portré (`assets/roles/avatar_01_judge.webp`) aranykeretben, CSS-es kávéscsésze gőzzel; főcím, alcím, bemutatkozó szöveg |
| **Fő gomb** | ❤️ TÁMOGASD A KAMU BÍRÓSÁGOT! → Ko-fi (új lap), arany-bordó, finom fényfutás és fény-pulzálás (a gomb nem mozog), Tab / Enter, látható fókusz, mobilon teljes szélességű |
| Önkéntesség | „A támogatás teljesen önkéntes. Nem jár érte játékbeli előny, prémium funkció vagy más ellenszolgáltatás.” |
| Összegek (tájékoztató, **nem gombok**) | ❤️ 1 € · ⚖️ 5 € · 👑 10 € · 💎 egyedi (legalább 1 €) – a Ko-fi oldalán beállított összegek |
| Mire fordítjuk? | 🎮 Játékfejlesztés · 🖥️ Szerverfenntartás · 🎨 Grafikai fejlesztések (kizárólagosságot nem állít) |

**Nincs** VIP, rang, skin, prémium jogosultság vagy bármilyen játékbeli előny a támogatásért; a pogácsa-gazdaság és a játék működése nem függ tőle.

**Navigáció:** menü és profil-sáv („❤️ Támogasd a Kamu Bíróságot”), lobbi (apró ❤️ gomb, új lapon nyílik, hogy a szobából ne lépj ki), játék vége képernyő (halvány sor), Discord
(`❤️・támogatás` csatorna, `gyik` / `üdvözlünk` sor, `/tamogatas` parancs). A régi `/shop` és `/bolt` címek a főoldalra visznek; a pogácsa-bolt (🛒 BOLT + 🎽 SZEKRÉNYEM) változatlanul a játékon belül van.

## 2. Mi lett eltávolítva (és miért)

A korábbi, **saját** támogatási logika (összegválasztó kártyák, egyedi összeg mező, `/api/support/*` végpontok, webhook-fogadó, „KÖSZÖNJÜK” képernyő, szimulált szolgáltató) **törölve**:
az új cél szerint a támogatás teljesen a Ko-fi-n történik, és a weboldal nem keltheti azt a látszatot, hogy közvetlen fizetés zajlik, illetve nem erősíthet meg olyat, amiről nincs megbízható információja.
A `SUPPORT_*` környezeti változókra már nincs szükség (a Renderen nem kell beállítani, ha korábban megadtál ilyet, törölheted).

## 3. Opcionális: hivatalos Ko-fi widget (alapból NINCS bekapcsolva)

A Ko-fi súgója szerint két hivatalos widget létezik: **lebegő gomb** (a `<script>` a Ko-fi CDN-jéről töltődik, majd egy hívás rajzolja ki) és **tip panel** (beágyazható panel).
Forrás: <https://help.ko-fi.com/hc/en-us/articles/360018381678>. A pontos beágyazó kódot a saját Ko-fi fiókodban, a *Widgets* oldalon találod.

**Miért nem kapcsoltam be:** a külső szkript / keret betöltése (1) a Ko-fi-nek átadja a látogatók IP-címét és süti-adatait már az oldal megnyitásakor (GDPR / adatvédelmi kérdés, tájékoztató és esetleg hozzájárulás kell),
(2) lassítja az oldalt, (3) a mostani szigorú biztonsági fejlécünk (CSP: `script-src 'self'`, `default-src 'self'`) kifejezetten blokkolná.
Ha mégis kell: a CSP-ben engedélyezni kell a Ko-fi szkript- és keret-forrását (`script-src` / `frame-src` a Ko-fi doménre), a kódot a `public/tamogatas.html` aljára kell tenni, és az adatvédelmi tájékoztatóba be kell írni. **Elsődleges és javasolt megoldás a sima külső link** (mint most).

## 4. Üzemeltetői teendők (a Ko-fi oldalon és jogilag)

- A **Ko-fi oldalad beállításai** (nyilvános név, kifizetési mód, az összegek 1 / 5 / 10 € / egyedi) a te Ko-fi fiókodban vannak; az oldal ezekre csak hivatkozik. Ha a Ko-fi-n módosítod az összegeket, a tájékoztató kártyákat a `public/tamogatas.html`-ben kell igazítani.
- **Feltételek:** olvasd el a Ko-fi felhasználási feltételeit magánszemélyként Ausztriában (jogosultság, díjak, kifizetési küszöb, adatigazolás).
- **Adózás / vállalkozás:** egy forrás szerint az ellenszolgáltatás nélküli adomány magánszemélynek általában adómentes, de a **rendszeres** bevétel vállalkozói tevékenységnek minősülhet (Gewerbe, kisvállalkozói határ, SVS).
  Nem állítom, hogy a támogatás adómentes vagy hogy vállalkozás nélkül mindig jogszerű. → **Steuerberater / Finanzamt / WKO Gründerservice.**
- **Impresszum:** a MedienG §25 a források szerint magánszemély weboldalára is vonatkozik; pénzt kérő oldalnál különösen érdemes rendezni.
- **Adatvédelmi tájékoztató (GDPR):** a támogatási oldal nem tölt külső betűtípust és nem használ követőt, de a Ko-fi-re kattintva a látogató elhagyja az oldalt (a Ko-fi saját adatkezelése érvényes). **Megjegyzés:** a játék főoldala jelenleg a Google Fontsot tölti; érdemes saját szerverről kiszolgálni.

## 5. Tesztek

`npm run test:support` (14 ellenőrzés, valódi böngészővel): az oldal és a link (pontos cím, `_blank`, `noopener noreferrer`), új lap megnyílása (a Ko-fi-felé menő kérést a teszt elfogja, **valódi kapcsolat és tranzakció nincs**),
billentyűzet (Tab + Enter, látható fókusz), 320 / 375 / 430 / 768 / 1366 px (nincs vízszintes görgetés, a gomb a képernyőn belül, elég nagy érintési felület), nincs űrlap / beviteli mező / külső szkript / követő / API-hívás,
a törölt komponensek (nincs `/api/support`, nincs „köszönjük” képernyő, nincs 3 €-os kártya), a régi útvonalak és a bolt API sértetlensége, csökkentett mozgás.

## 6. Források

- Ko-fi tip widget: <https://help.ko-fi.com/hc/en-us/articles/360018381678>
- Ausztria – adományok / crowdfunding adózása: <https://www.unternehmerweb.at/selbststaendigkeit/finanz/die-steuerliche-betrachtung-von-crowdfunding-und-crowdinvesting/>
- Kisvállalkozói szabály: <https://www.wko.at/oe/oesterreich/ausbau-kleinunternehmerregelung-pauschalierung>
- Impresszum (WKO): <https://www.wko.at/internetrecht/website-impressum>
