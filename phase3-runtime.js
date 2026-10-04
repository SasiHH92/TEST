'use strict';
const assert = require('assert/strict');
const { Game, DEFAULT_SETTINGS } = require('../game');
const original = {now:Date.now, setTimeout, clearTimeout};
let now = 1700000000000, seq = 1, checks = 0;
const timers = new Map();
Date.now = () => now;
global.setTimeout = (fn, delay=0) => {const id=seq++;timers.set(id,{fn,at:now+delay});return id;};
global.clearTimeout = id => timers.delete(id);
function advance(ms) {
  const until=now+ms;
  for(let i=0;i<1000;i++) {
    let next;
    for(const item of timers) if(item[1].at<=until&&(!next||item[1].at<next[1].at)) next=item;
    if(!next) {now=until;return;}
    now=next[1].at;timers.delete(next[0]);next[1].fn();
  }
  throw new Error('Timer loop');
}
function make(n=8, settings={}) {
  const events=[];
  const g=new Game('ROOM',{to:room=>({emit:(event,data)=>events.push({room,event,data})})});
  for(let i=0;i<n;i++) g.addPlayer('p'+i,'Játékos '+i,'paróka',i===0);
  g.startGame({modes:['cs'],rounds:5,autoNextRound:false,autoNewGame:false,...settings},'p0');
  g.events=events;
  return g;
}
function test(label, fn) {fn();checks++;console.log('PASS '+label);}
try {
  test('automatika alapból bekapcsolva',()=>{
    assert.equal(DEFAULT_SETTINGS.autoNextRound,true);assert.equal(DEFAULT_SETTINGS.autoNewGame,true);
  });
  for(const [slot,kind] of [['prosecutorId','prosecution'],['defendantId','defense'],['defenderId','defender'],['witnessId','witness'],['currentJudgeId','prosecution']]) {
    test('20 mp után '+slot+' átadása ugyanazokkal a kártyákkal',()=>{
      const g=make(),d=g.roundData,from=d[slot];
      const cards=JSON.stringify([d.evidence,d.alibi,d.tricks,d.witnessCard,d.challenges.map(c=>c.text)]);
      if(kind==='witness') g.setPhase('witness',60000,()=>g.runClosing('final_prosecution'));
      else g.runSpeech(kind,60000);
      for(const id of d.voters) {d.votes[id]={verdict:'guilty'};d.challengeVotes[id]={prosecutor:true};}
      g.getPlayer(from).score=7;
      g.handleDisconnect(from);advance(19999);
      assert.equal(d[slot],from);
      advance(1);
      const to=d[slot];assert.notEqual(to,from);assert(g.getPlayer(to).connected);
      assert.equal(JSON.stringify([d.evidence,d.alibi,d.tricks,d.witnessCard,d.challenges.map(c=>c.text)]),cards);
      if(slot!=='currentJudgeId') {
        assert(!d.voters.includes(to));assert(!d.challengeVoters.includes(to));
        assert.equal(d.votes[to],undefined);assert.equal(d.challengeVotes[to],undefined);
        assert.equal(g.phaseEndsAt-now,40000);
      } else assert(![d.prosecutorId,d.defendantId,d.defenderId,d.witnessId].includes(to));
      g.handleReconnect(from);
      assert(![d.prosecutorId,d.defendantId,d.defenderId,d.witnessId,d.currentJudgeId].includes(from));
      assert.equal(g.getPlayer(from).score,7);
      g.dispose();
    });
  }
  test('20 mp-en belüli reconnect megtartja a szerepet',()=>{
    const g=make(),d=g.roundData,from=d.defendantId;
    g.runSpeech('defense',60000);g.handleDisconnect(from);advance(19000);
    g.addPlayer(from,g.getPlayer(from).name,'paróka',false);g.handleReconnect(from);advance(2000);
    assert.equal(d.defendantId,from);assert.equal(g.phaseEndsAt-now,39000);g.dispose();
  });
  test('átadott beszédből legalább 15 mp marad',()=>{
    const g=make(),d=g.roundData;g.runSpeech('defense',30000);
    g.handleDisconnect(d.defendantId);advance(20000);
    assert.equal(g.phaseEndsAt-now,15000);g.dispose();
  });
  test('host 30 mp után a legrégebben bent lévőé, szerep 20 mp után',()=>{
    const g=make();g.handleDisconnect('p0');advance(20000);
    assert.equal(g.hostId(),'p0');advance(9999);assert.equal(g.hostId(),'p0');
    advance(1);assert.equal(g.hostId(),'p1');g.handleReconnect('p0');
    assert.equal(g.hostId(),'p1');g.dispose();
  });
  test('host reconnect 30 mp előtt visszavonja az átadási időzítőt',()=>{
    const g=make();g.handleDisconnect('p0');advance(25000);g.handleReconnect('p0');advance(6000);
    assert.equal(g.hostId(),'p0');g.dispose();
  });
  test('pótolhatatlan vádlott esetén a kör kimarad',()=>{
    const g=make(4),round=g.round;g.handleLeave(g.roundData.defendantId);
    assert.equal(g.round,round+1);assert.equal(g.phase,'accusation');assert.equal(g.activePlayers().length,3);g.dispose();
  });
  test('pótolhatatlan tanú kimarad, kártyája a felfedéshez megmarad',()=>{
    const g=make(4),d=g.roundData,card=d.witnessCard;g.handleLeave(d.witnessId);
    assert.equal(g.round,1);assert.equal(d.witnessId,null);assert.equal(d.witnessCard,card);g.dispose();
  });
  test('három fő alatt lobby, auto időzítő nélkül',()=>{
    const g=make(3,{autoNextRound:true,autoNewGame:true});g.handleLeave('p1');
    assert.equal(g.phase,'lobby');assert.equal(g.autoAdvance,null);advance(10000);assert.equal(g.phase,'lobby');g.dispose();
  });
  for(const phase of ['lobby','prosecution','game_over']) {
    test('explicit kilépés: '+phase+', játékos törölve, pont néven archiválva',()=>{
      const g=make();g.clearTimers();g.phase=phase;g.getPlayer('p0').score=9;g.handleLeave('p0');
      assert.equal(g.getPlayer('p0'),undefined);assert.equal(g.hostId(),'p1');
      if(phase!=='lobby') {
        assert.equal(g.scoreList().find(p=>p.name==='Játékos 0').score,9);
        g.addPlayer('új-id','Játékos 0','paróka',false);
        assert.equal(g.getPlayer('új-id').score,9);assert.equal(g.archivedPlayers.size,0);
      }
      g.dispose();
    });
  }
  test('kirúgás azonnali szerepátadással, pontmegőrzéssel és tiltással',()=>{
    const g=make(),d=g.roundData,from=d.prosecutorId;g.getPlayer(from).score=11;
    g.runSpeech('prosecution',60000);assert(g.kickPlayer(from));
    assert.notEqual(d.prosecutorId,from);assert.equal(g.getPlayer(from),undefined);
    assert(g.kickedIds.has(from));assert.equal(g.scoreList().find(p=>p.id===from).score,11);
    assert.equal(g.phaseEndsAt-now,60000);g.dispose();
  });
  test('következő kör pontosan 5 mp után; kézi lépés nem dupláz',()=>{
    const g=make(5,{autoNextRound:true});g.buildRoundResults();g.setPhase('round_results',0,null);
    assert.equal(g.autoAdvance.endsAt-now,5000);advance(4999);assert.equal(g.round,1);
    advance(1);assert.equal(g.round,2);
    g.buildRoundResults();g.setPhase('round_results',0,null);g.nextAfterResults('p1');assert.equal(g.round,2);
    g.nextAfterResults('p0');assert.equal(g.round,3);advance(5000);assert.equal(g.round,3);g.dispose();
  });
  test('auto új játék ugyanabban a szobában, nullázott pontokkal',()=>{
    const g=make(5,{rounds:1,autoNewGame:true});g.getPlayer('p0').score=12;
    g.archivedPlayers.set('old',{id:'old',name:'Kilépett',score:10});g.kickedNames.add('old');
    g.nextRound();assert.equal(g.phase,'game_over');advance(4999);assert.equal(g.phase,'game_over');
    advance(1);assert.equal(g.phase,'accusation');assert.equal(g.round,1);assert.equal(g.code,'ROOM');
    assert.equal(g.getPlayer('p0').score,0);assert.equal(g.archivedPlayers.size,0);assert.equal(g.kickedNames.size,0);
    assert.equal(g.activePlayers().length,5);assert.deepEqual(g.settings.modes,['cs']);g.dispose();
  });
  test('MEGÁLLÍT csak hostnak, majd ÚJ JÁTÉK MOST újraindíthat',()=>{
    const g=make(5,{rounds:1,autoNewGame:true});g.nextRound();
    assert(!g.stopAutomaticRestart('p1'));assert(g.stopAutomaticRestart('p0'));
    advance(10000);assert.equal(g.phase,'game_over');assert.equal(g.autoAdvance,null);
    assert(!g.restartGame('p1'));assert(g.restartGame('p0'));assert.equal(g.phase,'accusation');g.dispose();
  });
  test('kikapcsolt auto kapcsoló esetén nincs automatikus váltás',()=>{
    const g=make(5,{rounds:1});g.buildRoundResults();g.setPhase('round_results',0,null);
    advance(6000);assert.equal(g.phase,'round_results');g.nextAfterResults('p0');
    advance(6000);assert.equal(g.phase,'game_over');g.dispose();
  });
  test('szobaesemények a szobára, személyes állapot a saját szobaazonosítóra mennek',()=>{
    const g=make();g.events.length=0;g.broadcastAll('probe',{});g.broadcast();
    assert.equal(g.events[0].room,'ROOM');
    assert(g.events.filter(e=>e.event==='state').every(e=>e.room.startsWith('p:ROOM:')));
    assert(g.publicState('p0').players.every(p=>!('sessionToken' in p)));g.dispose();
  });
  console.log(checks+' szobakezelési ellenőrzés sikeres.');
} finally {
  Date.now=original.now;global.setTimeout=original.setTimeout;global.clearTimeout=original.clearTimeout;
}
