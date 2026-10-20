'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a "Felolvastam!" csak a kör bírójáé (game.js canReadAccusation / accusationReadBy, server.js accusation_read, bots.js)
//  1) nem-bíró (vádlott, ügyész, esküdt, házigazda) nem léptethet tovább; a bíró igen
//  2) ha a bíró nincs a teremben (megszakadt), a házigazda léptethet; más akkor sem
//  3) azonosító nélkül / rossz fázisban semmi nem történik; az AFK-időzítő (belső hívás) továbbra is léptet
//  4) bot: csak akkor olvas fel, ha ő a bíró (emberi bírót nem előz meg)
//  5) a kliens: a gombot csak a bíró látja, a többiek a várakozó feliratot
// Futtatás: node test/accusation-judge.js
// ============================================================
const assert = require('assert/strict');
const { Game } = require('../game');

let passed = 0, failed = 0;
const check = (name, work) => { try { work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const io = { to: () => ({ emit: () => {} }) };
function makeGame() {
  const g = new Game('ACC', io);
  g.addPlayer('h1', 'Házigazda', 'paróka', true);
  for (const id of ['u2', 'u3', 'u4', 'u5']) g.addPlayer(id, 'Játékos ' + id, 'paróka', false);
  g.startGame({ modes: ['cs'], rounds: 1, witnessEnabled: false, challengesEnabled: false }, 'h1');
  return g;
}

check('1) nem-bíró nem léptethet tovább (vádlott, ügyész, esküdt, házigazda – ha nem ő a bíró); a bíró igen', () => {
  const g = makeGame(), d = g.roundData;
  assert.equal(g.phase, 'accusation');
  for (const id of [...g.players.keys()].filter((x) => x !== d.currentJudgeId)) {
    assert.equal(g.accusationReadBy(id), false, id + ' nem bíró');
    assert.equal(g.phase, 'accusation', id + ' után is vádemelés');
  }
  assert.equal(g.accusationReadBy(d.currentJudgeId), true);
  assert.equal(g.phase, 'prep');
});
check('2) ha a bíró nincs a teremben: a házigazda léptethet, más nem', () => {
  let g = makeGame();
  // olyan kör kell, ahol nem a házigazda a bíró
  for (let i = 0; i < 20 && g.roundData.currentJudgeId === 'h1'; i++) g = makeGame();
  const d = g.roundData;
  assert.notEqual(d.currentJudgeId, 'h1', 'a bíró nem a házigazda');
  g.players.get(d.currentJudgeId).connected = false;
  const other = [...g.players.keys()].find((x) => x !== 'h1' && x !== d.currentJudgeId);
  assert.equal(g.accusationReadBy(other), false, 'egy másik játékos nem');
  assert.equal(g.canReadAccusation('h1'), true);
  assert.equal(g.accusationReadBy('h1'), true, 'a házigazda igen');
  assert.equal(g.phase, 'prep');
});
check('3) azonosító nélkül / rossz fázisban semmi; az AFK-időzítő (belső hívás) továbbra is léptet', () => {
  const g = makeGame();
  assert.equal(g.accusationReadBy(''), false); assert.equal(g.accusationReadBy(undefined), false);
  assert.equal(g.phase, 'accusation');
  g.accusationRead(); // (ez hívódik a 2 perces időzítő lejártakor)
  assert.equal(g.phase, 'prep');
  assert.equal(g.accusationReadBy(g.roundData.currentJudgeId), false, 'felkészülés közben már nincs mit felolvasni');
});
check('4) bot: csak akkor olvas fel, ha ő a bíró', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'bots.js'), 'utf8');
  assert.match(src, /judgeBot = bots\.find\(\(b\) => b\.id === d\.currentJudgeId\)/);
  assert.match(src, /accusationReadBy\(judgeBot\.id\)/);
  assert.doesNotMatch(src, /schedule\(\(\) => g\.accusationRead\(\)/, 'a bot nem hívja feltétel nélkül');
});
check('5) kliens: a gombot csak a bíró (vagy kiesett bírónál a házigazda) látja, a többiek a várakozó feliratot', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'client.js'), 'utf8');
  assert.match(src, /const mine = S\.currentJudgeId === MY\.playerId \|\| \(\(!judge \|\| !judge\.connected\) && S\.hostId === MY\.playerId\);/);
  assert.match(src, /acc-wait/);
});
console.log('\n"Felolvastam!" a bíróé: ' + passed + ' sikeres, ' + failed + ' hibás.');
process.exit(failed ? 1 : 0);
