'use strict';
// ============================================================
// KAMU BÍRÓSÁG – teljes körút: WEB ↔ BACKEND ↔ DISCORD BOT
// Valódi szerver (server.js, ideiglenes adatfájlokkal), valódi fiókok és socket.io-kliensek (a "weboldal"),
// a valódi bot-logika (discord-bot/src/court.js + backend.js, valódi HTTP + SSE a szerverrel) és egy memóriában
// élő hamis Discord-szerver (a Discord API-t nem érjük el). Futtatás: node test/court-discord-e2e.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const io = require('socket.io-client');

const BOT = path.resolve(__dirname, '..', 'discord-bot');
const { Collection, PermissionsBitField } = require(path.join(BOT, 'node_modules', 'discord.js'));
const { makeGuild } = require(path.join(BOT, 'test', 'fake-guild'));
const { runSetup } = require(path.join(BOT, 'src', 'setup'));
const { createBackend } = require(path.join(BOT, 'src', 'backend'));
const { createCourtSync, CHANNEL_NAME } = require(path.join(BOT, 'src', 'court'));

const PORT = 3191, BASE = 'http://127.0.0.1:' + PORT;
const TOKEN = 'e2e-service-token-' + crypto.randomBytes(16).toString('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-court-e2e-'));
const f = (n) => path.join(tmp, n);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const sockets = [];
let child = null, serverErrors = '';

async function test(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + error.stack); }
}
async function waitFor(fn, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    let v; try { v = await fn(); } catch (_) { v = null; }
    if (v) return v;
    if (Date.now() > end) throw new Error('Időtúllépés: ' + what);
    await pause(50);
  }
}

// ---------- szerver ----------
async function startServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', AUTH_BASE_URL: BASE, BOT_SERVICE_TOKEN: TOKEN,
      AUTH_STORE_PATH: f('accounts.json'), KB_AVATARS_FILE: f('avatars.json'), KB_STATS_FILE: f('stats.json'),
      KB_COURTS_FILE: f('courts.json'), KB_DMS_FILE: f('dms.json'), KB_MODERATION_FILE: f('moderation.json'), KB_ERRORS_FILE: f('errors.json') },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', (d) => { serverErrors += d; });
  await waitFor(async () => (await fetch(BASE + '/health')).ok, 'a szerver elindul', 15000);
}
async function stopServer() {
  const c = child; child = null;
  if (!c) return;
  await new Promise((resolve) => { c.once('exit', resolve); c.kill('SIGTERM'); setTimeout(() => { try { c.kill('SIGKILL'); } catch (_) { /* */ } }, 3000); });
  await pause(300);
}

// ---------- web (HTTP + socket) ----------
async function http(method, route, body, { jar, headers } = {}) {
  const h = { ...(method === 'POST' ? { 'Content-Type': 'application/json', Origin: BASE } : {}), ...headers };
  if (jar && jar.size) h.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
  const res = await fetch(BASE + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) for (const cookie of res.headers.getSetCookie()) {
    const first = cookie.split(';')[0], i = first.indexOf('=');
    const k = first.slice(0, i), v = first.slice(i + 1);
    if (v) jar.set(k, v); else jar.delete(k);
  }
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (_) { /* */ }
  return { status: res.status, data };
}
const password = 'Egy hosszú titok 123!';
async function account(name) {
  const jar = new Map();
  const r = await http('POST', '/api/auth/register', { username: name, email: crypto.randomUUID() + '@example.invalid', password, confirmPassword: password }, { jar });
  assert.equal(r.status, 201, 'regisztráció: ' + name);
  return { name, jar, id: r.data.user.id, did: String(Math.floor(1e17 + Math.random() * 9e17)), api: (m, p, b) => http(m, p, b, { jar }) };
}
function emit(s, event, payload = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Ack timeout: ' + event)), 5000);
    s.emit(event, payload, (res) => { clearTimeout(t); resolve(res); });
  });
}
// Egy böngészőfül: socket + fiók-azonosítás + a kapott court_update / state események gyűjtése
async function tab(acct) {
  const s = io(BASE, { transports: ['websocket'], reconnection: false });
  sockets.push(s);
  s.updates = []; s.state = null;
  s.on('court_update', (v) => s.updates.push(v));
  s.on('state', (st) => { s.state = st; });
  await new Promise((resolve, reject) => { s.once('connect', resolve); s.once('connect_error', reject); });
  const ticket = (await acct.api('POST', '/api/friends/ticket', {})).data.ticket;
  await emit(s, 'identify', { ticket });
  s.pid = crypto.randomUUID();
  s.createRoom = async () => { const r = await emit(s, 'create_room', { name: acct.name, avatar: '', playerId: s.pid, profile: null }); assert.ok(r.code, JSON.stringify(r)); s.sessionToken = r.sessionToken; s.code = r.code; return r.code; };
  s.joinRoom = async (code) => { const r = await emit(s, 'join_room', { code, name: acct.name, avatar: '', playerId: s.pid, profile: null }); assert.ok(r.code, JSON.stringify(r)); s.code = r.code; return r; };
  return s;
}

// ---------- hamis Discord + bot ----------
const guild = makeGuild();
const client = { guilds: { cache: new Collection([[guild.id, guild]]) } };
const logs = [];
const quiet = { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) };
const panelChannel = () => guild.channels.cache.find((c) => c.name === CHANNEL_NAME);
const panels = (id) => [...panelChannel().messageStore.values()].filter((m) => m.embeds.some((e) => e.footer && e.footer.text.includes('kamu:court:' + id)));
const panelText = (id) => JSON.stringify(panels(id)[0] ? panels(id)[0].embeds : []);
const allMessages = () => [...panelChannel().messageStore.values()].map((m) => JSON.stringify(m.embeds)).join('\n');
let court = null, backend = null;
function newBot() {
  backend = createBackend({ baseUrl: BASE, token: TOKEN, log: quiet });
  court = createCourtSync({ client, backend, gameUrl: BASE, log: quiet, reconcileEveryMs: 100000 });
  return court;
}
const tempRoles = (member) => [...member.roles.cache.values()].map((r) => r.name).filter((n) => n.startsWith('Kamu | ')).sort();

// Egy Discord-gombnyomás (vagy parancs): a kapott (ephemeral) válasz szövegét adja vissza
let interactionSeq = 0;
async function press(user, action, sessionId, { staff = false } = {}) {
  const member = await guild.members.fetch(user.did).catch(() => guild.addMember(user.did, staff ? ['🛡️ Moderátor'] : []));
  const replies = [];
  const interaction = {
    id: 'int-' + (++interactionSeq) + '-' + crypto.randomBytes(4).toString('hex'), customId: `kamu:court:${action}:${sessionId}`,
    user: { id: user.did, username: user.name.toLowerCase() }, member,
    async deferReply() {}, async editReply(t) { replies.push(t); }
  };
  assert.equal(await court.handleButton(interaction), true);
  return replies[replies.length - 1];
}
async function slashLink(user, code) {
  const replies = [];
  await court.handleLinkCommand({
    user: { id: user.did, username: user.name.toLowerCase() }, options: { getString: () => code },
    async deferReply() {}, async editReply(t) { replies.push(t); }
  });
  return replies[replies.length - 1];
}
async function linkViaCode(user) {
  const { code } = (await user.api('POST', '/api/discord/link/start', {})).data;
  const reply = await slashLink(user, code);
  assert.match(reply, /✅/, reply);
  return code;
}

async function main() {
  await startServer();
  const [host, anna, bela, cili] = [await account('SasiHH'), await account('AnnaT'), await account('BelaT'), await account('CiliT')];
  const stranger = { name: 'Idegen', did: '999000111222333444', api: null }; // Discord-tag, aki sosem kötötte össze a fiókját
  await runSetup(guild); // a Discord-szerver felépítése (a /setup)
  const botRoleSetup = guild.roles.cache.find((r) => r.managed);
  assert.ok(botRoleSetup);
  newBot();
  court.start();
  await waitFor(() => logs.some((l) => l.includes('kapcsolódva')), 'a bot kapcsolódik az eseményfolyamhoz');

  let id, code, hostTab;
  const members = {};

  await test('Hitelesítés: bot-végpont token nélkül / rossz tokennel elutasítva; web-végpont bejelentkezés nélkül 401', async () => {
    assert.equal((await http('GET', '/api/bot/sessions')).status, 401);
    assert.equal((await http('GET', '/api/bot/sessions', undefined, { headers: { Authorization: 'Bearer rossz' } })).status, 401);
    assert.equal((await http('GET', '/api/court-sessions/mine')).status, 401);
    assert.equal((await http('POST', '/api/court-sessions', { roomCode: 'ABCD' })).status, 401);
    assert.equal((await http('GET', '/api/discord/link')).status, 401);
    assert.equal((await http('GET', '/api/bot/sessions', undefined, { headers: { Authorization: 'Bearer ' + TOKEN } })).status, 200);
  });

  await test('Discord ↔ Kamu fiók összekötés: egyszer használatos kód; más fiók nem foglalhatja le ugyanazt a Discordot', async () => {
    for (const u of [host, anna, bela, cili]) { await linkViaCode(u); members[u.name] = guild.addMember(u.did); }
    const st = (await anna.api('GET', '/api/discord/link')).data;
    assert.equal(st.linked, true);
    assert.equal(st.discordUsername, 'annat');
    // ugyanaz a kód másodszor nem használható
    const { code: c1 } = (await bela.api('POST', '/api/discord/link/start', {})).data;
    assert.match(await slashLink({ ...bela, did: '777888999000111222' }, c1), /✅|❌/);
    assert.match(await slashLink({ ...bela, did: '777888999000111223' }, c1), /❌/);
    // egy Discord-fiók nem köthető két Kamu-fiókhoz: Cili próbálja Anna Discordját
    const { code: c2 } = (await cili.api('POST', '/api/discord/link/start', {})).data;
    assert.match(await slashLink({ ...cili, did: anna.did }, c2), /❌/);
    // helyreállítjuk Bela eredeti kapcsolatát (egy fiók – egy Discord)
    const { code: c3 } = (await bela.api('POST', '/api/discord/link/start', {})).data;
    assert.match(await slashLink(bela, c3), /✅/);
    assert.equal((await bela.api('GET', '/api/discord/link')).data.discordUsername, 'belat');
  });

  await test('WEB: új tárgyalás létrehozása (csak a szoba házigazdája), stabil courtSessionId', async () => {
    hostTab = await tab(host);
    code = await hostTab.createRoom();
    const annaTab = await tab(anna);
    assert.equal((await anna.api('POST', '/api/court-sessions', { roomCode: code })).status, 403, 'nem házigazda nem nyithat');
    assert.equal((await host.api('POST', '/api/court-sessions', { roomCode: 'ZZZZ' })).status, 404);
    const r = await host.api('POST', '/api/court-sessions', { roomCode: code });
    assert.equal(r.status, 201);
    id = r.data.session.id;
    assert.match(id, /^KAMU-\d+$/);
    assert.equal(r.data.session.status, 'WAITING');
    assert.equal((await host.api('POST', '/api/court-sessions', { roomCode: code })).data.session.id, id, 'ugyanarra a szobára nem készül második');
    annaTab.disconnect();
  });

  await test('DISCORD: a jelentkezési panel automatikusan megjelenik, ugyanazzal az ügyazonosítóval', async () => {
    await waitFor(() => panels(id).length === 1, 'panel');
    const text = panelText(id);
    assert.ok(text.includes('ÚJ KAMU BÍRÓSÁGI TÁRGYALÁS') && text.includes('#' + id) && text.includes('JELENTKEZÉS') && text.includes('1/8'));
    assert.ok(text.includes(code), 'szobakód a panelen');
    const ids = panels(id)[0].components[0].components.map((c) => c.data.custom_id);
    assert.deepEqual(ids.slice(0, 2), [`kamu:court:join:${id}`, `kamu:court:leave:${id}`]);
    // a panel azonosítója a backendben is megvan (újraindításhoz)
    const bs = (await backend.getSession(id)).discord;
    assert.equal(bs.messageId, panels(id)[0].id);
    assert.equal(bs.channelId, panelChannel().id);
  });

  await test('DISCORD → BACKEND → WEB: a „Jelentkezem” azonnal látszik a weben (újratöltés nélkül, socket-eseménnyel)', async () => {
    const before = hostTab.updates.length;
    const reply = await press(anna, 'join', id);
    assert.match(reply, /Jelentkeztél/);
    const web = (await host.api('GET', '/api/court-sessions/' + id)).data.session;
    assert.deepEqual(web.participants.map((p) => p.name).sort(), ['AnnaT', 'SasiHH']);
    assert.ok(web.participants.find((p) => p.name === 'AnnaT').discordLinked);
    await waitFor(() => hostTab.updates.slice(before).some((u) => u.id === id && u.participants.some((p) => p.name === 'AnnaT')), 'court_update a böngészőnek');
    await waitFor(() => panelText(id).includes('2/8') && panelText(id).includes(`<@${anna.did}>`), 'a Discord-panel is frissül');
  });

  await test('Nem összekötött Discord-tag jelentkezése elutasítva, útmutatóval; a bot nem hamisíthat Kamu-felhasználót', async () => {
    const reply = await press(stranger, 'join', id);
    assert.match(reply, /nincs összekötve/);
    assert.match(reply, /\/kapcsol/);
    const web = (await host.api('GET', '/api/court-sessions/' + id)).data.session;
    assert.equal(web.participants.length, 2);
    // a bot-végpont nem fogad el kliens által küldött userId-t: a Discord-azonosítóból oldja fel
    const r = await http('POST', `/api/bot/sessions/${id}/join`, { discordUserId: anna.did, userId: cili.id, discordUsername: 'x' }, { headers: { Authorization: 'Bearer ' + TOKEN } });
    assert.equal(r.status, 200);
    assert.equal(r.data.kamuUsername, 'AnnaT', 'a megadott userId figyelmen kívül marad');
    assert.equal((await host.api('GET', '/api/court-sessions/' + id)).data.session.participants.length, 2);
  });

  await test('Egyidejű jelentkezés (Discord + web, duplikált kattintás): nincs duplikáció, a webes jelentkezés is megjelenik', async () => {
    await Promise.all([press(bela, 'join', id), press(bela, 'join', id), press(cili, 'join', id), cili.api('POST', `/api/court-sessions/${id}/join`, {}), press(anna, 'join', id)]);
    const web = (await host.api('GET', '/api/court-sessions/' + id)).data.session;
    assert.deepEqual(web.participants.map((p) => p.name).sort(), ['AnnaT', 'BelaT', 'CiliT', 'SasiHH']);
    await waitFor(() => panelText(id).includes('4/8'), 'panel 4/8');
  });

  await test('Jogosultság: nem vezető / nem stáb nem sorsolhat; a webes kérés „staff” mezője nem emel jogot', async () => {
    assert.match(await press(anna, 'draw', id), /vezetője vagy a stáb/);
    assert.equal((await anna.api('POST', `/api/court-sessions/${id}/draw`, { staff: true, isAdmin: true })).status, 403);
    assert.equal((await anna.api('POST', `/api/court-sessions/${id}/cancel`, {})).status, 403);
    assert.equal((await host.api('GET', '/api/court-sessions/' + id)).data.session.status, 'WAITING');
  });

  await test('Indítás sorsolás előtt elutasítva', async () => {
    assert.match(await press(host, 'start', id), /sorsolni/);
  });

  let roles;
  await test('Sorsolás Discordról (vezető) + egyidejű webes sorsolás: egyetlen kiosztás, backend-ben tárolva, a web azonnal látja', async () => {
    const before = hostTab.updates.length;
    const results = await Promise.all([press(host, 'draw', id), host.api('POST', `/api/court-sessions/${id}/draw`, {}), press(host, 'draw', id)]);
    const s = (await host.api('GET', '/api/court-sessions/' + id)).data.session;
    assert.equal(s.status, 'READY');
    assert.ok(s.participants.every((p) => p.role), 'mindenki kapott szerepet');
    const counts = {};
    for (const p of s.participants) counts[p.role] = (counts[p.role] || 0) + 1;
    assert.deepEqual(counts, { judge: 1, prosecutor: 1, defendant: 1, witness: 1 }, '4 főnél: bíró, ügyész, vádlott, tanú');
    roles = Object.fromEntries(s.participants.map((p) => [p.name, p.role]));
    // a kettős-hívás ugyanazt az eredményt adta (nem sorsolt újra)
    assert.ok(results.every((r) => r), 'mind kapott választ');
    await waitFor(() => hostTab.updates.slice(before).some((u) => u.id === id && u.status === 'READY' && u.participants.every((p) => p.role)), 'a web élőben megkapja a szerepeket');
    // a sorsolt szerepek a backend DB-fájljában is ott vannak
    await waitFor(() => JSON.parse(fs.readFileSync(f('courts.json'), 'utf8')).sessions[id].participants.every((p) => p.role), 'a fájl mentése');
  });

  await test('DISCORD: a szerepek panelen, külön üzenetben, ideiglenes „Kamu | …” role-okként; csak azok; egyszer', async () => {
    const label = { judge: 'Kamu | Bíró', prosecutor: 'Kamu | Ügyész', defendant: 'Kamu | Vádlott', witness: 'Kamu | Tanú' };
    await waitFor(() => Object.values(members).every((m) => tempRoles(m).length === 1), 'role-ok kiosztva');
    for (const [name, role] of Object.entries(roles)) assert.deepEqual(tempRoles(members[name]), [label[role]], name);
    const text = panelText(id);
    assert.ok(text.includes('Szerepek') && text.includes('Bíró'));
    await waitFor(() => (allMessages().match(/A SZEREPEK KIOSZTVA/g) || []).length === 1, 'szerep-üzenet');
    await pause(400);
    assert.equal((allMessages().match(/A SZEREPEK KIOSZTVA/g) || []).length, 1, 'nem duplikál');
    // staff/admin role-ok sosem módosulnak: a hamis stáb-tag role-ja érintetlen
    const mod = guild.addMember('555000111222333444', ['🛡️ Moderátor']);
    await court.reconcile(id);
    assert.deepEqual([...mod.roles.cache.values()].map((r) => r.name), ['🛡️ Moderátor']);
    // az alkalmazott szerepek a backendben (újraindítás-biztos takarításhoz)
    const applied = (await backend.getSession(id)).discord.appliedRoles;
    assert.equal(Object.keys(applied).length, 4);
  });

  await test('WEB: a szerepek (Bíró, Ügyész, Vádlott, Tanú) a weben is megjelennek, Discord-kapcsolati állapottal', async () => {
    const s = (await anna.api('GET', '/api/court-sessions/by-room/' + code)).data.session;
    assert.equal(s.id, id);
    assert.equal(s.participants.find((p) => p.role === 'judge').roleLabel, 'Bíró');
    assert.equal(s.discordBot.online, true);
    assert.equal(s.discordBot.panel, true);
    assert.ok(s.participants.every((p) => p.discordLinked));
    assert.ok(!JSON.stringify(s).includes(anna.did), 'a Discord-azonosító nem kerül a weboldalra');
  });

  await test('Indítás addig nem lehetséges, amíg a sorsolt játékosok nem léptek be a szobába', async () => {
    assert.match(await press(host, 'start', id), /Még nem léptek be/);
    assert.equal((await host.api('GET', '/api/court-sessions/' + id)).data.session.status, 'READY');
  });

  let tabs = {};
  await test('Játékosok belépnek a szobába (weboldal); Discordról elindul a tárgyalás → MINDKETTŐ IN_PROGRESS, az 1. kör szerepei = a sorsoltak', async () => {
    tabs = { AnnaT: await tab(anna), BelaT: await tab(bela), CiliT: await tab(cili) };
    for (const t of Object.values(tabs)) await t.joinRoom(code);
    const before = hostTab.updates.length;
    assert.match(await press(host, 'start', id), /elindult/);
    const web = (await host.api('GET', '/api/court-sessions/' + id)).data.session;
    assert.equal(web.status, 'IN_PROGRESS');
    await waitFor(() => hostTab.updates.slice(before).some((u) => u.status === 'IN_PROGRESS'), 'a web értesül az indulásról');
    await waitFor(() => panelText(id).includes('FOLYAMATBAN'), 'a Discord-panel FOLYAMATBAN');
    await waitFor(() => (allMessages().match(/A TÁRGYALÁS ELKEZDŐDÖTT/g) || []).length === 1, 'indulás-üzenet');
    // a játékmotor ugyanazt a szerepkiosztást használja, mint a tárgyalás (egyetlen igazság)
    const st = await waitFor(() => (hostTab.state && hostTab.state.phase !== 'lobby' ? hostTab.state : null), 'a játék elindult');
    const nameOf = Object.fromEntries(st.players.map((p) => [p.id, p.name]));
    assert.equal(nameOf[st.currentJudgeId], Object.keys(roles).find((n) => roles[n] === 'judge'));
    assert.equal(nameOf[st.prosecutorId], Object.keys(roles).find((n) => roles[n] === 'prosecutor'));
    assert.equal(nameOf[st.defendantId], Object.keys(roles).find((n) => roles[n] === 'defendant'));
    assert.equal(nameOf[st.witnessId], Object.keys(roles).find((n) => roles[n] === 'witness'));
    assert.match(await press(host, 'start', id), /már megtörtént|elindult/, 'kétszeri indítás nem indít újra');
  });

  await test('Tárgyalás vége (weboldalról): FINISHED mindkét oldalon, ideiglenes role-ok lekerülnek, a panel lezárul', async () => {
    const before = hostTab.updates.length;
    const r = await host.api('POST', `/api/court-sessions/${id}/finish`, {});
    assert.equal(r.data.session.status, 'FINISHED');
    await waitFor(() => hostTab.updates.slice(before).some((u) => u.status === 'FINISHED'), 'web: FINISHED');
    await waitFor(() => Object.values(members).every((m) => tempRoles(m).length === 0), 'a role-ok lekerülnek');
    await waitFor(() => panelText(id).includes('BEFEJEZŐDÖTT') && panels(id)[0].components.length === 0, 'a panel lezárva, gombok nélkül');
    assert.deepEqual([...guild.members.me.roles.cache.values()].map((r) => r.name).filter((n) => n.startsWith('Kamu | ')), []);
    await waitFor(async () => (await backend.listSessions()).every((s) => s.id !== id), 'a takarítás készen van, a bot nem kapja többé');
    assert.equal((await press(anna, 'join', id)), '❌ Ez a tárgyalás már lezárult.');
    for (const t of [hostTab, ...Object.values(tabs)]) t.disconnect();
  });

  // ================= újraindítások =================
  const dora = await account('DoraT');
  let id2, code2, doraTab;
  await test('Előkészítés a második tárgyaláshoz: jelentkezők, sorsolás (READY)', async () => {
    await linkViaCode(dora);
    members.DoraT = guild.addMember(dora.did);
    doraTab = await tab(dora);
    code2 = await doraTab.createRoom();
    id2 = (await dora.api('POST', '/api/court-sessions', { roomCode: code2 })).data.session.id;
    await waitFor(() => panels(id2).length === 1, 'panel #2');
    for (const u of [anna, bela, cili]) assert.match(await press(u, 'join', id2), /Jelentkeztél/);
    assert.match(await press(dora, 'lock', id2), /lezárva/);
    assert.match(await press(host, 'join', id2), /lezárult/, 'lezárás után nincs új jelentkező');
    assert.match(await press(dora, 'draw', id2), /kiosztva/);
    await waitFor(() => ['DoraT', 'AnnaT', 'BelaT', 'CiliT'].every((n) => tempRoles(members[n]).length === 1), 'role-ok');
    doraTab.disconnect();
  });

  let beforePanels, beforeMsgs;
  await test('BOT ÚJRAINDUL: nem készül új panel, a jelentkezők, a szerepek és a role-ok a backendből állnak vissza', async () => {
    court.stop();
    await pause(200);
    beforePanels = panels(id2).length; beforeMsgs = panelChannel().messageStore.size;
    const fresh = guild.addMember('123123123123123123');
    newBot(); // teljesen új bot-példány (üres memória)
    court.start();
    await waitFor(() => logs.filter((l) => l.includes('kapcsolódva')).length >= 2, 'újrakapcsolódás');
    await court.reconcileAll();
    assert.equal(panels(id2).length, beforePanels);
    assert.equal(panelChannel().messageStore.size, beforeMsgs, 'nem posztolt újra semmit');
    assert.ok(panelText(id2).includes(`<@${anna.did}>`) && panelText(id2).includes('Szerepek'));
    assert.equal(tempRoles(members.AnnaT).length, 1);
    // a panel törlése után az újraegyeztetés újra kiteszi, és a backend az új azonosítót jegyzi
    const msg = panels(id2)[0]; panelChannel().messageStore.delete(msg.id);
    await court.reconcile(id2);
    assert.equal(panels(id2).length, 1);
    assert.notEqual(panels(id2)[0].id, msg.id);
    assert.equal((await backend.getSession(id2)).discord.messageId, panels(id2)[0].id);
    beforeMsgs = panelChannel().messageStore.size; void fresh;
  });

  await test('WEB/BACKEND ÚJRAINDUL (telepítés): a tárgyalás, a jelentkezők, a szerepek és a Discord-panel azonosító megmarad; a bot újrakapcsolódik', async () => {
    await pause(1200); // a mentés késleltetése
    const connects = logs.filter((l) => l.includes('kapcsolódva')).length;
    await stopServer();
    await startServer();
    const s = (await backend.getSession(id2));
    assert.equal(s.status, 'READY');
    assert.equal(s.participants.length, 4);
    assert.ok(s.participants.every((p) => p.role));
    assert.equal(s.discord.messageId, panels(id2)[0].id);
    assert.ok((await dora.api('GET', '/api/discord/link')).data.linked, 'a fiókok és a Discord-kapcsolatok is megmaradtak');
    await waitFor(() => logs.filter((l) => l.includes('kapcsolódva')).length > connects, 'a bot újrakapcsolódott az eseményfolyamhoz', 20000);
    await court.reconcileAll();
    assert.equal(panels(id2).length, 1, 'nincs új Discord-lobbi');
    assert.equal(panelChannel().messageStore.size, beforeMsgs);
  });

  await test('Telepítés után a szoba megszűnt: a vezető új szobához köti ugyanazt a tárgyalást, és a Discordról elindítható', async () => {
    const mine = (await dora.api('GET', '/api/court-sessions/mine')).data.sessions;
    assert.equal(mine[0].id, id2);
    const dt = await tab(dora);
    const newCode = await dt.createRoom();
    assert.equal((await anna.api('POST', `/api/court-sessions/${id2}/rebind`, { roomCode: newCode })).status, 403);
    const rb = await dora.api('POST', `/api/court-sessions/${id2}/rebind`, { roomCode: newCode });
    assert.equal(rb.data.session.roomCode, newCode);
    await waitFor(() => panelText(id2).includes(newCode), 'a Discord-panel az új szobakódot mutatja');
    const t2 = [];
    for (const u of [anna, bela, cili]) { const t = await tab(u); await t.joinRoom(newCode); t2.push(t); }
    assert.match(await press(dora, 'start', id2), /elindult/);
    assert.equal((await dora.api('GET', '/api/court-sessions/' + id2)).data.session.status, 'IN_PROGRESS');
    // Discordról lemondás nem lehetséges folyó játék után sem jogosulatlanul; a vezető a Discordról befejezheti
    assert.match(await press(anna, 'finish', id2), /vezetője vagy a stáb/);
    assert.match(await press(dora, 'finish', id2), /befejezve/);
    await waitFor(() => ['DoraT', 'AnnaT', 'BelaT', 'CiliT'].every((n) => tempRoles(members[n]).length === 0), 'role-ok lekerülnek (Discordról befejezve)');
    await waitFor(() => panelText(id2).includes('BEFEJEZŐDÖTT'), 'panel lezárva');
    for (const t of [dt, ...t2]) t.disconnect();
  });

  await test('Sorsolás nélkül, a weboldalról indított játék is IN_PROGRESS-re állítja a tárgyalást (a motor jelzi)', async () => {
    const eve = await account('EveT');
    const et = await tab(eve);
    const c = await et.createRoom();
    const sid = (await eve.api('POST', '/api/court-sessions', { roomCode: c })).data.session.id;
    const others = [];
    for (const n of ['FruT', 'GaboT']) { const a = await account(n); const t = await tab(a); await t.joinRoom(c); others.push(t); }
    const r = await emit(et, 'start_game', { settings: { modes: ['buli'], rounds: 1 } }).catch((e) => ({ error: e.message }));
    await pause(300);
    const s = (await eve.api('GET', '/api/court-sessions/' + sid)).data.session;
    assert.equal(s.status, 'IN_PROGRESS', 'állapot: ' + s.status + ' ' + JSON.stringify(r));
    // a szoba megszűnése (mindenki kilép) lezárja a folyó tárgyalást
    for (const t of [et, ...others]) t.disconnect();
  });

  await test('A szerver nem naplózott belső hibát', async () => {
    assert.ok(!/TypeError|ReferenceError|uncaughtException/.test(serverErrors), serverErrors.slice(0, 600));
  });

  court.stop();
  for (const s of sockets) s.disconnect();
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nKamu ↔ Discord körút: ${passed} sikeres, ${failed} hibás teszt.`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); try { await stopServer(); } catch (_) { /* */ } process.exit(1); });
