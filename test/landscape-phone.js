'use strict';
// ============================================================
// KAMU BÍRÓSÁG – telefon FEKVŐ módban (Android-szerű méretek: 800×360, 844×390, 915×412), Playwright
//   - lebegő gombok (Hibajelentés, Csevegő): csak ikon, nem takarják a tartalmat
//   - névválasztó és lobbi: a "VÁLASZTOM" gombot nem takarja lebegő elem; a lobbi plakátjai tömörek
//   - játék: a beszéd-gomb (VÉGEZTEM), a szavazógombok és az ítélet gombjai a képernyőn vannak; nincs vízszintes kilógás
//   - KÖR VÉGE: legalább 3 pontlista-sor teljesen látszik, a "KÖVETKEZŐ TÁRGYALÁS" gomb a listán kívül, a képernyőn belül van
//   - ponttábla: 900 px alatt jobbról becsúszó oldalfiók (a toggle kicsi, a képernyőn belül; megnyitva ≥ 4 sor + reakciók látszanak; a csevegőben van üzenetlista és beviteli mező); fölötte a jobb oldali sáv
//   - súgó: a szöveg-terület legalább 190 px magas, a lábléc-gomb rejtve, a BEZÁR a képernyőn van
//   - nincs JS-hiba
// Futtatás: node test/landscape-phone.js      (böngésző: CHROMIUM_PATH / Edge / Chrome; ha nincs: SKIP, LAND_REQUIRE=1 esetén hiba;  LAND_SIZES="800x360,915x412"  LAND_SHOTS=<mappa>)
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* hiányzik: lent SKIP */ }

const PORT = Number(process.env.LAND_PORT || 3257), BASE = 'http://127.0.0.1:' + PORT;
const REQUIRE = process.env.LAND_REQUIRE === '1';
const SHOTS = process.env.LAND_SHOTS ? path.resolve(process.env.LAND_SHOTS) : '';
const SIZES = (process.env.LAND_SIZES || '800x360,844x390,915x412').split(',').map((s) => s.trim().split('x').map(Number)).filter((a) => a.length === 2 && a[0] > 0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-land-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
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
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '', MAX_ROOMS_PER_IP: '30', KB_LOBBY_BOTS: '1',
    AUTH_STORE_PATH: path.join(tmp, 'a.json'), KB_AVATARS_FILE: path.join(tmp, 'av.json'), KB_STATS_FILE: path.join(tmp, 's.json'), KB_DMS_FILE: path.join(tmp, 'd.json'), KB_ERRORS_FILE: path.join(tmp, 'e.json'), KB_CARDFB_FILE: path.join(tmp, 'cf.json'),
    KB_PACKS_FILE: path.join(tmp, 'p.json'), KB_COURTS_FILE: path.join(tmp, 'c.json'), KB_MODERATION_FILE: path.join(tmp, 'm.json'), KB_BUGREPORTS_FILE: path.join(tmp, 'b.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) return child; } catch (_) { await pause(100); } }
  child.kill();
  throw new Error('a szerver nem indult el');
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(REQUIRE ? 1 : 0); }
  const browser = await launch();
  if (!browser) { console.log('SKIP: nincs használható böngésző.'); process.exit(REQUIRE ? 1 : 0); }
  let server;
  try { server = await startServer(); } catch (e) { console.error('FAIL: ' + e.message); await browser.close(); process.exit(1); }
  try {
    for (const [w, h] of SIZES) {
      const tag = w + '×' + h;
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA, locale: 'hu-HU' });
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); } catch (_) { /* */ } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text()); });
      const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'land-' + tag + '-' + name + '.png') }); } };
      const calm = () => page.waitForFunction(() => !document.body.dataset.courtMajor, null, { timeout: 8000 }).catch(() => {}).then(() => pause(350));

      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#authGuest'); await page.click('#authGuest');
      await page.waitForFunction(() => document.body.dataset.screen === 'name');
      await pause(500);

      await check('névválasztó (' + tag + '): a lebegő gombok csak ikonok, és nem takarják a VÁLASZTOM gombot', async () => {
        const info = await page.evaluate(() => {
          const bug = document.querySelector('.bug-fab'), chat = document.getElementById('chatFab');
          const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), vis: b.width > 0 && getComputedStyle(e).display !== 'none' }; };
          const pick = [...document.querySelectorAll('.mug-pick')].filter((e) => e.offsetParent !== null);
          // az első kártya VÁLASZTOM gombja: a középpontjában a gomb (vagy a leszármazottja) legyen felül, ne egy lebegő elem
          const first = pick[0]; if (first) first.scrollIntoView({ block: 'center' });
          let covered = null;
          if (first) { const b = first.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); covered = !(top && (top === first || first.contains(top) || top.contains(first))); }
          return { bug: r(bug), chat: r(chat), picks: pick.length, covered, overX: document.documentElement.scrollWidth - innerWidth };
        });
        if (info.bug && info.bug.vis) assert.ok(info.bug.w <= 46 && info.bug.h <= 46, 'a Hibajelentés gomb csak ikon: ' + JSON.stringify(info.bug));
        if (info.chat && info.chat.vis) assert.ok(info.chat.w <= 60, 'a Csevegő gomb csak ikon: ' + JSON.stringify(info.chat));
        assert.ok(info.picks >= 1, 'vannak választható kártyák');
        assert.equal(info.covered, false, 'a VÁLASZTOM gombot nem takarja lebegő elem');
        assert.ok(info.overX <= 1, 'nincs vízszintes kilógás (' + info.overX + ')');
        await shot('nevvalaszto');
      });

      await page.evaluate(() => document.getElementById('btnNewSuspect').click());
      await page.fill('#guestName', 'Fekvo ' + w);
      await page.evaluate(() => document.getElementById('btnGuestGo').click());
      await page.waitForFunction(() => document.body.dataset.screen === 'menu');
      await page.evaluate(() => document.getElementById('btnCreate').click());
      await page.waitForFunction(() => document.body.dataset.screen === 'lobby');
      for (let i = 0; i < 3; i++) { await page.evaluate(() => document.getElementById('btnAddBot').click()); await pause(220); }
      await pause(500);

      await check('lobbi (' + tag + '): a plakátok tömörek (legalább 3 egy sorban), a nevek nem törnek, nincs vízszintes kilógás', async () => {
        const info = await page.evaluate(() => {
          // offsetWidth / offsetHeight: az elforgatás (a plakátok döntve vannak) nélküli, tényleges méret
          const ps = [...document.querySelectorAll('.poster')].filter((e) => e.offsetParent !== null).map((e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top + scrollY), w: e.offsetWidth, h: e.offsetHeight }; });
          const names = [...document.querySelectorAll('.poster .p-name')].map((e) => ({ t: e.textContent.trim(), lines: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || 20)) }));
          const firstRow = ps.filter((p) => Math.abs(p.top - ps[0].top) < 60).length;
          return { n: ps.length, firstRow, maxW: Math.max(...ps.map((p) => p.w)), h: Math.max(...ps.map((p) => p.h)), names, overX: document.documentElement.scrollWidth - innerWidth };
        });
        assert.ok(info.n >= 4, 'négy plakát: ' + info.n);
        assert.ok(info.firstRow >= 3, 'legalább 3 plakát egy sorban: ' + info.firstRow);
        assert.ok(info.maxW <= 200, 'a plakát keskeny (' + info.maxW + ')');
        assert.ok(info.h <= 300, 'a plakát nem magasabb, mint ' + info.h);
        assert.ok(info.names.every((n) => n.lines <= 2), 'a nevek legfeljebb két sorosak: ' + JSON.stringify(info.names));
        assert.ok(info.overX <= 1);
        await shot('lobbi');
      });

      await page.evaluate(() => {
        document.getElementById('btnCustomGame').click();
        const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); };
        set('setSpeech', 15); set('setDefender', 15); set('setPrep', 120); set('setWitness', 10); set('setClosing', 10); set('setRounds', 1);
        const m = document.querySelector('#modeGrid .case-tab[data-mode]'); if (m && !m.classList.contains('active-case')) m.click();
        document.getElementById('btnSaveSettings').click();
      });
      await page.waitForFunction(() => S.settings.prepSeconds === 120, null, { timeout: 6000 });
      await page.evaluate(() => document.getElementById('btnStartGame').click());
      await page.waitForFunction(() => document.body.dataset.screen === 'game', null, { timeout: 20000 });
      await page.waitForFunction(() => S && S.phase === 'accusation', null, { timeout: 15000 });
      await page.evaluate(() => { const b = document.getElementById('iaAccRead'); if (b) b.click(); });
      await page.waitForFunction(() => S.phase === 'prep', null, { timeout: 20000 });
      await pause(3400);
      await page.evaluate(() => { KICKED_FROM_ROOM = true; });
      const me = await page.evaluate(() => MY.playerId);
      const others = await page.evaluate(() => S.players.filter((p) => p.id !== MY.playerId).map((p) => p.id));
      const forge = async (patch) => { await page.evaluate((p) => { window.__S0 = window.__S0 || JSON.parse(JSON.stringify(S)); S = Object.assign(JSON.parse(JSON.stringify(window.__S0)), p); renderGame(); }, patch); await calm(); };
      const base = () => ({ phaseEndsAt: Date.now() + 45000, caseNo: 'FK-1', round: 1 });
      const inView = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, vw: innerWidth, vh: innerHeight, ok: b.left >= -1 && b.right <= innerWidth + 1 && b.top >= -1 && b.bottom <= innerHeight + 1 }; }, sel);

      await check('beszéd és szavazás (' + tag + '): a VÉGEZTEM, a BŰNÖS / ÁRTATLAN gombok és az ítélet gombjai a képernyőn vannak; nincs vízszintes kilógás', async () => {
        await forge({ ...base(), phase: 'prosecution', prosecutorId: me, defendantId: others[0], defenderId: null, witnessId: null, currentJudgeId: others[1] });
        let v = await inView('#iaDone'); assert.ok(v && v.ok, 'VÉGEZTEM: ' + JSON.stringify(v));
        await forge({ ...base(), phase: 'verdict_vote', prosecutorId: others[0], defendantId: others[1], defenderId: null, witnessId: null, currentJudgeId: others[2], verdictVote: { canVote: true, myVote: null, votedCount: 1, voterCount: 3 } });
        for (const s of ['#voteGuilty', '#voteNotGuilty']) { v = await inView(s); assert.ok(v && v.ok, s + ': ' + JSON.stringify(v)); }
        await shot('szavazas');
        await forge({ ...base(), phase: 'verdict', prosecutorId: others[0], defendantId: others[1], defenderId: null, witnessId: null, currentJudgeId: others[2],
          verdict: { guilty: true, unanimous: false, sentence: 'Egy hétig "Szellemvadász" a Discord-neve, és minden üzenetét BUUU-val kell kezdenie.', votes: [{ voterId: others[0], voterName: 'Géza', verdict: 'guilty' }], challengeResults: [] } });
        await pause(3200);
        v = await inView('#btnProceed'); assert.ok(v && v.ok, 'TOVÁBB: ' + JSON.stringify(v));
        await shot('itelet');
        assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'nincs vízszintes kilógás');
      });

      await check('KÖR VÉGE (' + tag + '): legalább 3 sor teljesen látszik, a következő gomb a listán kívül és a képernyőn belül van', async () => {
        await forge({ ...base(), phase: 'round_results', prosecutorId: others[0], defendantId: others[1], scoreEvents: [],
          roundResults: { scores: [{ id: me, name: 'Fekvő', avatar: '', score: 3 }, { id: others[0], name: 'Géza', avatar: '', score: 2 }, { id: others[1], name: 'Robi', avatar: '', score: 1 }, { id: others[2], name: 'Sári', avatar: '', score: 0 }], favorite: null, hasNextRound: true } });
        await pause(2800);
        const info = await page.evaluate(() => {
          const list = document.querySelector('.results-scroll'), lr = list.getBoundingClientRect();
          const rows = [...document.querySelectorAll('.rr-row')].map((e) => e.getBoundingClientRect());
          const fullyVisible = rows.filter((b) => b.top >= lr.top - 1 && b.bottom <= lr.bottom + 1).length;
          const btn = document.querySelector('#btnNextRound'), br = btn ? btn.getBoundingClientRect() : null;
          return { rows: rows.length, fullyVisible, listBottom: lr.bottom, btn: br && { t: br.top, b: br.bottom, l: br.left, r: br.right }, vh: innerHeight, vw: innerWidth };
        });
        assert.ok(info.fullyVisible >= 3, 'legalább 3 teljesen látható sor (' + info.fullyVisible + ' / ' + info.rows + ')');
        assert.ok(info.btn && info.btn.b <= info.vh + 1 && info.btn.l >= 0 && info.btn.r <= info.vw + 1, 'a gomb a képernyőn belül van: ' + JSON.stringify(info.btn));
        assert.ok(info.btn.t >= info.listBottom - 2, 'a gomb nem takarja a listát (gomb teteje ' + Math.round(info.btn.t) + ', lista alja ' + Math.round(info.listBottom) + ')');
        await shot('kor-vege');
      });

      await check('ponttábla és csevegő (' + tag + '): ' + (w <= 900 ? 'oldalfiók kis fogóval; megnyitva ≥ 4 sor + reakciók; a csevegőben üzenetlista és beviteli mező' : 'jobb oldali sáv: ≥ 4 sor + reakciók'), async () => {
        const railMode = w > 900;
        if (!railMode) {
          const t = await page.evaluate(() => { const b = document.getElementById('sbToggle').getBoundingClientRect(); return { w: b.width, h: b.height, l: b.left, r: b.right, vw: innerWidth }; });
          assert.ok(t.w <= 46 && t.l >= 0 && t.r <= t.vw + 1, 'a fogó kicsi és a képernyőn belül van: ' + JSON.stringify(t));
          await page.evaluate(() => document.getElementById('sbToggle').click());
          await pause(450);
        }
        const rows = await page.evaluate(() => {
          const box = document.getElementById('sbRows'), br = box.getBoundingClientRect();
          const rs = [...box.querySelectorAll('.score-row, .sb-row')].map((e) => e.getBoundingClientRect());
          const fully = rs.filter((b) => b.top >= br.top - 1 && b.bottom <= br.bottom + 1).length;
          const react = [...document.querySelectorAll('.react-btn')].map((e) => e.getBoundingClientRect());
          return { fully, total: rs.length, reactOk: react.length === 5 && react.every((b) => b.bottom <= innerHeight + 1 && b.top >= 0), vh: innerHeight, boxH: br.height };
        });
        assert.ok(rows.fully >= 4 || rows.fully >= rows.total, 'legalább 4 sor látszik (' + rows.fully + ' / ' + rows.total + ')');
        assert.ok(rows.reactOk, 'az 5 reakciógomb a képernyőn van');
        await shot('ponttabla');
        await page.evaluate(() => document.getElementById('sbTabChat').click()); await pause(500);
        const chat = await page.evaluate(() => {
          const list = document.querySelector('#sbChatSlot .chat-list, #sbChatSlot [class*="msgs"], #sbChatSlot [class*="log"]'), inp = document.querySelector('#sbChatSlot input[type="text"], #sbChatSlot input:not([type]), #sbChatSlot textarea');
          const lr = list ? list.getBoundingClientRect() : null, ir = inp ? inp.getBoundingClientRect() : null;
          return { listH: lr ? lr.height : 0, inp: ir && { b: ir.bottom, t: ir.top, vh: innerHeight } };
        });
        assert.ok(chat.listH >= 50, 'a csevegőben van üzenetlista (' + Math.round(chat.listH) + ' px)');
        assert.ok(chat.inp && chat.inp.t >= 0 && chat.inp.b <= chat.inp.vh + 1, 'a beviteli mező a képernyőn van');
        await shot('csevego');
        await page.evaluate(() => { document.getElementById('sbTabScores').click(); if (document.getElementById('scoreSidebar').classList.contains('open')) document.getElementById('sbToggle').click(); });
        await pause(400);
      });

      await check('súgó (' + tag + '): a szöveg-terület legalább 190 px, a lábléc-gomb rejtve, a BEZÁR a képernyőn van', async () => {
        await page.evaluate(() => document.querySelector('#screen-game [data-help]').click());
        await page.waitForFunction(() => { const m = document.getElementById('helpModal'); return m && !m.classList.contains('hidden'); });
        await pause(300);
        const info = await page.evaluate(() => {
          const body = document.getElementById('helpBody').getBoundingClientRect(), foot = document.querySelector('.help-foot'), close = document.getElementById('helpClose').getBoundingClientRect(), panel = document.querySelector('.help-panel').getBoundingClientRect();
          return { bodyH: body.height, footVisible: foot && getComputedStyle(foot).display !== 'none', close: { t: close.top, b: close.bottom, r: close.right }, panelB: panel.bottom, panelT: panel.top, vh: innerHeight, vw: innerWidth };
        });
        assert.ok(info.bodyH >= 190, 'a szöveg-terület magassága ' + Math.round(info.bodyH) + ' px');
        assert.equal(info.footVisible, false, 'a lábléc rejtve');
        assert.ok(info.close.t >= 0 && info.close.b <= info.vh && info.close.r <= info.vw, 'a BEZÁR a képernyőn van');
        assert.ok(info.panelT >= -1 && info.panelB <= info.vh + 1, 'a panel nem lóg ki');
        await shot('sugo');
        await page.evaluate(() => document.getElementById('helpClose').click());
      });

      await check('fedvények és kártyák (' + tag + '): a szerep-felfedés, a bevezető, a kihívás és a bizonyíték a felső sáv alatt, a képernyőn belül marad; a pakli a fedvény alatt elbújik; a nyitott tálca alacsony, a kártyák olvashatók', async () => {
        const seen = {};
        const measure = () => page.evaluate(() => {
          const kind = document.body.dataset.courtMajor || '';
          const sel = { reveal: '#courtReveal .rv-stage', intro: '.court-intro-card', challenge: '.challenge-card', evidence: '.evidence-folder' }[kind];
          const e = sel && document.querySelector(sel);
          const hand = document.querySelector('.card-hand');
          const r = e ? e.getBoundingClientRect() : null;
          return { kind, r: r && { l: r.left, r: r.right, t: r.top, b: r.bottom }, vw: innerWidth, vh: innerHeight, handHidden: hand ? getComputedStyle(hand).visibility === 'hidden' : null, title: kind === 'reveal' ? (() => { const t = document.querySelector('#courtReveal .rv-title'); if (!t) return null; const b = t.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; })() : null };
        });
        const ev = ['A kamion értékszámlálója, ami 0 dollárt mutat.', 'Egy proximity chat felvétel a vádlott sikolyáról.', 'Egy darabokra tört zongora a folyosón.'];
        const cn = 'OV-' + w + '-' + Date.now() % 100000;
        await page.evaluate(() => { window.__S0 = null; });
        const gen = { prosecutorId: me, defendantId: others[0], defenderId: null, witnessId: null, currentJudgeId: others[1], caseNo: cn, round: 1, evidence: ev, myChallenge: 'Beszélj úgy, mint egy robot, amelynek az akkumulátora lassan lemerül.' };
        await page.evaluate((p) => { window.__S0 = JSON.parse(JSON.stringify(S)); S = Object.assign(JSON.parse(JSON.stringify(window.__S0)), p); renderGame(); }, { ...gen, phase: 'accusation', phaseEndsAt: Date.now() + 60000, accusationText: 'Megetette a kacsát a csapat uzsonnájával, aztán rájuk uszította, és még a számlát is rájuk hagyta.' });
        const t0 = Date.now(); let switched = false;
        while (Date.now() - t0 < 16000) {
          const m = await measure();
          if (m.kind && m.r && !seen[m.kind]) { seen[m.kind] = m; }
          if (!switched && Date.now() - t0 > 6500) { switched = true; await page.evaluate((p) => { S = Object.assign(JSON.parse(JSON.stringify(window.__S0)), p); renderGame(); }, { ...gen, phase: 'prep', phaseEndsAt: Date.now() + 60000 }); }
          await pause(120);
        }
        assert.ok(seen.intro, 'a bevezető kártya megjelent');
        for (const [kind, m] of Object.entries(seen)) {
          const tol = 8;
          assert.ok(m.r.l >= -tol && m.r.r <= m.vw + tol, kind + ': vízszintesen a képernyőn belül (' + Math.round(m.r.l) + '–' + Math.round(m.r.r) + ' / ' + m.vw + ')');
          assert.ok(m.r.b <= m.vh + tol, kind + ': nem lóg ki alul (' + Math.round(m.r.b) + ' / ' + m.vh + ')');
          if (kind !== 'reveal') assert.ok(m.r.t >= 38, kind + ': a felső sáv alatt kezdődik (' + Math.round(m.r.t) + ')');
          assert.equal(m.handHidden, true, kind + ': a KÁRTYÁIM pakli a fedvény alatt elbújik');
        }
        if (seen.reveal && seen.reveal.title) assert.ok(seen.reveal.title.l >= -2 && seen.reveal.title.r <= seen.reveal.vw + 2, 'a szerep-felirat elfér vízszintesen');
        // a nyitott tálca (a fedvények lecsengése után)
        await page.waitForFunction(() => !document.body.dataset.courtMajor, null, { timeout: 15000 }).catch(() => {});
        await pause(500);
        const tray = await page.evaluate(() => {
          const hand = document.querySelector('.card-hand'); if (!hand || hand.classList.contains('hidden')) return null;
          if (hand.dataset.state !== 'open') { const t = hand.querySelector('.ch-toggle'); if (t) t.click(); }
          return true;
        });
        await pause(500);
        if (tray) {
          const g = await page.evaluate(() => {
            const hand = document.querySelector('.card-hand'), hb = hand.getBoundingClientRect();
            const cards = [...hand.querySelectorAll('.court-card')].filter((c) => c.offsetParent !== null).map((c) => { const b = c.getBoundingClientRect(); return { w: b.width, h: b.height, l: b.left, r: b.right, b: b.bottom }; });
            return { open: hand.dataset.state, h: hb.height, b: hb.bottom, vh: innerHeight, vw: innerWidth, cards };
          });
          assert.equal(g.open, 'open');
          assert.ok(g.h <= 140 && g.b <= g.vh + 1, 'a nyitott tálca legfeljebb 140 px magas és a képernyőn belül van (' + Math.round(g.h) + ')');
          assert.ok(g.cards.length >= 3 && g.cards.every((c) => c.w >= 110 && c.h >= 90), 'a kártyák legalább 110×90 px-esek: ' + JSON.stringify(g.cards.slice(0, 2)));
          await shot('kartyatalca');
          await page.evaluate(() => { const t = document.querySelector('.card-hand .ch-toggle'); if (t && document.querySelector('.card-hand').dataset.state === 'open') t.click(); });
        }
      });

      await check('biztonsági terület (' + tag + '): kameralyuk szimulálva (48 px bal / jobb) a HUD és a pakli nem lóg a sávba; a háttér sötét', async () => {
        await page.evaluate(() => { document.documentElement.style.setProperty('--force-safe-l', '48px'); document.documentElement.style.setProperty('--force-safe-r', '48px'); });
        await forge({ ...base(), phase: 'defense', prosecutorId: others[0], defendantId: others[1], defenderId: null, witnessId: null, currentJudgeId: others[2] });
        await pause(300);
        const info = await page.evaluate(() => {
          const L = (s) => { const e = document.querySelector(s); if (!e || e.offsetParent === null) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; };
          return { bar: L('#screen-game .info-bar'), banner: L('#roleBanner'), vw: innerWidth, htmlBg: getComputedStyle(document.documentElement).backgroundColor };
        });
        if (info.bar) assert.ok(info.bar.l >= 46 && info.bar.r <= info.vw - 46, 'a felső sáv a biztonsági területen belül van: ' + JSON.stringify(info.bar));
        if (info.banner) assert.ok(info.banner.l >= 46 && info.banner.r <= info.vw - 46, 'a fázis-sáv a biztonsági területen belül van: ' + JSON.stringify(info.banner));
        assert.notEqual(info.htmlBg, 'rgb(255, 255, 255)', 'a html háttere nem fehér (' + info.htmlBg + ')');
        await page.evaluate(() => { document.documentElement.style.removeProperty('--force-safe-l'); document.documentElement.style.removeProperty('--force-safe-r'); });
      });

      await check('nincs oldalhiba / konzolhiba (' + tag + ')', async () => { assert.deepEqual(errors, []); });
      await context.close();
    }
  } finally { await browser.close(); server.kill(); }
  console.log('\nTelefon fekvő módban: ' + passed + ' sikeres, ' + failed + ' hibás teszt.');
  setTimeout(() => process.exit(failed ? 1 : 0), 400);
})();
