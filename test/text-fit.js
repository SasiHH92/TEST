'use strict';
// ============================================================
// KAMU BÍRÓSÁG – a szövegek elférnek a dobozukban (feliratok, jelvények, gombok, táblák, panelek), telefonon és gépen
//   Méretek (TEXT_SIZES): fekvő telefon 640×360, 800×360, 932×430; álló telefon 360×640, 390×844; tablet 768×1024; gép 1024×768, 1366×768, 1920×1080.
//   Képernyők: belépőoldal, névválasztó, menü, lobbi (botokkal), és a játék mind a 15 fázisa (a test/browser-check.js valódi publicState-mintáiból,
//   hosszú nevekkel), a felkészülés több szerepből nézve.
//   Hiba (a teszt bukik): (1) SZÖVEG KILÓG A DOBOZÁBÓL: egy látható dobozú (háttér / keret) elem saját szövege túlnyúlik a dobozon;
//   (2) LEVÁGOTT SZÖVEG: a szöveg nem fér el, a doboz levágja, és nincs "…" (ellipszis) vagy szándékos sor-korlát (line-clamp).
//   Kihagyva: a futó hírszalag, a ferde pecsétek, a képernyőn kívüli elemek, a fedvények animációja (a mérés a fedvény után történik).
// Futtatás: node test/text-fit.js      (TEXT_SIZES="800x360,1366x768"  TEXT_SHOTS=<mappa>: a hibás képernyők képe, a hibás elemek pirosan keretezve)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { fixture, phases } = require('./browser-check');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }

const PORT = Number(process.env.TEXT_PORT || 3261), BASE = 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.TEXT_SHOTS ? path.resolve(process.env.TEXT_SHOTS) : '';
const REQUIRE = process.env.TEXT_REQUIRE === '1';
const SIZES = (process.env.TEXT_SIZES || '640x360,800x360,932x430,360x640,390x844,768x1024,1024x768,1366x768,1920x1080')
  .split(',').map((s) => s.trim().split('x').map(Number)).filter((a) => a.length === 2 && a[0] > 0);
const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-textfit-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };

// ---------- a böngészőben fut ----------
function textFit() {
  const vw = innerWidth, vh = innerHeight, out = [];
  const SKIP = '.ticker, .news-ticker, svg, .court-stamp, .cf-stamp, .ev-stamp, .sentence-stamp, .cc-stamp, .rv-stage, .court-countdown, .dove, .confetti, .score-fly, .sr-only, [aria-hidden="true"]';
  const boxed = (cs) => (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || (cs.backgroundImage && cs.backgroundImage !== 'none') ||
    ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none');
  const label = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return (el.id ? '#' + el.id : el.tagName.toLowerCase() + cls) + ' „' + (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 26) + '”';
  };
  const bad = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest(SKIP)) continue;
    const texts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!texts.length) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) continue;
    const cs = getComputedStyle(el);
    if (cs.transform && cs.transform !== 'none' && !/^matrix\(1, 0, 0, 1,/.test(cs.transform)) continue; // elforgatott / nagyított díszelem
    // a saját (közvetlen) szöveg befoglaló téglalapja
    let l = Infinity, t = Infinity, rt = -Infinity, b = -Infinity;
    for (const n of texts) { const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) { if (q.width < 1) continue; l = Math.min(l, q.left); t = Math.min(t, q.top); rt = Math.max(rt, q.right); b = Math.max(b, q.bottom); } }
    if (l === Infinity) continue;
    // (1) LEVÁGOTT SZÖVEG: a legközelebbi levágó doboz (overflow: hidden / clip; az elem maga vagy egy őse) kívül hagyja a szöveg egy részét,
    //     és nincs szándékos rövidítés ("…" vagy line-clamp). Görgethető dobozban (auto / scroll) a szöveg odagörgethető, az nem hiba.
    let clipped = '';
    for (let a = el, depth = 0; a && a !== document.body && depth < 8; a = a.parentElement, depth++) {
      const s = a === el ? cs : getComputedStyle(a);
      if ((s.webkitLineClamp && s.webkitLineClamp !== 'none') || s.textOverflow === 'ellipsis') break; // szándékos rövidítés
      const cx = /(hidden|clip)/.test(s.overflowX), cy = /(hidden|clip)/.test(s.overflowY);
      if (/(auto|scroll)/.test(s.overflowX + ' ' + s.overflowY)) break;
      if (!cx && !cy) continue;
      const ar = a.getBoundingClientRect();
      const il = ar.left + parseFloat(s.borderLeftWidth), ir = ar.right - parseFloat(s.borderRightWidth), it = ar.top + parseFloat(s.borderTopWidth), ib = ar.bottom - parseFloat(s.borderBottomWidth);
      if (cx && (l < il - 2 || rt > ir + 2)) clipped = 'széltében (szöveg ' + Math.round(l) + '–' + Math.round(rt) + ', doboz ' + Math.round(il) + '–' + Math.round(ir) + ')';
      else if (cy && (t < it - 3 || b > ib + 3)) clipped = 'magasságban (szöveg ' + Math.round(t) + '–' + Math.round(b) + ', doboz ' + Math.round(it) + '–' + Math.round(ib) + ')';
      if (clipped && a !== el) clipped += ' ← ' + label(a).split(' „')[0];
      break;
    }
    if (clipped) { out.push('LEVÁGOTT SZÖVEG: ' + label(el) + ' ' + clipped); bad.push(el); continue; }
    // (2) SZÖVEG KILÓG A DOBOZÁBÓL: látható dobozú (háttér / keret) elem saját szövege túlnyúlik a dobozon
    //     (ha az elem maga levág és "…"-tal rövidít, a szöveg nem látszik a dobozon kívül: az nem hiba)
    if (boxed(cs) && cs.overflowX === 'visible' && cs.overflowY === 'visible' && (l < r.left - 2 || rt > r.right + 2 || t < r.top - 3 || b > r.bottom + 3)) { out.push('SZÖVEG KILÓG A DOBOZÁBÓL: ' + label(el) + ' (szöveg ' + Math.round(l) + '–' + Math.round(rt) + ', doboz ' + Math.round(r.left) + '–' + Math.round(r.right) + ')'); bad.push(el); }
  }
  window.__textFitBad = bad;
  return out;
}
function markBad() { for (const el of window.__textFitBad || []) el.style.outline = '2px solid #ff2d55'; }
function unmarkBad() { for (const el of window.__textFitBad || []) el.style.outline = ''; }

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  return null;
}
async function startServer() {
  const f = (x) => path.join(tmp, x);
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'),
    KB_CARDFB_FILE: f('cf.json'), KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
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
  const states = [...phases.map((p) => [p, null]), ['prep', 'defendant'], ['prep', 'defender'], ['prep', 'witness'], ['prep', 'judge'], ['prep', 'juror']];
  try {
    for (const [w, h] of SIZES) {
      const tag = w + '×' + h, phone = Math.min(w, h) <= 520;
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, userAgent: phone ? UA_PHONE : undefined, locale: 'hu-HU' });
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); localStorage.setItem('kb_reducedMotion', '1'); } catch (_) { /* */ } });
      const page = await context.newPage();
      const found = [];
      const measure = async (screen) => {
        await page.waitForFunction(() => !document.body.dataset.courtMajor, null, { timeout: 9000 }).catch(() => {});
        await pause(500);
        const a = await page.evaluate(textFit);
        await pause(400);
        const b = new Set(await page.evaluate(textFit)); // csak ami két mérésben is megvan (az átmenetek nem számítanak)
        const lasting = a.filter((x) => b.has(x));
        for (const x of lasting) found.push(screen + ' | ' + x);
        if (lasting.length && SHOTS) { await page.evaluate(markBad); await page.screenshot({ path: path.join(SHOTS, w + 'x' + h + '-' + screen.replace(/[^a-z0-9_-]/gi, '_') + '.png') }); await page.evaluate(unmarkBad); }
      };
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#authGuest'); await pause(400);
      await measure('belépőoldal');
      await page.click('#authGuest'); await page.waitForFunction(() => document.body.dataset.screen === 'name');
      await measure('névválasztó');
      await page.evaluate(() => document.getElementById('btnNewSuspect').click()); await page.fill('#guestName', 'Hosszú Nevű Játékos');
      await page.evaluate(() => document.getElementById('btnGuestGo').click()); await page.waitForFunction(() => document.body.dataset.screen === 'menu');
      await measure('menü');
      await page.evaluate(() => document.getElementById('btnCreate').click()); await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      for (let i = 0; i < 3; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(200); }
      await measure('lobbi');
      await page.evaluate(() => { const b = document.getElementById('btnCustomGame'); if (b) b.click(); });
      await measure('lobbi (egyéni játék)');
      // a játék fázisai a valódi motor állapotaiból (a szoba elhagyva: a szerver nem írja felül)
      await page.evaluate(() => { const b = document.getElementById('btnLeaveLobby'); if (b) b.click(); });
      await page.evaluate(() => { const ok = document.getElementById('cfOk'); if (ok) ok.click(); });
      await pause(400);
      for (const [phase, role] of states) {
        const data = fixture(phase, role);
        await page.evaluate(({ state, myId }) => {
          IDENTITY_READY = true; INTENTIONAL_LEAVE = false; KICKED_FROM_ROOM = true;
          MY.playerId = myId; MY.code = 'QA42'; S = state; serverOffset = 0;
          show('game'); renderGame(); charAnim.start(); startTimerLoop();
        }, data);
        await measure('játék: ' + phase + (role ? ' (' + role + ')' : ''));
      }
      await check(tag + ': a szövegek elférnek a dobozukban (belépés, névválasztó, menü, lobbi, ' + states.length + ' játékállapot)', async () => {
        assert.deepEqual(found, [], '\n    ' + found.join('\n    '));
      });
      await context.close();
    }
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nSzöveg-dobozok: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
