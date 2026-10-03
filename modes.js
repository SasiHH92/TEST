'use strict';

// Játékmód-teszt: mind a 6 mód külön-külön, a Vegyes és az
// "egyik sincs kijelölve" eset is elindul hiba nélkül.
// Futtatás: node test/modes.js

const { Game } = require('../game');

const MODES = ['repo', 'cs', 'pubg', 'minecraft', 'roblox', 'buli'];

function makeGame() {
  const warnings = [];
  const g = new Game('MODES', { to: () => ({ emit: () => {} }) });
  g.io.emit = (evt, payload) => {
    if (evt === 'host_warning') warnings.push(payload && payload.message);
  };
  g.addPlayer('h1', 'Ember', 'paróka', true);
  for (let k = 0; k < 3; k++) g.addBot();
  return { g, warnings };
}

let fails = 0;
function check(name, cond) {
  if (cond) console.log('  OK  ' + name);
  else { fails++; console.log('  HIBA ' + name); }
}

(function main() {
  // 1) minden mód külön-külön
  for (const mode of MODES) {
    const { g } = makeGame();
    try {
      g.startGame({
        modes: [mode], rounds: 1, speechSeconds: 15, defenderSeconds: 15,
        prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10,
        witnessEnabled: true, challengesEnabled: true
      }, 'h1');
      check(mode + ': indul', g.phase === 'accusation');
      check(mode + ': van vádszöveg', typeof g.roundData.accusationText === 'string' && g.roundData.accusationText.length > 5);
      check(mode + ': 3 bizonyíték', Array.isArray(g.roundData.evidence) && g.roundData.evidence.length === 3 && g.roundData.evidence.every(Boolean));
      check(mode + ': van alibi', typeof g.roundData.alibi === 'string' && g.roundData.alibi.length > 3);
      g.clearTimers();
    } catch (e) {
      check(mode + ': NEM omlik össze (' + e.message + ')', false);
      try { g.clearTimers(); } catch (e2) { /* */ }
    }
  }

  // 2) Vegyes: mind a 6 mód egyszerre
  {
    const { g } = makeGame();
    try {
      g.startGame({
        modes: MODES.slice(), rounds: 2, speechSeconds: 15, defenderSeconds: 15,
        prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10,
        witnessEnabled: true, challengesEnabled: true
      }, 'h1');
      check('Vegyes: indul', g.phase === 'accusation');
      check('Vegyes: érvényes mód sorsolódik', MODES.includes(g.roundData.mode));
      g.clearTimers();
    } catch (e) {
      check('Vegyes: NEM omlik össze (' + e.message + ')', false);
      try { g.clearTimers(); } catch (e2) { /* */ }
    }
  }

  // 3) egyik sincs kijelölve: figyelmeztetés, nem crash
  {
    const { g, warnings } = makeGame();
    let crashed = false;
    let ret;
    try { ret = g.startGame({ modes: [] }, 'h1'); } catch (e) { crashed = true; }
    check('üres lista: NEM omlik össze', !crashed);
    check('üres lista: nem indul el a játék', ret === false && g.phase === 'lobby' && !g.roundData);
    check('üres lista: házigazdai figyelmeztetés megy', warnings.some((m) => String(m).includes('ügyirat')));
  }

  // 4) érvénytelen mód-kulcsok: kiszűrve, figyelmeztetés
  {
    const { g, warnings } = makeGame();
    let crashed = false;
    let ret;
    try { ret = g.startGame({ modes: ['nem_letezik', 'valami_mas'] }, 'h1'); } catch (e) { crashed = true; }
    check('érvénytelen kulcs: NEM omlik össze', !crashed);
    check('érvénytelen kulcs: nem indul el a játék', ret === false && g.phase === 'lobby');
    check('érvénytelen kulcs: figyelmeztetés megy', warnings.length > 0);
  }

  // 5) körök között váltható mód – a 2. kör az új mód paklijából él
  {
    const { g } = makeGame();
    try {
      g.startGame({
        modes: ['buli'], rounds: 2, speechSeconds: 15, defenderSeconds: 15,
        prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10,
        witnessEnabled: false, challengesEnabled: false
      }, 'h1');
      const case1 = g.roundData.caseNo;
      g.settings.modes = ['minecraft'];
      g.nextRound(); // a nextAfterResults belső lépése
      check('módváltás a körök között: új kör indul', g.roundData && g.roundData.caseNo !== case1);
      check('módváltás: az új mód sorsolódik', g.roundData.mode === 'minecraft');
      check('módváltás: van vádszöveg az új módból', g.roundData.accusationText.length > 5);
      g.clearTimers();
    } catch (e) {
      check('módváltás: NEM omlik össze (' + e.message + ')', false);
      try { g.clearTimers(); } catch (e2) { /* */ }
    }
  }

  console.log(fails === 0 ? 'MINDEN MÓD-TESZT ZÖLD' : 'HIBÁS: ' + fails);
  process.exit(fails > 0 ? 1 : 0);
})();
