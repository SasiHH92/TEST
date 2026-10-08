'use strict';
// ============================================================
// KAMU BÍRÓSÁG – admin fiókkezelés + kötelező jelszócsere (valódi szerver, ideiglenes fájlokkal, valódi HTTP-kérésekkel)
//  - az admin látja az összes fiókot (jelszó-kivonat nélkül), és létrehozhat fiókot (egyenként / tömegesen / legendához kötve) ideiglenes jelszóval
//  - az ideiglenes jelszóval belépett fiók KORLÁTOZOTT (a fiók-funkciók nem érhetők el), amíg saját jelszót nem választ
//  - a jelszócsere ellenőrzi a mostani jelszót, érvényteleníti a többi munkamenetet, az ideiglenes jelszó utána nem használható
//  - lejárt ideiglenes jelszóval nem lehet belépni; az admin új ideiglenes jelszót adhat; a visszaállító link is megszünteti a korlátozást
// Futtatás: node test/accounts-admin.js
// ============================================================

const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const PORT = Number(process.env.ACCT_PORT || 3193), BASE = 'http://127.0.0.1:' + PORT;
const TOKEN = crypto.randomBytes(24).toString('base64url'); // csak ehhez a teszthez, véletlen
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-acct-'));
const STORE = path.join(tmp, 'accounts.json');
const root = path.resolve(__dirname, '..');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0, child = null, stderr = '';
async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}

async function http(method, route, body, jar, headers = {}) {
  const h = { ...headers };
  if (body !== undefined) { h['Content-Type'] = 'application/json'; h.Origin = BASE; }
  if (jar && jar.size) h.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const response = await fetch(BASE + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) for (const cookie of response.headers.getSetCookie()) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    if (first.slice(i + 1)) jar.set(first.slice(0, i), first.slice(i + 1)); else jar.delete(first.slice(0, i));
  }
  const text = await response.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: response.status, data, text };
}
const admin = (method, route, body, token = TOKEN) => http(method, '/api/admin' + route, body, null, token ? { Authorization: 'Bearer ' + token } : {});
const login = (email, password, jar) => http('POST', '/api/auth/login', { email, password }, jar);
const status = (jar) => http('GET', '/api/auth/status', undefined, jar);
const TEMP_RE = /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/;
const NEW_PASSWORD = 'Ez a saját új jelszavam 42!';

async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, DATABASE_URL: '', ADMIN_TOKEN: TOKEN,
      AUTH_STORE_PATH: STORE, KB_AVATARS_FILE: path.join(tmp, 'avatars.json'), KB_STATS_FILE: path.join(tmp, 'stats.json'),
      KB_DMS_FILE: path.join(tmp, 'dms.json'), KB_ERRORS_FILE: path.join(tmp, 'errors.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', (d) => { stderr += d; });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return; } catch (_) { await pause(100); } }
  throw new Error('a szerver nem indult el');
}
const stopServer = () => new Promise((resolve) => { if (!child) return resolve(); child.once('exit', resolve); child.kill(); });

async function main() {
  await startServer();
  try {
    await test('Az admin-fiókok útvonalai tokent kérnek', async () => {
      for (const [m, r, b] of [['GET', '/accounts'], ['POST', '/accounts', { email: 'a@example.invalid', username: 'Valaki' }], ['POST', '/accounts/bulk', { accounts: [] }], ['POST', '/accounts/temp-password', { id: 'x' }]]) {
        assert.equal((await admin(m, r, b, '')).status, 401, m + ' ' + r);
        assert.equal((await admin(m, r, b, 'nem-ez-a-token-de-hosszu-elég-lesz')).status, 401, m + ' ' + r + ' rossz tokennel');
      }
    });

    const anna = { username: 'Teszt Anna', email: 'anna@example.invalid' };
    let annaPw = '';
    await test('Új fiók: ideiglenes jelszót kap (egyszer látszik), a listában kötelező jelszócserével, kivonat nélkül', async () => {
      const r = await admin('POST', '/accounts', anna);
      assert.equal(r.status, 201, r.text);
      annaPw = r.data.temporaryPassword;
      assert.match(annaPw, TEMP_RE, 'olvasható, 3x4 karakteres jelszó');
      assert.ok(annaPw.length >= 12, 'megfelel a jelszó-szabálynak');
      assert.equal(r.data.username, anna.username); assert.equal(r.data.expiresInDays, 14); assert.equal(r.data.legend, '');
      const list = await admin('GET', '/accounts');
      assert.equal(list.status, 200);
      const row = list.data.accounts.find((a) => a.email === anna.email);
      assert.ok(row, 'szerepel a listában');
      assert.equal(row.mustChangePassword, true); assert.equal(row.password, true); assert.equal(row.legend, '');
      assert.ok(row.tempPasswordExpiresAt > Date.now() + 13 * 86400000, 'kb. 14 napig érvényes');
      assert.ok(!list.text.includes(annaPw), 'a jelszó nincs a listában');
      assert.ok(!/"hash"|"salt"|scrypt/.test(list.text), 'a kivonat nincs a listában');
      assert.ok(list.data.legends.includes('Kyrashi'), 'a legendák neve a választóhoz');
    });

    await test('Két fiók ideiglenes jelszava különbözik, és az e-mail kisbetűsítve tárolódik', async () => {
      const r = await admin('POST', '/accounts', { username: 'Teszt Bela', email: 'BELA@Example.invalid' });
      assert.equal(r.status, 201, r.text);
      assert.notEqual(r.data.temporaryPassword, annaPw);
      assert.equal(r.data.email, 'bela@example.invalid');
    });

    await test('Hibás adatok: érvénytelen e-mail / név, hiányzó mező, foglalt e-mail és név, ismeretlen legenda', async () => {
      const bad = async (body, code, re) => { const r = await admin('POST', '/accounts', body); assert.equal(r.status, code, JSON.stringify(body) + ' -> ' + r.text); if (re) assert.match(r.data.error, re); };
      await bad({ username: 'Valaki', email: 'nem-email' }, 400, /e-mail/);
      await bad({ username: 'Valaki' }, 400, /e-mail/);
      await bad({ username: 'x', email: 'x@example.invalid' }, 400, /3–20/);
      await bad({ email: 'x@example.invalid' }, 400);
      await bad({ username: 'Valaki', email: anna.email }, 409, /e-mail/);
      await bad({ username: 'TESZT anna', email: 'masik@example.invalid' }, 409, /foglalt/);
      await bad({ username: 'Valaki', email: 'v@example.invalid', legend: 'Nincs Ilyen Legenda' }, 400, /Ismeretlen legend/);
      assert.equal((await admin('POST', '/accounts', [1, 2])).status, 400, 'tömb helyett objektum kell');
    });

    await test('Legendához kötött fiók: a név és a kártya a legendáé, egy legenda egyszer adható', async () => {
      const r = await admin('POST', '/accounts', { email: 'kyrashi@example.invalid', legend: 'Kyrashi' });
      assert.equal(r.status, 201, r.text);
      assert.equal(r.data.username, 'Kyrashi'); assert.equal(r.data.legend, 'Kyrashi');
      const jar = new Map();
      const l = await login('kyrashi@example.invalid', r.data.temporaryPassword, jar);
      assert.equal(l.status, 200, l.text);
      assert.equal(l.data.user.legend, 'Kyrashi'); assert.equal(l.data.user.profile.titulus, 'A szörny'); assert.equal(l.data.user.mustChangePassword, true);
      const again = await admin('POST', '/accounts', { email: 'masik@example.invalid', legend: 'Kyrashi' });
      assert.equal(again.status, 409); assert.match(again.data.error, /már igényelték/);
      // a legenda pontos neve beírva a név mezőbe is a legendához köti
      const typed = await admin('POST', '/accounts', { username: 'Izsván', email: 'izsvan@example.invalid' });
      assert.equal(typed.status, 201, typed.text); assert.equal(typed.data.legend, 'Izsván');
    });

    const jarA = new Map(), jarB = new Map();
    await test('Belépés ideiglenes jelszóval: a státusz jelzi a kötelező cserét, a fiók-funkciók zárva', async () => {
      assert.equal((await login(anna.email, 'rossz jelszo 123456', new Map())).status, 401);
      const l = await login(anna.email, annaPw, jarA);
      assert.equal(l.status, 200, l.text);
      assert.equal(l.data.user.mustChangePassword, true);
      const s = await status(jarA);
      assert.equal(s.data.user.mustChangePassword, true, 'a kliens ebből tudja, hogy jelszót kell cserélnie');
      assert.equal((await login(anna.email, annaPw, jarB)).status, 200, 'második eszköz');
      for (const [m, r, b] of [['GET', '/api/friends/state'], ['POST', '/api/friends/ticket', {}], ['POST', '/api/auth/profile', { username: anna.username, titulus: 'x', priusz: 'y', jelveny: '', avatar: '' }],
        ['POST', '/api/auth/delete', { password: annaPw }]]) {
        const res = await http(m, r, b, jarA);
        assert.equal(res.status, 401, m + ' ' + r + ' -> ' + res.status + ' ' + res.text.slice(0, 120));
      }
    });

    await test('Jelszócsere: kell a mostani jelszó, az új 12–128 karakter, egyezik, és más mint a mostani', async () => {
      const change = (body, jar = jarA) => http('POST', '/api/auth/change-password', body, jar);
      assert.equal((await change({ currentPassword: annaPw, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, new Map())).status, 401, 'bejelentkezés nélkül');
      assert.equal((await change({ password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).status, 400, 'mostani jelszó nélkül');
      assert.equal((await change({ currentPassword: 'rossz jelszo 123456', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })).status, 401, 'rossz mostani jelszó');
      assert.equal((await change({ currentPassword: annaPw, password: 'rovid', confirmPassword: 'rovid' })).status, 400, 'rövid új jelszó');
      assert.equal((await change({ currentPassword: annaPw, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD + 'x' })).status, 400, 'nem egyezik');
      assert.equal((await change({ currentPassword: annaPw, password: annaPw, confirmPassword: annaPw })).status, 400, 'ugyanaz a jelszó');
      assert.equal((await change({ currentPassword: annaPw, password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) })).status, 400, 'túl hosszú új jelszó');
      assert.equal((await status(jarA)).data.user.mustChangePassword, true, 'a hibás próbák után is korlátozott');
    });
    let annaTemp = '';
    await test('Az admin új ideiglenes jelszót adhat: a régi megszűnik, a munkamenetek kilépnek, újra kötelező a csere', async () => {
      const id = (await admin('GET', '/accounts')).data.accounts.find((a) => a.email === anna.email).id;
      const r = await admin('POST', '/accounts/temp-password', { id });
      assert.equal(r.status, 200, r.text);
      annaTemp = r.data.temporaryPassword;
      assert.match(annaTemp, TEMP_RE); assert.equal(r.data.expiresInDays, 14);
      assert.equal((await status(jarA)).data.user, null, 'a régi munkamenet kilépett');
      assert.equal((await status(jarB)).data.user, null);
      assert.equal((await login(anna.email, annaPw, new Map())).status, 401, 'a régi ideiglenes jelszó nem jó');
      const row = (await admin('GET', '/accounts')).data.accounts.find((a) => a.id === id);
      assert.equal(row.mustChangePassword, true);
      assert.equal((await admin('POST', '/accounts/temp-password', { id: 'nincs-ilyen' })).status, 404);
      assert.equal((await admin('POST', '/accounts/temp-password', {})).status, 400);
      assert.equal((await admin('POST', '/accounts/temp-password', { id: 'x'.repeat(80) })).status, 400);
    });

    const annaJar = new Map(), annaOther = new Map();
    await test('Sikeres jelszócsere: megszűnik a korlátozás, a többi munkamenet kilép, az ideiglenes jelszó nem használható', async () => {
      assert.equal((await login(anna.email, annaTemp, annaJar)).status, 200);
      assert.equal((await login(anna.email, annaTemp, annaOther)).status, 200);
      const r = await http('POST', '/api/auth/change-password', { currentPassword: annaTemp, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, annaJar);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.data.user.mustChangePassword, false);
      assert.equal(r.data.user.username, anna.username);
      assert.equal((await status(annaJar)).data.user.mustChangePassword, false);
      assert.equal((await status(annaOther)).data.user, null, 'a másik eszköz kilépett');
      assert.equal((await http('GET', '/api/friends/state', undefined, annaJar)).status, 200, 'a fiók-funkciók megnyíltak');
      assert.equal((await http('POST', '/api/friends/ticket', {}, annaJar)).status, 200);
      assert.equal((await login(anna.email, annaTemp, new Map())).status, 401, 'az ideiglenes jelszó megszűnt');
      assert.equal((await login(anna.email, NEW_PASSWORD, new Map())).status, 200, 'az új jelszó működik');
      const row = (await admin('GET', '/accounts')).data.accounts.find((a) => a.email === anna.email);
      assert.equal(row.mustChangePassword, false); assert.equal(row.tempPasswordExpiresAt, 0);
      assert.ok(row.lastLoginAt > 0, 'az utolsó belépés rögzül');
    });

    await test('Önkéntes jelszócsere is a mostani jelszóval megy, és ugyanazt az új jelszót nem fogadja el', async () => {
      const same = await http('POST', '/api/auth/change-password', { currentPassword: NEW_PASSWORD, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, annaJar);
      assert.equal(same.status, 400); assert.match(same.data.error, /más/);
    });

    await test('Tömeges létrehozás: soronként eredmény, a hibás sor nem állítja meg a többit', async () => {
      const accounts = [];
      for (let i = 1; i <= 8; i++) accounts.push({ username: 'Tomeges ' + i, email: 'tomeges' + i + '@example.invalid' });
      accounts.push({ username: 'Tomeges 1', email: 'mas@example.invalid' });         // foglalt név
      accounts.push({ username: 'Valaki Uj', email: 'anna@example.invalid' });        // foglalt e-mail
      accounts.push({ username: 'Rossz Cim', email: 'nem-email' });                   // hibás e-mail
      accounts.push({ email: 'sasi@example.invalid', legend: 'Sanyi/Sasi' });         // legenda
      const r = await admin('POST', '/accounts/bulk', { accounts });
      assert.equal(r.status, 200, r.text);
      assert.equal(r.data.results.length, accounts.length);
      assert.ok(r.data.results.slice(0, 8).every((x) => x.ok && TEMP_RE.test(x.temporaryPassword)), 'az első 8 elkészült');
      assert.equal(new Set(r.data.results.slice(0, 8).map((x) => x.temporaryPassword)).size, 8, 'mind más jelszó');
      assert.equal(r.data.results[8].ok, false); assert.match(r.data.results[8].error, /foglalt/);
      assert.equal(r.data.results[9].ok, false); assert.match(r.data.results[9].error, /e-mail/);
      assert.equal(r.data.results[10].ok, false);
      assert.equal(r.data.results[11].ok, true); assert.equal(r.data.results[11].username, 'Sanyi/Sasi'); assert.equal(r.data.results[11].legend, 'Sanyi/Sasi');
      const list = (await admin('GET', '/accounts')).data.accounts;
      assert.equal(list.filter((a) => a.email.startsWith('tomeges')).length, 8);
      assert.ok(!list.some((a) => a.email === 'mas@example.invalid'), 'a hibás sor nem hozott létre fiókot');
      // az egyik tömeges fiókkal be lehet lépni az ideiglenes jelszóval
      const l = await login('tomeges3@example.invalid', r.data.results[2].temporaryPassword, new Map());
      assert.equal(l.status, 200); assert.equal(l.data.user.mustChangePassword, true);
    });

    await test('Tömeges létrehozás: üres / nem tömb / túl sok sor → 400, és semmi nem jön létre', async () => {
      const before = (await admin('GET', '/accounts')).data.accounts.length;
      assert.equal((await admin('POST', '/accounts/bulk', { accounts: [] })).status, 400);
      assert.equal((await admin('POST', '/accounts/bulk', { accounts: 'sok' })).status, 400);
      assert.equal((await admin('POST', '/accounts/bulk', {})).status, 400);
      const many = Array.from({ length: 41 }, (_, i) => ({ username: 'Sok ' + i, email: 'sok' + i + '@example.invalid' }));
      const r = await admin('POST', '/accounts/bulk', { accounts: many });
      assert.equal(r.status, 400); assert.match(r.data.error, /legfeljebb 40/);
      assert.equal((await admin('GET', '/accounts')).data.accounts.length, before);
    });

    await test('A jelszó-visszaállító link is megszünteti a kötelező cserét', async () => {
      const r = await admin('POST', '/accounts', { username: 'Teszt Cili', email: 'cili@example.invalid' });
      const link = (await admin('POST', '/reset-link', { email: 'cili@example.invalid' })).data.link;
      const token = link.split('#reset=')[1];
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
      const jar = new Map();
      const done = await http('POST', '/api/auth/reset', { token, password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }, jar);
      assert.equal(done.status, 200, done.text);
      assert.equal(done.data.user.mustChangePassword, false);
      assert.equal((await login('cili@example.invalid', r.data.temporaryPassword, new Map())).status, 401, 'az ideiglenes jelszó megszűnt');
      assert.equal((await http('GET', '/api/friends/state', undefined, jar)).status, 200);
    });

    // ---------- törlés ----------
    await test('Törlés: token kell, az azonosító és a pontos felhasználónév kötelező, a fiók megmarad hibás kérésnél', async () => {
      assert.equal((await admin('POST', '/accounts/delete', { id: 'x', confirmName: 'x' }, '')).status, 401);
      const victim = (await admin('GET', '/accounts')).data.accounts.find((a) => a.email === 'tomeges5@example.invalid');
      assert.ok(victim, 'van mit törölni');
      assert.equal((await admin('POST', '/accounts/delete', {})).status, 400, 'azonosító nélkül');
      assert.equal((await admin('POST', '/accounts/delete', { id: 'x'.repeat(80), confirmName: 'x' })).status, 400, 'túl hosszú azonosító');
      assert.equal((await admin('POST', '/accounts/delete', { id: 'nincs-ilyen', confirmName: 'x' })).status, 404);
      assert.equal((await admin('POST', '/accounts/delete', { id: victim.id })).status, 400, 'név nélkül');
      const wrong = await admin('POST', '/accounts/delete', { id: victim.id, confirmName: 'Valaki Más' });
      assert.equal(wrong.status, 400); assert.match(wrong.data.error, /felhasználónevet/);
      assert.ok((await admin('GET', '/accounts')).data.accounts.some((a) => a.id === victim.id), 'a fiók megvan');
    });

    await test('Törlés: a fiók, a munkamenetei megszűnnek, belépni nem lehet, a név és az e-mail újra felhasználható', async () => {
      const victim = (await admin('GET', '/accounts')).data.accounts.find((a) => a.email === 'tomeges6@example.invalid');
      const jar = new Map();
      const temp = (await admin('POST', '/accounts/temp-password', { id: victim.id })).data.temporaryPassword;
      assert.equal((await login(victim.email, temp, jar)).status, 200);
      assert.ok((await status(jar)).data.user, 'be van jelentkezve');
      const r = await admin('POST', '/accounts/delete', { id: victim.id, confirmName: victim.username.toUpperCase() }); // a név kis/nagybetűre nem érzékeny
      assert.equal(r.status, 200, r.text); assert.equal(r.data.username, victim.username);
      assert.ok(!(await admin('GET', '/accounts')).data.accounts.some((a) => a.id === victim.id), 'eltűnt a listából');
      assert.equal((await status(jar)).data.user, null, 'a munkamenet megszűnt');
      assert.equal((await login(victim.email, temp, new Map())).status, 401, 'belépni nem lehet');
      assert.equal((await admin('POST', '/accounts/delete', { id: victim.id, confirmName: victim.username })).status, 404, 'másodszor már nincs');
      const again = await admin('POST', '/accounts', { username: victim.username, email: victim.email });
      assert.equal(again.status, 201, 'a név és az e-mail újra használható: ' + again.text);
    });

    await test('Törlés: a másik fiók barátlistájából is kikerül, a legendás kártya újra odaadható', async () => {
      const mk = async (username, email) => { const r = await admin('POST', '/accounts', { username, email }); const jar = new Map();
        assert.equal((await login(email, r.data.temporaryPassword, jar)).status, 200);
        const pw = 'Barati jelszo ' + username.length + '99!';
        assert.equal((await http('POST', '/api/auth/change-password', { currentPassword: r.data.temporaryPassword, password: pw, confirmPassword: pw }, jar)).status, 200);
        return jar; };
      const jx = await mk('Barat Xenia', 'xenia@example.invalid'), jy = await mk('Barat Yvett', 'yvett@example.invalid');
      assert.equal((await http('POST', '/api/friends/request', { username: 'Barat Yvett' }, jx)).status, 200);
      const yId = (await admin('GET', '/accounts')).data.accounts.find((a) => a.email === 'yvett@example.invalid').id;
      assert.equal((await http('POST', '/api/friends/accept', { userId: (await http('GET', '/api/friends/state', undefined, jy)).data.incoming[0].id }, jy)).status, 200);
      assert.ok(JSON.stringify((await http('GET', '/api/friends/state', undefined, jx)).data).includes('Barat Yvett'), 'barátok voltak');
      assert.equal((await admin('POST', '/accounts/delete', { id: yId, confirmName: 'Barat Yvett' })).status, 200);
      assert.ok(!JSON.stringify((await http('GET', '/api/friends/state', undefined, jx)).data).includes('Barat Yvett'), 'a törölt fiók kikerült a barátlistából');
      // a legendás fiók törlése után a legenda újra odaadható
      const kyr = (await admin('GET', '/accounts')).data.accounts.find((a) => a.legend === 'Kyrashi');
      assert.equal((await admin('POST', '/accounts/delete', { id: kyr.id, confirmName: 'Kyrashi' })).status, 200);
      const back = await admin('POST', '/accounts', { email: 'kyrashi2@example.invalid', legend: 'Kyrashi' });
      assert.equal(back.status, 201, back.text); assert.equal(back.data.legend, 'Kyrashi');
    });

    // ---------- lejárt ideiglenes jelszó: a tárolt lejáratot átírjuk, és újraindítjuk a szervert ----------
    const dan = { username: 'Teszt Dani', email: 'dani@example.invalid' };
    let danPw = '';
    await test('Lejárt ideiglenes jelszóval nem lehet belépni; az admin új jelszót ad, azzal megy', async () => {
      const r = await admin('POST', '/accounts', dan);
      danPw = r.data.temporaryPassword;
      assert.equal((await login(dan.email, danPw, new Map())).status, 200, 'lejárat előtt jó');
      await stopServer();
      const data = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      const user = data.users.find((u) => u.email === dan.email);
      assert.ok(user && user.mustChangePassword, 'a kényszerítés tárolt');
      user.tempPasswordExpiresAt = Date.now() - 1000;
      fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
      await startServer();
      const late = await login(dan.email, danPw, new Map());
      assert.equal(late.status, 401, late.text); assert.match(late.data.error, /lejárt/);
      const rows = (await admin('GET', '/accounts')).data.accounts;
      assert.equal(rows.find((a) => a.email === dan.email).tempPasswordExpiresAt < Date.now(), true, 'a lista is látja a lejáratot');
      const fresh = await admin('POST', '/accounts/temp-password', { id: rows.find((a) => a.email === dan.email).id });
      assert.equal((await login(dan.email, fresh.data.temporaryPassword, new Map())).status, 200);
      assert.equal((await login(dan.email, danPw, new Map())).status, 401);
    });

    await test('A tárolt fájl nem tartalmaz olvasható jelszót, és a szerver nem naplózta az ideiglenes jelszavakat', async () => {
      const file = fs.readFileSync(STORE, 'utf8');
      for (const pw of [annaPw, annaTemp, danPw, NEW_PASSWORD]) {
        assert.ok(!file.includes(pw), 'jelszó a fájlban');
        assert.ok(!stderr.includes(pw), 'jelszó a naplóban');
      }
      assert.ok(!/HIBA|uncaught/i.test(stderr), stderr.slice(0, 600));
    });

    await test('Az /admin oldal tartalmazza a Fiókok szakaszt, a főoldal a kötelező jelszócsere-ablakot', async () => {
      const page = await http('GET', '/admin');
      for (const id of ['newAcctForm', 'bulkText', 'acctList', 'acctFilter']) assert.ok(page.text.includes('id="' + id + '"'), id);
      const index = await http('GET', '/');
      for (const id of ['authForce', 'authForceCurrent', 'authForceNew', 'authForceConfirm', 'authForceLogout']) assert.ok(index.text.includes('id="' + id + '"'), id);
    });
  } finally {
    await stopServer();
  }
}

main().catch((e) => { failed++; console.error(e.stack); }).finally(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  console.log('\nAdmin fiókkezelés: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200).unref();
});
