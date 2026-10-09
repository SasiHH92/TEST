# Bejelentkező-oldali videó-háttér (opcionális)

**Jelenlegi állapot:** a belépőoldal háttere a végleges **`login-loop.mp4`** (2560×1440, H.264 High, 8 s-os hurok); a statikus `assets/terem-hatter.webp` a **poster** (amíg a videó tölt) és a **tartalék** (ha a videó nem tölthető be / nem játszható le). Korábban a belépőoldal háttere kizárólag a **statikus** `assets/terem-hatter.webp` volt. Ha ide videót teszel, a játék **automatikusan** ezt használja háttérnek – kód nem kell hozzá.
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

## Állapot és ami még hiányzik

**Kész:** `login-loop.mp4` (a megadott végleges anyag, bájtra azonosan; 4,56 MB, 2560×1440, 8,00 s, H.264 / avc1, van benne hangsáv – a `muted` miatt nem szól).
A játék `/api/media` felismeri, a login oldalon `autoplay muted loop playsinline` módban fut, `object-fit: cover` a teljes hátteret kitölti; a Render a repóból építi, így a fájl a deployban is megvan (`npm run test:cinema` B6 ellenőrzi; élesben a push után külön).

**Opcionális / még nincs** (nem blokkoló):
* `login-loop-mobile.webm` / `.mp4` (720×1280 vagy 960×540, ≤ 1,5 MB): **amíg nincs, telefonon (≤ 700 px) a statikus háttér marad** – a 2K videót mobilon szándékosan nem töltjük.
* `login-loop.webm` (VP9 / AV1): kisebb fájl, a böngésző ezt kínálja előbb; az mp4 nélküle is minden böngészőben megy.
* `login-poster.webp` (az első kocka, 1920×1080): nélküle a meglévő háttérkép a poster.
* Javaslat: az mp4 **nem „faststart”** (a `moov` a fájl végén van) – ez a lokális próbán nem okozott késést (~0,5–1 s az induláshoz), de lassú hálózaton a `+faststart` remux (`ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4`) gyorsabb indulást adna. Nem változtattam a megadott fájlon.
