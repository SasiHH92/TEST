'use strict';
// ============================================================
// KAMU BÍRÓSÁG – Google Play áruházi képek a meglévő játék-rajzokból és a valódi játékfelületből (új rajz nélkül)
//   play-assets/feature-graphic-1024x500.jpg   kiemelt grafika (1024×500, JPEG, alfa-csatorna nélkül)
//   play-assets/icon-512.png                    alkalmazásikon (a meglévő assets/icons/icon-512.png másolata)
//   play-assets/phone-0N-*.jpg                  telefonos képernyőképek fekvőben (854×480 CSS-pixel, 2× → 1708×960, 16:9)
// A képernyőképek a valódi játékmotor állapotaiból készülnek (game.js publicState), kitalált nevekkel és a valódi karakterrajzokkal;
// a szerver ideiglenes adatokkal fut (a data/ mappát és az adatbázist nem érinti).
// Futtatás: node scripts/make-play-assets.js     (a betűtípusokhoz internet kell; a renderelést a gépen lévő Edge / Chrome végzi)
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const url = require('url');
const { spawn } = require('child_process');
const { Game } = require('../game');
const { ogHtml } = require('./make-brand-images');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'play-assets');
const PORT = Number(process.env.PLAY_PORT || 3265), BASE = 'http://127.0.0.1:' + PORT;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = [['Bence', 'av01'], ['Lili', 'av02'], ['Ádám', 'av05'], ['Réka', 'av04'], ['Zoli', 'av03'], ['Dóri', 'av06']];

// kiemelt grafika: az og-image elrendezése 1024×500-ra (a szövegek a biztonságos középső sávban)
const featureHtml = () => ogHtml()
  .replace('width: 1200px; height: 630px;', 'width: 1024px; height: 500px;')
  .replace("center bottom / 1760px auto", "center bottom / 1500px auto")
  .replace('.left { position: absolute; left: 60px; top: 54px; width: 640px; }', '.left { position: absolute; left: 52px; top: 40px; width: 560px; }')
  .replace('font: 600 24px Oswald', 'font: 600 19px Oswald')
  .replace('font: 600 132px/0.98 Oswald', 'font: 600 104px/0.98 Oswald')
  .replace('margin-top: 22px; padding: 8px 20px; font: 600 15px Oswald', 'margin-top: 16px; padding: 6px 16px; font: 600 12px Oswald')
  .replace('margin-top: 22px; width: 560px; font: 800 32px/1.22 Inter', 'margin-top: 16px; width: 470px; font: 800 26px/1.22 Inter')
  .replace('.domain { position: absolute; left: 60px; bottom: 34px; font: 600 28px Oswald', '.domain { position: absolute; left: 52px; bottom: 26px; font: 600 22px Oswald')
  .replace('.cast img { position: absolute; bottom: -70px;', '.cast img { position: absolute; bottom: -56px;')
  .replace('.cast .p { left: 560px; height: 560px; }', '.cast .p { left: 520px; height: 440px; }')
  .replace('.cast .d { left: 905px; height: 520px; }', '.cast .d { left: 800px; height: 410px; }')
  .replace('.cast .j { left: 700px; height: 600px; z-index: 2; }', '.cast .j { left: 630px; height: 470px; z-index: 2; }');

// a játék egy pillanatképe a valódi motorból: kitalált nevek, valódi avatárok; me: a néző szerepe
function scene(phase, viewer) {
  const g = new Game('PLAY', { to: () => ({ emit: () => {} }) });
  try {
    NAMES.forEach(([n, av], i) => { g.addPlayer('p' + i, n, av, i === 0); g.players.get('p' + i).isBot = true; }); // bot: nem kerül a statisztikába
    g.startGame({ modes: ['buli'], rounds: 3, autoNextRound: false, autoNewGame: false, juryQuestions: false }, 'p0');
    const d = g.roundData;
    d.caseNo = 'B.2026/' + phase;
    const roles = { prosecutor: d.prosecutorId, defendant: d.defendantId, defender: d.defenderId, witness: d.witnessId, judge: d.currentJudgeId,
      juror: d.voters.find((id) => id !== d.currentJudgeId) || d.currentJudgeId };
    if (phase === 'verdict' || phase === 'game_over') {
      for (const id of d.voters) d.votes[id] = { verdict: 'guilty' };
      g.revealVerdict();
      NAMES.forEach((_, i) => { g.players.get('p' + i).score = [7, 9, 4, 6, 3, 5][i]; });
      if (phase === 'game_over') { g.round = g.settings.rounds; g.nextRound(); }
    } else if (phase !== 'accusation') {
      g.phase = phase; g.phaseEndsAt = Date.now() + 47000;
    }
    const myId = roles[viewer] || 'p0';
    return { state: g.publicState(myId), myId };
  } finally { g.dispose(); }
}

async function launch() {
  const { chromium } = require('playwright-core');
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  throw new Error('Nincs Edge / Chrome a renderelő böngészőnek (CHROMIUM_PATH megadható).');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-play-')), f = (x) => path.join(tmp, x);
  const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', DATABASE_URL: '',
    AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'), KB_CARDFB_FILE: f('cf.json'),
    KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }
  const browser = await launch();
  try {
    // 1) kiemelt grafika
    {
      const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
      const file = path.join(tmp, 'feature.html'); fs.writeFileSync(file, featureHtml());
      await page.goto(url.pathToFileURL(file).href, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
      await page.screenshot({ path: path.join(OUT, 'feature-graphic-1024x500.jpg'), type: 'jpeg', quality: 92 });
      await page.close();
      console.log('KÉSZ play-assets/feature-graphic-1024x500.jpg');
    }
    // 2) ikon
    fs.copyFileSync(path.join(ROOT, 'assets', 'icons', 'icon-512.png'), path.join(OUT, 'icon-512.png'));
    console.log('KÉSZ play-assets/icon-512.png');
    // 3) telefonos képernyőképek (fekvő, 16:9)
    const shots = [
      ['01-szerep', 'accusation', 'judge', 'reveal', false], // TE VAGY A BÍRÓ (szerep-felfedés: a réteg megjelenése után)
      ['02-targyalas', 'prosecution', 'juror', 0, true],     // a terem beszéd közben
      ['03-kartyak', 'prep', 'defendant', 0, true],          // KÁRTYÁIM tálca a felkészülésben
      ['04-szavazas', 'verdict_vote', 'juror', 0, true],     // BŰNÖS / ÁRTATLAN
      ['05-itelet', 'verdict', 'juror', 'verdict', false],  // az ítélet pecsétje (a réteg megjelenése után)
      ['06-gyoztes', 'game_over', 'judge', 2600, false]      // győztes
    ];
    for (const [name, phase, viewer, at, settle] of shots) {
      const context = await browser.newContext({ viewport: { width: 854, height: 480 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'hu-HU' });
      await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
      const page = await context.newPage();
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await page.waitForSelector('#authGuest');
      const data = scene(phase, viewer);
      await page.evaluate(({ state, myId }) => {
        IDENTITY_READY = true; INTENTIONAL_LEAVE = false; KICKED_FROM_ROOM = true;
        MY.playerId = myId; MY.code = 'PLAY'; S = state; serverOffset = 0;
        show('game'); renderGame(); charAnim.start(); startTimerLoop();
      }, data);
      await page.waitForFunction(() => [...document.querySelectorAll('#stage img')].every((i) => i.complete), null, { timeout: 10000 }).catch(() => {}); // csak a színpad képei (az összes kép dekódolása 2×-en túl nagy)
      if (settle) { await page.waitForFunction(() => !document.body.dataset.courtMajor, null, { timeout: 12000 }).catch(() => {}); await pause(1600); }
      else if (typeof at === 'string') { await page.waitForFunction((k) => document.body.dataset.courtMajor === k, at, { timeout: 12000 }).catch(() => {}); await pause(at === 'verdict' ? 1700 : 1100); }
      else await pause(at);
      if (phase === 'prep') { await page.evaluate(() => { const h = document.querySelector('.card-hand'); if (h && h.dataset.state !== 'open') { const t = h.querySelector('.ch-toggle'); if (t) t.click(); } }); await pause(700); }
      await page.screenshot({ path: path.join(OUT, 'phone-' + name + '.jpg'), type: 'jpeg', quality: 90 });
      console.log('KÉSZ play-assets/phone-' + name + '.jpg');
      await context.close();
    }
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
}
if (require.main === module) main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
