'use strict';

// ============================================================
// KAMU BÍRÓSÁG – játékmotor
// Minden állapot, időzítő és pontozás a szerveren fut.
// A tartalom a data/cards.json fájlból töltődik, játékmódok szerint.
// ============================================================

let CARDS;
try {
  CARDS = require('./data/cards.json');
} catch (e) {
  console.error('KRITIKUS: a data/cards.json nem olvasható (' + e.message + ') – a kártyák nélkül a szerver nem tud futni.');
  process.exit(1);
}
const { BotManager, BOT_NAMES, BOT_AVATAR } = require('./bots');

const PHASES = {
  LOBBY: 'lobby',
  ACCUSATION: 'accusation', // vádemelés – felolvasás
  PREP: 'prep', // felkészülés – titkos kártyák
  PROSECUTION: 'prosecution', // vádbeszéd (ügyész)
  DEFENSE: 'defense', // védekezés (vádlott)
  DEFENDER: 'defender', // védőügyvéd (5+ játékosnál)
  WITNESS: 'witness', // meglepetés tanú
  FINAL_PROSECUTION: 'final_prosecution', // zárószó ügyész
  FINAL_DEFENSE: 'final_defense', // zárószó vádlott
  VERDICT_VOTE: 'verdict_vote', // esküdtek szavaznak
  CHALLENGE_VOTE: 'challenge_vote', // kihívás-teljesítés szavazás (esküdtek mód)
  VERDICT: 'verdict', // ítélet kihirdetése
  CHALLENGE_REVIEW: 'challenge_review', // kihívás-ellenőrzés a bíróval (döntési fázis)
  ROUND_RESULTS: 'round_results', // kör végi összesítő
  GAME_OVER: 'game_over' // ranglista + díjak
};

const DEFAULT_SETTINGS = {
  speechSeconds: 60,
  defenderSeconds: 45,
  prepSeconds: 30,
  witnessSeconds: 30,
  closingSeconds: 20,
  rounds: 3,
  witnessEnabled: true,
  challengesEnabled: true,
  challengeMode: 'judge', // 'judge' = a bíró dönt, 'jury' = az esküdtek szavaznak
  modes: [], // kiválasztott játékmódok – start előtt KÖTELEZŐ (nincs csendes 'buli' visszaesés)
  customAccusations: []
};

// AFK-VÉDELEM: a "gombnyomásra váró" fázisoknak is van maximális ideje.
// Lejáratkor a hiányzó akciók alapértelmezett kimenettel teljesülnek, így egy
// AFK / kiesett játékos nem állítja le az egész estét.
const ACCUSATION_AUTO_MS = 2 * 60 * 1000;     // VÁDEMELÉS: senki nyomta meg a "Felolvastam!"-t → megy tovább
const VERDICT_VOTE_AUTO_MS = 3 * 60 * 1000;   // SZAVAZÁS: hiányzó esküdt-szavazatok → a leadott szavazatok döntenek
const CHALLENGE_VOTE_AUTO_MS = 2 * 60 * 1000; // KIHÍVÁS-SZAVAZÁS (esküdtek mód): hiányzó szavazatok → nem teljesített

// Az összes játékmód kulcsa a cards.json alapján.
const ALL_MODES = Object.keys(CARDS).filter((k) => k !== 'altalanos');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = 0; i < a.length - 1; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// Kártyapaklik: módonként keverve, elfogyáskor újrakeverve.
// ============================================================

const FALLBACK_CARD = '[üres pakli – vegyél fel kártyát a data/cards.json fájlba]';

class Deck {
  constructor(cards) {
    this.original = cards || [];
    this.pile = shuffle(this.original);
  }
  draw() {
    if (this.pile.length === 0) this.pile = shuffle(this.original); // újrakeverés
    return this.pile.pop() || FALLBACK_CARD; // üres pakli esetén sem crashelem a játékot
  }
  drawN(n) {
    return Array.from({ length: n }, () => this.draw());
  }
}

class Game {
  // A szerver állítja be: név szerint írja a bűnügyi nyilvántartásba a statisztikákat,
  // és minden state-küldés előtt meghívja a stateHookot (pl. stats rácsatolása).
  static setStatRecorder(fn) {
    Game._statRecorder = fn;
  }

  static setStateHook(fn) {
    Game._stateHook = fn;
  }

  static recordStat(name, key, by) {
    if (Game._statRecorder && name) Game._statRecorder(name, key, by);
  }
  /**
   * @param {string} code 4 betűs szobakód
   * @param {object} io Socket.io szerver
   */
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map(); // playerId -> {...}
    this.botManager = new BotManager(this);
    this.settings = { ...DEFAULT_SETTINGS };
    this.phase = PHASES.LOBBY;
    this.round = 0;
    this.roleHistory = new Map(); // playerId -> { defendant, prosecutor, defender }
    this.roundData = null;
    this.phaseTimer = null;
    this.phaseEndsAt = 0;
    this.objectionTimer = null;
    this.objectionPending = false;
    this.pausedKind = null;
    this.decks = null; // csak játék közben: { mód: { vadak, bizonyitekok, ... } }
    this.lastActivityAt = Date.now(); // a szobatakarítás (üzemeltetés) nézi
    this.awardsRecorded = false; // díjak egyszeri rögzítése (bug: broadcastnál duplázódott)
  }

  // ---------- játékos kezelés ----------

  addPlayer(playerId, name, avatar, isHost) {
    void BOT_AVATAR; // (a bot avatar a addBot-ban állítódik)
    const existing = this.players.get(playerId);
    if (existing) {
      existing.name = String(name || existing.name).slice(0, 20) || existing.name;
      if (avatar) existing.avatar = avatar;
      existing.connected = true;
      return existing;
    }
    const player = {
      id: playerId,
      name: String(name).slice(0, 20) || 'Névtelen',
      avatar: avatar || 'bírói kalap',
      isHost: !!isHost || this.players.size === 0,
      connected: true,
      score: 0,
      laughCount: 0,
      convictions: 0,
      challengesDone: 0
    };
    this.players.set(playerId, player);
    return player;
  }

  hostId() {
    for (const p of this.players.values()) if (p.isHost) return p.id;
    return null;
  }

  getPlayer(id) {
    return this.players.get(id);
  }

  // ---- Botok (teszteléshez) ----
  addBot() {
    const existing = new Set(Array.from(this.players.values()).map((p) => p.name));
    const name = BOT_NAMES.find((n) => !existing.has(n)) || ('Bot ' + (this.players.size + 1));
    const id = 'bot_' + Math.random().toString(36).slice(2, 9);
    const player = this.addPlayer(id, name, BOT_AVATAR, false);
    player.isBot = true;
    if (this.phase === PHASES.LOBBY) {
      this.broadcast();
    } else {
      this.broadcast();
      this.botManager.schedulePhaseActions();
    }
    return player;
  }

  removeBot() {
    const bot = Array.from(this.players.values()).reverse().find((p) => p.isBot);
    if (!bot) return false;
    if (this.phase === PHASES.LOBBY) {
      this.players.delete(bot.id);
      if (bot.isHost && this.players.size > 0) {
        Array.from(this.players.values())[0].isHost = true;
      }
    } else {
      this.handleDisconnect(bot.id);
    }
    this.broadcast();
    return true;
  }

  playerList() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isHost: p.isHost,
      connected: p.connected,
      score: p.score,
      profile: p.profile || null,
      isBot: !!p.isBot
    }));
  }

  activePlayers() {
    return Array.from(this.players.values()).filter((p) => p.connected);
  }

  eligiblePlayers() {
    return this.activePlayers();
  }

  // ---------- kártyapaklik összeállítása a kiválasztott módokból ----------

  buildDecks() {
    const modes = this.settings.modes || ['altalanos'];
    const decks = { altalanos: { kihivasok: new Deck(CARDS.altalanos.kihivasok), nehezitesek: new Deck(CARDS.altalanos.nehezitesek) } };
    for (const m of modes) {
      const src = CARDS[m];
      if (!src || m === 'altalanos') continue;
      decks[m] = {
        vadak: new Deck(src.vadak || []),
        bizonyitekok: new Deck(src.bizonyitekok || []),
        alibik: new Deck(src.alibik || []),
        trukkok: new Deck(src.trukkok || []),
        tanuk: new Deck(src.tanuk || []),
        kihivasok: new Deck(src.kihivasok || []),
        buntetesek: new Deck(src.buntetesek || [])
      };
    }
    return decks;
  }

  // A kör módja: ha több mód van kiválasztva (Vegyes), körönként sorsolunk.
  // SZIGORÚ: csak olyan mód sorsolható, amelyhez a cards.json-ben van pakli.
  // (Az üres listát a startGame már visszautasítja – ide elvileg el sem érhet.)
  roundMode() {
    const modes = (this.settings.modes || []).filter((m) => CARDS[m] && m !== 'altalanos');
    if (modes.length === 0) {
      console.error('roundMode: nincs érvényesen kiválasztott játékmód!', this.settings.modes);
      return ALL_MODES.find((m) => CARDS[m]) || 'buli';
    }
    return pick(modes);
  }

  // ---------- állapot küldése ----------

  publicState(forId) {
    const me = this.players.get(forId) || null;
    const d = this.roundData;
    const base = {
      phase: this.phase,
      round: this.round,
      totalRounds: this.settings.rounds,
      players: this.playerList(),
      settings: { ...this.settings },
      modes: ALL_MODES.map((k) => ({ key: k, name: CARDS[k].nev })),
      hostId: this.hostId(),
      serverNow: Date.now(),
      phaseEndsAt: this.phaseEndsAt || null,
      objectionPending: this.objectionPending
    };

    if (this.phase === PHASES.GAME_OVER) base.gameOver = this.finalResults();
    if (!d) return base;

    base.caseNo = d.caseNo;
    base.modeName = CARDS[d.mode] ? CARDS[d.mode].nev : d.mode;
    base.defendantId = d.defendantId;
    base.prosecutorId = d.prosecutorId;
    if (d.defenderId) base.defenderId = d.defenderId;
    base.accusationText = d.accusationText;
    base.isCustom = !!d.isCustomAccusation; // házigazdai saját vád → "SAJÁT" jelölés a felületen

    // Titkos információk: csak a tulajdonosa látja őket.
    if (me && me.id === d.prosecutorId) base.evidence = d.evidence;
    if (me && me.id === d.defendantId) base.alibi = d.alibi;
    if (me && d.defenderId && me.id === d.defenderId) base.tricks = d.tricks;

    if (d.witnessId) base.witnessId = d.witnessId;
    if (me && d.witnessId && me.id === d.witnessId) base.witnessCard = d.witnessCard;

    // A saját titkos kihívás a beszéd fázisaiban látszik.
    const myCh = (me && Array.isArray(d.challenges)) ? d.challenges.find((c) => c.id === me.id) : null;
    const speechPhases = [PHASES.PROSECUTION, PHASES.DEFENSE, PHASES.DEFENDER, PHASES.FINAL_PROSECUTION, PHASES.FINAL_DEFENSE];
    if (myCh && speechPhases.includes(this.phase)) {
      base.myChallenge = myCh.text;
      base.myChallengeDifficulty = myCh.difficulty;
    }

    // ---- Kihívás-ellenőrzés bíróval ----
    // A bíró a kihívást az ELEJÉTŐL látja (FIGYELD-lista + "Most figyeld" sáv),
    // a kihívás szövege a tulajdonoson és a bírón kívül senkinek nem megy ki.
    const judgeFor = (ch) => d.challengeJudges[ch.who];
    const isJudgeNow = me && Array.isArray(d.challenges) && d.challenges.some((ch) => judgeFor(ch) === me.id);
    if (isJudgeNow && Array.isArray(d.challenges)) {
      base.judgeWatch = d.challenges.map((ch) => ({
        who: ch.who,
        id: ch.id,
        name: this.players.get(ch.id) ? this.players.get(ch.id).name : '?',
        text: ch.text,
        difficulty: !!ch.difficulty
      }));
      base.judgeNotes = d.judgeNotes || {};
      // "Most figyeld" sáv: az ÉPPEN BESZÉLŐ kihívása.
      const inSpeech = [
        PHASES.PROSECUTION, PHASES.DEFENSE, PHASES.DEFENDER,
        PHASES.FINAL_PROSECUTION, PHASES.FINAL_DEFENSE
      ].includes(this.phase);
      const speakingCh = inSpeech
        ? d.challenges.find((ch) => {
          const spId = { prosecutor: d.prosecutorId, defendant: d.defendantId, defender: d.defenderId }[ch.who];
          if (ch.who === 'prosecutor') return this.phase === PHASES.PROSECUTION || this.phase === PHASES.FINAL_PROSECUTION;
          if (ch.who === 'defendant') return this.phase === PHASES.DEFENSE || this.phase === PHASES.FINAL_DEFENSE;
          if (ch.who === 'defender') return this.phase === PHASES.DEFENDER;
          void spId;
          return false;
        })
        : null;
      if (speakingCh) base.watchNow = { who: speakingCh.who, text: speakingCh.text, difficulty: !!speakingCh.difficulty };
    }

    // Kihívás-szavazás (esküdtek mód).
    if (this.phase === PHASES.CHALLENGE_VOTE && this.settings.challengesEnabled) {
      base.challengeVote = {
        challenges: d.challenges.map((c) => ({
          who: c.who, // 'prosecutor' | 'defendant' | 'defender'
          text: c.text,
          difficulty: !!c.difficulty
        })),
        canVote: me ? d.challengeVoters.includes(me.id) : false,
        myVotes: me && d.challengeVotes[me.id] ? d.challengeVotes[me.id] : null,
        counts: d.challenges.reduce((acc, c) => {
          acc[c.who] = Object.values(d.challengeVotes).filter((v) => v[c.who] !== undefined).length;
          return acc;
        }, {}),
        voterCount: d.challengeVoters.length
      };
    }

    // KIHÍVÁS-ELLENŐRZÉS képernyő (bíró dönt – zárószavak és ítélet után).
    if (this.phase === PHASES.CHALLENGE_REVIEW && this.settings.challengesEnabled) {
      base.challengeReview = {
        challenges: d.challenges.map((c) => ({
          who: c.who,
          id: c.id,
          name: this.players.get(c.id) ? this.players.get(c.id).name : '?',
          text: c.text,
          difficulty: !!c.difficulty,
          judged: d.challengeDecisions[c.who] !== undefined,
          done: d.challengeDecisions[c.who] === true,
          noted: !!(d.judgeNotes && d.judgeNotes[c.who]),
          funYes: Object.values(d.funVotes || {}).filter((v) => v[c.who] === true).length,
          funNo: Object.values(d.funVotes || {}).filter((v) => v[c.who] === false).length,
          judgeName: this.players.get(judgeFor(c)) ? this.players.get(judgeFor(c)).name : '?',
          iAmJudge: me ? judgeFor(c) === me.id : false
        })),
        current: (d.reviewIdx || 0),
        total: d.challenges.length
      };
    }

    if (this.phase === PHASES.VERDICT_VOTE) {
      // A védőügyvéd (ha van) ITT NEM szavaz – ő a védelem része.
      const votersNow = d.defenderId ? d.voters.filter((v) => v !== d.defenderId) : d.voters;
      base.verdictVote = {
        canVote: me ? votersNow.includes(me.id) : false,
        myVote: me && d.votes[me.id] ? d.votes[me.id].verdict : null,
        votedCount: Object.keys(d.votes).length,
        voterCount: votersNow.length
      };
    }

    if (this.phase === PHASES.VERDICT) base.verdict = d.verdictResult;
    if (this.phase === PHASES.ROUND_RESULTS) base.roundResults = d.roundResults;

    return base;
  }

  broadcast() {
    this.lastActivityAt = Date.now(); // minden state-tevékenység frissíti a takarításhoz
    if (Game._stateHook) {
      try { Game._stateHook(this); } catch (e) { /* nem kritikus */ }
    }
    for (const id of this.players.keys()) {
      this.io.to('p:' + id).emit('state', this.publicState(id));
    }
  }

  broadcastAll(event, payload) {
    this.io.emit(event, payload);
  }

  // ---------- fázisvezérlés ----------

  setPhase(phase, durationMs, onEnd) {
    clearTimeout(this.phaseTimer);
    this.phase = phase;
    if (durationMs && onEnd) {
      this.phaseEndsAt = Date.now() + durationMs;
      this.phaseTimer = setTimeout(() => {
        try {
          onEnd();
        } catch (err) {
          console.error('Phase timer error:', err);
        }
      }, durationMs);
    } else {
      this.phaseEndsAt = 0;
    }
    if (this.botManager) this.botManager.schedulePhaseActions();
    this.broadcast();
  }

  startGame(settingsPatch, byId) {
    if (this.phase !== PHASES.LOBBY) return;
    if (this.hostId() !== byId) return;
    if (this.eligiblePlayers().length < 3) return;
    this.awardsRecorded = false; // a díjakat a game_over-ben EGYSZER rögzítjük
    if (settingsPatch) {
      const merged = { ...this.settings, ...settingsPatch };
      // A saját vádak is jöhetnek a start-patch-csel (a start gomb a teljes beállítást küldi).
      if (!Array.isArray(settingsPatch.customAccusations)) merged.customAccusations = this.settings.customAccusations;
      this.settings = merged;
    }
    // Csak olyan módok maradhatnak, amelyekhez VAN pakli a cards.json-ben.
    // (Ehhez kártya kell: vád, bizonyíték, alibi, büntetés.)
    const hasDeck = (m) => !!(CARDS[m] && !m.startsWith('_') && (CARDS[m].vadak || CARDS[m].bizonyitekok || CARDS[m].alibik || CARDS[m].buntetesek));
    this.settings.modes = (Array.isArray(this.settings.modes) ? this.settings.modes : [])
      .filter((m) => hasDeck(m));
    // Ha egyetlen érvényes mód sincs: házigazdai figyelmeztetés, nincs crash.
    if (this.settings.modes.length === 0) {
      this.broadcastAll('host_warning', { message: '⚠️ Válassz egy ügyiratmappát (játékmódot) a TÁRGYALÁS MEGKEZDÉSE előtt!' });
      return false;
    }
    this.round = 0;
    this.roleHistory = new Map();
    this.decks = this.buildDecks(); // kártyapaklik a kiválasztott módokból
    for (const p of this.players.values()) {
      p.score = 0;
      p.laughCount = 0;
      p.convictions = 0;
      p.challengesDone = 0;
    }
    this.nextRound();
  }

  // Szerepek körbeforgatása: mindenki legalább egyszer legyen vádlott és egyszer ügyész.
  pickRoles() {
    const actives = this.activePlayers().map((p) => p.id);
    const history = (id) => this.roleHistory.get(id) || { defendant: 0, prosecutor: 0, defender: 0 };
    const minDef = Math.min(...actives.map((id) => history(id).defendant));
    const defendantId = pick(actives.filter((id) => history(id).defendant === minDef));

    const prosCandidates = actives.filter((id) => id !== defendantId);
    const minPros = Math.min(...prosCandidates.map((id) => history(id).prosecutor));
    const prosecutorId = pick(prosCandidates.filter((id) => history(id).prosecutor === minPros));

    // Védőügyvéd: 5 vagy több játékosnál, a harmadik legrégebben
    // kirendelt "ügyvédi" szereplő közül.
    let defenderId = null;
    if (actives.length >= 5) {
      const defCandidates = actives.filter((id) => id !== defendantId && id !== prosecutorId);
      const minD = Math.min(...defCandidates.map((id) => history(id).defender));
      defenderId = pick(defCandidates.filter((id) => history(id).defender === minD));
    }

    this.roleHistory.set(defendantId, { ...history(defendantId), defendant: history(defendantId).defendant + 1 });
    this.roleHistory.set(prosecutorId, { ...history(prosecutorId), prosecutor: history(prosecutorId).prosecutor + 1 });
    if (defenderId) {
      this.roleHistory.set(defenderId, { ...history(defenderId), defender: history(defenderId).defender + 1 });
    }
    return { defendantId, prosecutorId, defenderId };
  }

  nextRound() {
    this.clearTimers();
    const actives = this.activePlayers();
    if (actives.length < 3) {
      this.phase = PHASES.LOBBY;
      this.roundData = null;
      this.broadcast();
      return;
    }
    if (this.round >= this.settings.rounds) {
      this.phase = PHASES.GAME_OVER;
      this.roundData = null;
      this.broadcast();
      return;
    }
    this.round += 1;

    const mode = this.roundMode();
    // SZIGORÚ pakliválasztás: a kör MINDEN kártyája a kör módjának paklijából jön.
    // (A startGame már csak paklival rendelkező módot enged be, ezért ez mindig létezik;
    // tartalék csak biztonsági háló, hangos naplózással.)
    let decks = this.decks[mode];
    if (!decks) {
      console.error('nextRound: a(z) "' + mode + '" módhoz nincs pakli – tartalék pakli lép helyette!');
      decks = Object.values(this.decks).find((dk) => dk && dk.vadak);
    }
    const common = this.decks.altalanos;    const { defendantId, prosecutorId, defenderId } = this.pickRoles();
    const others = actives.filter((p) => p.id !== defendantId && p.id !== prosecutorId && p.id !== defenderId);
    const nameOf = (id) => (this.players.get(id) ? this.players.get(id).name : 'Ismeretlen');

    // Vád a mód paklijából; egyedi (házigazdai) vádak is keverhetők – ezek "SAJÁT" jelölést kapnak.
    const custom = this.settings.customAccusations || [];
    let template;
    let isCustom = false;
    if (custom.length > 0 && Math.random() < 0.4) {
      template = pick(custom);
      isCustom = true;
    } else {
      template = decks.vadak.draw();
    }

    // [vádlott] -> a vádlott neve; [játékos] -> véletlen MÁSIK játékos (sosem a vádlott).
    const otherPlayers = actives.filter((p) => p.id !== defendantId);
    // Helyőrzők: [vádlott]/[játékos] (ajánlott); a régi {N}/{M} is működik.
    const accText = template
      .replaceAll('[vádlott]', '{N}')
      .replaceAll('[játékos]', '{M}')
      .replaceAll('{N}', nameOf(defendantId))
      .replaceAll('{M}', nameOf(pick(otherPlayers).id));
    const accusationText = accText;

    this.roundData = {
      caseNo: 'B.' + Math.floor(1000 + Math.random() * 9000) + '/' + (new Date().getFullYear() - 2000),
      mode,
      defendantId,
      prosecutorId,
      defenderId,
      accusationText,
      isCustomAccusation: isCustom,
      evidence: decks.bizonyitekok.drawN(3),
      alibi: decks.alibik.draw(),
      tricks: defenderId ? decks.trukkok.drawN(2) : null,
      witnessId: null,
      witnessCard: null,
      challenges: [],
      votes: {},
      // A védőügyvéd nem esküdt: nem szavaz ítéletet (de a kihívás-szavazásban ott van).
      voters: others.filter((p) => p.id !== defenderId).map((p) => p.id),
      challengeVoters: others.map((p) => p.id),
      challengeVotes: {},
      challengeJudges: {}, // kihívásonként: ki a bíró (who -> playerId)
      judgeNotes: {}, // a bíró "Észrevettem ✓" emlékeztetői (who -> true)
      challengeDecisions: {}, // bírói döntések (who -> bool)
      funVotes: {}, // 😂/👎 szórakoztató szavazatok (playerId -> {who -> bool})
      objections: {},
      laughs: { prosecutor: 0, defendant: 0 }
    };

    // Kihívások: minden szónok kap egyet (mód kihívásai + általános keverve).
    if (this.settings.challengesEnabled) {
      const speakers = [
        { who: 'prosecutor', id: prosecutorId },
        { who: 'defendant', id: defendantId },
        { who: 'defender', id: defenderId }
      ];
      for (const sp of speakers) {
        if (!sp.id) continue;
        // 20% eséllyel nehezítés: ritkábban jön, dupla pontot ér.
        const difficulty = Math.random() < 0.2;
        const text = difficulty
          ? common.nehezitesek.draw()
          : (Math.random() < 0.5 ? decks.kihivasok.draw() : common.kihivasok.draw());
        this.roundData.challenges.push({ who: sp.who, id: sp.id, text, difficulty });
      }
      // ---- Kihívás-ellenőrzés bíróval: ki a bíró? ----
      // Alapeset a házigazda ("A TÁRGYALÁS VEZETŐJE"). Ha ő maga kihívást kapó
      // szónok, akkor az adott ügyben egy véletlen, nem beszélő esküdt dönt.
      const hostId = this.hostId();
      const dRound = this.roundData;
      for (const ch of dRound.challenges) {
        if (ch.id === hostId) {
          const nonSpeakers = dRound.voters.filter((id) => !dRound.challenges.some((c2) => c2.id === id));
          dRound.challengeJudges[ch.who] = nonSpeakers.length > 0
            ? pick(nonSpeakers)
            : (hostId); // nem volt más: maradjon a házigazda
        } else {
          dRound.challengeJudges[ch.who] = hostId;
        }
      }
    }

    this.setPhase(PHASES.ACCUSATION, ACCUSATION_AUTO_MS, () => this.accusationRead());
  }

  // ---------- tárgyalási fázisok ----------

  // A "Felolvastam!" gomb léptet tovább – vagy az AFK-időzítő (ACCUSATION_AUTO_MS).
  accusationRead() {
    if (this.phase !== PHASES.ACCUSATION) return;
    this.setPhase(PHASES.PREP, this.settings.prepSeconds * 1000, () => this.startSpeech('prosecution'));
  }

  speechSecondsFor(kind) {
    if (kind === 'defender') return this.settings.defenderSeconds;
    return this.settings.speechSeconds;
  }

  startSpeech(kind) {
    this.runSpeech(kind, this.speechSecondsFor(kind) * 1000);
  }

  runSpeech(kind, durationMs) {
    const phase = kind === 'prosecution' ? PHASES.PROSECUTION
      : kind === 'defense' ? PHASES.DEFENSE
        : kind === 'defender' ? PHASES.DEFENDER
          : kind === 'final_prosecution' ? PHASES.FINAL_PROSECUTION
            : PHASES.FINAL_DEFENSE;
    const onEnd = () => (kind.startsWith('final') ? this.afterClosing(kind) : this.afterSpeech(kind));
    this.setPhase(phase, Math.max(durationMs, 1000), onEnd);
  }

  doneSpeaking(byId) {
    const d = this.roundData;
    if (!d || this.objectionPending) return;
    // A tanú is befejezheti a vallomást.
    if (this.phase === PHASES.WITNESS && d.witnessId && byId === d.witnessId) {
      this.runClosing('final_prosecution');
      return;
    }
    const map = {
      [PHASES.PROSECUTION]: { id: d.prosecutorId, kind: 'prosecution' },
      [PHASES.DEFENSE]: { id: d.defendantId, kind: 'defense' },
      [PHASES.DEFENDER]: { id: d.defenderId, kind: 'defender' },
      [PHASES.FINAL_PROSECUTION]: { id: d.prosecutorId, kind: 'final_prosecution' },
      [PHASES.FINAL_DEFENSE]: { id: d.defendantId, kind: 'final_defense' }
    };
    const m = map[this.phase];
    if (!m) return;
    if (m.id === byId) {
      if (m.kind.startsWith('final')) this.afterClosing(m.kind);
      else this.afterSpeech(m.kind);
    }
  }

  afterSpeech(kind) {
    const d = this.roundData;
    if (!d) return;
    if (kind === 'prosecution') {
      this.runSpeech('defense', this.speechSecondsFor('defense') * 1000);
    } else if (kind === 'defense') {
      if (d.defenderId) {
        this.runSpeech('defender', this.speechSecondsFor('defender') * 1000);
      } else {
        this.afterDefender();
      }
    } else if (kind === 'defender') {
      this.afterDefender();
    }
  }

  afterDefender() {
    const d = this.roundData;
    if (!d) return;
    const witnessPool = d.voters; // a védőügyvéd tanú sem lehet (ő a védelem része)
    if (this.settings.witnessEnabled && witnessPool.length > 0) {
      const witnessId = pick(witnessPool);
      d.witnessId = witnessId;
      d.witnessCard = this.decks[d.mode].tanuk.draw();
      this.setPhase(PHASES.WITNESS, this.settings.witnessSeconds * 1000, () => this.runClosing('final_prosecution'));
    } else {
      this.runClosing('final_prosecution');
    }
  }

  runClosing(kind) {
    const phase = kind === 'final_prosecution' ? PHASES.FINAL_PROSECUTION : PHASES.FINAL_DEFENSE;
    this.setPhase(phase, this.settings.closingSeconds * 1000, () => this.afterClosing(kind));
  }

  afterClosing(kind) {
    if (kind === 'final_prosecution') {
      this.runClosing('final_defense');
    } else {
      this.startVerdictVote();
    }
  }

  // ---------- szavazás ----------

  startVerdictVote() {
    const d = this.roundData;
    if (!d) return;
    d.votes = {};
    // AFK-VÉDELEM: a szavazásnak is van maximuma – lejáratkor a LEADOTT szavazatok
    // döntenek (a hiányzókat nem számoljuk), így egy kiesett játékos nem fagyasztja be a kört.
    this.setPhase(PHASES.VERDICT_VOTE, VERDICT_VOTE_AUTO_MS, () => this.finishVerdictVote());
    this.checkVerdictVotesComplete();
  }

  castVerdictVote(byId, verdict) {
    const d = this.roundData;
    if (this.phase !== PHASES.VERDICT_VOTE || !d) return false;
    if (!d.voters.includes(byId)) return false;
    if (verdict !== 'guilty' && verdict !== 'not_guilty') return false;
    if (this.players.get(byId) && this.players.get(byId).isBot && this.players.get(byId).name) {
      void 0; // bot-szavazat: nem megy a nyilvántartásba (a vádlott számai számítanak)
    }
    d.votes[byId] = { verdict };
    this.broadcast();
    this.checkVerdictVotesComplete();
    return true;
  }

  checkVerdictVotesComplete() {
    const d = this.roundData;
    if (!d || this.phase !== PHASES.VERDICT_VOTE) return;
    const activeVoters = d.voters.filter((v) => this.players.has(v) && this.players.get(v).connected);
    if (activeVoters.length > 0 && activeVoters.every((v) => d.votes[v])) {
      setTimeout(() => this.finishVerdictVote(), 1500);
    }
  }

  finishVerdictVote() {
    const d = this.roundData;
    if (!d || this.phase !== PHASES.VERDICT_VOTE) return;
    if (this.settings.challengesEnabled && d.challenges.length > 0 && this.settings.challengeMode !== 'judge') {
      // Esküdtek mód: szavazás az ítélet előtt (AFK-időzítővel: hiányzó szavazat = nem teljesített).
      d.challengeVotes = {};
      this.setPhase(PHASES.CHALLENGE_VOTE, CHALLENGE_VOTE_AUTO_MS, () => this.revealVerdict());
      this.checkChallengeVotesComplete();
    } else {
      // Bíró módban az ellenőrzés az ÍTÉLET UTÁN jön (proceedAfterVerdict).
      this.revealVerdict();
    }
  }

  // ---------- kihívás-ellenőrzés a bíróval ----------

  startChallengeReview() {
    const d = this.roundData;
    if (!d) return;
    d.reviewIdx = 0;
    d.challengeDecisions = {};
    d.judgeNotes = d.judgeNotes || {};
    this.setPhase(PHASES.CHALLENGE_REVIEW, 20000, () => this.autoFailCurrentChallenge());
  }

  currentChallenge() {
    const d = this.roundData;
    if (!d) return null;
    return d.challenges[d.reviewIdx] || null;
  }

  // Időkorlát lejárta: "NEM SIKERÜLT" az alapértelmezett, jön a következő kártya.
  autoFailCurrentChallenge() {
    const d = this.roundData;
    if (!d || this.phase !== PHASES.CHALLENGE_REVIEW) return;
    const ch = this.currentChallenge();
    if (ch && d.challengeDecisions[ch.who] === undefined) {
      d.challengeDecisions[ch.who] = false;
    }
    this.advanceChallengeReview();
  }

  advanceChallengeReview() {
    const d = this.roundData;
    if (!d) return;
    d.reviewIdx = (d.reviewIdx || 0) + 1;
    if (d.reviewIdx >= d.challenges.length) {
      d.reviewDone = true;
      this.applyChallengeBonus();
      this.buildRoundResults();
      this.setPhase(PHASES.ROUND_RESULTS, 0, null);
    } else {
      this.setPhase(PHASES.CHALLENGE_REVIEW, 20000, () => this.autoFailCurrentChallenge());
    }
  }

  // Az ellenőrzés végén kerül sor a kihívás-pontozásra (+2 / nehezítés +4),
  // és ekkor kerül a jegyzőkönyvbe a bírói döntés ("bíró: név").
  applyChallengeBonus() {
    const d = this.roundData;
    if (!d || !Array.isArray(d.challenges)) return;
    const results = [];
    for (const ch of d.challenges) {
      const done = d.challengeDecisions[ch.who] === true;
      const pts = ch.difficulty ? 4 : 2;
      if (done) {
        const p = this.players.get(ch.id);
        if (p) {
          p.score += pts;
          p.challengesDone += 1;
        }
      }
      const judgePlayer = d.challengeJudges[ch.who] ? this.players.get(d.challengeJudges[ch.who]) : null;
      results.push({
        who: ch.who,
        id: ch.id,
        name: this.players.get(ch.id) ? this.players.get(ch.id).name : '?',
        text: ch.text,
        difficulty: !!ch.difficulty,
        yes: 0,
        voterCount: 0,
        done,
        points: pts,
        mode: 'judge',
        judgeName: judgePlayer ? judgePlayer.name : null
      });
    }
    if (d.verdictResult) d.verdictResult.challengeResults = results;
    return results;
  }

  // A bíró döntése (who: 'prosecutor'|'defendant'|'defender', done: bool).
  // SZERVERI ELLENŐRZÉS: csak az adott ügy bírója dönthet!
  resolveChallenge(refereeId, who, done) {
    const d = this.roundData;
    if (!d || this.phase !== PHASES.CHALLENGE_REVIEW) return false;
    const ch = d.challenges.find((c) => c.who === who);
    if (!ch) return false;
    if (d.challengeDecisions[who] !== undefined) return false; // már eldöntve
    if (d.challengeJudges[who] !== refereeId) return false; // nem te vagy az ügy bírója
    d.challengeDecisions[who] = !!done;
    this.broadcast();
    setTimeout(() => this.advanceChallengeReview(), 1200);
    return true;
  }

  // A bíró "Észrevettem ✓" emlékeztetője beszéd közben (nem döntés!).
  judgeNote(byId, who) {
    const d = this.roundData;
    if (!d) return false;
    const ch = d.challenges.find((c) => c.who === who);
    if (!ch) return false;
    if (d.challengeJudges[who] !== byId) return false;
    d.judgeNotes[who] = !d.judgeNotes[who]; // toggle
    this.broadcast();
    return true;
  }

  // A többiek 😂/👎 reakciója a kihívásra – SZÓRAKOZTATÁS, pontot nem ad.
  funChallengeVote(byId, who, done) {
    const d = this.roundData;
    if (!d) return false;
    if (!d.challenges.some((c) => c.who === who)) return false;
    if (!d.funVotes[byId]) d.funVotes[byId] = {};
    d.funVotes[byId][who] = !!done;
    this.broadcast();
    return true;
  }

  castChallengeVote(byId, who, done) {
    const d = this.roundData;
    if (this.phase !== PHASES.CHALLENGE_VOTE || !d) return false;
    if (!d.challengeVoters.includes(byId)) return false;
    const ch = d.challenges.find((c) => c.who === who);
    if (!ch) return false;
    if (!d.challengeVotes[byId]) d.challengeVotes[byId] = {};
    d.challengeVotes[byId][who] = !!done;
    this.broadcast();
    this.checkChallengeVotesComplete();
    return true;
  }

  checkChallengeVotesComplete() {
    const d = this.roundData;
    if (!d || this.phase !== PHASES.CHALLENGE_VOTE) return;
    const voters = d.challengeVoters.filter((v) => this.players.has(v) && this.players.get(v).connected);
    const complete = voters.length > 0 && voters.every((v) =>
      d.challenges.every((c) => d.challengeVotes[v] && d.challengeVotes[v][c.who] !== undefined));
    if (complete) setTimeout(() => this.revealVerdict(), 800);
  }

  revealVerdict() {
    const d = this.roundData;
    if (!d || this.phase === PHASES.VERDICT || this.phase === PHASES.ROUND_RESULTS) return;
    this.clearTimers();

    const guiltyVotes = d.voters.filter((v) => d.votes[v] && d.votes[v].verdict === 'guilty').length;
    const notGuiltyVotes = d.voters.filter((v) => d.votes[v] && d.votes[v].verdict === 'not_guilty').length;
    const guilty = guiltyVotes > notGuiltyVotes;
    const unanimous = d.voters.length > 0 && (guiltyVotes === d.voters.length || notGuiltyVotes === d.voters.length);

    // ---- pontozás ----
    const defendant = this.players.get(d.defendantId);
    const prosecutor = this.players.get(d.prosecutorId);
    const defender = d.defenderId ? this.players.get(d.defenderId) : null;
    if (guilty) {
      if (prosecutor) prosecutor.score += guiltyVotes;
      if (defendant) defendant.convictions += 1;
    } else {
      if (defendant) defendant.score += notGuiltyVotes;
      if (defender) defender.score += notGuiltyVotes; // védőügyvéd is pontot kap
    }
    if (unanimous && (guilty ? prosecutor : defendant)) {
      (guilty ? prosecutor : defendant).score += 1; // EGYHANGÚ bónusz
    }

    // kihívás bónusz – ESKÜDTEK MÓD: a szavazatok többsége dönt.
    // (Bíró módban a pontozás a KIHÍVÁS-ELLENŐRZÉS után fut: applyChallengeBonus.)
    let challengeResults = null;
    if (this.settings.challengesEnabled && d.challenges.length > 0 && this.settings.challengeMode !== 'judge') {
      const voters = d.challengeVoters.filter((v) => this.players.has(v) && this.players.get(v).connected);
      const doneFor = (who) => {
        const yes = voters.reduce((acc, v) => acc + ((d.challengeVotes[v] && d.challengeVotes[v][who]) ? 1 : 0), 0);
        return { yes, done: voters.length > 0 && yes * 2 > voters.length };
      };
      challengeResults = [];
      for (const ch of d.challenges) {
        const { yes, done } = doneFor(ch.who);
        if (done) {
          const p = this.players.get(ch.id);
          const pts = ch.difficulty ? 4 : 2;
          if (p) {
            p.score += pts;
            p.challengesDone += 1;
          }
        }
        challengeResults.push({
          who: ch.who,
          text: ch.text,
          difficulty: !!ch.difficulty,
          yes,
          voterCount: voters.length,
          done,
          points: ch.difficulty ? 4 : 2
        });
      }
    }

    // vicces büntetés vagy felmentő szöveg a MÓD paklijából
    let sentence;
    if (guilty) {
      sentence = this.decks[d.mode].buntetesek.draw();
    } else {
      sentence = this.decks[d.mode].buntetesek.draw();
    }

    d.verdictResult = {
      guilty,
      unanimous,
      guiltyVotes,
      notGuiltyVotes,
      sentence,
      challengeResults,
      defenderVote: defender ? { voterName: defender.name, verdict: d.votes[defender.id] ? d.votes[defender.id].verdict : null } : null,
      votes: d.voters.filter((v) => v !== d.defenderId).map((v) => ({
        voterId: v,
        voterName: this.players.get(v) ? this.players.get(v).name : '?',
        verdict: d.votes[v] ? d.votes[v].verdict : null
      }))
    };

    // Bűnügyi nyilvántartás: a vádlott számai (név szerint tartósan).
    // Botok nem kerülnek be a nyilvántartásba.
    if (defendant && !defendant.isBot) {
      Game.recordStat(defendant.name, 'vadlott');
      Game.recordStat(defendant.name, guilty ? 'bunos' : 'artatlan');
    }

    this.setPhase(PHASES.VERDICT, 0, null);
  }

  proceedAfterVerdict() {
    const d = this.roundData;
    if (!d || this.phase !== PHASES.VERDICT) return;
    // Bíró mód + van kihívás: az ÍTÉLET UTÁN jön a KIHÍVÁS-ELLENŐRZÉS,
    // a büntetés/összesítő előtt.
    if (this.settings.challengesEnabled && this.settings.challengeMode === 'judge' &&
        d.challenges.length > 0 && !d.reviewDone) {
      this.startChallengeReview();
      return;
    }
    this.buildRoundResults();
    this.setPhase(PHASES.ROUND_RESULTS, 0, null);
  }

  buildRoundResults() {
    const d = this.roundData;
    if (!d) return;

    const prosecutor = this.players.get(d.prosecutorId);
    const defendant = this.players.get(d.defendantId);
    if (prosecutor) prosecutor.laughCount += d.laughs.prosecutor;
    if (defendant) defendant.laughCount += d.laughs.defendant;

    let favorite = null;
    if (d.laughs.prosecutor > 0 || d.laughs.defendant > 0) {
      if (d.laughs.prosecutor > d.laughs.defendant && prosecutor) {
        favorite = { playerId: prosecutor.id, name: prosecutor.name, laughs: d.laughs.prosecutor };
      } else if (d.laughs.defendant > d.laughs.prosecutor && defendant) {
        favorite = { playerId: defendant.id, name: defendant.name, laughs: d.laughs.defendant };
      }
    }
    if (favorite) this.players.get(favorite.playerId).score += 1;

    d.roundResults = {
      verdict: d.verdictResult,
      favorite,
      scores: this.playerList().sort((a, b) => b.score - a.score),
      nextRound: this.round + 1,
      hasNextRound: this.round < this.settings.rounds
    };
  }

  nextAfterResults(byId) {
    if (this.phase !== PHASES.ROUND_RESULTS) return;
    if (this.hostId() !== byId) return;
    this.nextRound();
  }

  finalResults() {
    const players = this.playerList().sort((a, b) => b.score - a.score);
    const all = Array.from(this.players.values());
    const by = (key) => all.slice().sort((a, b) => b[key] - a[key])[0];
    const award = (p, key, name, emoji) =>
      p && p[key] > 0 ? { playerId: p.id, name: p.name, value: p[key], award: name, emoji } : null;
    const awards = {
      bestLawyer: award(players[0], 'score', 'A legjobb ügyvéd', '⚖️'),
      biggestCriminal: award(by('convictions'), 'convictions', 'A legnagyobb bűnöző', '🦹'),
      audienceFavorite: award(by('laughCount'), 'laughCount', 'Közönségkedvenc', '😂'),
      challengeChampion: award(by('challengesDone'), 'challengesDone', 'Kihívás bajnok', '🎭')
    };
    // Díjak bejegyzése a nyilvántartásba (botok nem kerülnek be).
    // HIBAJAVÍTÁS: ez a metódus a game_over fázis MINDEN state-kérésénél
    // lefut, ezért a díjak korábban sokszorosan beíródtak. Az awardsRecorded
    // zászlóval csak az ELSŐ hívás rögzít.
    if (!this.awardsRecorded) {
      this.awardsRecorded = true;
      for (const a of Object.values(awards)) {
        const p = a && this.players.get(a.playerId);
        if (a && p && !p.isBot) Game.recordStat(a.name, 'dijak');
      }
    }
    return { ranking: players, awards };
  }

  // ---------- TILTAKOZOM! ----------

  tryObjection(byId) {
    const d = this.roundData;
    if (!d || this.objectionPending) return false;
    const kind = {
      [PHASES.PROSECUTION]: 'prosecution',
      [PHASES.DEFENSE]: 'defense',
      [PHASES.DEFENDER]: 'defender',
      [PHASES.FINAL_PROSECUTION]: 'final_prosecution',
      [PHASES.FINAL_DEFENSE]: 'final_defense'
    }[this.phase];
    if (!kind) return false;

    const sideOf = (k) => (k === 'prosecution' || k === 'final_prosecution' ? 'pros' : 'def');
    const speakerSide = sideOf(kind);
    const objector = this.players.get(byId);
    if (!objector) return false;

    // Az ellenfél fél tiltakozhat: ügyész oldal a védő(oldal) ellen és fordítva.
    // A védőügyvéd a vádlott oldalához tartozik; az ügyész tiltakozhat ellenük,
    // és a vádlott/védőügyvéd az ügyész ellen.
    let allowed = false;
    if (speakerSide === 'pros') {
      allowed = (byId === d.defendantId || byId === d.defenderId);
    } else {
      allowed = (byId === d.prosecutorId);
    }
    if (!allowed) return false;

    const key = this.phase + ':' + byId;
    if ((d.objections[key] || 0) >= 1) return false;
    d.objections[key] = 1;

    const remaining = this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - Date.now()) : 1000;
    clearTimeout(this.phaseTimer);
    this.phaseEndsAt = 0;
    this.objectionPending = true;
    this.pausedKind = { kind, remaining };

    try {
      this.broadcastAll('objection_started', { by: byId, name: objector.name });
    } catch (e) {
      console.error('Objection broadcast hiba:', e.message);
    }

    this.objectionTimer = setTimeout(() => {
      this.objectionPending = false;
      const accepted = Math.random() < 0.5;
      try {
        this.broadcastAll('objection_ruling', { accepted, ruling: accepted ? 'Elfogadva!' : 'Elutasítva!' });
      } catch (e) {
        console.error('Ruling broadcast hiba:', e.message);
      }
      let remaining2 = this.pausedKind.remaining;
      if (accepted) remaining2 -= 10000;
      const kind2 = this.pausedKind.kind;
      this.pausedKind = null;
      if (remaining2 <= 0) {
        setTimeout(() => (kind2.startsWith('final') ? this.afterClosing(kind2) : this.afterSpeech(kind2)), 2500);
      } else {
        setTimeout(() => this.runSpeech(kind2, remaining2), 2500);
      }
    }, 5000);
    this.broadcast();
    return true;
  }

  // ---------- reakciók ----------

  handleReaction(byId, emoji) {
    try {
      const d = this.roundData;
      if (!d) return;
      const allowed = ['😂', '💀', '🤡', '🔥', '👏'];
      if (!allowed.includes(emoji)) return;

      const speakerOf = {
        [PHASES.PROSECUTION]: 'prosecutor',
        [PHASES.DEFENSE]: 'defendant',
        [PHASES.DEFENDER]: 'defendant', // a védő a vádlott oldalán áll
        [PHASES.FINAL_PROSECUTION]: 'prosecutor',
        [PHASES.FINAL_DEFENSE]: 'defendant'
      };
      const target = speakerOf[this.phase];
      if (!target) return;
      if (emoji === '😂') d.laughs[target] += 1;

      for (const id of this.players.keys()) {
        this.io.to('p:' + id).emit('reaction', { emoji, target, by: byId });
      }
    } catch (e) {
      // A reakció kozmetikai elem – soha ne döntse el a játék folyamatát.
      console.error('Reakció hiba:', e.message);
    }
  }

  // ---------- kiesés / visszacsatlakozás ----------

  handleDisconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;

    if (p.isHost) {
      const active = this.activePlayers();
      if (active.length > 0) {
        p.isHost = false;
        active[0].isHost = true;
      }
    }

    const d = this.roundData;
    if (d && !this.objectionPending) {
      const speakerOf = {
        [PHASES.ACCUSATION]: d.defendantId,
        [PHASES.PROSECUTION]: d.prosecutorId,
        [PHASES.DEFENSE]: d.defendantId,
        [PHASES.DEFENDER]: d.defenderId,
        [PHASES.WITNESS]: d.witnessId,
        [PHASES.FINAL_PROSECUTION]: d.prosecutorId,
        [PHASES.FINAL_DEFENSE]: d.defendantId
      };
      if (speakerOf[this.phase] === playerId) {
        clearTimeout(this.phaseTimer);
        switch (this.phase) {
          case PHASES.ACCUSATION: this.accusationRead(); break;
          case PHASES.PROSECUTION: this.afterSpeech('prosecution'); break;
          case PHASES.DEFENSE: this.afterSpeech('defense'); break;
          case PHASES.DEFENDER: this.afterSpeech('defender'); break;
          case PHASES.WITNESS: this.runClosing('final_prosecution'); break;
          case PHASES.FINAL_PROSECUTION: this.runClosing('final_defense'); break;
          case PHASES.FINAL_DEFENSE: this.startVerdictVote(); break;
        }
      }
    }
    if (this.phase === PHASES.VERDICT_VOTE) this.checkVerdictVotesComplete();
    if (this.phase === PHASES.CHALLENGE_VOTE) this.checkChallengeVotesComplete();
    this.broadcast();
  }

  handleReconnect(playerId) {
    const p = this.players.get(playerId);
    if (p) p.connected = true;
    this.broadcast();
  }

  handleLeave(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (this.phase === PHASES.LOBBY) {
      this.players.delete(playerId);
      if (p.isHost && this.players.size > 0) {
        Array.from(this.players.values())[0].isHost = true;
      }
    } else {
      this.handleDisconnect(playerId);
    }
  }

  clearTimers() {
    clearTimeout(this.phaseTimer);
    clearTimeout(this.objectionTimer);
    if (this.botManager) this.botManager.clearAll();
    this.objectionPending = false;
    this.pausedKind = null;
  }

  dispose() {
    this.clearTimers();
    this.players.clear();
  }
}

module.exports = { Game, PHASES, DEFAULT_SETTINGS, ALL_MODES };
