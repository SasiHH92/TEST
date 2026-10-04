'use strict';
const assert = require('assert/strict');
const { Game } = require('../game');
const old = {now:Date.now,setTimeout,clearTimeout};
let now = 1700000000000, nextId = 1;
const timers = new Map();
Date.now = () => now;
global.setTimeout = (fn, ms=0) => {const id=nextId++;timers.set(id,{fn,at:now+ms});return id;};
global.clearTimeout = id => timers.delete(id);
function advance(ms) {
  const end=now+ms;
  for(let count=0;count<1000;count++) {
    let due;
    for(const entry of timers) if(entry[1].at<=end&&(!due||entry[1].at<due[1].at)) due=entry;
    if(!due) {now=end;return;}
    now=due[1].at; timers.delete(due[0]); due[1].fn();
  }
  throw new Error('Unbounded timer loop');
}
function game(n=8) {
  const g=new Game('TEST',{to:()=>({emit:()=>{}}),emit:()=>{}});
  for(let i=0;i<n;i++) g.addPlayer('p'+i,'Player '+i,'paróka',i===0);
  g.startGame({modes:['cs'],rounds:30,autoNextRound:false,autoNewGame:false},'p0');
  return g;
}
let assertions=0;
function check(fn,label) {fn();assertions++;console.log('PASS '+label);}
try {
  for(let n=3;n<=8;n++) {
    const g=game(n);let last;
    for(let r=0;r<20;r++) {
      const d=g.roundData;
      assert.notEqual(d.currentJudgeId,last);
      assert(![d.prosecutorId,d.defendantId,d.defenderId,d.witnessId].includes(d.currentJudgeId));
      assert.equal(!!d.defenderId,n>=5);
      last=d.currentJudgeId;g.nextRound();
    }
    check(()=>assert(Math.max(...g.judgeCounts.values())-Math.min(...g.judgeCounts.values())<=1),'bíró rotáció '+n+' játékossal');
    g.dispose();
  }
  {
    const g=game(),d=g.roundData;
    g.phase='prep';
    check(()=>assert.equal(g.publicState(d.witnessId).witnessCard,d.witnessCard),'tanú kártya a felkészülésben');
    for(const phase of ['prosecution','defense','defender','witness','final_prosecution','final_defense','verdict_vote','objection','challenge_review']) {
      g.phase=phase;
      for(const id of g.players.keys()) {
        const st=g.publicState(id);
        assert.equal(!!st.alibi,id===d.defendantId);assert.equal(st.witnessCard,undefined);
        assert.equal(!!st.myChallenge,d.challenges.some(c=>c.id===id));
        assert.equal(!!st.evidence,id===d.prosecutorId||id===d.defenderId);
        assert.equal(!!st.tricks,id===d.defenderId);
        assert.equal(!!st.judgeWatch,id===d.currentJudgeId);
      }
    }
    check(()=>assert(true),'titkos adatok címzettjei minden beszéd/tiltakozás fázisban');
    g.phase='round_results';
    check(()=>assert.equal(g.publicState(d.witnessId).revealedCards.alibi,d.alibi),'kör végi nyilvános felfedés');
    g.dispose();
  }
  {
    const g=game(),d=g.roundData;
    g.runSpeech('prosecution',60000);
    check(()=>assert(g.tryObjection(d.defendantId)),'tiltakozás indul');
    check(()=>assert(!g.tryObjection(d.defenderId)),'függő tiltakozás alatt nincs újabb');
    check(()=>assert(!g.objectionDefenseDone(d.defendantId)),'csak a megtámadott beszélő fejezheti be');
    assert(g.objectionDefenseDone(d.prosecutorId));
    check(()=>assert.equal(g.phaseEndsAt-now,15000),'korai védekezés után új 15 mp-es döntési idő');
    check(()=>assert(!g.objectionJudgeDecision(d.defendantId,true)),'idegen bírói döntés elutasítása');
    assert(g.objectionJudgeDecision(d.currentJudgeId,false));
    check(()=>assert.equal(g.phase,'prosecution'),'beszéd azonnali folytatása');
    g.afterSpeech('prosecution');
    check(()=>assert.equal(g.phaseEndsAt-now,40000),'elutasított tiltakozás: következő beszédből 20 mp levonás');
    check(()=>assert.equal(d.objectionLog[0].deductionMs,20000),'jegyzőkönyvi levonás');
    g.dispose();
  }
  {
    const g=game(),d=g.roundData;g.runSpeech('defense',22000);
    assert(g.tryObjection(d.prosecutorId));advance(20000);
    check(()=>assert.equal(g.objectionData.phase,'judge'),'20 mp után bírói döntési szakasz');
    assert(g.objectionJudgeDecision(d.currentJudgeId,true));
    check(()=>assert.equal(g.phaseEndsAt-now,5000),'jogos tiltakozás után legalább 5 mp marad');
    g.dispose();
  }
  {
    const g=game(),d=g.roundData;g.runSpeech('prosecution',60000);
    assert(g.tryObjection(d.defendantId));g.objectionDefenseDone(d.prosecutorId);advance(15000);
    check(()=>assert.equal(g.phase,'prosecution'),'korai védekezés után időtúllépés sem akad el');
    check(()=>assert.equal(d.objectionLog[0].timedOut,true),'időtúllépés elutasításként naplózva');
    g.dispose();
  }
  {
    const g=game(),d=g.roundData;g.runClosing('final_defense');
    assert(g.tryObjection(d.prosecutorId));g.objectionDefenseDone(d.defendantId);
    g.objectionJudgeDecision(d.currentJudgeId,false);
    check(()=>assert.deepEqual(d.speechPenalties,{}),'utolsó beszéd után nincs későbbi levonás');
    g.dispose();
  }
  {
    const g=game(),d=g.roundData;g.runSpeech('prosecution',60000);
    assert(g.tryObjection(d.defendantId));g.objectionDefenseDone(d.prosecutorId);
    const oldJudge=d.currentJudgeId;advance(5000);g.handleDisconnect(oldJudge);
    check(()=>assert.notEqual(d.currentJudgeId,oldJudge),'kieső bíró pótlása');
    check(()=>assert.equal(g.phaseEndsAt-now,15000),'új bíró döntési ideje újraindul');
    check(()=>assert(!g.objectionJudgeDecision(oldJudge,true)),'régi bíró már nem dönthet');
    assert(g.objectionJudgeDecision(d.currentJudgeId,true));g.dispose();
  }
  {
    const g=game(),d=g.roundData;g.startChallengeReview();
    const ch=g.currentChallenge();
    check(()=>assert(!g.resolveChallenge(d.prosecutorId,ch.who,true)),'kihívásról csak a bíró dönthet');
    advance(20000);
    check(()=>assert.equal(d.challengeDecisions[ch.who],false),'kihívás 20 mp-es időtúllépése');
    g.dispose();
  }
  console.log(assertions+' ellenőrzés sikeres.');
} finally {
  Date.now=old.now;global.setTimeout=old.setTimeout;global.clearTimeout=old.clearTimeout;
}
