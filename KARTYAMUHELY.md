# Kártyaműhely (közösségi kártyacsomagok): üzemeltetői leírás

A bejelentkezett játékosok saját játékmódot (csomagot) készíthetnek: vádak, bizonyítékok, alibik, trükkök, tanúk, kihívások, büntetések. A csomag lehet **privát** (csak a 6 jegyű kódot ismerők érik el) vagy **nyilvános** (a könyvtárban böngészhető). Bárki használhatja a lobbiban, a házigazda dönt arról, melyik témák és csomagok szerepeljenek.

## Hol van a felület?
- **Menü** → `🃏 Kártyaműhely: saját csomagok` (saját csomagok, könyvtár, kód alapján megnézés, szerkesztő).
- **Lobbi** (házigazdának, EGYÉNI JÁTÉK): a saját és mentett csomagok csempeként ott vannak a témák mellett (🃏, a készítő nevével); a `CSOMAG KÓD` mezővel bárki (vendég is) felvehet egy csomagot a saját szobájába.
- A GYORS JÁTÉK csak a beépített témákat használja.

## Szabályok és korlátok (packs.js)
| Mi | Érték |
|---|---|
| Saját csomag fiókonként | 5 (`PACKS_PER_ACCOUNT` környezeti változóval állítható) |
| Gyűjtemény (mentett csomagok) | 30 |
| Minimum kártya paklinként | vád 6, bizonyíték 4, alibi 3, trükk 3, tanú 3, kihívás 3, büntetés 3 |
| Maximum kártya paklinként | vád 60, a többi 40 |
| Kártyaszöveg | 4–130 karakter; nincs `< >`, `@`, link / meghívó; `[vádlott]` és `[játékos]` helyőrző csak a vádakban |
| Név / leírás | 3–40 / legfeljebb 140 karakter |
| Írási korlát | óránként 30 módosítás (létrehozás, szerkesztés, mentés, jelentés…) fiókonként |
| Egy szobában | legfeljebb 12 felvett csomag |

## Moderáció
- A játékosok a **JELENTÉS** gombbal jelenthetnek egy csomagot (fiókonként egyszer, a sajátot nem).
- **3 különböző jelentő** után a csomag magától elbújik: eltűnik a könyvtárból, kóddal sem érhető el, szobába nem vehető fel (a készítő látja, hogy el van rejtve). A már futó szobák a pillanatfelvétellel végigjátszhatják a tárgyalást.
- **/admin → Csomagok lap:** a jelentettek elöl; **Elrejtés**, **Visszaállítás** (törli a jelentéseket), **Törlés** (végleges, a gyűjteményekből is kiveszi). A fül jelvénye a jelentett / elrejtett csomagok száma.
- Fiók törlésekor a fiók csomagjai és gyűjteménye is törlődik; az adatkérés (`/api/account/export`) tartalmazza a csomagokat (`cardPacks`).

## Tárolás
- `data/packs.json` (környezeti változó: `KB_PACKS_FILE`): fájlban él, és a külső adatbázisba is feltöltődik (mint a moderáció), így az újraindítás után is megmarad. A `.gitignore` kizárja.
- A szoba a csomag **pillanatfelvételével** játszik: szerkesztés / törlés / elrejtés nem szakít meg futó tárgyalást.

## API (`/api/packs`)
`GET /limits`, `GET /library?q=&sort=new|popular&limit=&offset=`, `GET /mine` (belépve), `GET /:code`, `POST /`, `PUT /:code`, `DELETE /:code`, `POST|DELETE /:code/save`, `POST /:code/report`. Az íróműveletek JSON-t és azonos eredetet (Origin) várnak.
Socket: `pack_add { code }` (csak a házigazda, csak a lobbiban; a felvett csomag ki is van jelölve).

## Tesztek
`npm run test:packs` (szövegellenőrzés, tároló, motor, valódi szerver: HTTP, socket, admin, fiók-törlés), `npm run test:packs-ui` (böngésző: asztali és telefonos méret, admin lap).

## Jogi
Az Adatkezelési tájékoztató (új sor: Kártyacsomagok) és a Felhasználási feltételek (7. pont) tartalmazza a csomagokat; verzió: 2026-10-15. Nyilvános csomagnál a készítő felhasználóneve látszik: ezt a szöveg kimondja.
