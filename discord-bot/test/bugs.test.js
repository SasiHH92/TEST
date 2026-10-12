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
  // nincs csatorna -> nem jelöli késznek
  guild.channels.cache.delete(ch.id);
  queue = [report({ id: 'BUG-3' })];
  assert.equal(await sync.drain(), 0);
  assert.equal(queue.length, 1);
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
