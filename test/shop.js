'use strict';
// ============================================================
// KAMU BÍRÓSÁG – bolt és napi küldetések: valódi HTTP-kérések, ideiglenes fióktár
// Jutalom-átvétel (egyszer, csak kész küldetésre), napi bónusz, vásárlás, felvétel,
// csalási kísérletek (más tárgy, kevés pénz, hamis hely), hitelesített kozmetikumok.
// Futtatás: node test/shop.js
// ============================================================

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { createAuth } = require('../auth');
const { createShop, CATALOG } = require('../shop');
const { questsForDate } = require('../quests');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-shop-'));
const servers = [];
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function boot() {
  const app = express(), server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  const base = 'http://127.0.0.1:' + server.address().port;
  const file = path.join(root, crypto.randomUUID() + '.json');
  const state = { date: '2026-10-07', counts: {} };
  const auth = createAuth({ file, env: { AUTH_BASE_URL: base }, maxAttempts: 500 });
  const shop = createShop({ auth, today: () => state.date, dailyCounts: () => state.counts });
  app.use('/api/auth', auth.router);
  app.use('/api/shop', shop.router);
  const jar = () => new Map();
  async function req(method, route, body, settings = {}) {
    const headers = { ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: base } : {}), ...settings.headers };
    if (settings.jar && settings.jar.size) headers.Cookie = [...settings.jar].map(([k, v]) => k + '=' + v).join('; ');
    const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (settings.jar) for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0], i = first.indexOf('=');
      const key = first.slice(0, i), value = first.slice(i + 1);
      if (value) settings.jar.set(key, value); else settings.jar.delete(key);
    }
    const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
    return { status: response.status, data };
  }
  return { base, file, req, jar, state, shop, auth };
}

const password = 'Egy hosszú titok 123!';
const register = (api, jar, name, mail) => api.req('POST', '/api/auth/register', { username: name, email: mail, password, confirmPassword: password }, { jar });

async function main() {
  const api = await boot();
  const me = api.jar(), guest = api.jar();
  await register(api, me, 'Bolt Béla', 'bela@example.invalid');
  const quests = questsForDate(api.state.date);

  await test('Bejelentkezés nélkül nincs bolt és nincs jutalom', async () => {
    assert.equal((await api.req('GET', '/api/shop/state', undefined, { jar: guest })).status, 401);
    assert.equal((await api.req('POST', '/api/shop/claim', { questId: quests[0].id }, { jar: guest })).status, 401);
    assert.equal((await api.req('POST', '/api/shop/buy', { itemId: 'frame_silver' }, { jar: guest })).status, 401);
  });

  await test('Új fiók: üres pénztárca, 3 mai küldetés, a katalógus megvan', async () => {
    const r = await api.req('GET', '/api/shop/state', undefined, { jar: me });
    assert.equal(r.status, 200);
    assert.equal(r.data.wallet, 0);
    assert.equal(r.data.quests.length, 3);
    assert.deepEqual(r.data.quests.map((q) => q.id), quests.map((q) => q.id));
    assert.ok(r.data.quests.every((q) => !q.done && !q.claimed && q.progress === 0));
    assert.equal(r.data.catalog.targyak.length, CATALOG.targyak.length);
    assert.equal(r.data.bonus.available, false);
    assert.ok(r.data.resetsInMs > 0);
  });

  await test('Nem kész küldetés jutalma nem vehető át', async () => {
    const r = await api.req('POST', '/api/shop/claim', { questId: quests[0].id }, { jar: me });
    assert.equal(r.status, 400);
    assert.equal((await api.req('GET', '/api/shop/state', undefined, { jar: me })).data.wallet, 0);
  });

  await test('Ismeretlen küldetés (nem a mai) elutasítva', async () => {
    assert.equal((await api.req('POST', '/api/shop/claim', { questId: 'nincs_ilyen' }, { jar: me })).status, 404);
  });

  await test('Kész küldetés: a jutalom egyszer vehető át', async () => {
    api.state.counts = { [quests[0].stat]: quests[0].target };
    const progress = (await api.req('GET', '/api/shop/state', undefined, { jar: me })).data.quests[0];
    assert.ok(progress.done && !progress.claimed);
    const r = await api.req('POST', '/api/shop/claim', { questId: quests[0].id }, { jar: me });
    assert.equal(r.status, 200);
    assert.equal(r.data.wallet, quests[0].reward);
    assert.ok(r.data.quests[0].claimed);
    assert.equal((await api.req('POST', '/api/shop/claim', { questId: quests[0].id }, { jar: me })).status, 409, 'kétszer nem');
    assert.equal((await api.req('GET', '/api/shop/state', undefined, { jar: me })).data.wallet, quests[0].reward);
  });

  await test('Napi bónusz: csak mind a három átvétele után, egyszer', async () => {
    assert.equal((await api.req('POST', '/api/shop/claim-bonus', {}, { jar: me })).status, 400, 'korán nem');
    api.state.counts = Object.fromEntries(quests.map((q) => [q.stat, q.target]));
    for (const q of quests.slice(1)) assert.equal((await api.req('POST', '/api/shop/claim', { questId: q.id }, { jar: me })).status, 200);
    const before = (await api.req('GET', '/api/shop/state', undefined, { jar: me })).data;
    assert.equal(before.bonus.available, true);
    const total = quests.reduce((s, q) => s + q.reward, 0);
    assert.equal(before.wallet, total);
    const r = await api.req('POST', '/api/shop/claim-bonus', {}, { jar: me });
    assert.equal(r.status, 200);
    assert.equal(r.data.wallet, total + before.bonus.reward);
    assert.equal(r.data.bonus.claimed, true);
    assert.equal((await api.req('POST', '/api/shop/claim-bonus', {}, { jar: me })).status, 409, 'kétszer nem');
  });

  await test('Új nap: új küldetések, a tegnapi jutalom-jegyzet nem akadályozza', async () => {
    api.state.date = '2026-10-08'; api.state.counts = {};
    const tomorrow = questsForDate('2026-10-08');
    const r = await api.req('GET', '/api/shop/state', undefined, { jar: me });
    assert.deepEqual(r.data.quests.map((q) => q.id), tomorrow.map((q) => q.id));
    assert.ok(r.data.quests.every((q) => !q.claimed && q.progress === 0));
    assert.equal(r.data.bonus.claimed, false);
    api.state.counts = { [tomorrow[1].stat]: tomorrow[1].target };
    assert.equal((await api.req('POST', '/api/shop/claim', { questId: tomorrow[1].id }, { jar: me })).status, 200);
    api.state.date = '2026-10-07'; api.state.counts = {};
  });

  await test('Vásárlás: elég pénz kell, egyszer vehető meg, levonódik az ár', async () => {
    const wallet = (await api.req('GET', '/api/shop/state', undefined, { jar: me })).data.wallet;
    const cheap = CATALOG.targyak.filter((i) => i.ar <= wallet).sort((a, b) => a.ar - b.ar)[0];
    const dear = CATALOG.targyak.find((i) => i.ar > wallet);
    assert.ok(cheap && dear, 'a teszt-pénztárcával van olcsó és drága tárgy is');
    assert.equal((await api.req('POST', '/api/shop/buy', { itemId: dear.id }, { jar: me })).status, 402, 'kevés pénz');
    const r = await api.req('POST', '/api/shop/buy', { itemId: cheap.id }, { jar: me });
    assert.equal(r.status, 200);
    assert.equal(r.data.wallet, wallet - cheap.ar);
    assert.ok(r.data.owned.includes(cheap.id));
    assert.equal((await api.req('POST', '/api/shop/buy', { itemId: cheap.id }, { jar: me })).status, 409, 'kétszer nem');
    assert.equal((await api.req('POST', '/api/shop/buy', { itemId: 'nincs_ilyen' }, { jar: me })).status, 404);
    me.cheap = cheap;
  });

  await test('Felvétel: csak megvásárolt tárgy, csak a saját helyére; levehető', async () => {
    const own = me.cheap;
    const other = CATALOG.targyak.find((i) => i.id !== own.id && i.slot !== own.slot);
    assert.equal((await api.req('POST', '/api/shop/equip', { slot: other.slot, itemId: other.id }, { jar: me })).status, 403, 'nem vetted meg');
    assert.equal((await api.req('POST', '/api/shop/equip', { slot: 'nincs_hely', itemId: own.id }, { jar: me })).status, 400, 'ismeretlen hely');
    const wrongSlot = CATALOG.slotok.find((s) => s.id !== own.slot).id;
    assert.equal((await api.req('POST', '/api/shop/equip', { slot: wrongSlot, itemId: own.id }, { jar: me })).status, 400, 'rossz hely');
    const r = await api.req('POST', '/api/shop/equip', { slot: own.slot, itemId: own.id }, { jar: me });
    assert.equal(r.status, 200);
    assert.equal(r.data.equipped[own.slot], own.id);
    const off = await api.req('POST', '/api/shop/equip', { slot: own.slot, itemId: null }, { jar: me });
    assert.equal(off.data.equipped[own.slot], undefined, 'levehető');
    await api.req('POST', '/api/shop/equip', { slot: own.slot, itemId: own.id }, { jar: me });
  });

  await test('Hitelesített kozmetikum: csak a megvásárolt, felvett tárgy kerül a játékosokhoz', async () => {
    const user = JSON.parse(fs.readFileSync(api.file)).users.find((u) => u.email === 'bela@example.invalid');
    assert.deepEqual(api.shop.cosmeticsFor(user), { [me.cheap.slot]: me.cheap.id });
    // kézzel beírt, meg nem vásárolt tárgy sem jut át
    const forged = { ...user, shop: { ...user.shop, equipped: { ...user.shop.equipped, frame: 'frame_rainbow', stamp: 'nincs_ilyen' } } };
    const cosm = api.shop.cosmeticsFor(forged) || {};
    assert.notEqual(cosm.frame, 'frame_rainbow', 'nem vásárolt tárgy nem kerülhet át');
    assert.equal(cosm.stamp, undefined, 'ismeretlen tárgy sem');
    assert.equal(api.shop.cosmeticsFor({ shop: {} }), null, 'üres felszerelés: nincs kozmetikum');
  });

  await test('Socket-kérés (nyers IncomingMessage, .get() nélkül) is azonosítja a fiókot', async () => {
    const raw = { headers: { cookie: [...me].filter(([k]) => typeof k === 'string').map(([k, v]) => k + '=' + v).join('; ') } };
    const user = api.auth.session(raw);
    assert.ok(user && user.email === 'bela@example.invalid', 'a süti alapján a fiók megvan');
    assert.deepEqual(api.shop.cosmeticsFor(user), { [me.cheap.slot]: me.cheap.id });
    assert.equal(api.auth.session({ headers: {} }), null, 'süti nélkül nincs fiók');
  });

  await test('Biztonság: másik eredet, nem JSON, kamu adatok', async () => {
    assert.equal((await api.req('POST', '/api/shop/buy', { itemId: 'frame_silver' }, { jar: me, headers: { Origin: 'https://masik.example' } })).status, 403);
    const wrongType = await fetch(api.base + '/api/shop/buy', { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: [...me].map(([k, v]) => k + '=' + v).join('; ') }, body: 'x' });
    assert.equal(wrongType.status, 415);
    assert.equal((await api.req('POST', '/api/shop/buy', { itemId: { $ne: 1 } }, { jar: me })).status, 404);
    assert.equal((await api.req('POST', '/api/shop/equip', { slot: ['frame'], itemId: 1 }, { jar: me })).status, 400);
  });

  await test('Két fiók pénztárcája elkülönül', async () => {
    const other = api.jar();
    await register(api, other, 'Másik Mari', 'mari@example.invalid');
    const r = await api.req('GET', '/api/shop/state', undefined, { jar: other });
    assert.equal(r.data.wallet, 0);
    assert.deepEqual(r.data.owned, []);
  });

  await test('A fióktárban tárolt adat: pénztárca, tárgyak, jutalom-jegyzet (jelszó nélkül a válaszban)', async () => {
    const r = await api.req('GET', '/api/shop/state', undefined, { jar: me });
    assert.ok(!JSON.stringify(r.data).includes('password') && !JSON.stringify(r.data).includes('hash'));
    const stored = JSON.parse(fs.readFileSync(api.file)).users.find((u) => u.email === 'bela@example.invalid').shop;
    assert.equal(stored.wallet, r.data.wallet);
    assert.ok(stored.owned.length >= 1 && stored.earned >= stored.wallet);
  });
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(async () => {
  for (const s of servers) { s.closeAllConnections(); await new Promise((r) => s.close(r)); }
  fs.rmSync(root, { recursive: true, force: true });
  console.log('\nBolt: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
});
