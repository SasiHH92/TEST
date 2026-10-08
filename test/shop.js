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
const { createShop, CATALOG, seasonInfo, GIFTS_PER_DAY } = require('../shop');
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
  const pairs = new Set(), gifts = []; // barátságok (kézzel megadva) és a kiküldött ajándék-értesítések
  const shop = createShop({
    auth, today: () => state.date, dailyCounts: () => state.counts,
    areFriends: (a, b) => pairs.has([a, b].sort().join('|')),
    onGift: (from, to, item) => gifts.push({ from: from.username, to: to.username, item: item.id })
  });
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
  return { base, file, req, jar, state, shop, auth, pairs, gifts };
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
    const cheap = CATALOG.targyak.filter((i) => !i.feloldas && i.ar <= wallet).sort((a, b) => a.ar - b.ar)[0];
    const dear = CATALOG.targyak.find((i) => !i.feloldas && i.ar > wallet);
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
    const other = CATALOG.targyak.find((i) => !i.feloldas && i.id !== own.id && i.slot !== own.slot);
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

  await test('Szezonális tárgyak: a szezon minden évben ismétlődik, az évhatáron átnyúló is jó (pontos napok)', async () => {
    const item = (id) => CATALOG.targyak.find((i) => i.id === id);
    const at = (id, date) => seasonInfo(item(id), date);
    assert.equal(seasonInfo(item('frame_silver'), '2026-10-25'), null, 'nem szezonális tárgy: nincs szezon-adat');
    assert.deepEqual([at('frame_pumpkin', '2026-10-06').aktiv, at('frame_pumpkin', '2026-10-06').kezdodik], [false, '2026-10-20'], 'októberi szezon előtt');
    assert.deepEqual([at('frame_pumpkin', '2026-10-19').aktiv, at('frame_pumpkin', '2026-10-20').aktiv], [false, true], 'a szezon első napján indul');
    assert.deepEqual([at('frame_pumpkin', '2026-11-02').aktiv, at('frame_pumpkin', '2026-11-02').zar], [true, '2026-11-02'], 'az utolsó napon még kapható');
    assert.deepEqual([at('frame_pumpkin', '2026-11-03').aktiv, at('frame_pumpkin', '2026-11-03').kezdodik], [false, '2027-10-20'], 'utána jövőre');
    assert.deepEqual([at('frame_holly', '2026-12-14').aktiv, at('frame_holly', '2026-12-15').aktiv], [false, true], 'karácsony indul');
    assert.equal(at('frame_holly', '2026-12-31').zar, '2027-01-06', 'az évhatáron átnyúlik');
    assert.deepEqual([at('bg_snowfall', '2027-01-02').aktiv, at('bg_snowfall', '2027-01-06').aktiv, at('bg_snowfall', '2027-01-07').aktiv], [true, true, false]);
    assert.equal(at('bg_snowfall', '2027-01-07').kezdodik, '2027-12-15');
    assert.ok(CATALOG.targyak.filter((i) => i.szezon).length >= 4 && CATALOG.targyak.filter((i) => i.szezon).every((i) => seasonInfo(i, '2026-06-01')));
  });

  await test('A katalógus a szezonális tárgyaknál a mai állapotot adja; szezonon kívül nem vehető meg, szezonban igen, utána is megmarad', async () => {
    const fresh = api.jar(); await register(api, fresh, 'Szezon Szilvi', 'szilvi@example.invalid');
    const uid = JSON.parse(fs.readFileSync(api.file)).users.find((u) => u.email === 'szilvi@example.invalid').id;
    api.auth.mutate(uid, (u) => { u.shop = { wallet: 5000, earned: 5000, owned: [], equipped: {}, claims: {} }; return u; });
    const itemOf = (st, id) => st.data.catalog.targyak.find((i) => i.id === id);
    api.state.date = '2026-10-06';
    let st = await api.req('GET', '/api/shop/state', undefined, { jar: fresh });
    assert.equal(itemOf(st, 'frame_pumpkin').szezon.aktiv, false);
    assert.equal(itemOf(st, 'frame_pumpkin').szezon.kezdodik, '2026-10-20');
    assert.equal(itemOf(st, 'frame_silver').szezon, undefined);
    const early = await api.req('POST', '/api/shop/buy', { itemId: 'frame_pumpkin' }, { jar: fresh });
    assert.equal(early.status, 403); assert.match(early.data.error, /most nem kapható/);
    assert.equal((await api.req('GET', '/api/shop/state', undefined, { jar: fresh })).data.wallet, 5000, 'nem vont le pénzt');
    api.state.date = '2026-10-25';
    st = await api.req('GET', '/api/shop/state', undefined, { jar: fresh });
    assert.equal(itemOf(st, 'frame_pumpkin').szezon.aktiv, true); assert.equal(itemOf(st, 'frame_pumpkin').szezon.zar, '2026-11-02');
    const bought = await api.req('POST', '/api/shop/buy', { itemId: 'frame_pumpkin' }, { jar: fresh });
    assert.equal(bought.status, 200); assert.equal(bought.data.wallet, 5000 - 400);
    api.state.date = '2026-11-20'; // a szezon véget ért: a megvett tárgy megmarad és felvehető
    const equip = await api.req('POST', '/api/shop/equip', { slot: 'frame', itemId: 'frame_pumpkin' }, { jar: fresh });
    assert.equal(equip.status, 200); assert.equal(equip.data.equipped.frame, 'frame_pumpkin');
    assert.equal((await api.req('POST', '/api/shop/buy', { itemId: 'bg_haunted' }, { jar: fresh })).status, 403, 'újat már nem vehet');
    api.state.date = '2026-10-07';
  });

  await test('Ajándék: csak barátnak, a küldő fizet, a barát megkapja; hibás esetek (idegen, magának, kevés pénz, már megvan, szezonon kívüli)', async () => {
    const A = api.jar(), B = api.jar(), C = api.jar();
    await register(api, A, 'Ado Aniko', 'ado@example.invalid'); await register(api, B, 'Kapo Bela', 'kapo@example.invalid'); await register(api, C, 'Idegen Imre', 'idegen@example.invalid');
    const users = JSON.parse(fs.readFileSync(api.file)).users;
    const id = (mail) => users.find((u) => u.email === mail).id;
    const [a, b, c] = [id('ado@example.invalid'), id('kapo@example.invalid'), id('idegen@example.invalid')];
    api.auth.mutate(a, (u) => { u.shop = { wallet: 1000, earned: 1000, owned: [], equipped: {}, claims: {} }; return u; });
    const gift = (jar, friendId, itemId) => api.req('POST', '/api/shop/gift', { friendId, itemId }, { jar });
    assert.equal((await gift(A, b, 'frame_silver')).status, 403, 'nem barát: nem küldhet');
    api.pairs.add([a, b].sort().join('|'));
    assert.equal((await gift(guest, b, 'frame_silver')).status, 401, 'bejelentkezés nélkül nem');
    assert.equal((await gift(A, a, 'frame_silver')).status, 400, 'magának nem');
    assert.equal((await gift(A, '', 'frame_silver')).status, 400);
    assert.equal((await gift(A, b, 'nincs_ilyen')).status, 404);
    assert.equal((await gift(A, c, 'frame_silver')).status, 403, 'a másik fél nem barát');
    assert.equal((await gift(A, b, 'frame_pumpkin')).status, 403, 'szezonon kívül nem ajándékozható');
    assert.equal((await gift(A, b, 'frame_rainbow')).status, 200, 'a tárgy ára (1000) pont belefér a pénztárcába');
    const state = (await api.req('GET', '/api/shop/state', undefined, { jar: A })).data;
    assert.equal(state.wallet, 0, 'a küldő a teljes árat kifizette');
    const theirs = (await api.req('GET', '/api/shop/state', undefined, { jar: B })).data;
    assert.ok(theirs.owned.includes('frame_rainbow'), 'a barát megkapta'); assert.equal(theirs.wallet, 0, 'a barát pénze nem változik');
    assert.deepEqual(api.gifts.at(-1), { from: 'Ado Aniko', to: 'Kapo Bela', item: 'frame_rainbow' }, 'az értesítés kiment');
    assert.equal((await gift(A, b, 'frame_silver')).status, 402, 'kevés pénz');
    api.auth.mutate(a, (u) => { u.shop.wallet = 500; return u; });
    assert.equal((await gift(A, b, 'frame_rainbow')).status, 409, 'neki már megvan');
    // a kapott tárgy a barát saját tárgya: felveheti
    assert.equal((await api.req('POST', '/api/shop/equip', { slot: 'frame', itemId: 'frame_rainbow' }, { jar: B })).status, 200);
    // ajándék-limit napi 5
    api.auth.mutate(a, (u) => { u.shop.wallet = 9000; return u; });
    const cheap = ['frame_silver', 'frame_emerald', 'frame_ruby', 'frame_sapphire', 'frame_amethyst'];
    let sent = 1; // a rainbow már elment
    for (const item of cheap) { const r = await gift(A, b, item); if (r.status === 200) sent++; else { assert.equal(r.status, 429, item); break; } }
    assert.equal(sent, GIFTS_PER_DAY, 'naponta legfeljebb ' + GIFTS_PER_DAY + ' ajándék');
    api.state.date = '2026-10-08';
    assert.equal((await gift(A, b, 'frame_amethyst')).status, 200, 'másnap újra lehet');
    api.state.date = '2026-10-07';
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
