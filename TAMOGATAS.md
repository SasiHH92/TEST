# ❤️ Támogasd a Kamu Bíróságot! – működés, szolgáltatók, teendők

**Állapot: a felület kész, a fizetés KI VAN KAPCSOLVA.** A `kamubirosag.com/tamogatas` oldal látható és kipróbálható, de pénzt nem fogad: a gomb
„Hamarosan – még nem aktív”, a szerver nem hoz létre fizetést, a webhook-végpont nem létezik. Bekapcsolni csak az üzemeltető jóváhagyása után szabad
(lásd lent). Ez a dokumentum **nem jogi vagy adótanács**.

## 1. Mi készült

| Elem | Hol |
|---|---|
| Támogatási oldal (hős: valódi 3D bíró + kávéscsésze, 5 kártya, egyedi összeg, „Mire fordítjuk?”, KÖSZÖNJÜK-képernyő) | `public/tamogatas.html`, `support.css`, `support.js` |
| Szerver-oldali szabályok (összeg-ellenőrzés, kikapcsolt állapot, aláírt visszaigazolás) | `support.js` (gyökér), végpontok: `/api/support/*` |
| Navigáció | menü: „❤️ Támogasd a Kamu Bíróságot”, profil-sáv: „❤️ TÁMOGATÁS”; címek: `/tamogatas`, `/support`; a régi `/shop`, `/bolt` a főoldalra visz |
| Tesztek | `npm run test:support` (13 ellenőrzés, böngészővel is), `npm run test:wardrobe` |

**Támogatási lehetőségek:** ❤️ Egy kis segítség 1 € · ☕ Kávé a fejlesztőnek 3 € · ⚖️ A bíróság támogatása 5 € · 👑 Nagylelkű támogatás 10 € · 💎 Egyedi (1–500 €, két tizedesig).
Az összeget **a szerver** számolja és ellenőrzi; a kliens csak a lehetőséget választja.

**Semmilyen ellenszolgáltatás nincs:** a támogatás kódja nem fér hozzá a fiókokhoz, a bolt egyenlegéhez, a tárgyakhoz, a rangokhoz (a teszt ezt ellenőrzi). Nincs VIP,
prémium karakter, skin, extra funkció, előny, fizetős Discord-rang.

**Adatvédelem:** az oldal nem tölt külső betűtípust, nem használ követőt, nem állít be sütit, nem tárol adományozói adatot (se név, se e-mail, se kártya).
A fizetéskor a szolgáltató oldalán adja meg az adatait a támogató; nálunk csak egy 2 órán belül lejáró, memóriabeli hivatkozás él.

## 2. A régi bolt

**Semmi nem törlődött vagy változott az adatokban.** A fiókok, a pogácsa-egyenlegek, a megszerzett tárgyak, a napi küldetések és a legendás tárgyak ugyanúgy működnek.
A pogácsa a játék ingyenes belső pénze (küldetésből jár, nem vásárolható pénzért), ezért a „Bolt” **a játékon belül megmaradt** (🛒 BOLT + 🎽 SZEKRÉNYEM + 📜 küldetések).
A „Támogatás” **külön, új belépési pont** (nem a bolt helyett): így a pogácsa-gazdaság és a pénzes támogatás nem keveredik, ami jogilag és játékélmény szempontjából is tisztább.
Ha szeretnéd, hogy a menüben a „Bolt” felirat helyett „Pogácsa-bolt” álljon, az egy sornyi módosítás.

## 3. Bekapcsolás – csak jóváhagyás után

A fizetés **csak akkor** indulhat, ha MINDEN igaz:
1. az üzemeltető kifejezetten bekapcsolja: `SUPPORT_ENABLED=1` a Renderen,
2. létezik jóváhagyott szolgáltató-adapter (`SUPPORT_PROVIDER=…`; jelenleg **nincs éles adapter**, csak a `simulated`, ami nem érint valódi pénzt),
3. az adapter titkai megvannak a környezetben.

Amíg nincs adapter, a `SUPPORT_ENABLED=1` sem kapcsol be semmit (a teszt ezt ellenőrzi). Új szolgáltató beillesztése: az adapter a `support.js` `ADAPTERS` listájába kerül
(`checkoutUrl()` + aláírás-ellenőrző `verify()`), tesztekkel; előtte a szolgáltató feltételeit el kell olvasni, és az alábbi jogi pontokat tisztázni.

**A „KÖSZÖNJÜK!” képernyő** kizárólag a szolgáltató szerver-oldalon, aláírással ellenőrzött visszaigazolása után jelenik meg (hamis / aláíratlan / kevesebb összegű /
ismeretlen hivatkozású visszaigazolás nem igazol; ismétlés idempotens). `SUPPORT_PREVIEW=1`-gyel az üzemeltető megnézheti a képernyőt
(`/tamogatas?elonezet=koszonjuk`), „ELŐNÉZET – nem valódi támogatás” felirattal.

## 4. Szolgáltatók (kutatás – a feltételeket MINDIG a szolgáltató saját oldalán ellenőrizd)

A találatok többsége másodlagos forrás; a **szolgáltatók saját feltételeit (ToS), az osztrák magánszemélyekre vonatkozó szabályokat és a mai díjakat nem tudtam hitelesen
megerősíteni**. Ezért ez egy tájékozódó összehasonlítás, nem ajánlás a bekapcsolásra.

| | Ko-fi | Buy Me a Coffee | PayPal (adomány-link) | Stripe (Payment Link) |
|---|---|---|---|---|
| Platform-díj | a súgó szerint ingyenes oldal csak „tip”-ekkel; a 5%-os díj a kiegészítő funkciókért (Gold-csomagról ellentmondó adatok) | ~5% platform-díj (harmadik fél adatai) | – | – |
| Fizetési díj | a PayPal / Stripe szokásos díja (pl. ~2,9% + fix, országfüggő) | + Stripe feldolgozás; kis összegnél a fix rész nagy arány | PayPal tranzakciós díj; régi forrás: 0,35 € + 1,5% – **ellenőrizd** | Stripe díj (~1,5–2,9% + fix, országfüggő) |
| Kifizetés | a PayPal / Stripe fiókodba közvetlenül (Ko-fi nem tartja a pénzt) | Stripe Connect | PayPal-egyenleg | Stripe → bank |
| Magánszemély Ausztriában | **nem megerősített** (a ToS-t nem találtam) | **nem megerősített**: egyes források szerint az országlefedettség változott, Ausztria nem tisztázott | a PayPal AT súgója a **Geschäftskonto**-ból (üzleti fiók) ajánlja az adomány-linket; magánfiókra **nem egyértelmű** → kérdezd a PayPal-t | a regisztráció üzleti adatokat kér (egyéni vállalkozó / magánszemély) – ez **vállalkozási kérdést** vet fel |
| „KÖSZÖNJÜK” a hivatkozásunkhoz kötve | nem (a támogató nem visz át azonosítót) | nem | csak üzleti API-val | **igen** (`client_reference_id` + aláírt webhook) |

**Következtetés (előzetes):**
- **Legegyszerűbb, alacsony kockázatú kiindulás: Ko-fi** (hosztolt oldal, kifizetés PayPal/Stripe-ra). Itt a „KÖSZÖNJÜK”-t a Ko-fi saját visszaigazolása adja, mert a mi hivatkozásunkat nem tudja
  átvinni; ezért a tervezett „szerver-ellenőrzött köszönet” itt csak általános formában oldható meg. **Nem aktiválom, amíg a Ko-fi feltételeit magánszemélyként Ausztriában
  nem ellenőrizted.**
- Ha a szerver-ellenőrzött, a támogatáshoz kötött KÖSZÖNJÜK a cél: **Stripe Payment Links** (vagy PayPal üzleti fiók) – de ez vállalkozói státuszt valószínűsít, tehát előbb az adózási/vállalkozási rész.
- A **Buy Me a Coffee** esetében az országlefedettség (Ausztria) nem megerősített; ne építs rá, amíg a saját oldaluk nem erősíti meg.

## 5. Jogi és adminisztratív kérdések – SZAKÉRTŐVEL tisztázandó, mielőtt pénzt fogadsz

Ezeket **nem tudom jogi vagy adózási tanácsként megválaszolni**; az alábbiak a talált, nem hivatalos források alapján tájékoztató jellegűek.
- **Adózás.** Egy forrás szerint a **ellenszolgáltatás nélküli adomány magánszemélynek** Ausztriában általában nem jövedelemadó-köteles, de a határ és a bejelentés részletei (pl. nagyobb összegnél)
  külön kérdés. Ha **rendszeres, platformon keresztül folyó bevétel** lesz belőle, az átminősülhet **vállalkozói tevékenységgé** (jövedelemadó, esetleg ÁFA, társadalombiztosítás).
  **Nem állítom, hogy a támogatás adómentes**, és azt sem, hogy vállalkozás nélkül minden esetben jogszerűen fogadható. → **Steuerberater / Finanzamt / WKO Gründerservice**.
- **Gewerbe / vállalkozás.** Rendszeres bevételnél felmerül az ipari (Gewerbe) bejelentés kötelezettsége. Az **ÁFA-kisvállalkozói határ 55 000 €** (2025-től; 2026-os változásokról is vannak jelzések – ellenőrizd).
  A társadalombiztosítási (SVS) küszöbök külön szabályok. → szakértő.
- **Impresszum / üzemeltetői adatok.** A **MedienG §25** szerinti közzétételi kötelezettség a források szerint **magánszemélyek weboldalára is** vonatkozik (terjedelme a „kis/nagy” weboldaltól függ);
  az **ECG §5** a kereskedelmi jellegű oldalakra. Pénzt kérő oldalnál ez a „kereskedelmi” kérdés élesebb. **Impresszum nélkül ne kapcsold be.**
- **Adatvédelem (GDPR / DSGVO).** Adatvédelmi tájékoztató kell (milyen adatot kezelsz, a fizetési szolgáltató mint címzett, jogok). **Megjegyzés:** a játék főoldala jelenleg a **Google Fontsot**
  tölti (a támogatási oldal nem), ami az EU-ban adatvédelmi aggály; érdemes a betűtípusokat saját szerverről kiszolgálni.
- **Szolgáltatói feltételek.** Magánszemély jogosultsága, tiltott felhasználások, díjak, kifizetési küszöbök, adóazonosító / személyazonosság-igazolás.
- **Fogyasztóvédelem.** Mivel nincs ellenszolgáltatás, ez egyszerűbb, de a szolgáltató oldalán a visszatérítés / vitás tranzakció szabályai érvényesek.

**Teendő-lista a bekapcsolás előtt:** (1) adózási/vállalkozási tisztázás szakértővel, (2) Impresszum, (3) adatvédelmi tájékoztató, (4) szolgáltató kiválasztása és feltételeinek ellenőrzése, (5) adapter megírása és tesztelése,
(6) tesztfizetés a szolgáltató teszt-módjában (ha van), (7) csak ezután: `SUPPORT_ENABLED=1`.

## 6. Grafika

- Hős-kép: a játék **valódi 3D bíró-portréja** (`assets/roles/avatar_01_judge.webp`, 720×960) aranykeretben, CSS-es kávéscsészével és gőzzel (egyszerű UI-ikon, nem új artwork).
- **Ha elkészül a „bíró kávéscsészével” kép** (Pixar-stílusú 3D), tedd ide: `assets/support/biro-kave.webp` (álló, kb. 720×960, WebP, < 150 KB): a szerver észreveszi, és az oldal automatikusan azt használja.
  Javasolt kérés a grafikai csővezetékedhez: *„Pixar-style premium 3D cartoon Hungarian courtroom judge, friendly and humorous, black robe with burgundy and gold trim, white wig, holding a steaming
  coffee mug in one hand and a gavel in the other, warm burgundy and gold lighting, dark brown background, centered, portrait 3:4, high detail”*.
- Színek: bordó (`#5b1226`), arany (`#f2c14e`), sötétbarna (`#1b120c`). A kártyák ikonjai: ❤️ ☕ ⚖️ 👑 💎, mindegyik saját színnel és fényhatással.

## 7. Források (a kutatáshoz; nem hivatalos / részben harmadik fél – ellenőrizd)

- Ko-fi súgó – fizetések: <https://help.ko-fi.com/hc/en-us/articles/360013140633-Supporter-payments-FAQ>, kifizetés: <https://help.ko-fi.com/hc/en-us/articles/115003980093-How-do-I-get-paid>
- Ko-fi díjak (harmadik fél): <https://schoolmaker.com/blog/ko-fi-pricing.md>
- Buy Me a Coffee országlefedettség: <https://zverok.space/blog/2024-08-08-bmac-snafu.html>, díjak: <https://www.builtbyfoundry.io/blog/buy-me-a-coffee-review-2026-is-the-5-percent-fee-worth-it>
- PayPal Ausztria – adomány-link üzleti fiókkal: <https://www.paypal.com/at/cshelp/article/wie-kann-ich-finanzielle-unterst%C3%BCtzung-f%C3%BCr-mein-unternehmen-erhalten-help241>
- Ausztria – adományok / crowdfunding adózása: <https://www.unternehmerweb.at/selbststaendigkeit/finanz/die-steuerliche-betrachtung-von-crowdfunding-und-crowdinvesting/>
- Kisvállalkozói szabály: <https://www.wko.at/oe/oesterreich/ausbau-kleinunternehmerregelung-pauschalierung>
- Impresszum (WKO): <https://www.wko.at/internetrecht/website-impressum>, <https://www.arching.at/fileadmin/user_upload/Impressum_Website_etc_Infoblatt.pdf>
