'use strict';
const {spawnSync}=require('child_process');
const path=require('path');
const suites=['modes','mode-content','card-visibility','challenge-judge','juror-points','round-judge','role-texts','leave-during-game','afk-guard','phase2-runtime','phase3-runtime','profile-stats','quests','shop','social','legends','chat','claims','accounts-admin','discord-bg','dm','leaderboard','ops','security','privacy','moderation','avatar-roles','asset-policy','gamestate','stress-bots'];
let failures=0;
for(const name of suites) {
  const result=spawnSync(process.execPath,[path.join(__dirname,name+'.js')],{encoding:'utf8',timeout:30000});
  if(result.status!==0) {failures++;console.error('FAIL '+name+'\n'+result.stdout+result.stderr+(result.error||''));}
  else console.log('PASS '+name+': '+result.stdout.trim().split('\n').pop());
}
console.log(suites.length+' tesztcsoport, '+failures+' hibás.');
process.exitCode=failures?1:0;
