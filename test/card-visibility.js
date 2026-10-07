'use strict';
// ============================================================
// KAMU BÍRÓSÁG – kártyák láthatósága (8. pont): logikateszt
// 1) FELKÉSZÜLÉS: mindenki látja a saját kártyáit (kihívással együtt)
// 2) Ügyész: bizonyíték + kihívás a felkészüléstől az ÍTÉLETIG
// 3) Védőügyvéd: az ügyész bizonyítékai + a saját trükkjei + kihívása folyamatosan
// 4) Vádlott: alibi + kihívás a felkészüléstől az ítéletig (végig látja)
// 5) Tanúkártya csak a TANÚ fázisban
// 6) Bíró: judgeWatch (kihívások) változatlan
// 7) Nincs védőügyvéd (4 játékos): bizonyíték csak az ügyésznek
// 8) Reconnect: a szerephez tartozó, éppen látható kártyák jönnek vissza
// Futtatás: node test/card-visibility.js
// ============================================================

const fs = require('fs');
const path = require('path');
const { Game } = require('../game');

let fails = 0;
function ok(cond, label) {
  if (cond) { console.log('  OK  ' + label); }
  else { fails++; console.log('  HIBA ' + label); }
}

function mkGame(n) {
  const g = new Game('CV', { to: () => ({ emit: () => {} }), emit: () => {} });
  for (let i = 0; i < n; i++) g.addPlayer('u' + i, 'Játékos' + i, 'bírói kalap', i === 0);
  return g;
}

console.log('1-4) 6 játékos: ügyész/védőügyvéd folyamatosan, vádlott csak felkészülés alatt');
{
  const g = mkGame(6);
  g.startGame({ rounds: 1, witnessEnabled: false, modes: ['buli'] }, 'u0');
  const d = g.roundData;
  const jurorId = d.voters.find((v) => v !== d.currentJudgeId);

  // --- FELKÉSZÜLÉS ---
  g.phase = 'prep';
  const ps = g.publicState(d.prosecutorId);
  ok(Array.isArray(ps.evidence) && ps.evidence.length === 3, 'prep: ügyész látja a 3 bizonyítékát');
  ok(!!ps.myChallenge, 'prep: ügyész látja a kihívását');
  const df = g.publicState(d.defendantId);
  ok(!!df.alibi, 'prep: vádlott látja az alibijét');
  ok(!!df.myChallenge, 'prep: vádlott látja a kihívását');
  ok(df.evidence === undefined && df.tricks === undefined, 'prep: vádlott NEM látja a többiek kártyáit');
  const dv = g.publicState(d.defenderId);
  ok(Array.isArray(dv.evidence) && dv.evidence.length === 3, 'prep: védőügyvéd látja az ügyész bizonyítékait');
  ok(Array.isArray(dv.tricks) && dv.tricks.length === 2, 'prep: védőügyvéd látja a trükkjeit');
  ok(!!dv.myChallenge, 'prep: védőügyvéd látja a kihívását');
  const ju = g.publicState(jurorId);
  ok(ju.evidence === undefined && ju.alibi === undefined && ju.tricks === undefined && ju.myChallenge === undefined,
    'prep: esküdt nem kap titkos kártyát');

  // --- VÁDBESZÉD (ügyész beszél) ---
  g.phase = 'prosecution';
  const ps2 = g.publicState(d.prosecutorId);
  ok(Array.isArray(ps2.evidence) && !!ps2.myChallenge, 'vádbeszéd: ügyész folyamatosan látja (bizonyíték + kihívás)');
  const dv2 = g.publicState(d.defenderId);
  ok(Array.isArray(dv2.evidence) && Array.isArray(dv2.tricks) && !!dv2.myChallenge,
    'vádbeszéd: védőügyvéd folyamatosan látja (ügyész bizonyítékai + trükkök + kihívás)');
  const df2 = g.publicState(d.defendantId);
  ok(!!df2.alibi && !!df2.myChallenge,
    'vádbeszéd: vádlott továbbra is látja az alibijét és a kihívását');
  const ju2 = g.publicState(jurorId);
  ok(ju2.evidence === undefined && ju2.myChallenge === undefined, 'vádbeszéd: esküdt nem kap kártyát');

  // --- VÉDEKEZÉS (vádlott beszél) ---
  g.phase = 'defense';
  const df3 = g.publicState(d.defendantId);
  ok(!!df3.alibi && !!df3.myChallenge, 'védekezés: vádlott végig látja az alibijét és a kihívását (segítség)');
  ok(Array.isArray(g.publicState(d.prosecutorId).evidence), 'védekezés: ügyész továbbra is látja a bizonyítékát');

  // --- TANÚ fázis ---
  d.witnessId = jurorId;
  d.witnessCard = 'TANÚ-KÁRTYA-X';
  g.phase = 'witness';
  const w = g.publicState(jurorId);
  ok(w.witnessCard === 'TANÚ-KÁRTYA-X', 'tanú fázis: a tanú végig látja a kártyáját');
  ok(w.evidence === undefined && w.tricks === undefined, 'tanú fázis: a tanú csak a sajátját látja');
  ok(Array.isArray(g.publicState(d.defenderId).evidence), 'tanú fázis: védőügyvéd továbbra is látja a bizonyítékokat');
  g.phase = 'final_prosecution';
  ok(g.publicState(jurorId).witnessCard === 'TANÚ-KÁRTYA-X', 'zárószó: a tanú továbbra is látja a kártyáját');
  ok(g.publicState(d.prosecutorId).witnessCard === undefined, 'zárószó: más nem kapja meg a tanúkártyát');

  // --- ÍTÉLET ---
  g.phase = 'verdict';
  ok(Array.isArray(g.publicState(d.prosecutorId).evidence), 'ítélet: ügyész az ítéletig látja a bizonyítékát');
  ok(!!g.publicState(d.defendantId).alibi, 'ítélet: vádlott az ítéletig látja az alibijét');
  ok(Array.isArray(g.publicState(d.defenderId).evidence) && Array.isArray(g.publicState(d.defenderId).tricks),
    'ítélet: védőügyvéd az ítéletig látja a kártyáit');

  // --- KIHÍVÁS-ELLENŐRZÉS (a felfedés nyilvános, kártyaadat nem megy) ---
  g.phase = 'challenge_review';
  const ps3 = g.publicState(d.prosecutorId);
  ok(Array.isArray(ps3.evidence) && !!ps3.myChallenge,
    'ellenőrzés: bizonyíték és kihívás továbbra is látható');
  ok(Array.isArray(g.publicState(d.currentJudgeId).judgeWatch), 'ellenőrzés: a bíró továbbra is látja a kihívásokat');
}

console.log('5) Nincs védőügyvéd (4 játékos): bizonyíték csak az ügyésznek');
{
  const g = mkGame(4);
  g.startGame({ rounds: 1, witnessEnabled: false, modes: ['buli'] }, 'u0');
  const d = g.roundData;
  ok(!d.defenderId, '4 játékosnál nincs védőügyvéd');
  g.phase = 'prosecution';
  const withEvidence = Array.from(g.players.keys()).filter((id) => g.publicState(id).evidence !== undefined);
  ok(withEvidence.length === 1 && withEvidence[0] === d.prosecutorId,
    'pontosan az ügyész kapja a bizonyítékot: ' + JSON.stringify(withEvidence));
}

console.log('6) Reconnect: a szerephez tartozó, éppen látható kártyák jönnek vissza');
{
  const g = mkGame(6);
  g.startGame({ rounds: 1, witnessEnabled: false, modes: ['buli'] }, 'u0');
  const d = g.roundData;
  const dv = g.getPlayer(d.defenderId);
  dv.connected = false;
  g.handleDisconnect(d.defenderId);
  g.handleReconnect(d.defenderId); // visszacsatlakozás (ugyanaz a playerId)
  g.phase = 'defense';
  const st = g.publicState(d.defenderId);
  ok(Array.isArray(st.evidence) && Array.isArray(st.tricks) && !!st.myChallenge,
    'visszacsatlakozó védőügyvéd visszakapja az éppen látható kártyáit');
  g.phase = 'prep';
  const st2 = g.publicState(d.defendantId);
  ok(!!st2.alibi, 'visszacsatlakozó vádlott a prep alatt látja az alibijét');
}

console.log('7) Kliens statikus: KÁRTYÁIM sáv');
{
  const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
  // A régi lenyíló sáv helyett fizikai kártya-kéz (cards.js / cards.css): ugyanaz a láthatósági szabály, csak a megjelenítés új.
  const cards = fs.readFileSync(path.join(__dirname, '..', 'public', 'cards.js'), 'utf8');
  const cardsCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'cards.css'), 'utf8');
  ok(html.includes('id="myCardsBar"'), 'index.html: #myCardsBar kéz megvan');
  ok(client.includes('Az ügyész bizonyítékai'), 'kliens: "Az ügyész bizonyítékai" a védőügyvéd kártyáin');
  ok(cards.includes('CSAK TE LÁTOD') && cards.includes('ch-toggle'), 'kéz: CSAK TE LÁTOD + a "KÁRTYÁIM" szalag');
  ok(!client.includes('A kártyáid elrejtve'), 'kliens: nincs többé "A kártyáid elrejtve" jelzés');
  ok(client.includes("add('witness'") && cards.includes('TITKOS TANÚKÁRTYA'), 'kliens: tanúkártya a KÁRTYÁIM kézben');
  ok(cardsCss.includes('.card-hand'), 'stílus: .card-hand');
  ok(/visibility: 'private'/.test(client), 'a kéz leírói privátként jelöltek');
  ok(game_judgeUnchanged(), 'bíró judgeWatch szabálya változatlan (publicState)');
}

function game_judgeUnchanged() {
  const game = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  return game.includes('isJudgeNow') && game.includes('judgeWatch');
}

console.log(fails === 0 ? '\nÖSSZES ALTERSZT ZÖLD ✔' : '\n' + fails + ' TESZT PIROS ✘');
process.exit(fails === 0 ? 0 : 1);
