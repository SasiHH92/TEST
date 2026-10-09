# Hangfájlok (opcionális)

A játék most **szintetizált (WebAudio) hangokkal** szól: nincs letöltött hangfájl, minden hang kódból készül, és hang nélkül is teljes a játék.
Ha ide **valódi hangfájlt** teszel, azt a játék **automatikusan** a szintetizált helyett használja – kód nem kell hozzá.

## Hogyan működik

1. A szerver a `GET /api/media` címen megmondja, melyik fájl van ténylegesen ebben a mappában (60 mp-es gyorsítótár; `KB_AUDIO_DIR` másik mappát is megenged tesztre).
2. A `kbSound.play('<hang-név>')` először a `<hang-név>.ogg | .mp3 | .m4a | .wav` fájlt keresi (ebben a sorrendben), ha megvan: azt játssza (HTMLAudio, egy példány hang-nevenként, újrahasznosítva);
   ha nincs, a szintetizált hang szól. Hibás / nem lejátszható fájl sem állítja meg a játékot (csendben a következő hívásnál újra próbálkozik).
3. **Mester-hangerő és némítás** (a játék felső sávjában a 🔊 gomb és a csúszka, a lobbiban / menüben a sarok-kapcsoló) a fájlokra és a szintetizált hangokra is érvényes.
   A csevegő-hangjelzés (`chat`, `dm`) külön kapcsolható (🔔 a csevegő fejlécében).
4. **Autoplay:** a böngésző az első érintésig nem enged hangot; az első kattintás / érintés élesíti (`ensureAudio`), addig a hívások csendben elmaradnak.

## A fájlok nevei (hang-név → mikor szól → javasolt hossz / hangulat)

| Kategória | Fájlnév (kiterjesztés nélkül) | Mikor szól | Javasolt hossz · hangulat |
| --- | --- | --- | --- |
| **ui** | `ui-click` | gombnyomás | 40–80 ms · halk, száraz fa-kattintás |
| | `ready` | a játékos „KÉSZEN ÁLLOK”-ot nyom | 100–200 ms · világos „pim” |
| | `join` | valaki belép a terembe (lobbi) | 200–300 ms · halk dupla csengő |
| **card** | `card-hover` | egér a kártya fölött (csak egérrel) | ≤ 80 ms · nagyon halk papír-suhogás |
| | `card-select` | kártya kijelölése | ≤ 100 ms · puha kattintás |
| | `card-open` | a KÁRTYÁIM pakli kinyílik | 200–400 ms · papír-legyező |
| | `card-new` | új kártya érkezik a kézbe | 300–400 ms · becsúszó lap |
| | `card-play` | a kártya felemelkedik a kézből a jelenet felé (bizonyíték / kihívás-bemutató) | 300–500 ms · papír-suhintás + halk puffanás |
| **paper** | `paper` | papír-zörgés (akta, jegyzőkönyv) | ~300 ms |
| | `evidence` | a bizonyíték-mappa a jelenetre kerül | 400–600 ms · mappa-csattanás |
| **challenge** | `challenge` | a kihíváskártya pecsétje | 300–500 ms · pecsét-ütés |
| | `challenge-success` | „✓ SIKERÜLT” | 0,8–1,2 s · fényes csengő-arpeggio |
| | `challenge-fail` | „✕ NEM SIKERÜLT” | 0,6–1,0 s · mély puffanás, enyhén disszonáns |
| **reaction** | `reaction` | emoji-reakció felpattan a karakter fölött | 80–150 ms · rövid „pop” |
| | `objection` | TILTAKOZOM! | 1,0–1,5 s · rövid rézfúvós akcentus |
| | `vote` | szavazat leadása | ~100 ms |
| **stinger** | `stinger` | fontos fázisváltás sávja (ügyész / vádlott / tanú / eskütt következik) | 0,8–1,2 s · rövid rézfúvós + fénysöprés |
| | `reveal` | szerep-felfedés a kör elején („TE VAGY A BÍRÓ”) | 1,5–2,5 s · mély zúgás + emelkedő dúr hármashangzat |
| | `intro` | a tárgyalás bemutatása (kör-intro) | 1,5–2,5 s · feszült kürtök |
| | `intro-open` | „A TÁRGYALÁS MEGKEZDŐDIK!” | ~1 s · fanfár |
| | `countdown` | 3-2-1 visszaszámlálás (másodpercenként) | ~60 ms · óra-tick |
| | `ding` | fázis-csengő | 300–500 ms · harang |
| **gavel** | `gavel` | kalapácsütés | 400–700 ms · két fa-koppanás, mély |
| **verdict** | `verdict-guilty` | BŰNÖS | 1,5–2,5 s · lefelé lépő, komor akkord |
| | `verdict-acquitted` | ÁRTATLAN / FELMENTVE | 1,5–2,5 s · felfelé futó, csillogó dúr |
| **score** | `points` | pont-felrepülés (+N) | 200–300 ms · érme-csilingelés |
| | `score` | (azonos jelleg; ha külön kell a kör-összegzőhöz) | 200–300 ms |
| **victory** | `victory` | a játék vége, győztes spotlight | 3–5 s · fanfár + taps |

Formátum: **OGG (Opus/Vorbis)** vagy **MP3**, mono vagy sztereó, 44,1 / 48 kHz, normalizálva kb. −14 LUFS-ra (a hangerőt a játék állítja), csendes eleje-vége nélkül, fájlonként ≤ 200 KB.
A fájlnevek kisbetűsek, csak betű / szám / kötőjel. **Ne használj internetről letöltött, licenc nélküli hangot** – saját vagy megvásárolt / szabad licencű anyag kerülhet ide.

## Mi hiányzik még?

Jelenleg **egyetlen fájl sincs** (minden hang szintetizált). A fenti táblázat mind a 31 hang-neve igényelhető.
A prioritás (a legtöbbet halló / legnagyobb hatású): `gavel`, `verdict-guilty`, `verdict-acquitted`, `reveal`, `stinger`, `victory`, `challenge-success`, `challenge-fail`, `card-play`, `ui-click`.
