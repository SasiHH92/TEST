'use strict';
// Account routes are independent of room/game state and scoring.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const express = require('express');
const derive = promisify(crypto.scrypt);
const SCRYPT = {N:32768,r:8,p:3,maxmem:64*1024*1024};
const COOKIE = 'kb_account';
const SESSION_MS = 8*60*60*1000;
const REMEMBER_MS = 30*24*60*60*1000;
const OAUTH_MS = 10*60*1000;
const PROVIDERS = {
  google:{authorize:'https://accounts.google.com/o/oauth2/v2/auth',
    token:'https://oauth2.googleapis.com/token',
    user:'https://openidconnect.googleapis.com/v1/userinfo',scope:'openid email profile'},
  discord:{authorize:'https://discord.com/oauth2/authorize',
    token:'https://discord.com/api/oauth2/token',
    user:'https://discord.com/api/v10/users/@me',scope:'identify email'}
};
class AuthError extends Error {
  constructor(status,message,code) {super(message);this.status=status;this.code=code;}
}
const fail = (status,message,code) => {throw new AuthError(status,message,code);};
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.normalize('NFKC').trim().toLocaleLowerCase('hu-HU');
function email(value) {
  if(typeof value!=='string' || value.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    fail(400,'Adj meg egy érvényes e-mail címet.');
  }
  return value.trim().toLowerCase();
}
function username(value) {
  if(typeof value!=='string') fail(400,'Add meg a felhasználóneved.');
  const name=value.normalize('NFKC').trim();
  if(!/^[\p{L}\p{N} _.-]{3,20}$/u.test(name)) {
    fail(400,'A név 3–20 karakter lehet: betű, szám, szóköz, pont, kötőjel vagy aláhúzás.');
  }
  return name;
}
function newPassword(body) {
  if(typeof body.password!=='string' || body.password.length<12 || body.password.length>128) {
    fail(400,'A jelszó legyen 12–128 karakter hosszú.');
  }
  if(body.password!==body.confirmPassword) fail(400,'A két jelszó nem egyezik.');
  return body.password;
}
function cookies(req) {
  const result={};
  for(const piece of (req.get('cookie')||'').split(';')) {
    const index=piece.indexOf('=');
    if(index<0) continue;
    try {result[piece.slice(0,index).trim()]=decodeURIComponent(piece.slice(index+1).trim());}
    catch (_) { /* malformed cookies are ignored */ }
  }
  return result;
}
function loadAuthEnvironment(file) {
  if(!fs.existsSync(file)) return;
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    const match=line.match(/^\s*(AUTH_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if(!match || process.env[match[1]]!==undefined) continue;
    let value=match[2];
    if(/^(['"]).*\1$/.test(value)) value=value.slice(1,-1);
    else value=value.replace(/(^|\s+)#.*$/,'').trim();
    process.env[match[1]]=value;
  }
}
class AccountStore {
  constructor(file,persist) {
    this.file=file;this.persist=persist;
    this.state={version:1,users:[],sessions:[],resets:[]};
    try {
      this.state=JSON.parse(fs.readFileSync(file,'utf8'));
      if(this.state.version!==1 || !['users','sessions','resets'].every(k=>Array.isArray(this.state[k]))) {
        throw new Error('Invalid account store');
      }
    } catch(error) {if(error.code!=='ENOENT') throw error;}
  }
  commit(edit) {
    const next=structuredClone(this.state), result=edit(next);
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temporary=this.file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
    try {
      fs.writeFileSync(temporary,JSON.stringify(next,null,2)+'\n',{mode:0o600});
      fs.renameSync(temporary,this.file);
    } finally {if(fs.existsSync(temporary)) fs.unlinkSync(temporary);}
    this.state=next;
    if(this.persist) {try {this.persist(this.file);} catch(_) { /* a külső mentés hibája nem állíthatja meg a belépést */ }}
    return result;
  }
}
function createAuth(options={}) {
  const env=options.env||process.env, now=options.now||Date.now, request=options.fetch||fetch;
  const file=options.file||path.resolve(__dirname,env.AUTH_STORE_PATH||'data/accounts.json');
  let store, storageError;
  try {store=new AccountStore(file,options.persist);} catch(error) {
    storageError=error;console.error('A fióktár nem olvasható:',error.message);
  }
  let origin='';
  if(env.AUTH_BASE_URL) {
    try {
      const parsed=new URL(env.AUTH_BASE_URL);
      if(!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid AUTH_BASE_URL');
      if(parsed.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) {
        throw new Error('AUTH_BASE_URL must use HTTPS outside localhost');
      }
      origin=parsed.origin;
    } catch(_) {console.error('Hibás AUTH_BASE_URL: a külső belépés és a levélküldés kikapcsolva.');}
  }
  const configs=Object.fromEntries(Object.keys(PROVIDERS).map(provider=>[provider,{
    clientId:env['AUTH_'+provider.toUpperCase()+'_CLIENT_ID']||'',
    secret:env['AUTH_'+provider.toUpperCase()+'_CLIENT_SECRET']||''
  }]));
  const enabled=provider=>!!(origin && configs[provider]?.clientId && configs[provider]?.secret && !storageError);
  const mailEnabled=!!(origin && (options.sendMail || (env.AUTH_MAIL_API_KEY && env.AUTH_MAIL_FROM)));
  const router=express.Router();
  const publicUser=user=>user?{id:user.id,username:user.username,email:user.email,
    hasPassword:!!user.password,providers:Object.keys(user.providers||{})}:null;
  const session=req=>{
    if(!store) return null;
    const token=cookies(req)[COOKIE];
    if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const entry=store.state.sessions.find(s=>s.hash===digest(token) && s.expiresAt>now());
    return entry?store.state.users.find(user=>user.id===entry.userId)||null:null;
  };
  const cookieOptions=req=>({httpOnly:true,sameSite:'lax',secure:origin.startsWith('https:')||req.secure,path:'/'});
  const remember=req=>req.body?.remember===true;
  function createSession(user,req,res,persistent=false) {
    const token=crypto.randomBytes(32).toString('base64url'), duration=persistent?REMEMBER_MS:SESSION_MS;
    const old=cookies(req)[COOKIE];
    store.commit(data=>{
      data.sessions=data.sessions.filter(s=>s.expiresAt>now() && (!old || s.hash!==digest(old)));
      data.resets=data.resets.filter(r=>r.expiresAt>now());
      data.sessions.push({hash:digest(token),userId:user.id,expiresAt:now()+duration});
      const mine=data.sessions.filter(s=>s.userId===user.id);
      if(mine.length>10) data.sessions=data.sessions.filter(s=>!mine.slice(0,mine.length-10).includes(s));
    });
    res.cookie(COOKIE,token,{...cookieOptions(req),...(persistent?{maxAge:duration}:{})});
  }
  const wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
  const attempts=new Map(), states=new Map(), hashQueue=[];
  let hashActive=0;
  async function hashJob(work) {
    if(hashQueue.length>=16) fail(503,'Sok belépés érkezett egyszerre. Pár másodperc múlva próbáld újra.');
    await new Promise(resolve=>{
      if(hashActive<2) {hashActive++;resolve();}
      else hashQueue.push(resolve);
    });
    try {return await work();} finally {
      const next=hashQueue.shift();
      if(next) next(); else hashActive--;
    }
  }
  async function hash(password,salt=crypto.randomBytes(16).toString('base64url')) {
    const key=await hashJob(()=>derive(password,Buffer.from(salt,'base64url'),64,SCRYPT));
    return {algorithm:'scrypt-v1',salt,hash:key.toString('base64url')};
  }
  const dummy={algorithm:'scrypt-v1',salt:crypto.randomBytes(16).toString('base64url'),hash:Buffer.alloc(64).toString('base64url')};
  async function verify(password,record) {
    const valid=record?.algorithm==='scrypt-v1' && /^[A-Za-z0-9_-]{22}$/.test(record.salt||'') &&
      /^[A-Za-z0-9_-]{86}$/.test(record.hash||'');
    const expected=valid?record:dummy, result=await hash(password,expected.salt);
    return !!valid && crypto.timingSafeEqual(Buffer.from(result.hash,'base64url'),Buffer.from(expected.hash,'base64url'));
  }
  function rate(req,res,next) {
    const ip=env.AUTH_TRUST_PROXY==='1'?req.ip:req.socket.remoteAddress;
    const key=ip+':'+req.path;
    const stamp=now(), windowMs=10*60*1000;
    for(const [id,bucket] of attempts) if(stamp-bucket.start>windowMs) attempts.delete(id);
    const entry=attempts.get(key)||{start:stamp,count:0};
    entry.count++;attempts.set(key,entry);
    if(entry.count>(options.maxAttempts||20)) {
      res.set('Retry-After',String(Math.ceil((windowMs-(stamp-entry.start))/1000)));
      return res.status(429).json({error:'Túl sok próbálkozás. Kicsit később próbáld újra.'});
    }
    next();
  }
  router.use((req,res,next)=>{
    res.set('Cache-Control','no-store');
    res.set('X-Content-Type-Options','nosniff');
    res.set('Referrer-Policy','no-referrer');
    next();
  });
  router.use(express.json({limit:'8kb'}));
  router.use((req,res,next)=>{
    if(req.method!=='POST') return next();
    if(!req.is('application/json')) return res.status(415).json({error:'JSON-kérés szükséges.'});
    const expected=origin||req.protocol+'://'+req.get('host');
    if(req.get('origin') && req.get('origin')!==expected) return res.status(403).json({error:'A kérés másik oldalról érkezett.'});
    if(!req.body || Array.isArray(req.body)) return res.status(400).json({error:'Hiányzó űrlapadatok.'});
    rate(req,res,next);
  });
  router.get('/status',(req,res)=>res.json({user:publicUser(session(req)),
    available:!storageError,providers:{google:enabled('google'),discord:enabled('discord')},
    passwordReset:mailEnabled && !storageError}));
  router.use((req,res,next)=>storageError?res.status(503).json({error:'A fiókkezelés most nem elérhető. Próbáld újra később.'}):next());
  router.post('/register',wrap(async(req,res)=>{
    const address=email(req.body.email),name=username(req.body.username),password=newPassword(req.body);
    const record=await hash(password);
    const user=store.commit(data=>{
      if(data.users.some(u=>u.email===address)) fail(409,'Ezzel az e-mail címmel már van fiók.');
      if(data.users.some(u=>normalize(u.username)===normalize(name))) fail(409,'Ez a felhasználónév már foglalt.');
      const user={id:crypto.randomUUID(),username:name,email:address,password:record,providers:{},createdAt:now()};
      data.users.push(user);return user;
    });
    createSession(user,req,res);
    res.status(201).json({user:publicUser(user)});
  }));
  router.post('/login',wrap(async(req,res)=>{
    const address=email(req.body.email);
    if(typeof req.body.password!=='string' || !req.body.password.length || req.body.password.length>128) fail(400,'Add meg a jelszavad.');
    const user=store.state.users.find(u=>u.email===address);
    if(!(await verify(req.body.password,user?.password))) fail(401,'Hibás e-mail cím vagy jelszó.');
    createSession(user,req,res,remember(req));res.json({user:publicUser(user)});
  }));
  router.post('/logout',wrap((req,res)=>{
    const token=cookies(req)[COOKIE];
    if(token) store.commit(data=>{data.sessions=data.sessions.filter(s=>s.hash!==digest(token));});
    res.clearCookie(COOKIE,cookieOptions(req));res.json({ok:true});
  }));
  router.post('/forgot',wrap(async(req,res)=>{
    if(!mailEnabled) fail(503,'A jelszó-visszaállítás jelenleg nem elérhető.');
    const address=email(req.body.email), user=store.state.users.find(u=>u.email===address && u.password);
    if(user) {
      const token=crypto.randomBytes(32).toString('base64url');
      store.commit(data=>{
        data.resets=data.resets.filter(r=>r.userId!==user.id && r.expiresAt>now());
        data.resets.push({hash:digest(token),userId:user.id,expiresAt:now()+60*60*1000});
      });
      const link=origin+'/#reset='+token;
      const message={to:user.email,subject:'Kamu Bíróság – új jelszó',
        text:'Új jelszó beállításához nyisd meg ezt a linket:\n'+link+'\n\nA link 1 óráig, egyszer használható. Ha nem te kérted, hagyd figyelmen kívül.'};
      // Respond uniformly; email transport never reveals whether an account exists.
      const send=options.sendMail?()=>options.sendMail(message):async()=>{
        const result=await request('https://api.resend.com/emails',{method:'POST',
          headers:{Authorization:'Bearer '+env.AUTH_MAIL_API_KEY,'Content-Type':'application/json'},
          body:JSON.stringify({...message,from:env.AUTH_MAIL_FROM,to:[message.to]}),signal:AbortSignal.timeout(10000)});
        if(!result.ok) throw new Error('Mail delivery failed');
      };
      Promise.resolve().then(send).catch(()=>{
        try {store.commit(data=>{data.resets=data.resets.filter(r=>r.hash!==digest(token));});}
        catch(_) {console.error('A sikertelen visszaállító link törlése nem sikerült.');}
        console.error('A jelszó-visszaállító levél kézbesítése nem sikerült.');
      });
    }
    res.json({message:'Ha ehhez a címhez jelszavas fiók tartozik, elküldjük a visszaállító linket.'});
  }));
  router.post('/reset',wrap(async(req,res)=>{
    if(typeof req.body.token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(req.body.token)) fail(400,'A link lejárt vagy érvénytelen.');
    const tokenHash=digest(req.body.token), record=await hash(newPassword(req.body));
    const user=store.commit(data=>{
      const reset=data.resets.find(r=>r.hash===tokenHash && r.expiresAt>now());
      if(!reset) fail(400,'A link lejárt vagy már felhasználtad.');
      const user=data.users.find(u=>u.id===reset.userId);
      if(!user) fail(400,'A link érvénytelen.');
      user.password=record;
      data.sessions=data.sessions.filter(s=>s.userId!==user.id);
      data.resets=data.resets.filter(r=>r.userId!==user.id);
      return user;
    });
    createSession(user,req,res);res.json({user:publicUser(user)});
  }));
  router.get('/:provider/start',rate,wrap((req,res)=>{
    const provider=req.params.provider;
    if(!enabled(provider)) fail(503,'Ez a belépési mód még nem elérhető.');
    const linked=req.query.link==='1', user=session(req);
    if(linked && !user) fail(401,'Előbb jelentkezz be a fiókodba.');
    for(const [key,state] of states) if(state.expiresAt<now()) states.delete(key);
    if(states.size>=1024) fail(503,'Próbáld újra kicsit később.');
    const nonce=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(32).toString('base64url');
    const room=/^[A-Z0-9]{4}$/i.test(req.query.room||'')?req.query.room.toUpperCase():'';
    states.set(nonce,{provider,verifier,room,userId:linked?user.id:null,
      persistent:req.query.remember==='1',expiresAt:now()+OAUTH_MS});
    res.cookie('kb_oauth_'+provider,nonce,{...cookieOptions(req),maxAge:OAUTH_MS});
    const url=new URL(PROVIDERS[provider].authorize);
    for(const [key,value] of Object.entries({client_id:configs[provider].clientId,response_type:'code',
      redirect_uri:origin+'/api/auth/'+provider+'/callback',scope:PROVIDERS[provider].scope,
      state:nonce,prompt:provider==='google'?'select_account':'consent'})) url.searchParams.set(key,value);
    if(provider==='google') {
      url.searchParams.set('code_challenge',crypto.createHash('sha256').update(verifier).digest('base64url'));
      url.searchParams.set('code_challenge_method','S256');
    }
    res.redirect(url.toString());
  }));
  router.get('/:provider/callback',rate,wrap(async(req,res)=>{
    const provider=req.params.provider, nonce=req.query.state, state=typeof nonce==='string'?states.get(nonce):null;
    const bounce=code=>res.redirect('/?auth_error='+encodeURIComponent(code)+(state?.room?'&room='+state.room:''));
    res.clearCookie('kb_oauth_'+provider,cookieOptions(req));
    if(!enabled(provider) || !state || state.provider!==provider || state.expiresAt<now() ||
      cookies(req)['kb_oauth_'+provider]!==nonce) return bounce('expired');
    states.delete(nonce); // single-use before any exchange
    if(req.query.error) return bounce('cancelled');
    if(typeof req.query.code!=='string' || req.query.code.length>4096) return bounce('provider');
    try {
      const cfg=configs[provider],meta=PROVIDERS[provider];
      const body=new URLSearchParams({grant_type:'authorization_code',code:req.query.code,
        client_id:cfg.clientId,client_secret:cfg.secret,redirect_uri:origin+'/api/auth/'+provider+'/callback'});
      if(provider==='google') body.set('code_verifier',state.verifier);
      const exchange=await request(meta.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:body.toString(),signal:AbortSignal.timeout(10000)});
      if(!exchange.ok) return bounce('provider');
      const token=await exchange.json();
      if(typeof token.access_token!=='string') return bounce('provider');
      const response=await request(meta.user,{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(10000)});
      if(!response.ok) return bounce('provider');
      const profile=await response.json();
      const providerId=provider==='google'?profile.sub:profile.id;
      if(typeof providerId!=='string' || !providerId.length || providerId.length>255 ||
        !(provider==='google'?profile.email_verified===true:profile.verified===true)) return bounce('unverified');
      const address=email(profile.email);
      const existing=store.state.users.find(u=>u.providers?.[provider]===providerId);
      let user;
      if(state.userId) {
        if(session(req)?.id!==state.userId) return bounce('expired');
        if(existing && existing.id!==state.userId) return bounce('provider_used');
        user=store.commit(data=>{
          const user=data.users.find(u=>u.id===state.userId);
          user.providers[provider]=providerId;return user;
        });
      } else if(existing) user=existing;
      else {
        // Matching an email alone never links a provider to an existing password account.
        if(store.state.users.some(u=>u.email===address)) return bounce('email_used');
        const raw=String(profile.global_name||profile.name||profile.username||'Játékos')
          .normalize('NFKC').replace(/[^\p{L}\p{N} _.-]/gu,'').trim().slice(0,16)||'Játékos';
        user=store.commit(data=>{
          let name=raw.length>=3?raw:'Játékos',suffix=1;
          while(data.users.some(u=>normalize(u.username)===normalize(name))) name=raw.slice(0,14)+'-'+suffix++;
          const user={id:crypto.randomUUID(),username:name,email:address,password:null,
            providers:{[provider]:providerId},createdAt:now()};
          data.users.push(user);return user;
        });
      }
      if(!state.userId) createSession(user,req,res,state.persistent);
      res.redirect('/?auth=success'+(state.room?'&room='+state.room:''));
    } catch(_) {return bounce('provider');}
  }));
  router.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    if(error instanceof AuthError) return res.status(error.status).json({error:error.message});
    if(error.type==='entity.too.large') return res.status(413).json({error:'Túl nagy kérés.'});
    if(error.type==='entity.parse.failed') return res.status(400).json({error:'Érvénytelen kérés.'});
    console.error('Fiókkezelési hiba:',error.code||error.name);
    res.status(503).json({error:'A fiókkezelés most nem elérhető. Próbáld újra később.'});
  });
  return {router};
}
module.exports={createAuth,loadAuthEnvironment};
