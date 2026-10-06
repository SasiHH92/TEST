'use strict';
// ============================================================
// KAMU BÍRÓSÁG – profil-statisztika: logikateszt
// 1) Körindításkor: lejátszott kör + szerep (ügyész / védő / bíró / tanú), botok nélkül
// 2) Ítéletkor: vádlott (elítélve / felmentve), ügyész- és védő-siker
// 3) Játék végén: játék, pont, kihívás, győzelem – csak egyszer, botok nélkül
// Futtatás: node test/profile-stats.js
// ============================================================

const { Game } = require('../game');

let fails = 0;
function ok(cond, label) {
  if (cond) console.log('  OK  ' + label);
  else { fails++; console.log('  HIBA ' + label); }
}

const calls = [];
Game.setStatRecorder((name, key, by) => calls.push({ name, key, by: by === undefined ? 1 : by }));
const count = (name, key) => calls.filter((c) => c.name === name && c.key === key).reduce((s, c) => s + c.by, 0);

function mkGame(humans, bots = 1) {
  const g = new Game('ST', { to: () => ({ emit: () => {} }), emit: () => {} });
  for (let i = 0; i < humans; i++) g.addPlayer('u' + i, 'Játékos' + i, 'av01', i === 0);
  for (let i = 0; i < bots; i++) { g.addPlayer('b' + i, 'Bot' + i, 'bírói kalap', false); g.getPlayer('b' + i).isBot = true; }
  return g;
}
const nameOf = (g, id) => (id ? g.getPlayer(id).name : null);

console.log('1) Körindítás: kör + szerepek, botok nélkül');
{
  calls.length = 0;
  const g = mkGame(6, 1);
  g.startGame({ rounds: 2, witnessEnabled: true, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const d = g.roundData;
  for (let i = 0; i < 6; i++) ok(count('Játékos' + i, 'korok') === 1, 'Játékos' + i + ': 1 kör');
  ok(count('Bot0', 'korok') === 0, 'a bot köre nem íródik be');
  const expect = { ugyesz: d.prosecutorId, vedo: d.defenderId, biro: d.currentJudgeId, tanu: d.witnessId };
  for (const [key, id] of Object.entries(expect)) {
    const p = id && g.getPlayer(id);
    const exp = p && !p.isBot ? 1 : 0;
    ok(calls.filter((c) => c.key === key).length === exp, key + ': ' + (exp ? nameOf(g, id) : 'bot vagy nincs') + (exp ? ' kapja' : ' – nem íródik be'));
  }
  g.dispose();
}

function verdict(g, guiltyMajority) {
  g.startVerdictVote();
  for (const v of g.roundData.voters) g.castVerdictVote(v, guiltyMajority ? 'guilty' : 'not_guilty');
  g.finishVerdictVote();
}

console.log('2) Ítélet: elítélés / felmentés + ügyész- és védő-siker');
for (const guilty of [true, false]) {
  calls.length = 0;
  const g = mkGame(6, 0);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  const d = g.roundData;
  const dn = nameOf(g, d.defendantId), pn = nameOf(g, d.prosecutorId), vn = nameOf(g, d.defenderId);
  verdict(g, guilty);
  ok(g.roundData.verdictResult.guilty === guilty, (guilty ? 'bűnös' : 'ártatlan') + ' ítélet');
  ok(count(dn, 'vadlott') === 1, 'a vádlott +1 vádlottkénti szerep');
  ok(count(dn, guilty ? 'bunos' : 'artatlan') === 1, 'a vádlott ' + (guilty ? 'elítélve' : 'felmentve'));
  ok(count(dn, guilty ? 'artatlan' : 'bunos') === 0, 'a másik kimenetel nem íródik be');
  ok(count(pn, 'ugyeszSiker') === (guilty ? 1 : 0), 'ügyész-siker: ' + (guilty ? 'igen' : 'nem'));
  ok(count(vn, 'vedoSiker') === (guilty ? 0 : 1), 'védő-siker: ' + (guilty ? 'nem' : 'igen'));
  g.dispose();
}

console.log('3) Játék vége: játék, pont, kihívás, győzelem (egyszer, botok nélkül)');
{
  calls.length = 0;
  const g = mkGame(4, 1);
  g.startGame({ rounds: 1, witnessEnabled: false, challengesEnabled: false, modes: ['buli'] }, 'u0');
  g.getPlayer('u1').score = 7; g.getPlayer('u1').challengesDone = 2;
  g.getPlayer('u2').score = 3;
  g.getPlayer('u3').score = 0;
  g.getPlayer('b0').score = 20; // a bot nem számít bele
  g.finalResults(); g.finalResults(); g.finalResults(); // többszöri állapotkérés sem duplázhat
  for (const n of ['Játékos0', 'Játékos1', 'Játékos2', 'Játékos3']) ok(count(n, 'jatek') === 1, n + ': 1 lejátszott játék (nem duplázódik)');
  ok(count('Bot0', 'jatek') === 0, 'a bot nem kap játékot');
  ok(count('Játékos1', 'pont') === 7 && count('Játékos2', 'pont') === 3, 'összpontszám: 7 és 3');
  ok(count('Játékos3', 'pont') === 0, '0 pont nem íródik be');
  ok(count('Játékos1', 'kihivas') === 2, 'teljesített kihívások: 2');
  ok(count('Játékos1', 'gyozelem') === 1, 'győzelem: a legtöbb pontos humán (a bot pontjait nem vesszük figyelembe, ha ő van elöl)');
  g.dispose();
}

console.log(fails ? '\nPIROS ✘ (' + fails + ' hiba)' : '\nÖSSZES ALTERSZT ZÖLD ✔');
process.exit(fails ? 1 : 0);
