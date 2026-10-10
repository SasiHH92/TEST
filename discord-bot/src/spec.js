'use strict';
// A szerver teljes leírása adatként: role-ok, kategóriák, csatornák, jogosultság-presetek.
// A setup.js ezt építi fel / ellenőrzi / állítja helyre.

const { ChannelType, PermissionFlagsBits: P } = require('discord.js');

// Fentről lefelé: a lista sorrendje a hierarchia. A bot saját (integrációs) role-ja
// ezek FÖLÖTT kell legyen, különben nem tudja kezelni őket (lásd README).
const ROLES = [
  { key: 'owner', name: '👑 Tulajdonos', color: 0xf1c40f, hoist: true },
  { key: 'dev', name: '🛠️ Fejlesztő', color: 0x3498db, hoist: true },
  { key: 'mod', name: '🛡️ Moderátor', color: 0xe74c3c, hoist: true },
  { key: 'tester', name: '🧪 Tesztelő', color: 0x9b59b6, hoist: true },
  { key: 'player', name: '⚖️ Játékos', color: 0x2ecc71, hoist: false },
  { key: 'bot', name: '🤖 Bot', color: 0x95a5a6, hoist: true },
];

const STAFF = ['owner', 'dev', 'mod'];
const BETA = ['owner', 'dev', 'mod', 'tester'];

// Presetek. subject: 'everyone' | role-key | 'bot' (a bot saját felhasználója).
// A "bot" mindig megkapja a postoláshoz szükséges jogokat azokban a csatornákban, ahová ír.
const BOT_POST = [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.ReadMessageHistory, P.ManageThreads];

const PRESETS = {
  public: [],
  // Csak olvasható a normál játékosoknak; a stáb és a bot írhat.
  readonly: [
    { subject: 'everyone', allow: [P.ViewChannel, P.ReadMessageHistory], deny: [P.SendMessages, P.SendMessagesInThreads, P.CreatePublicThreads] },
    ...STAFF.map((s) => ({ subject: s, allow: [P.SendMessages, P.EmbedLinks, P.AttachFiles] })),
    { subject: 'bot', allow: BOT_POST },
  ],
  // Közösségi csatorna, ahová a bot is posztol (a többiek is írhatnak).
  community: [{ subject: 'bot', allow: BOT_POST }],
  // Bétás terület: csak Tulajdonos, Fejlesztő, Moderátor, Tesztelő látja.
  beta: [
    { subject: 'everyone', deny: [P.ViewChannel] },
    ...BETA.map((s) => ({ subject: s, allow: [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.AddReactions] })),
    { subject: 'bot', allow: BOT_POST },
  ],
  // Csak a stáb (Tulajdonos, Fejlesztő, Moderátor): pl. a moderációs napló. A tesztelők sem látják.
  staff: [
    { subject: 'everyone', deny: [P.ViewChannel] },
    ...STAFF.map((s) => ({ subject: s, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AddReactions] })),
    { subject: 'bot', allow: BOT_POST },
  ],
  voice: [{ subject: 'everyone', allow: [P.ViewChannel, P.Connect, P.Speak] }],
};

const BUG_TAGS = [
  { name: 'Kritikus', emoji: '🔥' },
  { name: 'Hang / Voice', emoji: '🔊' },
  { name: 'Szoba / Lobby', emoji: '🚪' },
  { name: 'Kinézet / UI', emoji: '🎨' },
  { name: 'Mobil', emoji: '📱' },
  { name: 'Megoldva', emoji: '✅' },
  { name: 'Nem reprodukálható', emoji: '❓' },
];
const IDEA_TAGS = [
  { name: 'Játékmód', emoji: '🎭' },
  { name: 'Kártya', emoji: '🃏' },
  { name: 'Szerep', emoji: '🧑‍⚖️' },
  { name: 'Kinézet / UI', emoji: '🎨' },
  { name: 'Közösség', emoji: '💬' },
  { name: 'Tervezett', emoji: '🗓️' },
  { name: 'Elfogadva', emoji: '✅' },
  { name: 'Elvetve', emoji: '🚫' },
];

// kind: text | forum | voice. embed: a content.js kulcsa. fallback: ha a szerver nem Community,
// a fórum helyett sima szövegcsatorna jön létre (a Discord csak Community szerveren enged fórumot).
const STRUCTURE = [
  {
    name: '📜 BÍRÓSÁG', perm: 'public',
    channels: [
      { name: '👋・üdvözlünk', kind: 'text', perm: 'readonly', embed: 'welcome', topic: 'Üdvözlünk a Kamu Bíróságon! Itt indul a tárgyalás.' },
      { name: '📜・szabályzat', kind: 'text', perm: 'readonly', embed: 'rules', topic: 'A bíróság házirendje. A tudatlanság nem mentesít.' },
      { name: '📢・bejelentések', kind: 'text', perm: 'readonly', topic: 'Hivatalos közlemények a Kamu Bíróság vezetésétől.' },
      { name: '📰・frissítések', kind: 'text', perm: 'readonly', topic: 'Újdonságok, új kártyák, javítások.' },
      { name: '❓・gyik', kind: 'text', perm: 'readonly', embed: 'faq', topic: 'Gyakran ismételt kérdések.' },
    ],
  },
  {
    name: '⚖️ KÖZÖSSÉG', perm: 'public',
    channels: [
      { name: '💬・általános', kind: 'text', perm: 'public', topic: 'Mindenről, ami nem vádirat.' },
      { name: '😂・mémek', kind: 'text', perm: 'public', topic: 'Kamu bizonyítékok és valódi mémek.' },
      { name: '📸・képek-videók', kind: 'text', perm: 'public', topic: 'Képernyőképek, klipek, tárgyalótermi pillanatok.' },
      { name: '💡・ötletek', kind: 'forum', perm: 'community', embed: 'ideas', tags: 'idea', fallbackKind: 'text', topic: 'Új kártya, játékmód vagy szerep? Nyiss egy posztot, és válassz címkét!' },
    ],
  },
  {
    name: '🎮 JÁTÉK', perm: 'public',
    channels: [
      { name: '🎮・játék-kereső', kind: 'text', perm: 'community', embed: 'lfg', slowmode: 30, topic: 'Csapat kell? Írd be, milyen szobába vársz játékosokat.' },
      { name: '🔑・szobakódok', kind: 'text', perm: 'community', slowmode: 15, topic: 'Szobakódok. Egy kód, egy üzenet, aztán irány a tárgyalóterem!' },
      { name: '🏆・eredmények', kind: 'text', perm: 'readonly', topic: 'A bíróság ítéletei és a hónap legnagyobb hazugjai.' },
      { name: '🔊 Tárgyalóterem #1', kind: 'voice', perm: 'voice' },
      { name: '🔊 Tárgyalóterem #2', kind: 'voice', perm: 'voice' },
      { name: '🔊 Tárgyalóterem #3', kind: 'voice', perm: 'voice' },
    ],
  },
  {
    name: '🧪 BÉTA / FEJLESZTÉS', perm: 'beta',
    channels: [
      { name: '🧪・tesztelők', kind: 'text', perm: 'beta', topic: 'Bétatesztelők közös csatornája.' },
      { name: '🐛・hibajelentés', kind: 'forum', perm: 'beta', embed: 'bugs', tags: 'bug', fallbackKind: 'text', topic: 'Hibát találtál? Nyiss új posztot a sablon szerint!' },
      { name: '💭・teszt-visszajelzés', kind: 'text', perm: 'beta', topic: 'Mit gondolsz a legújabb tesztverzióról?' },
      { name: '📋・ismert-hibák', kind: 'text', perm: 'beta', topic: 'Már ismert hibák – mielőtt újat jelentesz, nézd meg itt.' },
      { name: '🛡️・mod-napló', kind: 'text', perm: 'staff', topic: 'Automatikus moderáció naplója (csak a stáb látja). A némítás a gombbal visszavonható.' },
    ],
  },
];

const TAGS = { bug: BUG_TAGS, idea: IDEA_TAGS };

const TYPE_OF = { text: ChannelType.GuildText, forum: ChannelType.GuildForum, voice: ChannelType.GuildVoice };

module.exports = { ROLES, PRESETS, STRUCTURE, TAGS, TYPE_OF, BOT_POST };
