'use strict';
(() => {
  const cfg = window.kbCourtConfig = Object.assign({ scene: 'hu' }, window.kbCourtConfig || {});
  const $ = (sel) => document.querySelector(sel);
  const safe = (fn) => (...args) => { try { return fn(...args); } catch (e) { console.warn('[court]', e && e.message); return undefined; } };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const PHASE = {
    accusation:['VÁDEMELÉS','A bíróság ismerteti az ügyet.','center'], prep:['FELKÉSZÜLÉS','Rendezzétek a bizonyítékokat.','wide'],
    prosecution:['ÜGYÉSZSÉG','A vád ismertetése.','left'], defense:['VÁDLOTT','Védd magad, ha tudod.','right'],
    defender:['VÉDELEM','A védőügyvéd következik.','right'], witness:['TANÚ','A bíróság hallgat.','witness'],
    final_prosecution:['ÜGYÉSZSÉG · ZÁRÓSZÓ','Utolsó érvek a vád oldaláról.','left'], final_defense:['VÉDELEM · ZÁRÓSZÓ','Utolsó esély.','right'],
    verdict_vote:['SZAVAZÁS','Bűnös vagy felmentve?','wide'], challenge_vote:['KIHÍVÁS','Az esküdtszék dönt.','wide'],
    challenge_review:['KIHÍVÁS','A bíróság ellenőrzi a kihívást.','center'], verdict:['ÍTÉLET','Rendet a teremben!','center'],
    round_results:['KÖR VÉGE','Az ítélet bekerült az aktába.','wide'], game_over:['A TÁRGYALÁSOK VÉGE','Megszületett a végső rangsor.','wide']
  };
  let lastPhase = '', lastCase = '', introTimer = 0, evidenceTimer = 0, challengeTimer = 0, verdictTimer = 0, lastVerdictKey = '';
  const reduced = () => document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

  const loadRoleSprites = safe(() => {
    if (!window.kbAvatarRoles || typeof fetch !== 'function') return;
    fetch('/api/role-sprites',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(safe(d=>{ if(d&&d.available) window.kbAvatarRoles.setAvailable(d.available); })).catch(()=>{});
  });
  function focus(kind) {
    const cam=$('#courtCamera'), glow=$('#courtFocus'); if(!cam) return;
    const map={left:['2.5%','0','1.055','24%'],right:['-2.5%','0','1.055','72%'],witness:['-3.5%','-1%','1.07','72%'],center:['0','-1%','1.045','50%'],wide:['0','0','1','50%']};
    const v=map[kind]||map.wide;
    if(reduced()){cam.style.cssText='';} else {cam.style.setProperty('--cam-x',v[0]);cam.style.setProperty('--cam-y',v[1]);cam.style.setProperty('--cam-s',v[2]);cam.style.setProperty('--cam-ox',v[3]);}
    if(glow){glow.dataset.focus=kind||'wide';glow.classList.toggle('active',kind&&kind!=='wide');}
  }
  function showIntro(d) {
    const el=$('#courtIntro'); if(!el||!d.accusationText) return;
    clearTimeout(introTimer);
    el.innerHTML='<div class="court-intro-card court-parchment"><div class="ci-kicker">'+esc(d.round)+'. TÁRGYALÁS</div><div class="ci-vs">AZ ÁLLAM <span>VS.</span> '+esc(d.defendantName||'GYANÚSÍTOTT')+'</div><div class="ci-label">VÁD</div><div class="ci-charge">'+esc(d.accusationText)+'</div><div class="court-stamp">BEIDÉZVE</div></div>';
    el.classList.remove('hidden'); requestAnimationFrame(()=>el.classList.add('show'));
    introTimer=setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.classList.add('hidden'),350);},reduced()?900:2600);
  }
  function showEvidence(d) {
    const el=$('#courtEvidence'); if(!el||!d.evidence) return;
    const txt=typeof d.evidence==='string'?d.evidence:(d.evidence.text||d.evidence.title||'Bizonyíték került az aktába.');
    clearTimeout(evidenceTimer);
    el.innerHTML='<div class="evidence-folder"><div class="ev-tab">BIZONYÍTÉK · '+esc(d.caseNo||'AKTA')+'</div><div class="ev-pin">?</div><div class="ev-text">'+esc(txt)+'</div><div class="court-stamp ev-stamp">AKTÁBA VÉVE</div></div>';
    el.classList.remove('hidden'); requestAnimationFrame(()=>el.classList.add('show'));
    evidenceTimer=setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.classList.add('hidden'),300);},reduced()?1100:3000);
  }

  function showChallenge(d) {
    const el=$('#courtChallenge'); if(!el) return;
    const ch=(d.challengeReview&&d.challengeReview.challenges&&d.challengeReview.challenges[d.challengeReview.current||0])||null;
    const txt=(ch&&(ch.text||ch.title))||d.myChallenge; if(!txt) return;
    clearTimeout(challengeTimer);
    el.innerHTML='<div class="challenge-card court-parchment"><div class="cc-kicker">KAMU BÍRÓSÁG</div><div class="cc-title">KIHÍVÁSKÁRTYA</div><div class="cc-text">'+esc(txt)+'</div><div class="court-stamp" style="margin-top:18px">KIHÍVÁS</div></div>';
    el.classList.remove('hidden'); requestAnimationFrame(()=>el.classList.add('show'));
    challengeTimer=setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.classList.add('hidden'),300);},reduced()?1000:2400);
  }
  function showVerdict(d) {
    const el=$('#courtVerdict'), v=d.verdict; if(!el||!v||typeof v.guilty!=='boolean') return;
    const key=(d.round||'')+'|'+String(v.guilty)+'|'+(d.defendantName||''); if(key===lastVerdictKey) return; lastVerdictKey=key;
    clearTimeout(verdictTimer); const guilty=!!v.guilty, label=guilty?'BŰNÖS':'FELMENTVE';
    el.className='court-verdict '+(guilty?'flash-guilty':'flash-acquitted');
    el.innerHTML='<div class="verdict-card court-parchment '+(guilty?'guilty':'acquitted')+'"><div class="verdict-kicker">A BÍRÓSÁG ÍTÉLETE</div><div class="verdict-name">'+esc(d.defendantName||'A VÁDLOTT')+'</div><div class="court-stamp">'+label+'</div><div class="verdict-sub">AZ ÍTÉLET JOGERŐS... VAGY LEGALÁBBIS EBBEN A KÖRBEN.</div></div>';
    requestAnimationFrame(()=>el.classList.add('show'));
    verdictTimer=setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.classList.add('hidden'),300);},reduced()?1200:2600);
  }

  const update = safe((d) => {
    const meta=PHASE[d.phase]||['TÁRGYALÁS','', 'wide']; focus(meta[2]);
    const hud=$('#courtPhaseHud');
    if(hud){ const who=d.phase==='prosecution'?d.prosecutorName:d.phase==='defense'?d.defendantName:d.phase==='defender'?d.defenderName:d.phase==='witness'?d.witnessName:'';
      hud.innerHTML='<span class="cph-title">'+esc(meta[0])+'</span>'+(who?'<b class="cph-who">'+esc(who)+'</b>':'')+'<span class="cph-sub">'+esc(meta[1])+'</span>';
      hud.classList.toggle('hidden',['round_results','game_over'].includes(d.phase)); }
    const caseKey=(d.caseNo||d.round)+'|'+d.accusationText;
    if(d.phase==='accusation' && caseKey!==lastCase){lastCase=caseKey;showIntro(d);}
    if(d.phase==='prep' && lastPhase!=='prep' && d.evidence) showEvidence(d);
    if((d.phase==='challenge_review'||d.phase==='challenge_vote') && lastPhase!==d.phase) showChallenge(d);
    if(d.phase==='verdict') showVerdict(d);
    lastPhase=d.phase;
  });
  loadRoleSprites();
  window.kbCourt={loadRoleSprites,update,focus,config:cfg};
})();
