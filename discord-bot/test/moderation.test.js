'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const wordlists = require('../src/wordlists');
const { evaluate, createFloodTracker } = require('../src/modrules');
const { createModerator, LOG_NAME, UNDO_PREFIX } = require('../src/moderation');
const { parseVerdict } = require('../src/modai');
const { makeGuild } = require('./fake-guild');
const { runSetup, findChannel } = require('../src/setup');

const lists = wordlists.load('');
const rules = (text, ctx = {}) => evaluate(text, { lists, opts: {}, ...ctx }).findings.map((f) => f.rule);

test('szabályok: a mindennapi, játékhoz illő beszéd nem találat (hamis riasztások ellen)', () => {
  for (const ok of ['Szia mindenkinek!', 'a vádlott ellopta a pogácsát', 'Ki a bíró? Én leszek az ügyész!', 'A szarvas átugrotta a kerítést', 'Tavasz van, kikelet',
    'Bazalt oszlop a tárgyalóteremben', 'Vettem shiitake gombát', 'spicy food', 'A ő űrhajó óriás', 'KAMU BÍRÓSÁG', 'Jöhet a következő kör? 😂😂', 'https://youtube.com/watch?v=abc', 'https://tenor.com/view/x']) {
    assert.deepEqual(rules(ok), [], ok);
  }
});

test('szabályok: káromkodás és gyűlöletbeszéd elkapva ragozva, leet-ben, szétszórva, ismételt betűkkel', () => {
  for (const bad of ['te kurva', 'Kurvák', 'b4zdmeg', 'K U R V A', 'k.u.r.v.a', 'kurvaaaa', 'FUCK you', 'what the sh1t', 'geci']) assert.ok(rules(bad).includes('profanity'), bad);
  for (const bad of ['nigger', 'n1gg3r', 'dögölj meg', 'oldd meg magad', 'kys', 'Kill yourself', 'buzi vagy', 'sieg heil']) assert.ok(rules(bad).includes('hate'), bad);
  assert.equal(evaluate('te kurva', { lists, opts: { profanity: 'off' } }).findings.length, 0, 'MOD_PROFANITY=off');
});

test('szabályok: szólista-bővítés fájlból (MOD_WORDLIST_FILE) és kivételek', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const file = path.join(os.tmpdir(), 'kamu-wl-' + process.pid + '.json');
  fs.writeFileSync(file, JSON.stringify({ profanity: ['pogacsatolvaj*'], allow: ['kurvafix'] }));
  const l2 = wordlists.load(file);
  assert.ok(evaluate('te pogácsatolvaj', { lists: l2, opts: {} }).findings.some((f) => f.rule === 'profanity'));
  assert.deepEqual(evaluate('kurvafix', { lists: l2, opts: {} }).findings, []);
  fs.unlinkSync(file);
});

test('szabályok: meghívó, hasonmás-domain, IP-naplózó, átverés, rövidítő', () => {
  assert.ok(rules('gyere ide https://discord.gg/abcdef').includes('invite'));
  assert.ok(rules('https://dlscord-gift.com/claim').includes('phishing'));
  assert.ok(rules('nézd https://steamcommunlty.com/gift/1').includes('phishing'));
  assert.ok(!rules('https://discord.com/channels/1/2').includes('phishing'));
  assert.ok(rules('https://grabify.link/ABC').includes('bad-link'));
  assert.ok(rules('FREE NITRO https://bit.ly/x').includes('scam-text'));
  assert.ok(rules('free nitro for everyone, claim your reward').includes('scam-text'));
  assert.ok(rules('https://bit.ly/x').includes('shortener'));
});

test('szabályok: tömeges említés, formai spam, veszélyes melléklet', () => {
  assert.ok(rules('hé', { mentionUsers: 5 }).includes('mass-mention'));
  assert.ok(rules('hé', { mentionEveryone: true }).includes('mass-mention'));
  assert.ok(!rules('hé', { mentionUsers: 2 }).includes('mass-mention'));
  assert.ok(rules('EZ AZ ÜZENET CSUPA NAGYBETŰ ÉS HOSSZÚ').includes('caps'));
  assert.ok(rules('rövid KIÁLTÁS').length === 0);
  assert.ok(rules('😂'.repeat(14)).includes('emoji-flood'));
  assert.ok(rules('a' + 'h'.repeat(20)).includes('char-repeat'));
  assert.ok(rules('h' + '̶̷̸̵̴' + 'i').includes('zalgo'));
  assert.ok(rules('nézd', { attachments: [{ name: 'foto.exe' }] }).includes('exec-attachment'));
  assert.deepEqual(rules('kép', { attachments: [{ name: 'foto.png', contentType: 'image/png' }] }), []);
});

test('flood: gyors írás, ismétlés és több csatornás spam (hamis órával)', () => {
  let t = 0;
  const f = createFloodTracker({ now: () => t });
  let out = [];
  for (let i = 0; i < 6; i++) { out = f.check('u1', 'üzenet ' + i + ' valami', 'c1'); t += 500; }
  assert.ok(out.some((x) => x.rule === 'flood'));
  t += 60000;
  for (let i = 0; i < 3; i++) { out = f.check('u2', 'ugyanaz az üzenet', 'c1'); t += 2000; }
  assert.ok(out.some((x) => x.rule === 'repeat'));
  t += 120000;
  const a = f.check('u3', 'vedd meg most olcson', 'c1'); t += 1000;
  const b = f.check('u3', 'vedd meg most olcson', 'c2'); t += 1000;
  const c = f.check('u3', 'vedd meg most olcson', 'c3');
  assert.ok(!a.length && !b.some((x) => x.rule === 'cross-spam') && c.some((x) => x.rule === 'cross-spam'));
  t += 120000;
  assert.deepEqual(f.check('u4', 'normális beszélgetés', 'c1'), []);
});

// ---------- orchestrator hamis Discord-objektumokkal ----------
function setup({ config = {}, fetchImpl, now } = {}) {
  const logs = [];
  const sent = []; // naplócsatorna üzenetei
  const guild = { id: 'g1', name: 'Teszt', ownerId: 'owner', channels: { cache: new Collection() } };
  const logCh = { id: 'log1', name: LOG_NAME, type: ChannelType.GuildText, async send(p) { sent.push(p); } };
  guild.channels.cache.set(logCh.id, logCh);
  const mod = createModerator({ client: {}, log: { log() {}, error: (...a) => logs.push(a.join(' ')) }, now,
    config: { enabled: true, profanity: 'delete', ai: false, aiKey: '', aiModel: 'm', aiText: 'new', wordlistFile: '', ...config }, fetchImpl, setTimer: () => ({ unref() {} }) });
  let seq = 0;
  function member(id, { staff = false, joinedAgo = 365 * 86400000, moderatable = true } = {}) {
    const m = { id, guild, joinedTimestamp: (now ? now() : Date.now()) - joinedAgo, moderatable, timeouts: [],
      permissions: new PermissionsBitField(), roles: { cache: new Collection(staff ? [['r', { name: '🛡️ Moderátor' }]] : []) },
      async timeout(ms, why) { if (!moderatable) throw new Error('Missing Permissions'); this.timeouts.push([ms, why]); } };
    return m;
  }
  function msg(m, text, { attachments = [], channel = 'c1', dm = true, mentions = 0 } = {}) {
    const res = { deleted: false, dms: [], channelSent: [] };
    const atts = new Collection(attachments.map((a, i) => ['a' + i, a]));
    return Object.assign(res, {
      id: 'm' + (++seq), guild, guildId: 'g1', content: text, member: m, attachments: atts,
      author: { id: m.id, username: 'user' + m.id, bot: false, async send(t) { if (!dm) throw new Error('DM tiltva'); res.dms.push(t); } },
      mentions: { users: new Collection(Array.from({ length: mentions }, (_, i) => ['u' + i, {}])), roles: new Collection(), everyone: false },
      channel: { id: channel, name: 'általános', async send(p) { res.channelSent.push(p); return { async delete() {} }; } },
      async delete() { res.deleted = true; }
    });
  }
  return { mod, member, msg, sent, logs, guild };
}

test('moderáció: tiszta üzenet nem érintett; staff és botok kivétel; naplócsatornában nincs moderálás', async () => {
  const { mod, member, msg, sent } = setup();
  const m1 = msg(member('1'), 'Szia, jöhet egy tárgyalás?');
  assert.equal(await mod.handleMessage(m1), null);
  assert.equal(m1.deleted, false);
  const staffMsg = msg(member('2', { staff: true }), 'te kurva');
  assert.equal(await mod.handleMessage(staffMsg), null);
  assert.equal(staffMsg.deleted, false);
  const bot = msg(member('3'), 'te kurva'); bot.author.bot = true;
  assert.equal(await mod.handleMessage(bot), null);
  assert.equal(sent.length, 0);
});

test('moderáció: kis szabálysértés → törlés + DM, nincs némítás; naplóbejegyzés a stábnak', async () => {
  const { mod, member, msg, sent } = setup();
  const m = member('10');
  const x = msg(m, 'te kurva');
  const r = await mod.handleMessage(x);
  assert.equal(r.rule, 'profanity');
  assert.equal(x.deleted, true);
  assert.equal(m.timeouts.length, 0);
  assert.equal(x.dms.length, 1);
  assert.match(x.dms[0], /törölve/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].components, undefined, 'némítás nélkül nincs visszavonás-gomb');
  assert.ok(JSON.stringify(sent[0].embeds[0].toJSON()).includes('te kurva'));
});

test('moderáció: súlyos szabálysértés (gyűlölet, adathalászat, tömeges említés) → törlés + 60 perc némítás + visszavonás-gomb', async () => {
  const { mod, member, msg, sent } = setup();
  for (const [text, opt] of [['dögölj meg', {}], ['free nitro https://dlscord-gift.com/x', {}], ['figyelj', { mentions: 6 }]]) {
    const m = member('s' + text.length);
    const x = msg(m, text, opt);
    const r = await mod.handleMessage(x);
    assert.equal(r.severity, 'high', text);
    assert.equal(x.deleted, true);
    assert.equal(m.timeouts[0][0], 60 * 60 * 1000, text);
  }
  const last = sent[sent.length - 1];
  assert.match(last.components[0].toJSON().components[0].custom_id, new RegExp('^' + UNDO_PREFIX));
});

test('moderáció: büntetési létra – 4 kis szabálysértés után 10 perc, 7 után 60 perc; 24 óra után lenullázódik', async () => {
  let t = 1e9;
  const { mod, member, msg } = setup({ now: () => t });
  const m = member('20');
  for (let i = 1; i <= 3; i++) { await mod.handleMessage(msg(m, 'szar kurva ' + i)); t += 20000; }
  assert.equal(m.timeouts.length, 0, '3 pont: még nincs némítás');
  await mod.handleMessage(msg(m, 'geci még egy')); t += 20000;
  assert.equal(m.timeouts.length, 1);
  assert.equal(m.timeouts[0][0], 10 * 60 * 1000);
  for (let i = 0; i < 3; i++) { await mod.handleMessage(msg(m, 'fasz ' + i + ' ismét')); t += 20000; }
  assert.equal(m.timeouts[m.timeouts.length - 1][0], 60 * 60 * 1000, '7 pont: 1 óra');
  t += 25 * 3600 * 1000;
  const before = m.timeouts.length;
  await mod.handleMessage(msg(m, 'kurva'));
  assert.equal(m.timeouts.length, before, 'újrakezdés: egyetlen új pont nem ad némítást');
  assert.equal(mod._strikes.get('20').length, 1, 'a régi pontok lejártak');
});

test('moderáció: ha a némítás nem lehetséges (hierarchia), a törlés megtörténik és a napló jelzi', async () => {
  const { mod, member, msg, sent } = setup();
  const x = msg(member('30', { moderatable: false }), 'dögölj meg');
  const r = await mod.handleMessage(x);
  assert.equal(x.deleted, true);
  assert.equal(r.timedOut, false);
  assert.match(JSON.stringify(sent[0].embeds[0].toJSON()), /nem némítható/);
});

test('moderáció: tiltott DM esetén rövid, magától eltűnő jelzés a csatornában', async () => {
  const { mod, member, msg } = setup();
  const x = msg(member('40'), 'te kurva', { dm: false });
  await mod.handleMessage(x);
  assert.equal(x.channelSent.length, 1);
  assert.match(x.channelSent[0].content, /törölve/);
});

test('moderáció: szerkesztéssel sem kerülhető meg; a flood-számláló az szerkesztést nem számolja', async () => {
  const { mod, member, msg } = setup();
  const x = msg(member('50'), 'dögölj meg');
  const r = await mod.handleMessage(x, { edited: true });
  assert.equal(r.rule, 'hate');
  assert.equal(x.deleted, true);
});

test('moderáció: visszavonás gomb – csak stáb; feloldja a némítást és törli a pontokat', async () => {
  const { mod, member, guild } = setup();
  const target = member('60');
  target.timeout = async (ms) => { target.last = ms; };
  guild.members = { fetch: async () => target };
  mod._strikes.set('60', [{ t: Date.now(), points: 4 }]);
  const replies = [];
  const mk = (staff) => ({ customId: UNDO_PREFIX + '60', guild, user: { username: 'mod' }, member: member('99', { staff }),
    async reply(r) { replies.push(r.content); }, async deferReply() {}, async editReply(t) { replies.push(t); } });
  assert.equal(await mod.handleButton(mk(false)), true);
  assert.match(replies[0], /csak a stáb/);
  assert.equal(target.last, undefined);
  assert.equal(await mod.handleButton(mk(true)), true);
  assert.equal(target.last, null, 'timeout(null) = feloldás');
  assert.equal(mod._strikes.has('60'), false);
  assert.equal(await mod.handleButton({ customId: 'kamu:court:join:KAMU-1' }), false);
});

// ---------- MI-réteg (hamis API) ----------
const ok = (obj) => async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) });
const img = { name: 'k.png', contentType: 'image/png', size: 1000, url: 'https://cdn.discordapp.com/attachments/1/2/k.png' };

test('MI: a kép explicit/erőszakos besorolása törlést okoz; a tiszta kép átmegy; az API-hívás képet kap', async () => {
  let body = null;
  const bad = async (url, init) => { body = JSON.parse(init.body); return (ok({ category: 'sexual', severity: 3, confidence: 0.95, reason: 'explicit' }))(); };
  const a = setup({ config: { ai: true, aiKey: 'k' }, fetchImpl: bad });
  const x = a.msg(a.member('70'), 'nézzétek', { attachments: [img] });
  const r = await a.mod.handleMessage(x);
  assert.equal(r.rule, 'ai-image');
  assert.equal(x.deleted, true);
  assert.equal(body.messages[0].content[0].type, 'image');
  assert.equal(body.messages[0].content[0].source.url, img.url);
  assert.ok(body.system.includes('humoros bírósági party játék'), 'a rendszer-utasítás a játék hangulatát védi');
  const clean = setup({ config: { ai: true, aiKey: 'k' }, fetchImpl: ok({ category: 'none', severity: 0, confidence: 0.99, reason: '' }) });
  const y = clean.msg(clean.member('71'), 'kép', { attachments: [img] });
  assert.equal(await clean.mod.handleMessage(y), null);
  assert.equal(y.deleted, false);
});

test('MI: bizonytalan (alacsony magabiztosság / enyhe) értékelés nem töröl; API-hiba esetén az üzenet átmegy', async () => {
  for (const f of [ok({ category: 'harassment', severity: 2, confidence: 0.4, reason: 'talán' }), ok({ category: 'harassment', severity: 1, confidence: 0.99, reason: 'enyhe' }),
    async () => ({ ok: false, status: 500, json: async () => ({}) }), async () => { throw new Error('hálózat'); }, async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'nem json' }] }) })]) {
    const a = setup({ config: { ai: true, aiKey: 'k' }, fetchImpl: f });
    const x = a.msg(a.member('72'), 'kép', { attachments: [img] });
    assert.equal(await a.mod.handleMessage(x), null);
    assert.equal(x.deleted, false);
  }
});

test('MI: nem képet / túl nagy képet / nem https címet nem küld ki; szöveget csak új tagnál (alapértelmezés)', async () => {
  let calls = 0;
  const f = async () => { calls++; return ok({ category: 'harassment', severity: 3, confidence: 0.9, reason: 'zaklatás' })(); };
  const a = setup({ config: { ai: true, aiKey: 'k' }, fetchImpl: f });
  await a.mod.handleMessage(a.msg(a.member('73'), 'doksi', { attachments: [{ ...img, contentType: 'application/pdf', name: 'a.pdf' }, { ...img, size: 9e6 }, { ...img, url: 'http://x/y.png' }] }));
  assert.equal(calls, 0, 'egyik melléklet sem képellenőrzésre való');
  // régi tag szövege: nincs MI-hívás
  await a.mod.handleMessage(a.msg(a.member('74'), 'ez egy teljesen átlagos hosszú mondat a semmiről'));
  assert.equal(calls, 0);
  // új tag (1 napja): kapja az MI-értékelést, és a szöveg-értelmezés törölhet
  const nm = a.member('75', { joinedAgo: 86400000 });
  const x = a.msg(nm, 'ez egy teljesen átlagos hosszú mondat a semmiről');
  const r = await a.mod.handleMessage(x);
  assert.equal(calls, 1);
  assert.equal(r.rule, 'ai-text');
  assert.equal(x.deleted, true);
  // MOD_AI_TEXT=all: mindenkire; off: senkire
  const all = setup({ config: { ai: true, aiKey: 'k', aiText: 'all' }, fetchImpl: f });
  calls = 0; await all.mod.handleMessage(all.msg(all.member('76'), 'ez egy teljesen átlagos hosszú mondat a semmiről'));
  assert.equal(calls, 1);
  const off = setup({ config: { ai: true, aiKey: 'k', aiText: 'off' }, fetchImpl: f });
  calls = 0; await off.mod.handleMessage(off.msg(off.member('77', { joinedAgo: 1000 }), 'ez egy teljesen átlagos hosszú mondat a semmiről'));
  assert.equal(calls, 0);
});

test('MI: kikapcsolva (nincs kulcs) semmilyen hálózati hívás; percenkénti korlát', async () => {
  let calls = 0;
  const f = async () => { calls++; return ok({ category: 'none', severity: 0, confidence: 1, reason: '' })(); };
  const off = setup({ config: { ai: false }, fetchImpl: f });
  await off.mod.handleMessage(off.msg(off.member('80'), 'kép', { attachments: [img] }));
  assert.equal(calls, 0);
  const on = setup({ config: { ai: true, aiKey: 'k' }, fetchImpl: f, now: () => 5e8 });
  for (let i = 0; i < 30; i++) await on.mod.handleMessage(on.msg(on.member('9' + i), 'kép ' + i, { attachments: [img] }));
  assert.equal(calls, 20, 'legfeljebb 20 hívás percenként');
});

test('MI: a válasz-elemző csak érvényes JSON-t fogad el', () => {
  assert.deepEqual(parseVerdict('```json\n{"category":"hate","severity":3,"confidence":0.9,"reason":"x"}\n```'), { category: 'hate', severity: 3, confidence: 0.9, reason: 'x' });
  assert.equal(parseVerdict('nincs json'), null);
  assert.equal(parseVerdict('{"category":"hate"}'), null);
  assert.equal(parseVerdict('{"severity":9,"confidence":5,"category":"x"}').severity, 3);
});

test('/setup: a mod-napló csak a stábnak látszik (a tesztelőknek és a játékosoknak nem), a bot ír bele', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  const ch = findChannel(guild, LOG_NAME, [ChannelType.GuildText], null);
  assert.ok(ch, 'létrejött a naplócsatorna');
  const ow = (name) => ch.permissionOverwrites.cache.get([...guild.roles.cache.values()].find((r) => r.name === name).id);
  assert.ok(ch.permissionOverwrites.cache.get(guild.roles.everyone.id).deny.has(P.ViewChannel));
  for (const n of ['🛡️ Moderátor', '🛠️ Fejlesztő', '👑 Tulajdonos']) assert.ok(ow(n).allow.has(P.ViewChannel), n);
  assert.equal(ow('🧪 Tesztelő'), undefined, 'a tesztelők nem látják');
});
