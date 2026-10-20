'use strict';

// ============================================================
// KAMU BÍRÓSÁG – botok (szerveroldali teszt-játékosok)
// A botok csak akkor játszanak, ha már legalább 1 ember van a
// szobában. Időzítőkkel "gondolkodnak": felolvasnak, beszélnek,
// szavaznak, tiltakoznak, reagálnak, és a házigazda bot esetén
// tovább léptetik a kört.
// ============================================================

// A fázisnevek sima stringek (lásd game.js PHASES) – itt literálokat
// használunk, hogy ne legyen körkörös függőség a game.js-szel.
const PHASES = {
  ACCUSATION: 'accusation',
  PREP: 'prep',
  PROSECUTION: 'prosecution',
  DEFENSE: 'defense',
  DEFENDER: 'defender',
  WITNESS: 'witness',
  FINAL_PROSECUTION: 'final_prosecution',
  FINAL_DEFENSE: 'final_defense',
  JURY_QUESTION: 'jury_question', // esküdt-kérdés (keresztkérdés)
  VERDICT_VOTE: 'verdict_vote',
  CHALLENGE_VOTE: 'challenge_vote',
  CHALLENGE_REVIEW: 'challenge_review', // bíró dönt a kihívásokról
  VERDICT: 'verdict',
  ROUND_RESULTS: 'round_results',
  GAME_OVER: 'game_over',
  LOBBY: 'lobby'
};

const BOT_NAMES = ['Robi, a Robot', 'Géza, a Gép', 'Szintetikus Sári', 'Kábeles Károly'];
const BOT_AVATAR = 'bírói kalap';

// A bot-esküdtek ilyen kérdéseket tesznek fel (esküdt-kérdés bekapcsolva).
const BOT_QUESTIONS = [
  'Miért pont akkor történt mindez?',
  'Van erre tanú, vagy csak ennyit mondasz?',
  'Mit szólna ehhez az anyukád?',
  'Ugye ezt most nem gondolod komolyan?',
  'Hol voltál valójában?',
  'Mi a legnagyobb hazugság, amit most mondtál?',
  'Ha ártatlan vagy, miért izzadsz?',
  'Hányas számú lángosról van szó?'
];

// Mennyire "él a bot": 0.3 = lusta, 1 = hyperaktív.
const ACTIVITY = 0.9;

function rand(ms) {
  return ms * (0.4 + Math.random() * 1.2) / ACTIVITY;
}

class BotManager {
  constructor(game) {
    this.game = game;
    this.timers = new Set();
  }

  clearAll() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  schedule(fn, ms) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      try {
        fn();
      } catch (e) {
        // Ha egy bot-művelet elhasal, a fázis elakadhat – ezért
        // a beszéd-fázisokban mindig van háttéridőzítő (a Game-ben),
        // ami előbb-utóbb továbblép. Itt csak naplózunk.
        console.error('Bot hiba:', e.message);
      }
    }, ms);
    this.timers.add(t);
  }

  // A bot, aki most cselekszik (a game állapota alapján).
  schedulePhaseActions() {
    const g = this.game;
    const d = g.roundData;
    if (!d) return;
    const bots = Array.from(g.players.values()).filter((p) => p.isBot && p.connected);
    if (bots.length === 0) return;

    switch (g.phase) {
      case PHASES.ACCUSATION: {
        // A vádat a kör bírója olvassa fel: ha a bíró bot, ő lép tovább; emberi bírót a bot nem előz meg
        // (ha a bíró nincs a teremben, a házigazda nyomhatja – ld. game.js canReadAccusation)
        const judgeBot = bots.find((b) => b.id === d.currentJudgeId);
        if (judgeBot) this.schedule(() => g.accusationReadBy(judgeBot.id), rand(3500));
        break;
      }
      case PHASES.PREP: {
        // A felkészülés lejár magától – semmi dolga.
        break;
      }
      case PHASES.PROSECUTION: {
        const speaker = bots.find((b) => b.id === d.prosecutorId);
        if (speaker) {
          // Bot ügyész: a beszédidő nagyobb részében "beszél", aztán "Végeztem".
          this.schedule(() => {
            if (g.phase === PHASES.PROSECUTION && !g.objectionPending) g.doneSpeaking(speaker.id);
            else this.schedulePhaseActions(); // tiltakozás alatt újrapróbálkozik
          }, rand(g.settings.speechSeconds * 700));
        }
        this.maybeObjection(d, 'defense', 'prosecution');
        this.maybeReactions('prosecutor');
        this.maybeJuryQuestion(d, g.settings.speechSeconds);
        break;
      }
      case PHASES.DEFENSE: {
        const speaker = bots.find((b) => b.id === d.defendantId);
        if (speaker) {
          this.schedule(() => {
            if (g.phase === PHASES.DEFENSE && !g.objectionPending) g.doneSpeaking(speaker.id);
            else this.schedulePhaseActions();
          }, rand(g.settings.speechSeconds * 700));
        }
        this.maybeObjection(d, 'prosecution', 'defense');
        this.maybeReactions('defendant');
        this.maybeJuryQuestion(d, g.settings.speechSeconds);
        break;
      }
      case PHASES.DEFENDER: {
        const speaker = bots.find((b) => b.id === d.defenderId);
        if (speaker) {
          this.schedule(() => {
            if (g.phase === PHASES.DEFENDER && !g.objectionPending) g.doneSpeaking(speaker.id);
            else this.schedulePhaseActions();
          }, rand(g.settings.defenderSeconds * 700));
        }
        break;
      }
      case PHASES.WITNESS: {
        // Ha a tanú bot, korábban befejezi a vallomást ("Végeztem").
        const witness = bots.find((b) => b.id === d.witnessId);
        if (witness) {
          this.schedule(() => {
            if (g.phase === PHASES.WITNESS) g.doneSpeaking(witness.id);
          }, rand(g.settings.witnessSeconds * 700));
        }
        break;
      }
      case PHASES.FINAL_PROSECUTION: {
        const speaker = bots.find((b) => b.id === d.prosecutorId);
        if (speaker) this.schedule(() => {
          if (g.phase === PHASES.FINAL_PROSECUTION && !g.objectionPending) g.doneSpeaking(speaker.id);
          else this.schedulePhaseActions();
        }, rand(g.settings.closingSeconds * 700));
        break;
      }
      case PHASES.FINAL_DEFENSE: {
        const speaker = bots.find((b) => b.id === d.defendantId);
        if (speaker) this.schedule(() => {
          if (g.phase === PHASES.FINAL_DEFENSE && !g.objectionPending) g.doneSpeaking(speaker.id);
          else this.schedulePhaseActions();
        }, rand(g.settings.closingSeconds * 700));
        break;
      }
      case 'objection': {
        const od = g.objectionData;
        if (!od) break;
        if (od.phase === 'defense') {
          const speaker = g.getPlayer(od.speakerId);
          if (speaker && speaker.isBot && speaker.connected) this.schedule(() => {
            if (g.objectionData === od && od.phase === 'defense') g.objectionDefenseDone(speaker.id);
          }, 3000 + Math.random() * 5000);
        } else if (od.phase === 'judge') {
          const judge = g.getPlayer(d.currentJudgeId);
          if (judge && judge.isBot && judge.connected) this.schedule(() => {
            if (g.objectionData === od && od.phase === 'judge') g.objectionJudgeDecision(judge.id, Math.random() < 0.5);
          }, 3000 + Math.random() * 5000);
        }
        break;
      }
      case PHASES.JURY_QUESTION: {
        // Ha a megszólított bot, rövid gondolkodás után "válaszol" (különben az időzítő viszi tovább).
        for (const pick of (d.questionPicks || [])) {
          const target = g.players.get(pick.targetId);
          if (!target || !target.isBot || !target.connected) continue;
          this.schedule(() => g.juryAnswerDone(target.id), rand(4000));
        }
        break;
      }
      case PHASES.VERDICT_VOTE: {
        // Minden bot-esküdt szavaz: kis szórás, végletszavazat.
        // (A voters a beállított esküdtek listája – bot és ember is lehet.)
        for (const v of d.voters) {
          if (d.votes[v]) continue;
          const voter = g.players.get(v);
          if (!voter || !voter.isBot || !voter.connected) continue;
          this.schedule(() => {
            g.castVerdictVote(v, Math.random() < 0.5 ? 'guilty' : 'not_guilty');
          }, rand(2500));
        }
        break;
      }
      case PHASES.CHALLENGE_VOTE: {
        for (const v of d.challengeVoters) {
          const cast = d.challengeVotes[v];
          if (cast && d.challenges.every((c) => cast[c.who] !== undefined)) continue;
          const voter = g.players.get(v);
          if (!voter || !voter.isBot || !voter.connected) continue;
          this.schedule(() => {
            for (const ch of d.challenges) {
              g.castChallengeVote(v, ch.who, Math.random() < 0.7); // 70%: teljesítettnek hiszik
            }
          }, rand(2000));
        }
        break;
      }
      case PHASES.CHALLENGE_REVIEW: {
        // Bíró mód: a bot-bíró dönt (70%: teljesítette), a többi bot csak
        // szórakoztató 😂/👎 szavazatot ad (pontot nem).
        for (const ch of (d.challenges || [])) {
          if (d.challengeDecisions[ch.who] !== undefined) continue;
          const referee = g.players.get(d.challengeJudges[ch.who]);
          if (referee && referee.isBot && referee.connected) {
            this.schedule(() => {
              g.resolveChallenge(referee.id, ch.who, Math.random() < 0.7);
            }, rand(6000));
          }
          for (const b of bots) {
            if (referee && b.id === referee.id) continue;
            this.schedule(() => g.funChallengeVote(b.id, ch.who, Math.random() < 0.6), rand(5000));
          }
        }
        break;
      }
      case PHASES.VERDICT: {
        // Ha a házigazda bot, továbblép.
        const host = g.getPlayer(g.hostId());
        if (host && host.isBot) {
          this.schedule(() => g.proceedAfterVerdict(), rand(4000));
        }
        break;
      }
      case PHASES.ROUND_RESULTS: {
        const host = g.getPlayer(g.hostId());
        if (host && host.isBot) {
          this.schedule(() => g.nextAfterResults(host.id), rand(6000));
        }
        break;
      }
    }
  }

  maybeObjection(d, speakerSideKey, phaseKind) {
    // A bot-ellenfél eséllyel tiltakozik a másik beszéde közben.
    const g = this.game;
    void speakerSideKey;
    const objectors = Array.from(g.players.values()).filter((p) => {
      if (!p.isBot || !p.connected) return false;
      if (phaseKind === 'prosecution') return p.id === d.defendantId || (d.defenderId && p.id === d.defenderId);
      return p.id === d.prosecutorId;
    });
    if (objectors.length === 0) return;
    if (Math.random() > 0.35) return; // 35% esély a tiltakozásra
    const obj = objectors[Math.floor(Math.random() * objectors.length)];
    this.schedule(() => g.tryObjection(obj.id), rand(5000));
  }

  // Bekapcsolt esküdt-kérdésnél a bot-esküdtek eséllyel (kb. 30%) feltesznek egy kérdést az ügyésznek vagy a vádlottnak.
  maybeJuryQuestion(d, speechSeconds) {
    const g = this.game;
    if (!g.settings.juryQuestions) return;
    for (const v of d.voters) {
      const b = g.players.get(v);
      if (!b || !b.isBot || !b.connected || (d.questions && d.questions[v])) continue;
      if (Math.random() > 0.3) continue;
      this.schedule(() => {
        const to = Math.random() < 0.5 ? 'prosecutor' : 'defendant';
        g.askJuryQuestion(b.id, to, BOT_QUESTIONS[Math.floor(Math.random() * BOT_QUESTIONS.length)]);
      }, rand(speechSeconds * 400));
    }
  }

  maybeReactions(side) {
    // Bot-esküdtek eséllyel reagálnak a beszélőre.
    const g = this.game;
    const jurors = Array.from(g.players.values()).filter((p) => p.isBot && p.connected);
    if (jurors.length === 0) return;
    const count = Math.floor(Math.random() * 3);
    const emojis = ['😂', '💀', '🤡', '🔥', '👏'];
    for (let i = 0; i < count; i++) {
      const b = jurors[Math.floor(Math.random() * jurors.length)];
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      this.schedule(() => g.handleReaction(b.id, emoji), rand(9000));
    }
  }
}

module.exports = { BotManager, BOT_NAMES, BOT_AVATAR };
