'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const { makeGuild } = require('./fake-guild');
const { runSetup, checkStatus, findRole, findChannel } = require('../src/setup');
const { ROLES, STRUCTURE } = require('../src/spec');
const { isAuthorized } = require('../src/commands');
const { missingBotPermissions, BOT_PERMISSION_BITS } = require('../src/permissions');
const { normName } = require('../src/util');

const allChannelSpecs = STRUCTURE.flatMap((c) => c.channels);
const chan = (guild, name, type) => findChannel(guild, name, [type], null);
const countChannels = (guild) => guild.channels.cache.size;

test('üres szerveren felépül minden: role-ok sorrendben, kategóriák, csatornák', async () => {
  const guild = makeGuild();
  const report = await runSetup(guild);
  assert.deepEqual(report.errors, []);
  // role-ok és hierarchia (fentről lefelé csökkenő pozíció, a bot role fölöttük)
  const roles = ROLES.map((r) => findRole(guild, r.name));
  roles.forEach((r) => assert.ok(r, 'role hiányzik'));
  for (let i = 1; i < roles.length; i++) assert.ok(roles[i - 1].position > roles[i].position, 'rossz sorrend');
  assert.ok(guild.members.me.roles.highest.position > roles[0].position, 'a bot role-ja legyen legfelül');
  // a bot megkapta a 🤖 Bot role-t
  assert.ok(guild.members.me.roles.cache.has(findRole(guild, '🤖 Bot').id));
  // kategóriák + csatornák (Community nélkül a fórumok szövegcsatornák)
  assert.equal(STRUCTURE.length, 4);
  for (const c of STRUCTURE) assert.ok(chan(guild, c.name, ChannelType.GuildCategory), c.name);
  assert.equal(countChannels(guild), STRUCTURE.length + allChannelSpecs.length);
  assert.equal(allChannelSpecs.filter((c) => c.kind === 'voice').length, 3);
  assert.ok(report.warnings.some((w) => w.includes('Community')));
});

test('újrafuttatás idempotens: nincs duplikált role/csatorna/üzenet', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  const roles = guild.roles.cache.size;
  const channels = countChannels(guild);
  const msgs = allChannelSpecs.filter((s) => s.embed).map((s) => chan(guild, s.name, ChannelType.GuildText).messageStore.size);
  const second = await runSetup(guild);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.errors, []);
  assert.equal(guild.roles.cache.size, roles);
  assert.equal(countChannels(guild), channels);
  const msgs2 = allChannelSpecs.filter((s) => s.embed).map((s) => chan(guild, s.name, ChannelType.GuildText).messageStore.size);
  assert.deepEqual(msgs2, msgs);
});

test('jogosultságok: bétás terület rejtett, szabályzat csak olvasható, voice connect/speak', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  const everyone = guild.roles.everyone.id;
  const beta = chan(guild, '🧪 BÉTA / FEJLESZTÉS', ChannelType.GuildCategory);
  assert.ok(beta.permissionOverwrites.cache.get(everyone).deny.has(P.ViewChannel));
  for (const key of ['🧪 Tesztelő', '🛡️ Moderátor', '🛠️ Fejlesztő', '👑 Tulajdonos']) {
    assert.ok(beta.permissionOverwrites.cache.get(findRole(guild, key).id).allow.has(P.ViewChannel), key);
  }
  assert.equal(beta.permissionOverwrites.cache.get(findRole(guild, '⚖️ Játékos').id), undefined);
  const bug = chan(guild, '🐛・hibajelentés', ChannelType.GuildText);
  assert.ok(bug.permissionOverwrites.cache.get(everyone).deny.has(P.ViewChannel));
  for (const n of ['📜・szabályzat', '📢・bejelentések', '📰・frissítések']) {
    const ow = chan(guild, n, ChannelType.GuildText).permissionOverwrites.cache.get(everyone);
    assert.ok(ow.deny.has(P.SendMessages), n);
    assert.ok(ow.allow.has(P.ViewChannel), n);
  }
  const voice = chan(guild, '🔊 Tárgyalóterem #1', ChannelType.GuildVoice).permissionOverwrites.cache.get(everyone);
  assert.ok(voice.allow.has(P.Connect) && voice.allow.has(P.Speak));
  // a nyilvános csatornán nincs tiltás
  assert.equal(chan(guild, '💬・általános', ChannelType.GuildText).permissionOverwrites.cache.get(everyone), undefined);
});

test('embedek: üdvözlünk, szabályzat, játék-kereső, ötletek, hibajelentés; a hibasablon minden mezőt tartalmaz', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  for (const n of ['👋・üdvözlünk', '📜・szabályzat', '🎮・játék-kereső', '💡・ötletek', '🐛・hibajelentés']) {
    const ch = chan(guild, n, ChannelType.GuildText);
    assert.equal(ch.messageStore.size, 1, n);
  }
  assert.equal(chan(guild, '👋・üdvözlünk', ChannelType.GuildText).messageStore.first().components.length, 1);
  const bug = JSON.stringify(chan(guild, '🐛・hibajelentés', ChannelType.GuildText).messageStore.first().embeds);
  for (const f of ['Eszköz/böngésző', 'Mi történt', 'Mit kellett volna történnie', 'Megismételhető-e', 'Szobakód', 'Kép/videó']) assert.ok(bug.includes(f), f);
});

test('Community szerveren a hibajelentés és az ötletek fórum, címkékkel, kitűzött sablonnal', async () => {
  const guild = makeGuild({ community: true });
  const report = await runSetup(guild);
  assert.deepEqual(report.errors, []);
  for (const [n, tag] of [['🐛・hibajelentés', 'Kritikus'], ['💡・ötletek', 'Játékmód']]) {
    const f = chan(guild, n, ChannelType.GuildForum);
    assert.ok(f, n);
    assert.ok(f.availableTags.some((t) => t.name === tag));
    assert.equal(f.threadStore.size, 1);
    assert.ok(f.threadStore.first().pinned);
  }
  await runSetup(guild);
  assert.equal(chan(guild, '🐛・hibajelentés', ChannelType.GuildForum).threadStore.size, 1);
  const st = await checkStatus(guild);
  assert.ok(st.ok, JSON.stringify(st.items.filter((i) => i.level !== 'ok')));
  assert.ok(st.items.every((i) => i.level === 'ok'));
});

test('/setup-status: fallback esetén figyelmeztet, törlés után hibát jelez, repair helyreállít', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  let st = await checkStatus(guild);
  assert.ok(st.ok);
  assert.ok(st.items.some((i) => i.level === 'warn'));
  // hiányzó csatorna + elrontott jogosultság + hiányzó role
  const gone = chan(guild, '📋・ismert-hibák', ChannelType.GuildText);
  guild.channels.cache.delete(gone.id);
  const rules = chan(guild, '📜・szabályzat', ChannelType.GuildText);
  rules.permissionOverwrites.cache.delete(guild.roles.everyone.id);
  guild.roles.cache.delete(findRole(guild, '🧪 Tesztelő').id);
  st = await checkStatus(guild);
  assert.equal(st.ok, false);
  const fails = st.items.filter((i) => i.level === 'fail').map((i) => i.text).join('\n');
  assert.match(fails, /ismert-hibák/);
  assert.match(fails, /szabályzat/);
  assert.match(fails, /Tesztelő/);
  // közösségi tartalom, amit nem szabad törölni
  const general = chan(guild, '💬・általános', ChannelType.GuildText);
  await general.send({ content: 'vendég üzenet' });
  const extra = await guild.channels.create({ name: 'saját-csatorna', type: ChannelType.GuildText });
  await runSetup(guild, { mode: 'repair' });
  assert.ok(chan(guild, '📋・ismert-hibák', ChannelType.GuildText));
  assert.ok(findRole(guild, '🧪 Tesztelő'));
  assert.ok(guild.channels.cache.has(extra.id), 'a közösségi csatornát nem törölheti');
  assert.equal(general.messageStore.size, 1);
  st = await checkStatus(guild);
  assert.ok(st.ok, JSON.stringify(st.items.filter((i) => i.level === 'fail')));
});

test('/setup-repair nem módosít meglévő üzenetet, a /setup frissíti', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  const msg = chan(guild, '📜・szabályzat', ChannelType.GuildText).messageStore.first();
  await runSetup(guild, { mode: 'repair' });
  assert.equal(msg.edited, undefined);
  await runSetup(guild, { mode: 'setup' });
  assert.equal(msg.edited, 1);
});

test('Community bekapcsolása után a repair létrehozza a fórumot, a régi szövegcsatornát meghagyja', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  guild.features.push('COMMUNITY');
  let st = await checkStatus(guild);
  assert.equal(st.ok, false);
  await runSetup(guild, { mode: 'repair' });
  assert.ok(chan(guild, '🐛・hibajelentés', ChannelType.GuildForum));
  assert.ok(chan(guild, '🐛・hibajelentés', ChannelType.GuildText));
  st = await checkStatus(guild);
  assert.ok(st.ok, JSON.stringify(st.items.filter((i) => i.level === 'fail')));
});

test('hiányzó bot-jogok esetén nem épít, hanem hibát ad', async () => {
  const guild = makeGuild({ botPermissions: new PermissionsBitField([P.ViewChannel, P.SendMessages]) });
  const report = await runSetup(guild);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /ManageRoles/);
  assert.equal(countChannels(guild), 0);
  assert.equal(guild.calls.roleCreates, 0);
});

test('ha a bot role-ja nem a legmagasabb, figyelmeztet', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  // a bot role-ja leesik a Tesztelő alá
  const botRole = [...guild.roles.cache.values()].find((r) => r.managed);
  botRole.position = 0.5;
  const report = await runSetup(guild);
  assert.ok(report.warnings.some((w) => w.includes('nem a legmagasabb')));
  const st = await checkStatus(guild);
  assert.equal(st.ok, false);
});

test('a /setup jogosultság-ellenőrzése: tulajdonos vagy Administrator', () => {
  const guild = { ownerId: 'o1' };
  const mk = (id, admin) => ({ guild, user: { id }, memberPermissions: new PermissionsBitField(admin ? [P.Administrator] : [P.SendMessages]) });
  assert.equal(isAuthorized(mk('o1', false)), true);
  assert.equal(isAuthorized(mk('u2', true)), true);
  assert.equal(isAuthorized(mk('u3', false)), false);
  assert.equal(isAuthorized({ guild: null, user: { id: 'o1' } }), false);
});

test('a kért bot-jogok listája minimális: nincs Administrator, nincs kick/ban/privilegizált', () => {
  const p = new PermissionsBitField(BOT_PERMISSION_BITS);
  for (const bad of ['Administrator', 'KickMembers', 'BanMembers', 'ManageGuild', 'ManageMessages', 'MentionEveryone', 'ManageWebhooks']) {
    assert.equal(p.has(P[bad]), false, bad);
  }
  assert.deepEqual(missingBotPermissions(p), []);
});

test('normName kezeli az emoji-változatjelölőt és a Discord-átírást', () => {
  assert.equal(normName('🛡️ Moderátor'), normName('🛡 Moderátor'));
  assert.equal(normName('🔊 Tárgyalóterem #1'), normName('🔊-tárgyalóterem-#1'));
});
