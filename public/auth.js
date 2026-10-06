'use strict';
// A fiók HttpOnly sütiben él; a játék meglévő szobaazonosítója ettől független.
(() => {
  let account=null, availability=null, busy=false, resetToken='', initializing=false;
  Object.defineProperty(window,'kbAccount',{get:()=>account,configurable:true});
  const forms=document.querySelector('.auth-forms');
  const mobile=matchMedia('(max-width: 700px)');
  const recovery=$('#authRecovery');
  const message=(selector,text,success=false)=>{
    const element=$(selector);
    element.textContent=text;
    element.classList.toggle('success',success);
  };
  async function api(route,body) {
    let response;
    try {
      response=await fetch('/api/auth/'+route,{method:body?'POST':'GET',credentials:'same-origin',
        cache:'no-store',headers:body?{'Content-Type':'application/json'}:undefined,
        body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
    } catch(_) {throw new Error('Nem érhető el a szerver. Próbáld újra kicsit később.');}
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error||'Nem sikerült a kérés. Próbáld újra.');
    return data;
  }
  function updateAvailability() {
    const available=!!availability?.available;
    $('#authLoginSubmit').disabled=busy||!available;
    $('#authRegisterSubmit').disabled=busy||!available;
    $('#authForgot').disabled=busy||!availability?.passwordReset;
    $('#authGuest').disabled=busy;
    for(const button of $$('[data-provider]')) button.disabled=busy||!availability?.providers[button.dataset.provider];
    const disabled=['google','discord'].filter(provider=>!availability?.providers[provider]);
    $('#authProviderHint').textContent=availability&&disabled.length?
      (disabled.length===2?'A Google- és Discord-belépés jelenleg nem elérhető.':
        (disabled[0]==='google'?'A Google-belépés':'A Discord-belépés')+' jelenleg nem elérhető.') : '';
  }
  async function submit(form,selector,work) {
    if(busy) return;
    message(selector,'');
    busy=true;updateAvailability();form.setAttribute('aria-busy','true');
    const controls=[...form.querySelectorAll('input, button')];
    const disabled=controls.map(control=>control.disabled);
    controls.forEach(control=>{control.disabled=true;});
    try {await work();}
    catch(error) {message(selector,error.message);}
    finally {
      controls.forEach((control,index)=>{control.disabled=disabled[index];});
      busy=false;form.removeAttribute('aria-busy');updateAvailability();
    }
  }
  function tab(name,focus=false) {
    forms.dataset.tab=name;
    for(const value of ['login','register']) {
      const selected=value===name;
      const button=$('#auth'+(value==='login'?'Login':'Register')+'Tab');
      button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
      if(selected&&focus&&mobile.matches) button.focus();
    }
    tabAccessibility();
  }
  function tabAccessibility() {
    for(const prefix of ['Login','Register']) {
      const card=$('#auth'+prefix+'Card');
      if(mobile.matches) {card.setAttribute('role','tabpanel');card.setAttribute('aria-labelledby','auth'+prefix+'Tab');}
      else {card.removeAttribute('role');card.setAttribute('aria-labelledby','auth'+prefix+'Title');}
    }
  }
  for(const button of $$('[data-auth-tab]')) button.addEventListener('click',()=>tab(button.dataset.authTab,true));
  $('#authLoginTab').addEventListener('click',()=>tab('login'));
  $('#authRegisterTab').addEventListener('click',()=>tab('register'));
  document.querySelector('.auth-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const next=event.key==='Home'?'login':event.key==='End'?'register':forms.dataset.tab==='login'?'register':'login';
    tab(next,true);
  });
  mobile.addEventListener('change',tabAccessibility);tabAccessibility();
  for(const button of $$('[data-password]')) button.addEventListener('click',()=>{
    const input=document.getElementById(button.dataset.password), visible=input.type==='password';
    input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));
    button.setAttribute('aria-label',visible?'Jelszó elrejtése':'Jelszó megjelenítése');
  });

  function clearRoomIdentity() {
    if(MY.code) socket.emit('leave_room');
    MY.playerId=null;MY.sessionToken=null;MY.code=null;MY.name='';CHOSEN=null;S=null;
    for(const key of ['kb_playerId','kb_sessionToken','kb_code','kb_name']) LS.removeItem(key);
    clearTimeout(rejoinTimer);
    INTENTIONAL_LEAVE=false;KICKED_FROM_ROOM=false;sessionStorage.removeItem('kb_left');
  }
  function enter(user,fresh) {
    const previous=LS.getItem('kb_accountId')||'guest', identity=user?.id||'guest';
    if(previous!==identity) clearRoomIdentity();
    account=user||null;LS.setItem('kb_accountId',identity);
    if(account) sessionStorage.removeItem('kb_guest');else sessionStorage.setItem('kb_guest','1');
    IDENTITY_READY=true;
    if(window.kbShop) window.kbShop.forget();
    if(window.kbFriends) window.kbFriends.forget();
    identifySocket(); // a socket a belépett fiókkal (vagy vendégként) azonosítja magát: barátlista, bolt-tárgyak
    $('#btnNewSuspect').textContent=account?'SAJÁT NÉVVEL JÁTSZOM':'ÚJ GYANÚSÍTOTT (vendég vagyok)';
    document.querySelector('.new-suspect-box').classList.toggle('hidden',!!account);
    $('#guestName').value=account?.username||'';
    $('#guestForm').classList.add('hidden');
    closeHelp();
    $('#authContinue').classList.add('hidden');
    // Kézi belépés (gomb): mindig a karakterválasztóra érkezünk, nem egyből a terembe/menübe.
    if(fresh&&(MY.name||MY.code)) {
      if(MY.code) socket.emit('leave_room');
      MY.name='';MY.code=null;CHOSEN=null;S=null;LS.removeItem('kb_name');LS.removeItem('kb_code');
    }
    if(MY.name) {
      const mine=account&&account.username===MY.name?account.profile||{}:null;
      CHOSEN=REGISTRY.some(profile=>profile.nev===MY.name)?{nev:MY.name,profile:true}:
        {nev:MY.name,profile:false,personal:!!mine,titulus:mine?.titulus||'Ismeretlen tettes',
          priusz:mine?.priusz||'Előélete tiszta. Túl tiszta.',jelveny:mine?.jelveny||''};
      show('menu');autoConnectAfterName();
    } else {show('name');requestRegistry();}
    renderAccount();
    // A belépés után nincs szükség a beírt jelszavak megőrzésére a DOM-ban.
    for(const input of $$('.auth-password input')) input.value='';
  }
  // ---- Saját kártya (profil) szerkesztése ----
  const pf={avatar:''};
  function profileDraft() {
    return {username:$('#pfName').value.trim(),titulus:$('#pfTitle').value.trim(),priusz:$('#pfPrior').value.trim(),
      jelveny:$('#pfBadge').value.trim().toUpperCase(),avatar:pf.avatar};
  }
  function profilePreview() {
    const d=profileDraft(),box=$('#pfPreview');
    box.innerHTML=mugCardHtml({label:'A TE KÁRTYÁD',name:d.username||'Neved',badge:d.jelveny,title:d.titulus||'Új gyanúsított',
      stats:PERSONAL_STATS.name===account?.username?PERSONAL_STATS.stats:null,avatar:d.avatar,pick:false});
  }
  function profileAvatarGrid() {
    const grid=$('#pfAvatarGrid');grid.innerHTML='';
    for(const id of AVATARS) {
      const cell=document.createElement('button');cell.type='button';
      cell.className='avatar-cell'+(pf.avatar===id?' selected':'');cell.dataset.avatar=id;
      cell.setAttribute('aria-label','Avatár '+id.slice(2));
      cell.innerHTML='<img src="'+avatarSrc(id)+'" alt="" loading="lazy" decoding="async" width="56" height="56">';
      cell.addEventListener('click',()=>{
        pf.avatar=id;for(const c of grid.querySelectorAll('.avatar-cell')) c.classList.toggle('selected',c===cell);
        profilePreview();
      });
      grid.appendChild(cell);
    }
  }
  function openProfile() {
    if(!account) return;
    const p=account.profile||{};
    $('#pfName').value=account.username;$('#pfTitle').value=p.titulus||'';$('#pfPrior').value=p.priusz||'';
    $('#pfBadge').value=p.jelveny||'';pf.avatar=AVATARS.includes(p.avatar)?p.avatar:'';
    message('#pfMessage','');
    profileAvatarGrid();profilePreview();
    $('#profileModal').classList.remove('hidden');$('#pfName').focus();
  }
  function closeProfile() {$('#profileModal').classList.add('hidden');}
  async function saveProfile(extra) {
    const data=await api('profile',{...profileDraft(),...extra});
    account=data.user;renderAccount();
    if(typeof renderMugGrid==='function'&&document.body.dataset.screen==='name') renderMugGrid();
    return data.user;
  }
  for(const id of ['#pfName','#pfTitle','#pfPrior','#pfBadge']) $(id).addEventListener('input',profilePreview);
  $('#pfCancel').addEventListener('click',closeProfile);
  $('#profileModal').addEventListener('click',event=>{if(event.target===$('#profileModal')) closeProfile();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!$('#profileModal').classList.contains('hidden')) closeProfile();
  });
  $('#profileForm').addEventListener('submit',event=>{
    event.preventDefault();
    submit(event.currentTarget,'#pfMessage',async()=>{
      await saveProfile();
      closeProfile();
      showToast('✅ A kártyád mentve!');
    });
  });
  // A játék többi része ezen keresztül éri el.
  window.kbEditProfile=openProfile;
  // Avatár-választás a saját kártyánál: a profilba is elmentjük (csendben).
  window.kbSaveAvatar=async avatar=>{
    if(!account||!AVATARS.includes(avatar)||account.profile?.avatar===avatar) return;
    try {
      const p=account.profile||{};
      const data=await api('profile',{username:account.username,titulus:p.titulus||'',priusz:p.priusz||'',
        jelveny:p.jelveny||'',avatar});
      account=data.user;
    } catch(_) { /* az avatár a játékhoz így is érvényes, csak a profilba nem kerül be */ }
  };

  // Az összekapcsolt belépési módok (e-mail+jelszó, Google, Discord): a profil-ablakban és a kártya alatt.
  function renderLinks(box) {
    if(!box) return;
    box.replaceChildren();
    if(account) {
      const connected=text=>{
        const chip=document.createElement('span');chip.className='account-connected';
        chip.textContent=text;box.appendChild(chip);
      };
      if(account.hasPassword) connected('✓ E-mail és jelszó');
      for(const provider of ['google','discord']) {
        const title=provider==='google'?'Google':'Discord';
        if(account.providers.includes(provider)) connected('✓ '+title);
        else if(availability?.providers[provider]) {
          const button=document.createElement('button');button.type='button';
          button.textContent='＋ '+title+' összekapcsolása';button.addEventListener('click',()=>oauth(provider,true));
          box.appendChild(button);
        }
      }
    }
    const wrap=box.closest('.card-links');
    if(wrap) wrap.classList.toggle('hidden',!box.children.length);
  }
  window.kbRenderLinks=renderLinks;

  function renderAccount() {
    const dock=$('#accountDock'),screen=document.body.dataset.screen;
    const target=screen==='name'?document.querySelector('.station-header'):
      screen==='menu'?document.querySelector('#screen-menu .wood-panel'):null;
    // A sáv csak a vendégnek kell (Bejelentkezés); a fiókos játékos a profiljánál találja a Kijelentkezést.
    dock.classList.toggle('hidden',!target||!!account);
    if(target&&dock.parentNode!==target) target.appendChild(dock);
    $('#accountSignIn').classList.toggle('hidden',!!account);
    if(!account) return;
    $('#accountEmail').textContent=account.email;
    renderLinks($('#accountConnections'));
    renderLinks(document.getElementById('cardLinks'));
  }
  document.addEventListener('kb:screen',renderAccount);
  $('#authGuest').addEventListener('click',()=>enter(null,true));
  $('#accountSignIn').addEventListener('click',()=>{
    IDENTITY_READY=false;sessionStorage.removeItem('kb_guest');show('auth');tab('login');
  });
  // Kijelentkezés (a profil gombsorából hívja a client.js).
  let leaving=false;
  window.kbLogout=async()=>{
    if(leaving) return;
    leaving=true;message('#accountMessage','');
    try {
      await api('logout',{});
      clearRoomIdentity();account=null;IDENTITY_READY=false;
      LS.removeItem('kb_accountId');sessionStorage.removeItem('kb_guest');
      if(window.kbShop) window.kbShop.forget();
      if(window.kbFriends) window.kbFriends.forget();
      identifySocket(); // a socket vendég lesz: a barátok offline-nak látják
      show('auth');tab('login');message('#authStatus','Sikeresen kijelentkeztél.');
    } catch(error) {message('#accountMessage',error.message);openProfile();}
    finally {leaving=false;}
  };
  $('#authLoginForm').addEventListener('submit',event=>{
    event.preventDefault();
    const body={email:$('#authLoginEmail').value,password:$('#authLoginPassword').value,remember:$('#authRemember').checked};
    submit(event.currentTarget,'#authLoginMessage',async()=>enter((await api('login',body)).user,true));
  });
  $('#authRegisterForm').addEventListener('submit',event=>{
    event.preventDefault();
    const body={username:$('#authRegisterName').value,email:$('#authRegisterEmail').value,
      password:$('#authRegisterPassword').value,confirmPassword:$('#authRegisterConfirm').value};
    if(body.password!==body.confirmPassword) {
      message('#authRegisterMessage','A két jelszó nem egyezik.');$('#authRegisterConfirm').focus();return;
    }
    if(legendClaim) {body.legend=legendClaim.name;body.claim=legendClaim.code;} // a szerver ellenőrzi a kódot
    submit(event.currentTarget,'#authRegisterMessage',async()=>{
      const user=(await api('register',body)).user;
      if(legendClaim) finishLegendClaim();
      enter(user,true);
    });
  });
  async function oauth(provider,link=false) {
    if(busy||!availability?.providers[provider]) return;
    busy=true;updateAvailability();
    try {
      availability=await api('status');
      if(!availability.available||!availability.providers[provider]) throw new Error('Ez a belépési mód most nem elérhető.');
      if(link&&!availability.user) {
        account=null;IDENTITY_READY=false;show('auth');tab('login');
        message('#authStatus','A belépésed lejárt. Az összekapcsoláshoz lépj be újra.');return;
      }
      if(link&&availability.user.id!==account?.id) {
        enter(availability.user);message('#accountMessage','Másik fiókkal vagy bejelentkezve. Frissítettük a fiókadataidat.');
        openProfile();return;
      }
      const url=new URL('/api/auth/'+provider+'/start',location.origin);
      if(link) url.searchParams.set('link','1');
      if($('#authRemember').checked) url.searchParams.set('remember','1');
      const room=new URLSearchParams(location.search).get('room');
      if(room) url.searchParams.set('room',room);
      location.assign(url.pathname+url.search);
    } catch(error) {message(link?'#accountMessage':'#authStatus',error.message);}
    finally {busy=false;updateAvailability();renderAccount();}
  }
  for(const button of $$('[data-provider]')) button.addEventListener('click',()=>oauth(button.dataset.provider));

  function openRecovery(reset=false) {
    $('#authForgotFields').classList.toggle('hidden',reset);
    $('#authResetFields').classList.toggle('hidden',!reset);
    $('#authRecoveryEmail').required=!reset;$('#authRecoveryEmail').disabled=reset;
    for(const selector of ['#authNewPassword','#authNewConfirm']) {$(selector).required=reset;$(selector).disabled=!reset;}
    $('#authRecoveryTitle').textContent=reset?'Új jelszó':'Elfelejtett jelszó';
    $('#authRecoveryIntro').textContent=reset?'Adj meg egy új, legalább 12 karakteres jelszót.':
      'Elküldjük az új jelszó beállításához szükséges linket.';
    $('#authRecoverySubmit').textContent=reset?'ÚJ JELSZÓ MENTÉSE':'LINK KÜLDÉSE';
    message('#authRecoveryMessage','');
    if(!reset) $('#authRecoveryEmail').value=$('#authLoginEmail').value;
    if(!recovery.open) recovery.showModal();
  }
  $('#authForgot').addEventListener('click',()=>openRecovery(false));
  $('#authRecoveryClose').addEventListener('click',()=>recovery.close());
  recovery.addEventListener('click',event=>{
    if(event.target!==recovery) return;
    const box=recovery.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom) recovery.close();
  });
  $('#authRecoveryForm').addEventListener('submit',event=>{
    event.preventDefault();
    const reset=!$('#authResetFields').classList.contains('hidden');
    const body=reset?{token:resetToken,password:$('#authNewPassword').value,confirmPassword:$('#authNewConfirm').value}:
      {email:$('#authRecoveryEmail').value};
    submit(event.currentTarget,'#authRecoveryMessage',async()=>{
      const result=await api(reset?'reset':'forgot',body);
      if(reset) {resetToken='';$('#authNewPassword').value='';$('#authNewConfirm').value='';recovery.close();enter(result.user,true);}
      else message('#authRecoveryMessage',result.message,true);
    });
  });

  const errors={expired:'A belépési kérés lejárt. Próbáld újra.',cancelled:'Megszakítottad a külső belépést.',
    provider:'Nem sikerült a külső belépés. Próbáld újra.',unverified:'A szolgáltatónál előbb igazold az e-mail címedet.',
    email_used:'Ezzel az e-mail címmel már van fiók. Lépj be a meglévő fiókba, majd a FIÓKOM menüben kapcsold össze.',
    provider_used:'Ez a szolgáltatói fiók már másik játékoshoz tartozik.'};
  const query=new URLSearchParams(location.search),error=query.get('auth_error');
  const hash=location.hash;
  if(hash.startsWith('#reset=')) {
    const token=hash.slice(7);
    if(/^[A-Za-z0-9_-]{43}$/.test(token)) resetToken=token;
  }
  // Legendás kártya igénylő-link: /?legend=<név>&claim=<kód>. A regisztráció a legenda nevén történik, a kód a szervernél érvényesül.
  let legendClaim=null;
  if(query.get('legend')&&/^[A-Za-z0-9_-]{22}$/.test(query.get('claim')||'')) legendClaim={name:query.get('legend').slice(0,40),code:query.get('claim')};
  function applyLegendClaim() {
    if(!legendClaim) return;
    const nameInput=$('#authRegisterName');
    nameInput.value=legendClaim.name;nameInput.readOnly=true;nameInput.title='A legendás kártya neve nem módosítható';
    const note=$('#authLegendNote');
    note.textContent='🏆 Legendás kártya igénylése: '+legendClaim.name+'. Regisztrálj a saját e-mail címeddel és jelszavaddal, utána a kártya, a keret és a háttér a tiéd. A statisztikád megmarad.';
    note.classList.remove('hidden');
    show('auth');tab('register');
  }
  function finishLegendClaim() {
    legendClaim=null;
    $('#authRegisterName').readOnly=false;$('#authLegendNote').classList.add('hidden');
    const q=new URLSearchParams(location.search);q.delete('legend');q.delete('claim');
    history.replaceState(history.state,'',location.pathname+(q.toString()?'?'+q:'')+location.hash);
  }
  const externalReturn=query.has('auth')||query.has('auth_error'); // külső (OAuth) belépésből érkeztünk vissza
  if(query.has('auth')||query.has('auth_error')||hash.startsWith('#reset=')) {
    query.delete('auth');query.delete('auth_error');
    history.replaceState(history.state,'',location.pathname+(query.toString()?'?'+query:'')+
      (hash.startsWith('#reset=')?'':hash));
  }
  function showContinue(user) {
    const button=$('#authContinue');
    $('#authContinueName').textContent=user.username||user.email||'fiók';
    button.classList.remove('hidden');
    button.onclick=()=>enter(user,true);
  }
  async function initialize() {
    if(initializing) return;
    initializing=true;$('#authRetry').classList.add('hidden');
    try {
      availability=await api('status');updateAvailability();
      $('#authRetry').classList.toggle('hidden',availability.available);
      message('#authStatus',error?(errors[error]||errors.provider):availability.available?'':'A fiókkezelés jelenleg nem elérhető.');
      if(resetToken) {show('auth');openRecovery(true);}
      else if(legendClaim) applyLegendClaim(); // az igénylő-link a regisztrációs űrlapot nyitja
      if(resetToken||legendClaim) { /* a belépett fiók gombja ilyenkor nem zavarja a folyamatot */ }
      else if(availability.user) {
        // Az oldal betöltésekor MINDIG a bejelentkezés jön először; a megjegyzett fiókkal egy gombbal lehet folytatni.
        if(externalReturn) {
          enter(availability.user,true);
          if(error) {message('#accountMessage',errors[error]||errors.provider);openProfile();}
        } else showContinue(availability.user);
      }
      if(hash.startsWith('#reset=')&&!resetToken) message('#authStatus','A jelszó-visszaállító link érvénytelen. Kérj új linket.');
    } catch(error) {
      message('#authStatus',error.message+' Vendégként továbbra is beléphetsz.');$('#authRetry').classList.remove('hidden');
    } finally {initializing=false;}
  }
  $('#authRetry').addEventListener('click',initialize);
  initialize();
})();
