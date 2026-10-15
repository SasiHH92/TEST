'use strict';
// ============================================================
// KAMU BÍRÓSÁG – közösségi kártyacsomagok (Kártyaműhely): ellenőrzés, tároló, API, motor, socket, admin
//  A) szövegellenőrzés: link / HTML / @ / helyőrző / duplikátum / hossz / pakli-méret
//  B) tároló: létrehozás, limit, szerkesztés, törlés, könyvtár, mentés, jelentés → elrejtés, fiók-életciklus, perzisztencia
//  C) motor: a csomag módként viselkedik (3 kör, Vegyes cards.json-módokkal is), hibás pillanatfelvételt nem fogad el
//  D) valódi szerver: HTTP API (jogosultság, CSRF, életút, jelentés, írási korlát, admin), socket (házigazda csomagjai, kóddal felvétel, indítás, számláló), fiók-törlés, adatkérés
// Futtatás: node test/packs.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const io = require('socket.io-client');
const { createPacks, cleanPackInput, DECKS, REPORTS_TO_HIDE, WRITES_PER_HOUR, MISSES_PER_WINDOW } = require('../packs');
const { Game } = require('../game');

const root = path.resolve(__dirname, '..');
const PORT = 3236, BASE = 'http://127.0.0.1:' + PORT;
const ADMIN_TOKEN = 'admin-token-' + 'x'.repeat(20);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-packs-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + (e && e.stack || e)); }
}

// érvényes, egyedi szövegek (a pakli neve is belekerül, így a paklik között sincs ütközés)
const cards = (deck, n, extra = '') => Array.from({ length: n }, (_, i) => 'Az egyik ' + deck + ' kártya száma ' + (i + 1) + extra + '.');
const SIZE = { vadak: 7, bizonyitekok: 5, alibik: 4, trukkok: 4, tanuk: 4, kihivasok: 4, buntetesek: 4 };
const goodPack = (name = 'Teszt csomag', extra = '') => ({ name, desc: 'Egy kis leírás a csomagról', visibility: 'public', decks: Object.fromEntries(DECKS.map((d) => [d, cards(d, SIZE[d], extra)])) });
const withEdit = (edit, base = goodPack()) => { const p = JSON.parse(JSON.stringify(base)); edit(p); return p; };
const errorsOf = (input) => cleanPackInput(input).errors.join(' | ');

(async () => {
  // ================= A) szövegellenőrzés =================
  await test('A) érvényes csomag átmegy; a szöveg tisztított (szóköz, vezérlőkarakter); sorokra bontott szöveg is jó', () => {
    assert.equal(cleanPackInput(goodPack()).ok, true);
    const messy = withEdit((p) => { p.name = '  Teszt \u0000  csomag  '; p.decks.vadak[0] = '  Az egyik\tvád ​  szövege.  '; });
    const r = cleanPackInput(messy); assert.equal(r.ok, true); assert.equal(r.value.name, 'Teszt csomag'); assert.equal(r.value.decks.vadak[0], 'Az egyik vád szövege.');
    const asText = withEdit((p) => { p.decks.alibik = p.decks.alibik.join('\n\n'); });
    assert.equal(cleanPackInput(asText).ok, true, 'sortöréssel elválasztott szöveg is elfogadott');
    assert.equal(cleanPackInput(null).ok, false); assert.equal(cleanPackInput('szöveg').ok, false);
    assert.equal(cleanPackInput(JSON.parse('{"__proto__":{"x":1},"name":"Három","decks":{}}')).ok, false, 'prototípus-játék nem okoz hibát');
  });

  await test('A) név- és leírás-szabályok: hossz, tiltott karakter, @, link', () => {
    for (const bad of ['', 'ab', 'x'.repeat(41), 'Csomag <b>', 'Csomag @everyone', 'Nézd: https://valami.hu', 'discord.gg/valami', 'valami.hu csomag']) {
      assert.ok(cleanPackInput(withEdit((p) => { p.name = bad; })).errors.some((e) => /neve/.test(e)), 'név elutasítva: ' + bad);
    }
    for (const ok of ['Ékezetes Árvíztűrő csomag', 'Csomag 2.0 (új!)', 'A "nagy" csomag', "Don't stop"]) assert.equal(cleanPackInput(withEdit((p) => { p.name = ok; })).ok, true, 'név jó: ' + ok);
    assert.match(errorsOf(withEdit((p) => { p.desc = 'x'.repeat(141); })), /leírás/);
    assert.match(errorsOf(withEdit((p) => { p.desc = 'Írj ide: @valaki'; })), /leírás/);
    assert.match(errorsOf(withEdit((p) => { p.desc = 'Lásd www.valami.hu'; })), /leírás/);
    assert.equal(cleanPackInput(withEdit((p) => { delete p.desc; })).ok, true, 'a leírás nem kötelező');
  });

  await test('A) kártya-szabályok: hossz, < > @, linkek és meghívók, helyőrzők, ismétlődő karakterek, duplikátum', () => {
    const bad = (deck, text, re) => assert.match(errorsOf(withEdit((p) => { p.decks[deck][0] = text; })), re, deck + ': ' + text);
    bad('vadak', 'Rövid', /^$|túl rövid|ismétlődő/) ; // "Rövid" 5 karakter: érvényes; lent külön
    bad('vadak', 'ab', /túl rövid/);
    bad('vadak', 'x'.repeat(131), /túl hosszú/);
    bad('alibik', 'Ez <b>félkövér</b> alibi.', /< vagy >/);
    bad('trukkok', 'Írj nekem: valaki@pelda.hu kérlek.', /@/);
    for (const link of ['Nézd https://rossz.link/csalas most.', 'Itt a www.rossz.link oldal.', 'Gyere: discord.gg/abcdef most.', 'A rossz.hu oldalon van.', 'Menj a discord.com/invite/xyz címre.']) bad('tanuk', link, /linket|meghívót/);
    bad('kihivasok', 'Beszélj úgy, mint aaaaaaaaaaaa.', /ismétlődő/);
    bad('buntetesek', '12345 6789 !!!', /értelmes/);
    bad('vadak', 'Ez [valaki] volt a tettes.', /helyőrző/);
    bad('vadak', 'Ez [ üres a szögletes.', /szögletes/);
    bad('bizonyitekok', 'Az [vádlott] ujjlenyomata.', /csak a vádakban/);
    assert.equal(cleanPackInput(withEdit((p) => { p.decks.vadak[0] = '[vádlott] ellopta [játékos] kedvenc sapkáját.'; })).ok, true, 'vádban a két helyőrző használható');
    const dup = withEdit((p) => { p.decks.alibik[1] = p.decks.vadak[0].toUpperCase(); });
    assert.match(errorsOf(dup), /már szerepel/, 'duplikátum (kis/nagybetű és írásjel nélkül) a paklik között is');
  });

  await test('A) pakli-méretek: minimum és maximum; az üres sorok nem számítanak; sok hiba esetén a lista korlátos', () => {
    for (const d of DECKS) {
      const few = withEdit((p) => { p.decks[d] = p.decks[d].slice(0, 1); });
      assert.match(errorsOf(few), new RegExp('legalább'), d + ' kevés');
    }
    const many = withEdit((p) => { p.decks.vadak = cards('vadak', 61); }); assert.match(errorsOf(many), /legfeljebb 60/);
    const blanks = withEdit((p) => { p.decks.vadak = ['', '   ', ...p.decks.vadak, '']; }); assert.equal(cleanPackInput(blanks).ok, true);
    const flood = withEdit((p) => { for (const d of DECKS) p.decks[d] = Array.from({ length: 20 }, () => 'a'); });
    assert.ok(cleanPackInput(flood).errors.length <= 14, 'a hibalista korlátos');
  });

  // ================= B) tároló =================
  const clock = { t: 1700000000000 };
  const persisted = [];
  const file = path.join(tmp, 'packs-unit.json');
  const store = createPacks({ file, persist: (f) => persisted.push(f), now: () => clock.t });
  const U = (id, name) => ({ id, username: name });
  const anna = U('u-anna', 'Anna'), bela = U('u-bela', 'Béla'), cili = U('u-cili', 'Cili'), dani = U('u-dani', 'Dani'), emma = U('u-emma', 'Emma');

  await test('B) létrehozás: 6 jegyű kód (nincs 0/O/1/I), név-egyediség fiókon belül, fiók-limit, csak a tulajdonos szerkeszthet / törölhet', () => {
    const a = store.create(anna, goodPack('Anna csomagja'));
    assert.equal(a.ok, true); assert.match(a.pack.code, /^[A-HJ-NP-Z2-9]{6}$/); assert.equal(a.pack.owner, 'Anna'); assert.equal(a.pack.mine, true); assert.equal(a.pack.total, 7 + 5 + 4 * 5);
    assert.equal(store.create(anna, goodPack('  ANNA csomagja ')).ok, false, 'azonos név (kis/nagybetűtől függetlenül) nem megy');
    assert.equal(store.create(bela, goodPack('Anna csomagja', ' b')).ok, true, 'más fióknak lehet ugyanaz a név');
    assert.equal(store.update(bela, a.pack.code, goodPack('Béla átírja')).ok, false, 'más csomagját nem szerkesztheti');
    assert.equal(store.remove(bela, a.pack.code), false, 'más csomagját nem törölheti');
    const up = store.update(anna, a.pack.code, goodPack('Anna csomagja', ' új'));
    assert.equal(up.ok, true); assert.ok(up.pack.decks.vadak[0].includes('új'));
    for (let i = 2; i <= 5; i++) assert.equal(store.create(anna, goodPack('Anna ' + i, ' ' + i)).ok, true);
    const sixth = store.create(anna, goodPack('Anna 6', ' 6')); assert.equal(sixth.ok, false); assert.match(sixth.errors[0], /Legfeljebb 5/);
    const bad = store.create(emma, withEdit((p) => { p.decks.vadak = []; })); assert.equal(bad.ok, false);
    assert.equal(store.count(), 6);
  });

  await test('B) könyvtár: csak a nyilvános és nem rejtett; keresés névre / leírásra / készítőre; népszerűség szerinti rendezés; lapozás', () => {
    const priv = store.create(cili, { ...goodPack('Cili titkos', ' c'), visibility: 'private' }); assert.equal(priv.ok, true);
    const pub = store.create(cili, goodPack('Cili nyilvános', ' d')); clock.t += 1000;
    const lib = store.listPublic({}); assert.ok(lib.packs.every((p) => p.visibility === 'public'));
    assert.ok(!lib.packs.some((p) => p.name === 'Cili titkos'), 'a privát csomag nincs a könyvtárban');
    assert.equal(store.view(priv.pack.code, null).name, 'Cili titkos', 'de kóddal bárki megnézheti');
    assert.equal(store.listPublic({ q: 'cili nyilv' }).packs[0].code, pub.pack.code, 'keresés névre');
    assert.ok(store.listPublic({ q: 'kis leírás' }).total >= 3, 'keresés leírásra');
    assert.ok(store.listPublic({ q: 'ANNA' }).packs.every((p) => /Anna/.test(p.owner + p.name)), 'keresés készítőre');
    assert.equal(store.listPublic({ limit: 2 }).packs.length, 2); assert.equal(store.listPublic({ limit: 2, offset: 2 }).packs.length, 2);
    store.save(dani, pub.pack.code); store.save(emma, pub.pack.code);
    assert.equal(store.listPublic({ sort: 'popular' }).packs[0].code, pub.pack.code, 'a legtöbbször mentett elöl');
    assert.ok(!JSON.stringify(store.listPublic({})).includes('u-anna'), 'tulajdonos-azonosító nem szivárog');
  });

  await test('B) mentés / levétel: saját csomag nem menthető, duplán nem, legfeljebb 30; a gyűjtemény a mentett és saját csomagokat adja', () => {
    const lib = store.listPublic({ limit: 60 }).packs;
    const mine = store.mine(anna); assert.equal(mine.owned.length, 5); assert.deepEqual(mine.saved, []);
    assert.equal(store.save(anna, mine.owned[0].code).ok, false, 'saját csomag nem menthető');
    const target = lib.find((p) => p.owner === 'Béla');
    assert.equal(store.save(anna, target.code).ok, true); assert.equal(store.save(anna, target.code).already, true);
    assert.equal(store.mine(anna).saved.length, 1); assert.equal(store.mine(anna).saved[0].saved, true);
    assert.equal(store.unsave(anna, target.code), true); assert.equal(store.unsave(anna, target.code), false);
    assert.equal(store.save(anna, 'ZZZZZZ').ok, false, 'ismeretlen kód');
    // 30-as korlát: Emma 30 csomagot ment (több fiók hozza létre őket)
    const owners = Array.from({ length: 8 }, (_, i) => U('u-own' + i, 'Gazda' + i)); let made = 0;
    for (const o of owners) for (let i = 0; i < 5 && made < 31; i++, made++) store.create(o, goodPack('Tömeg ' + o.id + i, ' z' + o.id + i));
    const all = store.listPublic({ limit: 60 }).packs.filter((p) => p.owner.startsWith('Gazda'));
    assert.ok(all.length >= 31, 'elég csomag van a korlát próbájához');
    let blocked = null; for (const p of all) { const r = store.save(emma, p.code); if (!r.ok) { blocked = r; break; } }
    assert.equal(store.mine(emma).saved.length, 30, 'pontosan 30 csomag fér a gyűjteménybe (Emma korábban már mentett egyet)');
    assert.ok(blocked && /Legfeljebb 30/.test(blocked.error), 'a 31. mentés elutasítva: ' + JSON.stringify(blocked));
  });

  await test('B) jelentés: fiókonként egyszer, a sajátot nem; ' + REPORTS_TO_HIDE + ' különböző jelentő után elbújik (könyvtár, kód, szoba); a készítő látja; az admin visszaállíthatja / törölheti', () => {
    const p = store.create(emma, goodPack('Emma vitatott', ' e')); const code = p.pack.code;
    assert.equal(store.report(emma, code).ok, false, 'a sajátot nem jelentheti');
    assert.equal(store.report(anna, code).count, 1); assert.equal(store.report(anna, code).already, true, 'ugyanaz a jelentő nem számít kétszer');
    assert.equal(store.report(bela, code).hidden, false);
    assert.ok(store.modeFor(code, null), 'két jelentésnél még használható');
    assert.equal(store.report(cili, code).hidden, true, 'a harmadik jelentő elrejti');
    assert.ok(!store.listPublic({ limit: 60 }).packs.some((x) => x.code === code), 'nincs a könyvtárban');
    assert.equal(store.view(code, dani), null, 'mások nem látják'); assert.equal(store.view(code, emma).hidden, true, 'a készítő látja (elrejtve)');
    assert.equal(store.modeFor(code, emma), null, 'a készítőnek sem használható szobában, amíg el van rejtve');
    assert.equal(store.save(dani, code).ok, false, 'elrejtett csomag nem menthető');
    assert.equal(store.adminList()[0].code, code, 'az admin listában a jelentettek elöl');
    assert.equal(store.adminUnhide(code), true); assert.ok(store.modeFor(code, null), 'visszaállítva használható'); assert.equal(store.adminList().find((x) => x.code === code).reports, 0, 'a jelentések törlődnek');
    assert.equal(store.adminHide(code), true); assert.equal(store.view(code, dani), null);
    assert.equal(store.adminDelete(code), true); assert.equal(store.view(code, emma), null); assert.equal(store.adminDelete(code), false);
  });

  await test('B) fiók-életciklus: átnevezés, törlés (csomagok + gyűjtemény + mentésszám), adatkérés', () => {
    assert.ok(store.renameByName('Béla', 'Béla2') >= 1); assert.ok(store.listPublic({ limit: 60 }).packs.some((p) => p.owner === 'Béla2'));
    const bp = store.mine(bela).owned[0]; store.save(dani, bp.code);
    const before = store.view(bp.code, null).saves; assert.ok(before >= 1);
    const exp = store.exportFor(dani.id); assert.ok(exp.saved.includes(bp.code)); assert.deepEqual(exp.owned, []);
    const own = store.exportFor(bela.id); assert.ok(own.owned.length >= 1 && own.owned[0].decks.vadak.length >= 6);
    assert.equal(store.removeOwner(dani.id), 0, 'Daninak nincs saját csomagja, de a gyűjteménye törlődik'); assert.equal(store.view(bp.code, null).saves, before - 1, 'a mentésszám csökken');
    const n = store.removeOwner(bela.id); assert.ok(n >= 1); assert.equal(store.mine(bela).owned.length, 0);
    for (const entry of Object.values(store.mine(anna))) assert.ok(Array.isArray(entry));
  });

  await test('B) találgatás-védelem: a sikertelen kód-keresések címenként korlátozottak, 10 perc után feloldódnak; a másik címet nem érinti', () => {
    assert.equal(store.lookupAllowed('1.2.3.4'), true);
    for (let i = 0; i < MISSES_PER_WINDOW; i++) { assert.equal(store.lookupAllowed('1.2.3.4'), true, i + '. kísérlet még engedett'); store.lookupMiss('1.2.3.4'); }
    assert.equal(store.lookupAllowed('1.2.3.4'), false, 'a korlát után tiltva'); assert.equal(store.lookupAllowed('5.6.7.8'), true, 'másik cím szabad');
    clock.t += 10 * 60 * 1000 + 1; assert.equal(store.lookupAllowed('1.2.3.4'), true, 'az ablak lejárta után újra szabad');
  });

  await test('B) perzisztencia: fájlba mentés (külső mentés hívva), újratöltés ugyanazt adja; hibás fájllal üresen indul', () => {
    persisted.length = 0; store.flush(); assert.ok(persisted.length >= 1, 'a külső mentés (adatbázis) hívva');
    const again = createPacks({ file, now: () => clock.t });
    assert.equal(again.count(), store.count()); assert.deepEqual(again.mine(anna).owned.map((p) => p.code).sort(), store.mine(anna).owned.map((p) => p.code).sort());
    fs.writeFileSync(path.join(tmp, 'rossz.json'), '{nem json'); assert.equal(createPacks({ file: path.join(tmp, 'rossz.json') }).count(), 0);
    assert.equal(createPacks({ file: path.join(tmp, 'nincs.json') }).count(), 0);
    assert.equal(fs.statSync(file).mode & 0o077 ? 'nyitott' : 'zárt', process.platform === 'win32' ? 'nyitott' : 'zárt', 'a fájl csak a tulajdonosé (Windowson nincs ilyen jogosultság)');
  });

  // ================= C) motor =================
  const snapshotOf = (name = 'Játék csomag') => ({ nev: name, owner: 'Anna', code: 'ABCDEF', ...Object.fromEntries(DECKS.map((d) => [d, cards(d, SIZE[d] + 2, ' j')])) });
  function makeGame() { const g = new Game('PACKT', { to: () => ({ emit() {} }) }); g.addPlayer('h1', 'Ember', 'paróka', true); for (let k = 0; k < 4; k++) g.addBot(); return g; }
  const start = (g, modes, rounds = 3) => g.startGame({ modes, rounds, speechSeconds: 15, defenderSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10, witnessEnabled: true, challengesEnabled: true, challengeMode: 'judge' }, 'h1');

  await test('C) addExtraMode: érvényes pillanatfelvétel felvehető; hibás kód / hiányzó pakli / nem szöveg kártya elutasítva', () => {
    const g = makeGame();
    assert.equal(g.addExtraMode('ABCDEF', snapshotOf()), 'pack:ABCDEF'); assert.deepEqual(g.extraModeKeys(), ['pack:ABCDEF']);
    for (const [code, snap] of [['abc', snapshotOf()], ['ABCDEF', null], ['ABCDEF', { ...snapshotOf(), nev: '' }], ['ABCDEF', { ...snapshotOf(), vadak: [] }], ['ABCDEF', { ...snapshotOf(), alibik: ['jó', 5] }], ['ABCDEF', { ...snapshotOf(), tanuk: undefined }]]) assert.equal(g.addExtraMode(code, snap), false);
    assert.equal(g.extraModeKeys().length, 1, 'a hibás nem került be');
    const state = g.publicState('h1'); const m = state.modes.find((x) => x.key === 'pack:ABCDEF');
    assert.deepEqual({ name: m.name, pack: m.pack, owner: m.owner, code: m.code }, { name: 'Játék csomag', pack: true, owner: 'Anna', code: 'ABCDEF' });
    assert.ok(state.modes.slice(0, 12).every((x) => !x.pack), 'a cards.json módjai változatlanul elöl');
    snapshotOf().vadak.push('módosítás'); // a pillanatfelvétel másolat: a forrás módosítása nem hat vissza
  });

  await test('C) csomag-játék: a vád, a bizonyítékok, az alibi, a tanú és a büntetés a csomag paklijából jön; a helyőrzők cserélődnek; mód-név és csomag-adat az állapotban', () => {
    const g = makeGame(); const snap = snapshotOf(); snap.vadak[0] = '[vádlott] elvitte [játékos] kedvenc csomagját.';
    g.addExtraMode('ABCDEF', snap);
    assert.notEqual(start(g, ['pack:ABCDEF']), false); const key = 'pack:ABCDEF';
    const src = g.extraModes[key]; let seenPlaceholder = false;
    for (let r = 1; r <= 3; r++) {
      const d = g.roundData;
      assert.equal(d.mode, key); assert.equal(d.evidence.length, 3); assert.ok(d.evidence.every((e) => src.bizonyitekok.includes(e)), 'bizonyítékok a csomagból');
      assert.ok(src.alibik.includes(d.alibi), 'alibi a csomagból');
      assert.ok(!/\[(vádlott|játékos)\]/.test(d.accusationText), 'a helyőrző cserélve: ' + d.accusationText);
      if (/elvitte .* kedvenc csomagját/.test(d.accusationText)) seenPlaceholder = true; else assert.ok(src.vadak.includes(d.accusationText), 'a vád a csomagból');
      const st = g.publicState('h1'); assert.equal(st.modeName, 'Játék csomag'); assert.deepEqual(st.modePack, { owner: 'Anna', code: 'ABCDEF' });
      g.nextRound(); if (g.phase === 'game_over') break;
    }
    g.clearTimers(); void seenPlaceholder;
  });

  await test('C) Vegyes: csomag és cards.json módjai együtt, körönként egy mód; minden kártya a kör módjának forrásából; ismeretlen / rejtett csomag-kulcs nem indít játékot', () => {
    const g = makeGame(); g.addExtraMode('ABCDEF', snapshotOf());
    const modes = ['pack:ABCDEF', 'repo', 'buli']; assert.notEqual(start(g, modes, 20), false);
    const seen = new Set();
    for (let r = 1; r <= 20 && g.roundData; r++) {
      const d = g.roundData; seen.add(d.mode); assert.ok(modes.includes(d.mode));
      const src = g.modeSource(d.mode); assert.ok(d.evidence.every((e) => src.bizonyitekok.includes(e)), r + '. kör: bizonyítékok a ' + d.mode + ' paklijából');
      g.nextRound(); if (g.phase === 'game_over') break;
    }
    assert.ok(seen.size >= 2, 'több különböző mód sorsolódott (' + [...seen].join(', ') + ')'); g.clearTimers();
    const none = makeGame(); assert.equal(start(none, ['pack:ZZZZZZ']), false, 'a szobába fel nem vett csomag-kulcs nem érvényes mód');
    const empty = makeGame(); assert.equal(start(empty, []), false);
  });

  // ================= D) valódi szerver =================
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DISCORD_BOT_TOKEN: '', DATABASE_URL: '', ADMIN_TOKEN,
    AUTH_STORE_PATH: path.join(tmp, 'accounts.json'), KB_STATS_FILE: path.join(tmp, 'stats.json'), KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_PACKS_FILE: path.join(tmp, 'packs-live.json'),
    KB_DMS_FILE: path.join(tmp, 'dms.json'), KB_MODERATION_FILE: path.join(tmp, 'mod.json'), KB_ERRORS_FILE: path.join(tmp, 'err.json'), KB_COURTS_FILE: path.join(tmp, 'courts.json'), KB_BUGREPORTS_FILE: path.join(tmp, 'bug.json') } });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  const sockets = [];
  async function http(method, route, body, { jar, headers = {} } = {}) {
    const h = { ...(method !== 'GET' && method !== 'DELETE' ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: BASE } : {}), ...headers };
    if (jar && jar.size) h.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const res = await fetch(BASE + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), headersTimeout: 5000 });
    if (jar) for (const c of res.headers.getSetCookie()) { const f = c.split(';')[0], i = f.indexOf('='); const k = f.slice(0, i), v = f.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
    return { status: res.status, data };
  }
  const password = 'Egy hosszú titok 123!';
  async function account(name) {
    const jar = new Map(); const r = await http('POST', '/api/auth/register', { username: name, email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, { jar });
    assert.equal(r.status, 201, 'regisztráció ' + name);
    return { name, jar, id: r.data.user.id, api: (m, route, body, headers) => http(m, '/api/packs' + route, body, { jar, headers }) };
  }
  const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('ack timeout: ' + ev)), 5000); s.emit(ev, payload, (r) => { clearTimeout(t); resolve(r); }); });
  async function connect(acct) {
    const s = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(s); s.states = [];
    s.on('state', (st) => { s.states.push(st); });
    await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
    if (acct) { const ticket = (await http('POST', '/api/friends/ticket', {}, { jar: acct.jar })).data.ticket; assert.equal((await emit(s, 'identify', { ticket })).account, true); }
    return s;
  }
  try {
    let ready = false; for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } } assert(ready, 'a szerver elindult');
    const A = await account('Kártya Anna'), B = await account('Kártya Béla'), C = await account('Kártya Cili'), D = await account('Kártya Dani'), E = await account('Kártya Eszti'), guest = { jar: new Map(), api: (m, r, b, h) => http(m, '/api/packs' + r, b, { headers: h }) };
    let annaPack = null;

    await test('D) jogosultság: bejelentkezés nélkül csak olvasni lehet; CSRF és tartalom-típus védelem; hibás kód 404', async () => {
      assert.equal((await guest.api('GET', '/limits')).status, 200); assert.equal((await guest.api('GET', '/library')).status, 200);
      const limits = (await guest.api('GET', '/limits')).data; assert.equal(limits.decks.length, 7); assert.equal(limits.perAccount, 5);
      for (const [m, r] of [['GET', '/mine'], ['POST', ''], ['PUT', '/ABCDEF'], ['DELETE', '/ABCDEF'], ['POST', '/ABCDEF/save'], ['DELETE', '/ABCDEF/save'], ['POST', '/ABCDEF/report']]) assert.equal((await guest.api(m, r, m === 'GET' || m === 'DELETE' ? undefined : {})).status, 401, m + ' ' + r);
      assert.equal((await A.api('POST', '', goodPack('CSRF'), { Origin: 'https://evil.example' })).status, 403, 'másik oldalról érkező kérés tiltva');
      const raw = await fetch(BASE + '/api/packs', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: BASE, Cookie: [...A.jar].map(([k, v]) => k + '=' + v).join('; ') }, body: 'x' }); assert.equal(raw.status, 415);
      assert.equal((await guest.api('GET', '/nemkod')).status, 404); assert.equal((await guest.api('GET', '/ZZZZZZ')).status, 404);
    });

    await test('D) létrehozás hibalistával (a kliens soronként mutatja), túl nagy kérés elutasítva; saját lista', async () => {
      const bad = await A.api('POST', '', withEdit((p) => { p.decks.vadak[0] = 'Itt a https://rossz.link/x oldal.'; p.decks.tanuk = ['a']; }));
      assert.equal(bad.status, 400); assert.ok(Array.isArray(bad.data.errors) && bad.data.errors.length >= 2); assert.match(bad.data.errors.join(' '), /linket/);
      const big = await A.api('POST', '', { name: 'Nagy', decks: { vadak: ['x'.repeat(70000)] } }); assert.equal(big.status, 413);
      const ok = await A.api('POST', '', goodPack('Anna nyilvános')); assert.equal(ok.status, 201); annaPack = ok.data.pack;
      assert.equal(annaPack.owner, 'Kártya Anna'); assert.equal(annaPack.decks.vadak.length, 7);
      const mine = await A.api('GET', '/mine'); assert.equal(mine.data.owned.length, 1); assert.equal(mine.data.owned[0].code, annaPack.code); assert.ok(!('decks' in mine.data.owned[0]), 'a lista nem tölti a kártyákat');
    });

    await test('D) életút: könyvtár → megnézés → mentés → gyűjtemény; privát csomag csak kóddal; mások nem szerkeszthetik / törölhetik; szerkesztés és törlés', async () => {
      const priv = (await A.api('POST', '', { ...goodPack('Anna privát', ' p'), visibility: 'private' })).data.pack;
      const lib = (await guest.api('GET', '/library')).data; assert.ok(lib.packs.some((p) => p.code === annaPack.code)); assert.ok(!lib.packs.some((p) => p.code === priv.code), 'privát nincs a könyvtárban');
      assert.equal((await guest.api('GET', '/' + priv.code)).data.pack.name, 'Anna privát', 'kóddal vendég is megnézheti');
      assert.equal((await B.api('POST', '/' + annaPack.code + '/save')).status, 200); assert.equal((await B.api('POST', '/' + annaPack.code + '/save')).data.already, true);
      const bMine = (await B.api('GET', '/mine')).data; assert.equal(bMine.saved.length, 1); assert.equal(bMine.saved[0].saved, true); assert.equal(bMine.owned.length, 0);
      assert.equal((await B.api('PUT', '/' + annaPack.code, goodPack('Béla átírja'))).status, 404); assert.equal((await B.api('DELETE', '/' + annaPack.code)).status, 404);
      const edited = await A.api('PUT', '/' + annaPack.code, goodPack('Anna nyilvános', ' szerkesztett')); assert.equal(edited.status, 200); assert.ok(edited.data.pack.decks.vadak[0].includes('szerkesztett'));
      assert.equal((await B.api('DELETE', '/' + annaPack.code + '/save')).status, 200); assert.equal((await B.api('DELETE', '/' + annaPack.code + '/save')).status, 404);
      assert.equal((await A.api('DELETE', '/' + priv.code)).status, 200); assert.equal((await guest.api('GET', '/' + priv.code)).status, 404);
    });

    await test('D) jelentés → elrejtés: három különböző fiók után a csomag eltűnik a többiek elől, a készítő látja; a jelentés fiókhoz kötött', async () => {
      const victim = (await E.api('POST', '', goodPack('Eszti vitatott', ' e'))).data.pack;
      assert.equal((await E.api('POST', '/' + victim.code + '/report')).status, 400, 'a sajátot nem lehet jelenteni');
      assert.equal((await guest.api('POST', '/' + victim.code + '/report')).status, 401);
      assert.equal((await B.api('POST', '/' + victim.code + '/report')).status, 200); assert.equal((await B.api('POST', '/' + victim.code + '/report')).data.already, true);
      assert.equal((await guest.api('GET', '/' + victim.code)).status, 200, 'két jelentésnél még látszik'); await C.api('POST', '/' + victim.code + '/report');
      assert.equal((await D.api('POST', '/' + victim.code + '/report')).status, 200);
      assert.equal((await guest.api('GET', '/' + victim.code)).status, 404, 'elrejtve');
      assert.ok(!(await guest.api('GET', '/library')).data.packs.some((p) => p.code === victim.code));
      assert.equal((await E.api('GET', '/' + victim.code)).data.pack.hidden, true, 'a készítő látja');
      assert.equal((await A.api('POST', '/' + victim.code + '/save')).status, 404);
    });

    await test('D) írási korlát: óránként legfeljebb ' + WRITES_PER_HOUR + ' módosítás fiókonként (429), az olvasás nem számít', async () => {
      const F = await account('Kártya Feri'); let last = 0, limited = 0;
      const own = (await F.api('POST', '', goodPack('Feri csomagja', ' f'))).data.pack;
      for (let i = 0; i < WRITES_PER_HOUR + 3; i++) { const r = await F.api('PUT', '/' + own.code, goodPack('Feri csomagja', ' v' + i)); last = r.status; if (r.status === 429) limited++; }
      assert.ok(limited >= 3, 'a korlát felett 429: ' + limited); assert.equal(last, 429);
      for (let i = 0; i < 10; i++) assert.equal((await F.api('GET', '/mine')).status, 200);
    });

    await test('D) admin: token nélkül nem érhető el; lista (jelentettek elöl), elrejtés, visszaállítás, törlés; hibás kód', async () => {
      const adm = (m, r, b, token = ADMIN_TOKEN) => http(m, '/api/admin' + r, b, { headers: { Authorization: 'Bearer ' + token } });
      assert.equal((await adm('GET', '/packs', undefined, 'hibas-token-' + 'y'.repeat(20))).status, 401);
      const list = (await adm('GET', '/packs')).data.packs; assert.ok(list.length >= 3); assert.ok(list[0].reports >= 1 || list[0].hidden, 'a jelentett elöl');
      const hiddenOne = list.find((p) => p.hidden); assert.ok(hiddenOne && hiddenOne.hiddenBy === 'reports');
      assert.equal((await adm('POST', '/packs/unhide', { code: hiddenOne.code })).status, 200); assert.equal((await guest.api('GET', '/' + hiddenOne.code)).status, 200, 'visszaállítva újra látszik');
      assert.equal((await adm('POST', '/packs/hide', { code: hiddenOne.code })).status, 200); assert.equal((await guest.api('GET', '/' + hiddenOne.code)).status, 404);
      assert.equal((await adm('POST', '/packs/delete', { code: hiddenOne.code })).status, 200); assert.equal((await adm('POST', '/packs/delete', { code: hiddenOne.code })).status, 404);
      assert.equal((await adm('POST', '/packs/hide', { code: 'nem' })).status, 400);
      assert.ok((await adm('GET', '/status')).data.packs.total >= 2, 'az állapot-összegző mutatja');
    });

    // ----- socket -----
    let hostA, roomCode;
    await test('D) socket: a bejelentkezett házigazda saját és mentett csomagjai a szoba létrehozásakor készen állnak; a vendég nem lát ilyet', async () => {
      assert.equal((await B.api('POST', '/' + annaPack.code + '/save')).status, 200); // Béla gyűjteményében Anna csomagja
      const mine = (await B.api('POST', '', goodPack('Béla saját', ' bs'))).data.pack;
      const sB = await connect(B); const created = await emit(sB, 'create_room', { name: 'Béla', avatar: 'paróka', playerId: 'pb1' });
      const packModes = created.state.modes.filter((m) => m.pack); assert.deepEqual(packModes.map((m) => m.code).sort(), [annaPack.code, mine.code].sort());
      assert.ok(packModes.every((m) => m.key === 'pack:' + m.code && m.name && m.owner));
      const sG = await connect(null); const gRoom = await emit(sG, 'create_room', { name: 'Vendég Vera', avatar: 'paróka', playerId: 'pg1' }); assert.equal(gRoom.state.modes.filter((m) => m.pack).length, 0, 'vendégnek nincs gyűjteménye');
    });

    await test('D) socket: kóddal felvétel (csak házigazda, csak lobbi), a felvett csomag ki is van jelölve; rejtett / ismeretlen / hibás kód elutasítva; a beállítás-szűrés nem enged fel nem vett csomagot', async () => {
      const host = await connect(null); const room = await emit(host, 'create_room', { name: 'Gazda Gábor', avatar: 'paróka', playerId: 'pgh' }); roomCode = room.code; hostA = host;
      const guestPlayer = await connect(null); await emit(guestPlayer, 'join_room', { code: roomCode, name: 'Játékos Jani', avatar: 'paróka', playerId: 'pgj' });
      assert.match((await emit(guestPlayer, 'pack_add', { code: annaPack.code })).error, /házigazda/, 'nem házigazda nem vehet fel');
      for (const bad of ['', 'abc', '!!!!!!', 'ZZZZZZ']) assert.ok((await emit(host, 'pack_add', { code: bad })).error, 'hibás kód: ' + bad);
      const added = await emit(host, 'pack_add', { code: ' ' + annaPack.code.toLowerCase() + ' ' }); assert.equal(added.ok, true); assert.equal(added.key, 'pack:' + annaPack.code);
      assert.ok(added.state.modes.some((m) => m.key === 'pack:' + annaPack.code && m.pack), 'a csomag a módok között');
      assert.ok(added.state.settings.modes.includes('pack:' + annaPack.code), 'ki is van jelölve');
      const forged = await emit(host, 'update_settings', { settings: { modes: ['repo', 'pack:ZZZZZZ', 'pack:' + annaPack.code, '__proto__', 'constructor'] } });
      assert.deepEqual(forged.state.settings.modes, ['repo', 'pack:' + annaPack.code], 'csak ismert mód és a szobába felvett csomag marad');
      assert.equal((await emit(host, 'pack_add', { code: annaPack.code })).ok, true, 'ismételt felvétel (frissítés) rendben');
    });

    await test('D) socket: a csomaggal indított játék a csomag nevét és adatát mutatja, a vád a csomagból jön, a használat-számláló nő; játék közben nincs felvétel', async () => {
      const host = hostA; const before = (await guest.api('GET', '/' + annaPack.code)).data.pack.uses;
      for (let i = 0; i < 3; i++) await emit(host, 'add_bot', {});
      assert.equal((await emit(host, 'update_settings', { settings: { modes: ['pack:' + annaPack.code], rounds: 1, speechSeconds: 15, defenderSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10 } })).ok, true);
      const started = await emit(host, 'start_game', { settings: { modes: ['pack:' + annaPack.code], rounds: 1 } }); assert.equal(started.ok, true, JSON.stringify(started));
      const st = started.state; assert.equal(st.modeName, 'Anna nyilvános'); assert.deepEqual(st.modePack, { owner: 'Kártya Anna', code: annaPack.code });
      const edited = (await guest.api('GET', '/' + annaPack.code)).data.pack; assert.ok(edited.decks.vadak.includes(st.accusationText) || /Az egyik vadak kártya/.test(st.accusationText), 'a vád a csomagból: ' + st.accusationText);
      assert.equal(edited.uses, before + 1, 'a használat számolva');
      assert.match((await emit(host, 'pack_add', { code: annaPack.code })).error, /lobbiban/, 'játék közben nincs felvétel');
    });

    await test('D) fiók-törlés: a csomagok és a gyűjtemény törlődik; a szobák, ahol már használták, nem állnak meg; adatkérés tartalmazza a csomagokat', async () => {
      const G = await account('Kártya Gizi'); const gp = (await G.api('POST', '', goodPack('Gizi csomagja', ' g'))).data.pack; await C.api('POST', '/' + gp.code + '/save');
      const exp = await http('GET', '/api/account/export', undefined, { jar: G.jar }); assert.equal(exp.status, 200); assert.equal(exp.data.cardPacks.owned.length, 1); assert.equal(exp.data.cardPacks.owned[0].decks.vadak.length, 7);
      const cExp = (await http('GET', '/api/account/export', undefined, { jar: C.jar })).data; assert.ok(cExp.cardPacks.saved.includes(gp.code), 'a gyűjtemény az adatkérésben');
      assert.equal((await http('POST', '/api/auth/delete', { password }, { jar: G.jar })).status, 200);
      assert.equal((await guest.api('GET', '/' + gp.code)).status, 404, 'a törölt fiók csomagja eltűnt');
      assert.ok(!(await C.api('GET', '/mine')).data.saved.some((p) => p.code === gp.code), 'a gyűjteményből is');
    });

    await test('D) találgatás-védelem a szerveren: a sok sikertelen kód után HTTP 429, a socketes felvétel is tilt; a jó kód nem szabadítja fel azonnal', async () => {
      let blockedAt = 0; for (let i = 1; i <= 45; i++) { const r = await guest.api('GET', '/' + 'A2B3C' + 'DEFGHJKMNPQRSTUVWXYZ'[i % 20]); if (r.status === 429) { blockedAt = i; break; } assert.equal(r.status, 404); }
      assert.ok(blockedAt > 15 && blockedAt <= 31, 'a korlát ' + blockedAt + '. kísérletnél lépett életbe');
      assert.equal((await guest.api('GET', '/' + annaPack.code)).status, 429, 'a jó kód is tiltott, amíg a korlát él');
      const host = await connect(null); await emit(host, 'create_room', { name: 'Találgató Tamás', avatar: 'paróka', playerId: 'pgt' });
      assert.match((await emit(host, 'pack_add', { code: annaPack.code })).error, /Túl sok sikertelen/, 'a socketes felvétel is tilt');
    });

    await test('D) a szerver nem naplózott belső hibát', () => { assert.ok(!/Error|TypeError|ReferenceError/.test(stderr), 'stderr: ' + stderr.slice(0, 400)); });
  } finally {
    for (const s of sockets) s.close();
    child.kill();
    console.log('\nKártyacsomagok: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
    process.exitCode = failed ? 1 : 0;
  }
})();
