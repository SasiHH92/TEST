'use strict';
// Complete 3-round games with the real BotManager, 3 through 8 participants.
// A virtual clock runs its actual scheduled callbacks without waiting minutes.
// test/e2e-bots.js separately checks real clocks and Socket.io over two rounds.
const assert=require('assert/strict');
const {Game}=require('../game');
const original={now:Date.now,random:Math.random,setTimeout,clearTimeout};
const timers=new Map();
let now=1700000000000,sequence=1,seed=1;
Date.now=()=>now;
Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
global.setTimeout=(fn,ms=0)=>{const id=sequence++;timers.set(id,{fn,at:now+ms});return id;};
global.clearTimeout=id=>timers.delete(id);
function advance(ms) {
  const until=now+ms;
  for(let i=0;i<10000;i++) {
    let next;
    for(const entry of timers) if(entry[1].at<=until&&(!next||entry[1].at<next[1].at)) next=entry;
    if(!next) {now=until;return;}
    now=next[1].at;timers.delete(next[0]);next[1].fn();
  }
  throw new Error('Unbounded bot timer loop');
}
function human(g) {
  const d=g.roundData;if(!d)return;
  const speakers={prosecution:d.prosecutorId,defense:d.defendantId,defender:d.defenderId,witness:d.witnessId,final_prosecution:d.prosecutorId,final_defense:d.defendantId};
  if(g.phase==='accusation'&&d.defendantId==='human')g.accusationRead();
  else if(speakers[g.phase]==='human')g.doneSpeaking('human');
  else if(g.phase==='objection') {
    if(g.objectionData.phase==='defense'&&g.objectionData.speakerId==='human')g.objectionDefenseDone('human');
    else if(g.objectionData.phase==='judge'&&d.currentJudgeId==='human')g.objectionJudgeDecision('human',Math.random()<.5);
  } else if(g.phase==='verdict_vote'&&d.voters.includes('human')&&!d.votes.human)g.castVerdictVote('human',Math.random()<.5?'guilty':'not_guilty');
  else if(g.phase==='challenge_vote'&&d.challengeVoters.includes('human')) {
    for(const ch of d.challenges)if(d.challengeVotes.human?.[ch.who]===undefined)g.castChallengeVote('human',ch.who,true);
  } else if(g.phase==='challenge_review'&&d.currentJudgeId==='human') {
    const ch=g.currentChallenge();if(ch&&d.challengeDecisions[ch.who]===undefined)g.resolveChallenge('human',ch.who,true);
  }
}
try {
  const total=parseInt(process.argv[2],10)||6;
  for(let run=0;run<total;run++) {
    const count=3+run%6, mode=['repo','cs','pubg','minecraft','roblox','buli'][run%6];
    seed=123456+run*7919;
    const g=new Game('BOT'+run,{to:()=>({emit:()=>{}})});
    g.addPlayer('human','Ember','paróka',true);
    for(let k=1;k<count;k++)g.addBot();
    g.startGame({modes:[mode],rounds:3,speechSeconds:15,defenderSeconds:15,prepSeconds:10,witnessSeconds:10,closingSeconds:10,challengeMode:run%2?'jury':'judge',autoNextRound:true,autoNewGame:false},'human');
    const start=now, phases=new Set(),judges=new Map();
    let objections=0,lastPhase='';
    while(g.phase!=='game_over'&&now-start<600000) {
      phases.add(g.phase);
      if(g.phase==='objection'&&lastPhase!=='objection')objections++;
      lastPhase=g.phase;
      if(g.roundData) {
        const d=g.roundData;
        judges.set(g.round,d.currentJudgeId);
        const holders=[d.currentJudgeId,d.prosecutorId,d.defendantId,d.defenderId,d.witnessId].filter(Boolean);
        assert.equal(new Set(holders).size,holders.length,'role holders are distinct');
        assert.equal(d.mode,mode);
      }
      human(g);advance(500);
    }
    assert.equal(g.phase,'game_over','stuck at '+g.phase);
    assert.equal(g.round,3);assert.equal(judges.size,3);
    assert.notEqual(judges.get(1),judges.get(2));assert.notEqual(judges.get(2),judges.get(3));
    assert(phases.has('verdict_vote')&&phases.has('round_results'));
    assert(phases.has(run%2?'challenge_vote':'challenge_review'));
    assert.equal(g.finalResults().ranking.length,count);
    if(count>=5)assert(phases.has('defender'));
    console.log('PASS '+count+' játékos, '+mode+', 3 kör, '+((now-start)/1000).toFixed(1)+' virtuális mp, '+objections+' tiltakozás');
    g.dispose();assert.equal(timers.size,0,'no abandoned timers');
  }
  console.log('HIBÁS: 0/'+total);
} finally {
  Date.now=original.now;Math.random=original.random;global.setTimeout=original.setTimeout;global.clearTimeout=original.clearTimeout;
}
