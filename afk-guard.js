'use strict';

// ============================================================
// KAMU BÍRÓSÁG – AFK-védelem + díjak egyszeriség teszt
// 1) VÁDEMELÉS: senki nem nyom gombot → 2 perc után automatikusan megy tovább
//    (rövidített időzítővel, a konstans felülírásával NEM, hanem a
//    phaseTimer lejártát szimulálva: a setPhase callbackjét hívjuk meg,
//    ami ugyanaz, amit az időzítő tenni fog)
// 2) SZAVAZÁS: csak egy esküdt szavaz → lejárat után a LEADOTT szavazatok döntenek
// 3) KIHÍVÁS-SZAVAZÁS: lejárat → nem teljesített kimenet, nem akad el
// 4) finalResults() többször is hívható → a díjak EGYSZER íródnak a nyilvántartásba
// Futtatás: node test/afk-guard.js
// ============================================================

const { Game } = require('../game');

let fails = 0;
function ok(cond, label) {
  console.log((cond ? '  OK  ' : '  HIBA ') + label);
  if (!cond) fails++;
}

function makeGame(dijLog) {
  const g = new Game('AFK', { to: () => ({ emit: () => {} }) });
  g.addPlayer('h1', 'Ember', 'paróka', true);
  g.addPlayer('u2', 'Masodik', 'paróka', false);
  g.addPlayer('u3', 'Harmadik', 'paróka', false);
  g.addPlayer('u4', 'Negyedik', 'paróka', false);
  return g;
}

(function main() {
  // ---------- 1) VÁDEMELÉS AFK-timeout ----------
  console.log('== 1) VÁDEMELÉS: gombnyomás nélkül is továbbmegy ==');
  {
    const g = makeGame();
    g.startGame({ modes: ['cs'], rounds: 1, witnessEnabled: false, challengesEnabled: false }, 'h1');
    ok(g.phase === 'accusation', 'indulás: accusation fázis');
    // Az accusationRead a setPhase callbackje és az időzítő callbackje is egyben –
    // tehát a "senki sem nyomta meg" eset épp ezt hívja le a 2 perc után.
    g.accusationRead();
    ok(g.phase === 'prep', 'a vádemelés automatikusan prep fázisba lépett (AFK esetén is)');
    g.clearTimers();
  }

  // ---------- 2) SZAVAZÁS: hiányzó szavazatok mellett is lezárul ----------
  console.log('== 2) SZAVAZÁS: lejáratkor a leadott szavazatok döntenek ==');
  {
    const g = makeGame();
    g.startGame({ modes: ['cs'], rounds: 1, witnessEnabled: false, challengesEnabled: false }, 'h1');
    // beszédek gyors végigvitele a verdict_vote fázisig
    g.afterSpeech('prosecution');
    g.afterSpeech('defense');
    g.afterClosing('final_prosecution');
    g.afterClosing('final_defense');
    ok(g.phase === 'verdict_vote', 'verdict_vote fázisban vagyunk');
    const voters = g.roundData.voters;
    ok(voters.length >= 2, 'van kivel tesztelni (' + voters.length + ' szavazó)');
    // CSAK EGY szavazat érkezik (a többi AFK / kiesett)
    g.castVerdictVote(voters[0], 'guilty');
    ok(g.phase === 'verdict_vote', 'egy szavazattal még várunk (nem dől el azonnal)');
    // Az időzítő lejártát szimuláljuk: a setPhase-ben beállított callback a finishVerdictVote.
    g.finishVerdictVote();
    ok(g.phase === 'verdict', 'a lejárat után kihirdetésre került az ítélet');
    ok(g.roundData.verdictResult && g.roundData.verdictResult.guiltyVotes === 1,
      'a leadott 1 bűnös szavazat megjelent az eredményben (hiányzók nem fejtörést okoznak)');
    g.clearTimers();
  }

  // ---------- 3) KIHÍVÁS-SZAVAZÁS AFK-timeout (esküdtek mód) ----------
  console.log('== 3) KIHÍVÁS-SZAVAZÁS: lejáratkor nem akad el ==');
  {
    const g = makeGame();
    g.startGame({ modes: ['cs'], rounds: 1, witnessEnabled: false, challengesEnabled: true, challengeMode: 'jury' }, 'h1');
    g.afterSpeech('prosecution');
    g.afterSpeech('defense');
    g.afterClosing('final_prosecution');
    g.afterClosing('final_defense');
    ok(g.phase === 'verdict_vote', 'verdict_vote-ban vagyunk');
    // egyetlen szavazat se érkezik (mindenki AFK) → időzítő lejár
    g.finishVerdictVote();
    ok(g.phase === 'challenge_vote', 'kihívás-szavazásra lépett (esküdtek mód)');
    // az időzítő callbackje a revealVerdict – ez hívódik lejáratkor
    g.revealVerdict();
    ok(g.phase === 'verdict', 'a lejárat után is megtörténik az ítélet (nem fagy be)');
    g.clearTimers();
  }

  // ---------- 4) Díjak egyszeri rögzítése ----------
  console.log('== 4) finalResults(): díjak EGYSZER íródnak a nyilvántartásba ==');
  {
    let dijCount = 0;
    const g = makeGame();
    Game.setStatRecorder((name, key, by) => { if (key === 'dijak') dijCount += (by || 1); });
    g.startGame({ modes: ['cs'], rounds: 1, witnessEnabled: false, challengesEnabled: false }, 'h1');
    // pont adása, hogy legyen díj
    g.players.get('u2').score = 5;
    g.afterSpeech('prosecution');
    g.afterSpeech('defense');
    g.afterClosing('final_prosecution');
    g.afterClosing('final_defense');
    for (const v of g.roundData.voters) g.castVerdictVote(v, 'not_guilty');
    g.finishVerdictVote();
    g.proceedAfterVerdict(); // → round_results
    g.nextRound(); // → game_over (1 körből)
    ok(g.phase === 'game_over', 'game_over fázisban vagyunk');
    // A bug: a game_over állapot MINDEN state-kérésénél újraíródtak a díjak.
    g.publicState('h1');
    const first = dijCount;
    ok(first > 0, 'első rögzítés megtörtént (' + first + ' díj-bejegyzés)');
    g.publicState('h1'); g.publicState('h1'); g.publicState('h1'); g.publicState('u2'); g.publicState('u3');
    ok(dijCount === first, '5 további state-kérés után sem változott (' + dijCount + ') – pontosan EGYSZER íródott');
    g.clearTimers();
    Game.setStatRecorder(null);
  }

  console.log('');
  console.log(fails === 0 ? 'AFK-GUARD MIND ZÖLD' : 'HIBÁS: ' + fails);
  process.exit(fails > 0 ? 1 : 0);
})();
