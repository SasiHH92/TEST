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
