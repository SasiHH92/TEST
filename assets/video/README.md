# Bejelentkező-oldali videó-háttér (opcionális)

A belépőoldal (login / regisztráció) háttere most a **statikus** `assets/terem-hatter.webp`. Ha ide videót teszel, a játék **automatikusan** ezt használja háttérnek – kód nem kell hozzá.
A bejelentkező űrlap (HTML/CSS) **nincs beégetve a videóba**; a videó fölött finom, filmes vignetta + sötétítés van, hogy az űrlap mindig olvasható marad.

## Fájlnevek

| Fájl | Mire | Javasolt paraméterek |
| --- | --- | --- |
| `login-loop.webm` | asztali háttér (VP9 / AV1) | 1920×1080 (16:9), 24–30 fps, **6–12 mp-es zökkenőmentes hurok**, hang nélkül, ≤ 4 MB, ~1,5–2,5 Mbit/s |
| `login-loop.mp4` | ugyanaz, Safari / régebbi böngésző (H.264, `yuv420p`, `+faststart`) | ugyanezek |
| `login-loop-mobile.webm` / `.mp4` | telefon (≤ 700 px) | 720×1280 vagy 960×540, ≤ 1,5 MB, 6–10 mp (fekvő / álló kivágás a képernyőn `object-fit: cover`) |
| `login-poster.webp` | állókép, amíg a videó tölt (opcionális: nélküle a meglévő háttérkép) | az első kocka, 1920×1080 |

A fájlok neve kisbetűs, ékezet és szóköz nélkül. A `webm` a böngészőnek előbb kínálódik, utána az `mp4`.

## Mikor esik vissza statikus háttérre

* nincs fájl a mappában (`GET /api/media` nem listázza: a kliens sem kér semmit, nincs 404-zaj),
* csökkentett mozgás (`prefers-reduced-motion: reduce` vagy a játék saját „Kevesebb mozgás” kapcsolója),
* adattakarékos mód (`Save-Data`) vagy 2G kapcsolat,
* keskeny (≤ 700 px) képernyő, ha nincs `login-loop-mobile.*` fájl (a nagy asztali videót telefonon nem töltjük),
* a videó hibázik, vagy **6 mp alatt nem indul el** (lassú hálózat),
* a lap háttérben van (`visibilitychange`): a videó megáll; a belépőoldal elhagyásakor (bejelentkezés / vendég belépés) a videó eltávolítódik (nincs memória-szivárgás), visszatéréskor újra létrejön.

A videó `autoplay muted loop playsinline`, `preload="metadata"`, `object-fit: cover`; a betöltés **nem blokkolja** az oldalt (a `/api/media` válasza után, a belépőoldalon jön létre).

## Mi hiányzik még?

**ASSET NEEDED:** `login-loop.webm` + `login-loop.mp4` (+ `login-loop-mobile.*`, `login-poster.webp`) – 16:9, 6–12 mp-es hurok, a magyar tárgyalóterem lassú, filmes kamera-mozgással
(napsugarak a bordó függönyökön, lebegő por, a bírói pulpitus; karakter nélkül vagy a meglévő karakterekkel), sötét mahagóni / bordó / arany színvilág, **UI nélkül**.
Jelenleg **nincs** videó-fájl: a mechanizmus kész és tesztelt (`npm run test:cinema`), de valódi videóval még nem próbáltam (nincs asset).
