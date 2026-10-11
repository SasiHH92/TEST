'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../src/content');
const { supportPayload, DEFINITIONS } = require('../src/commands');

test('Discord: az üdvözlünk és a gyik embed diszkrét, önkéntes támogatási sort kap (ha ismert a játék címe)', () => {
  const old = { a: process.env.KAMU_GAME_URL, b: process.env.AUTH_BASE_URL };
  process.env.KAMU_GAME_URL = 'https://kamubirosag.com/';
  for (const key of ['welcome', 'faq']) {
    const json = JSON.stringify(content.build(key).toJSON());
    assert.ok(json.includes('https://kamubirosag.com/tamogatas'), key);
    assert.match(json, /ellenszolgáltatás és játékbeli előny nélkül/);
  }
  // a szabályzat és a többi embed nem kap támogatási sort
  assert.ok(!JSON.stringify(content.build('rules').toJSON()).includes('tamogatas'));
  // cím nélkül nincs hivatkozás (nem tör el semmit)
  delete process.env.KAMU_GAME_URL; delete process.env.AUTH_BASE_URL;
  assert.ok(!JSON.stringify(content.build('welcome').toJSON()).includes('tamogatas'));
  // AUTH_BASE_URL tartalék (a beágyazott botnál ez van beállítva)
  process.env.AUTH_BASE_URL = 'https://kamubirosag.com';
  assert.ok(JSON.stringify(content.build('faq').toJSON()).includes('https://kamubirosag.com/tamogatas'));
  if (old.a === undefined) delete process.env.KAMU_GAME_URL; else process.env.KAMU_GAME_URL = old.a;
  if (old.b === undefined) delete process.env.AUTH_BASE_URL; else process.env.AUTH_BASE_URL = old.b;
});

test('/tamogatas: mindenkinek elérhető parancs; a válasz nyomásmentes, link-gombbal, ellenszolgáltatás-ígéret nélkül', () => {
  const cmd = DEFINITIONS.find((c) => c.name === 'tamogatas');
  assert.ok(cmd);
  assert.equal(cmd.default_member_permissions, undefined, 'nem csak adminoknak');
  const p = supportPayload('https://kamubirosag.com/');
  const json = JSON.stringify(p.embeds[0].toJSON());
  assert.match(json, /önkéntes/);
  assert.match(json, /nem jár érte semmilyen ellenszolgáltatás/);
  const btn = p.components[0].toJSON().components[0];
  assert.equal(btn.url, 'https://kamubirosag.com/tamogatas');
  assert.equal(supportPayload('').components.length, 0, 'cím nélkül nincs gomb');
  assert.ok(!/VIP|prémium|rang/i.test(json.replace('rang', '')) || !/VIP-rang kapsz/i.test(json));
});

test('Discord: a ❤️・támogatás csatorna létrejön a BÍRÓSÁG kategóriában (csak olvasható), egyszer jelenik meg benne az embed, újrafuttatáskor nem duplikál', async () => {
  const { makeGuild } = require('./fake-guild');
  const { runSetup, findChannel } = require('../src/setup');
  const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
  const old = process.env.KAMU_GAME_URL;
  process.env.KAMU_GAME_URL = 'https://kamubirosag.com';
  const guild = makeGuild();
  const report = await runSetup(guild);
  assert.deepEqual(report.errors, []);
  const cat = findChannel(guild, '📜 BÍRÓSÁG', [ChannelType.GuildCategory], null);
  const ch = findChannel(guild, '❤️・támogatás', [ChannelType.GuildText], cat.id);
  assert.ok(ch, 'a csatorna létrejött');
  assert.ok(ch.permissionOverwrites.cache.get(guild.roles.everyone.id).deny.has(P.SendMessages), 'csak olvasható');
  assert.equal(ch.messageStore.size, 1);
  const json = JSON.stringify(ch.messageStore.first().embeds);
  assert.match(json, /semmilyen ellenszolgáltatás nem jár/);
  assert.match(json, /Játékfejlesztés/); assert.match(json, /Szerverfenntartás/); assert.match(json, /Grafikai fejlesztések/);
  assert.ok(json.includes('https://kamubirosag.com/tamogatas'));
  const second = await runSetup(guild, { mode: 'repair' });
  assert.deepEqual(second.created, []);
  assert.equal(ch.messageStore.size, 1, 'nem duplikál');
  // hiányzó csatorna esetén a /setup-repair pótolja (és az embedet is kiteszi)
  guild.channels.cache.delete(ch.id);
  const fixed = await runSetup(guild, { mode: 'repair' });
  assert.ok(fixed.created.some((l) => l.includes('támogatás')));
  assert.equal(findChannel(guild, '❤️・támogatás', [ChannelType.GuildText], cat.id).messageStore.size, 1);
  if (old === undefined) delete process.env.KAMU_GAME_URL; else process.env.KAMU_GAME_URL = old;
});
