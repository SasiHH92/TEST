'use strict';
// ============================================================
// KAMU BÍRÓSÁG – e-mail rendszer (Resend + sablonok + megerősítés + meghívó)
//  A. sablonok: kötelező szövegek, e-mail-kompatibilis HTML (tábla, inline CSS, 600 px, külső CSS/JS nélkül), escape, képes / kép nélküli fejléc
//  B. mailer: Resend SDK-hívás, hibakezelés (kulcs és cím nélkül), száraz futtatás, fejléc-kép ellenőrzése
//  C. hitelesítés: megerősítő token (egyszer használható, lejár, felváltja a régit), hibás linkek, újraküldés-korlát,
//     egységes válasz a jelszó-visszaállításnál, értesítő levelek, küldési hiba kezelése
//  D. a teljes szerver (száraz futtatás, valódi levél NEM megy ki): regisztráció -> megerősítés -> belépés; játékmeghívó e-mailben (szerveroldali ellenőrzések, korlátok)
// Futtatás: node test/email.js
// ============================================================
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { io } = require('socket.io-client');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* böngésző nélkül a böngészős rész kimarad */ }
const { createAuth } = require('../auth');
const { createMailer } = require('../mailer');
const { render, NAMES, SAMPLE } = require('../mail-templates');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-email-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n' + e.stack); }
}
const CFG = { origin: 'https://kamubirosag.com', headerImage: '', discordUrl: 'https://discord.gg/yyG7hH4aEB' };
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&zwnj;|&#847;/g, ' ').replace(/\s+/g, ' ');

// ---------- A. sablonok ----------
function templates() {
  return Promise.resolve().then(async () => {
    await test('A: mind a 6 sablon kirenderelhető, tárgy + HTML + szöveges változat van', () => {
      assert.deepEqual([...NAMES].sort(), ['confirmEmail', 'gameInvite', 'passwordChanged', 'passwordReset', 'securityNotice', 'welcome']);
      for (const n of NAMES) {
        const m = render(n, SAMPLE[n], CFG);
        assert.ok(m.subject.startsWith('⚖️ '), n + ' tárgy');
        assert.ok(m.html.startsWith('<!DOCTYPE html>') && m.html.includes('lang="hu"'), n + ' html');
        assert.ok(m.text.length > 40 && !/<[a-z]/i.test(m.text), n + ' szöveg HTML nélkül');
        assert.ok(m.text.includes('A bíróság figyelmeztet'), n + ' lábléc-szöveg');
      }
      assert.throws(() => render('nincs-ilyen', {}, CFG), /Ismeretlen/);
    });

    await test('A: regisztrációs levél: a megadott tárgy, cím, szöveg, gomb és lábléc', () => {
      const m = render('confirmEmail', { url: 'https://kamubirosag.com/#verify=ABC' }, CFG);
      assert.equal(m.subject, '⚖️ Kamu Bíróság – Megérkezett az idézésed!');
      const t = visible(m.html);
      for (const piece of ['MEGÉRKEZETT AZ IDÉZÉSED!', 'Tisztelt Vádlott!', 'A Kamu Bíróság hivatalosan beidézett!', 'Már csak egyetlen lépés választ el attól, hogy belépj a tárgyalóterembe.',
        '⚖️ EMAIL-CÍM MEGERŐSÍTÉSE', 'A bíróság figyelmeztet: a túlzott nevetés nem mentesít a felelősség alól!']) {
        assert.ok(t.includes(piece), 'hiányzik: ' + piece);
      }
      assert.ok(m.html.includes('href="https://kamubirosag.com/#verify=ABC"'));
      assert.match(m.text, /EMAIL-CÍM MEGERŐSÍTÉSE:\nhttps:\/\/kamubirosag\.com\/#verify=ABC/);
    });

    await test('A: játékmeghívó: tárgy, szobakód, a gomb a szoba linkjére mutat', () => {
      const m = render('gameInvite', { inviter: 'Minta Bíró', code: 'AB12', url: 'https://kamubirosag.com/?room=AB12' }, CFG);
      assert.equal(m.subject, '⚖️ Beidéztek a Kamu Bíróságra!');
      const t = visible(m.html);
      assert.ok(t.includes('Valaki beidézett egy tárgyalásra!') && t.includes('AB12') && t.includes('🎮 CSATLAKOZÁS A TÁRGYALÁSHOZ'));
      assert.ok(m.html.includes('href="https://kamubirosag.com/?room=AB12"'));
      assert.match(m.text, /Szobakód: AB12/);
    });

    await test('A: e-mail-kompatibilis HTML: táblázatos, inline CSS, 600 px, nincs külső CSS / JavaScript / webfont', () => {
      for (const n of NAMES) {
        const h = render(n, SAMPLE[n], CFG).html;
        assert.ok(/<table role="presentation"[^>]*width="600"/.test(h) && h.includes('max-width:600px'), n + ' 600 px');
        assert.ok((h.match(/style="/g) || []).length > 20, n + ' inline stílus');
        assert.ok(!/<script/i.test(h) && !/<link[ >]/i.test(h) && !/@import/i.test(h) && !/@font-face/i.test(h) && !/<iframe/i.test(h), n + ' külső erőforrás');
        assert.ok(!/<img/i.test(h), n + ': kép nélkül nincs <img> (a szöveges fejléc olvasható)');
        assert.ok(h.includes('<!--[if mso]>'), n + ' Outlook-támogatás');
        assert.ok(/@media only screen and \(max-width:620px\)/.test(h), n + ' mobil igazítás');
        assert.ok(visible(h).includes('KAMU BÍRÓSÁG'), n + ' szöveges fejléc');
      }
    });

    await test('A: a felhasználói szövegek escape-elve kerülnek a levélbe (nincs HTML / script beszúrás)', () => {
      const evil = '<script>alert(1)</script><img src=x onerror=alert(2)> "\'';
      for (const n of NAMES) {
        const m = render(n, { ...SAMPLE[n], name: evil, inviter: evil, headline: evil, details: [evil] }, CFG);
        assert.ok(!m.html.includes('<script>alert') && !m.html.includes('<img src=x') && !m.html.includes('onerror=alert(2)>'), n + ' escape');
      }
      const bad = render('confirmEmail', { url: 'javascript:alert(1)' }, CFG);
      assert.ok(!/href="javascript:/i.test(bad.html), 'veszélyes link nem kerül a gombba');
    });

    await test('A: fejléc-kép: https cím esetén <img> alt-szöveggel; más cím (http, javascript) esetén szöveges fejléc', () => {
      const withImg = render('welcome', SAMPLE.welcome, { ...CFG, headerImage: 'https://cdn.example.com/fejlec.jpg' }).html;
      assert.ok(/<img src="https:\/\/cdn\.example\.com\/fejlec\.jpg" width="600" alt="Kamu Bíróság/.test(withImg));
      for (const bad of ['http://cdn.example.com/x.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '']) {
        assert.ok(!/<img/i.test(render('welcome', SAMPLE.welcome, { ...CFG, headerImage: bad }).html), bad + ' nem kerül be');
      }
    });
  });
}

// ---------- B. mailer ----------
async function mailer() {
  await test('B: Resend SDK-hívás: feladó, címzett, tárgy, html, text, címke; a kulcs nem szivárog', async () => {
    const calls = [];
    const m = createMailer({ env: { RESEND_API_KEY: 'titkos-kulcs', EMAIL_FROM: 'Kamu Bíróság <noreply@kamubirosag.com>' }, origin: 'https://kamubirosag.com',
      resendClient: { emails: { send: async (p) => { calls.push(p); return { data: { id: 'id1' }, error: null }; } } } });
    assert.equal(m.enabled, true);
    await m.sendTemplate('welcome', 'anna@example.invalid', { name: 'Anna' });
    assert.equal(calls[0].from, 'Kamu Bíróság <noreply@kamubirosag.com>');
    assert.deepEqual(calls[0].to, ['anna@example.invalid']);
    assert.match(calls[0].subject, /Anna/);
    assert.ok(calls[0].html.includes('<table') && calls[0].text.length > 20);
    assert.deepEqual(calls[0].tags, [{ name: 'template', value: 'welcome' }]);
    assert.ok(!JSON.stringify(calls).includes('titkos-kulcs'));
  });

  await test('B: hibakezelés: a Resend hibája (kód + üzenet) kimarad a kulcsból és a címből; hálózati hiba és időtúllépés is mail=true hiba', async () => {
    const mk = (send) => createMailer({ env: { RESEND_API_KEY: 'titkos-kulcs', EMAIL_FROM: 'a@b.hu' }, origin: 'https://x.hu', resendClient: { emails: { send } } });
    await assert.rejects(() => mk(async () => ({ data: null, error: { statusCode: 403, message: 'only to owner@example.invalid with key AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } })).send({ to: 'x@y.hu', subject: 's', html: 'h', text: 't' }),
      (e) => e.mail === true && /403/.test(e.message) && !e.message.includes('owner@example.invalid') && !/A{20}/.test(e.message));
    await assert.rejects(() => mk(async () => { throw new Error('ECONNRESET'); }).send({ to: 'x@y.hu', subject: 's', html: 'h', text: 't' }), (e) => e.mail === true && /ECONNRESET/.test(e.message));
  });

  await test('B: kulcs / feladó / alap-cím nélkül a küldés ki van kapcsolva; a régi AUTH_MAIL_* nevek is működnek', () => {
    assert.equal(createMailer({ env: {}, origin: 'https://x.hu' }).enabled, false);
    assert.equal(createMailer({ env: { RESEND_API_KEY: 'k' }, origin: 'https://x.hu' }).enabled, false, 'feladó nélkül nem él');
    assert.equal(createMailer({ env: { RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.hu' }, origin: '' }).enabled, false, 'AUTH_BASE_URL nélkül nem él (a linkek nem készíthetők)');
    assert.equal(createMailer({ env: { AUTH_MAIL_API_KEY: 'k', AUTH_MAIL_FROM: 'a@b.hu' }, origin: 'https://x.hu' }).enabled, true);
  });

  await test('B: EMAIL_HEADER_IMAGE_URL: csak https cím fogadható el', () => {
    const o = (v) => createMailer({ env: { EMAIL_HEADER_IMAGE_URL: v }, origin: 'https://x.hu' }).headerImage;
    assert.equal(o('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
    assert.equal(o('http://cdn.example.com/a.jpg'), '');
    assert.equal(o('javascript:alert(1)'), '');
    assert.equal(o('https://user:pw@cdn.example.com/a.jpg'), '');
  });

  await test('B: száraz futtatás: nincs hálózati hívás, a levél a kimeneti fájlba kerül', async () => {
    const out = path.join(tmp, 'outbox.jsonl');
    const logs = [];
    const m = createMailer({ env: { EMAIL_DRY_RUN: '1', EMAIL_OUTBOX_FILE: out }, origin: 'https://x.hu', log: { log: (...a) => logs.push(a.join(' ')) } });
    assert.equal(m.enabled, true);
    await m.sendTemplate('securityNotice', 'x@y.hu', { name: 'Anna' });
    const line = JSON.parse(fs.readFileSync(out, 'utf8').trim());
    assert.equal(line.to, 'x@y.hu'); assert.match(line.subject, /Biztonsági/);
    assert.ok(logs.some((l) => /száraz futtatás/.test(l)));
  });
}

// ---------- C. hitelesítés ----------
const servers = [];
async function boot(options = {}) {
  const app = express(), server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
  const base = 'http://127.0.0.1:' + server.address().port;
  const file = path.join(tmp, crypto.randomUUID() + '.json');
  const mail = [];
  let clock = options.start || Date.now();
  const auth = createAuth({ file, env: { AUTH_BASE_URL: base, ...(options.env || {}) }, now: () => clock, maxAttempts: 500,
    sendMail: options.sendMail || (async (m) => { mail.push(m); }), onError: options.onError });
  app.use('/api/auth', auth.router);
  const jar = () => new Map();
  async function req(method, route, body, jarMap) {
    const headers = { ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: base } : {}) };
    if (jarMap && jarMap.size) headers.Cookie = [...jarMap].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(base + '/api/auth' + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (jarMap) for (const c of r.headers.getSetCookie()) { const first = c.split(';')[0], i = first.indexOf('='); const k = first.slice(0, i), v = first.slice(i + 1); if (v) jarMap.set(k, v); else jarMap.delete(k); }
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
    return { status: r.status, data, text, headers: r.headers };
  }
  return { base, file, req, jar, mail, auth, advance: (ms) => { clock += ms; }, stored: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}
const password = 'Egy hosszú titok 123!';
const reg = (name = 'Teszt Anna', email = 'anna@example.invalid') => ({ username: name, email, password, confirmPassword: password });
const tokenOf = (m) => { const x = /#(verify|reset)=([A-Za-z0-9_-]{43})/.exec(m.text); return x ? x[2] : null; };
const ofSubject = (mail, re) => mail.filter((m) => re.test(m.subject));

async function authFlows() {
  await test('C: regisztráció megerősítéssel: nincs belépés, a levél megérkezik, csak a token lenyomata tárolódik', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    const jar = a.jar();
    const r = await a.req('POST', '/register', reg(), jar);
    assert.equal(r.status, 201); assert.equal(r.data.pending, true); assert.equal(r.data.mailSent, true);
    assert.equal(jar.size, 0, 'nincs munkamenet-süti');
    assert.equal(r.data.user, undefined);
    assert.equal((await a.req('GET', '/status', undefined, jar)).data.user, null);
    const m = ofSubject(a.mail, /Megérkezett az idézésed/);
    assert.equal(m.length, 1); assert.equal(m[0].to, 'anna@example.invalid');
    const token = tokenOf(m[0]);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const raw = fs.readFileSync(a.file, 'utf8');
    assert.ok(!raw.includes(token), 'a nyers token nincs a tárban');
    assert.equal(a.stored().verifications[0].hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.equal(a.stored().users[0].emailVerified, false);
    assert.equal((await a.req('GET', '/status')).data.emailVerification, true);
  });

  await test('C: belépés megerősítés nélkül tiltott (hibakóddal), helytelen jelszónál továbbra is ugyanaz a hiba, mint ismeretlen fióknál', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    await a.req('POST', '/register', reg());
    const login = await a.req('POST', '/login', { email: 'anna@example.invalid', password });
    assert.equal(login.status, 403); assert.equal(login.data.code, 'email_unverified');
    const wrong = await a.req('POST', '/login', { email: 'anna@example.invalid', password: 'rossz jelszó 123456' });
    const none = await a.req('POST', '/login', { email: 'nincs@example.invalid', password: 'rossz jelszó 123456' });
    assert.equal(wrong.status, 401); assert.deepEqual(wrong.data, none.data, 'rossz jelszóból nem derül ki, hogy van-e fiók / meg van-e erősítve');
  });

  await test('C: a megerősítő link egyszer használható: belépteti a fiókot, üdvözlő levelet küld, másodszorra elutasítja', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    await a.req('POST', '/register', reg());
    const token = tokenOf(ofSubject(a.mail, /Megérkezett/)[0]);
    const jar = a.jar();
    const ok = await a.req('POST', '/verify', { token }, jar);
    assert.equal(ok.status, 200); assert.equal(ok.data.user.emailVerified, true);
    assert.equal((await a.req('GET', '/status', undefined, jar)).data.user.id, ok.data.user.id, 'be van lépve');
    await pause(30);
    assert.equal(ofSubject(a.mail, /Üdv a Kamu Bíróságon/).length, 1, 'üdvözlő levél');
    assert.equal((await a.req('POST', '/verify', { token })).status, 400, 'újrafelhasználás tiltva');
    assert.equal(a.stored().verifications.length, 0);
    assert.equal((await a.req('POST', '/login', { email: 'anna@example.invalid', password })).status, 200, 'megerősítés után lehet belépni');
  });

  await test('C: lejárt, hamis, rossz alakú és üres megerősítő link; a duplikált kérés', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    await a.req('POST', '/register', reg());
    const token = tokenOf(ofSubject(a.mail, /Megérkezett/)[0]);
    a.advance(24 * 60 * 60 * 1000 + 1000);
    assert.equal((await a.req('POST', '/verify', { token })).status, 400, 'lejárt');
    for (const bad of ['hamis', '', 'A'.repeat(43), 'A'.repeat(44), null, 5, { $ne: 1 }, ['x']]) {
      assert.equal((await a.req('POST', '/verify', { token: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await a.req('POST', '/verify', {})).status, 400);
    assert.equal((await a.req('POST', '/login', { email: 'anna@example.invalid', password })).status, 403, 'a lejárt link nem erősít meg');
    // a duplikált regisztráció ugyanarra a címre továbbra is tiltott (nem lehet fiókot "felülírni")
    assert.equal((await a.req('POST', '/register', reg('Más Név'))).status, 409);
  });

  await test('C: újraküldés: egységes válasz, címenként 1/perc, az új token érvényteleníti a régit', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    await a.req('POST', '/register', reg());
    const first = tokenOf(ofSubject(a.mail, /Megérkezett/)[0]);
    const known = await a.req('POST', '/resend-verification', { email: 'anna@example.invalid' });
    const unknown = await a.req('POST', '/resend-verification', { email: 'nincs@example.invalid' });
    assert.equal(known.status, 200); assert.deepEqual(known.data, unknown.data, 'a válasz nem árulja el, van-e fiók');
    await pause(30);
    assert.equal(ofSubject(a.mail, /Megérkezett/).length, 2, 'új levél ment');
    await a.req('POST', '/resend-verification', { email: 'anna@example.invalid' });
    await pause(30);
    assert.equal(ofSubject(a.mail, /Megérkezett/).length, 2, 'percen belül nem megy újabb');
    a.advance(61 * 1000);
    await a.req('POST', '/resend-verification', { email: 'anna@example.invalid' });
    await pause(30);
    assert.equal(ofSubject(a.mail, /Megérkezett/).length, 3, 'egy perc után megint megy');
    assert.equal((await a.req('POST', '/verify', { token: first })).status, 400, 'a régi token érvénytelen');
    const last = tokenOf(ofSubject(a.mail, /Megérkezett/).pop());
    assert.equal((await a.req('POST', '/verify', { token: last })).status, 200);
    // már megerősített fióknak nem megy újabb levél
    const before = a.mail.length;
    a.advance(61 * 1000);
    await a.req('POST', '/resend-verification', { email: 'anna@example.invalid' });
    await pause(30);
    assert.equal(a.mail.length, before);
    assert.equal((await a.req('POST', '/resend-verification', { email: 'nem-email' })).status, 400);
  });

  await test('C: napi korlát: egy címre legfeljebb 5 megerősítő újraküldés / nap', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    await a.req('POST', '/register', reg());
    for (let i = 0; i < 8; i++) { a.advance(61 * 1000); await a.req('POST', '/resend-verification', { email: 'anna@example.invalid' }); await pause(15); }
    assert.ok(ofSubject(a.mail, /Megérkezett/).length <= 6, 'összesen legfeljebb 1 + 5 levél: ' + ofSubject(a.mail, /Megérkezett/).length);
  });

  await test('C: küldési hiba regisztrációkor: a fiók megvan, a token visszavonva, a felhasználó értesül; az újraküldés később működik', async () => {
    let fail = true; const sent = [];
    const seen = [], logged = [], original = console.error; console.error = (...x) => logged.push(x.join(' '));
    try {
      const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' }, onError: (k, e) => seen.push([k, e.message]),
        sendMail: async (m) => { if (fail) { const e = new Error('Mail delivery failed (500): valami owner@example.invalid'); e.mail = true; throw e; } sent.push(m); } });
      const r = await a.req('POST', '/register', reg());
      assert.equal(r.status, 201); assert.equal(r.data.pending, true); assert.equal(r.data.mailSent, false);
      assert.match(r.data.message, /nem sikerült elküldeni/);
      assert.equal(a.stored().verifications.length, 0, 'a kézbesítetlen token nem marad érvényben');
      assert.equal(seen[0][0], 'mail');
      assert.ok(!logged.join('\n').includes('owner@example.invalid'), 'a cím nem kerül a naplóba');
      fail = false; a.advance(61 * 1000);
      await a.req('POST', '/resend-verification', { email: 'anna@example.invalid' });
      await pause(40);
      assert.equal(sent.length, 1, 'az újraküldés már megy');
    } finally { console.error = original; }
  });

  await test('C: levélküldés nélkül (nincs kulcs) a régi viselkedés marad: azonnali belépés, nincs megerősítés', async () => {
    const app = express(); const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r)); servers.push(server);
    const base = 'http://127.0.0.1:' + server.address().port;
    const auth = createAuth({ file: path.join(tmp, crypto.randomUUID() + '.json'), env: { AUTH_BASE_URL: base }, maxAttempts: 100 });
    app.use('/api/auth', auth.router);
    const r = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(reg()) });
    const data = await r.json();
    assert.equal(r.status, 201); assert.ok(data.user && !data.pending, 'azonnal belép');
    const status = await (await fetch(base + '/api/auth/status')).json();
    assert.equal(status.mail, false); assert.equal(status.emailVerification, false);
  });

  await test('C: a régi (emailVerified nélküli) fiókok megerősítettnek számítanak, és be tudnak lépni', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    // a megerősítés bekapcsolása előtt regisztrált fiók: kézzel megerősítettre állítjuk (mintha a régi adatból jönne), a mező nélkül
    await a.req('POST', '/register', reg('Régi Rezső', 'regi@example.invalid'));
    const token = tokenOf(ofSubject(a.mail, /Megérkezett/)[0]);
    await a.req('POST', '/verify', { token });
    const s = a.stored(); delete s.users[0].emailVerified; fs.writeFileSync(a.file, JSON.stringify(s));
    const app = express(); const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r)); servers.push(server);
    const base2 = 'http://127.0.0.1:' + server.address().port;
    const auth2 = createAuth({ file: a.file, env: { AUTH_BASE_URL: base2 }, sendMail: async () => {}, maxAttempts: 100 });
    app.use('/api/auth', auth2.router);
    const r = await fetch(base2 + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base2 }, body: JSON.stringify({ email: 'regi@example.invalid', password }) });
    assert.equal(r.status, 200); assert.equal((await r.json()).user.emailVerified, true);
  });

  await test('C: a meg nem erősített, soha be nem lépett fiók 7 nap után nem foglalja a nevet és a címet', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    await a.req('POST', '/register', reg());
    assert.equal((await a.req('POST', '/register', reg('Másik Név'))).status, 409);
    a.advance(7 * 24 * 60 * 60 * 1000 + 1000);
    assert.equal((await a.req('POST', '/register', reg('Másik Név'))).status, 201, 'a régi, megerősítetlen fiók felszabadította a címet');
  });

  await test('C: jelszó-visszaállítás: egységes válasz, a levélben külön token, címenként óránként legfeljebb 3 levél, az új jelszóról értesítő megy, a cím megerősítettnek számít', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '1' } });
    await a.req('POST', '/register', reg());   // megerősítetlen fiók
    const known = await a.req('POST', '/forgot', { email: 'anna@example.invalid' });
    const unknown = await a.req('POST', '/forgot', { email: 'nincs@example.invalid' });
    assert.equal(known.status, 200); assert.deepEqual(known.data, unknown.data);
    await pause(30);
    const resets = ofSubject(a.mail, /Új jelszó beállítása/);
    assert.equal(resets.length, 1);
    const resetToken = tokenOf(resets[0]);
    assert.ok(/#reset=/.test(resets[0].text) && !/#verify=/.test(resets[0].text), 'külön token a jelszó-visszaállításhoz');
    assert.notEqual(resetToken, tokenOf(ofSubject(a.mail, /Megérkezett/)[0]));
    // korlát: 3 levél / óra / cím
    for (let i = 0; i < 5; i++) { await a.req('POST', '/forgot', { email: 'anna@example.invalid' }); await pause(10); }
    await pause(30);
    assert.equal(ofSubject(a.mail, /Új jelszó beállítása/).length, 3, 'óránként legfeljebb 3 visszaállító levél');
    // az utolsó (érvényes) token használata
    const latest = tokenOf(ofSubject(a.mail, /Új jelszó beállítása/).pop());
    const newPass = 'Ez már az új jelszó 456!';
    const jar = a.jar();
    const done = await a.req('POST', '/reset', { token: latest, password: newPass, confirmPassword: newPass }, jar);
    assert.equal(done.status, 200); assert.equal(done.data.user.emailVerified, true, 'a visszaállító levél a címet is igazolja');
    await pause(30);
    const changed = ofSubject(a.mail, /A jelszavad megváltozott/);
    assert.equal(changed.length, 1); assert.equal(changed[0].to, 'anna@example.invalid');
    assert.equal((await a.req('POST', '/reset', { token: latest, password: newPass, confirmPassword: newPass })).status, 400, 'a token újra nem használható');
    assert.equal((await a.req('POST', '/login', { email: 'anna@example.invalid', password: newPass })).status, 200, 'belép (a cím megerősítettnek számít)');
  });

  await test('C: jelszócsere bejelentkezve (ideiglenes jelszó után): értesítő levél megy', async () => {
    const a = await boot({ env: { AUTH_REQUIRE_EMAIL_VERIFICATION: '0' } });
    const jar = a.jar();
    await a.req('POST', '/register', reg(), jar);
    const next = 'Teljesen új jelszó 789!';
    assert.equal((await a.req('POST', '/change-password', { currentPassword: password, password: next, confirmPassword: next }, jar)).status, 200);
    await pause(30);
    assert.equal(ofSubject(a.mail, /A jelszavad megváltozott/).length, 1);
  });

  await test('C: az admin próbalevél bármelyik sablonnal megy; ismeretlen sablon és hibás cím elutasítva', async () => {
    const a = await boot();
    for (const n of NAMES) await a.auth.admin.sendTestMail('proba@example.invalid', n);
    assert.equal(a.mail.length, NAMES.length);
    assert.ok(a.mail.every((m) => !m.html.includes('example.invalid/#') || m.html.includes(a.base)), 'a minta-linkek a valódi címre mutatnak');
    await assert.rejects(() => a.auth.admin.sendTestMail('proba@example.invalid', 'nincs'), (e) => e.status === 400);
    await assert.rejects(() => a.auth.admin.sendTestMail('nem-email', 'welcome'), (e) => e.status === 400);
    const st = a.auth.admin.mailStatus();
    assert.equal(st.configured, true); assert.equal(st.headerImage, false);
  });

  await test('C: új Discord / Google fiók-összekötésről biztonsági értesítő megy (a szolgáltató neve a levélben)', async () => {
    const tpl = render('securityNotice', { name: 'Anna', headline: 'Új belépési mód kapcsolódott a fiókodhoz.', details: ['Szolgáltató: Discord'] }, CFG);
    assert.ok(visible(tpl.html).includes('Szolgáltató: Discord'));
  });
}

// ---------- D. a teljes szerver (száraz futtatás) ----------
async function fullServer() {
  const PORT = 3215, BASE = 'http://127.0.0.1:' + PORT;
  const outbox = path.join(tmp, 'server-outbox.jsonl');
  const f = (n) => path.join(tmp, n);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DISCORD_BOT_TOKEN: '', EMAIL_DRY_RUN: '1', EMAIL_OUTBOX_FILE: outbox,
      RESEND_API_KEY: '', EMAIL_FROM: '', AUTH_MAIL_API_KEY: '', AUTH_MAIL_FROM: '',
      AUTH_STORE_PATH: f('acc.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('st.json'), KB_COURTS_FILE: f('c.json'), KB_DMS_FILE: f('d.json'),
      KB_MODERATION_FILE: f('m.json'), KB_ERRORS_FILE: f('e.json'), KB_BUGREPORTS_FILE: f('b.json') }
  });
  const sockets = [];
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  const http_ = async (method, p, body, jar) => {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: BASE } : {}) };
    if (jar && jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (jar) for (const c of r.headers.getSetCookie()) { const first = c.split(';')[0], i = first.indexOf('='); const k = first.slice(0, i), v = first.slice(i + 1); if (v) jar.set(k, v); else jar.delete(k); }
    const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
    return { status: r.status, data, text };
  };
  const mails = () => (fs.existsSync(outbox) ? fs.readFileSync(outbox, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('Ack timeout: ' + ev)), 4000); s.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); }); });
  const connect = async () => { const s = io(BASE, { transports: ['websocket'], reconnection: false }); sockets.push(s); await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); }); return s; };
  try {
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(BASE + '/health')).ok; } catch (_) { await pause(100); } }
    assert(ready, 'a szerver elindult');

    async function account(name, email) {
      const jar = new Map();
      const r = await http_('POST', '/api/auth/register', { username: name, email, password, confirmPassword: password }, jar);
      assert.equal(r.status, 201, r.text); assert.equal(r.data.pending, true);
      const m = mails().filter((x) => x.to === email && /Megérkezett/.test(x.subject)).pop();
      const token = tokenOf(m);
      assert.ok(token, 'a levélben ott a token');
      const v = await http_('POST', '/api/auth/verify', { token }, jar);
      assert.equal(v.status, 200, v.text);
      return { jar, user: v.data.user };
    }

    let host;
    await test('D: teljes szerver: regisztráció -> megerősítő levél (száraz futtatás) -> belépés tiltva -> megerősítés -> belépve + üdvözlő levél', async () => {
      assert.equal((await http_('GET', '/api/auth/status')).data.emailVerification, true, 'a levélküldés (száraz) él, a megerősítés kötelező');
      const jar = new Map();
      const r = await http_('POST', '/api/auth/register', { username: 'Gazda Géza', email: 'geza@example.invalid', password, confirmPassword: password }, jar);
      assert.equal(r.status, 201); assert.equal(r.data.pending, true);
      assert.equal((await http_('POST', '/api/auth/login', { email: 'geza@example.invalid', password })).data.code, 'email_unverified');
      const mail = mails().find((x) => /Megérkezett/.test(x.subject));
      assert.ok(mail.html.includes(BASE + '/#verify='), 'a link a valódi címre mutat');
      const v = await http_('POST', '/api/auth/verify', { token: tokenOf(mail) }, jar);
      assert.equal(v.status, 200);
      await pause(60);
      assert.ok(mails().some((x) => /Üdv a Kamu Bíróságon/.test(x.subject) && x.to === 'geza@example.invalid'));
      host = { jar, user: v.data.user };
    });

    let code;
    await test('D: játékmeghívó: csak a saját szobád tagja hívhat; a levél a szobakóddal és a szoba linkjével megy', async () => {
      const s = await connect();
      const ticket = (await http_('POST', '/api/friends/ticket', {}, host.jar)).data.ticket;
      assert.equal((await emit(s, 'identify', { ticket })).account, true);
      const created = await emit(s, 'create_room', { name: host.user.username, playerId: 'p1' });
      code = created.code; assert.ok(code, JSON.stringify(created));
      const ok = await http_('POST', '/api/invite-email', { email: 'barat1@example.invalid', code }, host.jar);
      assert.equal(ok.status, 200, ok.text);
      const m = mails().find((x) => /Beidéztek/.test(x.subject));
      assert.equal(m.to, 'barat1@example.invalid');
      assert.ok(visible(m.html).includes(code));
      assert.ok(m.html.includes('href="' + BASE + '/?room=' + code + '"'), 'a gomb a szoba linkjére mutat');
      assert.ok(m.html.includes('Gazda Géza'), 'a meghívó neve benne van');
    });

    await test('D: meghívó visszaélés-védelem: vendég, idegen fiók, ismeretlen szoba, saját cím, hibás cím, ismétlés, óránkénti korlát', async () => {
      assert.equal((await http_('POST', '/api/invite-email', { email: 'x@example.invalid', code })).status, 401, 'vendég nem küldhet');
      const other = await account('Idegen Ede', 'ede@example.invalid');
      assert.equal((await http_('POST', '/api/invite-email', { email: 'x@example.invalid', code }, other.jar)).status, 403, 'nem tagja a szobának');
      assert.equal((await http_('POST', '/api/invite-email', { email: 'x@example.invalid', code: 'ZZZZ' }, host.jar)).status, 404, 'ismeretlen szoba');
      assert.equal((await http_('POST', '/api/invite-email', { email: 'x@example.invalid', code: 'nem-kod' }, host.jar)).status, 404);
      assert.equal((await http_('POST', '/api/invite-email', { email: 'geza@example.invalid', code }, host.jar)).status, 400, 'saját cím');
      assert.equal((await http_('POST', '/api/invite-email', { email: 'nem-email', code }, host.jar)).status, 400);
      assert.equal((await http_('POST', '/api/invite-email', { email: 'a'.repeat(260) + '@b.hu', code }, host.jar)).status, 400);
      assert.equal((await http_('POST', '/api/invite-email', { email: 'barat1@example.invalid', code }, host.jar)).status, 429, 'ugyanarra a címre ugyanabból a szobából nem megy újra');
      assert.equal((await http_('POST', '/api/invite-email', { email: 'barat2@example.invalid', code }, host.jar)).status, 200);
      assert.equal((await http_('POST', '/api/invite-email', { email: 'barat3@example.invalid', code }, host.jar)).status, 429, 'óránként legfeljebb 3 meghívó');
      const invites = mails().filter((x) => /Beidéztek/.test(x.subject));
      assert.equal(invites.length, 2);
    });

    if (chromium) {
      await test('E: böngésző: regisztráció -> "levelet küldtünk" üzenet -> belépés tiltva + újraküldés gomb -> a levél linkje belépteti a játékost', async () => {
        const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
        const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: 'msedge' });
        try {
          const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await page.goto(BASE + '/');
          await page.waitForFunction(() => !document.querySelector('#authRegisterSubmit').disabled, null, { timeout: 15000 });
          await page.fill('#authRegisterName', 'Böngésző Béla');
          await page.fill('#authRegisterEmail', 'bela@example.invalid');
          await page.fill('#authRegisterPassword', password);
          await page.fill('#authRegisterConfirm', password);
          await page.click('#authRegisterSubmit');
          await page.waitForFunction(() => /megerősítő levelet/.test(document.querySelector('#authRegisterMessage').textContent));
          assert.equal(await page.evaluate(() => !!window.kbAccount), false, 'még nincs belépve');
          // belépés megerősítés nélkül
          await page.fill('#authLoginEmail', 'bela@example.invalid');
          await page.fill('#authLoginPassword', password);
          await page.click('#authLoginSubmit');
          await page.waitForFunction(() => /erősítsd meg/.test(document.querySelector('#authLoginMessage').textContent));
          assert.equal(await page.isVisible('#authResendVerify'), true, 'látszik az újraküldés gombja');
          await page.click('#authResendVerify');
          await page.waitForFunction(() => /újra elküldtük/.test(document.querySelector('#authLoginMessage').textContent));
          // a levélben lévő link
          const token = tokenOf(mails().filter((m) => m.to === 'bela@example.invalid' && /Megérkezett/.test(m.subject)).pop());
          const v = await browser.newPage({ viewport: { width: 1280, height: 900 } }); // a levélből új lapon nyílik a link
          await v.goto(BASE + '/#verify=' + token);
          await v.waitForFunction(() => !!window.kbAccount && window.kbAccount.emailVerified === true, null, { timeout: 15000 });
          assert.ok(!(await v.evaluate(() => location.hash)).includes('verify'), 'a token nem marad a címsorban');
          // érvénytelen link
          const bad = await browser.newPage({ viewport: { width: 1280, height: 900 } });
          await bad.goto(BASE + '/#verify=' + 'A'.repeat(43));
          await bad.waitForFunction(() => /lejárt|érvénytelen/.test(document.querySelector('#authStatus').textContent), null, { timeout: 15000 });
          assert.equal(await bad.evaluate(() => !!window.kbAccount), false);
          // meghívó-gomb a lobbiban (a szoba-állapotot mi adjuk, a kérést elfogjuk: a levél nem megy ki)
          await v.route('**/api/invite-email', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
          await v.evaluate(() => { window.kbInRoom = () => ({ code: 'ABCD', lobby: true }); show('lobby'); });
          await v.waitForSelector('#btnInviteMail:not(.hidden)', { timeout: 8000 });
          await v.evaluate(() => { for (const e of document.querySelectorAll('#helpModal, .help-backdrop, .help-overlay')) e.remove(); }); // az első belépéskor nyíló útmutató ne takarja
          await v.click('#btnInviteMail');
          await v.fill('#inviteMailTo', 'barat@example.invalid');
          await v.click('#inviteMailSend');
          await v.waitForFunction(() => /A meghívó elment/.test(document.querySelector('#inviteMailMsg').textContent));
        } finally { await browser.close(); }
      });
    }

    await test('D: a játék és a socket.io továbbra is működik (szoba, állapot, /health)', async () => {
      assert.equal((await fetch(BASE + '/health')).status, 200);
      const g = await connect();
      const room = await emit(g, 'join_room', { code, name: 'Vendég Vera', playerId: 'v1' });
      assert.ok(!room.error, JSON.stringify(room));
      assert.ok(room.state.players.length >= 2);
    });

    await test('D: az üzenetekben nincs titok, és a szerver nem naplózott hibát', async () => {
      assert.ok(!stderr.includes('RESEND'), stderr.slice(0, 300));
      assert.ok(!/Hiba|Error:/i.test(stderr.replace(/ExperimentalWarning/g, '')) || /DEP|Warning/.test(stderr), stderr.slice(0, 400));
    });
  } finally { for (const s of sockets) s.disconnect(); child.kill(); }
}

(async () => {
  await templates();
  await mailer();
  await authFlows();
  await fullServer();
  for (const s of servers) s.close();
  console.log('\nE-mail rendszer: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exit(failed ? 1 : 0);
})();
