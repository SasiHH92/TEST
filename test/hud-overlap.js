'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a játék tartós HUD-elemei nem takarják egymást (telefon, tablet, gép), hosszú kártyaszövegekkel
//   A) a szerep-füzet / BÍRÓI FIGYELŐ (#judgeWatchBar) nem lóg a vád-sáv (#accusationTicker) alá, és a fejléce kattintható
//      (álló telefonon és tableten a kétsoros vád korábban a füzet gombjára ült);
//   B) a 🐞 Hibajelentés gomb (.bug-fab) nem fedi a KÁRTYÁIM paklit / tálcát (gépen a pakli a gomb helyén ült);
//   C) a kártyák szövege teljes sorokban ér véget ("…"), nem csúszik a pecsét és a lábléc alá, és nincs félbevágott sor
//      (a böngésző a line-clamp utáni sorokat is kirajzolja, ha a doboz magasabb – a cards.js fitTexts() igazítja).
//   Állapotok: a valódi játékmotor publicState-je (bíró: felkészülés, vádbeszéd; ügyész / vádlott / védő: felkészülés hosszú, 120+ karakteres lapokkal,
//   zárt és nyitott paklival). Hiba csak az, ami két egymás utáni mérésben is megvan.
// Futtatás: node test/hud-overlap.js     (HUD_SIZES="390x844,1366x768"  HUD_SHOTS=<mappa>: a hibás állapotok képe)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { Game } = require('../game');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }

const PORT = Number(process.env.HUD_PORT || 3279), BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.HUD_SHOTS ? path.resolve(process.env.HUD_SHOTS) : '';
const REQUIRE = process.env.HUD_REQUIRE === '1';
const SIZES = (process.env.HUD_SIZES || '360x640,390x844,430x932,768x1024,640x360,932x430,1024x768,1366x768,1920x1080')
  .split(',').map((s) => s.trim().split('x').map(Number)).filter((a) => a.length === 2 && a[0] > 0);
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-hud-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };

// hosszú (a Kártyaműhely 130 karakteres korlátjához közeli) lapok
const LONG = {
  charge: 'Elvitte Lili kocsiját „csak a sarokig”, és Szegeden kötött ki vele, aztán azt mondta, hogy a GPS vitte el.',
  challenge: 'Minden 15 másodpercben mondd, hogy „pillanat”, és nézz az órádra, mintha sietnél valahova, de ne magyarázd meg, miért.',
  alibi: 'Egy horrorfilmet néztél, és az utolsó húsz percet inkább a plafont bámulva töltötted, mert túl ijesztő volt.',
  evidence: ['Egy fotó, amelyen a vádlott vámpírfogakkal eszik pattogatott kukoricát, és a fogak a kukoricában ragadnak.', 'Egy üres cukorkás zacskó, rajta a vádlott ujjlenyomataival és a felirattal: "Csak egyet vettem el".', 'Rövid bizonyíték.'],
  tricks: ['Állítsd, hogy a vádlott ultja a csapat összes sérülését meggyógyította volna, ha nem szakad meg a kapcsolat.', 'Kérd az esküdteket, hogy mondják el a legijesztőbb dolgot, amit valaha csináltak, és ezzel terelj.']
};
function scene(phase, viewer, long) {
  const g = new Game('HUD1', { to: () => ({ emit: () => {} }) });
  try {
    ['Bence', 'Lili', 'Ádám', 'Réka', 'Zoli', 'Dóri', 'Panni'].forEach((n, i) => { g.addPlayer('p' + i, n, 'av0' + (i + 1), i === 0); g.players.get('p' + i).isBot = true; });
    g.startGame({ modes: ['buli'], rounds: 3, autoNextRound: false, autoNewGame: false, juryQuestions: false }, 'p0');
    const d = g.roundData;
    d.accusationText = LONG.charge;
    g.phase = phase; g.phaseEndsAt = Date.now() + 60000;
    const ids = { judge: d.currentJudgeId, prosecutor: d.prosecutorId, defendant: d.defendantId, defender: d.defenderId };
    const st = g.publicState(ids[viewer]);
    if (long) {
      if (st.myChallenge) st.myChallenge = LONG.challenge;
      if (st.alibi) st.alibi = LONG.alibi;
      if (Array.isArray(st.evidence)) st.evidence = LONG.evidence;
      if (Array.isArray(st.tricks)) st.tricks = LONG.tricks;
    }
    return { state: st, myId: ids[viewer] };
  } finally { g.dispose(); }
}
const SCENES = [
  ['prep', 'judge', false, false], ['prosecution', 'judge', false, false],
  ['prep', 'prosecutor', true, true], ['prep', 'defendant', true, true], ['prep', 'defendant', true, false], ['prep', 'defender', true, true]
];

// ---------- a böngészőben fut ----------
function hudAudit() {
  const vis = (el) => el && !el.classList.contains('hidden') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const ov = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const out = [];
  // A) füzet ⇄ vád-sáv
  const jw = document.getElementById('judgeWatchBar'), tk = document.getElementById('accusationTicker');
  if (vis(jw)) {
    if (vis(tk) && !tk.classList.contains('expanded') && !tk.classList.contains('charge-intro')) { const a = ov(box(jw), box(tk)); if (a > 4) out.push('A: a szerep-füzet a vád-sáv alá lóg (' + Math.round(a) + ' px²)'); }
    const head = document.getElementById('jwHead');
    if (head) { const h = head.getBoundingClientRect(), hit = document.elementFromPoint(h.left + h.width / 2, h.top + h.height / 2); if (!hit || !hit.closest('#judgeWatchBar')) out.push('A: a füzet fejléce nem kattintható (' + (hit ? (hit.id || String(hit.className)).slice(0, 30) : '–') + ' takarja)'); }
  }
  // B) 🐞 ⇄ KÁRTYÁIM (a zárt pakli alja a "kéz" szélén levágódik: azt a részt nem számoljuk)
  const fab = document.querySelector('.bug-fab'), hand = document.querySelector('.card-hand');
  if (vis(fab) && vis(hand)) {
    const fr = box(fab), stageB = hand.querySelector('.ch-stage').getBoundingClientRect().bottom;
    let worst = 0;
    hand.querySelectorAll('.court-card, .ch-toggle').forEach((p) => { if (!vis(p) || getComputedStyle(p).display === 'none') return; const q = box(p); if (hand.dataset.state === 'closed' && p.classList.contains('court-card')) q.b = Math.min(q.b, stageB); worst = Math.max(worst, ov(fr, q)); });
    if (hand.dataset.state === 'open' && getComputedStyle(hand).backgroundImage !== 'none') worst = Math.max(worst, ov(fr, box(hand)));
    if (worst > 4) out.push('B: a 🐞 Hibajelentés gomb a kártyákon (' + hand.dataset.state + ', ' + Math.round(worst) + ' px²)');
  }
  // C) kártyaszöveg: a lap elforgatása a mérés idejére ki, a ténylegesen kirajzolt sorok (Range) ⇄ szövegdoboz, lábléc, pecsét
  if (vis(hand)) {
    hand.querySelectorAll('.ch-stage .court-card:not(.more)').forEach((card) => {
      const tx = card.querySelector('.cf-text');
      if (!tx || getComputedStyle(card).display === 'none') return;
      const keep = [card.style.transition, card.style.transform, card.style.translate];
      card.style.transition = 'none'; card.style.transform = 'none'; card.style.translate = 'none';
      const cr = card.getBoundingClientRect(), xr = tx.getBoundingClientRect(), rg = document.createRange();
      rg.selectNodeContents(tx);
      const rows = [];
      for (const q of rg.getClientRects()) if (q.width >= 1 && !rows.some((r) => Math.abs(r.t - q.top) < 2)) rows.push({ t: q.top, b: q.bottom });
      const shown = rows.filter((r) => r.t < xr.bottom - 1), last = shown.length ? Math.max(...shown.map((r) => r.b)) : xr.top;
      const type = (card.className.match(/\bt-(\w+)/) || [, '?'])[1];
      if (last > xr.bottom + 0.5) out.push('C: ' + type + '-lap: félbevágott utolsó sor (' + Math.round(last - xr.bottom) + ' px)');
      const foot = card.querySelector('.cf-foot');
      if (foot && getComputedStyle(foot).display !== 'none' && foot.getBoundingClientRect().top < last - 1) out.push('C: ' + type + '-lap: a szöveg a láblécre csúszik');
      const stamp = card.querySelector('.cf-stamp');
      if (stamp && getComputedStyle(stamp).display !== 'none' && cr.top + stamp.offsetTop < last - 1) out.push('C: ' + type + '-lap: a szöveg a pecsét alá csúszik (' + Math.round(last - cr.top - stamp.offsetTop) + ' px)');
      if (last > cr.bottom - parseFloat(getComputedStyle(card).paddingBottom) + 1) out.push('C: ' + type + '-lap: a szöveg kilóg a lap aljából');
      card.style.transform = keep[1]; card.style.translate = keep[2]; void card.offsetWidth; card.style.transition = keep[0];
    });
  }
  return out;
}

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  return null;
}
async function startServer() {
  const f = (x) => path.join(tmp, x);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'), KB_CARDFB_FILE: f('cf.json'),
    KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json'), KB_ACTIVITY_FILE: f('act.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { /* */ } await pause(150); }
  child.kill();
  throw new Error('a szerver nem indult el');
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  try {
    for (const [w, h] of SIZES) {
      const tag = w + '×' + h, phone = Math.min(w, h) <= 520;
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, userAgent: phone ? UA_PHONE : undefined, locale: 'hu-HU' });
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#authGuest');
      const found = [];
      for (const [phase, viewer, long, open] of SCENES) {
        const data = scene(phase, viewer, long);
        await page.evaluate(({ state, myId }) => {
          IDENTITY_READY = true; INTENTIONAL_LEAVE = false; KICKED_FROM_ROOM = true;
          MY.playerId = myId; MY.code = 'HUD1'; S = state; serverOffset = 0;
          show('game'); renderGame(); if (!window.__hudAnim) { window.__hudAnim = 1; charAnim.start(); startTimerLoop(); }
        }, data);
        await page.waitForFunction(() => !document.body.dataset.courtMajor && !document.querySelector('#accusationTicker.charge-intro'), null, { timeout: 9000 }).catch(() => {});
        await pause(500);
        await page.evaluate((open) => { const hd = document.querySelector('.card-hand'); if (hd && !hd.classList.contains('hidden') && (hd.dataset.state === 'open') !== open) hd.querySelector('.ch-toggle').click(); }, open);
        await pause(600);
        const a = await page.evaluate(hudAudit);
        await pause(400);
        const b = new Set(await page.evaluate(hudAudit));
        const lasting = a.filter((x) => b.has(x));
        const where = phase + ' (' + viewer + (long ? ', hosszú lapok' : '') + (open ? ', nyitott pakli' : '') + ')';
        for (const x of lasting) found.push(where + ' | ' + x);
        if (lasting.length && SHOTS) await page.screenshot({ path: path.join(SHOTS, w + 'x' + h + '-' + where.replace(/[^a-z0-9_-]/gi, '_') + '.png') });
      }
      await check(tag + ': a füzet, a vád-sáv, a 🐞 gomb és a kártyák nem takarják egymást, a kártyaszöveg teljes sorokban ér véget (' + SCENES.length + ' állapot)', async () => {
        assert.deepEqual(found, [], '\n    ' + found.join('\n    '));
      });
      await check(tag + ': nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
      await context.close();
    }
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nHUD-átfedések: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
