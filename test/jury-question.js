'use strict';
// ============================================================
// KAMU BÍRÓSÁG – esküdt-kérdés (keresztkérdés a zárószavak után)
//   - alapból ki; kikapcsolva nincs kérdés, nincs fázis, nincs új mező az állapotban
//   - kérdezni csak az esküdt (szavazó) tud, a beszédek alatt, egyszer, 3–100 karakterrel, ügyésznek vagy vádlottnak
//   - a zárószavak után: ha van kérdés, KERESZTKÉRDÉS (legfeljebb 2, időzítővel), különben rögtön a szavazás
//   - a kérdés szövege a fázisig titkos (csak a darabszám látszik); az egész pontozás változatlan
//   - korai befejezés: ha minden megszólított jelezte, hogy válaszolt; különben az időzítő viszi tovább (AFK-biztos)
// Futtatás: node test/jury-question.js
// ============================================================
const assert = require('assert/strict');
const { Game, PHASES, DEFAULT_SETTINGS } = require('../game');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS: ' + name); }
  catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.stack || e)); }
}
const games = [];
function mkGame(n, settings = {}) {
  const g = new Game('JQ', { to: () => ({ emit: () => {} }), emit: () => {} });
  games.push(g);
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  g.startGame({ rounds: 2, witnessEnabled: false, challengesEnabled: false, modes: ['buli'], juryQuestions: true, questionSeconds: 20, ...settings }, 'u0');
  return g;
}
// az ügyész beszédétől a zárószavak végéig (a fázisokat közvetlenül léptetjük)
function toSpeech(g, phase = PHASES.PROSECUTION) {
  const d = g.roundData;
  if (g.phase === PHASES.ACCUSATION) g.accusationRead();
  if (g.phase === PHASES.PREP) g.runSpeech('prosecution', 60000);
  if (phase !== PHASES.PROSECUTION) g.runSpeech(phase === PHASES.FINAL_DEFENSE ? 'final_defense' : phase, 60000);
  assert.equal(g.phase, phase, 'a kívánt beszédfázisban vagyunk');
  return d;
}
const jurors = (g) => g.roundData.voters.slice();
const finishDefense = (g) => { g.runSpeech('final_defense', 60000); g.doneSpeaking(g.roundData.defendantId); };

(async () => {
  await test('alapból ki: nincs mező az állapotban, a kérdés elutasítva, a zárószavak után rögtön a szavazás', () => {
    assert.equal(DEFAULT_SETTINGS.juryQuestions, false);
    const g = mkGame(6, { juryQuestions: false });
    toSpeech(g);
    assert.equal(g.publicState('u1').questionInfo, undefined);
    const j = jurors(g)[0];
    assert.match(g.askJuryQuestion(j, 'defendant', 'Miért tetted?').error, /nincs bekapcsolva/);
    finishDefense(g);
    assert.equal(g.phase, PHASES.VERDICT_VOTE);
  });

  await test('csak az esküdt kérdezhet, a beszédek alatt, egyszer; ügyész / vádlott / védő / tanú / elő- és utófázis nem', () => {
    const g = mkGame(7);
    const d = g.roundData;
    const j = jurors(g).find((id) => id !== d.witnessId);
    assert.match(g.askJuryQuestion(j, 'defendant', 'Korai kérdés?').error, /beszédek alatt/, 'felkészülés előtt még nem');
    toSpeech(g);
    for (const id of [d.prosecutorId, d.defendantId, d.defenderId]) assert.match(g.askJuryQuestion(id, 'defendant', 'Szabad ezt?').error || '', /Csak az esküdtek/, 'nem esküdt: ' + id);
    assert.deepEqual(g.askJuryQuestion(j, 'defendant', '  Miért  tetted ezt?  '), { ok: true });
    assert.equal(d.questions[j].text, 'Miért tetted ezt?', 'szóköz-egyesítés és vágás');
    assert.match(g.askJuryQuestion(j, 'prosecutor', 'Még egy kérdés?').error, /már feltettél/, 'egy kérdés esküdtenként');
    const other = jurors(g).find((id) => id !== j && id !== d.witnessId);
    assert.match(g.askJuryQuestion(other, 'judge', 'Kinek?').error, /kinek szól/);
    assert.match(g.askJuryQuestion(other, 'defendant', 'ab').error, /rövid kérdést/);
    assert.match(g.askJuryQuestion(other, 'defendant', 'x'.repeat(101)).error, /legfeljebb 100/);
    assert.match(g.askJuryQuestion(other, 'defendant', '   ').error, /rövid kérdést/);
    assert.deepEqual(g.askJuryQuestion(other, 'prosecutor', 'x'.repeat(100)), { ok: true }, 'pontosan 100 karakter még jó');
  });

  await test('állapot: beküldés előtt csak a darabszám és a saját helyzet; a szöveg és a kérdező a fázisig titkos', () => {
    const g = mkGame(6);
    const d = g.roundData; toSpeech(g);
    const [a, b] = jurors(g).filter((id) => id !== d.witnessId);
    assert.deepEqual(g.publicState(a).questionInfo, { count: 0, asked: false, canAsk: true });
    assert.equal(g.publicState(d.prosecutorId).questionInfo.canAsk, false, 'az ügyész nem kérdezhet');
    g.askJuryQuestion(a, 'defendant', 'Titkos kérdés a vádlotthoz?');
    assert.deepEqual(g.publicState(a).questionInfo, { count: 1, asked: true, canAsk: false });
    assert.deepEqual(g.publicState(b).questionInfo, { count: 1, asked: false, canAsk: true });
    const json = JSON.stringify(g.publicState(b));
    assert.ok(!json.includes('Titkos kérdés'), 'a szöveg nem szivárog');
    assert.equal(g.publicState(b).juryQuestion, undefined);
  });

  await test('kérdések nélkül rögtön a szavazás; kérdésekkel KERESZTKÉRDÉS (legfeljebb 2), az idő a kérdések számától függ', () => {
    const g0 = mkGame(6); toSpeech(g0); finishDefense(g0);
    assert.equal(g0.phase, PHASES.VERDICT_VOTE);

    const g = mkGame(9, { questionSeconds: 15 });
    const d = g.roundData; toSpeech(g);
    const js = jurors(g).filter((id) => id !== d.witnessId);
    js.slice(0, 4).forEach((id, i) => assert.equal(g.askJuryQuestion(id, i % 2 ? 'prosecutor' : 'defendant', 'Kérdés száma ' + (i + 1) + '?').ok, true));
    finishDefense(g);
    assert.equal(g.phase, PHASES.JURY_QUESTION);
    const st = g.publicState(js[5]);
    assert.equal(st.juryQuestion.picks.length, 2, 'legfeljebb két kérdés');
    assert.deepEqual(new Set(st.juryQuestion.picks.map((p) => p.to)), new Set(['prosecutor', 'defendant']), 'egy-egy az ügyésznek és a vádlottnak');
    assert.ok(st.phaseEndsAt - st.serverNow > 29000 && st.phaseEndsAt - st.serverNow <= 30000, 'idő = 2 kérdés × 15 mp');
    for (const p of st.juryQuestion.picks) assert.ok(p.askerName && p.targetName && p.text && p.done === false);
    assert.equal(st.juryQuestion.canAnswer, false, 'a nem megszólított nem válaszolhat');
    const target = st.juryQuestion.picks[0].targetId;
    assert.equal(g.publicState(target).juryQuestion.canAnswer, true);
  });

  await test('azonos célpont: két kérdés is lehet ugyanannak a játékosnak; egy kérdés esetén egyetlen pick', () => {
    const g = mkGame(7);
    const d = g.roundData; toSpeech(g);
    const [a, b] = jurors(g).filter((id) => id !== d.witnessId);
    g.askJuryQuestion(a, 'defendant', 'Első kérdés a vádlottnak?'); g.askJuryQuestion(b, 'defendant', 'Második kérdés a vádlottnak?');
    finishDefense(g);
    assert.equal(g.phase, PHASES.JURY_QUESTION);
    assert.equal(g.roundData.questionPicks.length, 2);
    assert.ok(g.roundData.questionPicks.every((p) => p.targetId === d.defendantId));
    const g1 = mkGame(5);
    toSpeech(g1); g1.askJuryQuestion(jurors(g1).find((id) => id !== g1.roundData.witnessId), 'prosecutor', 'Egyetlen kérdés?');
    finishDefense(g1);
    assert.equal(g1.roundData.questionPicks.length, 1);
  });

  await test('korai befejezés: csak a megszólítottak jelezhetnek; ha mindenki kész, jön a szavazás; különben marad', () => {
    const g = mkGame(8);
    const d = g.roundData; toSpeech(g);
    const [a, b] = jurors(g).filter((id) => id !== d.witnessId);
    g.askJuryQuestion(a, 'prosecutor', 'Kérdés az ügyésznek?'); g.askJuryQuestion(b, 'defendant', 'Kérdés a vádlottnak?');
    finishDefense(g);
    assert.equal(g.phase, PHASES.JURY_QUESTION);
    assert.equal(g.juryAnswerDone(a), false, 'nem megszólított');
    assert.equal(g.juryAnswerDone(d.prosecutorId), true);
    assert.equal(g.phase, PHASES.JURY_QUESTION, 'a vádlott még nem válaszolt');
    assert.equal(g.juryAnswerDone(d.prosecutorId), false, 'kétszer nem számít');
    assert.equal(g.publicState(a).juryQuestion.picks.find((p) => p.to === 'prosecutor').done, true);
    assert.equal(g.publicState(d.prosecutorId).juryQuestion.canAnswer, false, 'aki már válaszolt, nem látja újra a gombot');
    assert.equal(g.juryAnswerDone(d.defendantId), true);
    assert.equal(g.phase, PHASES.VERDICT_VOTE, 'mindenki kész: jön a szavazás');
  });

  await test('az időzítő viszi tovább (AFK-biztos); a kiesett megszólított nem tartja fel; a kiesett kérdező kérdése is elhangzik', async () => {
    const g = mkGame(6, { questionSeconds: 0.05 });
    const d = g.roundData; toSpeech(g);
    const [a] = jurors(g).filter((id) => id !== d.witnessId);
    g.askJuryQuestion(a, 'defendant', 'Kérdés időzítővel?');
    finishDefense(g);
    assert.equal(g.phase, PHASES.JURY_QUESTION);
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(g.phase, PHASES.VERDICT_VOTE, 'az időzítő lejárt, megy a szavazás');

    const g2 = mkGame(6);
    const d2 = g2.roundData; toSpeech(g2);
    const [b, c] = jurors(g2).filter((id) => id !== d2.witnessId);
    g2.askJuryQuestion(b, 'prosecutor', 'Kérdés az ügyésznek?'); g2.askJuryQuestion(c, 'defendant', 'Kérdés a vádlottnak?');
    g2.getPlayer(d2.prosecutorId).connected = false; // az ügyész kiesett: neki már nem tehető fel kérdés
    finishDefense(g2);
    assert.equal(g2.phase, PHASES.JURY_QUESTION);
    assert.deepEqual(g2.roundData.questionPicks.map((p) => p.to), ['defendant'], 'a kiesett ügyész kérdése kimarad');
    g2.juryAnswerDone(d2.defendantId);
    assert.equal(g2.phase, PHASES.VERDICT_VOTE);

    const g3 = mkGame(6);
    const d3 = g3.roundData; toSpeech(g3);
    const e = jurors(g3).find((id) => id !== d3.witnessId);
    g3.askJuryQuestion(e, 'defendant', 'A kérdező kiesik, de a kérdés marad?');
    g3.getPlayer(e).connected = false;
    finishDefense(g3);
    assert.equal(g3.phase, PHASES.JURY_QUESTION, 'a kérdező kiesése nem törli a kérdést');
  });

  await test('a pontozás változatlan: a kérdés és a válasz nem ad pontot, az ítélet-pontok ugyanazok', () => {
    const g = mkGame(6);
    const d = g.roundData; toSpeech(g);
    const [a] = jurors(g).filter((id) => id !== d.witnessId);
    g.askJuryQuestion(a, 'defendant', 'Kérdés pont nélkül?');
    finishDefense(g);
    g.juryAnswerDone(d.defendantId);
    assert.equal(g.phase, PHASES.VERDICT_VOTE);
    assert.ok([...g.players.values()].every((p) => p.score === 0), 'senki nem kapott pontot a kérdésért');
    assert.equal((d.scoreEvents || []).length, 0);
    for (const id of d.voters) g.castVerdictVote(id, 'guilty');
    g.finishVerdictVote();
    assert.ok(['prosecution', 'juror', 'unanimous'].every((k) => d.scoreEvents.some((e) => e.kind === k)), 'az ítélet-pontok a szokásos okokkal járnak');
    assert.ok(d.scoreEvents.every((e) => ['prosecution', 'defense', 'defender', 'unanimous', 'juror', 'challenge', 'favorite'].includes(e.kind)), 'nincs új pontok-fajta');
  });

  // ---------------- valódi szerver: beállítás-korlátok és hibás üzenetek ----------------
  await test('szerver: a beállítás korlátozva (10–40 mp), csak a házigazda módosíthat; a hibás jury_ask / jury_answer_done üzenetek nem okoznak hibát', async () => {
    const { spawn } = require('child_process');
    const path = require('path'), os = require('os'), fs = require('fs');
    const { io } = require('socket.io-client');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-jq-'));
    const PORT = 3253, BASE = 'http://127.0.0.1:' + PORT;
    const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
      MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'), KB_DMS_FILE: path.join(tmp, 'd.json'),
      KB_ERRORS_FILE: path.join(tmp, 'e.json'), KB_CARDFB_FILE: path.join(tmp, 'cf.json'), KB_PACKS_FILE: path.join(tmp, 'p.json'), KB_COURTS_FILE: path.join(tmp, 'c.json'), KB_MODERATION_FILE: path.join(tmp, 'm.json'), KB_BUGREPORTS_FILE: path.join(tmp, 'b.json') } });
    const sockets = [];
    try {
      for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); } }
      const connect = async () => { const s = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(s); await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); }); return s; };
      const emit = (s, ev, payload) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Ack időtúllépés: ' + ev)), 4000); s.emit(ev, payload, (r) => { clearTimeout(t); resolve(r); }); });
      const host = await connect();
      const room = await emit(host, 'create_room', { name: 'Kerdezo Kata', avatar: '', playerId: 'jqh1' });
      assert.ok(room.code);
      assert.equal(room.state.settings.juryQuestions, false, 'alapból ki');
      assert.equal(room.state.settings.questionSeconds, 20);
      let r = await emit(host, 'update_settings', { settings: { juryQuestions: true, questionSeconds: 999 } });
      assert.equal(r.state.settings.juryQuestions, true); assert.equal(r.state.settings.questionSeconds, 40, 'felső korlát');
      r = await emit(host, 'update_settings', { settings: { questionSeconds: 1 } });
      assert.equal(r.state.settings.questionSeconds, 10, 'alsó korlát'); assert.equal(r.state.settings.juryQuestions, true, 'a többi beállítás megmarad');
      r = await emit(host, 'update_settings', { settings: { questionSeconds: 'abc' } });
      assert.equal(r.state.settings.questionSeconds, 10, 'hibás szám: marad az előző érték');
      r = await emit(host, 'update_settings', { settings: { juryQuestions: 0 } });
      assert.equal(r.state.settings.juryQuestions, false);
      const guest = await connect();
      const joined = await emit(guest, 'join_room', { code: room.code, name: 'Nezo Nandi', avatar: '', playerId: 'jqg1' });
      assert.ok(joined.state, JSON.stringify(joined));
      assert.match((await emit(guest, 'update_settings', { settings: { juryQuestions: true } })).error || '', /házigazda/, 'nem házigazda nem módosíthat');
      // hibás üzenetek: ack-kal és anélkül, szobában és szoba nélkül
      const stray = await connect();
      for (const bad of [undefined, null, 'x', 7, [], {}, { to: 'defendant' }, { text: 5 }, { to: 'judge', text: 'Kérdés?' }, { to: 'defendant', text: 'Kérdés?' }]) {
        await new Promise((r2) => setTimeout(r2, 120)); // a szerver másodpercenként 20 eseményt enged socketenként
        stray.emit('jury_ask', bad); stray.emit('jury_answer_done', bad);
        const res = await emit(guest, 'jury_ask', bad);
        assert.ok(res && res.error, 'lobbiban / hibás kérésre hibaüzenet: ' + JSON.stringify(bad));
        guest.emit('jury_answer_done');
      }
      assert.match((await emit(stray, 'jury_ask', { to: 'defendant', text: 'Kérdés?' })).error || '', /Nincs szoba/);
      await new Promise((r2) => setTimeout(r2, 300));
      assert.equal((await fetch(BASE + '/health')).ok, true, 'a szerver él');
      const errFile = path.join(tmp, 'e.json');
      assert.ok(!fs.existsSync(errFile) || !/jury|Jury/.test(fs.readFileSync(errFile, 'utf8')), 'nincs szerver-hiba a naplóban');
    } finally { for (const s of sockets) try { s.disconnect(); } catch (_) { /* */ } child.kill(); }
  });

  for (const g of games) { try { g.dispose(); } catch (_) { /* */ } }
  console.log('\nEsküdt-kérdés: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  setTimeout(() => process.exit(failed ? 1 : 0), 400); // a lezáródó socketek / gyerekfolyamat után lépünk ki (Windows libuv-zaj ellen)
})();
