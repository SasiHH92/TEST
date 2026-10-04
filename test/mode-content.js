'use strict';

// SZIGORÚ tartalom-teszt (A3): mind a 6 módot 20 körön át futtatja, és
// körönként ellenőrzi, hogy a vád, a bizonyítékok, az alibi, a trükkök,
// a tanúkártya és a büntetés KIZÁRÓLAG az adott kör módjának paklijából
// jött (kivétel: általános kihívások/nehezítések). Plusz Vegyes mód
// (körönként egy mód, körön belül nincs keveredés), üres módlista
// (hiba, nem indul el) és érvénytelen/kliens-szerű mód-kulcsok.
// Futtatás: node test/mode-content.js

const { Game } = require('../game');
const CARDS = require('../data/cards.json');

const MODES = ['repo', 'cs', 'pubg', 'minecraft', 'roblox', 'buli'];
const ROUNDS = 20;

let fails = 0;
function check(name, cond) {
  if (cond) console.log('  OK  ' + name);
  else { fails++; console.log('  HIBA ' + name); }
}

function makeGame() {
  const warnings = [];
  const emit = (evt, payload) => {
    if (evt === 'host_warning') warnings.push(payload && payload.message);
  };
  const g = new Game('TART', { to: () => ({ emit }) });
  g.addPlayer('h1', 'Ember', 'paróka', true);
  for (let k = 0; k < 4; k++) g.addBot(); // 5 játékos: védőügyvéd is van
  return { g, warnings };
}

// Egy kör lejátszása fázisonként (valós időzítők nélkül, közvetlen hívásokkal),
// közben minden kártyát ellenőriz, hogy a megadott mód paklijából jött-e.
function assertRoundCards(g, mode, label) {
  const src = CARDS[mode];
  const d = g.roundData;
  check(label + ': kör módja = ' + mode, d.mode === mode);
  check(label + ': 3 bizonyíték a mód paklijából', d.evidence.length === 3 && d.evidence.every((e) => src.bizonyitekok.includes(e)));
  check(label + ': alibi a mód paklijából', src.alibik.includes(d.alibi));
  if (d.defenderId) {
    check(label + ': trükkök a mód paklijából', Array.isArray(d.tricks) && d.tricks.length === 2 && d.tricks.every((t) => src.trukkok.includes(t)));
  }
  // Kihívások: nem-nehezítés = mód kihivasok ∪ altalanos.kihivasok; nehezítés = altalanos.nehezitesek.
  const altCh = CARDS.altalanos.kihivasok;
  const altHard = CARDS.altalanos.nehezitesek;
  for (const ch of d.challenges) {
    if (ch.difficulty) {
      check(label + ': nehezítés az általános pakliból', altHard.includes(ch.text));
    } else {
      check(label + ': kihívás mód/általános pakliból (' + ch.who + ')', src.kihivasok.includes(ch.text) || altCh.includes(ch.text));
    }
  }
}

function playOneRound(g, mode, label) {
  assertRoundCards(g, mode, label + ' [kezdés]');

  // beszédek lefuttatása (a tanú kártyája a védő után jön)
  g.afterSpeech('prosecution');
  g.afterSpeech('defense');
  g.afterSpeech('defender'); // → afterDefender
  if (g.roundData.witnessId) {
    check(label + ': tanúkártya a mód paklijából', CARDS[mode].tanuk.includes(g.roundData.witnessCard));
    g.runClosing('final_prosecution');
  } else {
    g.runClosing('final_prosecution');
  }
  g.afterClosing('final_prosecution'); // → final_defense
  g.afterClosing('final_defense');     // → verdict_vote

  // szavazatok + ítélet (bíró mód: azonnal kihirdetés)
  for (const v of g.roundData.voters) {
    g.castVerdictVote(v, Math.random() < 0.5 ? 'guilty' : 'not_guilty');
  }
  check(label + ': szavazási fázisban vagyunk', g.phase === 'verdict_vote');
  g.finishVerdictVote();
  check(label + ': ítélet kihirdetve', g.phase === 'verdict' && !!g.roundData.verdictResult);
  check(label + ': büntetés/felmentés a mód paklijából', CARDS[mode].buntetesek.includes(g.roundData.verdictResult.sentence));
  check(label + ': jegyzőkönyv mód-neve helyes', CARDS[mode].nev === g.publicState('h1').modeName);
}

(function main() {
  // 1) Mind a 6 mód külön-külön, ROUNDS körön át
  for (const mode of MODES) {
    console.log('\n== MÓD: ' + mode + ' (' + CARDS[mode].nev + ') – ' + ROUNDS + ' kör ==');
    const { g } = makeGame();
    const ok = g.startGame({ modes: [mode], rounds: ROUNDS, speechSeconds: 15, defenderSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10, witnessEnabled: true, challengesEnabled: true, challengeMode: 'judge' }, 'h1');
    check(mode + ': indul', ok !== false && g.phase === 'accusation');
    let r = 0;
    while (r < ROUNDS && g.phase !== 'game_over' && g.roundData) {
      r++;
      playOneRound(g, mode, mode + ' ' + r + '. kör');
      g.nextRound(); // kör vége → következő (a 20. után game_over)
    }
    check(mode + ': mind a ' + ROUNDS + ' kör lefutott', r === ROUNDS);
    check(mode + ': game_over a végén', g.phase === 'game_over');
    g.clearTimers();
  }

  // 2) Vegyes: mind a 6 mód kijelölve – körönként EGY mód, körön belül nincs keveredés
  console.log('\n== VEGYES mód – ' + ROUNDS + ' kör ==');
  {
    const { g } = makeGame();
    const ok = g.startGame({ modes: MODES.slice(), rounds: ROUNDS, speechSeconds: 15, defenderSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10, witnessEnabled: true, challengesEnabled: true, challengeMode: 'judge' }, 'h1');
    check('Vegyes: indul', ok !== false);
    const seen = new Set();
    let r = 0;
    while (r < ROUNDS && g.roundData) {
      r++;
      const mode = g.roundData.mode;
      seen.add(mode);
      playOneRound(g, mode, 'Vegyes ' + r + '. kör');
      g.nextRound();
    }
    check('Vegyes: mind a ' + ROUNDS + ' kör lefutott', r === ROUNDS);
    check('Vegyes: minden kör módja érvényes volt', MODES.some((m) => seen.has(m)));
    check('Vegyes: több különböző mód sorsolódott (' + seen.size + ' db)', seen.size >= 3);
    g.clearTimers();
  }

  // 3) Üres módlista: hiba, NINCS csendes Buli-visszaesés
  console.log('\n== ÜRES módlista ==');
  {
    const { g, warnings } = makeGame();
    let crashed = false;
    let ret;
    try { ret = g.startGame({ modes: [], rounds: 3 }, 'h1'); } catch (e) { crashed = true; }
    check('üres lista: NEM omlik össze', !crashed);
    check('üres lista: startGame false-t ad', ret === false);
    check('üres lista: fázis lobby marad, nincs roundData', g.phase === 'lobby' && !g.roundData);
    check('üres lista: házigazdai figyelmeztetés megy', warnings.some((m) => String(m).includes('mappá')));
    g.clearTimers();
  }

  // 4) Kliens-szerű rossz kulcsok ('csgo', 'CS:GO / CS2', 'free') – visszautasítva
  console.log('\n== ÉRVÉNYTELEN mód-kulcsok ==');
  {
    const { g, warnings } = makeGame();
    let ret;
    try { ret = g.startGame({ modes: ['csgo', 'CS:GO / CS2', 'free'], rounds: 2 }, 'h1'); } catch (e) { ret = undefined; }
    check('rossz kulcsok: startGame false (nem indul Buli-visszaeséssel)', ret === false && g.phase === 'lobby');
    check('rossz kulcsok: figyelmeztetés megy', warnings.length > 0);
    g.clearTimers();
  }

  // 5) Saját (házigazdai) vád: mindig isCustomAccusation=true és tartalmazza a vádlott nevét
  console.log('\n== SAJÁT vád ==');
  {
    const { g } = makeGame();
    const custom = ['Egyedi vád: a [vádlott] megette a csoport összes pogácsáját.'];
    // Determinisztikus: Math.random=0.1 < 0.4 → a saját vád jön.
    const origRandom = Math.random;
    Math.random = () => 0.1;
    let ok;
    try { ok = g.startGame({ modes: ['cs'], rounds: 1, speechSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10, witnessEnabled: true, challengesEnabled: true, customAccusations: custom.slice() }, 'h1'); } finally { Math.random = origRandom; }
    check('SAJÁT vád: indul', ok !== false);
    check('SAJÁT vád: isCustomAccusation=true', g.roundData.isCustomAccusation === true);
    check('SAJÁT vád: publicState isCustom=true', g.publicState('h1').isCustom === true);
    check('SAJÁT vád: a [vádlott] helyettesítve', g.roundData.accusationText.includes(g.players.get(g.roundData.defendantId).name) && !g.roundData.accusationText.includes('[vádlott]'));
    g.clearTimers();
  }

  console.log('\n' + (fails === 0 ? 'MINDEN TARTALOM-TESZT ZÖLD' : 'HIBÁS: ' + fails + ' ellenőrzés'));
  process.exit(fails > 0 ? 1 : 0);
})();
