'use strict';
// ============================================================
// KAMU BÍRÓSÁG – esküdt-kérdés a böngészőben (Playwright)
//   - a lobbi beállításai között ott a "Esküdt-kérdés" kapcsoló (alapból ki) és a válaszidő; bekapcsolva a beállítás elmentődik
//   - beszédfázisban a kérdezhető esküdtnek ott a ❓ gomb; a gomb ablakot nyit (kinek + max. 100 karakter + számláló), a hibát kiírja, a MÉGSE bezárja
//   - a beküldés a megfelelő `jury_ask` üzenetet küldi; beküldés után csak a jelzés látszik
//   - a KERESZTKÉRDÉS panel: a kérdések (kérdező, megszólított, szöveg – HTML-escape-elve), a VÁLASZOLTAM gomb csak a megszólítottnak, a felső sávban a cím és az idő
//   - asztali (1366×768) és telefonos (390×844) méreten nincs vízszintes kilógás, a panel és a gombok a képernyőn vannak
// Futtatás: node test/jury-question-ui.js     (böngésző: CHROMIUM_PATH / Edge / Chrome / Playwright Chromium; ha nincs: SKIP, JQUI_REQUIRE=1 esetén hiba)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.JQUI_PORT || 3255), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.JQUI_REQUIRE === '1';
const SHOTS = process.env.JQUI_SHOTS ? path.resolve(process.env.JQUI_SHOTS) : '';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-jqui-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
async function check(name, work) {
  try { await work(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n  ' + (error && error.message || error)); }
}
const NOISE = /favicon|Failed to load resource|AudioContext|kaspersky/i;

async function launch() {
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  return null;
}
async function startServer() {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '',
    AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1', AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'),
    KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json'), KB_CARDFB_FILE: path.join(tmp, 'cf.json'), KB_PACKS_FILE: path.join(tmp, 'p.json'), KB_COURTS_FILE: path.join(tmp, 'c.json'),
    KB_MODERATION_FILE: path.join(tmp, 'm.json'), KB_BUGREPORTS_FILE: path.join(tmp, 'b.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}

const forge = async (page, patch) => {
  await page.evaluate((p) => { window.__S0 = window.__S0 || JSON.parse(JSON.stringify(S)); S = Object.assign(JSON.parse(JSON.stringify(window.__S0)), p); renderGame(); }, patch);
  await pause(250);
};
// a szerepeimet elvesszük (nem vagyok sem ügyész, sem vádlott, sem bíró): esküdt vagyok
const AS_JUROR = { prosecutorId: 'zz1', defendantId: 'zz2', defenderId: null, witnessId: null, currentJudgeId: 'zz3' };
const SPEECH = (qi) => Object.assign({ phase: 'prosecution', phaseEndsAt: Date.now() + 60000, caseNo: 'JQ-1', round: 1, questionInfo: qi }, AS_JUROR); // a valódi beállítások maradnak (a kliens a questionInfo-t nézi)
const BAD_TEXT = '<img src=x onerror="window.__xss=1">Kérdés <b>vastag</b>?';
const JURY = (canAnswer) => Object.assign({ phase: 'jury_question', phaseEndsAt: Date.now() + 40000, caseNo: 'JQ-1', round: 1, questionInfo: { count: 2, asked: false, canAsk: false },
  juryQuestion: { canAnswer, picks: [
    { askerId: 'a1', askerName: 'Anna', to: 'prosecutor', targetId: 'zz1', targetName: 'Ügyész Ede', text: 'Miért pont a lángos volt a tetthely?', done: false },
    { askerId: 'b2', askerName: 'Bela', to: 'defendant', targetId: 'zz2', targetName: 'Vádlott Vera', text: BAD_TEXT, done: true } ] } }, AS_JUROR);
const lastEmit = (page) => page.evaluate(() => window.__emits[window.__emits.length - 1]);

async function startGame(browser, viewport) {
  const mobile = viewport.width < 700;
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'hu-HU' });
  await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* nincs tár */ } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#authGuest'); await page.click('#authGuest');
  await page.waitForFunction(() => document.body.dataset.screen === 'name');
  await page.evaluate(() => document.getElementById('btnNewSuspect').click());
  await page.fill('#guestName', 'Kerdezo ' + viewport.width);
  await page.evaluate(() => document.getElementById('btnGuestGo').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'menu');
  await page.evaluate(() => document.getElementById('btnCreate').click());
  await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
  for (let i = 0; i < 3; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(220); }
  return { context, page, errors };
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  const open = [];
  try {
    for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const tag = vp.width + '×' + vp.height;
      const g = await startGame(browser, vp); open.push(g.context);
      const page = g.page;

      await check('lobbi (' + tag + '): az Esküdt-kérdés kapcsoló és a válaszidő ott van, alapból ki; bekapcsolva elmentődik a beállítás', async () => {
        await page.evaluate(() => document.getElementById('btnCustomGame').click());
        await pause(300);
        assert.equal(await page.evaluate(() => document.getElementById('setJuryQuestions').checked), false, 'alapból ki');
        assert.equal(await page.evaluate(() => +document.getElementById('setQuestionSeconds').value), 20);
        await page.evaluate(() => {
          const c = document.getElementById('setJuryQuestions'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
          const q = document.getElementById('setQuestionSeconds'); q.value = 15; q.dispatchEvent(new Event('input', { bubbles: true }));
          const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
          set('setSpeech', 15); set('setDefender', 15); set('setPrep', 120); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
          const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
          document.getElementById('btnSaveSettings').click();
        });
        await page.waitForFunction(() => S.settings.juryQuestions === true && S.settings.questionSeconds === 15, null, { timeout: 6000 });
        await page.evaluate(() => document.getElementById('btnStartGame').click());
        await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
        await page.waitForFunction(() => S && S.phase === 'accusation', null, { timeout: 15000 });
        await page.evaluate(() => { const b = document.getElementById('iaAccRead'); if (b) b.click(); });
        await page.waitForFunction(() => S.phase === 'prep', null, { timeout: 20000 });
        await page.waitForTimeout(3300);
        // a kovácsolt állapotot a szerver következő üzenete ne írja felül; az elküldött üzenetek gyűjtése
        await page.evaluate(() => { KICKED_FROM_ROOM = true; window.__emits = []; const o = socket.emit.bind(socket); socket.emit = (...a) => { window.__emits.push(a.filter((x) => typeof x !== 'function')); return o(...a); }; });
      });

      await check('beszédfázis (' + tag + '): a kérdezhető esküdtnek ott a ❓ gomb; az ablak nyílik, számol, a hibát kiírja (itt a szerver még a felkészülésben van), a MÉGSE bezárja', async () => {
        await forge(page, SPEECH({ count: 1, asked: false, canAsk: true }));
        assert.equal(await page.locator('#iaAsk').count(), 1, 'van kérdező gomb');
        await page.click('#iaAsk');
        await page.waitForSelector('#juryAskModal.visible');
        assert.match(await page.textContent('#jqToPros'), /AZ ÜGYÉSZNEK/); assert.match(await page.textContent('#jqToDef'), /A VÁDLOTTNAK/);
        assert.equal(await page.isChecked('input[name="jqTo"][value="prosecutor"]'), true, 'alapból az ügyész');
        await page.fill('#jqText', 'Hol voltál valójában?');
        assert.equal((await page.textContent('#jqCount')).trim(), '21 / 100');
        assert.equal(await page.evaluate(() => document.getElementById('jqText').maxLength), 100);
        const box = await page.evaluate(() => { const r = document.querySelector('#juryAskModal .jq-panel').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth }; });
        assert.ok(box.l >= 0 && box.r <= box.vw && box.t >= 0 && box.b <= box.vh, 'az ablak a képernyőn van'); assert.ok(box.over <= 1);
        await page.check('input[name="jqTo"][value="defendant"]');
        await page.click('#jqSend');
        assert.deepEqual(await lastEmit(page), ['jury_ask', { to: 'defendant', text: 'Hol voltál valójában?' }]);
        await page.waitForFunction(() => document.getElementById('jqErr').textContent.length > 0, null, { timeout: 5000 });
        assert.equal(await page.evaluate(() => document.getElementById('juryAskModal').classList.contains('visible')), true, 'hibánál nyitva marad');
        await page.click('#jqCancel');
        assert.equal(await page.evaluate(() => document.getElementById('juryAskModal').classList.contains('visible')), false);
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.click('#iaAsk'); await page.waitForSelector('#juryAskModal.visible'); await page.screenshot({ path: path.join(SHOTS, 'jqui-ask-' + tag + '.png') }); await page.click('#jqCancel'); }
      });

      await check('beküldés után (' + tag + '): nincs gomb, csak a jelzés; ha nem kérdezhet, nincs semmi; a speaker nem kapja meg', async () => {
        await forge(page, SPEECH({ count: 2, asked: true, canAsk: false }));
        assert.equal(await page.locator('#iaAsk').count(), 0);
        assert.match(await page.textContent('.jq-sent'), /A kérdésed beküldve/);
        await forge(page, SPEECH({ count: 2, asked: false, canAsk: false }));
        assert.equal(await page.locator('#iaAsk, .jq-sent').count(), 0);
        await forge(page, Object.assign(SPEECH({ count: 0, asked: false, canAsk: true }), { prosecutorId: await page.evaluate(() => MY.playerId) }));
        assert.equal(await page.locator('#iaAsk').count(), 0, 'az ügyész nem kérdez (neki a VÉGEZTEM gomb van)');
        assert.equal(await page.locator('#iaDone').count(), 1);
        await forge(page, SPEECH(undefined));
        assert.equal(await page.locator('#iaAsk').count(), 0, 'kikapcsolt funkciónál nincs gomb');
      });

      await check('KERESZTKÉRDÉS panel (' + tag + '): a kérdések, a címek, az idő; a szöveg escape-elve; a VÁLASZOLTAM gomb a megszólítottnak működik; elfér, nincs kilógás', async () => {
        await forge(page, JURY(true));
        const info = await page.evaluate(() => {
          const box = document.querySelector('.jq-box'); if (!box) return null;
          const r = box.getBoundingClientRect();
          const btn = document.getElementById('jqDone'), br = btn ? btn.getBoundingClientRect() : null;
          return { items: box.querySelectorAll('.jq-item').length, doneItems: box.querySelectorAll('.jq-item.done').length, text: box.textContent.replace(/\s+/g, ' ').trim(), imgs: box.querySelectorAll('img').length, bolds: box.querySelectorAll('.jq-text b').length,
            xss: window.__xss === 1, title: (document.querySelector('.rb-title') || {}).textContent, time: !!document.getElementById('rbTime'),
            l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, over: document.documentElement.scrollWidth - innerWidth, btn: br ? { l: br.left, r: br.right, t: br.top, b: br.bottom } : null };
        });
        assert.ok(info, 'van .jq-box');
        assert.equal(info.items, 2); assert.equal(info.doneItems, 1);
        assert.match(info.text, /Anna kérdezi az ügyészt \(Ügyész Ede\)/); assert.match(info.text, /Bela kérdezi a vádlottat \(Vádlott Vera\)/);
        assert.match(info.text, /Miért pont a lángos volt a tetthely\?/); assert.match(info.text, /✓ válaszolt/);
        assert.ok(info.text.includes('<img src=x onerror="window.__xss=1">Kérdés <b>vastag</b>?'), 'a szöveg betű szerint látszik');
        assert.equal(info.imgs, 0, 'nem épült be elem a szövegből'); assert.equal(info.bolds, 0); assert.equal(info.xss, false);
        assert.match(info.title || '', /KERESZTKÉRDÉS/); assert.equal(info.time, true, 'a felső sávban van idő');
        assert.ok(info.l >= 0 && info.r <= info.vw && info.over <= 1, 'vízszintesen elfér (' + info.over + ')');
        assert.ok(info.btn && info.btn.l >= 0 && info.btn.r <= info.vw && info.btn.b > 0 && info.btn.t < info.vh, 'a VÁLASZOLTAM gomb a látható sávban');
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'jqui-panel-' + tag + '.png') }); }
        await page.click('#jqDone');
        assert.deepEqual(await lastEmit(page), ['jury_answer_done']);
        await forge(page, JURY(false));
        assert.equal(await page.locator('#jqDone').count(), 0, 'nem megszólítottnak nincs gomb');
        assert.match(await page.textContent('.jq-box'), /Válaszoljatok a Discordon!/);
      });
      await check('nincs oldalhiba / konzolhiba (' + tag + ')', async () => { assert.deepEqual(g.errors, []); });
    }
  } finally {
    for (const c of open) { try { await c.close(); } catch (_) { /* */ } }
    await browser.close();
    server.kill();
  }
  console.log('\nEsküdt-kérdés (böngésző): ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  setTimeout(() => process.exit(failed ? 1 : 0), 400);
})();
