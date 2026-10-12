'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { makeGuild } = require('./fake-guild');
const { runSetup, findChannel } = require('../src/setup');
const { createBugSync, reportEmbed } = require('../src/bugs');
const { joinCard } = require('../src/joincard');
const { handleButton } = require('../src/commands');
const { ACCEPT_BUTTON_ID } = require('../src/content');

const text = (g, n) => findChannel(g, n, [ChannelType.GuildText], null);
const report = (o = {}) => ({ id: 'BUG-1', ts: Date.now(), name: 'Tamás', account: true, kind: 'ui', text: 'Nem látszik az ítélet', where: 'game', room: 'ABCD', userAgent: 'Edge', ...o });

test('hibajelentés: a bot kiposztolja a 🐛・hibajelentés csatornába és késznek jelöli; hiba esetén nem jelöli', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  const done = [];
  let queue = [report(), report({ id: 'BUG-2', text: '@everyone teszt' })];
  const backend = { enabled: true, pendingBugs: async () => queue, bugPosted: async (id, ref) => { done.push([id, ref]); queue = queue.filter((r) => r.id !== id); } };
  const client = { guilds: { cache: new Map([[guild.id, guild]]) } };
  const sync = createBugSync({ client, backend, log: { error() {}, log() {} } });
  assert.equal(await sync.drain(), 2);
  assert.deepEqual(done.map((d) => d[0]), ['BUG-1', 'BUG-2']);
  const ch = text(guild, '🐛・hibajelentés');
  assert.equal(ch.messageStore.size, 3, 'sablon + 2 jelentés');
  const json = JSON.stringify([...ch.messageStore.values()].map((m) => m.embeds));
  assert.match(json, /BUG-1/);
  assert.match(json, /ABCD/);
  assert.equal(await sync.drain(), 0, 'nincs duplikálás');
  // a hibajelentés csatorna hiányzik -> a jelentés a stáb naplócsatornájába kerül (az okkal), és késznek jelölődik
  guild.channels.cache.delete(ch.id);
  queue = [report({ id: 'BUG-3' })];
  assert.equal(await sync.drain(), 1);
  assert.equal(queue.length, 0);
  const staff = text(guild, '🛡️・mod-napló');
  const staffJson = JSON.stringify([...staff.messageStore.values()].map((m) => [m.content, m.embeds]));
  assert.match(staffJson, /BUG-3/);
  assert.match(staffJson, /nincs/);
  // se hibajelentés csatorna, se napló -> nem jelöli késznek (később újrapróbálja)
  guild.channels.cache.delete(staff.id);
  queue = [report({ id: 'BUG-4' })];
  assert.equal(await sync.drain(), 0);
  assert.equal(queue.length, 1);
});

test('hibajelentés: ha a Discord elutasítja a posztolást, a stábcsatornába kerül az okkal; futás közbeni új jelentés is rögtön feldolgozódik', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  const ch = text(guild, '🐛・hibajelentés');
  ch.send = async () => { throw new Error('Missing Permissions'); };
  const done = [];
  let queue = [report({ id: 'BUG-10' })];
  let release;
  const gate = new Promise((r) => { release = r; });
  let first = true;
  const backend = {
    enabled: true,
    pendingBugs: async () => { if (first) { first = false; await gate; } return queue; },
    bugPosted: async (id) => { done.push(id); queue = queue.filter((r) => r.id !== id); }
  };
  const sync = createBugSync({ client: { guilds: { cache: new Map([[guild.id, guild]]) } }, backend, log: { error() {}, log() {} } });
  const p1 = sync.drain();                 // az első lekérdezés még függ
  queue.push(report({ id: 'BUG-11' }));    // közben új jelentés érkezik
  await sync.drain();                      // "foglalt": csak jelez, hogy újra kell futni
  release();
  await p1;
  assert.deepEqual(done.sort(), ['BUG-10', 'BUG-11']);
  const staff = text(guild, '🛡️・mod-napló');
  assert.match(JSON.stringify([...staff.messageStore.values()].map((m) => m.content)), /Missing Permissions/);
});

test('hibajelentés embed: hosszú szöveg levágva, a mezők megvannak', () => {
  const e = reportEmbed(report({ text: 'x'.repeat(9000) })).toJSON();
  assert.ok(e.description.length <= 3500);
  assert.ok(e.fields.some((f) => f.name === 'Szobakód'));
});

test('belépő-kártya: a ✅ gomb a Játékos rangot adja és vicces kártyát tesz az általános csatornába (név pingelés nélkül)', async () => {
  const guild = makeGuild();
  await runSetup(guild);
  const roles = new Set();
  const player = [...guild.roles.cache.values()].find((r) => /Játékos/.test(r.name));
  const interaction = {
    customId: ACCEPT_BUTTON_ID, guild, user: { username: 'tamas' },
    member: { displayName: '@everyone Tamás', roles: { cache: { has: (id) => roles.has(id) }, add: async (r) => { roles.add(r.id); } } },
    reply: async () => {}
  };
  await handleButton(interaction);
  assert.ok(roles.has(player.id));
  const msgs = [...text(guild, '💬・általános').messageStore.values()];
  assert.equal(msgs.length, 1);
  assert.match(JSON.stringify(msgs[0].embeds), /Tamás/);
  // másodszorra nincs új kártya
  await handleButton(interaction);
  assert.equal(text(guild, '💬・általános').messageStore.size, 1);
  assert.match(joinCard('Béla', 3).toJSON().description, /Béla/);
});

test('állapot-választó: a jelentés alatt ott van; csak a stáb módosíthat; az állapot a backendbe kerül, az üzenet frissül', async () => {
  const { STATUS } = require('../src/bugs');
  const guild = makeGuild();
  await runSetup(guild);
  const store = { 'BUG-20': report({ id: 'BUG-20', status: 'new' }) };
  const calls = [];
  const backend = {
    enabled: true,
    pendingBugs: async () => Object.values(store).filter((r) => !r.posted),
    bugPosted: async (id) => { store[id].posted = true; },
    bugStatus: async (id, status, by) => { calls.push([id, status, by]); store[id] = { ...store[id], status, statusBy: by }; return store[id]; }
  };
  const sync = createBugSync({ client: { guilds: { cache: new Map([[guild.id, guild]]) } }, backend, isStaff: (m) => !!(m && m.staff), log: { error() {}, log() {} } });
  assert.equal(await sync.drain(), 1);
  const msg = [...text(guild, '🐛・hibajelentés').messageStore.values()].pop();
  const row = msg.components[0].toJSON();
  assert.equal(row.components[0].custom_id, 'kamu:bug:status:BUG-20');
  assert.deepEqual(row.components[0].options.map((o) => o.value), Object.keys(STATUS), 'minden állapot választható');
  assert.ok(row.components[0].options.find((o) => o.value === 'new').default, 'az aktuális állapot előre kijelölve');
  assert.ok(row.components[0].options.some((o) => o.label === 'Jegelve') && row.components[0].options.some((o) => o.label === 'Folyamatban'));

  const mk = (staff, value) => {
    const out = { replies: [], updates: [] };
    out.interaction = {
      customId: 'kamu:bug:status:BUG-20', values: [value], member: { staff, displayName: 'Sanyi' }, user: { username: 'sanyi' }, channel: null,
      reply: async (o) => { out.replies.push(o.content); }, update: async (o) => { out.updates.push(o); }
    };
    return out;
  };
  const guest = mk(false, 'ice');
  assert.equal(await sync.handleSelect(guest.interaction), true);
  assert.match(guest.replies[0], /csak a stáb/);
  assert.equal(calls.length, 0, 'nem stáb: semmi nem mentődik');
  const staff = mk(true, 'ice');
  await sync.handleSelect(staff.interaction);
  assert.deepEqual(calls, [['BUG-20', 'ice', 'Sanyi']]);
  const emb = staff.updates[0].embeds[0].toJSON();
  assert.match(emb.title, /🧊/);
  assert.ok(emb.fields.some((f) => f.name === 'Állapot' && /Jegelve/.test(f.value)));
  assert.match(emb.footer.text, /Sanyi/);
  assert.ok(staff.updates[0].components[0].toJSON().components[0].options.find((o) => o.value === 'ice').default);
  const inProg = mk(true, 'progress');
  await sync.handleSelect(inProg.interaction);
  assert.match(inProg.updates[0].embeds[0].toJSON().title, /🔧/);
  // ismeretlen állapot / más azonosító
  const bad = mk(true, 'valami');
  await sync.handleSelect(bad.interaction);
  assert.match(bad.replies[0], /Ismeretlen/);
  assert.equal(await sync.handleSelect({ customId: 'kamu:court:join:KAMU-1' }), false);
});
