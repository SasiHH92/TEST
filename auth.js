'use strict';
// Valódi HTTP-kérések, ideiglenes fióktár. Külső belépés/levél csak teszt-transporttal.
const assert=require('assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const http=require('http');
const crypto=require('crypto');
const express=require('express');
const {createAuth,loadAuthEnvironment}=require('../auth');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'kamu-auth-'));
const servers=[];
let passed=0,failed=0;
async function test(name,work) {
  try {await work();passed++;console.log('PASS: '+name);}
  catch(error) {failed++;console.error('FAIL: '+name+'\n'+error.stack);}
}
async function boot(options={}) {
  const app=express(),server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
  const base='http://127.0.0.1:'+server.address().port;
  const file=options.file||path.join(root,crypto.randomUUID()+'.json');
  const env={AUTH_BASE_URL:base,...options.env};
  app.use('/api/auth',createAuth({...options,file,env}).router);
  app.get('/health',(req,res)=>res.send('ok'));
  const jar=()=>new Map();
  async function req(method,route,body,settings={}) {
    const headers={...(method==='POST'?{'Content-Type':'application/json','Origin':base}:{}),...settings.headers};
    if(settings.jar?.size) headers.Cookie=[...settings.jar].map(([key,value])=>key+'='+value).join('; ');
    const response=await fetch(base+'/api/auth'+route,{method,headers,redirect:'manual',
      body:settings.raw!==undefined?settings.raw:body===undefined?undefined:JSON.stringify(body)});
    const cookieHeaders=response.headers.getSetCookie();
    if(settings.jar) for(const cookie of cookieHeaders) {
      const first=cookie.split(';')[0],index=first.indexOf('='),key=first.slice(0,index),value=first.slice(index+1);
      if(value) settings.jar.set(key,value);else settings.jar.delete(key);
    }
    const content=await response.text();
    let data;try {data=JSON.parse(content);} catch(_) {data=null;}
    return {status:response.status,data,text:content,cookies:cookieHeaders,headers:response.headers,
      location:response.headers.get('location')};
  }
  return {base,file,req,jar,server};
}
const password='Egy hosszú titok 123!';
const registration=(name='Teszt Anna',address='anna@example.invalid')=>({username:name,email:address,password,confirmPassword:password});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
async function main() {
  let clock=Date.now();
  const mail=[];
  const api=await boot({now:()=>clock,maxAttempts:100,sendMail:async message=>{mail.push(message);}});
  const first=api.jar(),remembered=api.jar(),other=api.jar();
  let userId,resetToken;
  await test('Névtelen állapot és konfigurációs kapcsolók',async()=>{
    const result=await api.req('GET','/status');
    assert.equal(result.status,200);assert.equal(result.data.user,null);assert.equal(result.data.available,true);
    assert.deepEqual(result.data.providers,{google:false,discord:false});assert.equal(result.data.passwordReset,true);
    assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(fs.existsSync(api.file),false);
  });
  await test('Regisztráció: valós fiók és HttpOnly munkamenet',async()=>{
    const result=await api.req('POST','/register',registration(),{jar:first});
    assert.equal(result.status,201);userId=result.data.user.id;
    assert.equal(result.data.user.username,'Teszt Anna');assert.equal(result.data.user.hasPassword,true);
    assert.match(result.cookies[0],/HttpOnly/);assert.match(result.cookies[0],/SameSite=Lax/);
    assert.doesNotMatch(result.cookies[0],/Max-Age/);
    assert.equal((await api.req('GET','/status',undefined,{jar:first})).data.user.id,userId);
  });
  await test('Sózott scrypt, csak hash-elt session, nincs jelszó az API-ban',async()=>{
    const raw=fs.readFileSync(api.file,'utf8'),store=JSON.parse(raw),token=first.get('kb_account');
    assert.doesNotMatch(raw,new RegExp(password));assert.ok(!raw.includes(token));
    assert.equal(store.users[0].password.algorithm,'scrypt-v1');assert.equal(store.sessions[0].hash,sha(token));
    assert.equal(Buffer.from(store.users[0].password.hash,'base64url').length,64);
    if(process.platform!=='win32') assert.equal(fs.statSync(api.file).mode&0o777,0o600);
    const result=await api.req('GET','/status',undefined,{jar:first});
    assert.ok(!('password' in result.data.user));assert.ok(!('sessions' in result.data));
  });
  await test('E-mail és név egyedisége, kis/nagybetű és Unicode normalizálás',async()=>{
    assert.equal((await api.req('POST','/register',registration('Másik Anna','ANNA@example.invalid'))).status,409);
    assert.equal((await api.req('POST','/register',registration('ｔｅｓｚｔ Ａｎｎａ','other@example.invalid'))).status,409);
    assert.equal(JSON.parse(fs.readFileSync(api.file)).users.length,1);
  });
  await test('Hibás név, cím, rövid/eltérő/túl hosszú jelszó elutasítása',async()=>{
    for(const values of [{username:'xy'},{username:'<script>'},{email:'hibás'},
      {password:'rövid',confirmPassword:'rövid'},{confirmPassword:'nem azonos'},
      {password:'x'.repeat(129),confirmPassword:'x'.repeat(129)}]) {
      assert.equal((await api.req('POST','/register',{...registration('Érvényes','valid@example.invalid'),...values})).status,400);
    }
  });
  await test('Ismeretlen fiók és hibás jelszó azonos belépési hibát ad',async()=>{
    const wrong=await api.req('POST','/login',{email:'anna@example.invalid',password:'Hibás jelszó 1234'});
    const unknown=await api.req('POST','/login',{email:'unknown@example.invalid',password:'Hibás jelszó 1234'});
    assert.equal(wrong.status,401);assert.equal(unknown.status,401);assert.deepEqual(wrong.data,unknown.data);
    assert.equal((await api.req('POST','/login',{email:'anna@example.invalid',password:'x'.repeat(129)})).status,400);
  });
  await test('Emlékezz rám: 30 nap, új véletlen token, munkamenet-rotáció',async()=>{
    const old=first.get('kb_account');
    const result=await api.req('POST','/login',{email:' ANNA@example.invalid ',password,remember:true},{jar:first});
    assert.equal(result.status,200);assert.match(result.cookies[0],/Max-Age=2592000/);
    assert.notEqual(first.get('kb_account'),old);
    remembered.set('kb_account',first.get('kb_account'));
    const oldJar=api.jar();oldJar.set('kb_account',old);
    assert.equal((await api.req('GET','/status',undefined,{jar:oldJar})).data.user,null);
  });
  await test('Kijelentkezés visszavonja a szerveroldali munkamenetet',async()=>{
    const old=remembered.get('kb_account');
    assert.equal((await api.req('POST','/logout',{}, {jar:first})).status,200);assert.equal(first.has('kb_account'),false);
    const replay=api.jar();replay.set('kb_account',old);
    assert.equal((await api.req('GET','/status',undefined,{jar:replay})).data.user,null);
  });
  await test('Fiók és munkamenet megmarad a fiókmodul újraindítása után',async()=>{
    await api.req('POST','/login',{email:'anna@example.invalid',password},{jar:first});
    const reboot=await boot({file:api.file,now:()=>clock});
    assert.equal((await reboot.req('GET','/status',undefined,{jar:first})).data.user.id,userId);
    assert.equal((await reboot.req('POST','/login',{email:'anna@example.invalid',password},{jar:other})).status,200);
  });
  await test('Alap munkamenet 8 óra után lejár, megjegyzett 30 napig él',async()=>{
    await api.req('POST','/login',{email:'anna@example.invalid',password,remember:true},{jar:remembered});
    clock+=8*60*60*1000+1;
    assert.equal((await api.req('GET','/status',undefined,{jar:first})).data.user,null);
    assert.equal((await api.req('GET','/status',undefined,{jar:remembered})).data.user.id,userId);
    clock+=30*24*60*60*1000;
    assert.equal((await api.req('GET','/status',undefined,{jar:remembered})).data.user,null);
  });
  await test('Eltérő Origin, nem JSON, hibás/túl nagy JSON elutasítása',async()=>{
    assert.equal((await api.req('POST','/login',{}, {headers:{Origin:'https://other.invalid'}})).status,403);
    assert.equal((await api.req('POST','/login',{}, {headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await api.req('POST','/login',undefined,{raw:'{'})).status,400);
    assert.equal((await api.req('POST','/login',{padding:'x'.repeat(9000)})).status,413);
    assert.equal((await api.req('POST','/login',[])).status,400);
  });
  await test('Ismeretlen és létező e-mailre azonos visszaállítási válasz',async()=>{
    const known=await api.req('POST','/forgot',{email:'anna@example.invalid'});
    const unknown=await api.req('POST','/forgot',{email:'unknown@example.invalid'});
    assert.equal(known.status,200);assert.deepEqual(known.data,unknown.data);assert.equal(mail.length,1);
    const link=mail[0].text.match(/http[^\s]+/)[0],url=new URL(link);
    assert.equal(url.origin,api.base);assert.equal(url.search,'');assert.match(url.hash,/^#reset=/);
    resetToken=url.hash.slice(7);
    const store=JSON.parse(fs.readFileSync(api.file));
    assert.equal(store.resets[0].hash,sha(resetToken));assert.ok(!fs.readFileSync(api.file,'utf8').includes(resetToken));
  });
  await test('Új jelszó: egyszer használható link és minden régi session visszavonása',async()=>{
    await api.req('POST','/login',{email:'anna@example.invalid',password},{jar:first});
    await api.req('POST','/login',{email:'anna@example.invalid',password},{jar:other});
    const oldFirst=new Map(first),newPassword='Ez már az új jelszó 456!';
    const body={token:resetToken,password:newPassword,confirmPassword:newPassword};
    assert.equal((await api.req('POST','/reset',body,{jar:first})).status,200);
    assert.equal((await api.req('GET','/status',undefined,{jar:oldFirst})).data.user,null);
    assert.equal((await api.req('GET','/status',undefined,{jar:other})).data.user,null);
    assert.equal((await api.req('GET','/status',undefined,{jar:first})).data.user.id,userId);
    assert.equal((await api.req('POST','/reset',body)).status,400);
    assert.equal((await api.req('POST','/login',{email:'anna@example.invalid',password})).status,401);
    assert.equal((await api.req('POST','/login',{email:'anna@example.invalid',password:newPassword})).status,200);
  });
  await test('Lejárt és hamis visszaállító token nem módosít jelszót',async()=>{
    await api.req('POST','/forgot',{email:'anna@example.invalid'});
    const token=new URL(mail[1].text.match(/http[^\s]+/)[0]).hash.slice(7);clock+=60*60*1000+1;
    const body={token,password,confirmPassword:password};
    assert.equal((await api.req('POST','/reset',body)).status,400);
    assert.equal((await api.req('POST','/reset',{...body,token:'hamis'})).status,400);
  });
  await test('Próbálkozási korlát és Retry-After',async()=>{
    const limited=await boot({maxAttempts:2});
    for(let i=0;i<2;i++) assert.equal((await limited.req('POST','/login',{})).status,400);
    const result=await limited.req('POST','/login',{});assert.equal(result.status,429);
    assert.ok(Number(result.headers.get('retry-after'))>0);
  });
  await test('Secure süti HTTPS telepítésnél; szolgáltatók kulcs nélkül kikapcsolva',async()=>{
    const secure=await boot({env:{AUTH_BASE_URL:'https://game.example.invalid'}});
    const result=await secure.req('POST','/register',registration(),{headers:{Origin:'https://game.example.invalid'}});
    assert.equal(result.status,201);assert.match(result.cookies[0],/Secure/);
    assert.equal((await secure.req('GET','/google/start')).status,503);
    assert.equal((await secure.req('GET','/discord/start')).status,503);
    assert.equal((await secure.req('POST','/forgot',{email:'anna@example.invalid'},
      {headers:{Origin:'https://game.example.invalid'}})).status,503);
  });
  await test('Sérült fióktár nem íródik felül; a többi Express útvonal működik',async()=>{
    const file=path.join(root,'corrupt.json');fs.writeFileSync(file,'{broken');
    const broken=await boot({file});
    assert.equal((await broken.req('GET','/status')).data.available,false);
    assert.equal((await broken.req('POST','/register',registration())).status,503);
    assert.equal(fs.readFileSync(file,'utf8'),'{broken');assert.equal((await fetch(broken.base+'/health')).status,200);
  });
  await test('Hibás külső URL nem állítja le az e-mailes fiókkezelést',async()=>{
    const invalid=await boot({env:{AUTH_BASE_URL:'http://unsafe.example.invalid',AUTH_GOOGLE_CLIENT_ID:'g',AUTH_GOOGLE_CLIENT_SECRET:'secret'}});
    assert.equal((await invalid.req('GET','/status')).data.providers.google,false);
    assert.equal((await invalid.req('POST','/register',registration())).status,201);
  });
  await test('.env csak AUTH_ változókat tölt és nem ír felül környezeti beállítást',async()=>{
    const file=path.join(root,'sample.env'),key='AUTH_TEST_LOAD',keep=process.env[key];
    fs.writeFileSync(file,'PORT=9876\nAUTH_TEST_LOAD="idézett érték"\nAUTH_TEST_EMPTY= # megjegyzés\n');
    const oldPort=process.env.PORT;delete process.env[key];loadAuthEnvironment(file);
    assert.equal(process.env[key],'idézett érték');assert.equal(process.env.PORT,oldPort);assert.equal(process.env.AUTH_TEST_EMPTY,'');
    process.env[key]='külső';loadAuthEnvironment(file);assert.equal(process.env[key],'külső');
    if(keep===undefined) delete process.env[key];else process.env[key]=keep;delete process.env.AUTH_TEST_EMPTY;
  });

  let profile={google:{sub:'google-1',email:'google@example.invalid',email_verified:true,name:'Google Játékos'},
    discord:{id:'discord-1',email:'discord@example.invalid',verified:true,global_name:'Discord Játékos'}};
  const exchanges=[];let failProvider=false,oauthClock=Date.now();
  const oauth=await boot({maxAttempts:100,now:()=>oauthClock,
    env:{AUTH_GOOGLE_CLIENT_ID:'google-test',AUTH_GOOGLE_CLIENT_SECRET:'google-secret',
      AUTH_DISCORD_CLIENT_ID:'discord-test',AUTH_DISCORD_CLIENT_SECRET:'discord-secret'},
    fetch:async(url,settings)=>{
      exchanges.push({url,settings});
      if(failProvider) return new Response('{}',{status:503});
      const provider=url.includes('discord')?'discord':'google';
      return Response.json(url.includes('/token')?{access_token:'test-access-token'}:profile[provider]);
    }});
  const googleJar=oauth.jar(),discordJar=oauth.jar(),localJar=oauth.jar();let googleId,localId;
  async function start(provider,jar,query='') {
    const result=await oauth.req('GET','/'+provider+'/start'+query,undefined,{jar});
    assert.equal(result.status,302);return {result,url:new URL(result.location)};
  }
  async function callback(provider,jar,nonce,query='&code=mock-code') {
    return oauth.req('GET','/'+provider+'/callback?state='+encodeURIComponent(nonce)+query,undefined,{jar});
  }
  await test('Google indítás: redirect, state, HttpOnly süti, S256 PKCE, szobameghívó',async()=>{
    const {result,url}=await start('google',googleJar,'?room=abcd&remember=1');
    assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('scope'),'openid email profile');
    assert.equal(url.searchParams.get('redirect_uri'),oauth.base+'/api/auth/google/callback');
    assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(result.cookies[0],/HttpOnly/);
    const nonce=url.searchParams.get('state');assert.equal(googleJar.get('kb_oauth_google'),nonce);
    const result2=await callback('google',googleJar,nonce);
    assert.equal(result2.location,'/?auth=success&room=ABCD');assert.match(result2.cookies.join(';'),/Max-Age=2592000/);
    const tokenRequest=exchanges.find(item=>item.url==='https://oauth2.googleapis.com/token');
    const body=new URLSearchParams(tokenRequest.settings.body);
    assert.equal(body.get('client_secret'),'google-secret');assert.equal(body.get('grant_type'),'authorization_code');
    assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'),url.searchParams.get('code_challenge'));
    const user=(await oauth.req('GET','/status',undefined,{jar:googleJar})).data.user;
    googleId=user.id;assert.equal(user.hasPassword,false);assert.deepEqual(user.providers,['google']);
  });
  await test('Discord: identify/email, form-urlencoded tokenkérés, ellenőrzött fiók',async()=>{
    const {url}=await start('discord',discordJar);
    assert.equal(url.origin,'https://discord.com');assert.equal(url.searchParams.get('scope'),'identify email');
    assert.equal((await callback('discord',discordJar,url.searchParams.get('state'))).location,'/?auth=success');
    const exchange=exchanges.find(item=>item.url==='https://discord.com/api/oauth2/token');
    assert.equal(exchange.settings.headers['Content-Type'],'application/x-www-form-urlencoded');
    assert.equal(new URLSearchParams(exchange.settings.body).get('client_secret'),'discord-secret');
    const user=(await oauth.req('GET','/status',undefined,{jar:discordJar})).data.user;
    assert.equal(user.email,'discord@example.invalid');assert.deepEqual(user.providers,['discord']);
  });
  await test('Hiányzó/hamis state vagy kötő süti nem indít tokenváltást',async()=>{
    let calls=exchanges.length;
    assert.match((await callback('google',oauth.jar(),'hamis')).location,/auth_error=expired/);
    const {url}=await start('google',oauth.jar());
    assert.match((await callback('google',oauth.jar(),url.searchParams.get('state'))).location,/auth_error=expired/);
    assert.equal(exchanges.length,calls);
  });
  await test('OAuth-visszatérés egyszer használható, ugyanahhoz a provider-ID-hez lép be',async()=>{
    const {url}=await start('google',googleJar),nonce=url.searchParams.get('state');
    assert.match((await callback('google',googleJar,nonce)).location,/auth=success/);
    const calls=exchanges.length;
    assert.match((await callback('google',googleJar,nonce)).location,/auth_error=expired/);assert.equal(exchanges.length,calls);
    assert.equal((await oauth.req('GET','/status',undefined,{jar:googleJar})).data.user.id,googleId);
    assert.equal(JSON.parse(fs.readFileSync(oauth.file)).users.length,2);
  });
  await test('Megszakított és lejárt OAuth-kérés érthető hibával tér vissza',async()=>{
    let flow=await start('discord',discordJar),calls=exchanges.length;
    assert.match((await callback('discord',discordJar,flow.url.searchParams.get('state'),'&error=access_denied')).location,/auth_error=cancelled/);
    flow=await start('discord',discordJar);oauthClock+=10*60*1000+1;
    assert.match((await callback('discord',discordJar,flow.url.searchParams.get('state'))).location,/auth_error=expired/);
    assert.equal(exchanges.length,calls);
  });
  await test('Nem igazolt e-mail és szolgáltatói hiba nem hoz létre fiókot',async()=>{
    const previous=profile.google;profile.google={...previous,sub:'unverified',email_verified:false};
    let flow=await start('google',googleJar);
    assert.match((await callback('google',googleJar,flow.url.searchParams.get('state'))).location,/auth_error=unverified/);
    profile.google={...previous,sub:''};flow=await start('google',googleJar);
    assert.match((await callback('google',googleJar,flow.url.searchParams.get('state'))).location,/auth_error=unverified/);
    profile.google=previous;failProvider=true;flow=await start('discord',discordJar);
    assert.match((await callback('discord',discordJar,flow.url.searchParams.get('state'))).location,/auth_error=provider/);
    failProvider=false;assert.equal(JSON.parse(fs.readFileSync(oauth.file)).users.length,2);
  });
  await test('Azonos e-mail nem kapcsolódik automatikusan jelszavas fiókhoz',async()=>{
    const result=await oauth.req('POST','/register',registration('Helyi Játékos','local@example.invalid'),{jar:localJar});
    localId=result.data.user.id;profile.google={sub:'google-local',email:'local@example.invalid',email_verified:true,name:'Helyi Játékos'};
    const flow=await start('google',oauth.jar());
    const result2=await callback('google',new Map([['kb_oauth_google',flow.url.searchParams.get('state')]]),flow.url.searchParams.get('state'));
    assert.match(result2.location,/auth_error=email_used/);
    assert.deepEqual((await oauth.req('GET','/status',undefined,{jar:localJar})).data.user.providers,[]);
  });
  await test('Külső fiók csak bejelentkezett tulajdonos kérésére kapcsolható össze',async()=>{
    assert.equal((await oauth.req('GET','/google/start?link=1')).status,401);
    const flow=await start('google',localJar,'?link=1');
    assert.match((await callback('google',localJar,flow.url.searchParams.get('state'))).location,/auth=success/);
    const user=(await oauth.req('GET','/status',undefined,{jar:localJar})).data.user;
    assert.equal(user.id,localId);assert.deepEqual(user.providers,['google']);assert.equal(user.hasPassword,true);
    const fresh=oauth.jar(),again=await start('google',fresh);
    assert.match((await callback('google',fresh,again.url.searchParams.get('state'))).location,/auth=success/);
    assert.equal((await oauth.req('GET','/status',undefined,{jar:fresh})).data.user.id,localId);
  });
  await test('Másik fiókhoz kötött provider és megszűnt linkelő session elutasítása',async()=>{
    profile.discord={id:'discord-1',email:'discord@example.invalid',verified:true};
    let flow=await start('discord',localJar,'?link=1');
    assert.match((await callback('discord',localJar,flow.url.searchParams.get('state'))).location,/auth_error=provider_used/);
    flow=await start('discord',localJar,'?link=1');
    await oauth.req('POST','/logout',{}, {jar:localJar});
    assert.match((await callback('discord',localJar,flow.url.searchParams.get('state'))).location,/auth_error=expired/);
    assert.equal(JSON.parse(fs.readFileSync(oauth.file)).users.length,3);
  });
  await test('Google/Discord titkok és tokenek nem kerülnek nyilvános válaszba',async()=>{
    const status=await oauth.req('GET','/status',undefined,{jar:googleJar});
    assert.doesNotMatch(status.text,/google-secret|discord-secret|test-access-token|"password"\s*:|"sessions"\s*:|"hash"\s*:/);
    const raw=fs.readFileSync(oauth.file,'utf8');assert.doesNotMatch(raw,/google-secret|discord-secret|test-access-token/);
  });
  await test('Resend transport: címzett, feladó és Bearer fejléc',async()=>{
    let sent;
    const resend=await boot({env:{AUTH_MAIL_API_KEY:'test-mail-key',AUTH_MAIL_FROM:'Kamu <sender@example.invalid>'},
      fetch:async(url,settings)=>{sent={url,settings};return Response.json({id:'test-mail'});}});
    await resend.req('POST','/register',registration());
    assert.equal((await resend.req('POST','/forgot',{email:'anna@example.invalid'})).status,200);
    assert.equal(sent.url,'https://api.resend.com/emails');assert.equal(sent.settings.headers.Authorization,'Bearer test-mail-key');
    const body=JSON.parse(sent.settings.body);assert.deepEqual(body.to,['anna@example.invalid']);
    assert.equal(body.from,'Kamu <sender@example.invalid>');assert.match(body.text,/#reset=/);
  });
  await test('Sikertelen levélküldés visszavonja a kiadott reset-linket',async()=>{
    const failure=await boot({sendMail:async()=>{throw new Error('Mock delivery failure');}});
    await failure.req('POST','/register',registration());
    assert.equal((await failure.req('POST','/forgot',{email:'anna@example.invalid'})).status,200);
    await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(JSON.parse(fs.readFileSync(failure.file)).resets.length,0);
  });
}
main().catch(error=>{failed++;console.error(error.stack);}).finally(async()=>{
  for(const server of servers) {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
  fs.rmSync(root,{recursive:true,force:true});
  console.log('\nFiókkezelés: '+passed+' sikeres, '+failed+' hibás teszt.');
  process.exitCode=failed?1:0;
});
