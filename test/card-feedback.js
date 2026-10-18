'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kártya-visszajelzés: a vádra adott 😂 / 👎 szavazat
//   A) tároló (cardfeedback.js): csak ismert beépített vád kerül be, szavazat-váltás, törlés, rendezés, mentés/újratöltés, lecserélt kártya kihullik
//   B) játékmotor: ítélet után / kör végén szavazhat az élő, nem bot játékos; egyéni vád és közösségi csomag nem; az állapot csak a számokat és a saját szavazatot mutatja
//   C) admin végpont: token nélkül 401, lista, rendezés, törlés
// Futtatás: node test/card-feedback.js
// ============================================================
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { Game, PHASES } = require('../game');
const { createCardFeedback, MAX_ENTRIES } = require('../cardfeedback');
const { createAdmin } = require('../admin');
const CARDS = require('../data/cards.json');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-cardfb-'));
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.stack || e)); }
}
const TEXT = CARDS.buli.vadak[0], TEXT2 = CARDS.buli.vadak[1], TEXT3 = CARDS.cs.vadak[0];

function mkGame(n, settings = {}, extra = null) {
  const g = new Game('CF', { to: () => ({ emit: () => {} }), emit: () => {} });
  if (extra) g.addExtraMode(extra.code, extra.snap);
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, modes: ['buli'], ...settings }, 'u0');
  return g;
}
function toVerdict(g) {
  const d = g.roundData;
  g.startVerdictVote();
  d.voters.forEach((id, i) => g.castVerdictVote(id, i % 2 ? 'guilty' : 'not_guilty'));
  g.finishVerdictVote();
  assert.equal(g.phase, PHASES.VERDICT);
}

(async () => {
  // ---------------- A) tároló ----------------
  await test('A) csak ismert beépített vád kerül be; ismeretlen mód, átírt szöveg, nem szöveg nem', () => {
    const s = createCardFeedback({});
    assert.equal(s.record('buli', TEXT, null, true), true);
    assert.equal(s.record('buli', 'Ez nincs a kártyák közt.', null, true), false);
    assert.equal(s.record('nincsilyen', TEXT, null, true), false);
    assert.equal(s.record('pack:ABCDEF', TEXT, null, true), false);
    assert.equal(s.record('buli', 123, null, true), false);
    assert.equal(s.record('cs', TEXT, null, true), false, 'a vád csak a saját témájában számít');
    assert.deepEqual(s.summary(), { cards: 1, votes: 1 });
  });
  await test('A) szavazat-váltás: 😂 -> 👎 -> visszavonás; a szám sosem negatív, az üres bejegyzés kihullik', () => {
    const s = createCardFeedback({});
    s.record('buli', TEXT, null, true); s.record('buli', TEXT, null, true);
    assert.deepEqual(s.list({ min: 1 }).map((r) => [r.yes, r.no]), [[2, 0]]);
    s.record('buli', TEXT, true, false);
    assert.deepEqual(s.list({ min: 1 }).map((r) => [r.yes, r.no]), [[1, 1]]);
    assert.equal(s.record('buli', TEXT, false, false), false, 'változatlan szavazat: nincs hatás');
    s.record('buli', TEXT, true, null); s.record('buli', TEXT, false, null);
    assert.deepEqual(s.summary(), { cards: 0, votes: 0 });
    assert.equal(s.record('buli', TEXT, true, null), false, 'üres bejegyzésből nem lehet negatívba menni') ;
    assert.deepEqual(s.summary(), { cards: 0, votes: 0 });
  });
  await test('A) lista: leggyengébb elöl, legjobb elöl, legtöbb szavazat; szűrés minimummal', () => {
    const s = createCardFeedback({});
    for (let i = 0; i < 4; i++) s.record('buli', TEXT, null, false);           // 0 / 4
    s.record('buli', TEXT, null, true);                                          // 1 / 5 (80% 👎)
    for (let i = 0; i < 3; i++) s.record('buli', TEXT2, null, true);            // 3 / 0
    s.record('cs', TEXT3, null, false);                                          // 0 / 1
    assert.deepEqual(s.list({ min: 1, sort: 'worst' }).map((r) => r.text), [TEXT3, TEXT, TEXT2]);
    assert.deepEqual(s.list({ min: 1, sort: 'best' }).map((r) => r.text), [TEXT2, TEXT, TEXT3]);
    assert.deepEqual(s.list({ min: 1, sort: 'votes' }).map((r) => r.text), [TEXT, TEXT2, TEXT3]);
    assert.deepEqual(s.list({ min: 3, sort: 'worst' }).map((r) => r.text), [TEXT, TEXT2], 'legalább 3 szavazat');
    const top = s.list({ min: 1, sort: 'worst' })[0];
    assert.equal(top.modeName, CARDS.cs.nev); assert.equal(top.total, 1); assert.equal(top.noShare, 1);
  });
  await test('A) mentés és újratöltés; a lecserélt (már nem létező) kártya szavazata kihullik; a törlés kulcs szerint', () => {
    const file = path.join(tmp, 'a.json');
    const s = createCardFeedback({ file });
    s.record('buli', TEXT, null, true); s.record('buli', TEXT2, null, false);
    s.flush();
    const again = createCardFeedback({ file });
    assert.deepEqual(again.summary(), { cards: 2, votes: 2 });
    // egy "lecserélt" kártya: kézzel olyan szöveget írunk a fájlba, ami nincs a cards.json-ban
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const k = Object.keys(raw.cards)[0]; raw.cards['buli|000000000000'] = { m: 'buli', t: 'Régi, lecserélt vád.', y: 5, n: 0, u: 1 };
    fs.writeFileSync(file, JSON.stringify(raw));
    const pruned = createCardFeedback({ file });
    assert.deepEqual(pruned.summary(), { cards: 2, votes: 2 }, 'a lecserélt kártya nem tölt be');
    assert.equal(pruned.clear('buli|nincs'), false);
    assert.equal(pruned.clear(k), true);
    assert.deepEqual(pruned.summary(), { cards: 1, votes: 1 });
    assert.ok(!fs.readdirSync(tmp).some((f) => f.endsWith('.tmp')), 'nem maradt ideiglenes fájl');
  });
  await test('A) a fájl nem tartalmaz játékos- vagy fiókazonosítót; sérült fájlnál üresen indul', () => {
    const file = path.join(tmp, 'b.json');
    const s = createCardFeedback({ file });
    s.record('buli', TEXT, null, true); s.flush();
    const raw = fs.readFileSync(file, 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(raw)), ['version', 'cards']);
    assert.ok(!/u0|playerId|userId/.test(raw));
    fs.writeFileSync(file, '{ nem json');
    const logged = []; const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
    try { assert.deepEqual(createCardFeedback({ file }).summary(), { cards: 0, votes: 0 }); } finally { console.error = orig; }
    assert.ok(logged.length === 1);
  });

  // ---------------- B) játékmotor ----------------
  await test('B) ítélet után szavazni lehet; a szavazat átvezetődik a tárolóba; váltás és visszavonás működik; az állapot a számokat és a sajátot mutatja', () => {
    const store = createCardFeedback({}); Game.setCardFeedback(store);
    const g = mkGame(5);
    const d = g.roundData, tpl = d.accusationTemplate;
    assert.ok(CARDS.buli.vadak.includes(tpl), 'a sablon a beépített vád');
    assert.equal(g.accusationFunVote('u1', true), false, 'ítélet előtt még nem lehet');
    assert.equal(g.publicState('u1').accFun, undefined);
    toVerdict(g);
    assert.deepEqual(g.publicState('u1').accFun, { yes: 0, no: 0, mine: null, canVote: true });
    assert.equal(g.accusationFunVote('u1', true), true);
    assert.equal(g.accusationFunVote('u2', false), true);
    assert.equal(g.accusationFunVote('u3', true), true);
    assert.equal(g.accusationFunVote('u3', true), false, 'ugyanaz a szavazat újra: nincs hatás');
    assert.deepEqual(g.publicState('u1').accFun, { yes: 2, no: 1, mine: true, canVote: true });
    assert.deepEqual(g.publicState('u2').accFun, { yes: 2, no: 1, mine: false, canVote: true });
    assert.equal(g.accusationFunVote('u3', false), true, 'váltás 😂 -> 👎');
    assert.equal(g.accusationFunVote('u1', null), true, 'visszavonás');
    const row = store.list({ min: 1 }).find((r) => r.text === tpl);
    assert.deepEqual([row.yes, row.no], [0, 2]);
    assert.deepEqual(g.publicState('u0').accFun, { yes: 0, no: 2, mine: null, canVote: true });
    // a másik játékos szavazatát nem látni: az állapotban nincs kiszivárgó azonosító
    assert.ok(!JSON.stringify(g.publicState('u1').accFun).includes('u2'));
    Game.setCardFeedback(null);
  });
  await test('B) a kör végén (ROUND_RESULTS) is lehet szavazni; a következő körben nulláról indul', () => {
    const store = createCardFeedback({}); Game.setCardFeedback(store);
    const g = mkGame(5);
    toVerdict(g); g.proceedAfterVerdict();
    assert.equal(g.phase, PHASES.ROUND_RESULTS);
    assert.equal(g.accusationFunVote('u1', false), true);
    assert.deepEqual(g.publicState('u2').accFun, { yes: 0, no: 1, mine: null, canVote: true });
    assert.equal(store.summary().votes, 1);
    Game.setCardFeedback(null);
  });
  await test('B) nem szavazhat: bot, nem csatlakozott játékos, ismeretlen játékos; kapcsolat nélküli tárolónál sem hibázik', () => {
    const store = createCardFeedback({}); Game.setCardFeedback(store);
    const g = mkGame(5);
    toVerdict(g);
    g.addBot();
    const bot = [...g.players.values()].find((p) => p.isBot);
    assert.equal(g.accusationFunVote(bot.id, true), false);
    g.getPlayer('u4').connected = false;
    assert.equal(g.accusationFunVote('u4', true), false);
    assert.equal(g.accusationFunVote('nincs', true), false);
    assert.equal(store.summary().votes, 0);
    Game.setCardFeedback(null);
    assert.equal(g.accusationFunVote('u1', true), true, 'tároló nélkül is működik a szavazás (csak nem gyűlik)');
  });
  await test('B) egyéni (házigazdai) vádnál és közösségi csomagnál nincs értékelés', () => {
    const store = createCardFeedback({}); Game.setCardFeedback(store);
    let custom = null;
    for (let i = 0; i < 300 && !custom; i++) { const g = mkGame(4, { customAccusations: ['Egyedi vád teszthez [vádlott] miatt.'] }); if (g.roundData.isCustomAccusation) custom = g; }
    assert.ok(custom, 'találtunk egyéni vádas kört');
    assert.equal(custom.roundData.accusationTemplate, null);
    toVerdict(custom);
    assert.equal(custom.publicState('u1').accFun, undefined);
    assert.equal(custom.accusationFunVote('u1', true), false);
    const deck = (t) => Array.from({ length: 8 }, (_, i) => t + ' ' + i + '.');
    const snap = { nev: 'Teszt csomag', owner: 'valaki', vadak: deck('Vád'), bizonyitekok: deck('Bizonyíték'), alibik: deck('Alibi'), trukkok: deck('Trükk'), tanuk: deck('Tanú'), kihivasok: deck('Kihívás'), buntetesek: deck('Büntetés') };
    const g = mkGame(4, { modes: ['pack:ABCDEF'] }, { code: 'ABCDEF', snap });
    assert.equal(g.roundData.mode, 'pack:ABCDEF');
    assert.equal(g.roundData.accusationTemplate, null);
    toVerdict(g);
    assert.equal(g.publicState('u1').accFun, undefined);
    assert.equal(g.accusationFunVote('u1', true), false);
    assert.equal(store.summary().votes, 0);
    Game.setCardFeedback(null);
  });
  await test('B) Vegyes módnál a vád a kör tényleges témájához tartozik', () => {
    const store = createCardFeedback({}); Game.setCardFeedback(store);
    const modes = Object.keys(CARDS).filter((k) => k !== 'altalanos');
    const g = mkGame(4, { modes });
    toVerdict(g);
    const d = g.roundData;
    assert.ok(CARDS[d.mode].vadak.includes(d.accusationTemplate));
    assert.equal(g.accusationFunVote('u1', true), true);
    assert.equal(store.list({ min: 1 })[0].mode, d.mode);
    Game.setCardFeedback(null);
  });

  // ---------------- C) admin végpont ----------------
  await test('C) admin: token nélkül 401; lista, rendezés, minimum; törlés kulcs szerint; hibás kulcs 400, ismeretlen 404', async () => {
    const store = createCardFeedback({});
    for (let i = 0; i < 3; i++) store.record('buli', TEXT, null, false);
    for (let i = 0; i < 3; i++) store.record('buli', TEXT2, null, true);
    const TOKEN = 'admin-token-' + 'x'.repeat(24);
    const admin = createAdmin({ token: TOKEN, errors: { record() {} }, storage: {}, auth: {}, moderation: null, cardFeedback: store });
    const app = express(); app.use('/api/admin', admin.router);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const BASE = 'http://127.0.0.1:' + server.address().port;
    const call = (method, route, body, auth = true) => fetch(BASE + '/api/admin' + route, { method, headers: { ...(auth ? { Authorization: 'Bearer ' + TOKEN } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    try {
      assert.equal((await call('GET', '/cardfeedback', null, false)).status, 401);
      const worst = await (await call('GET', '/cardfeedback?sort=worst&min=3')).json();
      assert.deepEqual(worst.summary, { cards: 2, votes: 6 });
      assert.deepEqual(worst.cards.map((c) => c.text), [TEXT, TEXT2]);
      assert.deepEqual((await (await call('GET', '/cardfeedback?sort=best&min=3')).json()).cards.map((c) => c.text), [TEXT2, TEXT]);
      assert.equal((await (await call('GET', '/cardfeedback?min=4')).json()).cards.length, 0);
      assert.equal((await call('POST', '/cardfeedback/clear', { key: '../x' })).status, 400);
      assert.equal((await call('POST', '/cardfeedback/clear', { key: 'buli|000000000000' })).status, 404);
      assert.equal((await call('POST', '/cardfeedback/clear', { key: worst.cards[0].key })).status, 200);
      assert.deepEqual((await (await call('GET', '/cardfeedback?min=1')).json()).summary, { cards: 1, votes: 3 });
    } finally { server.close(); }
  });
  await test('C) a tároló határa: a bejegyzések száma korlátos', () => {
    assert.ok(MAX_ENTRIES >= 500 && MAX_ENTRIES <= 5000);
  });

  console.log('\nKártya-visszajelzés: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  // kis várakozás a kilépés előtt: a még záródó kapcsolatok mellett az azonnali process.exit Windowson néha libuv-assertiont dob (az eredménytől független)
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
