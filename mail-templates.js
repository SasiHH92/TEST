'use strict';

// ============================================================
// KAMU BÍRÓSÁG – e-mail sablonok (egységes, e-mail-kompatibilis HTML + sima szöveges változat)
//
// Szabályok (Gmail / Outlook / mobil):
//   - táblázatalapú elrendezés, inline CSS (a <style> csak a keskeny kijelzős igazításhoz kell, nélküle is jól néz ki),
//   - 600 px maximális szélesség, külső CSS / JavaScript / webfont nélkül,
//   - a fejléc grafikája az EMAIL_HEADER_IMAGE_URL címről jön; kép nélkül (vagy ha a levelező letiltja) szöveges fejléc látszik,
//   - minden felhasználói szöveg HTML-escape-elve kerül a levélbe, a linkek csak https/http címek lehetnek.
// A sablonok tiszta függvények: render(név, adat, beállítás) -> { subject, html, text }.
// ============================================================

const COLORS = {
  page: '#1D0A12',      // a levél háttere (nagyon sötét bordó)
  burgundy: '#2B101A',  // sötét bordó
  burgundyLight: '#4A1A27',
  gold: '#D7B46A',      // arany
  goldLight: '#F3DFA2',
  ivory: '#F5E9D0',     // elefántcsont
  paper: '#FBF3E1',
  mahogany: '#3B1A12',  // sötét mahagóni (szöveg)
  mahoganySoft: '#6B4A3A',
  button: '#7B1B2B'
};
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const SANS = "'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (v) => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Csak http(s) cím kerülhet href / src attribútumba (a "javascript:" és hasonlók kiszűrve).
const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');

// ---------- közös építőelemek ----------

function header(cfg) {
  const img = String(cfg.headerImage || '').toLowerCase().startsWith('https://') ? safeUrl(cfg.headerImage) : ''; // a fejlécképhez csak https cím jó
  const brand = '<tr><td align="center" bgcolor="' + COLORS.burgundy + '" style="background-color:' + COLORS.burgundy + ';padding:30px 24px 26px;border-radius:14px 14px 0 0;">' +
    '<div style="font-family:' + SERIF + ';font-size:13px;letter-spacing:4px;color:' + COLORS.gold + ';text-transform:uppercase;">&#9878;&#65039; Rendőrségi nyilvántartás &#9878;&#65039;</div>' +
    '<div style="font-family:' + SERIF + ';font-size:36px;line-height:42px;font-weight:bold;color:' + COLORS.goldLight + ';letter-spacing:1px;padding-top:8px;">KAMU BÍRÓSÁG</div>' +
    '<div style="font-family:' + SANS + ';font-size:12px;letter-spacing:2px;color:' + COLORS.ivory + ';padding-top:8px;text-transform:uppercase;">Kizárólag büntetlen poénok</div>' +
    '</td></tr>';
  if (!img) return brand;
  // A grafikus fejléc: a kép alatt marad a márka-szöveg alt-ként, így kikapcsolt képeknél is olvasható.
  return '<tr><td align="center" bgcolor="' + COLORS.burgundy + '" style="background-color:' + COLORS.burgundy + ';border-radius:14px 14px 0 0;line-height:0;font-size:0;">' +
    '<img src="' + esc(img) + '" width="600" alt="Kamu Bíróság – ' + esc(cfg.tagline || 'tárgyalóterem') + '" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;border-radius:14px 14px 0 0;font-family:' + SERIF + ';font-size:28px;line-height:34px;color:' + COLORS.goldLight + ';text-align:center;">' +
    '</td></tr>';
}

function divider() {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;"><tr>' +
    '<td width="46%" style="border-top:1px solid ' + COLORS.gold + ';font-size:0;line-height:0;">&nbsp;</td>' +
    '<td width="8%" align="center" style="font-size:16px;line-height:16px;padding:0 6px;color:' + COLORS.gold + ';font-family:' + SERIF + ';">&#9878;</td>' +
    '<td width="46%" style="border-top:1px solid ' + COLORS.gold + ';font-size:0;line-height:0;">&nbsp;</td>' +
    '</tr></table>';
}

// "Bulletproof" gomb: táblázatcella + link (Outlookban VML-lel); bordó alap, arany keret és felirat.
function button(label, url) {
  const href = safeUrl(url);
  if (!href) return '';
  const lbl = esc(label);
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 4px;"><tr><td align="center">' +
    '<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="' + esc(href) + '" style="height:54px;v-text-anchor:middle;width:340px;" arcsize="20%" strokecolor="' + COLORS.gold + '" strokeweight="2pt" fillcolor="' + COLORS.button + '"><w:anchorlock/><center style="color:' + COLORS.goldLight + ';font-family:Georgia,serif;font-size:16px;font-weight:bold;letter-spacing:1px;">' + lbl + '</center></v:roundrect><![endif]-->' +
    '<!--[if !mso]><!-- --><a href="' + esc(href) + '" target="_blank" style="display:inline-block;background-color:' + COLORS.button + ';border:2px solid ' + COLORS.gold + ';border-radius:10px;padding:16px 30px;font-family:' + SERIF + ';font-size:16px;line-height:20px;font-weight:bold;letter-spacing:1px;color:' + COLORS.goldLight + ';text-decoration:none;text-transform:uppercase;mso-hide:all;">' + lbl + '</a><!--<![endif]-->' +
    '</td></tr></table>';
}

const p = (html, extra) => '<p style="margin:0 0 14px;font-family:' + SANS + ';font-size:16px;line-height:25px;color:' + COLORS.mahogany + ';' + (extra || '') + '">' + html + '</p>';
const small = (html) => '<p style="margin:12px 0 0;font-family:' + SANS + ';font-size:13px;line-height:20px;color:' + COLORS.mahoganySoft + ';">' + html + '</p>';

// A levél teste. opts: { preheader, title, bodyHtml, cta:{label,url}, fallbackLink, warning, footerNote }
function layout(cfg, opts) {
  const site = safeUrl(cfg.origin);
  const discord = safeUrl(cfg.discordUrl);
  const links = [];
  if (site) links.push('<a href="' + esc(site) + '" style="color:' + COLORS.gold + ';text-decoration:underline;">Játék</a>');
  if (discord) links.push('<a href="' + esc(discord) + '" style="color:' + COLORS.gold + ';text-decoration:underline;">Discord</a>');
  if (site) links.push('<a href="' + esc(site) + '/tamogatas" style="color:' + COLORS.gold + ';text-decoration:underline;">Támogatás</a>');
  const cta = opts.cta ? button(opts.cta.label, opts.cta.url) : '';
  const fallback = opts.cta && safeUrl(opts.cta.url)
    ? small('Ha a gomb nem működik, másold be ezt a címet a böngésződbe:<br><a href="' + esc(opts.cta.url) + '" style="color:' + COLORS.button + ';word-break:break-all;">' + esc(opts.cta.url) + '</a>') : '';
  const warning = opts.warning ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr><td style="background-color:#F0DDB4;border-left:4px solid ' + COLORS.button + ';padding:12px 16px;font-family:' + SANS + ';font-size:13px;line-height:20px;color:' + COLORS.mahogany + ';">' + opts.warning + '</td></tr></table>' : '';
  return '<!DOCTYPE html>\n<html lang="hu" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">\n<head>\n' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="X-UA-Compatible" content="IE=edge">' +
    '<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">' +
    '<title>' + esc(opts.title) + '</title>\n' +
    '<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->\n' +
    '<style>@media only screen and (max-width:620px){.kb-wrap{padding:0 !important}.kb-card{width:100% !important}.kb-pad{padding-left:20px !important;padding-right:20px !important}.kb-title{font-size:22px !important;line-height:28px !important;letter-spacing:1px !important}}</style>\n' +
    '</head>\n<body style="margin:0;padding:0;background-color:' + COLORS.page + ';-webkit-text-size-adjust:100%;">\n' +
    '<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:' + COLORS.page + ';">' + esc(opts.preheader) + '&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>\n' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="' + COLORS.page + '" style="background-color:' + COLORS.page + ';"><tr><td align="center" class="kb-wrap" style="padding:28px 12px;">\n' +
    '<table role="presentation" class="kb-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">\n' +
    header(cfg) +
    // cím: arany felirat sötét bordó sávon
    '<tr><td align="center" bgcolor="' + COLORS.burgundyLight + '" class="kb-pad" style="background-color:' + COLORS.burgundyLight + ';padding:22px 40px;border-top:2px solid ' + COLORS.gold + ';border-bottom:2px solid ' + COLORS.gold + ';">' +
    '<h1 class="kb-title" style="margin:0;font-family:' + SERIF + ';font-size:30px;line-height:36px;font-weight:bold;letter-spacing:2px;color:' + COLORS.gold + ';text-transform:uppercase;">' + esc(String(opts.title).toLocaleUpperCase('hu-HU')) + '</h1></td></tr>\n' +
    // törzs: elefántcsont papír
    '<tr><td class="kb-pad" bgcolor="' + COLORS.ivory + '" style="background-color:' + COLORS.ivory + ';padding:34px 44px 30px;">' +
    opts.bodyHtml + divider() + cta + fallback + warning + '</td></tr>\n' +
    // lábléc
    '<tr><td align="center" bgcolor="' + COLORS.burgundy + '" class="kb-pad" style="background-color:' + COLORS.burgundy + ';padding:26px 36px 28px;border-radius:0 0 14px 14px;">' +
    '<div style="font-family:' + SERIF + ';font-size:15px;line-height:23px;color:' + COLORS.goldLight + ';font-style:italic;">' + opts.footerNote + '</div>' +
    '<div style="border-top:1px solid ' + COLORS.gold + ';margin:18px auto 14px;width:120px;font-size:0;line-height:0;">&nbsp;</div>' +
    '<div style="font-family:' + SANS + ';font-size:12px;line-height:19px;color:' + COLORS.ivory + ';">' + (links.length ? links.join(' &nbsp;&bull;&nbsp; ') + '<br>' : '') +
    'Kamu Bíróság – független, magyar közösségi játék.<br>Ezt a levelet a Kamu Bíróság rendszere küldte, kérjük, ne válaszolj rá.</div>' +
    '</td></tr>\n</table>\n</td></tr></table>\n</body>\n</html>';
}

// ---------- sima szöveges változat ----------
const textOf = (lines) => lines.filter((l) => l !== null && l !== undefined).join('\n');

const FOOT = 'A bíróság figyelmeztet:<br>a túlzott nevetés nem mentesít<br>a felelősség alól!';
const FOOT_TEXT = 'A bíróság figyelmeztet: a túlzott nevetés nem mentesít a felelősség alól!';

// ---------- a sablonok ----------
const TEMPLATES = {
  // 1. Regisztráció megerősítése (a spec szerinti szöveggel)
  confirmEmail(d, cfg) {
    const url = d.url;
    return {
      subject: '⚖️ Kamu Bíróság – Megérkezett az idézésed!',
      html: layout(cfg, {
        preheader: 'A Kamu Bíróság hivatalosan beidézett! Már csak egy lépés a tárgyalóteremig.',
        title: 'Megérkezett az idézésed!',
        bodyHtml: p('Tisztelt Vádlott!', 'font-weight:bold;') + p('A Kamu Bíróság hivatalosan beidézett!') +
          p('Már csak egyetlen lépés választ el attól, hogy belépj a tárgyalóterembe.'),
        cta: { label: '⚖️ EMAIL-CÍM MEGERŐSÍTÉSE', url },
        warning: 'A megerősítő link <b>24 óráig</b> érvényes, és csak <b>egyszer</b> használható. Ha nem te regisztráltál, hagyd figyelmen kívül ezt a levelet: megerősítés nélkül a fiók nem lép életbe.',
        footerNote: FOOT
      }),
      text: textOf(['MEGÉRKEZETT AZ IDÉZÉSED!', '', 'Tisztelt Vádlott!', '', 'A Kamu Bíróság hivatalosan beidézett!', 'Már csak egyetlen lépés választ el attól, hogy belépj a tárgyalóterembe.', '',
        'EMAIL-CÍM MEGERŐSÍTÉSE:', url, '', 'A link 24 óráig érvényes, és csak egyszer használható. Ha nem te regisztráltál, hagyd figyelmen kívül ezt a levelet.', '', FOOT_TEXT])
    };
  },

  // 2. Üdvözlő levél (az e-mail-cím megerősítése után)
  welcome(d, cfg) {
    const name = esc(d.name || 'Vádlott');
    return {
      subject: '⚖️ Üdv a Kamu Bíróságon, ' + String(d.name || 'Vádlott').slice(0, 30) + '!',
      html: layout(cfg, {
        preheader: 'A fiókod él, a tárgyalóterem ajtaja nyitva áll.',
        title: 'Üdv a tárgyalóteremben!',
        bodyHtml: p('Tisztelt <b>' + name + '</b>!', '') + p('Az e-mail-címedet megerősítettük, a fiókod hivatalosan is bejegyzésre került a rendőrségi nyilvántartásban.') +
          p('<b>Hogyan kezdj?</b><br>1. Válassz karaktert, vagy nyiss saját tárgyalást.<br>2. Hívd meg a barátaidat a szobakóddal.<br>3. Vádolj, védekezz, hazudj – és ne felejts el nevetni.'),
        cta: { label: '🎮 BELÉPÉS A TÁRGYALÓTEREMBE', url: cfg.origin },
        footerNote: FOOT
      }),
      text: textOf(['ÜDV A TÁRGYALÓTEREMBEN!', '', 'Tisztelt ' + (d.name || 'Vádlott') + '!', '', 'Az e-mail-címedet megerősítettük, a fiókod él.', '1. Válassz karaktert, vagy nyiss saját tárgyalást.', '2. Hívd meg a barátaidat a szobakóddal.', '3. Vádolj, védekezz, hazudj – és ne felejts el nevetni.', '',
        'Belépés: ' + cfg.origin, cfg.discordUrl ? 'Discord: ' + cfg.discordUrl : null, '', FOOT_TEXT])
    };
  },

  // 3. Elfelejtett jelszó
  passwordReset(d, cfg) {
    const name = esc(d.name || 'Vádlott');
    return {
      subject: '⚖️ Kamu Bíróság – Új jelszó beállítása',
      html: layout(cfg, {
        preheader: 'Új jelszót kértél a Kamu Bíróság fiókodhoz. A link 1 óráig érvényes.',
        title: 'Új jelszót kértél?',
        bodyHtml: p('Tisztelt <b>' + name + '</b>!') + p('Valaki (remélhetőleg te) új jelszót kért a fiókodhoz. A bíróság szívesen segít: kattints az alábbi gombra, és válassz egy új, legalább 12 karakteres jelszót.'),
        cta: { label: '🔑 ÚJ JELSZÓ BEÁLLÍTÁSA', url: d.url },
        warning: 'A link <b>1 óráig</b> érvényes, és csak <b>egyszer</b> használható. Ha nem te kérted, hagyd figyelmen kívül ezt a levelet – a jelszavad nem változik.',
        footerNote: FOOT
      }),
      text: textOf(['ÚJ JELSZÓT KÉRTÉL?', '', 'Tisztelt ' + (d.name || 'Vádlott') + '!', '', 'Új jelszó beállításához nyisd meg ezt a linket:', d.url, '', 'A link 1 óráig érvényes, és csak egyszer használható. Ha nem te kérted, hagyd figyelmen kívül ezt a levelet.', '', FOOT_TEXT])
    };
  },

  // 4. A jelszó sikeres megváltoztatása
  passwordChanged(d, cfg) {
    const name = esc(d.name || 'Vádlott');
    return {
      subject: '⚖️ Kamu Bíróság – A jelszavad megváltozott',
      html: layout(cfg, {
        preheader: 'A fiókod jelszavát megváltoztattuk.',
        title: 'Jelszó megváltoztatva',
        bodyHtml: p('Tisztelt <b>' + name + '</b>!') + p('A Kamu Bíróság fiókod jelszava sikeresen megváltozott' + (d.when ? ' (' + esc(d.when) + ')' : '') + '. A többi eszközön a munkameneteid biztonsági okból kiléptek.'),
        cta: { label: '🔐 FIÓK ELLENŐRZÉSE', url: cfg.origin },
        warning: '<b>Nem te voltál?</b> Azonnal kérj új jelszót az „Elfelejtett jelszó?” linkkel a belépőoldalon, és írj nekünk a Discord-szerveren.',
        footerNote: FOOT
      }),
      text: textOf(['JELSZÓ MEGVÁLTOZTATVA', '', 'Tisztelt ' + (d.name || 'Vádlott') + '!', '', 'A Kamu Bíróság fiókod jelszava sikeresen megváltozott' + (d.when ? ' (' + d.when + ')' : '') + '. A többi eszközön kiléptettünk.', '',
        'Nem te voltál? Azonnal kérj új jelszót a belépőoldalon (Elfelejtett jelszó?): ' + cfg.origin, '', FOOT_TEXT])
    };
  },

  // 5. Játékmeghívó
  gameInvite(d, cfg) {
    const code = esc(d.code);
    const inviter = esc(d.inviter || 'Valaki');
    return {
      subject: '⚖️ Beidéztek a Kamu Bíróságra!',
      html: layout(cfg, {
        preheader: inviter + ' beidézett egy tárgyalásra. Szobakód: ' + String(d.code || ''),
        title: 'Beidéztek a Kamu Bíróságra!',
        bodyHtml: p('Valaki beidézett egy tárgyalásra!', 'font-weight:bold;') + p('<b>' + inviter + '</b> a saját tárgyalására hív meg. Gyere, vádolj, védekezz vagy esküdj – a bíróság már vár.') +
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:18px auto 6px;"><tr><td align="center" style="background-color:' + COLORS.burgundy + ';border:2px dashed ' + COLORS.gold + ';border-radius:10px;padding:14px 34px;">' +
          '<div style="font-family:' + SANS + ';font-size:12px;letter-spacing:3px;color:' + COLORS.ivory + ';text-transform:uppercase;">Szobakód</div>' +
          '<div style="font-family:\'Courier New\',Courier,monospace;font-size:34px;line-height:40px;font-weight:bold;letter-spacing:8px;color:' + COLORS.goldLight + ';">' + code + '</div></td></tr></table>',
        cta: { label: '🎮 CSATLAKOZÁS A TÁRGYALÁSHOZ', url: d.url },
        warning: 'Ezt a meghívót ' + inviter + ' küldte a Kamu Bíróság játékból. Ha nem ismered, nyugodtan hagyd figyelmen kívül; a szobához csak a linkkel vagy a kóddal lehet csatlakozni.',
        footerNote: FOOT
      }),
      text: textOf(['BEIDÉZTEK A KAMU BÍRÓSÁGRA!', '', 'Valaki beidézett egy tárgyalásra!', (d.inviter || 'Valaki') + ' a saját tárgyalására hív meg.', '', 'Szobakód: ' + d.code, '', 'CSATLAKOZÁS A TÁRGYALÁSHOZ:', d.url, '', 'Ha nem ismered a küldőt, hagyd figyelmen kívül ezt a levelet.', '', FOOT_TEXT])
    };
  },

  // 6. Biztonsági értesítés
  securityNotice(d, cfg) {
    const name = esc(d.name || 'Vádlott');
    const headline = esc(d.headline || 'Változás történt a fiókodon.');
    const details = Array.isArray(d.details) ? d.details.filter(Boolean).slice(0, 6) : [];
    const list = details.length ? '<ul style="margin:0 0 14px;padding-left:20px;font-family:' + SANS + ';font-size:15px;line-height:24px;color:' + COLORS.mahogany + ';">' + details.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '';
    return {
      subject: '⚖️ Kamu Bíróság – Biztonsági értesítés',
      html: layout(cfg, {
        preheader: String(d.headline || 'Változás történt a fiókodon.').slice(0, 90),
        title: 'Biztonsági értesítés',
        bodyHtml: p('Tisztelt <b>' + name + '</b>!') + p(headline) + list,
        cta: { label: '🔐 FIÓK ELLENŐRZÉSE', url: cfg.origin },
        warning: '<b>Nem te voltál?</b> Kérj új jelszót a belépőoldalon az „Elfelejtett jelszó?” linkkel, vagy írj nekünk a Discord-szerveren.',
        footerNote: FOOT
      }),
      text: textOf(['BIZTONSÁGI ÉRTESÍTÉS', '', 'Tisztelt ' + (d.name || 'Vádlott') + '!', '', d.headline || 'Változás történt a fiókodon.', ...details.map((x) => '- ' + x), '',
        'Nem te voltál? Kérj új jelszót a belépőoldalon (Elfelejtett jelszó?): ' + cfg.origin, '', FOOT_TEXT])
    };
  }
};

const NAMES = Object.keys(TEMPLATES);

/**
 * @param {string} name  sablon neve (confirmEmail, welcome, passwordReset, passwordChanged, gameInvite, securityNotice)
 * @param {object} data  a sablon adatai (pl. { name, url, code, inviter })
 * @param {object} cfg   { origin, headerImage, discordUrl }
 */
function render(name, data, cfg) {
  if (!TEMPLATES[name]) throw new Error('Ismeretlen e-mail sablon: ' + name);
  return TEMPLATES[name](data || {}, { origin: String(cfg && cfg.origin || '').replace(/\/+$/, ''), headerImage: cfg && cfg.headerImage || '', discordUrl: cfg && cfg.discordUrl || '', tagline: 'tárgyalóterem' });
}

// Minta-adatok az előnézethez és az üzemeltetői próbalevélhez (nincs bennük valódi token).
const SAMPLE = {
  confirmEmail: { url: 'https://example.invalid/#verify=MINTA-TOKEN' },
  welcome: { name: 'Minta Vádlott' },
  passwordReset: { name: 'Minta Vádlott', url: 'https://example.invalid/#reset=MINTA-TOKEN' },
  passwordChanged: { name: 'Minta Vádlott', when: '2026. október 12., 21:30' },
  gameInvite: { inviter: 'Minta Bíró', code: 'AB12', url: 'https://example.invalid/?room=AB12' },
  securityNotice: { name: 'Minta Vádlott', headline: 'Új belépési mód kapcsolódott a fiókodhoz.', details: ['Szolgáltató: Discord', 'Időpont: 2026. október 12., 21:30'] }
};

module.exports = { render, NAMES, SAMPLE, esc, safeUrl, COLORS };
