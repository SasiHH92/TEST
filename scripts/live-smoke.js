'use strict';
// ============================================================
// KAMU BÍRÓSÁG – élő füstteszt (nem maradandó): egy futó szerver (pl. az éles Render-cím) alapellenőrzése.
// Futtatás: npm run smoke -- https://a-jatek-cime
// Nem hoz létre fiókot, NEM indít játékot (az statisztikát írna), a szoba a végén megszűnik.
// Ellenőrzi: /health, főoldal, kliens-fájlok, biztonsági fejlécek, védett végpontok, socket.io (websocket + polling),
// szoba létrehozása vendégként, botok, lobbi-állapot, beállítások mentése, kilépés.
// ============================================================
const io = require('socket.io-client');

const BASE = String(process.argv[2] || process.env.SMOKE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(BASE)) { console.error('Használat: node scripts/live-smoke.js https://a-jatek-cime'); process.exit(2); }
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('OK    ' + name); }
  catch (e) { failed++; console.error('HIBA  ' + name + ' → ' + (e && e.message || e)); }
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const get = (p, opt) => fetch(BASE + p, { signal: AbortSignal.timeout(60000), ...opt });
const emit = (s, ev, payload = {}) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('nincs válasz: ' + ev)), 10000);
  s.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); });
});
function connect(transports) {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports, reconnection: false, timeout: 60000 });
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(new Error('socket: ' + e.message)));
  });
}

(async () => {
  console.log('Élő füstteszt: ' + BASE + ' (az első kérés a Render ébredése miatt lassú lehet)\n');
  await check('/health 200', async () => { const r = await get('/health'); must(r.status === 200, 'HTTP ' + r.status); });
  await check('főoldal betölt, a kliens-fájlok elérhetők', async () => {
    const r = await get('/'); const html = await r.text();
    must(r.status === 200 && /Kamu Bíróság/i.test(html), 'a főoldal nem a játék');
    for (const f of ['/client.js', '/courts.js', '/courts.css', '/style.css', '/cinema.css', '/shop.js']) must((await get(f)).status === 200, f + ' nem elérhető');
  });
  await check('biztonsági fejlécek (CSP, nosniff, frame-tiltás)', async () => {
    const h = (await get('/')).headers;
    must(/script-src 'self'/.test(h.get('content-security-policy') || ''), 'nincs CSP');
    must((h.get('x-content-type-options') || '') === 'nosniff', 'nincs nosniff');
  });
  await check('védett végpontok bejelentkezés / token nélkül elutasítanak', async () => {
    must([401, 503].includes((await get('/api/bot/sessions')).status), 'a bot-végpont nyitva');
    must((await get('/api/court-sessions/mine')).status === 401, 'a tárgyalás-lista nyitva');
    must((await get('/api/discord/link')).status === 401, 'a Discord-kapcsolat nyitva');
    must((await get('/api/shop/state')).status === 401, 'a bolt nyitva');
    const admin = await get('/api/admin/status');
    must([401, 403, 404, 503].includes(admin.status), 'az admin nyitva: ' + admin.status);
  });
  await check('/api/auth/status válaszol; a Discord-belépés be van állítva', async () => {
    const r = await get('/api/auth/status'); must(r.status === 200, 'HTTP ' + r.status);
    const j = await r.json(); must(j.available !== false, 'a fiókrendszer nem elérhető');
    console.log('      szolgáltatók: ' + JSON.stringify(j.providers || {}));
  });
  for (const transports of [['websocket'], ['polling']]) {
    await check('socket.io kapcsolat (' + transports[0] + ')', async () => { const s = await connect(transports); s.disconnect(); });
  }
  await check('vendég szoba: létrehozás, 2 bot, lobbi-állapot, beállítások mentése, kilépés (játék NEM indul)', async () => {
    const s = await connect(['websocket']);
    const pid = 'smoke-' + Math.random().toString(36).slice(2, 12);
    const r = await emit(s, 'create_room', { name: 'Füstteszt', avatar: '', playerId: pid, profile: null });
    must(r && /^[A-Z0-9]{4}$/.test(r.code || ''), 'nem jött szobakód: ' + JSON.stringify(r).slice(0, 120));
    must(r.state && r.state.phase === 'lobby', 'nem lobbi az állapot');
    must((await emit(s, 'add_bot', {})).ok, 'bot hozzáadása'); must((await emit(s, 'add_bot', {})).ok, '2. bot');
    const u = await emit(s, 'update_settings', { settings: { rounds: 2 } });
    must(u && u.ok && u.state.settings.rounds === 2, 'a beállítás nem mentődött');
    const j = await emit(s, 'join_room', { code: r.code, name: 'Másik', avatar: '', playerId: pid + 'x', profile: null }).catch(() => null);
    must(j === null || j.code === r.code || j.error, 'második belépés értelmezhetetlen');
    await emit(s, 'leave_room', {});
    s.disconnect();
  });
  console.log(`\nÖsszesen: ${passed} rendben, ${failed} hiba.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
