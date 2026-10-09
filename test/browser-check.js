'use strict';
// npm install --no-save playwright; npx playwright install chromium
// CHROMIUM_PATH=/path/to/chromium QA_SCREENSHOTS=./QA_SCREENSHOTS npm run test:browser
// QA_REPORT_PATH optionally selects the JSON report's path.
const { spawn } = require('child_process');
const { Game } = require('../game');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const PORT = Number(process.env.QA_PORT || 3199);
const URL = 'http://127.0.0.1:' + PORT;
const sizes = [[1366,768],[1643,600],[1920,1080],[390,844],[360,640]];
const phases = ['accusation','prep','prosecution','defense','defender','witness',
  'final_prosecution','final_defense','verdict_vote','verdict','challenge_review',
  'challenge_vote','objection','round_results','game_over'];
const screenshotPhases = ['accusation','prosecution','verdict_vote','verdict'];
const speechRoles = {prosecution:'prosecutor',defense:'defendant',defender:'defender',
  witness:'witness',final_prosecution:'prosecutor',final_defense:'defendant'};

// Real publicState payloads: private cards stay with their authorized viewers.
// Bot flags keep QA verdicts out of the persistent player registry.
function fixture(phase, viewerRole) {
  const g = new Game('QA42', { to: () => ({ emit: () => {} }) });
  try {
    const names = ['Sándor','Szipuska','Nyomozó','Marci','Hosszú név teszt','Védő','Tanú','Esküdt'];
    for (let i=0; i<names.length; i++) {
      g.addPlayer('u'+i, names[i], 'paróka', i===0);
      g.players.get('u'+i).isBot = true;
    }
    g.startGame({modes:['cs'],rounds:2,autoNextRound:false,autoNewGame:false}, 'u0');
    const d = g.roundData;
    assert.ok(d, 'A QA játék elindult.');
    d.caseNo = 'QA-' + phase;
    const roles = {prosecutor:d.prosecutorId,defendant:d.defendantId,
      defender:d.defenderId,witness:d.witnessId,judge:d.currentJudgeId,
      juror:d.voters.find(id=>id!==d.currentJudgeId)};
    let myId = roles[speechRoles[phase] || 'prosecutor'];
    if (phase==='accusation') myId = d.defendantId;
    if (phase==='verdict_vote' || phase==='challenge_vote') {
      myId = d.voters.find(id=>id!==d.currentJudgeId) || d.currentJudgeId;
    }
    if (phase==='objection') {
      g.runSpeech('prosecution', 60000);
      assert.ok(g.tryObjection(d.defendantId), 'Tiltakozás-fixture');
      g.objectionData.phase = 'judge';
      g.objectionData.judgeEndsAt = Date.now()+15000;
      g.phaseEndsAt = Date.now()+15000;
      myId = d.currentJudgeId;
    } else if (phase==='challenge_review') {
      g.startChallengeReview();
      myId = d.currentJudgeId;
    } else if (['verdict','round_results','game_over'].includes(phase)) {
      for (const id of d.voters) d.votes[id] = {verdict:'guilty'};
      g.revealVerdict();
      for (let i=0; i<names.length; i++) g.players.get('u'+i).score = names.length-i;
      if (phase==='round_results') {g.buildRoundResults(); g.phase = phase;}
      if (phase==='game_over') {g.round = g.settings.rounds; g.nextRound();}
      myId = g.hostId();
    } else {
      g.phase = phase;
      g.phaseEndsAt = Date.now()+60000;
      if (phase==='challenge_vote') g.settings.challengeMode = 'jury';
    }
    if (viewerRole) myId = roles[viewerRole];
    assert.ok(myId, 'A QA néző szerepe létezik: ' + (viewerRole || phase));
    return {state:g.publicState(myId), myId};
  } finally {g.dispose();}
}

function inspectLayout() {
  const errors = [];
  const rect = el => {
    const r=el.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};
  };
  const visible = el => el && el.getClientRects().length &&
    getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none';
  const identify = el => el.id || el.dataset.role || el.textContent.trim().slice(0,48);
  const overlap = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1 &&
    Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
  const inside = (r,area) => r.left>=area.left-1 && r.right<=area.right+1 &&
    r.top>=area.top-1 && r.bottom<=area.bottom+1;
  const viewport = {left:0,top:0,right:innerWidth,bottom:innerHeight};
  const hudArea = {...viewport,right:innerWidth-(innerWidth>900?280:0)};
  const scene = rect(document.querySelector('#stageZone'));
  if (!inside(scene,viewport) || scene.height<innerHeight-1 || scene.width<innerWidth-1) {
    errors.push('A terem nem tölti ki a képernyőt a ponttábla mögött is.');
  }
  if (document.documentElement.scrollHeight>innerHeight+1 ||
      document.documentElement.scrollWidth>innerWidth+1) errors.push('Oldalgörgetés.');
  const panel = document.querySelector('#scenePanel');
  if (!inside(rect(panel),hudArea)) errors.push('A fázispanel kilóg.');
  if (rect(panel).height>innerHeight*.45+1) errors.push('A fázispanel magasabb 45%-nál.');
  const hud = [...document.querySelectorAll(
    '#scenePanel, #accusationTicker, #roleBanner, .info-bar, #judgeWatchBar, #myCardsBar'
  )].filter(visible);
  const charge = document.querySelector('#accusationTicker');
  if (!visible(charge)) errors.push('Hiányzó vád-tábla.');
  else {
    if (!inside(rect(charge),hudArea)) errors.push('A vád-tábla kilóg.');
    for (const el of hud) {
      if (el!==charge && overlap(rect(charge),rect(el))) errors.push('A vádot takarja: '+identify(el));
    }
  }
  const plates = [...document.querySelectorAll('#stagePlates .stage-plate, #stageSlots .stage-jury-more')];
  if (!plates.length || !document.querySelector('#judgePlate')) errors.push('Hiányzó névtáblák.');
  for (const [i,plate] of plates.entries()) {
    const r=rect(plate);
    if (!inside(r,hudArea)) errors.push('Kilógó névtábla: '+identify(plate));
    for (const el of hud) if (overlap(r,rect(el))) errors.push('Takart névtábla: '+identify(plate)+' / '+identify(el));
    for (const other of plates.slice(i+1)) {
      if (overlap(r,rect(other))) errors.push('Egymást takaró névtáblák: '+identify(plate)+' / '+identify(other));
    }
  }
  // Hit tests catch overlays as well as overflowing boxes.
  const targets = [...document.querySelectorAll(
    '#phaseContent button, #timerBox, #btnLeaveGame, #btnMute, #btnReduceMotion, ' +
    '.info-bar [data-help], #mcbToggle, #jwHead, .jw-note, #sbToggle'
  )].filter(visible).filter(el=>!el.closest('.results-scroll, .verdict-scroll, .mcb-body, .jw-body'));
  const checkedControls = [];
  for (const el of targets) {
    const r=rect(el), id=identify(el);
    checkedControls.push(id);
    if (!inside(r,viewport)) errors.push('Kilógó vezérlő: '+id);
    if (el.closest('#phaseContent') && !inside(r,rect(document.querySelector('#phaseContent')))) {
      errors.push('A panel levágja a vezérlőt: '+id);
    }
    if (el.tagName==='BUTTON' && innerWidth<=700 && r.height<47.5) errors.push('48px-nél kisebb telefonos gomb: '+id);
    if (el.disabled) continue;
    for (const [x,y] of [[.5,.5],[.2,.2],[.8,.8]]) {
      const hit=document.elementFromPoint(r.left+r.width*x,r.top+r.height*y);
      if (!hit || (hit!==el && !el.contains(hit))) {
        errors.push('Nem érhető el a vezérlő: '+id+' (takaró: '+(hit?identify(hit):'képernyőn kívül')+')');
        break;
      }
    }
  }
  const timer = document.querySelector('#timerBox');
  if (visible(timer)) {
    for (const el of hud.filter(el=>el!==panel && !panel.contains(el))) {
      if (overlap(rect(timer),rect(el))) errors.push('Takart visszaszámláló: '+identify(el));
    }
    const defendant=document.querySelector('.stage-slot[data-role="defendant"] .st-base');
    if (visible(defendant)) {
      const r=rect(defendant);
      const face={left:r.left+r.width*.25,right:r.right-r.width*.25,
        top:r.top+r.height*.04,bottom:r.top+r.height*.30};
      if (overlap(face,rect(timer))) errors.push('A visszaszámláló takarja a vádlott arcát.');
    }
  }
  const sidebarRect=rect(document.querySelector('#scoreSidebar'));
  if (innerWidth>900 && Math.abs(sidebarRect.width-280)>1) errors.push('A ponttábla szélessége nem 280px.');
  if (innerWidth<=700 && document.querySelectorAll('#stageSlots [data-role="juror"]').length>3) {
    errors.push('Telefonon háromnál több esküdt látszik.');
  }
  for (const img of document.querySelectorAll('#stage .st-base, #stage .stage-bg')) {
    if (!img.naturalWidth && !img.closest('.asset-missing, .room-missing')) errors.push('Kép tartalék nélkül: '+img.getAttribute('src'));
    if (/_beszel/.test(img.getAttribute('src'))) errors.push('A kliens nem létező beszélőképet kér.');
  }
  return {errors:[...new Set(errors)],checkedControls,scene,panel:rect(panel),
    charge:visible(charge)?rect(charge):null,plateCount:plates.filter(el=>el.classList.contains('stage-plate')).length,
    scrollHeight:document.documentElement.scrollHeight,scrollWidth:document.documentElement.scrollWidth};
}

async function main() {
  const reportPath=path.resolve(process.env.QA_REPORT_PATH || path.join(__dirname,'browser-report.json'));
  const screenshotDir=path.resolve(process.env.QA_SCREENSHOTS || path.join(__dirname,'../QA_SCREENSHOTS'));
  const report={status:'running',sizes,phases,plannedLayouts:sizes.length*phases.length,
    plannedScreenshots:sizes.length*(screenshotPhases.length+1),plannedAuthViews:sizes.length*2,pageErrors:[],assetErrors:[],
    results:[],authResults:[],screenshots:[],extraChecks:[],startedAt:new Date().toISOString()};
  let browser,child,tempDirectory,stage='Playwright betöltése';
  try {
    const {chromium}=require('playwright');
    stage='Chromium indítása';
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
    stage='Helyi szerver indítása';
    tempDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'kamu-browser-'));
    child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(PORT),
      AUTH_BASE_URL:URL,AUTH_STORE_PATH:path.join(tempDirectory,'accounts.json'),
      AUTH_GOOGLE_CLIENT_ID:'',AUTH_GOOGLE_CLIENT_SECRET:'',AUTH_DISCORD_CLIENT_ID:'',AUTH_DISCORD_CLIENT_SECRET:'',
      AUTH_MAIL_API_KEY:'',AUTH_MAIL_FROM:''},stdio:'ignore'});
    let healthy=false;
    for (let i=0;i<60;i++) {
      try {if ((await fetch(URL+'/health')).ok) {healthy=true;break;}} catch (_) { /* startup */ }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(healthy,'A QA szerver nem indult el.');
    const page=await browser.newPage({viewport:{width:1366,height:768}});
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>report.pageErrors.push(error.message));
    page.on('response',response=>{
      if (new globalThis.URL(response.url()).pathname.startsWith('/assets/') && !response.ok()) {
        report.assetErrors.push(response.status()+' '+response.url());
      }
    });
    await page.addInitScript(()=>localStorage.setItem('kb_helpSeen','1'));
    await page.route('https://fonts.googleapis.com/**',route=>route.abort());
    await page.route('https://fonts.gstatic.com/**',route=>route.abort());
    stage='Belépőoldal, regisztráció és fiókos belépés';
    await page.goto(URL,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#screen-auth.active');
    await page.waitForFunction(()=>!document.querySelector('#authRegisterSubmit').disabled);
    await page.waitForFunction(()=>[...document.querySelectorAll('#screen-auth img')].every(img=>img.complete));
    fs.mkdirSync(screenshotDir,{recursive:true});
    for(const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      for(const tab of ['login','register']) {
        if(width<=700) await page.click(tab==='login'?'#authLoginTab':'#authRegisterTab');
        const errors=await page.evaluate(()=>{
          const failures=[];
          if(document.documentElement.scrollWidth>innerWidth+1) failures.push('A belépőoldal vízszintesen kilóg.');
          const selected=document.querySelector('.auth-forms').dataset.tab;
          const prefix=innerWidth<=700&&selected==='register'?'Register':'Login';
          const card=document.querySelector('#auth'+prefix+'Card');
          const r=card.getBoundingClientRect();
          if(r.left<0||r.right>innerWidth+1) failures.push('Az űrlap oldalra kilóg.');
          if(innerWidth<=700) {
            for(const input of card.querySelectorAll('input:not([type="checkbox"])')) {
              if(parseFloat(getComputedStyle(input).fontSize)<16) failures.push('Telefonon túl kicsi beviteli betűméret.');
            }
          }
          if(!document.querySelector('.auth-background').naturalWidth) failures.push('A belépőoldal háttere nem töltődött be.');
          return failures;
        });
        const submitSelector='#auth'+(tab==='login'?'Login':'Register')+'Submit';
        await page.locator(submitSelector).click({trial:true});
        report.authResults.push({width,height,tab,errors});
      }
      if(width<=700) await page.click('#authLoginTab');
      await page.evaluate(()=>scrollTo(0,0));
      const filename='belepes-'+width+'x'+height+'.png';
      await page.screenshot({path:path.join(screenshotDir,filename),fullPage:true});report.screenshots.push(filename);
    }
    await page.setViewportSize({width:1366,height:768});
    const accountEmail='browser-'+Date.now()+'@example.invalid',accountPassword='Böngészős jelszó 123!';
    await page.fill('#authRegisterName','FiókTeszt');await page.fill('#authRegisterEmail',accountEmail);
    await page.fill('#authRegisterPassword',accountPassword);await page.fill('#authRegisterConfirm',accountPassword);
    await page.click('#authRegisterSubmit');await page.waitForSelector('#screen-name.active');
    assert.match(await page.textContent('#accountLabel'),/FiókTeszt/);
    await page.click('#accountLabel');await page.click('#accountLogout');await page.waitForSelector('#screen-auth.active');
    await page.fill('#authLoginEmail',accountEmail);await page.fill('#authLoginPassword','Hibás jelszó 123!');
    await page.click('#authLoginSubmit');await page.waitForFunction(()=>document.querySelector('#authLoginMessage').textContent.includes('Hibás'));
    await page.fill('#authLoginPassword',accountPassword);await page.check('#authRemember');
    await page.click('#authLoginSubmit');await page.waitForSelector('#screen-name.active');
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#screen-name.active');
    assert.match(await page.textContent('#accountLabel'),/FiókTeszt/);
    await page.click('#accountLabel');await page.click('#accountLogout');await page.waitForSelector('#screen-auth.active');
    assert.equal(await page.isDisabled('[data-provider="google"]'),true);
    assert.equal(await page.isDisabled('[data-provider="discord"]'),true);
    await page.click('#authGuest');await page.waitForSelector('#screen-name.active');
    report.extraChecks.push('Belépőoldal 5 méreten; regisztráció; hibás/helyes jelszó; megjegyzés; újratöltés; kijelentkezés; vendég');
    stage='Belépési és kilépési ellenőrzés';
    await page.waitForFunction(()=>document.querySelectorAll('.mug-card').length===12);
    await page.click('#btnNewSuspect');
    await page.fill('#guestName','BrowserTeszt');
    await page.click('#btnGuestGo');
    await page.click('#btnCreate');
    await page.waitForSelector('#screen-lobby.active');
    await page.click('#btnAddBot');
    await page.click('#btnAddBot');
    await page.waitForFunction(()=>S && S.players.length===3);
    assert.equal(await page.isDisabled('#btnStartGame'),true);
    await page.click('[data-mode="cs"]');
    await page.waitForFunction(()=>S.settings.modes.includes('cs'));
    await page.click('#btnStartGame');
    await page.waitForSelector('#screen-game.active');
    assert.match(await page.textContent('#accusationTicker'),/CS/);
    await page.click('#btnLeaveGame');
    await page.click('#cfOk');
    await page.waitForSelector('#screen-menu.active');
    assert.equal(await page.evaluate(()=>localStorage.getItem('kb_code')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('kb_playerId')),null);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible('#screen-game'),false);
    report.extraChecks.push('12 nyilvántartási kártya; vendég; módválasztás; indítás; kilépés; újratöltés');
    console.log('PASS: belépés, módválasztás, indítás, kilépés és újratöltés');

    const load=async data=>{
      await page.evaluate(({state,myId})=>{
        IDENTITY_READY=true;INTENTIONAL_LEAVE=false; KICKED_FROM_ROOM=false;
        MY.playerId=myId; MY.code='QA42'; S=state; serverOffset=0;
        show('game'); renderGame(); charAnim.start(); startTimerLoop();
      },data);
      await page.waitForFunction(()=>[...document.querySelectorAll('#stage .st-base, #stage .stage-bg')].every(img=>img.complete));
      await page.waitForFunction(()=>!document.querySelector('#accusationTicker').classList.contains('charge-intro'));
      await page.waitForTimeout(600);
    };
    const check=async (width,height,phase,variant='base')=>{
      const layout=await page.evaluate(inspectLayout);
      const required=['#btnLeaveGame','#btnReduceMotion'];
      if (phase==='accusation') required.push('#iaAccRead');
      if (variant==='base' && speechRoles[phase]) required.push('#iaDone','#timerBox');
      if (phase==='prep') required.push('#timerBox');
      if (phase==='verdict_vote') required.push('#voteGuilty','#voteNotGuilty');
      if (phase==='verdict') required.push('#btnProceed','#btnRecord');
      if (phase==='challenge_review') required.push('#rvDone','#rvFail');
      if (phase==='challenge_vote') required.push('#cv0Yes','#cv0No','#cv1Yes','#cv1No','#cv2Yes','#cv2No');
      if (phase==='objection' && variant==='base') required.push('#objAccept','#objReject','#timerBox');
      if (phase==='objection' && variant==='defense') required.push('#iaDone','#timerBox');
      if (phase==='round_results') required.push('#btnNextRound');
      if (phase==='game_over') required.push('#btnNewGame','#btnLeaveAfter');
      for (const selector of required) {
        const target=page.locator(selector);
        if (!(await target.isVisible())) layout.errors.push('Hiányzó szükséges vezérlő: '+selector);
        else if (selector!=='#timerBox') {
          try {await target.click({trial:true,timeout:1200});}
          catch (_) {layout.errors.push('Nem kattintható szükséges vezérlő: '+selector);}
        }
      }
      report.results.push({width,height,phase,variant,...layout});
      if (layout.errors.length) console.log('FAIL: '+width+'x'+height+' '+phase+' '+variant+' '+layout.errors.join('; '));
    };
    fs.mkdirSync(screenshotDir,{recursive:true});
    stage='75 fázis és képernyőméret ellenőrzése';
    for (const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      for (const phase of phases) {
        await load(fixture(phase));
        await check(width,height,phase);
        if (screenshotPhases.includes(phase)) {
          const filename=phase+'-'+width+'x'+height+'.png';
          await page.screenshot({path:path.join(screenshotDir,filename)});
          report.screenshots.push(filename);
        }
      }
      for (const role of ['defendant','defender','witness','judge','juror']) {
        const data=fixture('prep',role);
        await load(data); await check(width,height,'prep',role);
        if (['defendant','defender','witness'].includes(role)) {
          assert.equal(await page.isVisible('#mcbToggle'),true,'A felkészülési kártyák elérhetők: '+role);
          const text=await page.textContent('#myCardsBar');
          for (const card of [data.state.alibi,data.state.witnessCard,...(data.state.tricks||[])].filter(Boolean)) {
            assert.ok(text.includes(card),'Hiányzó kártya: '+role);
          }
        }
      }
      await load(fixture('prosecution','judge'));
      await check(width,height,'prosecution','judge');
      await page.click('#jwHead'); await page.waitForTimeout(150);
      await check(width,height,'prosecution','judge-expanded');
      await page.click('#jwHead');
      const objection=fixture('objection','prosecutor');
      objection.state.objectionData.phase='defense';
      objection.state.objectionData.defenderEndsAt=Date.now()+20000;
      objection.state.phaseEndsAt=objection.state.objectionData.defenderEndsAt;
      await load(objection); await check(width,height,'objection','defense');
    }
    stage='Mozgás, időzítő és hiányzó kép ellenőrzése';
    await page.setViewportSize({width:390,height:844});
    await load(fixture('prosecution'));
    await page.click('#btnReduceMotion');
    assert.equal(await page.getAttribute('#btnReduceMotion','aria-pressed'),'true');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>[...charAnim.active.values()].every(anim=>!anim.fig.style.transform)),true);
    await page.click('#btnReduceMotion');
    assert.equal(await page.getAttribute('#btnReduceMotion','aria-pressed'),'false');
    await page.emulateMedia({reducedMotion:'reduce'});
    await load(fixture('accusation'));
    assert.equal(await page.getAttribute('#btnReduceMotion','aria-pressed'),'true');
    assert.equal(await page.locator('#accusationTicker.charge-intro').count(),0);
    await page.emulateMedia({reducedMotion:'no-preference'});
    const ending=fixture('prosecution'); ending.state.phaseEndsAt=Date.now()+9000;
    await load(ending);
    assert.equal(await page.locator('#timerBox.danger').count(),1);
    await page.click('#accusationTicker');
    assert.equal(await page.getAttribute('#accusationTicker','aria-expanded'),'true');
    await page.locator('#accusationTicker').press('Enter');
    assert.equal(await page.getAttribute('#accusationTicker','aria-expanded'),'false');
    await page.click('#sbToggle');
    assert.equal(await page.locator('#scoreSidebar.open').count(),1);
    await page.click('#sbToggle');
    report.extraChecks.push('Mozgáskapcsoló; rendszerbeállítás; utolsó 10 mp; vád-tábla; ponttábla');
    const fallback=await browser.newPage({viewport:{width:360,height:640}});
    await fallback.addInitScript(()=>localStorage.setItem('kb_helpSeen','1'));
    await fallback.route('**/assets/vadlott.png',route=>route.abort());
    await fallback.route('https://fonts.googleapis.com/**',route=>route.abort());
    await fallback.route('https://fonts.gstatic.com/**',route=>route.abort());
    await fallback.goto(URL,{waitUntil:'domcontentloaded'});
    await fallback.waitForFunction(()=>typeof renderGame==='function');
    await fallback.evaluate(({state,myId})=>{
      IDENTITY_READY=true;MY.playerId=myId; MY.code='QA42'; S=state; show('game'); renderGame();
    },fixture('defense'));
    await fallback.waitForSelector('.stage-slot[data-role="defendant"].asset-missing .st-fallback',{state:'visible'});
    report.extraChecks.push('Hiányzó PNG helyett látható kör-avatar');
    await fallback.close();
    assert.equal(report.screenshots.length,25,'A 20 tárgyalási és 5 belépőoldali képernyőkép elkészült.');
    assert.equal(report.authResults.filter(result=>result.errors.length).length,0,'A belépőoldal nem lóg ki oldalra.');
    assert.equal(report.pageErrors.length,0,JSON.stringify(report.pageErrors));
    assert.equal(report.assetErrors.length,0,JSON.stringify(report.assetErrors));
    const failed=report.results.filter(result=>result.errors.length);
    assert.equal(failed.length,0,failed.length+' elrendezés takart vagy kilógó elemmel.');
    report.status='passed';
    console.log('PASS: 75 alapelrendezés + '+(report.results.length-75)+' kiegészítő nézet; fiókos/vendég belépés; 25 képernyőkép.');
  } catch (error) {
    report.status=['Playwright betöltése','Chromium indítása','Helyi szerver indítása'].includes(stage)?'blocked':'failed';
    report.blockedAt=stage; report.error=error.message;
    console.error(report.status.toUpperCase()+': '+stage+'\n'+error.message);
    process.exitCode=1;
  } finally {
    report.finishedAt=new Date().toISOString();
    report.executedLayouts=report.results.length;
    report.passedLayouts=report.results.filter(result=>!result.errors.length).length;
    fs.mkdirSync(path.dirname(reportPath),{recursive:true});
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
    console.log('QA-jelentés: '+reportPath);
    if (browser) await browser.close();
    if (child && child.exitCode===null && child.signalCode===null) {
      const stopped=new Promise(resolve=>child.once('exit',resolve));child.kill();await stopped;
    }
    if (tempDirectory) fs.rmSync(tempDirectory,{recursive:true,force:true});
  }
}
if (require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixture,sizes,phases,screenshotPhases};
