'use strict';
// ============================================================
// KAMU BÍRÓSÁG – Discord-háttér: a Discord-fiók összekapcsolásának jutalma (feloldható bolt-tárgy)
//  - a jogosultságot a fiók ELLENŐRZÖTT Discord-kapcsolata adja (user.providers), nem vásárolható és nem ajándékozható
//  - Discord-belépéssel regisztrálva / összekapcsolva egyszer automatikusan felkerül (ha a kártyahát üres), utána szabadon levehető / cserélhető
//  - a tárolt "owned" listába nem kerül (az összekapcsolással együtt jár és szűnik meg), a többi játékos a kozmetikumok között látja
// Valódi HTTP-kérések, ideiglenes fióktár, a Discord csak teszt-transporttal. Futtatás: node test/discord-bg.js
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { createAuth } = require('../auth');
const { createShop, cosmeticsFor, shopOf, CATALOG } = require('../shop');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-dbg-'));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}
const password = 'Egy hosszú titok 123!';

async function main() {
  const app = express(), server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const file = path.join(tmp, 'accounts.json');
  let discordProfile = { id: 'discord-1', email: 'dc1@example.invalid', verified: true, global_name: 'Discord Elek' };
  let shop;
  const auth = createAuth({
    file, maxAttempts: 200,
    env: { AUTH_BASE_URL: base, AUTH_DISCORD_CLIENT_ID: 'discord-test', AUTH_DISCORD_CLIENT_SECRET: 'discord-secret' },
    fetch: async (url) => Response.json(url.includes('/token') ? { access_token: 'test-access-token' } : discordProfile),
    onProviderLinked: (user, provider) => shop.onProviderLinked(user, provider)
  });
  shop = createShop({ auth, dailyCounts: () => ({}) });
  app.use('/api/auth', auth.router);
  app.use('/api/shop', shop.router);

  const call = async (method, route, body, jar) => {
    const headers = method === 'POST' ? { 'Content-Type': 'application/json', Origin: base } : {};
    if (jar && jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const response = await fetch(base + route, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    if (jar) for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';')[0], i = first.indexOf('=');
      if (first.slice(i + 1)) jar.set(first.slice(0, i), first.slice(i + 1)); else jar.delete(first.slice(0, i));
    }
    const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
    return { status: response.status, data, text, location: response.headers.get('location') };
  };
  // Discord-belépés / -összekapcsolás a teszt-transporttal
  const discordFlow = async (jar, link) => {
    const start = await call('GET', '/api/auth/discord/start' + (link ? '?link=1' : ''), undefined, jar);
    assert.equal(start.status, 302, start.text);
    const state = new URL(start.location).searchParams.get('state');
    const done = await call('GET', '/api/auth/discord/callback?state=' + encodeURIComponent(state) + '&code=mock', undefined, jar);
    assert.match(done.location, /auth=success/, done.location);
  };
  const shopState = async (jar) => (await call('GET', '/api/shop/state', undefined, jar)).data;
  const stored = (name) => JSON.parse(fs.readFileSync(file, 'utf8')).users.find((u) => u.username === name);

  await test('A katalógusban a Discord-háttér feloldható tárgy: kártyahát, ingyenes, nem szezonális, van hozzá CSS', () => {
    const item = CATALOG.targyak.find((i) => i.id === 'bg_discord');
    assert.ok(item, 'a bg_discord szerepel a katalógusban');
    assert.equal(item.slot, 'bg'); assert.equal(item.ar, 0); assert.equal(item.feloldas, 'discord'); assert.ok(!item.szezon);
    assert.ok(CATALOG.ritkasagok.includes(item.ritkasag));
    assert.equal(CATALOG.targyak.filter((i) => i.feloldas).length, 1, 'jelenleg egyetlen feloldható tárgy');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
    assert.ok(css.includes('.mug-card.cos-bg-discord, .poster.cos-bg-discord {'), 'a kártya- és plakát-háttér CSS megvan');
    assert.ok(/--bg-anim: cos-discord /.test(css) && css.includes('@keyframes cos-discord '), 'a háttér mozog, és a mozgás kikapcsolható (--bg-anim)');
    assert.ok(/^[a-z]+_[a-z]+$/.test(item.id), 'a kliens osztály-azonosítója érvényes (cos-bg-discord)');
  });

  const passJar = new Map(), dcJar = new Map();
  await test('Jelszavas fiók Discord nélkül: a tárgy nincs meg, nem vehető fel, nem vásárolható, nem ajándékozható', async () => {
    assert.equal((await call('POST', '/api/auth/register', { username: 'Jelszavas Jolan', email: 'jolan@example.invalid', password, confirmPassword: password }, passJar)).status, 201);
    const s = await shopState(passJar);
    assert.ok(!s.owned.includes('bg_discord'));
    assert.ok(s.catalog.targyak.find((i) => i.id === 'bg_discord'), 'a boltban látszik (a kliens ebből mutatja az összekapcsolás gombot)');
    assert.equal((await call('POST', '/api/shop/equip', { slot: 'bg', itemId: 'bg_discord' }, passJar)).status, 403, 'felvétel');
    const buy = await call('POST', '/api/shop/buy', { itemId: 'bg_discord' }, passJar);
    assert.equal(buy.status, 403); assert.match(buy.data.error, /nem vásárolható/);
    const gift = await call('POST', '/api/shop/gift', { itemId: 'bg_discord', friendId: 'valaki' }, passJar);
    assert.equal(gift.status, 403); assert.match(gift.data.error, /nem ajándékozható/);
    assert.equal(cosmeticsFor(auth.directory.byName('Jelszavas Jolan')), null, 'mások sem látják');
  });

  await test('Discord-belépéssel regisztrált fiók: a Discord-háttér megvan és felvéve; mások is látják; a tárolt owned-ba nem kerül', async () => {
    await discordFlow(dcJar);
    const s = await shopState(dcJar);
    assert.ok(s.owned.includes('bg_discord'), 'megvan');
    assert.equal(s.equipped.bg, 'bg_discord', 'automatikusan felvéve');
    const user = auth.directory.byName('Discord Elek');
    assert.deepEqual(cosmeticsFor(user), { bg: 'bg_discord' }, 'a többi játékos is ezt kapja');
    const raw = stored('Discord Elek').shop;
    assert.ok(!raw.owned.includes('bg_discord'), 'nem a bolt tárolja, hanem a kapcsolat adja');
    assert.deepEqual(raw.offered, ['bg_discord']); assert.equal(raw.equipped.bg, 'bg_discord');
  });

  await test('Levétel és újra-belépés: a játékos döntése megmarad (nem vesszük fel újra), de szabadon felveheti', async () => {
    assert.equal((await call('POST', '/api/shop/equip', { slot: 'bg', itemId: null }, dcJar)).status, 200);
    assert.equal((await shopState(dcJar)).equipped.bg, undefined, 'levéve');
    const again = new Map();
    await discordFlow(again);
    const s = await shopState(again);
    assert.equal(s.equipped.bg, undefined, 'a Discord-belépés nem veszi vissza');
    assert.ok(s.owned.includes('bg_discord'), 'de megvan');
    const eq = await call('POST', '/api/shop/equip', { slot: 'bg', itemId: 'bg_discord' }, again);
    assert.equal(eq.status, 200, eq.text); assert.equal(eq.data.equipped.bg, 'bg_discord');
  });

  await test('Meglévő jelszavas fiók utólag összekapcsolja a Discordot: megkapja; ha már van felvett háttere, az megmarad', async () => {
    const jar = new Map();
    assert.equal((await call('POST', '/api/auth/register', { username: 'Hatteres Hedi', email: 'hedi@example.invalid', password, confirmPassword: password }, jar)).status, 201);
    const user = auth.directory.byName('Hatteres Hedi');
    auth.mutate(user.id, (u) => { u.shop = { wallet: 0, earned: 0, owned: ['bg_night'], equipped: { bg: 'bg_night' }, claims: {} }; return u; });
    discordProfile = { id: 'discord-2', email: 'dc2@example.invalid', verified: true, global_name: 'Masik Discord' };
    await discordFlow(jar, true);
    const s = await shopState(jar);
    assert.ok(s.owned.includes('bg_discord') && s.owned.includes('bg_night'));
    assert.equal(s.equipped.bg, 'bg_night', 'a meglévő választást nem írjuk felül');
    assert.deepEqual(stored('Hatteres Hedi').shop.offered, ['bg_discord'], 'az ajánlat megtörtént, ezért később sem vesszük fel magától');
    assert.deepEqual(stored('Hatteres Hedi').shop.owned, ['bg_night'], 'csak a megvásárolt tárgy tárolt');
    assert.equal((await call('POST', '/api/shop/equip', { slot: 'bg', itemId: 'bg_discord' }, jar)).status, 200, 'cserélhet');
  });

  await test('A kapcsolat megszűnésével a tárgy is megszűnik (mások sem látják), a felvett jelölés ártalmatlan', async () => {
    const user = auth.directory.byName('Discord Elek');
    assert.deepEqual(cosmeticsFor(user), { bg: 'bg_discord' });
    auth.mutate(user.id, (u) => { delete u.providers.discord; return u; });
    const after = auth.directory.byName('Discord Elek');
    assert.equal(cosmeticsFor(after), null, 'a háttér nem jelenik meg');
    assert.ok(!shopOf(after).owned.includes('bg_discord'));
    // az eltárolt jelölés megmarad, de a kapcsolat visszakerülésekor újra működik
    auth.mutate(user.id, (u) => { u.providers.discord = 'discord-1'; return u; });
    assert.deepEqual(cosmeticsFor(auth.directory.byName('Discord Elek')), { bg: 'bg_discord' });
  });

  await test('Régi (a funkció előtti) Discord-fiók: a következő Discord-belépéskor egyszer felkerül a háttér', async () => {
    const jar = new Map();
    discordProfile = { id: 'discord-3', email: 'dc3@example.invalid', verified: true, global_name: 'Regi Discord' };
    await discordFlow(jar); // létrejön az új fiók (auto-felvétel)
    const user = auth.directory.byName('Regi Discord');
    auth.mutate(user.id, (u) => { u.shop = { wallet: 0, earned: 0, owned: [], equipped: {}, claims: {} }; return u; }); // mintha a funkció előtt jött volna létre
    const again = new Map();
    await discordFlow(again);
    assert.equal((await shopState(again)).equipped.bg, 'bg_discord');
  });

  await test('Más szolgáltató (Google) nem ad Discord-hátteret', async () => {
    const guest = auth.directory.byName('Jelszavas Jolan');
    assert.equal(cosmeticsFor(guest), null);
    auth.mutate(guest.id, (u) => { u.providers.google = 'g-1'; return u; });
    assert.equal(cosmeticsFor(auth.directory.byName('Jelszavas Jolan')), null, 'Google nem jogosít Discord-háttérre');
    assert.ok(!shopOf(auth.directory.byName('Jelszavas Jolan')).owned.includes('bg_discord'));
  });

  server.close();
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nDiscord-háttér: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
