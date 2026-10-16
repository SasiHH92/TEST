# Jogi oldalak: impresszum, adatkezelés, felhasználási feltételek

A játékban három nyilvános oldal van, és a regisztrációhoz kötelező az elfogadásuk:

| Oldal | Cím |
|-------|-----|
| Impresszum (ki üzemelteti) | `/impresszum` |
| Adatkezelési tájékoztató | `/adatkezeles` |
| Felhasználási feltételek és játékszabályok | `/felhasznalasi-feltetelek` (rövid cím a szabályokhoz: `/jatekszabalyok`) |

Elérhetők a belépőoldal alján, a támogatási oldal láblécében, és a regisztrációs űrlap jelölőnégyzetében is. **Az oldalak szövege a játék tényleges működését írja le** (milyen adatot tárol, ki a feldolgozó, meddig őrzi), de **nem jogi tanácsadás**: mielőtt kiskorúakat is tartalmazó közösséget irányítasz ide, érdemes egy adatvédelmi jogásszal átnézetni.

## 1. Amit neked kell megadnod (Render → Environment)

Az üzemeltetői adatokat környezeti változóként add meg, így a személyes adataid nem kerülnek a GitHubra.

| Változó | Mi legyen | Kötelező |
|---------|-----------|----------|
| `LEGAL_OPERATOR_NAME` | az üzemeltető neve (magánszemély neve vagy cégnév) | igen |
| `LEGAL_OPERATOR_ADDRESS` | székhely vagy levelezési cím (pl. postafiók) | igen |
| `LEGAL_OPERATOR_EMAIL` | a kapcsolattartási e-mail (adatvédelmi kérések, panaszok), lásd lent | igen |
| `LEGAL_OPERATOR_KIND` | pl. `magánszemély`, `egyéni vállalkozó`, `Kft.` | nem |
| `LEGAL_OPERATOR_PHONE` | telefonszám | nem |
| `LEGAL_OPERATOR_REGNO` | adószám / cégjegyzékszám, ha van | nem |
| `LEGAL_OPERATOR_COUNTRY` | az üzemeltető országa: `HU` (alapból) vagy `AT` (Ausztria). Ettől függ az illetékes felügyeleti hatóság (AT esetén az osztrák DSB, mellette a lakóhely szerinti NAIH) és az irányadó jog szövege | ajánlott |
| `LEGAL_MIN_AGE` | a regisztráció korhatára (alapból `16`) | nem |
| `LEGAL_RENDER_REGION` | a Render-szolgáltatásod régiója, pl. `Frankfurt (EU)` | ajánlott |
| `LEGAL_NEON_REGION` | a Neon-adatbázisod régiója, pl. `Frankfurt (EU)` (a Neon kapcsolati címében szerepel: pl. `eu-central-1` = Frankfurt) | ajánlott |

Amíg a kötelező adatok hiányoznak, az oldalak tetején piros figyelmeztetés és sárga „[KITÖLTENDŐ …]” jelölések látszanak, és az `/admin` oldal **Jogi oldalak** sora is jelzi. **Ne küldd el a linket senkinek, amíg ez ki nem tűnik.**

### Kapcsolattartási e-mail (ajánlás)

A Resend csak **küld**, fogadni nem tud. Ehhez a legegyszerűbb a Cloudflare ingyenes **Email Routing** szolgáltatása: a Cloudflare-ben a domain → Email → Email Routing → egy cím (pl. `info@kamubirosag.com`) → továbbítás a saját postaládádra. Így nem kell a magán e-mail-címedet kitenned, és a címre érkező levélre a saját címedről is válaszolhatsz.

## 2. Döntések, amelyeket neked kell meghoznod

1. **Korhatár.** Az alapérték **16 év** (a magyar digitális hozzájárulási korhatár is 16): 16 év alatt fiók nem hozható létre (a regisztrációkor a jelölőnégyzettel meg kell erősíteni, hogy a felhasználó elmúlt 16 éves; ha egy szülő azt jelzi, hogy a gyermeke fiatalabban regisztrált, a fiókot töröljük). A vendég-játék fiók és e-mail nélkül elérhető, a játék **16 éven felülieknek ajánlott** (a feltételek és az adatkezelési tájékoztató is ezt mondja), mert humoros, olykor felnőttes témájú elemeket (pl. bulira, alkoholra utaló vádak) tartalmaz, a közösségi csomagok és a csevegés pedig nem előre ellenőrzött. Ha szigorúbban akarod (pl. 18), állítsd a `LEGAL_MIN_AGE`-et; a regisztrációs felirat, a hibaüzenet és az oldalak mind követik.
2. **Ki az üzemeltető.** Magánszemélyként, egyéni vállalkozóként vagy cégként üzemelteted? Ez határozza meg, mit kell megadni (ha van adószám / cégjegyzékszám, add meg).
3. **Moderáció.** A szabályok szerint figyelmeztetés → némítás → kitiltás a lépcső. Az adatkezelési tájékoztató azt ígéri, hogy a jelentéseket (legutóbbi ~100) és a némításokat (legfeljebb 7 nap) a rendszer kezeli; ezt a kód teljesíti.

## 3. Ami az éles működésben megváltozik

- A **regisztrációhoz** el kell fogadni a feltételeket és a korhatárt (jelölőnégyzet). A szerver is ellenőrzi, és elmenti az elfogadás idejét és a szöveg verzióját (`LEGAL_VERSION` a `legal.js`-ben). Élesen (https) alapból kötelező; helyben és a teszteken nem (felülírható: `AUTH_REQUIRE_TERMS=1/0`).
- A **Google / Discord belépés** alatt figyelmeztetés van, hogy az első belépéssel a feltételek elfogadottnak számítanak.
- A **meg nem erősített, soha be nem lépett** fiókokat a szerver 7 nap után automatikusan törli (a név és az e-mail-cím felszabadul).

## 4. Teendők a szolgáltatóknál (nem kódolható, neked kell)

- **Adatfeldolgozói megállapodás (DPA)**: a Render, a Neon, a Resend és a Cloudflare általános szerződési feltételei tartalmaznak ilyet; érdemes a fiókodban elfogadni / letölteni.
- **Neon régió**: a lehető legközelebbi EU-s régió (Frankfurt) a javasolt; ha az adatbázisod máshol van, írd át a `LEGAL_NEON_REGION`-ben (és fontold meg az áttelepítést).
- **Google Fonts**: a betűtípusokat a Google szerveréről töltjük, így a látogató IP-címe a Google-hoz kerül (az adatkezelési tájékoztató ezt kimondja). Ha ezt is ki szeretnéd venni, a betűtípusokat saját szerverről is kiszolgálhatjuk; szólj, és megcsinálom.
- **Discord-szerver**: a Discord saját szabályai (és a Közösségi irányelvek) a szerveren is érvényesek; érdemes a szabályzat csatornában a játék feltételeire is hivatkozni.

## 5. Szöveg frissítése

A szöveg a `legal.js`-ben van. Ha a játék működése változik (új adat, új szolgáltató, új funkció), frissítsd a szöveget, a dátumot és a `LEGAL_VERSION` értékét. A teszt (`npm run test:legal`) ellenőrzi, hogy a szükséges szakaszok megvannak.
