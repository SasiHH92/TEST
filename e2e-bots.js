'use strict';

// ============================================================
// KAMU BÍRÓSÁG – bot-teszt
// Egyetlen emberi kliens botokat ad a szobához, és a botokkal
// végigjátszik 2 kört. Ellenőrzi, hogy a botok önállóan
// levezetik a tárgyalást, és nem kerülnek a stats.json-be.
// Az emberi kliens "autopilótát" kap (mint egy igazi játékos:
// felolvas/szavaz, ha rá kerül a sor), és a waitState a state-
// előzményekből is tud olvasni, így nem marad le fázisokat.
// Futtatás: node test/e2e-bots.js
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const io = require('socket.io-client');

const PORT = 3131;
const URL = 'http://localhost:' + PORT;
const LOG = path.join(__dirname, 'e2e-bots-log.txt');
const STATS_FILE = path.join(__dirname, '..', 'data', 'stats.json');
const logLines = [];
function log(s) {
  logLines.push(s);
  process.stdout.write(s + '\n');
}

const WATCHDOG = setTimeout(() => {
  log('!! GLOBÁLIS IDŐTÚLLÉPÉS (420 s) !!');
  finish(2);
}, 420000);

function finish(code) {
  clearTimeout(WATCHDOG);
  try { fs.writeFileSync(LOG, logLines.join('\n')); } catch (e) { /* */ }
  process.exit(code);
}

let failures = 0;
let passes = 0;
function check(name, cond) {
  if (cond) { passes++; log('  OK  ' + name); }
  else { failures++; log('  HIBA ' + name); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 5000 });
    s.on('connect', () => {
      s.history = [];       // minden bejövő state ide (waitState visszafele is keres)
      s.phaseSeen = {};     // melyik fázisban jártunk már (autopilota dedup)
      s.t0 = Date.now();
      s.on('state', (st) => {
        if (!s.lastPhase || s.lastPhase !== st.phase) {
          s.lastPhase = st.phase;
          log('  [' + ((Date.now() - s.t0) / 1000).toFixed(1) + 's] ' + st.phase
            + ' (kör ' + st.round + ', ügy: ' + (st.caseNo || '-') + ')');
        }
        s.lastState = st;
        s.history.push(st);
        if (s.history.length > 400) s.history.shift();
        if (st.phase) s.phaseSeen[st.phase] = true;
      });
      resolve(s);
    });
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket timeout')), 6000);
  });
}

function emit(s, event, payload) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 5000);
    s.emit(event, payload, (res) => {
      if (!done) { done = true; clearTimeout(t); resolve(res); }
    });
  });
}

function fire(s, event, payload) {
  s.emit(event, payload);
}

// Olyan fázisra vár, ami a múltban MÁR előfordult vagy most jön –
// nem veszik el, ha a botok gyorsabbak voltak a feliratkozásnál.
// A mark-index miatt minden várakozás csak az ELŐZŐ várakozás után
// érkezett state-ekben kereshet – így a 2. köri várakozás nem talál
// el az 1. köri, history-beli fázisokra.
function waitState(sock, predicate, timeoutMs = 30000) {
  if (sock.mark === undefined) sock.mark = 0;
  if (sock.lastState && predicate(sock.lastState)) {
    sock.mark = sock.history.length;
    return Promise.resolve(sock.lastState);
  }
  const inHistory = sock.history.slice(sock.mark).find(predicate);
  if (inHistory) {
    sock.mark = sock.history.length;
    return Promise.resolve(inHistory);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sock.off('state', handler);
      reject(new Error('timeout waiting state (last=' + (sock.lastState && sock.lastState.phase) + ')'));
    }, timeoutMs);
    const handler = (st) => {
      if (predicate(st)) {
        clearTimeout(timer);
        sock.off('state', handler);
        sock.mark = sock.history.length;
        resolve(st);
      }
    };
    sock.on('state', handler);
  });
}

// Emberi játékos autopilótája: mintha egy igazi kliens ülne itt.
// - accusation: felolvassa a vádat (1x / ügyiratszám)
// - prosecution/defense/defender: befejezi a beszédet, ha ő a szónok
// - witness: befejezi a vallomást, ha ő a tanú
// - verdict_vote / challenge_vote: leadja a szavazatait
// (a state-ben: prosecutorId/defendantId/defenderId/witnessId,
//  verdictVote{canVote,myVote}, challengeVote{canVote,myVotes})
function autopilot(me) {
  const st = me.lastState;
  if (!st || st.round < 1) return;
  const seen = me.phaseSeen;
  const tag = ':' + (st.caseNo || st.round);
  const isHuman = (id) => id === 'human1';

  if (st.phase === 'accusation' && !seen['acc' + tag] && isHuman(st.prosecutorId)) {
    seen['acc' + tag] = true;
    fire(me, 'accusation_read');
  }
  const speakerByPhase = {
    prosecution: st.prosecutorId,
    defense: st.defendantId,
    defender: st.defenderId,
    final_prosecution: st.prosecutorId,
    final_defense: st.defendantId
  };
  if (speakerByPhase[st.phase] && isHuman(speakerByPhase[st.phase])
      && !seen['speak:' + st.phase + tag]) {
    seen['speak:' + st.phase + tag] = true;
    fire(me, 'done_speaking');
  }
  if (st.phase === 'witness' && st.witnessId === 'human1' && !seen['wit' + tag]) {
    seen['wit' + tag] = true;
    fire(me, 'done_speaking');
  }
  if (st.phase === 'verdict_vote' && st.verdictVote && st.verdictVote.canVote
      && !st.verdictVote.myVote && !seen['vv' + tag]) {
    seen['vv' + tag] = true;
    fire(me, 'vote_verdict', { verdict: Math.random() < 0.5 ? 'guilty' : 'not_guilty' });
  }
  if (st.phase === 'challenge_vote' && st.challengeVote && st.challengeVote.canVote
      && !seen['cv' + tag]) {
    seen['cv' + tag] = true;
    for (const ch of st.challengeVote.challenges) {
      fire(me, 'vote_challenge', { who: ch.who, done: Math.random() < 0.7 });
    }
  }
}

let serverProc = null;
async function startServer() {
  serverProc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => log('[szerver-hiba] ' + d.toString()));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('A szerver nem indult el')), 8000);
    const ping = () => {
      http.get(URL + '/healthz', (res) => {
        res.resume();
        if (res.statusCode === 200) { clearTimeout(t); resolve(); }
        else setTimeout(ping, 200);
      }).on('error', () => setTimeout(ping, 200));
    };
    ping();
  });
}
function stopServer() {
  if (serverProc) { try { serverProc.kill(); } catch (e) { /* */ } serverProc = null; }
}

async function main() {
  await startServer();
  log('Szerver elindult :' + PORT);
  const statsBefore = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));

  try {
    const me = await connect();
    const created = await emit(me, 'create_room', {
      name: '2CORE', avatar: 'paróka', playerId: 'human1',
      profile: { titulus: 'A Cukor-rang egyetlen túlélője', priusz: 'p', jelveny: '' }
    });
    check('szoba létrejött', !!created.code);

    for (let i = 0; i < 4; i++) {
      await emit(me, 'add_bot');
    }
    const st0 = me.lastState;
    check('4 bot a szobában', st0.players.filter((p) => p.isBot).length === 4);
    check('bot profilja van a plakáthoz', st0.players.filter((p) => p.isBot).every((p) => p.profile !== undefined));

    await emit(me, 'update_settings', {
      settings: { modes: ['minecraft'], rounds: 2, speechSeconds: 15, defenderSeconds: 15, prepSeconds: 10, witnessSeconds: 10, closingSeconds: 10, witnessEnabled: true, challengesEnabled: true, challengeMode: 'jury' }
    });

    await emit(me, 'start_game');
    log('  --  játék elindult, a botok veszik át az irányítást');
    me.autopilotTimer = setInterval(() => autopilot(me), 500);

    await waitState(me, (s) => s.phase === 'accusation');
    check('vádemelési fázis', true);
    await waitState(me, (s) => s.phase === 'prep', 15000);
    check('a bot felolvasta a vádat (prep fázis)', true);

    await waitState(me, (s) => s.phase === 'prosecution', 20000);
    check('vádbeszéd fázis', true);
    await waitState(me, (s) => s.phase === 'witness' || s.phase === 'defense' || s.phase === 'final_prosecution', 120000);
    check('a bot ügyész befejezte a beszédét', true);
    await waitState(me, (s) => s.phase === 'verdict_vote' || s.phase === 'witness' || s.phase === 'final_prosecution', 150000);
    check('eljutottunk a tanú/záró/szavazás fázisig', true);
    await waitState(me, (s) => s.phase === 'verdict_vote', 150000);
    check('szavazás fázis – a bot-esküdtek szavaznak', true);
    await waitState(me, (s) => s.phase === 'verdict', 60000);
    check('a botok szavazataiból ítélet született', !!me.lastState.verdict);
    check('van büntetés/felmentés szöveg', typeof me.lastState.verdict.sentence === 'string');

    await fire(me, 'proceed_after_verdict');
    await waitState(me, (s) => s.phase === 'round_results');
    check('köreredmény megvan', Array.isArray(me.lastState.roundResults.scores));
    check('a botok is kaptak pontot', me.lastState.roundResults.scores.some((p) => p.isBot && p.score > 0));
    const caseNo1 = me.lastState.caseNo;
    await fire(me, 'next_round');
    log('  --  második kör indul');

    await waitState(me, (s) => s.caseNo !== caseNo1 && s.phase === 'accusation', 20000);
    check('a 2. kör új ügyiratszámmal indul', true);
    await waitState(me, (s) => s.phase === 'prep', 20000);
    check('a bot a 2. körben is felolvas (vagy mi olvastuk fel)', true);
    await waitState(me, (s) => s.phase === 'prosecution', 20000);
    await waitState(me, (s) => s.phase === 'verdict_vote', 180000);
    check('a 2. kör eljut a szavazásig', true);
    await waitState(me, (s) => s.phase === 'verdict', 60000);
    check('a 2. körben is született ítélet', !!me.lastState.verdict);
    await fire(me, 'proceed_after_verdict');
    await waitState(me, (s) => s.phase === 'round_results');
    await fire(me, 'next_round');
    await waitState(me, (s) => s.phase === 'game_over', 20000);
    check('2 kör után végeredmény (botokkal is)', Array.isArray(me.lastState.gameOver.ranking));
    check('van díj', !!me.lastState.gameOver.awards.bestLawyer);

    await sleep(800);
    const statsAfter = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    const botNames = Object.keys(statsAfter).filter((n) => n.includes('Robot') || n.includes('Géza') || n.includes('Sári') || n.includes('Károly'));
    check('a botok NEM kerültek a stats.json-be', botNames.length === 0);
    const added = Object.keys(statsAfter).filter((n) => !(n in statsBefore));
    check('csak emberi nevek íródtak újként: ' + JSON.stringify(added), added.every((n) => n === '2CORE'));

    await fire(me, 'new_game');
    await waitState(me, (s) => s.phase === 'lobby', 8000);
    await emit(me, 'remove_bot');
    check('bot eltávolítva', me.lastState.players.filter((p) => p.isBot).length === 3);

    clearInterval(me.autopilotTimer);
    me.disconnect();
  } catch (err) {
    failures++;
    log('TESZTI KIVÉTEL: ' + err.message);
  } finally {
    stopServer();
  }
  log('');
  log('==============================');
  log('Sikeres: ' + passes + ', hibás: ' + failures);
  log('==============================');
  finish(failures > 0 ? 1 : 0);
}

main();
