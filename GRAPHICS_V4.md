# Beépített grafika – 4. fázis

A felhasználó által csatolt `kamu_assets_v3.zip` kész képei az `assets/` mappába kerültek. Mind a 10 fájl bájtról bájtra megegyezik a csatolmányban lévővel; az eredeti méret és az átlátszóság megmaradt. A 13 régi SVG is megmaradt, de a színpad nem használja őket.

| Fájl | Szerep / hely | Eredeti méret |
| --- | --- | --- |
| `biro.png` | Bíró, x = 49%, alul részben takarva | 241×334, RGBA |
| `ugyesz.png` | Ügyész, x = 14% | 210×334, RGBA |
| `vadlott.png` | Vádlott, x = 50%, elöl | 195×334, RGBA |
| `vedougyved.png` | Védő, x = 64% | 210×334, RGBA |
| `tanu.png` | Tanú, x = 70%, a képen lévő pulpitussal | 241×334, RGBA |
| `eskudt1.png` | Esküdt, első variáns | 206×334, RGBA |
| `eskudt2.png` | Esküdt, második variáns | 169×334, RGBA |
| `eskudt3.png` | Esküdt, harmadik variáns | 177×334, RGBA |
| `targyalotterem.jpg` | A színpad háttere | 1672×602, RGB |
| `targyalotterem.png` | A háttér PNG-párja, megőrizve | 1672×602, RGB |

## Megjelenítés

- A háttér `object-fit: cover`, `object-position: 50% 45%`; nincs sötétítő réteg vagy külön rajzolt bútorlap.
- A karakterek százalékos helyet kapnak. A kész képek különböző oldalarányát az `object-fit: contain` őrzi meg, az alsó élükhöz igazítva.
- Minden szereplőhöz avatarral és névvel ellátott címke, valamint legalább 14 px-es szerepchip tartozik. A bíró címkéje a feje fölött, üzenete a színpadon belül látszik.
- A beszélő figurája 1,2× nagyobb és a szerepe színében világít; a többiek enyhén halványabbak. A bíró teljes fényerejű marad.
- A három esküdtkép körbeforog. Az esküdtpad x = 82%-tól indul; 700 px szélesség alatt legfeljebb három esküdt és a többieket jelző `+N` látszik.
- Az összes használt kép előtöltődik. Hibás karakterkép helyett kör alakú avatar és név jelenik meg.

## Mozgás

Nincs külön nyitott szájú kép, és a kliens nem kér `_beszel.png` fájlokat. A mozgás egyetlen `requestAnimationFrame` ciklusban, a PNG-k belső rétegének transzformálásával történik: 1,5%-os lélegzés 3–4 másodperces periódussal, beszéd közbeni 2–3 px-es bólogatás és ±1,5° dőlés, 450 ms-os beszéd-pulzálás, szót átvételkor felpattanás, kalapácsütéskor csillapodó rázkódás. A reakció-emoji 0,8 másodpercig látszik.

A **Mozgás csökkentése** kapcsoló menti a választást; a rendszer `prefers-reduced-motion` beállítása is kikapcsolja az animációkat. A beszélő statikus nagyítása és színes kiemelése ekkor is megmarad.

## Ellenőrzés és korlát

A csatolt ZIP ép, mind a nyolc karakternek van átlátszó alfacsatornája. A szerver minden PNG/JPG fájlt az eredetivel egyező bájtokkal szolgál ki. Nem történt képgenerálás vagy képi utómunka.

Az öt kért képernyőméret böngészős mérését megpróbáltuk, de helyi Chromium nincs, a rendelkezésre álló böngésző a helyi oldalt `ERR_BLOCKED_BY_CLIENT` hibával blokkolja. A végső elrendezés szemrevételezése ezért helyben marad elvégzendő. A tesztelés menete a `test/README.md` fájlban található.

A korábban előkészített Python-feldolgozó és szintetikus teszt megmaradt a projektben, de a kész v3 képek beépítéséhez nem szükséges, nem futott rájuk, és a játék indításához Python sem kell.
