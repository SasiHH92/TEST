'use strict';
// Account routes are independent of room/game state and scoring.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {promisify} = require('util');
const express = require('express');
const {scrub} = require('./errorlog');
const derive = promisify(crypto.scrypt);
const SCRYPT = {N:32768,r:8,p:3,maxmem:64*1024*1024};
const COOKIE = 'kb_account';
const SESSION_MS = 8*60*60*1000;
const REMEMBER_MS = 30*24*60*60*1000;
const OAUTH_MS = 10*60*1000;
const TEMP_PASSWORD_MS = 14*24*60*60*1000; // az üzemeltető által adott ideiglenes jelszó ennyi ideig használható (utána újat kell kérni)
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // félreérthető karakterek (I, O, l, 0, 1) nélkül
// Ideiglenes jelszó: 12 véletlen karakter, 4-esével kötőjellel (pl. "Kp7x-Qm3a-Zt9R"), kriptográfiai véletlenből; legalább 12 karakter, így a jelszó-szabálynak is megfelel.
function temporaryPassword() {
  const pick = () => TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  return [0,1,2].map(() => pick()+pick()+pick()+pick()).join('-');
}
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
// A saját kártya szövegei: vezérlőkarakterek nélkül, egy sorba rendezve, hosszkorláttal.
function profileText(value,max,label) {
  if(value===undefined || value===null) return '';
  if(typeof value!=='string') fail(400,label+' érvénytelen.');
  const text=value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if(text.length>max) fail(400,label+' legfeljebb '+max+' karakter lehet.');
  return text;
}
function cleanProfile(body) {
  const avatar=body.avatar===undefined||body.avatar===null||body.avatar===''?'':String(body.avatar);
  if(avatar && !/^av(0[1-9]|[1-4]\d|50)$/.test(avatar)) fail(400,'Érvénytelen avatár.');
  return {titulus:profileText(body.titulus,60,'A vicces cím'),priusz:profileText(body.priusz,140,'A priusz-szöveg'),
    jelveny:profileText(body.jelveny,8,'A jelvény').toUpperCase(),avatar};
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
  const header=(typeof req.get==='function'?req.get('cookie'):req.headers&&req.headers.cookie)||'';
  for(const piece of header.split(';')) {
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
  // Egy külső szolgáltató (Google / Discord) hozzáadódott a fiókhoz vagy belépett vele: a bolt feloldhat hozzá tárgyat (pl. Discord-háttér).
  // A hívás a mentés belsejében történik, a hiba nem állíthatja meg a belépést.
  const perk=(user,provider)=>{try {options.onProviderLinked?.(user,provider);} catch(_) { /* a jutalom hibája nem számít */ }};
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
  // A fix (alapító) kártyák nevei nem foglalhatók le fiókkal.
  const reserved=name=>(options.reservedNames?options.reservedNames():[]).some(r=>normalize(r)===normalize(name));
  const publicUser=user=>user?{id:user.id,username:user.username,email:user.email,
    hasPassword:!!user.password,mustChangePassword:!!user.mustChangePassword,providers:Object.keys(user.providers||{}),legend:user.legend||'',
    profile:{titulus:'',priusz:'',jelveny:'',avatar:'',...(user.profile||{})}}:null;
  const rawSession=req=>{
    if(!store) return null;
    const token=cookies(req)[COOKIE];
    if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const entry=store.state.sessions.find(s=>s.hash===digest(token) && s.expiresAt>now());
    return entry?store.state.users.find(user=>user.id===entry.userId)||null:null;
  };
  // A bejelentkezett fiók, DE: amíg az ideiglenes jelszót nem cserélte le (mustChangePassword), a fiók-funkciók (profil, barátok, bolt, socket-azonosítás,
  // törlés) nem érhetők el: a többi modul vendégként látja. A státusz és a jelszócsere a rawSession-t használja.
  const session=req=>{
    const user=rawSession(req);
    return user && !user.mustChangePassword?user:null;
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
      const account=data.users.find(u=>u.id===user.id);
      if(account) account.lastLoginAt=now();
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
  router.get('/status',(req,res)=>res.json({user:publicUser(rawSession(req)),
    available:!storageError,providers:{google:enabled('google'),discord:enabled('discord')},
    passwordReset:mailEnabled && !storageError}));
  router.use((req,res,next)=>storageError?res.status(503).json({error:'A fiókkezelés most nem elérhető. Próbáld újra később.'}):next());
  router.post('/register',wrap(async(req,res)=>{
    // Legendás kártya igénylése: érvényes igénylő-kóddal a fiók a legenda pontos nevén jön létre (a név egyébként foglalt).
    let legendName=null;
    if(req.body.legend!==undefined && req.body.legend!=='') {
      legendName=typeof req.body.legend==='string' && options.claimLegend?options.claimLegend(req.body.legend,req.body.claim):null;
      if(!legendName) fail(403,'Ez az igénylő-link érvénytelen. Kérj újat attól, aki küldte.');
    }
    const address=email(req.body.email),name=legendName||username(req.body.username),password=newPassword(req.body);
    const record=await hash(password);
    const user=store.commit(data=>{
      if(data.users.some(u=>u.email===address)) fail(409,'Ezzel az e-mail címmel már van fiók.');
      if(data.users.some(u=>normalize(u.username)===normalize(name))) fail(409,legendName?'Ezt a legendás kártyát már igényelték. Jelentkezz be a fiókjával.':'Ez a felhasználónév már foglalt.');
      if(!legendName && reserved(name)) fail(409,'Ez a felhasználónév már foglalt.');
      const user={id:crypto.randomUUID(),username:name,email:address,password:record,providers:{},createdAt:now()};
      if(legendName) {
        user.legend=legendName;
        user.profile=cleanProfile(options.legendProfile?options.legendProfile(legendName):{});
      }
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
    if(user.mustChangePassword && user.tempPasswordExpiresAt && user.tempPasswordExpiresAt<now()) {
      fail(401,'Az ideiglenes jelszó lejárt. Kérj újat attól, aki a fiókot létrehozta.');
    }
    createSession(user,req,res,remember(req));res.json({user:publicUser(user)});
  }));
  // Jelszócsere: a mostani (ideiglenes) jelszó ellenőrzésével, új jelszóval (12–128 karakter). Az ideiglenes jelszó kötelező cseréje itt zárul: a fiók
  // korlátozása megszűnik, a többi munkamenet kilép, a mostani marad.
  router.post('/change-password',wrap(async(req,res)=>{
    const current=rawSession(req);
    if(!current) fail(401,'Előbb jelentkezz be.');
    if(!current.password) fail(400,'Ehhez a fiókhoz nem tartozik jelszó (Google / Discord belépés).');
    const given=req.body.currentPassword;
    if(typeof given!=='string' || !given.length || given.length>128) fail(400,'Add meg a mostani (ideiglenes) jelszavad.');
    if(!(await verify(given,current.password))) fail(401,'A mostani jelszó hibás.');
    const next=newPassword(req.body);
    if(next===given) fail(400,'Az új jelszó legyen más, mint a mostani.');
    const record=await hash(next), keep=digest(cookies(req)[COOKIE]);
    const user=store.commit(data=>{
      const account=data.users.find(u=>u.id===current.id);
      if(!account) fail(401,'Előbb jelentkezz be.');
      account.password=record;delete account.mustChangePassword;delete account.tempPasswordExpiresAt;
      data.sessions=data.sessions.filter(s=>s.userId!==account.id || s.hash===keep);
      data.resets=data.resets.filter(r=>r.userId!==account.id);
      return account;
    });
    res.json({user:publicUser(user)});
  }));
  // Saját kártya szerkesztése: név, vicces cím, priusz-szöveg, jelvény, avatár (csak bejelentkezve).
  router.post('/profile',rate,wrap((req,res)=>{
    const current=session(req);
    if(!current) fail(401,'Előbb jelentkezz be.');
    const body=req.body||{};
    const name=body.username===undefined?current.username:username(body.username);
    const profile=cleanProfile(body);
    const oldName=current.username;
    const saved=store.commit(data=>{
      const user=data.users.find(u=>u.id===current.id);
      if(!user) fail(401,'Előbb jelentkezz be.');
      if(normalize(name)!==normalize(user.username)) {
        if(user.legend) fail(400,'A legendás kártya neve nem módosítható.');
        if(reserved(name)) fail(409,'Ez a név az alapító karakterekhez tartozik, válassz másikat.');
        if(data.users.some(u=>u.id!==user.id && normalize(u.username)===normalize(name))) fail(409,'Ez a felhasználónév már foglalt.');
      }
      user.username=name;user.profile=profile;
      return user;
    });
    if(saved.username!==oldName) {try {options.onRename?.(oldName,saved.username);} catch(_) { /* a statisztika átvitele nem állíthatja meg a mentést */ }}
    res.json({user:publicUser(saved)});
  }));
  // A fiók végleges eltávolítása (a saját törlés és az üzemeltetői törlés közös útja). Egy mentésben: a fiók, a munkamenetei és a visszaállító tokenjei megszűnnek,
  // és a MÁS fiókok kapcsolatai közül (barát, kérés, tiltás) is kikerül. A játék többi adatát (privát üzenetek, statisztika, élő kapcsolatok)
  // a server.js `onDelete` kezelője takarítja.
  function removeAccount(userId) {
    const gone=store.commit(data=>{
      const user=data.users.find(u=>u.id===userId);
      if(!user) fail(404,'Nincs ilyen fiók.');
      const friends=[...(user.social?.friends||[])];
      data.users=data.users.filter(u=>u.id!==user.id);
      data.sessions=data.sessions.filter(s=>s.userId!==user.id);
      data.resets=data.resets.filter(r=>r.userId!==user.id);
      for(const other of data.users) {
        const social=other.social;
        if(social && typeof social==='object') for(const key of ['friends','incoming','outgoing','blocked']) {
          if(Array.isArray(social[key])) social[key]=social[key].filter(id=>id!==user.id);
        }
      }
      return {id:user.id,username:user.username,legend:user.legend||'',friends};
    });
    try {options.onDelete?.(gone);} catch(error) {console.error('A fiók-törlés utólagos takarítása hibázott:',scrub(error&&error.message,200));}
    return gone;
  }
  // Fiók törlése (végleges). Újra-azonosítás kell: jelszavas fióknál a jelszó, jelszó nélkülinél (Google/Discord) a felhasználónév begépelése.
  router.post('/delete',wrap(async(req,res)=>{
    const current=session(req);
    if(!current) fail(401,'Előbb jelentkezz be.');
    if(current.password) {
      if(typeof req.body.password!=='string' || !req.body.password.length || req.body.password.length>128) fail(400,'A törléshez add meg a jelszavad.');
      if(!(await verify(req.body.password,current.password))) fail(401,'Hibás jelszó.');
    } else if(typeof req.body.confirmName!=='string' || normalize(req.body.confirmName)!==normalize(current.username)) {
      fail(400,'A törléshez írd be pontosan a felhasználóneved.');
    }
    removeAccount(current.id);
    res.clearCookie(COOKIE,cookieOptions(req));
    res.json({ok:true});
  }));
  router.post('/logout',wrap((req,res)=>{
    const token=cookies(req)[COOKIE];
    if(token) store.commit(data=>{data.sessions=data.sessions.filter(s=>s.hash!==digest(token));});
    res.clearCookie(COOKIE,cookieOptions(req));res.json({ok:true});
  }));
  // Visszaállító token kiadása: a /forgot és az admin-felület közös útja (egy felhasználónak egyszerre egy él).
  function issueReset(user) {
    const token=crypto.randomBytes(32).toString('base64url');
    store.commit(data=>{
      data.resets=data.resets.filter(r=>r.userId!==user.id && r.expiresAt>now());
      data.resets.push({hash:digest(token),userId:user.id,expiresAt:now()+60*60*1000});
    });
    return token;
  }
  // Levélküldés (Resend vagy teszt-küldő). Hiba esetén a Resend válaszkódját és üzenetét is megmutatja (az API-kulcs soha nem szerepel benne).
  async function deliver(message) {
    if(options.sendMail) return options.sendMail(message);
    let result;
    try {
      result=await request('https://api.resend.com/emails',{method:'POST',
        headers:{Authorization:'Bearer '+env.AUTH_MAIL_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({...message,from:env.AUTH_MAIL_FROM,to:[message.to]}),signal:AbortSignal.timeout(10000)});
    } catch(error) {error.mail=true;throw error;} // hálózati hiba / időtúllépés
    if(!result.ok) {
      let detail='';
      try {detail=String((await result.json()).message||'');} catch(_) { /* nincs JSON-törzs */ }
      const error=new Error('Mail delivery failed ('+result.status+')'+(detail?': '+scrub(detail,200):''));
      error.mail=true;throw error;
    }
  }
  router.post('/forgot',wrap(async(req,res)=>{
    if(!mailEnabled) fail(503,'A jelszó-visszaállítás jelenleg nem elérhető.');
    const address=email(req.body.email), user=store.state.users.find(u=>u.email===address && u.password);
    if(user) {
      const token=issueReset(user);
      const message={to:user.email,subject:'Kamu Bíróság – új jelszó',
        text:'Új jelszó beállításához nyisd meg ezt a linket:\n'+origin+'/#reset='+token+'\n\nA link 1 óráig, egyszer használható. Ha nem te kérted, hagyd figyelmen kívül.'};
      // Respond uniformly; email transport never reveals whether an account exists.
      Promise.resolve().then(()=>deliver(message)).catch(error=>{
        try {store.commit(data=>{data.resets=data.resets.filter(r=>r.hash!==digest(token));});}
        catch(_) {console.error('A sikertelen visszaállító link törlése nem sikerült.');}
        console.error('A jelszó-visszaállító levél kézbesítése nem sikerült:',scrub(error&&error.message,200));
        try {options.onError?.('mail',error);} catch(_) { /* a naplózás hibája nem állíthat meg semmit */ }
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
      user.password=record;delete user.mustChangePassword;delete user.tempPasswordExpiresAt;
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
      state:nonce,prompt:provider==='google'?'select_account':'none'})) url.searchParams.set(key,value);
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
          user.providers[provider]=providerId;perk(user,provider);return user;
        });
      } else if(existing) {
        user=options.onProviderLinked?store.commit(data=>{
          const found=data.users.find(u=>u.id===existing.id);
          if(found) perk(found,provider);
          return found||existing;
        }):existing;
      } else {
        // Matching an email alone never links a provider to an existing password account.
        if(store.state.users.some(u=>u.email===address)) return bounce('email_used');
        const raw=String(profile.global_name||profile.name||profile.username||'Játékos')
          .normalize('NFKC').replace(/[^\p{L}\p{N} _.-]/gu,'').trim().slice(0,16)||'Játékos';
        user=store.commit(data=>{
          let name=raw.length>=3?raw:'Játékos',suffix=1;
          while(data.users.some(u=>normalize(u.username)===normalize(name)) || reserved(name)) name=raw.slice(0,14)+'-'+suffix++;
          const user={id:crypto.randomUUID(),username:name,email:address,password:null,
            providers:{[provider]:providerId},createdAt:now()};
          perk(user,provider);
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
    try {options.onError?.('http',error,{path:'/api/auth'+req.path});} catch(_) { /* naplózási hiba nem számít */ }
    res.status(503).json({error:'A fiókkezelés most nem elérhető. Próbáld újra később.'});
  });
  // A bolt (shop.js) és a játék-szerver (hitelesített kozmetikumok) ezeket használja.
  const mutate=(userId,edit)=>{
    if(!store) fail(503,'A fiókkezelés most nem elérhető.');
    return store.commit(data=>{
      const user=data.users.find(u=>u.id===userId);
      if(!user) fail(401,'Előbb jelentkezz be.');
      return edit(user,data);
    });
  };
  const expectedOrigin=req=>origin||req.protocol+'://'+req.get('host');
  // Csak olvasásra: a barátlista (social.js) ebből keresi a fiókokat azonosító és név alapján.
  const directory={
    byId:id=>(store&&typeof id==='string'?store.state.users.find(u=>u.id===id):null)||null,
    byName:name=>(store&&typeof name==='string'?store.state.users.find(u=>normalize(u.username)===normalize(name)):null)||null
  };
  // Üzemeltetői műveletek (az admin.js hívja, ADMIN_TOKEN mögött): levélküldés próbája és kézi visszaállító link.
  const admin={
    mailStatus:()=>({configured:mailEnabled,baseUrl:!!origin,sender:!!(options.sendMail||env.AUTH_MAIL_FROM),key:!!(options.sendMail||env.AUTH_MAIL_API_KEY)}),
    async sendTestMail(to) {
      if(!mailEnabled) fail(503,'A levélküldés nincs beállítva (AUTH_MAIL_API_KEY, AUTH_MAIL_FROM, AUTH_BASE_URL).');
      await deliver({to:email(to),subject:'Kamu Bíróság – próbalevél',text:'Ez egy próbalevél a Kamu Bíróság szerveréről. Ha ezt olvasod, a levélküldés működik.'});
    },
    // Az összes fiók (jelszó-kivonat nélkül): az admin-oldal listájához.
    legendNames:()=>options.legendNames?options.legendNames():[],
    listAccounts() {
      if(!store) fail(503,'A fiókkezelés most nem elérhető.');
      return store.state.users.map(u=>({id:u.id,username:u.username,email:u.email,legend:u.legend||'',createdAt:u.createdAt||0,lastLoginAt:u.lastLoginAt||0,
        password:!!u.password,providers:Object.keys(u.providers||{}),mustChangePassword:!!u.mustChangePassword,tempPasswordExpiresAt:u.tempPasswordExpiresAt||0}))
        .sort((a,b)=>b.createdAt-a.createdAt);
    },
    // Új fiók ideiglenes jelszóval. Ha a név egy legendás kártya pontos neve (vagy megadják a `legend` mezőt), a fiók ahhoz a kártyához kötődik
    // (ugyanúgy, mint az igénylő-linknél). Az első belépéskor kötelező az új jelszó. Az ideiglenes jelszót csak ez a válasz tartalmazza (nem tároljuk, nem naplózzuk).
    async createAccount(body) {
      if(!store) fail(503,'A fiókkezelés most nem elérhető.');
      body=body||{};
      const address=email(body.email);
      const wanted=typeof body.legend==='string'?body.legend.trim():'';
      const typed=typeof body.username==='string'?body.username.trim():'';
      const legendName=options.legendByName?(options.legendByName(wanted||typed)||null):null;
      if(wanted && !legendName) fail(400,'Ismeretlen legendás kártya: '+wanted.slice(0,30));
      const name=legendName||username(typed);
      const password=temporaryPassword(), record=await hash(password);
      const user=store.commit(data=>{
        if(data.users.some(u=>u.email===address)) fail(409,'Ezzel az e-mail címmel már van fiók.');
        if(data.users.some(u=>normalize(u.username)===normalize(name))) fail(409,legendName?'Ezt a legendás kártyát már igényelték.':'Ez a felhasználónév már foglalt.');
        if(!legendName && reserved(name)) fail(409,'Ez a felhasználónév már foglalt (alapító karakter).');
        const account={id:crypto.randomUUID(),username:name,email:address,password:record,providers:{},createdAt:now(),
          mustChangePassword:true,tempPasswordExpiresAt:now()+TEMP_PASSWORD_MS,createdBy:'admin'};
        if(legendName) {
          account.legend=legendName;
          account.profile=cleanProfile(options.legendProfile?options.legendProfile(legendName):{});
        }
        data.users.push(account);return account;
      });
      return {username:user.username,email:user.email,legend:user.legend||'',temporaryPassword:password,expiresInDays:TEMP_PASSWORD_MS/86400000};
    },
    // Fiók végleges törlése az üzemeltetőtől (pl. elrontott teszt-fiók): a felhasználónevet pontosan meg kell adni, hogy véletlenül ne törlődjön semmi.
    // A legendás kártya statisztikája megmarad, a legenda újra odaadható.
    deleteAccount(id,confirmName) {
      if(!store) fail(503,'A fiókkezelés most nem elérhető.');
      const found=store.state.users.find(u=>u.id===id);
      if(!found) fail(404,'Nincs ilyen fiók.');
      if(typeof confirmName!=='string' || normalize(confirmName)!==normalize(found.username)) fail(400,'A törléshez a felhasználónevet pontosan be kell írni.');
      const gone=removeAccount(id);
      return {ok:true,username:gone.username,legend:gone.legend};
    },
    // Új ideiglenes jelszó egy meglévő jelszavas fiókhoz (pl. elfelejtett jelszó, vagy az előző lejárt): a régi jelszó és a munkamenetek megszűnnek.
    async newTemporaryPassword(id) {
      if(!store) fail(503,'A fiókkezelés most nem elérhető.');
      const found=store.state.users.find(u=>u.id===id);
      if(!found) fail(404,'Nincs ilyen fiók.');
      if(!found.password) fail(409,'Ez a fiók Google / Discord belépést használ, nincs jelszava.');
      const password=temporaryPassword(), record=await hash(password);
      const user=store.commit(data=>{
        const account=data.users.find(u=>u.id===id);
        if(!account) fail(404,'Nincs ilyen fiók.');
        account.password=record;account.mustChangePassword=true;account.tempPasswordExpiresAt=now()+TEMP_PASSWORD_MS;
        data.sessions=data.sessions.filter(s=>s.userId!==id);
        data.resets=data.resets.filter(r=>r.userId!==id);
        return account;
      });
      return {username:user.username,email:user.email,temporaryPassword:password,expiresInDays:TEMP_PASSWORD_MS/86400000};
    },
    resetLinkFor(address) {
      if(!store) fail(503,'A fiókkezelés most nem elérhető.');
      if(!origin) fail(503,'Az AUTH_BASE_URL nincs beállítva, a link nem készíthető el.');
      const user=store.state.users.find(u=>u.email===email(address) && u.password);
      if(!user) fail(404,'Nincs jelszavas fiók ezzel az e-mail címmel.');
      return {link:origin+'/#reset='+issueReset(user),username:user.username,expiresInMinutes:60};
    }
  };
  return {router,session,mutate,expectedOrigin,directory,admin};
}
module.exports={createAuth,loadAuthEnvironment};
