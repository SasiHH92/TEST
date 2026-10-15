'use strict';

// ============================================================
// KAMU BÍRÓSÁG – jogi oldalak: Impresszum, Adatkezelési tájékoztató, Felhasználási feltételek és játékszabályok
//
// Az oldalak a szerverről, a környezeti változókban megadott üzemeltetői adatokkal készülnek (a személyes adatok így nem kerülnek a tárolóba):
//   LEGAL_OPERATOR_NAME     az üzemeltető / adatkezelő neve (magánszemély neve, vagy cégnév)        [kötelező]
//   LEGAL_OPERATOR_ADDRESS  székhely vagy levelezési cím                                          [kötelező]
//   LEGAL_OPERATOR_EMAIL    kapcsolattartási e-mail (adatvédelmi kérések, panaszok)               [kötelező]
//   LEGAL_OPERATOR_KIND     pl. "magánszemély", "egyéni vállalkozó", "Kft."                         [nem kötelező]
//   LEGAL_OPERATOR_PHONE    telefonszám                                                           [nem kötelező]
//   LEGAL_OPERATOR_REGNO    adószám / cégjegyzékszám / nyilvántartási szám (ha van)               [nem kötelező]
//   LEGAL_OPERATOR_COUNTRY  az üzemeltető országa, kétbetűs kód: HU (alapból) vagy AT (Ausztria) – ettől függ az illetékes hatóság és az irányadó jog szövege [ajánlott]
//   LEGAL_MIN_AGE           a regisztráció alsó korhatára (alapból 16)                              [nem kötelező]
//   LEGAL_RENDER_REGION     az alkalmazás felhős régiója szövegesen (pl. "Frankfurt, EU")          [nem kötelező]
//   LEGAL_NEON_REGION       az adatbázis régiója szövegesen (pl. "Frankfurt, EU")                  [nem kötelező]
//   DISCORD_INVITE_URL      a közösségi Discord-szerver meghívója
// Ami hiányzik, azt az oldal feltűnően jelzi ("[KITÖLTENDŐ …]"), és az admin oldal is mutatja.
// A szöveg a játék tényleges működését írja le (lásd a kódot: fiókok, munkamenetek, tárolt adatok, szolgáltatók); ha a működés változik, a szöveget
// és a LEGAL_VERSION értéket is frissíteni kell. A szöveg nem helyettesíti a jogi tanácsadást.
// ============================================================

const express = require('express');

const LEGAL_VERSION = '2026-10-15';
const LEGAL_DATE_TEXT = '2026. október 15.';
const SITE_NAME = 'Kamu Bíróság';

const esc = (v) => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const httpsUrl = (v) => { try { const u = new URL(String(v || '').trim()); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch (_) { return ''; } };

function loadConfig(env, origin) {
  const t = (k, max = 200) => String(env[k] || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const age = parseInt(env.LEGAL_MIN_AGE, 10);
  return {
    name: t('LEGAL_OPERATOR_NAME'), address: t('LEGAL_OPERATOR_ADDRESS', 300), email: t('LEGAL_OPERATOR_EMAIL', 254),
    kind: t('LEGAL_OPERATOR_KIND', 60), phone: t('LEGAL_OPERATOR_PHONE', 40), regno: t('LEGAL_OPERATOR_REGNO', 80),
    country: ['HU', 'AT'].includes(t('LEGAL_OPERATOR_COUNTRY', 4).toUpperCase()) ? t('LEGAL_OPERATOR_COUNTRY', 4).toUpperCase() : 'HU',
    minAge: age >= 13 && age <= 18 ? age : 16,
    renderRegion: t('LEGAL_RENDER_REGION', 80), neonRegion: t('LEGAL_NEON_REGION', 80),
    discord: httpsUrl(env.DISCORD_INVITE_URL) || 'https://discord.gg/yyG7hH4aEB',
    site: String(origin || '').replace(/\/+$/, '') || 'https://kamubirosag.com'
  };
}
const REQUIRED = [['name', 'LEGAL_OPERATOR_NAME'], ['address', 'LEGAL_OPERATOR_ADDRESS'], ['email', 'LEGAL_OPERATOR_EMAIL']];
const missingOf = (cfg) => REQUIRED.filter(([k]) => !cfg[k]).map(([, env]) => env);

// ---------- oldal-váz ----------
const NAV = [['impresszum', 'Impresszum'], ['adatkezeles', 'Adatkezelési tájékoztató'], ['felhasznalasi-feltetelek', 'Felhasználási feltételek és játékszabályok']];

function todo(label) { return '<mark class="todo">[KITÖLTENDŐ: ' + esc(label) + ']</mark>'; }
const val = (v, label) => (v ? esc(v) : todo(label));

function layout(cfg, active, title, intro, bodyHtml) {
  const miss = missingOf(cfg);
  const nav = NAV.map(([slug, label]) => '<a href="/' + slug + '"' + (slug === active ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>').join('');
  return '<!DOCTYPE html>\n<html lang="hu">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + esc(title) + ' – ' + SITE_NAME + '</title>\n' +
    '<meta name="description" content="' + esc(intro) + '">\n<meta name="theme-color" content="#2a0b14">\n' +
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'.9em\' font-size=\'90\'>⚖️</text></svg>">\n' +
    '<link rel="stylesheet" href="/legal.css">\n</head>\n<body>\n' +
    '<a class="lg-skip" href="#tartalom">Ugrás a tartalomra</a>\n' +
    '<header class="lg-top"><a class="lg-back" href="/" aria-label="Vissza a játékba">⚖️ <span>Vissza a játékba</span></a><nav class="lg-nav" aria-label="Jogi információk">' + nav + '</nav></header>\n' +
    '<main id="tartalom" class="lg-main">\n' +
    (miss.length ? '<p class="lg-warn" role="note"><b>Az üzemeltetői adatok még nincsenek kitöltve</b> (hiányzik: ' + miss.map(esc).join(', ') + '). Az oldal addig nem végleges.</p>\n' : '') +
    '<h1>' + esc(title) + '</h1>\n<p class="lg-meta">Hatályos: ' + LEGAL_DATE_TEXT + ' &middot; verzió: ' + LEGAL_VERSION + '</p>\n<p class="lg-lead">' + esc(intro) + '</p>\n' +
    bodyHtml + '\n</main>\n' +
    '<footer class="lg-foot"><p>' + SITE_NAME + ' – független, magyar közösségi játék.</p><p>' + NAV.map(([slug, label]) => '<a href="/' + slug + '">' + esc(label) + '</a>').join(' &middot; ') + '</p></footer>\n</body>\n</html>\n';
}

const sec = (id, h, html) => '<section id="' + id + '" class="lg-sec"><h2>' + esc(h) + '</h2>' + html + '</section>';
const ul = (items) => '<ul>' + items.map((i) => '<li>' + i + '</li>').join('') + '</ul>';
const table = (head, rows) => '<div class="lg-tw"><table><thead><tr>' + head.map((h) => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
  rows.map((r) => '<tr>' + r.map((c, i) => (i === 0 ? '<th scope="row">' : '<td>') + c + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</tbody></table></div>';
const mail = (cfg) => (cfg.email ? '<a href="mailto:' + esc(cfg.email) + '">' + esc(cfg.email) + '</a>' : todo('LEGAL_OPERATOR_EMAIL'));

// ---------- 1. Impresszum ----------
function imprint(cfg) {
  const body =
    sec('uzemelteto', 'A szolgáltatás üzemeltetője', table(['Adat', 'Érték'], [
      ['Szolgáltatás', SITE_NAME + ' – online, magyar nyelvű közösségi party játék (<a href="' + esc(cfg.site) + '">' + esc(cfg.site) + '</a>)'],
      ['Üzemeltető (szolgáltató és adatkezelő)', val(cfg.name, 'LEGAL_OPERATOR_NAME') + (cfg.kind ? ' (' + esc(cfg.kind) + ')' : '')],
      ['Székhely / levelezési cím', val(cfg.address, 'LEGAL_OPERATOR_ADDRESS') + (cfg.country === 'AT' ? ' (Ausztria)' : '')],
      ['E-mail (kapcsolattartás, adatvédelmi kérések, panaszok)', mail(cfg)],
      ...(cfg.phone ? [['Telefon', esc(cfg.phone)]] : []),
      ...(cfg.regno ? [['Adószám / nyilvántartási szám', esc(cfg.regno)]] : []),
      ['Közösségi szerver (gyors elérhetőség)', '<a href="' + esc(cfg.discord) + '" target="_blank" rel="noopener noreferrer">Kamu Bíróság Discord</a>']
    ])) +
    sec('tarhely', 'Tárhely- és közreműködő szolgáltatók', '<p>A játék működtetéséhez az alábbi szolgáltatókat használjuk (részletek az <a href="/adatkezeles#cimzettek">Adatkezelési tájékoztatóban</a>):</p>' + table(['Szolgáltató', 'Mire használjuk'], [
      ['Render (render.com)', 'az alkalmazás futtatása (tárhely)' + (cfg.renderRegion ? ' – régió: ' + esc(cfg.renderRegion) : '')],
      ['Neon (neon.tech)', 'adatbázis a fiókok és a játékadatok tartós tárolására' + (cfg.neonRegion ? ' – régió: ' + esc(cfg.neonRegion) : '')],
      ['Cloudflare (cloudflare.com)', 'a kamubirosag.com domain DNS-kezelése, szükség szerint forgalom-átirányítás és védelem'],
      ['Resend (resend.com)', 'a rendszer-levelek (megerősítés, jelszó-visszaállítás, meghívó) kézbesítése; adatfeldolgozás az EU-ban (Írország)'],
      ['Discord (discord.com)', 'a közösségi szerver, a Discord-belépés és a Discord-összekötés'],
      ['Google (google.com)', 'Google-belépés; a betűtípusok betöltése (Google Fonts)'],
      ['Ko-fi (ko-fi.com)', 'önkéntes támogatás – csak akkor, ha a támogatás gombra kattintasz; a fizetés az ő oldalukon történik']
    ])) +
    sec('panasz', 'Panasz, jogsértő tartalom bejelentése', '<p>Ha jogsértő vagy szabálytalan tartalmat találsz, a játékon belüli <b>Jelentés</b> funkcióval, a <b>Hibajelentés</b> gombbal, a Discord-szerver moderátorainál vagy e-mailben (' + mail(cfg) + ') jelezheted. A bejelentéseket a lehető leghamarabb megvizsgáljuk. Az adatkezeléssel kapcsolatos kéréseidről lásd az <a href="/adatkezeles#jogok">Adatkezelési tájékoztatót</a>.</p>') +
    sec('szerzoi', 'Szerzői jogok, tartalom', '<p>A weboldal szövege, a játék kódja és grafikai elemei az üzemeltető vagy jogosultjai tulajdonában / felhasználásában állnak; a grafikák egy része generatív (mesterséges intelligenciás) eszközökkel készült. Engedély nélküli másolásuk, terjesztésük nem megengedett. A játékosok által beírt tartalmakért (név, kártyaszövegek, csevegés) az azt beíró játékos felel.</p>') +
    sec('felelosseg', 'Fikció és felelősség', '<p>A ' + SITE_NAME + ' egy szórakoztató party játék: a benne szereplő „vádak”, „ítéletek” és „bizonyítékok” kitalált, humoros játékelemek, nem valós személyekre vonatkozó állítások. A részletes szabályok a <a href="/felhasznalasi-feltetelek">Felhasználási feltételekben</a> vannak.</p>');
  return layout(cfg, 'impresszum', 'Impresszum', 'Ki üzemelteti a ' + SITE_NAME + ' játékot, hogyan érhető el, és kik a közreműködő szolgáltatók.', body);
}

const NAIH_HTML = '<b>Nemzeti Adatvédelmi és Információszabadság Hatóság</b> (NAIH; 1055 Budapest, Falk Miksa utca 9–11.; levelezési cím: 1363 Budapest, Pf. 9.; ugyfelszolgalat@naih.hu; <a href="https://www.naih.hu" target="_blank" rel="noopener noreferrer">www.naih.hu</a>)';
const DSB_HTML = '<b>Osztrák Adatvédelmi Hatóság</b> (Datenschutzbehörde, DSB; Barichgasse 40–42, 1030 Wien, Ausztria; dsb@dsb.gv.at; <a href="https://www.dsb.gv.at" target="_blank" rel="noopener noreferrer">www.dsb.gv.at</a>)';
function authorityHtml(cfg) {
  const first = 'Ha úgy érzed, hogy az adataid kezelése sérti a jogaidat, először keress minket (' + mail(cfg) + '). ';
  if (cfg.country === 'AT') {
    return '<p>' + first + 'Az üzemeltető Ausztriában működik, ezért elsősorban az ' + DSB_HTML + ' az illetékes felügyeleti hatóság. Az Európai Unióban élő érintettként panaszt a saját lakóhelyed szerinti felügyeleti hatóságnál is tehetsz; Magyarországon ez a ' + NAIH_HTML + '. Bírósághoz is fordulhatsz.</p>';
  }
  return '<p>' + first + 'Panaszt tehetsz a ' + NAIH_HTML + ', vagy bírósághoz fordulhatsz (a per a lakóhelyed vagy tartózkodási helyed szerinti törvényszék előtt is megindítható).</p>';
}

// ---------- 2. Adatkezelési tájékoztató ----------
function privacy(cfg) {
  const op = val(cfg.name, 'LEGAL_OPERATOR_NAME');
  const body =
    sec('lenyeg', 'A lényeg röviden', ul([
      'Csak azt kérjük el, ami a játékhoz kell: <b>felhasználónév, e-mail-cím és jelszó</b> (vagy Google / Discord belépés). <b>Fiók nélkül, vendégként is játszhatsz.</b>',
      'A jelszavadat <b>soha nem tároljuk olvasható formában</b> (csak sózott, egyirányú kivonatot).',
      '<b>Nincs hirdetés, nincs követő (analitikai) süti, nem adjuk el az adataidat</b>, és nem küldünk hírlevelet: csak rendszer-leveleket (megerősítés, jelszó-visszaállítás, meghívó, biztonsági értesítés).',
      'A fiókodat és az adataidat <b>bármikor törölheted</b> a profilodon belül (FIÓKOM → fiók törlése), és letöltheted is őket (adataim letöltése).',
      'A regisztrációhoz legalább <b>' + cfg.minAge + ' évesnek</b> kell lenned (lásd a „Gyermekek és fiatalok” részt).'
    ])) +
    sec('adatkezelo', '1. Ki az adatkezelő?', '<p>Az adatkezelő: ' + op + (cfg.kind ? ' (' + esc(cfg.kind) + ')' : '') + ', ' + val(cfg.address.replace(/[.]+$/, ''), 'LEGAL_OPERATOR_ADDRESS') + '. Kapcsolat (adatvédelmi kérések is): ' + mail(cfg) + '. Az üzemeltetői adatok az <a href="/impresszum">Impresszumban</a> is megtalálhatók. Adatvédelmi tisztviselőt nem nevezünk ki (nem kötelező).</p>') +
    sec('adatok', '2. Milyen adatokat kezelünk, mire, milyen jogalappal és meddig?', '<p>Jogalapok: <b>szerződés teljesítése</b> (GDPR 6. cikk (1) b): a fiók és a játék szolgáltatása), <b>jogos érdek</b> (6. cikk (1) f): biztonság, visszaélések megelőzése, moderáció, hibajavítás), <b>hozzájárulás</b> (6. cikk (1) a): pl. az opcionális képcsatolás a hibajelentéshez, a Discord-összekötés).</p>' + table(['Adatkör', 'Kezelt adatok', 'Cél és jogalap', 'Megőrzés'], [
      ['Fiók (regisztráció)', 'felhasználónév, e-mail-cím, a jelszó sózott kivonata (scrypt), létrehozás és utolsó belépés ideje, az e-mail megerősítésének állapota, a feltételek elfogadásának ideje és verziója', 'a fiók létrehozása és használata; szerződés', 'a fiók törléséig. A meg nem erősített, soha be nem lépett fiókot 7 nap után töröljük.'],
      ['Külső belépés (Google, Discord)', 'a szolgáltató által adott azonosító és az ellenőrzött e-mail-cím; jelszót nem kapunk', 'belépés; szerződés', 'a fiók törléséig'],
      ['Munkamenet', 'a belépést igazoló süti (a szerveren csak a lenyomata tárolódik); lejárat: 8 óra használat nélkül, „Emlékezz rám” esetén 30 nap', 'bejelentkezve maradás, biztonság; szerződés, jogos érdek', 'a lejáratig vagy kijelentkezésig'],
      ['Profil / kártya', 'vicces cím, „priusz” szöveg, jelvény, avatár. Ezek <b>nyilvánosak</b> a játékban a többi játékos számára', 'a játékos kártyájának megjelenítése; szerződés', 'a fiók törléséig (vagy amíg átírod)'],
      ['Játékstatisztika, ranglista', 'játszott körök, győzelmek, pontok, szerepek szerinti eredmények. A ranglistán a játékos neve és eredménye látszik', 'a játék eredményeinek vezetése; szerződés', 'a fiók törléséig. Vendég neve alatt is gyűlhet statisztika (név szerint).'],
      ['Barátok, privát üzenetek', 'barátlista; barátok közötti privát üzenetek (beszélgetésenként a legutóbbi 60)', 'közösségi funkció; szerződés', 'a barátság megszűnéséig vagy a fiók törléséig'],
      ['Bolt, pogácsa, küldetések', 'virtuális egyenleg, megszerzett és viselt játékbeli tárgyak, napi küldetések állapota', 'a játékon belüli virtuális rendszer; szerződés', 'a fiók törléséig'],
      ['Szoba és játék közben', 'név, avatár, csevegés, szavazatok, ítéletek – ezek a szerver memóriájában vannak, <b>tartósan nem tároljuk</b> őket (a szoba megszűnésével vagy a szerver újraindításával elvesznek); kivéve a statisztikába kerülő eredményeket', 'a játék lebonyolítása; szerződés', 'a szoba megszűnéséig'],
      ['Discord-összekötés (tárgyalás)', 'ha önként összekötöd a fiókodat a Discord-fiókoddal: a Discord-azonosító és -felhasználónév, a tárgyalás-jelentkezéseid', 'a Discord-szerveren szervezett tárgyalások; hozzájárulás / szerződés', 'a kapcsolat megszüntetéséig vagy a fiók törléséig'],
      ['Kártyacsomagok (Kártyaműhely)', 'a fiókkal készített csomagok: a csomag neve, leírása, láthatósága (privát / nyilvános), a kártyaszövegek, a készítő felhasználóneve, a mentett csomagok listája, a csomagokra érkezett jelentések (jelentő fiók-azonosítója). A <b>nyilvános</b> csomag, a leírása, a kártyái és a készítő felhasználóneve a könyvtárban mindenki számára látható; a privát csomag csak a 6 jegyű kódot ismerők számára', 'a közösségi tartalom (saját játékmód) szolgáltatása és moderálása; szerződés, jogos érdek', 'a csomag vagy a fiók törléséig (a fiók törlésekor a csomagjaid is törlődnek)'],
      ['Moderáció, jelentések', 'a játékosok jelentései (jelentő, jelentett név, a jelentett üzenet szövege), némítások; a Discord-szerveren – ha be van kapcsolva – szabályalapú automatikus moderáció, amelynek döntései moderátorral felülvizsgálhatók', 'a közösség védelme, szabálysértések kezelése; jogos érdek', 'a legutóbbi ~100 jelentést őrizzük; a némítás legfeljebb 7 napos'],
      ['Hibajelentések', 'a leírás, a megadott név, a képernyő neve, a szobakód, a böngésző típusa (user agent) és az opcionálisan csatolt képernyőkép. A jelentés a fejlesztők privát Discord-csatornájába kerül', 'hibajavítás, szolgáltatásminőség; jogos érdek, a küldéssel adott hozzájárulás', 'a hiba megoldásáig; a Discord-üzenetet a fejlesztők törölhetik'],
      ['Rendszer-levelek', 'e-mail-cím, név, a levél tartalma (megerősítő / visszaállító link, szobakód). Marketing- vagy hírlevél nincs', 'a regisztráció megerősítése, jelszó-visszaállítás, értesítések, meghívó; szerződés', 'a kézbesítő szolgáltató naplózási ideje szerint'],
      ['Üzemeltetési naplók', 'hibanapló (az e-mail-címek és tokenek eltávolításával), a tárhely- és hálózati szolgáltatók szerver-naplói (IP-cím, időpont, kért oldal)', 'a szolgáltatás biztonsága, hibaelhárítás; jogos érdek', 'a szolgáltatók beállítása szerint (általában rövid ideig)'],
      ['Mentések', 'az adatbázis napi biztonsági mentése', 'adatvesztés elleni védelem; jogos érdek', 'legfeljebb 14 napig; a törölt adat ennyi ideig még szerepelhet a mentésekben']
    ])) +
    sec('cimzettek', '3. Kik kezelik az adataidat? (adatfeldolgozók, címzettek)', '<p>Az adataidat nem adjuk el, és nem adjuk át marketing célra. Az alábbi szolgáltatók a nevünkben, a szolgáltatás működtetéséhez dolgoznak fel adatokat:</p>' + table(['Szolgáltató', 'Mit végez', 'Hol'], [
      ['Render', 'az alkalmazás futtatása', (cfg.renderRegion ? esc(cfg.renderRegion) : todo('LEGAL_RENDER_REGION (pl. Frankfurt, EU)')) + '; az üzemeltető USA-beli cég'],
      ['Neon', 'adatbázis (fiókok, játékadatok, mentések)', (cfg.neonRegion ? esc(cfg.neonRegion) : todo('LEGAL_NEON_REGION (pl. Frankfurt, EU)')) + '; az üzemeltető USA-beli cég'],
      ['Cloudflare', 'DNS-kezelés, és a beállítástól függően a forgalom átengedése (ilyenkor a kéréseid áthaladnak rajta)', 'globális hálózat; USA-beli cég'],
      ['Resend', 'rendszer-levelek kézbesítése', 'EU (Írország); USA-beli cég'],
      ['Discord', 'Discord-belépés, közösségi szerver, hibajelentések fogadása (privát csatorna)', 'USA; a Discord saját adatkezelési tájékoztatója is érvényes'],
      ['Google', 'Google-belépés; a betűtípusok betöltése (Google Fonts): ilyenkor a böngésződ IP-címe a Google-hoz kerül', 'USA; a Google saját adatkezelési tájékoztatója is érvényes'],
      ['Ko-fi', 'önkéntes támogatás: csak ha a támogatás gombra kattintasz, ekkor az ő oldalukra lépsz; tőlük nem kapunk bankkártya- vagy más pénzügyi adatot', 'az ő feltételeik szerint']
    ]) + '<p>Hatóságnak csak jogszabályi kötelezettség alapján adunk ki adatot.</p>') +
    sec('harmadik', '4. Adattovábbítás az EGT-n kívülre', '<p>A fenti szolgáltatók egy része az Egyesült Államokban működik, ezért az adataid az EGT-n kívülre is kerülhetnek. A szolgáltatók adatvédelmi megállapodásai az adatvédelmi jogszabályoknak megfelelő garanciákat (általános szerződési feltételek, illetve az EU–USA adatvédelmi keretrendszer) tartalmazzák. Ahol lehetett, EU-s régiót választottunk.</p>') +
    sec('sutik', '5. Sütik és helyi tárolás', '<p>Csak a működéshez feltétlenül szükséges tárolást használjuk, ezért nincs süti-sáv. <b>Nem használunk analitikai, hirdetési vagy követő sütiket.</b></p>' + ul([
      '<b>kb_account</b> (süti, HttpOnly): a bejelentkezett munkamenet; kijelentkezéskor, lejáratkor törlődik.',
      '<b>kb_oauth_*</b> (süti, pár percig): a Google / Discord belépés biztonságos lebonyolítása.',
      '<b>Böngészőtár (localStorage / sessionStorage)</b>: a játékos neve, szobakódja és ülésazonosítója (hogy F5 után visszatérj a szobádba), avatár, hangbeállítások, a súgó láttatása. Ezek nem hagyják el a böngésződet, kivéve a szobába visszatéréshez szükséges azonosítókat, amelyeket a játék szervere ellenőriz.'
    ]) + '<p>Harmadik féltől a betűtípusokat töltjük be (Google Fonts); ez a böngésződ IP-címét a Google felé továbbítja.</p>') +
    sec('gyerekek', '6. Gyermekek és fiatalok', '<p>A fiókos regisztrációhoz legalább <b>' + cfg.minAge + ' évesnek</b> kell lenni. A ' + cfg.minAge + ' évnél fiatalabbak számára a regisztráció csak a szülői felügyeletet gyakorló személy hozzájárulásával és tudtával engedett; ebben az esetben a szülő vagy gondviselő keresse az üzemeltetőt a(z) ' + mail(cfg) + ' címen. A szülő bármikor kérheti a gyermek fiókjának és adatainak törlését.</p><p>A játék <b>vendégként, fiók és e-mail-cím nélkül</b> is játszható, ilyenkor csak a beírt játékosnevet (és az eredményeit név szerint) kezeljük. A játékosoknak nem kérünk valódi nevet, címet vagy telefonszámot, és kérjük, hogy ilyet ne is adjanak meg a játékban. A játék és a közösségi szerver szabályai tiltják a felnőtt tartalmat és a kiskorúak zaklatását; lásd a <a href="/felhasznalasi-feltetelek#viselkedes">Felhasználási feltételeket</a>.</p>') +
    sec('biztonsag', '7. Adatbiztonság', ul([
      'A kapcsolat titkosított (HTTPS).',
      'A jelszavak sózott scrypt-kivonatként tárolódnak; a munkamenet-, megerősítő és visszaállító tokenek csak lenyomatként; a megerősítő és visszaállító link lejáró és egyszer használható.',
      'Sebességkorlátok védik a belépést, a levélküldést és a jelentéseket; a hibanaplóból az e-mail-címek és tokenek kikerülnek.',
      'A hozzáférés az adatokhoz az üzemeltetőre és a szükséges szolgáltatókra korlátozott.'
    ])) +
    sec('jogok', '8. Milyen jogaid vannak, és hogyan élhetsz velük?', ul([
      '<b>Hozzáférés és adathordozhatóság</b>: a profilodon az „Adataim letöltése” gombbal a fiókodhoz tartozó adatok letölthetők (JSON).',
      '<b>Helyesbítés</b>: a kártyád adatait és a nevedet a profil módosításánál átírhatod.',
      '<b>Törlés</b>: a profilodban a „Fiók törlése” azonnal törli a fiókodat és a hozzá tartozó adatokat (munkamenetek, privát üzenetek, statisztika, Discord-kapcsolat); a mentésekből legfeljebb 14 nap alatt tűnik el.',
      '<b>Korlátozás, tiltakozás, hozzájárulás visszavonása</b>: jogos érdeken alapuló kezelés ellen tiltakozhatsz, a hozzájárulásodat bármikor visszavonhatod (pl. a Discord-kapcsolat megszüntetésével).',
      'Kéréseidet e-mailben (' + mail(cfg) + ') is jelezheted; <b>egy hónapon belül</b> válaszolunk. A kérés teljesítéséhez szükség esetén azonosítjuk magunkat a fiók e-mail-címén.'
    ])) +
    sec('jogorvoslat', '9. Jogorvoslat', authorityHtml(cfg)) +
    sec('automatikus', '10. Automatizált döntéshozatal, adatvédelmi incidens', '<p>Jogi hatású automatizált döntéshozatalt vagy profilozást nem végzünk. Adatvédelmi incidens esetén a jogszabályi határidőn belül értesítjük a hatóságot, és ha szükséges, az érintetteket is.</p>') +
    sec('modositas', '11. Módosítások', '<p>Ha a játék működése vagy ez a tájékoztató változik, frissítjük ezt az oldalt (a verzió és a dátum a lap tetején látható); lényeges változásról a játékban is tájékoztatunk. A korábbi verziót kérésre elküldjük.</p>');
  return layout(cfg, 'adatkezeles', 'Adatkezelési tájékoztató', 'Milyen személyes adatokat kezelünk, ki kezeli őket, mire használjuk, meddig őrizzük, és milyen jogaid vannak.', body);
}

function lawHtml(cfg) {
  const complaint = 'Panaszoddal először minket keress (' + mail(cfg) + '). ';
  if (cfg.country === 'AT') {
    return '<p>Ezekre a feltételekre az osztrák jog az irányadó, azzal, hogy a fogyasztónak minősülő felhasználónak a lakóhelye szerinti állam kötelező fogyasztóvédelmi rendelkezései által nyújtott védelem nem csorbul. ' + complaint + 'Fogyasztóként a lakóhelyed szerinti hatóságnál, illetve alternatív vitarendezési szervnél (Magyarországon a megyei békéltető testületnél) is élhetsz jogaiddal, és bírósághoz is fordulhatsz.</p>';
  }
  return '<p>Ezekre a feltételekre a magyar jog az irányadó. ' + complaint + 'Fogyasztónak minősülő felhasználó a lakóhelye szerint illetékes békéltető testülethez fordulhat, illetve bírósághoz is fordulhat.</p>';
}

// ---------- 3. Felhasználási feltételek és játékszabályok ----------
function terms(cfg) {
  const body =
    sec('elfogadas', '1. Elfogadás, hatály', '<p>A ' + SITE_NAME + ' (a „Játék”) használatával, illetve a regisztrációval elfogadod ezeket a feltételeket és az <a href="/adatkezeles">Adatkezelési tájékoztatót</a>. Ha nem értesz egyet velük, kérjük, ne használd a Játékot. A szolgáltató: ' + val(cfg.name, 'LEGAL_OPERATOR_NAME') + ' (lásd <a href="/impresszum">Impresszum</a>).</p>') +
    sec('szolgaltatas', '2. A szolgáltatás', ul([
      'A Játék <b>ingyenes</b> online party játék: valaki vádol, valaki védekezik, az esküdtek pedig ítélkeznek. Fiók nélkül, <b>vendégként</b> is játszható.',
      'Fiókkal további funkciók érhetők el (kártya, statisztika, ranglista, barátok, bolt, napi küldetések, Discord-összekötés).',
      'A Játék <b>béta állapotú</b>: hibák, szünetek és adatvesztés előfordulhatnak (pl. a szobák a szerver újraindításakor megszűnnek). Szolgáltatás-folytonosságot nem vállalunk.',
      'A játékon belüli <b>pogácsa</b> és a bolt tárgyai virtuális, szórakoztató elemek: <b>nincs pénzbeli értékük</b>, nem válthatók valódi pénzre, és valódi pénzzel nem vásárolhatók.'
    ])) +
    sec('fiok', '3. Regisztráció és fiók', ul([
      'Fiókot legalább <b>' + cfg.minAge + ' éves</b> személy hozhat létre; ' + cfg.minAge + ' év alatt csak a szülői felügyeletet gyakorló személy hozzájárulásával (lásd az Adatkezelési tájékoztató „Gyermekek és fiatalok” részét).',
      'Valós, általad használt e-mail-címet adj meg; a regisztrációt e-mailben kell megerősítened.',
      'A jelszavadat tartsd titokban; a fiókod használatáért te felelsz. Ha gyanús mozgást látsz, azonnal váltass jelszót, és jelezd nekünk.',
      'A felhasználónév ne legyen megtévesztő, sértő, jogsértő, és ne mások (pl. az üzemeltetők, moderátorok, ismert személyek) nevében lépj fel.',
      'Egy személynek egy fiókot javasolunk. A fiókodat bármikor törölheted a profilodban.'
    ])) +
    sec('jatekszabalyok', '4. Játékszabályok', ul([
      '<b>A játék fikció.</b> A „vádak”, „bizonyítékok” és „ítéletek” kitalált, humoros játékelemek. Valós személyekre, valós eseményekre vonatkozó állításokat a játékban ne tegyél.',
      '<b>Szerepek.</b> Minden körben más a szereposztás (bíró, ügyész, védő, vádlott, tanú, esküdt). A szerepedet a játék osztja ki, és a szerepeddel összhangban játszol. A részletes útmutató a játékban az <b>„i”</b> gombbal érhető el.',
      '<b>Tisztességes játék.</b> Tilos a csalás: hibák (exploitok) szándékos kihasználása, automatizált eszközök (botok, szkriptek) használata, többféle fiókkal egy szoba megtévesztése, a játék szándékos akadályozása.',
      '<b>A szoba a gazdáé.</b> A szoba házigazdája dönthet a szoba beállításairól és a játékosok eltávolításáról; a kirúgott játékos ne próbáljon visszalépni.'
    ])) +
    sec('viselkedes', '5. Közösségi viselkedési szabályok', '<p>A játékban, a csevegésben, a nevekben, a kártyaszövegekben és a Discord-szerveren egyaránt érvényes:</p>' + ul([
      '<b>Tiszteld a többieket.</b> A vicc rendben van, a bántás nem: tilos a zaklatás, megfélemlítés, gyűlöletbeszéd, a személyes dolgokon való gúnyolódás.',
      '<b>Kiskorúak védelme.</b> Tilos a felnőtt, szexuális vagy erőszakos tartalom. Tilos kiskorúakat (de bárkit) magánéleti, szexuális jellegű vagy kapcsolatfelvételre irányuló üzenetekkel zaklatni, vagy őket személyes adatok megadására, találkozóra rávenni. Az ilyen viselkedést azonnal kitiltással és szükség esetén hatósági bejelentéssel kezeljük.',
      '<b>Személyes adatok.</b> Ne add ki mások (és a saját) valódi nevét, címét, telefonszámát, iskoláját, fiók- vagy jelszóadatait. Ne tegyél közzé magán- vagy magánéleti képet, üzenetet engedély nélkül.',
      '<b>Nincs spam és reklám</b>, illetéktelen meghívó vagy link, és nincs jogsértő vagy kalóz tartalom.',
      'A nevek és kártyaszövegek ne legyenek sértők, politikai vagy vallási gyűlöletkeltők, és ne utaljanak valós személyek megbélyegzésére.'
    ])) +
    sec('moderacio', '6. Moderáció és szankciók', '<p>A szabályok betartását moderátorok és automatikus (szabályalapú) szűrők segítik. Szabályszegés esetén: <b>figyelmeztetés → némítás → kitiltás vagy fiók felfüggesztése / törlése</b>; súlyos esetben (pl. kiskorú zaklatása, jogsértés) azonnal a legszigorúbb lépés is jöhet. A játékosok a játékon belüli <b>Jelentés</b> funkcióval vagy a Discord-szerveren tudnak bejelenteni.</p><p>Ha vitatod a döntést, írj a(z) ' + mail(cfg) + ' címre; a panaszt a lehető leghamarabb megvizsgáljuk. A jogszabály által előírt esetben a hatóságoknak adatot adhatunk.</p>') +
    sec('tartalom', '7. A te tartalmad', '<p>A beírt tartalmakért (név, kártyaszövegek, csevegés, jelentések) te felelsz. Azzal, hogy beírod, engedélyt adsz arra, hogy a Játék ezeket a szolgáltatás működéséhez megjelenítse a többi játékosnak. A jogsértő tartalmat eltávolíthatjuk.</p>' +
      '<p><b>Kártyaműhely (közösségi csomagok).</b> Bejelentkezett fiókkal saját kártyacsomagot készíthetsz. A csomagot a közösségi viselkedési szabályok (5. pont) szerint kell megírnod; link, meghívó, @ és a durva, másokat bántó, valós személyeket megbélyegző vagy jogsértő tartalom nem megengedett. A <b>nyilvános</b> csomagot a felhasználóneveddel együtt bárki megnézheti, elmentheti és a saját tárgyalásában használhatja; a <b>privát</b> csomagot csak a kódját ismerők érik el. Azzal, hogy a csomagot nyilvánossá teszed vagy a kódját megosztod, engedélyt adsz erre, a csomag törléséig; a már futó szobák a csomag pillanatfelvételével játszhatnak tovább. A csomagot bármikor átállíthatod privátra vagy törölheted. A játékosok a nyilvános csomagot jelenthetik; három különböző jelentés után a csomag automatikusan elbújik, és az üzemeltető átnézi, törölheti vagy visszaállíthatja. Szabályszegő csomagot figyelmeztetés nélkül is eltávolíthatunk, ismétlődő szabályszegésnél a csomagkészítés korlátozható.</p>') +
    sec('tamogatas', '8. Önkéntes támogatás', '<p>A Játék támogatható a <a href="/tamogatas">támogatási oldalon</a> keresztül a Ko-fi platformon. A támogatás <b>teljesen önkéntes</b>, nem jár érte ellenszolgáltatás vagy játékbeli előny, és nem vásárlás. A fizetést a Ko-fi kezeli, nálunk nem fut fizetés, és bankkártyaadatot sem kapunk.</p>') +
    sec('szellemi', '9. Szellemi tulajdon', '<p>A Játék szövege, kódja és grafikái az üzemeltetőt vagy jogosultjait illetik, a Játék használata nem jelent tulajdonjog-átruházást. A grafikák egy része generatív eszközökkel készült. Az engedély nélküli másolás és terjesztés tilos.</p>') +
    sec('felelosseg', '10. Felelősség', '<p>A Játékot „adott állapotában” biztosítjuk, ingyenesen. Nem vállalunk felelősséget a szolgáltatás kieséséért, az adatvesztésért vagy a játékosok által beírt tartalmakért, amennyiben a jogszabály ezt lehetővé teszi; a jogszabály által ki nem zárható felelősségünk (pl. szándékos vagy súlyos károkozás, személyi sérülés) érintetlen marad.</p>') +
    sec('megszunes', '11. Megszűnés', '<p>A fiókodat bármikor törölheted. Mi a fiókot felfüggeszthetjük vagy törölhetjük, ha a szabályokat megszeged, illetve ha a szolgáltatást megszüntetjük (erről előre tájékoztatunk, amennyiben lehetséges).</p>') +
    sec('jog', '12. Irányadó jog, jogviták', lawHtml(cfg)) +
    sec('modositas', '13. Módosítás', '<p>A feltételeket módosíthatjuk; a módosítás az oldalon való közzététellel lép hatályba (a verzió és a dátum a lap tetején látható). Lényeges módosításról a játékban is tájékoztatunk, a Játék további használata a módosított feltételek elfogadását jelenti.</p>');
  return layout(cfg, 'felhasznalasi-feltetelek', 'Felhasználási feltételek és játékszabályok', 'A ' + SITE_NAME + ' használatának feltételei, a játékszabályok és a közösségi viselkedési szabályok.', body);
}

/**
 * @param {object} o { env, origin }
 * @returns {{ router, config, missing, version }}
 */
function createLegal(o = {}) {
  const env = o.env || process.env;
  const cfg = loadConfig(env, o.origin);
  const router = express.Router();
  const send = (render) => (req, res) => {
    res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.send(render(cfg));
  };
  router.get(['/impresszum', '/impresszum/', '/imprint'], send(imprint));
  router.get(['/adatkezeles', '/adatkezeles/', '/adatkezelesi-tajekoztato', '/privacy'], send(privacy));
  router.get(['/felhasznalasi-feltetelek', '/felhasznalasi-feltetelek/', '/terms', '/aszf'], send(terms));
  router.get('/jatekszabalyok', (req, res) => res.redirect(302, '/felhasznalasi-feltetelek#jatekszabalyok'));
  return { router, config: cfg, missing: () => missingOf(cfg), version: LEGAL_VERSION, minAge: cfg.minAge };
}

module.exports = { createLegal, LEGAL_VERSION, loadConfig, missingOf, esc };
