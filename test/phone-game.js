'use strict';
// ============================================================
// KAMU BÍRÓSÁG – valódi játék több "telefonnal" FEKVŐ módban (Playwright, érintés, Android-UA), végig ellenőrizve
//   Résztvevők: PHONE_SIZES méretű mobil-nézetek (alapból 640×360, 740×360, 800×360, 851×393, 932×430) + 1 bot, egy szobában.
//   A. játék: 3 kör, bíró-mód, esküdt-kérdés bekapcsolva;  B. játék: 1 kör, esküdt-mód (kihívás-szavazás).
//   Minden telefonon, folyamatosan (kb. 1 mp-enként) mér:
//     HIBA (a teszt bukik, ha két egymás utáni mérésben is megvan): vízszintes görgetés; képernyőről kilógó gomb / beviteli mező / fő blokk
//       (görgethető dobozban a doboz számít); másik elem által TAKART gomb (fedvény alatt nem mérjük); JS-hiba; szerverhiba; befagyott játék.
//     FIGYELMEZTETÉS (kiírja, nem bukik): túl kicsi érintési felület (< 22 px), kilógó / levágott gombszöveg, függőleges oldalgörgetés a játékban.
//   A gombokat ÉRINTÉSSEL nyomja (page.tap: csak látható, nem takart, stabil elemre sikerül): Felolvastam, Végeztem, TILTAKOZOM + bírói döntés,
//   esküdt-kérdés beküldése, válasz (jqDone), szavazás, kihívás-szavazás, kihívás-ellenőrzés, ítélet / kör vége tovább, 😂/👎, ponttábla-fiók + reakció,
//   KÁRTYÁIM tálca, súgó. Szavazás közben egy telefon FRISSÍT (F5), és visszatérve is szavaznia kell.
// Futtatás: node test/phone-game.js     (PHONE_SIZES="800x360,932x430"  PHONE_SHOTS=<mappa> képernyőképekhez; böngésző: CHROMIUM_PATH / Edge / Chrome)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }

const PORT = Number(process.env.PHONE_PORT || 3258), BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.PHONE_SHOTS ? path.resolve(process.env.PHONE_SHOTS) : '';
const REQUIRE = process.env.PHONE_REQUIRE === '1';
const SIZES = (process.env.PHONE_SIZES || '640x360,740x360,800x360,851x393,932x430').split(',').map((s) => s.trim().split('x').map(Number)).filter((a) => a.length === 2 && a[0] > 0);
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky|net::ERR_ABORTED/i;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-phonegame-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };

// ---------- a böngészőben fut: elrendezés-mérés ----------
function phoneAudit() {
  const vw = innerWidth, vh = innerHeight, errors = [], warns = [];
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) errors.push('VÍZSZINTES GÖRGETÉS ' + de.scrollWidth + '>' + vw);
  const overlay = document.body.dataset.courtMajor || '';
  // nyitott felugró réteg (súgó, megerősítő / kérdés-ablak, kinyitott ponttábla-fiók): ilyenkor csak a rétegen belüli elemeket mérjük – ami alatta van, azt szándékosan takarja
  const layer = [...document.querySelectorAll('.confirm-modal.visible, #helpModal:not(.hidden), #screen-game .score-sidebar.open')].pop() || null;
  const shown = (el) => {
    if (layer && !layer.contains(el)) return null;
    if (el.closest('.accusation-ticker.charge-intro')) return null; // a vád-sáv nyitó animációja (a színpad közepéről repül a helyére) szándékosan máshol áll – a layout.js is kihagyja
    if (el.closest('.hidden,[hidden],[aria-hidden="true"]')) return null;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return null; // pl. a becsukott <details> tartalma
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.15) return null;
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    if (r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) return null; // teljesen a képernyőn kívül (pl. zárt kihúzható fiók)
    return r;
  };
  const scrollBox = (el) => {
    for (let a = el.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (/(auto|scroll)/.test(s.overflowY + ' ' + s.overflowX) && (a.scrollHeight > a.clientHeight + 1 || a.scrollWidth > a.clientWidth + 1)) return a;
    }
    return null;
  };
  const label = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const txt = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 22);
    return (el.id ? '#' + el.id : el.tagName.toLowerCase() + cls) + (txt ? ' „' + txt + '”' : '');
  };
  // Ha maga az oldal függőlegesen görgethető (pl. a lobbi), a félig kigörgetett elem nem hiba (oda lehet görgetni); vízszintesen mindig az.
  const pageScrollsY = de.scrollHeight > vh + 1;
  const out = (r, box) => r.left < box.left - 2 || r.right > box.right + 2 || (!(pageScrollsY && box === view) && (r.top < box.top - 2 || r.bottom > box.bottom + 2));
  const view = { left: 0, top: 0, right: vw, bottom: vh };
  for (const el of document.querySelectorAll('button, [role="button"], a.btn, input:not([type="hidden"]), select, textarea')) {
    const r = shown(el); if (!r) continue;
    const sb = scrollBox(el);
    if (!sb) { if (out(r, view)) errors.push('KILÓG: ' + label(el) + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + '–' + Math.round(r.right) + ',' + Math.round(r.bottom) + ']'); }
    else { const s = sb.getBoundingClientRect(); if (out(s, view)) errors.push('KILÓG (görgethető doboz): ' + label(sb)); }
    const box = sb ? sb.getBoundingClientRect() : view;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const centerVisible = cx > Math.max(0, box.left) && cx < Math.min(vw, box.right) && cy > Math.max(0, box.top) && cy < Math.min(vh, box.bottom);
    if (centerVisible && !overlay && !el.disabled) {
      const top = document.elementFromPoint(cx, cy);
      const lab = top && top.closest('label');
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !(lab && lab.contains(el))) errors.push('TAKART: ' + label(el) + ' ← ' + label(top));
    }
    if (el.tagName === 'BUTTON' && (el.innerText || '').trim()) {
      const rg = document.createRange(); rg.selectNodeContents(el); const tr = rg.getBoundingClientRect();
      if (tr.width > 0 && (tr.left < r.left - 3 || tr.right > r.right + 3)) warns.push('GOMBSZÖVEG KILÓG: ' + label(el));
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') warns.push('LEVÁGOTT GOMBSZÖVEG: ' + label(el));
    }
    if (!el.disabled && el.tagName !== 'INPUT' && Math.min(r.width, r.height) < 22) warns.push('KICSI ÉRINTÉSI FELÜLET: ' + label(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  const blocks = ['#screen-game .info-bar', '#roleBanner', '#scenePanel', '#judgeWatch', '.court-intro-card', '.evidence-folder', '.challenge-card', '.verdict-card',
    '#courtReveal .rv-stage', '.confirm-panel', '.help-panel', '#toastBox.visible', '.card-hand[data-state="open"]', '.results-scroll'];
  for (const sel of blocks) for (const el of document.querySelectorAll(sel)) {
    const r = shown(el); if (!r) continue;
    if (r.left < -4 || r.right > vw + 4 || (!pageScrollsY && (r.top < -4 || r.bottom > vh + 4))) errors.push('KILÓG (blokk): ' + sel + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + '–' + Math.round(r.right) + ',' + Math.round(r.bottom) + ']');
  }
  if (document.body.dataset.screen === 'game' && de.scrollHeight > vh + 2) warns.push('FÜGGŐLEGES OLDALGÖRGETÉS a játékban ' + de.scrollHeight + '>' + vh);
  const st = typeof S !== 'undefined' && S ? S : null;
  return { phase: st ? st.phase : '', round: st ? st.round : 0, screen: document.body.dataset.screen || '', overlay, errors, warns };
}

// ---------- a böngészőben fut: a saját helyzetem ----------
function myView() {
  if (typeof S === 'undefined' || !S) return null;
  const me = MY.playerId, roleOf = (id) => (id === S.prosecutorId ? 'prosecutor' : id === S.defendantId ? 'defendant' : id === S.defenderId ? 'defender' : id === S.witnessId ? 'witness' : id === S.currentJudgeId ? 'judge' : 'juror');
  const voters = (S.players || []).filter((p) => p.connected && ![S.prosecutorId, S.defendantId, S.defenderId, S.witnessId].includes(p.id));
  return { phase: S.phase, round: S.round, me, role: roleOf(me), host: S.hostId === me, botVoters: voters.filter((p) => p.isBot).length,
    canVote: !!(S.verdictVote && S.verdictVote.canVote), myVote: S.verdictVote ? S.verdictVote.myVote : null, screen: document.body.dataset.screen };
}

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  return null;
}
const serverLog = [];
async function startServer() {
  const f = (x) => path.join(tmp, x);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  child.stderr.on('data', (d) => { for (const line of String(d).split('\n')) if (/HIBA a\(z\)|Phase timer error|TypeError|ReferenceError|Unhandled/.test(line)) serverLog.push(line.trim().slice(0, 300)); });
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
  const phones = [];
  const problems = new Map(); // "méret | fázis | hiba" -> darab (csak a két egymás utáni mérésben is meglévő)
  const warnings = new Map();
  const tapFails = [];
  const seenPhases = new Set();
  let reloadResult = null;
  try {
    // ---------- telefonok felállítása ----------
    for (const [w, h] of SIZES) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA, locale: 'hu-HU' });
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      const page = await context.newPage();
      const ph = { w, h, tag: w + '×' + h, page, context, errors: [], prev: null, phaseKey: '', phaseSince: 0, audits: 0, done: new Set(), shots: new Set() };
      page.on('pageerror', (e) => ph.errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) ph.errors.push('console: ' + m.text().slice(0, 200)); });
      phones.push(ph);
    }
    const host = phones[0];
    const enter = async (ph, name) => {
      await ph.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await ph.page.waitForSelector('#authGuest'); await ph.page.tap('#authGuest');
      await ph.page.waitForFunction(() => document.body.dataset.screen === 'name');
      await ph.page.evaluate(() => document.getElementById('btnNewSuspect').click());
      await ph.page.fill('#guestName', name);
      await ph.page.evaluate(() => document.getElementById('btnGuestGo').click());
      await ph.page.waitForFunction(() => document.body.dataset.screen === 'menu');
    };
    await enter(host, 'Telo' + host.w);
    await host.page.evaluate(() => document.getElementById('btnCreate').click());
    await host.page.waitForFunction(() => document.body.dataset.screen === 'lobby');
    const code = await host.page.evaluate(() => window.kbInRoom().code);
    for (const ph of phones.slice(1)) {
      await enter(ph, 'Telo' + ph.w);
      await ph.page.fill('#codeInput', code);
      await ph.page.tap('#btnJoin');
      await ph.page.waitForFunction(() => document.body.dataset.screen === 'lobby', null, { timeout: 15000 });
    }
    await host.page.evaluate(() => document.getElementById('btnAddBot').click());
    await host.page.waitForFunction((n) => S && S.players.length === n, phones.length + 1, { timeout: 8000 });

    await check('lobbi ' + phones.length + ' telefonnal + 1 bottal: minden telefonon tiszta elrendezés', async () => {
      await pause(800);
      const bad = [];
      for (const ph of phones) { const a = await ph.page.evaluate(phoneAudit); if (a.errors.length) bad.push(ph.tag + ': ' + a.errors.join(' | ')); for (const w of a.warns) warnings.set(ph.tag + ' | lobbi | ' + w, 1); if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await ph.page.screenshot({ path: path.join(SHOTS, ph.w + 'x' + ph.h + '-0-lobby.png') }); } }
      assert.deepEqual(bad, []);
    });

    // ---------- egy játék beállítása (EGYÉNI JÁTÉK, rövid időzítők) és indítása a lobbiból ----------
    const extras = { tray: new Set(), drawer: new Set(), help: new Set() }; // telefononként egyszer: KÁRTYÁIM tálca, ponttábla-fiók, súgó
    let reloadTried = false;
    const configureAndStart = async (settings) => {
      await host.page.evaluate((st) => {
        document.getElementById('btnCustomGame').click();
        const set = (id, v) => { const e = document.getElementById(id); if (!e) return; e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
        set('setSpeech', 15); set('setDefender', 15); set('setPrep', 10); set('setWitness', 10); set('setClosing', 10); set('setRounds', st.rounds); set('setQuestionSeconds', 10);
        const jq = document.getElementById('setJuryQuestions'); if (jq && jq.checked !== st.jury) jq.click();
        const ag = document.getElementById('setAutoGame'); if (ag && ag.checked) ag.click(); // a játék végén ne induljon magától új játék (a B. játékot a teszt indítja)
        const cm = document.querySelector('input[name="challengeMode"][value="judge"]'); if (cm && !cm.checked) cm.click();
        const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
        document.getElementById('btnSaveSettings').click();
      }, settings);
      await host.page.waitForFunction((st) => S.settings.rounds === st.rounds && S.settings.prepSeconds === 10 && S.settings.juryQuestions === st.jury, settings, { timeout: 8000 });
      await host.page.waitForFunction(() => S.settings.autoNewGame === false && S.settings.challengeMode === 'judge', null, { timeout: 8000 });
      await pause(400);
      await host.page.tap('#btnStartGame');
      for (const ph of phones) await ph.page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
    };

    // ---------- egy futó játék végigjátszása: mérés + teendők minden telefonon ----------
    const playGame = async (label, maxMs) => {
      const t0 = Date.now();
      let lastPhaseChange = Date.now(), lastHostKey = '';
      while (Date.now() - t0 < maxMs) {
        let over = false;
        for (const ph of phones) {
          let a;
          try { a = await ph.page.evaluate(phoneAudit); } catch (_) { continue; } // frissítés közben
          if (!a.phase) continue;
          const key = a.round + ':' + a.phase;
          if (key !== ph.phaseKey) { ph.phaseKey = key; ph.phaseSince = Date.now(); ph.audits = 0; ph.prev = null; }
          ph.audits++;
          seenPhases.add(a.phase);
          const norm = (s) => s.replace(/\s*\[.*?\]/g, '').replace(/\d+>\d+/g, 'N');
          const now = new Set(a.errors.map(norm));
          if (ph.prev) for (const e of now) if (ph.prev.has(e)) { const k = ph.tag + ' | ' + a.phase + (a.overlay ? ' (' + a.overlay + ')' : '') + ' | ' + e; problems.set(k, (problems.get(k) || 0) + 1); }
          ph.prev = now;
          for (const w of a.warns) { const k = ph.tag + ' | ' + a.phase + ' | ' + norm(w); warnings.set(k, (warnings.get(k) || 0) + 1); }
          if (SHOTS && ph.audits === 2 && !ph.shots.has(label + key)) { ph.shots.add(label + key); await ph.page.screenshot({ path: path.join(SHOTS, ph.w + 'x' + ph.h + '-' + label + '-r' + a.round + '-' + a.phase + '.png') }).catch(() => {}); }
          if (ph === host && key !== lastHostKey) { lastHostKey = key; lastPhaseChange = Date.now(); }
          if (a.phase === 'game_over') { over = true; continue; }
          // ---------- teendők (legalább két mérés után, hogy a fázis elejét is lássuk) ----------
          const age = Date.now() - ph.phaseSince;
          if (ph.audits < 2 || age < 1800) continue;
          const v = await ph.page.evaluate(myView).catch(() => null);
          if (!v || v.screen !== 'game') continue;
          const once = async (id, fn) => { const k = label + key + ':' + id; if (ph.done.has(k)) return; ph.done.add(k); await fn(); };
          const visible = (sel) => ph.page.evaluate((s) => { const e = document.querySelector(s); if (!e || e.disabled) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; }, sel).catch(() => false);
          const tap = async (sel, why) => {
            if (!(await visible(sel))) return false;
            try { await ph.page.tap(sel, { timeout: 2500 }); return true; }
            catch (e) {
              const still = await visible(sel);
              const samePhase = (await ph.page.evaluate(() => (typeof S !== 'undefined' && S) ? S.round + ':' + S.phase : '').catch(() => '')) === key;
              if (still && samePhase) tapFails.push(ph.tag + ' | ' + a.phase + ' | ' + (why || sel) + ': ' + String(e.message).split('\n')[0].slice(0, 160));
              return false;
            }
          };
          const speech = ['prosecution', 'defense', 'defender', 'witness', 'final_prosecution', 'final_defense'].includes(a.phase);
          if (a.phase === 'accusation' && await visible('#iaAccRead')) await once('read', () => tap('#iaAccRead', 'Felolvastam')); // (csak a bíró látja)
          if (a.phase === 'prep' && !extras.tray.has(ph.tag)) {
            if (await visible('.card-hand .ch-toggle')) {
              extras.tray.add(ph.tag);
              await tap('.card-hand .ch-toggle', 'KÁRTYÁIM megnyitása'); await pause(600);
              const t = await ph.page.evaluate(phoneAudit);
              for (const e of t.errors) problems.set(ph.tag + ' | prep (nyitott tálca) | ' + e, 1);
              if (SHOTS) await ph.page.screenshot({ path: path.join(SHOTS, ph.w + 'x' + ph.h + '-' + label + '-tray.png') }).catch(() => {});
              // csak ha még nyitva van (ha közben fázist váltott a játék, a tálca magától becsukódik; a gomb ilyenkor újra nyitná)
              if (await ph.page.evaluate(() => { const hnd = document.querySelector('.card-hand'); return !!(hnd && hnd.dataset.state === 'open'); })) await tap('.card-hand .ch-toggle', 'KÁRTYÁIM bezárása');
            }
          }
          if (speech) {
            if (!extras.drawer.has(ph.tag) && v.role === 'juror' && await visible('#sbToggle')) {
              extras.drawer.add(ph.tag);
              await tap('#sbToggle', 'ponttábla-fiók nyitása'); await pause(600);
              const t = await ph.page.evaluate(phoneAudit);
              for (const e of t.errors) problems.set(ph.tag + ' | ' + a.phase + ' (nyitott ponttábla) | ' + e, 1);
              if (SHOTS) await ph.page.screenshot({ path: path.join(SHOTS, ph.w + 'x' + ph.h + '-' + label + '-drawer.png') }).catch(() => {});
              await tap('.react-btn', 'reakció'); await pause(200);
              await tap('#sbToggle', 'ponttábla-fiók zárása');
            }
            if (!extras.help.has(ph.tag) && v.role === 'witness' && await visible('#screen-game [data-help]')) {
              extras.help.add(ph.tag);
              await tap('#screen-game [data-help]', 'súgó'); await pause(600);
              const t = await ph.page.evaluate(phoneAudit);
              for (const e of t.errors) problems.set(ph.tag + ' | súgó | ' + e, 1);
              if (SHOTS) await ph.page.screenshot({ path: path.join(SHOTS, ph.w + 'x' + ph.h + '-' + label + '-help.png') }).catch(() => {});
              await tap('#helpClose', 'súgó bezárása');
            }
            if (await visible('#iaAsk')) await once('ask', async () => {
              if (await tap('#iaAsk', 'KÉRDÉST TESZEK FEL')) {
                await pause(400);
                const t = await ph.page.evaluate(phoneAudit);
                for (const e of t.errors) problems.set(ph.tag + ' | ' + a.phase + ' (kérdés-ablak) | ' + e, 1);
                if (SHOTS) await ph.page.screenshot({ path: path.join(SHOTS, ph.w + 'x' + ph.h + '-' + label + '-ask.png') }).catch(() => {});
                await ph.page.fill('#jqText', 'Hol voltál, amikor eltűnt a pogácsa?');
                await tap('#jqSend', 'kérdés ELKÜLDÖM');
              }
            });
            if (await visible('#iaObject')) await once('object', async () => { if (Math.random() < 0.5) await tap('#iaObject', 'TILTAKOZOM'); });
            if (age > 2600) await once('done', () => tap('#iaDone', 'Végeztem'));
          }
          if (a.phase === 'objection') { await once('objdec', () => tap(Math.random() < 0.5 ? '#objAccept' : '#objReject', 'bírói döntés')); await once('objdone', () => tap('#iaDone', 'tiltakozás: Végeztem')); }
          if (a.phase === 'jury_question') await once('jqdone', () => tap('#jqDone', 'válaszoltam'));
          if (a.phase === 'verdict_vote' && v.canVote && !v.myVote) {
            // FRISSÍTÉS szavazás közben: csak akkor, ha a szavazók mind telefonok (a bot gyorsan szavazna, és a szavazás a frissítés alatt lezárulna)
            if (!reloadTried && !v.host && v.botVoters === 0) {
              reloadTried = true;
              await ph.page.reload({ waitUntil: 'domcontentloaded' });
              let ok = false;
              try { await ph.page.waitForFunction(() => document.body.dataset.screen === 'game' && S && S.phase === 'verdict_vote', null, { timeout: 15000 }); ok = true; } catch (_) { /* */ }
              const after = ok ? await ph.page.evaluate(myView) : null;
              reloadResult = { tag: ph.tag, ok, canVote: !!(after && after.canVote), phase: after && after.phase };
              ph.phaseKey = ''; // újramérés
              if (reloadResult.canVote) await tap(Math.random() < 0.5 ? '#voteGuilty' : '#voteNotGuilty', 'szavazás frissítés után');
              continue;
            }
            if (reloadTried && reloadResult === null) continue;
            await once('vote', () => tap(Math.random() < 0.5 ? '#voteGuilty' : '#voteNotGuilty', 'szavazás'));
          }
          // (időszeletenként újrapróbálja: az elején a kihíváskártya-fedvény alatt a szavazógombok még rejtve vannak)
          if (a.phase === 'challenge_vote') await once('cv:' + Math.floor(age / 3000), async () => { for (let i = 0; i < 3; i++) { const id = await ph.page.evaluate(() => { const b = document.querySelector('.cv-btns .cv-btn:not([disabled])'); return b ? b.id : ''; }); if (!id) break; await tap('#' + id, 'kihívás-szavazás'); await pause(500); const chip = await ph.page.evaluate(() => { const c = document.querySelector('.cv-chip:not(.done):not(.on)'); return c ? c.dataset.cvi : ''; }); if (chip) await tap('.cv-chip[data-cvi="' + chip + '"]', 'következő kihívás'); await pause(300); } });
          if (a.phase === 'challenge_review') await once('rv:' + Math.floor(age / 4000), () => tap(Math.random() < 0.7 ? '#rvDone' : '#rvFail', 'kihívás-ellenőrzés'));
          if (a.phase === 'verdict' || a.phase === 'round_results') {
            await once('fun', () => tap(Math.random() < 0.5 ? '.acc-fun[data-acc="1"]' : '.acc-fun[data-acc="0"]', '😂/👎'));
            if (v.host && age > 3200) await once('next', () => tap(a.phase === 'verdict' ? '#btnProceed' : '#btnNextRound', 'tovább'));
          }
        }
        if (over) break;
        if (Date.now() - lastPhaseChange > 80000) { problems.set('mind | ' + lastHostKey + ' | BEFAGYOTT: 80 mp óta nincs fázisváltás', 1); break; }
        await pause(250);
      }
      const final = await host.page.evaluate(() => S && S.phase);
      return final;
    };

    await check('A. játék (3 kör, bíró-mód, esküdt-kérdés): végigmegy a játék végéig', async () => {
      await configureAndStart({ rounds: 3, jury: true });
      const end = await playGame('A', 9 * 60 * 1000);
      assert.equal(end, 'game_over', 'a játék a végéig jutott (utolsó fázis: ' + end + ')');
    });
    await check('B. játék (1 kör, esküdt-mód: kihívás-szavazás): az ÚJ TÁRGYALÁS gombbal indul és végigmegy', async () => {
      // a játék végén a házigazda átállítja a módot (esküdtek szavaznak a kihívásokról), és az ÚJ TÁRGYALÁS gombbal új játékot indít
      await host.page.evaluate(() => socket.emit('update_settings', { settings: { challengeMode: 'jury', rounds: 1, juryQuestions: false, autoNewGame: false } }));
      await pause(400);
      await host.page.waitForSelector('#btnNewGame', { timeout: 15000 });
      await host.page.tap('#btnNewGame');
      await host.page.waitForFunction(() => S && S.phase === 'accusation' && S.round === 1, null, { timeout: 15000 });
      for (const ph of phones) ph.phaseKey = '';
      const end = await playGame('B', 6 * 60 * 1000);
      assert.equal(end, 'game_over', 'a B. játék a végéig jutott (utolsó fázis: ' + end + ')');
      assert.ok(seenPhases.has('challenge_vote'), 'volt kihívás-szavazás (esküdt-mód)');
    });

    await check('a játékban érintett fázisok', async () => {
      const need = ['accusation', 'prep', 'prosecution', 'defense', 'defender', 'witness', 'final_prosecution', 'final_defense', 'verdict_vote', 'verdict', 'round_results', 'game_over'];
      const missing = need.filter((p) => !seenPhases.has(p));
      console.log('  mért fázisok: ' + [...seenPhases].join(', '));
      assert.deepEqual(missing, [], 'hiányzó fázis(ok)');
    });
    await check('elrendezés: nincs kilógó / takart gomb, nincs vízszintes görgetés (két egymás utáni mérésben)', async () => {
      const list = [...problems.keys()];
      assert.deepEqual(list, [], '\n    ' + list.join('\n    '));
    });
    await check('minden szükséges gomb ÉRINTÉSSEL megnyomható volt', async () => { assert.deepEqual(tapFails, [], '\n    ' + tapFails.join('\n    ')); });
    await check('szavazás közben frissítő telefon visszatérve is szavazhat', async () => {
      if (!reloadResult) { console.log('  (nem jött létre olyan szavazás, ahol csak telefonok szavaznak – kihagyva)'); return; }
      assert.ok(reloadResult.ok && reloadResult.canVote, JSON.stringify(reloadResult));
    });
    await check('nincs JS-hiba egyik telefonon sem', async () => { const all = phones.flatMap((ph) => ph.errors.map((e) => ph.tag + ': ' + e)); assert.deepEqual(all, []); });
    await check('nincs szerverhiba', async () => { assert.deepEqual(serverLog, []); });
  } finally {
    if (warnings.size) {
      console.log('\nFIGYELMEZTETÉSEK (nem buktatják a tesztet), egyedi sorok:');
      const uniq = new Map();
      for (const k of warnings.keys()) { const [tag, , w] = k.split(' | '); const kk = w; if (!uniq.has(kk)) uniq.set(kk, new Set()); uniq.get(kk).add(tag); }
      for (const [w, tags] of uniq) console.log('  ' + w + '  →  ' + [...tags].join(', '));
    }
    for (const ph of phones) await ph.context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (server) server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ }
  }
  console.log('\nTelefonos játék (fekvő): ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
