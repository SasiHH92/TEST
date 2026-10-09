'use strict';
// A csatornákba kerülő embedek. A footer végén lévő "kamu:<kulcs>" jelölő alapján találja meg
// a bot a saját korábbi üzenetét, így újrafuttatáskor nem duplikál.
const { EmbedBuilder } = require('discord.js');

const GOLD = 0xc9a227;
const marker = (key) => `kamu:${key}`;

function gameUrl() {
  return (process.env.KAMU_GAME_URL || '').trim().replace(/\/+$/, '');
}

function base(key, title, color = GOLD) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: `Kamu Bíróság • ${marker(key)}` });
}

// A {rules} helyére a szabályzat csatorna említése kerül (ha ismert).
const EMBEDS = {
  welcome() {
    const url = gameUrl();
    const e = base('welcome', '⚖️ Üdvözlünk a Kamu Bíróságon!')
      .setDescription([
        'Felkelt a bíróság, a vádlottak padja üres, a bizonyítékok pedig… nos, **kamuk**.',
        '',
        'A **Kamu Bíróság** egy online party játék: valaki vádol, valaki védekezik, valaki hazudik –',
        'az esküdtek pedig eldöntik, kinek hisznek. Hangchaten még jobb!',
      ].join('\n'))
      .addFields(
        { name: '🚪 Hogyan kezdj?', value: '1. Kattints a gombra lent, és vedd fel a **⚖️ Játékos** rangot.\n2. Olvasd el a {rules} csatornát.\n3. Nézz be a **🎮・játék-kereső**be, és csatlakozz egy tárgyalóteremhez!' },
        { name: '🔊 Hang', value: 'Játék közben ülj be egy **Tárgyalóterem** hangcsatornába – a bírósághoz hang dukál.' },
      );
    if (url) e.addFields({ name: '🎮 Játék', value: `[Belépés a tárgyalóterembe](${url})` });
    return e;
  },
  rules() {
    return base('rules', '📜 Házirend – a Kamu Bíróság törvénykönyve')
      .setDescription('Aki belép, elfogadja. A tudatlanság nem mentesít, a hazugság viszont a játék része (csak ott).')
      .addFields(
        { name: '§1 Tiszteld a többieket', value: 'Vicc oké, bántás nem. Se gúnyolódás személyes dolgokon, se gyűlöletbeszéd, se zaklatás.' },
        { name: '§2 A kamu csak a játékban kamu', value: 'A játékban hazudhatsz bátran – a szerveren viszont ne téveszts meg senkit.' },
        { name: '§3 Nincs spam', value: 'Ne árasszd el a csatornákat, ne reklámozz, ne küldj idegen meghívót. A szobakódok a 🔑・szobakódok csatornába valók.' },
        { name: '§4 Megfelelő csatorna', value: 'Mém a 😂・mémekbe, hiba a 🐛・hibajelentésbe, ötlet a 💡・ötletekbe.' },
        { name: '§5 Nincs tiltott tartalom', value: 'Nincs felnőtt vagy erőszakos tartalom, nincs személyes adatok kiteregetése, nincsenek kalózlinkek.' },
        { name: '§6 A moderátorok szava ítélet', value: 'Kérdésed van egy döntéssel kapcsolatban? Írj egy moderátornak privátban. A nyilvános vita nem fellebbezés.' },
        { name: '§7 Discord irányelvek', value: 'A Discord Felhasználási Feltételei és Közösségi irányelvei ránk is vonatkoznak.' },
        { name: '⚠️ Következmények', value: 'Figyelmeztetés → némítás → kitiltás. A súlyos esetek egyből a harmadik fokozatra ugranak.' },
      );
  },
  faq() {
    const url = gameUrl();
    const fields = [
      { name: 'Mi ez a játék?', value: 'Online party játék: valaki vádol, a többiek védenek, bizonyítanak, esküdtként döntenek.' },
      { name: 'Hogyan játszunk együtt?', value: 'A játék szobákban fut; a szobakódot oszd meg a 🔑・szobakódok csatornában.' },
      { name: 'Kell hozzá hang?', value: 'Nem kötelező, de sokkal jobb. Használd a **Tárgyalóterem** hangcsatornákat.' },
      { name: 'Hibát találtam!', value: 'Ha tesztelő vagy: 🐛・hibajelentés. Ha nem, szólj egy moderátornak.' },
    ];
    if (url) fields.push({ name: 'Hol játszhatok?', value: url });
    return base('faq', '❓ Gyakran ismételt kérdések').addFields(fields);
  },
  bugs() {
    return base('bugs', '🐛 Hibajelentés sablon', 0xe74c3c)
      .setDescription('Másold be a sablont egy új posztba, és töltsd ki. Minél pontosabb vagy, annál gyorsabban javítjuk!')
      .addFields(
        {
          name: 'Sablon',
          value: [
            '```',
            'Eszköz/böngésző:',
            'Mi történt:',
            'Mit kellett volna történnie:',
            'Megismételhető-e: (igen / nem / néha)',
            'Szobakód:',
            'Kép/videó: (csatold a poszthoz)',
            '```',
          ].join('\n'),
        },
        { name: 'Tippek', value: '• Egy poszt = egy hiba.\n• Válassz címkét (pl. Hang / Voice, Mobil, Kritikus).\n• Mielőtt újat nyitsz, nézd meg a 📋・ismert-hibák csatornát.' },
      );
  },
  ideas() {
    return base('ideas', '💡 Ötletláda', 0xf39c12)
      .setDescription('Új kártya, játékmód vagy szerep jutott eszedbe? Nyiss új posztot!')
      .addFields({ name: 'Jó ötletposzt', value: '• Egy poszt = egy ötlet.\n• Írd le, mi a lényege, és miért lenne szórakoztató.\n• Válassz címkét (Játékmód, Kártya, Szerep…).\n• Szavazz a többiek ötleteire reakcióval!' });
  },
  lfg() {
    const url = gameUrl();
    const e = base('lfg', '🎮 Játék-kereső', 0x2ecc71)
      .setDescription('Csapatot keresel, vagy tárgyalást nyitottál? Itt találtok egymásra.')
      .addFields(
        { name: 'Ajánlott formátum', value: '`Szobakód:` ____\n`Hány fő kell:` ____\n`Hangcsatorna:` Tárgyalóterem #__' },
        { name: 'Szabályok', value: 'Lassított mód van érvényben, ne spamelj. A kód a 🔑・szobakódok csatornába is mehet.' },
      );
    if (url) e.addFields({ name: '🎮 Játék', value: `[Nyiss szobát](${url})` });
    return e;
  },
};

// Az #üdvözlünk embed „Játékos leszek” gombja
const JOIN_BUTTON_ID = 'kamu:join-player';

function build(key, ctx = {}) {
  const json = EMBEDS[key]().toJSON();
  const rules = ctx.rulesChannelId ? `<#${ctx.rulesChannelId}>` : '📜・szabályzat';
  json.fields = (json.fields || []).map((f) => ({ ...f, value: f.value.replace('{rules}', rules) }));
  return new EmbedBuilder(json);
}

// Megvan-e a jelölő a (saját) üzenet embedjében?
function hasMarker(message, key) {
  return (message.embeds || []).some((e) => e.footer && String(e.footer.text || '').includes(marker(key)));
}

module.exports = { EMBEDS, build, marker, hasMarker, JOIN_BUTTON_ID };
