'use strict';

// Bot-megbízhatósági szimuláció: 6 teljes játékot futtat botokkal,
// és kiírja, melyik mennyi idő alatt ért az ítéletig.
// Az emberi játékos (h1) is automatikusan szavaz, mint egy igazi kliens,
// mert a szavazás minden aktív szavazóra vár – emberekre is.
const { Game } = require('../game');

async function runOnce(i) {
  const g = new Game('T' + i, { to: () => ({ emit: () => {} }) });
  g.io.emit = () => {};
  g.addPlayer('h1', 'Ember', 'paróka', true);
  for (let k = 0; k < 4; k++) g.addBot();
  g.startGame({
    modes: ['minecraft'], rounds: 1, speechSeconds: 15, defenderSeconds: 15,
    prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10,
    witnessEnabled: true, challengesEnabled: true
  }, 'h1');
  return new Promise((res) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const el = (Date.now() - start) / 1000;
      const d = g.roundData;
      if (g.phase === 'verdict_vote') {
        if (d && d.voters.includes('h1') && !d.votes['h1']) {
          g.castVerdictVote('h1', Math.random() < 0.5 ? 'guilty' : 'not_guilty');
        }
      } else if (g.phase === 'challenge_vote') {
        if (d && d.challengeVoters.includes('h1') && !d.challengeVotes['h1']) {
          for (const ch of d.challenges) {
            g.castChallengeVote('h1', ch.who, Math.random() < 0.7);
          }
        }
      }
      if (g.phase === 'verdict') { clearInterval(iv); g.clearTimers(); res('OK ' + el.toFixed(0) + 's'); }
      else if (el > 120) { clearInterval(iv); g.clearTimers(); res('STUCK ' + g.phase); }
    }, 500);
  });
}

(async () => {
  const total = parseInt(process.argv[2], 10) || 6;
  let fails = 0;
  for (let i = 1; i <= total; i++) {
    const r = await runOnce(i);
    console.log('futás ' + i + ': ' + r);
    if (r.startsWith('STUCK')) fails++;
  }
  console.log('HIBÁS: ' + fails + '/' + total);
  process.exit(fails > 0 ? 1 : 0);
})();
