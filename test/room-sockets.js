'use strict';
const assert=require('assert/strict');
const {spawn}=require('child_process');
const path=require('path');
const io=require('socket.io-client');
const PORT=3183, URL='http://127.0.0.1:'+PORT;
const sockets=[];
let checks=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function emit(s,event,payload={}) {
  return new Promise((resolve,reject)=>{
    const t=setTimeout(()=>reject(new Error('Ack timeout: '+event)),4000);
    s.emit(event,payload,res=>{clearTimeout(t);resolve(res);});
  });
}
async function connect() {
  const s=io(URL,{transports:['websocket'],reconnection:false});sockets.push(s);
  s.states=[];s.on('state',st=>{s.lastState=st;s.states.push(st);});
  await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);});
  return s;
}
function pass(label) {checks++;console.log('PASS '+label);}
(async()=>{
  const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(PORT)},stdio:['ignore','ignore','pipe']});
  let errors='';child.stderr.on('data',d=>{errors+=d;});
  try {
    let ready=false;
    for(let i=0;i<50;i++) {try{ready=(await fetch(URL+'/health')).ok;}catch(e){}if(ready)break;await pause(100);}
    assert(ready,'Server startup');
    const host=await connect();
    const created=await emit(host,'create_room',{name:'Socket Host',playerId:'host'});
    assert(created.code&&created.sessionToken);assert(!JSON.stringify(created.state).includes(created.sessionToken));
    pass('privát reconnect azonosító nem kerül a publikus állapotba');
    const peers=[];
    for(let i=1;i<8;i++) {
      const s=await connect();const joined=await emit(s,'join_room',{code:created.code,name:'Socket '+i,playerId:'p'+i});
      assert(!joined.error);peers.push({s,id:'p'+i,token:joined.sessionToken});
    }
    const visitor=await connect();
    const full=await emit(visitor,'join_room',{code:created.code,name:'Ninth',playerId:'p9'});
    assert.match(full.error,/tele/);pass('maximum 8 résztvevő');
    const other=await emit(visitor,'create_room',{name:'Other Host',playerId:'host'});
    visitor.states.length=0;let leakedWarning=false;
    visitor.on('host_warning',()=>{leakedWarning=true;});
    const bad=await emit(host,'start_game',{settings:{modes:[]}});assert(bad.error);
    await pause(50);assert(!leakedWarning);assert(visitor.states.every(st=>st.players.some(p=>p.name==='Other Host')));
    pass('másik szoba azonos playerId mellett sem kap állapotot vagy figyelmeztetést');
    const impersonation=await emit(visitor,'join_room',{code:created.code,name:'Socket Host',playerId:'host'});
    assert.match(impersonation.error,/munkamenet/);pass('publikus playerId nem használható host megszemélyesítésére');
    assert((await emit(peers[0].s,'start_game',{settings:{modes:['cs']}})).error);
    assert((await emit(peers[0].s,'kick_player',{playerId:'p2'})).error);
    assert((await emit(host,'kick_player',{playerId:'host'})).error);
    pass('csak host indíthat/kirúghat, saját magát nem');
    const started=await emit(host,'start_game',{settings:{modes:['cs'],autoNextRound:false,autoNewGame:false}});
    assert(!started.error);await pause(50);assert.equal(host.lastState.phase,'accusation');
    let orderCount=0;host.on('order_in_court',()=>{orderCount++;});
    const judge=host.lastState.currentJudgeId;
    const judgeSocket=judge==='host'?host:peers.find(p=>p.id===judge).s;
    const notJudge=judge==='host'?peers[0].s:host;
    notJudge.emit('order_in_court');await pause(40);assert.equal(orderCount,0);
    judgeSocket.emit('order_in_court');await pause(40);assert.equal(orderCount,1);
    pass('Rendet a teremben kizárólag a körbíró jogosultsága');
    const roleIds=[host.lastState.prosecutorId,host.lastState.defendantId,host.lastState.defenderId,host.lastState.witnessId,judge];
    const target=peers.find(p=>!roleIds.includes(p.id));assert(target);
    let kicked=false;target.s.on('you_are_kicked',()=>{kicked=true;});
    assert((await emit(host,'kick_player',{playerId:target.id})).ok);await pause(50);
    assert(kicked);assert(!host.lastState.players.some(p=>p.id===target.id));
    const blocked=await emit(visitor,'join_room',{code:created.code,name:'Socket '+target.id.slice(1),playerId:target.id,sessionToken:target.token});
    assert.match(blocked.error,/kirúgott/);
    const blockedName=await emit(visitor,'join_room',{code:created.code,name:'Socket '+target.id.slice(1),playerId:'changed-id'});
    assert.match(blockedName.error,/kirúgott/);pass('kirúgott értesítve/törölve, a visszalépése elutasítva');
    const rejoin=peers.find(p=>p!==target&&p.id!==judge);
    rejoin.s.disconnect();await pause(80);
    const replacement=await connect();
    const restored=await emit(replacement,'join_room',{code:created.code,name:'Socket '+rejoin.id.slice(1),playerId:rejoin.id,sessionToken:rejoin.token});
    assert(!restored.error);assert(restored.state.players.find(p=>p.id===rejoin.id).connected);
    assert.equal(restored.state.caseNo,host.lastState.caseNo);pass('korai reconnect ugyanazt az ügyet és játékost adja vissza');
    const nextHost=restored.state.players.find(p=>p.id!=='host'&&p.connected).id;
    let statesAfterLeave=0;
    await emit(host,'leave_room');host.on('state',()=>{statesAfterLeave++;});await pause(80);
    assert.equal(statesAfterLeave,0);assert(!replacement.lastState.players.some(p=>p.id==='host'));
    assert.equal(replacement.lastState.hostId,nextHost);pass('explicit host kilépés: törlés, socket.leave és hostátadás');
    assert.equal(errors,'',errors);
    console.log(checks+' Socket.io ellenőrzés sikeres.');
  } finally {
    sockets.forEach(s=>s.disconnect());child.kill();
    await new Promise(r=>child.once('exit',r));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
