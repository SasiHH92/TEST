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
  GAME_OVER: 'game_over', // ranglista + díjak
  OBJECTION: 'objection' // TILTAKOZOM! fázis (bíró döntést vár)
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
  autoNextRound: true,
  autoNewGame: true,
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
    this.players = new Map();
    this.archivedPlayers = new Map();
    this.kickedNames = new Set();
    this.autoTimer = null;
    this.autoAdvance = null;
    this.autoStopped = false;
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
    // KÖRÖNKÉNTI BÍRÓ: minden körben MÁS játékos a bíró (sosem vádlott/ügyész/védő).
    // Körbeforog: mindenki legalább egyszer, egymás után nem ismétlődő.
    this.judgeCounts = new Map(); // playerId -> hányszor volt bíró
    this.lastJudgeId = null;      // az előző kör bírája (ismétlődés-ellenőrzéshez)
    this.lobbyNotice = null;      // üzenet, ha kilépés miatt kerültünk vissza a lobbyba
    this.kickedIds = new Set();   // kirúgott játékosok: az adott játék alatt nem léphetnek vissza
    this.departureTimers = new Map(); // kegyelmi időzítők (szerep 20 mp / host 30 mp)
  }

  // ---------- játékos kezelés ----------

  addPlayer(playerId, name, avatar, isHost) {
    void BOT_AVATAR; // (a bot avatar a addBot-ban állítódik)
    const existing = this.players.get(playerId);
    if (existing) {
      existing.name = String(name || existing.name).slice(0, 20) || existing.name;
      if (avatar) existing.avatar = avatar;
      return existing;
    }
    const player = {
      id: playerId,
      name: String(name).slice(0, 20) || 'Névtelen',
      avatar: avatar || 'bírói kalap',
      isHost: !!isHost || (!this.hostId() && this.activePlayers().length === 0),
      connected: true,
      score: 0,
      laughCount: 0,
      convictions: 0,
      challengesDone: 0
    };
    const archived = [...this.archivedPlayers.values()].find((p) => p.name === player.name);
    if (archived) {
      for (const key of ['score','laughCount','convictions','challengesDone']) player[key] = archived[key] || 0;
      this.archivedPlayers.delete(archived.id);
    }
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
      this.handleLeave(bot.id);
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
      kickedOut: !!p.kickedOut,
      goneSince: p.goneSince || null,
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
    const modes = this.settings.modes || [];
    // Alap paklik: altalanos (kihivasok, nehezitesek) - ezek mindig megvannak
    const decks = { altalanos: { kihivasok: new Deck(CARDS.altalanos.kihivasok), nehezitesek: new Deck(CARDS.altalanos.nehezitesek) } };
    
    // Ha van konkrét mód kiválasztva, annak paklijait is felépítjük
    // Ha csak 'altalanos' van, de van más mód (amit a roundMode használni fog), 
    // akkor azt is felépítjük
    const modesToBuild = modes.filter(m => ALL_MODES.includes(m));
    
    // Ha nincs konkrét mód kiválasztva, de szükség van rá (pl. csak 'altalanos' van),
    // válassz egyet random
    const buildModes = modesToBuild;
    
    for (const m of buildModes) {
      const src = CARDS[m];
      if (!src) continue;
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
    const modes = (this.settings.modes || []).filter((m) => ALL_MODES.includes(m));
    if (!modes.length) throw new Error('Nincs kijelölt ügyiratmappa.');
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
      departedPlayers: this.scoreList().filter((p) => p.departed),
      settings: { ...this.settings },
      modes: ALL_MODES.map((k) => ({ key: k, name: CARDS[k].nev })),
      hostId: this.hostId(),
      serverNow: Date.now(),
      phaseEndsAt: this.phaseEndsAt || null,
      autoAdvance: this.autoAdvance ? {...this.autoAdvance} : null,
      autoStopped: this.autoStopped,
      objectionPending: this.objectionPending
    };

    if (this.phase === PHASES.GAME_OVER) base.gameOver = this.finalResults();
    if (!d) {
      if (base.phase === PHASES.LOBBY && this.lobbyNotice) base.lobbyNotice = this.lobbyNotice;
      return base;
    }

    base.caseNo = d.caseNo;
    base.currentJudgeId = d.currentJudgeId || null;
    base.judgeName = d.currentJudgeId && this.players.get(d.currentJudgeId)
      ? this.players.get(d.currentJudgeId).name : null;
    base.modeName = CARDS[d.mode] ? CARDS[d.mode].nev : d.mode;
    base.defendantId = d.defendantId;
    base.prosecutorId = d.prosecutorId;
    if (d.defenderId) base.defenderId = d.defenderId;
    base.accusationText = d.accusationText;
    base.isCustom = !!d.isCustomAccusation; // házigazdai saját vád → "SAJÁT" jelölés a felületen
    if (this.phase === PHASES.OBJECTION && this.objectionData) {
      base.objectionData = {...this.objectionData, judgeName: base.judgeName,
        speakerName: this.players.get(this.objectionData.speakerId)?.name || null};
    }
    if (me) base.myFunVotes = {...(d.funVotes[me.id] || {})};

    // A jogosultságokat minden állapotküldéskor újraszámoljuk, reconnectnél is.
    const cardsVisible = ![PHASES.LOBBY, PHASES.ACCUSATION, PHASES.GAME_OVER].includes(this.phase);
    const iAmProsecutor = !!(me && me.id === d.prosecutorId);
    const iAmDefender = !!(me && me.id === d.defenderId);
    const iAmDefendant = !!(me && me.id === d.defendantId);
    if ((iAmProsecutor || iAmDefender) && cardsVisible) base.evidence = d.evidence;
    if (iAmDefender && cardsVisible && d.tricks) base.tricks = d.tricks;
    if (iAmDefendant && this.phase === PHASES.PREP) base.alibi = d.alibi;
    if (d.witnessId) base.witnessId = d.witnessId;
    if (me && me.id === d.witnessId && this.phase === PHASES.PREP) base.witnessCard = d.witnessCard;
    const myCh = me && d.challenges.find((c) => c.id === me.id);
    if (myCh && this.phase === PHASES.PREP) {
      base.myChallenge = myCh.text;
      base.myChallengeDifficulty = myCh.difficulty;
    }
    base.objectionLog = (d.objectionLog || []).map((entry) => ({ ...entry }));
    if (this.phase === PHASES.ROUND_RESULTS) {
      base.revealedCards = {
        evidence: d.evidence, alibi: d.alibi, tricks: d.tricks || [],
        witnessCard: d.witnessCard,
        challenges: d.challenges.map((c) => ({...c, done: !!d.challengeDecisions[c.who]}))
      };
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
      this.io.to(this.playerRoom(id)).emit('state', this.publicState(id));
    }
  }

  playerRoom(id) { return 'p:' + this.code + ':' + id; }

  broadcastAll(event, payload) {
    this.io.to(this.code).emit(event, payload);
  }

  // ---------- fázisvezérlés ----------

  setPhase(phase, durationMs, onEnd) {
    clearTimeout(this.phaseTimer);
    clearTimeout(this.reviewTimer);
    clearTimeout(this.autoTimer);
    this.autoAdvance = null;
    this.botManager.clearAll();
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
    if (phase === PHASES.ROUND_RESULTS && this.settings.autoNextRound) this.scheduleAutomatic('next_round', () => this.nextRound());
    if (phase === PHASES.VERDICT && this.settings.autoNextRound) this.scheduleAutomatic('verdict', () => this.proceedAfterVerdict());
    if (this.botManager) this.botManager.schedulePhaseActions();
    this.broadcast();
  }

  scheduleAutomatic(kind, action) {
    clearTimeout(this.autoTimer);
    const phase = this.phase;
    this.autoAdvance = {kind, endsAt: Date.now() + 5000};
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      this.autoAdvance = null;
      if (this.phase !== phase) return;
      action();
    }, 5000);
  }

  stopAutomaticRestart(byId) {
    if (this.phase !== PHASES.GAME_OVER || this.hostId() !== byId) return false;
    clearTimeout(this.autoTimer);
    this.autoTimer = null;
    this.autoAdvance = null;
    this.autoStopped = true;
    this.broadcast();
    return true;
  }

  restartGame(byId, automatic = false) {
    if (this.phase !== PHASES.GAME_OVER || (!automatic && this.hostId() !== byId)) return false;
    if (this.activePlayers().length < 3) {
      this.abortToLobby('Legalább 3 játékos kell az új játékhoz.');
      return false;
    }
    this.clearTimers();
    this.phase = PHASES.LOBBY;
    this.roundData = null;
    return this.startGame(null, this.hostId()) !== false;
  }

  scoreList() {
    const rows = [...this.playerList(), ...[...this.archivedPlayers.values()].map((p) => ({
      id:p.id, name:p.name, avatar:p.avatar, score:p.score, profile:p.profile || null,
      isBot:!!p.isBot, isHost:false, connected:false, departed:true
    }))];
    return rows.sort((a,b) => b.score - a.score);
  }

  startGame(settingsPatch, byId) {
    if (this.phase !== PHASES.LOBBY) return;
    if (this.hostId() !== byId) return;
    const playerCount = this.eligiblePlayers().length;
    if (playerCount < 3) {
      console.log('startGame rejected: players < 3 (have', playerCount, ')');
      return;
    }
    if (settingsPatch) {
      const merged = { ...this.settings, ...settingsPatch };
      // A saját vádak is jöhetnek a start-patch-csel (a start gomb a teljes beállítást küldi).
      if (!Array.isArray(settingsPatch.customAccusations)) merged.customAccusations = this.settings.customAccusations;
      this.settings = merged;
    }
    // Az altalanos csak a közös kihívásokhoz kell, körmód nem lehet.
    const hasDeck = (m) => {
      return ALL_MODES.includes(m) && ['vadak', 'bizonyitekok', 'alibik', 'trukkok', 'tanuk', 'buntetesek']
        .every((key) => Array.isArray(CARDS[m][key]) && CARDS[m][key].length > 0);
    };
    this.settings.modes = (Array.isArray(this.settings.modes) ? this.settings.modes : [])
      .filter((m) => hasDeck(m));
    // Ha egyetlen érvényes mód sincs: házigazdai figyelmeztetés, nincs crash.
    if (this.settings.modes.length === 0) {
      this.broadcastAll('host_warning', { message: 'Válassz legalább egy ügyiratmappát!' });
      return false;
    }
    this.awardsRecorded = false;
    this.autoStopped = false;
    this.archivedPlayers.clear();
    this.kickedNames.clear();
    this.round = 0;
    this.roleHistory = new Map();
    this.judgeCounts = new Map(); // bíró-rotáció nullázása
    this.lastJudgeId = null;
    this.lobbyNotice = null;
    this.kickedIds.clear(); // új játék elején törlődik a kirúgás-tiltás
    for (const p of this.players.values()) p.roleTakenBy = null;
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
  pickRoles(excludedId) {
    const activeCount = this.activePlayers().length;
    const actives = this.activePlayers().map((p) => p.id).filter((id) => id !== excludedId);
    const history = (id) => this.roleHistory.get(id) || { defendant: 0, prosecutor: 0, defender: 0 };
    const minDef = Math.min(...actives.map((id) => history(id).defendant));
    const defendantId = pick(actives.filter((id) => history(id).defendant === minDef));

    const prosCandidates = actives.filter((id) => id !== defendantId);
    const minPros = Math.min(...prosCandidates.map((id) => history(id).prosecutor));
    const prosecutorId = pick(prosCandidates.filter((id) => history(id).prosecutor === minPros));

    // Védőügyvéd: 5 vagy több játékosnál, a harmadik legrégebben
    // kirendelt "ügyvédi" szereplő közül.
    let defenderId = null;
    if (activeCount >= 5) {
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

  // Körönkénti bíró kiválasztása: sosem vádlott/ügyész/védő, körbeforog
  // (mindenki legalább egyszer), és egymás után nem ismétlődik.
  pickJudge(roleIds, activeIds, fallbackExclude) {
    let eligible = activeIds.filter((id) => !roleIds.has(id));
    if (eligible.length === 0) {
      // Biztonsági háló (3 játékosnál is mindig van esküdt, ezt elvileg el sem érheti).
      eligible = activeIds.filter((id) => id !== fallbackExclude);
    }
    const minJ = Math.min(...eligible.map((id) => this.judgeCounts.get(id) || 0));
    let cands = eligible.filter((id) => (this.judgeCounts.get(id) || 0) === minJ);
    const noRepeat = cands.filter((id) => id !== this.lastJudgeId);
    if (noRepeat.length > 0) cands = noRepeat;
    const judgeId = pick(cands);
    this.judgeCounts.set(judgeId, (this.judgeCounts.get(judgeId) || 0) + 1);
    this.lastJudgeId = judgeId;
    return judgeId;
  }

  nextRound() {
    this.clearTimers();
    const actives = this.activePlayers();
    if (actives.length < 3) {
      this.abortToLobby('Kevés játékos maradt (legalább 3 kell) – vissza a lobbyba.');
      return;
    }
    if (this.round >= this.settings.rounds) {
      this.phase = PHASES.GAME_OVER;
      this.phaseEndsAt = 0;
      this.roundData = null;
      if (this.settings.autoNewGame && !this.autoStopped) this.scheduleAutomatic('new_game', () => this.restartGame(this.hostId(), true));
      this.broadcast();
      return;
    }
    this.round += 1;

    const mode = this.roundMode();
    // Pakli kiválasztása
    let modeDecks = this.decks[mode];
    // Ha nincs deck a módhoz (pl. altalanos, vagy a mód nem lett felépítve),
    // hozz létre on-the-fly a cards.json-ból
    if (!modeDecks) {
      const src = CARDS[mode];
      if (src) {
        modeDecks = {
          vadak: new Deck(src.vadak || []),
          bizonyitekok: new Deck(src.bizonyitekok || []),
          alibik: new Deck(src.alibik || []),
          trukkok: new Deck(src.trukkok || []),
          tanuk: new Deck(src.tanuk || []),
          kihivasok: new Deck(src.kihivasok || []),
          buntetesek: new Deck(src.buntetesek || [])
        };
      } else {
        // Nincs semmi: használj üres decket, ami nem fog crash-elni
        modeDecks = {
          vadak: new Deck([]), bizonyitekok: new Deck([]), alibik: new Deck([]),
          trukkok: new Deck([]), tanuk: new Deck([]), kihivasok: new Deck([]),
          buntetesek: new Deck([])
        };
      }
    }
    const common = this.decks.altalanos;
    const judgeId = this.pickJudge(new Set(), actives.map((p) => p.id));
    const { defendantId, prosecutorId, defenderId } = this.pickRoles(judgeId);
    const others = actives.filter((p) => p.id !== defendantId && p.id !== prosecutorId && p.id !== defenderId);
    const nameOf = (id) => (this.players.get(id) ? this.players.get(id).name : 'Ismeretlen');

    // A KÖR BÍRÓJA: nem lehet vádlott/ügyész/védő (3 játékosnál az egyetlen esküdt lesz).
    const roleIds = new Set([defendantId, prosecutorId, defenderId].filter(Boolean));
    void roleIds; // a bíró már a beszélő szerepek előtt kiválasztva

    // Vád a mód paklijából; egyedi (házigazdai) vádak is keverhetők – ezek "SAJÁT" jelölést kapnak.
    const custom = this.settings.customAccusations || [];
    let template;
    let isCustom = false;
    if (custom.length > 0 && Math.random() < 0.4) {
      template = pick(custom);
      isCustom = true;
    } else {
      template = modeDecks.vadak.draw();
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
      evidence: modeDecks.bizonyitekok.drawN(3),
      alibi: modeDecks.alibik.draw(),
      tricks: defenderId ? modeDecks.trukkok.drawN(2) : null,
      witnessId: null,
      witnessCard: null,
      challenges: [],
      votes: {},
      currentJudgeId: judgeId, // az adott kör bírája ("Rendet a teremben!", kihívás-elbírálás)
      // A védőügyvéd nem esküdt: nem szavaz ítéletet (de a kihívás-szavazásban ott van).
      voters: others.filter((p) => p.id !== defenderId).map((p) => p.id),
      challengeVoters: others.map((p) => p.id),
      challengeVotes: {},
      challengeJudges: {}, // kihívásonként: ki a bíró (who -> playerId)
      judgeNotes: {}, // a bíró "Észrevettem ✓" emlékeztetői (who -> true)
      challengeDecisions: {}, // bírói döntések (who -> bool)
      funVotes: {}, // 😂/👎 szórakoztató szavazatok (playerId -> {who -> bool})
      objections: {},
      objectionLog: [],
      speechPenalties: {},
      laughs: { prosecutor: 0, defendant: 0 }
    };

    // A tanú előre megkapja a szerepét és a kártyáját a felkészüléshez.
    const witnessPool = others.filter((p) => p.id !== judgeId);
    if (this.settings.witnessEnabled && witnessPool.length) {
      const witness = pick(witnessPool);
      this.roundData.witnessId = witness.id;
      this.roundData.witnessCard = modeDecks.tanuk.draw();
      this.roundData.voters = this.roundData.voters.filter((id) => id !== witness.id);
      this.roundData.challengeVoters = this.roundData.challengeVoters.filter((id) => id !== witness.id);
    }

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
          : (Math.random() < 0.5 ? modeDecks.kihivasok.draw() : common.kihivasok.draw());
        this.roundData.challenges.push({ who: sp.who, id: sp.id, text, difficulty });
      }
      // ---- Kihívás-ellenőrzés: a KÖR BÍRÓJA dönt minden kihívásról ----
      // (Ez váltja fel a régi házigazda-szabályt. A bíró sosem beszélő,
      // ezért nem kell külön sorsolás.)
      const dRound = this.roundData;
      for (const ch of dRound.challenges) {
        dRound.challengeJudges[ch.who] = dRound.currentJudgeId;
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
    if (kind.startsWith('final')) return this.settings.closingSeconds;
    if (kind === 'defender') return this.settings.defenderSeconds;
    return this.settings.speechSeconds;
  }

  startSpeech(kind) {
    this.runSpeech(kind, this.speechSecondsFor(kind) * 1000);
  }

  runSpeech(kind, durationMs, resuming = false) {
    const phase = kind === 'prosecution' ? PHASES.PROSECUTION
      : kind === 'defense' ? PHASES.DEFENSE
        : kind === 'defender' ? PHASES.DEFENDER
          : kind === 'final_prosecution' ? PHASES.FINAL_PROSECUTION
            : PHASES.FINAL_DEFENSE;
    const onEnd = () => (kind.startsWith('final') ? this.afterClosing(kind) : this.afterSpeech(kind));
    const penalty = this.roundData && this.roundData.speechPenalties[kind];
    if (!resuming && penalty) {
      durationMs = Math.max(0, durationMs - penalty);
      delete this.roundData.speechPenalties[kind];
    }
    this.setPhase(phase, Math.max(durationMs, 1), onEnd);
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
    // A védőügyvéd tanú sem lehet (ő a védelem része), és a kör bírója sem:
    // a bíró sosem beszélő/tanú.
    if (this.settings.witnessEnabled && d.witnessId && this.players.get(d.witnessId)?.connected) {
      this.setPhase(PHASES.WITNESS, this.settings.witnessSeconds * 1000, () => this.runClosing('final_prosecution'));
    } else {
      this.runClosing('final_prosecution');
    }
  }

  runClosing(kind) {
    this.runSpeech(kind, this.settings.closingSeconds * 1000);
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
    if (d.challengeBonusApplied) return d.verdictResult?.challengeResults || [];
    d.challengeBonusApplied = true;
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
    if (!ch || this.currentChallenge()?.who !== who || !this.players.get(refereeId)?.connected) return false;
    if (d.challengeDecisions[who] !== undefined) return false; // már eldöntve
    if (d.challengeJudges[who] !== refereeId) return false; // nem te vagy az ügy bírója
    clearTimeout(this.phaseTimer);
    this.phaseEndsAt = 0;
    d.challengeDecisions[who] = !!done;
    this.broadcast();
    this.reviewTimer = setTimeout(() => { if (this.roundData === d && this.phase === PHASES.CHALLENGE_REVIEW) this.advanceChallengeReview(); }, 1200);
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
    if (!d || this.phase !== PHASES.CHALLENGE_REVIEW || !this.players.get(byId)?.connected) return false;
    if (this.currentChallenge()?.who !== who || byId === d.currentJudgeId) return false;
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

    // ---- ESKÜDT-PONT: minden szavazó +1 pontot kap, ha a végső ítélettel
    // (többségi szavazattal) EGYEZŐEN szavazott. Döntetlennél (senki nem "nyert")
    // minden szavazó kap +1-et. Ez a roundData.verdictResult.votes elemeinél
    // egyénileg is kiírásra kerül ("+1" a név mellett az ítélet képernyőn).
    for (const v of d.voters) {
      if (v === d.defenderId) continue; // a védőügyvéd nem esküdt, nem szavaz
      const vote = d.votes[v] ? d.votes[v].verdict : null;
      if (!vote) continue;
      const match = guilty ? vote === 'guilty' : vote === 'not_guilty';
      const voter = this.players.get(v);
      if (voter && (match || guiltyVotes === notGuiltyVotes)) {
        voter.score += 1;
        voter.jurorPoints = (voter.jurorPoints || 0) + 1;
      }
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
        verdict: d.votes[v] ? d.votes[v].verdict : null,
        // "Rendben szavaztál" pont: a többséggel egyező (vagy döntetlen melletti)
        // szavazat +1 pontot ér az esküdteknek.
        jurorPoint: (() => {
          const vote = d.votes[v] ? d.votes[v].verdict : null;
          if (!vote) return false;
          return guilty ? vote === 'guilty' : vote === 'not_guilty' || guiltyVotes === notGuiltyVotes;
        })()
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
      scores: this.scoreList(),
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
    const players = this.scoreList();
    const all = [...this.players.values(), ...this.archivedPlayers.values()];
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
        const p = a && (this.players.get(a.playerId) || this.archivedPlayers.get(a.playerId));
        if (a && p && !p.isBot) Game.recordStat(a.name, 'dijak');
      }
    }
    return { ranking: players, awards };
  }

  // ---------- TILTAKOZOM! (új rendszer: bíró dönt) ----------

  tryObjection(byId) {
    const d = this.roundData;
    const kind = this.phase;
    const speakers = {
      prosecution: d && d.prosecutorId, defense: d && d.defendantId,
      defender: d && d.defenderId, final_prosecution: d && d.prosecutorId,
      final_defense: d && d.defendantId
    };
    if (!d || !speakers[kind] || this.objectionPending) return false;
    const player = this.players.get(byId);
    if (!player || !player.connected) return false;
    const prosecutorSpeaks = kind === 'prosecution' || kind === 'final_prosecution';
    const allowed = prosecutorSpeaks
      ? byId === d.defendantId || byId === d.defenderId
      : byId === d.prosecutorId;
    const phaseKey = kind + ':' + byId;
    const roundKey = '_total_' + byId;
    if (!allowed || d.objections[phaseKey] || (d.objections[roundKey] || 0) >= 2) return false;
    d.objections[phaseKey] = 1;
    d.objections[roundKey] = (d.objections[roundKey] || 0) + 1;
    const remaining = Math.max(0, this.phaseEndsAt - Date.now());
    clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    this.botManager.clearAll();
    this.phase = PHASES.OBJECTION;
    this.objectionPending = true;
    this.objectionData = {
      kind, remaining, objectorId: byId, objectorName: player.name,
      speakerId: speakers[kind], phase: 'defense', defenderEndsAt: Date.now() + 20000
    };
    this.phaseEndsAt = this.objectionData.defenderEndsAt;
    this.objectionTimer = setTimeout(() => this.beginObjectionJudgment(), 20000);
    this.broadcastAll('objection_started', {by: byId, name: player.name, speakerId: speakers[kind], speakerName: this.players.get(speakers[kind]).name});
    this.broadcast();
    this.botManager.schedulePhaseActions();
    return true;
  }

  beginObjectionJudgment() {
    const od = this.objectionData;
    if (!od || this.phase !== PHASES.OBJECTION) return false;
    clearTimeout(this.objectionTimer);
    this.botManager.clearAll();
    od.phase = 'judge';
    od.judgeEndsAt = Date.now() + 15000;
    this.phaseEndsAt = od.judgeEndsAt;
    this.objectionTimer = setTimeout(() => {
      if (this.objectionData !== od || od.phase !== 'judge') return;
      od.accepted = false;
      od.timedOut = true;
      this.finishObjection();
    }, 15000);
    this.broadcast();
    this.botManager.schedulePhaseActions();
    return true;
  }

  objectionDefenseDone(byId) {
    const od = this.objectionData;
    if (!od || od.phase !== 'defense' || byId !== od.speakerId) return false;
    return this.beginObjectionJudgment();
  }

  objectionJudgeDecision(byId, accepted) {
    const od = this.objectionData;
    const player = this.players.get(byId);
    if (!od || this.phase !== PHASES.OBJECTION || od.phase !== 'judge') return false;
    if (!player || !player.connected || byId !== this.roundData.currentJudgeId) return false;
    od.accepted = !!accepted;
    this.finishObjection();
    return true;
  }

  finishObjection() {
    const od = this.objectionData;
    const d = this.roundData;
    if (!od || !d || this.phase !== PHASES.OBJECTION) return false;
    clearTimeout(this.objectionTimer);
    this.objectionTimer = null;
    const sequence = ['prosecution','defense', ...(d.defenderId ? ['defender'] : []), 'final_prosecution','final_defense'];
    const speakerFor = (kind) => kind === 'prosecution' || kind === 'final_prosecution'
      ? d.prosecutorId : kind === 'defender' ? d.defenderId : d.defendantId;
    const nextOwnSpeech = sequence.slice(sequence.indexOf(od.kind) + 1).find((kind) => speakerFor(kind) === od.objectorId);
    let deduction = 0;
    if (od.accepted) {
      const remaining = Math.max(5000, od.remaining - 20000);
      deduction = Math.max(0, od.remaining - remaining);
      od.remaining = remaining;
    } else if (nextOwnSpeech) {
      d.speechPenalties[nextOwnSpeech] = (d.speechPenalties[nextOwnSpeech] || 0) + 20000;
      deduction = 20000;
    }
    const entry = {
      objectorId: od.objectorId, objectorName: od.objectorName,
      speakerId: od.speakerId, speakerName: this.players.get(od.speakerId)?.name || '?',
      judgeId: d.currentJudgeId, judgeName: this.players.get(d.currentJudgeId)?.name || '?',
      accepted: !!od.accepted, timedOut: !!od.timedOut,
      deductionMs: deduction, deductionFrom: od.accepted ? od.speakerId : (nextOwnSpeech ? od.objectorId : null),
      nextSpeechKind: !od.accepted ? nextOwnSpeech || null : null
    };
    d.objectionLog.push(entry);
    this.broadcastAll('objection_ruling', {...entry, ruling: od.accepted ? 'JOGOS!' : 'NEM JOGOS!'});
    this.objectionPending = false;
    this.objectionData = null;
    this.pausedKind = null;
    this.runSpeech(od.kind, od.remaining, true);
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
        this.io.to(this.playerRoom(id)).emit('reaction', { emoji, target, by: byId });
      }
    } catch (e) {
      // A reakció kozmetikai elem – soha ne döntse el a játék folyamatát.
      console.error('Reakció hiba:', e.message);
    }
  }

  // ---------- kiesés / visszacsatlakozás / kirúgás (9. pont) ----------

  // KEGYELMI IDŐ: hálózati kiesésnél a szerep csak akkor adódik át, ha a
  // játékos 20 mp-en belül nem jön vissza (a házigazda-jog 30 mp után vándorol).
  // Kirúgásnál és explicit kilépésnél nincs kegyelem – azonnal átadjuk.
  static GRACE_ROLE_MS = 20000;
  static GRACE_HOST_MS = 30000;

  // Házigazda-átadás: a legrégebben bent lévő, még bent lévő játékos veszi át
  // (a players Map beszúrási sorrendje = belépési sorrend), mindenki értesül.
  transferHostFrom(playerId) {
    if (!playerId) return;
    const p = this.players.get(playerId);
    if (!p || !p.isHost) return null;
    const active = this.activePlayers().filter((q) => q.id !== playerId);
    if (active.length > 0) {
      p.isHost = false;
      active[0].isHost = true;
      this.broadcastAll('host_changed', {
        newHostId: active[0].id,
        newHostName: active[0].name,
        reason: 'lept', // a házigazda kilépett / kiesett
      });
      this.broadcast();
      return active[0];
    }
    return null;
  }

  // Esküdt szavazatának azonnali eltávolítása, ha még NEM szavazott –
  // a rendszer ne várjon rá (a leadott szavazatok megmaradnak).
  removeUnvotedFromVoters(playerId) {
    const d = this.roundData;
    if (!d) return;
    if (this.phase === PHASES.VERDICT_VOTE && Array.isArray(d.voters) &&
        d.voters.includes(playerId) && !d.votes[playerId]) {
      d.voters = d.voters.filter((v) => v !== playerId);
    }
    if (this.phase === PHASES.CHALLENGE_VOTE && Array.isArray(d.challengeVoters) &&
        d.challengeVoters.includes(playerId) && !d.challengeVotes[playerId]) {
      d.challengeVoters = d.challengeVoters.filter((v) => v !== playerId);
    }
  }

  removeFromVoters(playerId) {
    const d=this.roundData;
    if (!d) return;
    d.voters=d.voters.filter((id)=>id!==playerId);
    d.challengeVoters=d.challengeVoters.filter((id)=>id!==playerId);
    delete d.votes[playerId];
    delete d.challengeVotes[playerId];
  }

  // Hálózati kiesés: jelölés + kegyelmi időzítők (szerep 20 mp, host 30 mp).
  handleDisconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p || p.kickedOut) return;
    p.connected = false;
    p.goneSince = Date.now();
    if (this.phase === PHASES.OBJECTION && this.roundData?.currentJudgeId === playerId &&
        !this.reassignJudge(playerId, 'lecsatlakozott') && this.activePlayers().length >= 3) {
      this.skipRoundDueToDeparture(p.name, 'judge');
    }
    this.removeUnvotedFromVoters(playerId);
    if (p.isBot) {
      // botnál nincs értelme a kegyelemnek: azonnal átadjuk, amit kell
      this.afterDeparture(playerId);
    } else {
      this.scheduleDeparture(playerId);
    }
    if (this.phase === PHASES.VERDICT_VOTE) this.checkVerdictVotesComplete();
    if (this.phase === PHASES.CHALLENGE_VOTE) this.checkChallengeVotesComplete();
    this.broadcast();
  }

  scheduleDeparture(playerId) {
    this.clearDepartureTimers(playerId);
    const p = this.players.get(playerId);
    if (!p) return;
    const entry = {roleT:null, hostT:null};
    entry.roleT = setTimeout(() => {
      entry.roleT = null;
      const player = this.players.get(playerId);
      if (!player || player.connected || player.kickedOut) return;
      player.roleExpired = true;
      this.afterDeparture(playerId, false);
      if (!entry.hostT) this.departureTimers.delete(playerId);
    }, Game.GRACE_ROLE_MS);
    if (p.isHost) entry.hostT = setTimeout(() => {
      entry.hostT = null;
      const player = this.players.get(playerId);
      if (player && !player.connected && player.isHost) this.transferHostFrom(playerId);
      if (!entry.roleT) this.departureTimers.delete(playerId);
    }, Game.GRACE_HOST_MS);
    this.departureTimers.set(playerId, entry);
  }

  clearDepartureTimers(playerId) {
    const t = this.departureTimers.get(playerId);
    if (t) {
      clearTimeout(t.roleT);
      clearTimeout(t.hostT);
      this.departureTimers.delete(playerId);
    }
  }

  // A kilépés lezárása (kirúgás, explicit kilépés vagy lejárt kegyelem):
  // <3 játékos → lobby; host-átadás; szerep(ek) átadása nem szereplő esküdteknek.
  afterDeparture(playerId, transferHost = true) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (transferHost) this.clearDepartureTimers(playerId);
    if (transferHost && p.isHost) this.transferHostFrom(playerId);
    if (this.phase !== PHASES.LOBBY && this.activePlayers().length < 3) {
      this.abortToLobby(p.name + ' kilépett – kevesebb mint 3 játékos maradt, ezért vissza a lobbyba. A pontok megmaradtak!');
      return;
    }
    this.removeFromVoters(playerId);
    if (this.roundData && this.phase !== PHASES.ROUND_RESULTS) this.handoverRoles(playerId);
    if (this.phase === PHASES.VERDICT_VOTE) this.checkVerdictVotesComplete();
    if (this.phase === PHASES.CHALLENGE_VOTE) this.checkChallengeVotesComplete();
    this.broadcast();
  }

  // Vissza a lobbyba érthető üzenettel (a kör nem fagy be, pontok megmaradnak).
  abortToLobby(message) {
    this.clearTimers();
    this.phase = PHASES.LOBBY;
    this.roundData = null;
    this.lobbyNotice = message;
    try { this.broadcastAll('host_warning', { message }); } catch (e) { /* */ }
    this.broadcast();
  }

  // Szerep(ek) átadása a kiesett játékostól.
  handoverRoles(playerId) {
    const d = this.roundData;
    if (!d) return;
    if (d.currentJudgeId === playerId && !this.reassignJudge(playerId, 'kiesett')) {
      this.skipRoundDueToDeparture(this.players.get(playerId)?.name || '?', 'judge');
      return;
    }
    for (const slot of ['prosecutorId', 'defendantId', 'defenderId', 'witnessId']) {
      if (d[slot] === playerId) this.handoverSlot(slot, playerId);
    }
  }

  // Új KÖR BÍRÓ a nem szereplő esküdtek közül (min. szerephányad, nem ismétlődő).
  reassignJudge(fromId, reason) {
    const d = this.roundData;
    if (!d) return null;
    const cands = (d.voters || []).filter((id) => id !== fromId && this.players.has(id) &&
      this.players.get(id).connected &&
      id !== d.prosecutorId && id !== d.defendantId && id !== d.defenderId && id !== d.witnessId);
    if (cands.length === 0) return null;
    const minJ = Math.min(...cands.map((id) => this.judgeCounts.get(id) || 0));
    let pool = cands.filter((id) => (this.judgeCounts.get(id) || 0) === minJ);
    const noRepeat = pool.filter((id) => id !== this.lastJudgeId);
    if (noRepeat.length > 0) pool = noRepeat;
    d.currentJudgeId = pick(pool);
    this.judgeCounts.set(d.currentJudgeId, (this.judgeCounts.get(d.currentJudgeId) || 0) + 1);
    this.lastJudgeId = d.currentJudgeId;
    if (Array.isArray(d.challenges)) {
      for (const ch of d.challenges) d.challengeJudges[ch.who] = d.currentJudgeId;
    }
    try {
      this.broadcastAll('judge_changed', {
        judgeId: d.currentJudgeId,
        judgeName: this.players.get(d.currentJudgeId).name,
        reason: reason || 'kiesett',
      });
    } catch (e) { /* */ }
    if (this.phase === PHASES.OBJECTION && this.objectionData?.phase === 'judge') this.beginObjectionJudgment();
    return d.currentJudgeId;
  }

  // Aki a legkevesebb szerepet kapta eddig (rótáció fairness a szerepátadásnál is).
  pickLeastRolePlayer(cands) {
    const cnt = (id) => {
      const h = this.roleHistory.get(id) || {};
      return (h.defendant || 0) + (h.prosecutor || 0) + (h.defender || 0);
    };
    const min = Math.min(...cands.map(cnt));
    return pick(cands.filter((id) => cnt(id) === min));
  }

  notifyHandover(role, fromName, toId) {
    try {
      this.broadcastAll('role_handed_over', {
        role,
        fromName,
        toId,
        toName: (this.players.get(toId) || {}).name || '?',
      });
    } catch (e) { /* */ }
  }

  // Egy szerepslot átadása: a KÁRTYÁK VÁLTOZATLANOK maradnak (nem húz újat),
  // csak a tulajdonosjuk cserélődik – és a láthatósági szabály az új szereplőre érvényes.
  handoverSlot(slot, fromId) {
    const d = this.roundData;
    if (!d) return;
    const fromP = this.players.get(fromId);
    const fromName = fromP ? fromP.name : '?';
    const roleHolders = new Set([d.prosecutorId, d.defendantId, d.defenderId, d.witnessId].filter(Boolean));
    // A KÖR BÍRÓJA nem válhat szereplővé (a bíró sosem beszélő).
    const cands = this.activePlayers().map((p) => p.id)
      .filter((id) => !roleHolders.has(id) && id !== fromId && id !== d.currentJudgeId);

    if (slot === 'witnessId') {
      if (cands.length === 0) {
        // A tanú kihagyható: megyünk a zárószóra, a kör nem vész el.
        d.witnessId = null;
        if (this.phase === PHASES.WITNESS) {
          this.runClosing('final_prosecution');
        }
        return;
      }
      const newId = this.pickLeastRolePlayer(cands);
      d.witnessId = newId;
      this.removeFromVoters(newId);
      if (fromP) fromP.roleTakenBy = (this.players.get(newId) || {}).name || '?';
      this.notifyHandover('witness', fromName, newId);
      if (this.phase === PHASES.WITNESS) this.rearmWitnessTimer();
      return;
    }

    const who = { prosecutorId: 'prosecutor', defendantId: 'defendant', defenderId: 'defender' }[slot];
    if (cands.length === 0) {
      if (slot === 'defenderId') {
        // A védőügyvéd elhagyható (4 játékos alatt nincs is): kör megy tovább.
        d.defenderId = null;
        if (Array.isArray(d.challenges)) d.challenges = d.challenges.filter((c) => c.who !== 'defender');
        if (this.phase === PHASES.DEFENDER) this.afterSpeech('defender');
        return;
      }
      // Vádlott/ügyész nem adható át: a KÖR KIMARAD, jön a következő.
      this.skipRoundDueToDeparture(fromName, who);
      return;
    }

    const newId = this.pickLeastRolePlayer(cands);
    d[slot] = newId;
    this.removeFromVoters(newId);
    if (this.objectionData?.speakerId === fromId) {
      this.objectionData.speakerId = newId;
      this.objectionData.remaining = Math.max(15000, this.objectionData.remaining);
    }
    if (who) {
      const h = this.roleHistory.get(newId) || { defendant: 0, prosecutor: 0, defender: 0 };
      h[who] = (h[who] || 0) + 1;
      this.roleHistory.set(newId, h);
      // A kihívás az ÚJ tulajdonoshoz kerül (ugyanaz a szöveg, nem húz újat).
      if (Array.isArray(d.challenges)) {
        for (const ch of d.challenges) if (ch.who === who) ch.id = newId;
      }
    }
    if (fromP) fromP.roleTakenBy = (this.players.get(newId) || {}).name || '?';
    this.notifyHandover(who || slot, fromName, newId);
    // Ha éppen Ő BESZÉLT: az idő folytatódik (legalább 15 mp), a glow átugrik.
    this.rearmSpeechTimerIfNeeded(slot);
  }

  rearmRemaining() {
    const rem = this.phaseEndsAt ? this.phaseEndsAt - Date.now() : 0;
    return Math.max(rem, 15000); // legalább 15 másodperc
  }

  rearmSpeechTimerIfNeeded(slot) {
    const map = {
      prosecutorId: { [PHASES.PROSECUTION]: 'prosecution', [PHASES.FINAL_PROSECUTION]: 'final_prosecution' },
      defendantId: { [PHASES.DEFENSE]: 'defense', [PHASES.FINAL_DEFENSE]: 'final_defense', [PHASES.ACCUSATION]: 'accusation' },
      defenderId: { [PHASES.DEFENDER]: 'defender' }
    };
    const kindMap = map[slot];
    if (!kindMap || this.objectionPending) return; // a tiltakozás feloldása maga folytatja az időt
    const kind = kindMap[this.phase];
    if (!kind) return;
    const remaining = this.rearmRemaining();
    if (kind === 'accusation') this.setPhase(PHASES.ACCUSATION, remaining, () => this.accusationRead());
    else this.runSpeech(kind, remaining, true);
  }

  rearmWitnessTimer() {
    if (this.objectionPending) return;
    this.setPhase(PHASES.WITNESS, this.rearmRemaining(), () => this.runClosing('final_prosecution'));
  }

  // A szerep nem adható át (nincs elég játékos): a kör kimarad, jön a következő.
  skipRoundDueToDeparture(fromName, who) {
    const whoHu = { prosecutor: 'az ügyész', defendant: 'a vádlott', defender: 'a védőügyvéd', judge: 'a bíró' }[who] || 'a szereplő';
    try {
      this.broadcastAll('host_warning', {
        message: '⏭️ ' + fromName + ' (' + whoHu + ') kilépett, a szerepe nem adható át – ez a kör kimarad, jön a következő.',
      });
    } catch (e) { /* */ }
    this.nextRound();
  }

  // HÁZIGAZDAI KIRÚGÁS: a szerver (kick_player) ellenőrzi, hogy a házigazdától
  // jön. A kirúgott: azonnal elveszíti a szerepét (nincs kegyelem), üzenetet kap,
  // és az adott játék alatt a kódjával nem tud visszalépni (kickedIds).
  kickPlayer(targetId) {
    const p = this.players.get(targetId);
    if (!p || p.kickedOut) return false;
    this.kickedIds.add(targetId);
    this.kickedNames.add(p.name.toLowerCase());
    this.archivedPlayers.set(targetId, {...p, isHost:false, connected:false, sessionToken:undefined});
    p.kickedOut = true;
    p.connected = false;
    p.goneSince = Date.now();
    this.clearDepartureTimers(targetId);
    this.removeFromVoters(targetId);
    try { this.io.to(this.playerRoom(targetId)).emit('you_are_kicked', { message: 'A házigazda kirúgott a szobából.' }); } catch (e) { /* */ }
    try { this.broadcastAll('player_kicked', { playerId: targetId, name: p.name }); } catch (e) { /* */ }
    this.afterDeparture(targetId);
    this.players.delete(targetId);
    this.broadcast();
    return true;
  }

  // Explicit kilépés (KILÉPÉS gomb): nincs kegyelem, azonnal átadjuk, ami kell.
  handleLeave(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.goneSince = Date.now();
    if (this.phase !== PHASES.LOBBY) this.archivedPlayers.set(playerId, {...p, isHost:false, connected:false, sessionToken:undefined});
    this.removeFromVoters(playerId);
    this.afterDeparture(playerId);
    this.players.delete(playerId);
    this.broadcastAll('player_left', {playerId, name:p.name});
    this.broadcast();
  }

  handleReconnect(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.goneSince && Date.now() - p.goneSince >= Game.GRACE_ROLE_MS && !p.roleExpired) {
      p.connected = false;
      p.roleExpired = true;
      this.afterDeparture(playerId, false);
    }
    if (p.goneSince && Date.now() - p.goneSince >= Game.GRACE_HOST_MS && p.isHost) this.transferHostFrom(playerId);
    p.connected = true;
    p.goneSince = null;
    p.roleExpired = false;
    this.clearDepartureTimers(playerId); // 20 mp-en belül visszajött: semmi nem történik
    if (p.roleTakenBy) {
      try {
        this.io.to(this.playerRoom(playerId)).emit('host_warning', {
          message: 'A szereped átkerült ' + p.roleTakenBy + '-hez/hez – a következő körtől esküdtként folytatod.',
        });
      } catch (e) { /* */ }
      p.roleTakenBy = null;
    }
    this.broadcast();
  }

  clearTimers() {
    clearTimeout(this.phaseTimer);
    clearTimeout(this.objectionTimer);
    clearTimeout(this.reviewTimer);
    clearTimeout(this.autoTimer);
    this.autoAdvance = null;
    this.phaseEndsAt = 0;
    if (this.botManager) this.botManager.clearAll();
    this.objectionPending = false;
    this.pausedKind = null;
    this.objectionData = null;
  }

  dispose() {
    this.clearTimers();
    for (const id of Array.from(this.departureTimers.keys())) this.clearDepartureTimers(id);
    this.players.clear();
  }
}

module.exports = { Game, PHASES, DEFAULT_SETTINGS, ALL_MODES };
