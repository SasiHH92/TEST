'use strict';

// ============================================================
// KAMU BÍRÓSÁG – megosztási előnézeti kép (Discord / Messenger link-előnézet) és alkalmazás-ikonok
//
// A meglévő játék-rajzokból (terem-háttér + a szerep-karakterek átlátszó képei) állítja elő, nem új rajzot készít:
//   assets/og-image.jpg                     1200×630, a link-előnézet képe (og:image)
//   assets/icons/icon-192.png, icon-512.png "Hozzáadás a kezdőképernyőhöz" ikon (manifest)
//   assets/icons/icon-maskable-512.png      kitöltött ikon az Android kerek/lekerekített maszkjához (a lényeg a biztonságos zónában)
//   assets/icons/apple-touch-icon.png       180×180, iOS kezdőképernyő
//   assets/icons/favicon-32.png             böngészőfül
//
// Futtatás:  node scripts/make-brand-images.js      (a betűtípusokat – Oswald, Inter – a Google Fontsról tölti: internet kell, egyszer)
// A renderelést a gépen lévő Edge / Chrome végzi (playwright-core). Kimenet: ugyanazok a fájlnevek, felülírja a meglévőt.
// Ha az og-image.jpg megváltozik, az index.html-ben a "?v=" számot is emeld (a Discord és a böngésző címenként gyorsítótáraz).
// ============================================================

const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const A = (p) => url.pathToFileURL(path.join(ROOT, 'assets', p)).href;
const OUT_ICONS = path.join(ROOT, 'assets', 'icons');
const GOLD = '#f2c14e', WINE = '#7b1b2b', DARK = '#2a0b14';
const FONTS = '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&family=Oswald:wght@500;600&display=swap" rel="stylesheet">';

const ogHtml = () => `<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; position: relative; overflow: hidden; background: #120a06; font-family: Inter, sans-serif; }
  .bg { position: absolute; inset: 0; background: url('${A('terem-hatter.webp')}') center bottom / 1760px auto no-repeat; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(10,6,4,.92) 0%, rgba(10,6,4,.78) 46%, rgba(10,6,4,.18) 100%); }
  .left { position: absolute; left: 60px; top: 54px; width: 640px; }
  .eyebrow { font: 600 24px Oswald, sans-serif; letter-spacing: 6px; color: ${GOLD}; opacity: .9; }
  .title { margin: 8px 0 0; font: 600 132px/0.98 Oswald, sans-serif; letter-spacing: 5px; color: ${GOLD}; text-shadow: 0 6px 0 #6b3e0a, 0 14px 34px rgba(0,0,0,.7); }
  .ribbon { display: inline-block; margin-top: 22px; padding: 8px 20px; font: 600 15px Oswald, sans-serif; letter-spacing: 2.6px; white-space: nowrap; color: #fff; background: repeating-linear-gradient(135deg, #c8333f 0 16px, #8c1f2c 16px 32px); border-radius: 4px; box-shadow: 0 4px 14px rgba(0,0,0,.5); }
  .slogan { margin-top: 22px; width: 560px; font: 800 32px/1.22 Inter, sans-serif; color: #fff; text-shadow: 0 3px 14px rgba(0,0,0,.8); }
  .slogan b { color: ${GOLD}; }
  .domain { position: absolute; left: 60px; bottom: 34px; font: 600 28px Oswald, sans-serif; letter-spacing: 3px; color: #ffe3a5; }
  .cast img { position: absolute; bottom: -70px; filter: drop-shadow(0 10px 22px rgba(0,0,0,.65)); }
  .cast .p { left: 560px; height: 560px; }
  .cast .d { left: 905px; height: 520px; }
  .cast .j { left: 700px; height: 600px; z-index: 2; }
</style></head><body>
  <div class="bg"></div><div class="shade"></div>
  <div class="left">
    <div class="eyebrow">A TÁRGYALÓTEREM AJTAJA NYITVA</div>
    <h1 class="title">KAMU<br>BÍRÓSÁG</h1>
    <div class="ribbon">RENDŐRSÉGI NYILVÁNTARTÁS • KIZÁRÓLAG BÜNTETETLEN POÉNOK</div>
    <div class="slogan">Online party játék: <b>vádolj, védekezz, nevess!</b></div>
  </div>
  <div class="cast">
    <img class="p" src="${A('roles/avatar_04_prosecutor.webp')}" alt="">
    <img class="d" src="${A('roles/avatar_05_defendant.webp')}" alt="">
    <img class="j" src="${A('roles/avatar_06_judge.webp')}" alt="">
  </div>
  <div class="domain">KAMUBIROSAG.COM</div>
</body></html>`;

// Ikon: bordó sugaras háttér, a bíró (kabala) a közepén. maskable = kitöltött háttér, a karakter a középső ~76%-ban (Android maszk biztonságos zónája);
// kör nélküli, teljes felületű ikon az iOS-nek is (az iOS maga kerekít).
const iconHtml = (size, { ring }) => {
  const disc = ring ? size * 0.9 : size * 0.78;           // a karakter-korong átmérője
  const border = Math.max(2, Math.round(size * 0.022));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: ${size}px; height: ${size}px; position: relative; overflow: hidden; background: radial-gradient(circle at 50% 34%, #b02a42 0%, ${WINE} 46%, ${DARK} 100%); }
    .disc { position: absolute; left: 50%; top: 50%; width: ${disc}px; height: ${disc}px; transform: translate(-50%, -50%); border-radius: 50%; overflow: hidden; border: ${border}px solid ${GOLD};
      background: radial-gradient(circle at 50% 30%, #c4455a 0%, #8a2133 55%, #3a0f1a 100%); }
    .disc img { position: absolute; left: 50%; bottom: -${disc * 0.06}px; height: ${disc * 1.08}px; transform: translateX(-50%); }
  </style></head><body><div class="disc"><img src="${A('roles/avatar_06_judge.webp')}" alt=""></div></body></html>`;
};

async function launch() {
  const { chromium } = require('playwright-core');
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  for (const o of attempts) { try { return await chromium.launch({ headless: true, ...o }); } catch (_) { /* a következő */ } }
  throw new Error('Nincs Edge / Chrome a renderelő böngészőnek (CHROMIUM_PATH megadható).');
}

async function render(browser, html, w, h, file, { type = 'png', quality = 88, fonts = false } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  try {
    const tmp = path.join(require('os').tmpdir(), 'kamu-brand-' + process.pid + '-' + path.basename(file) + '.html');
    fs.writeFileSync(tmp, html);
    await page.goto(url.pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
    if (fonts) {
      await page.evaluate(() => document.fonts.ready);
      const ok = await page.evaluate(() => document.fonts.check('600 40px Oswald') && document.fonts.check('800 40px Inter'));
      if (!ok) throw new Error('A betűtípusok (Oswald, Inter) nem töltődtek be: internet kell a Google Fontshoz.');
    }
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, type, ...(type === 'jpeg' ? { quality } : {}), clip: { x: 0, y: 0, width: w, height: h } });
    fs.unlinkSync(tmp);
    console.log('KÉSZ ' + path.relative(ROOT, file) + '  (' + Math.round(fs.statSync(file).size / 1024) + ' KB)');
  } finally { await page.close(); }
}

async function main() {
  const browser = await launch();
  try {
    await render(browser, ogHtml(), 1200, 630, path.join(ROOT, 'assets', 'og-image.jpg'), { type: 'jpeg', quality: 86, fonts: true });
    await render(browser, iconHtml(512, { ring: true }), 512, 512, path.join(OUT_ICONS, 'icon-512.png'));
    await render(browser, iconHtml(192, { ring: true }), 192, 192, path.join(OUT_ICONS, 'icon-192.png'));
    await render(browser, iconHtml(512, { ring: false }), 512, 512, path.join(OUT_ICONS, 'icon-maskable-512.png'));
    await render(browser, iconHtml(180, { ring: false }), 180, 180, path.join(OUT_ICONS, 'apple-touch-icon.png'));
    await render(browser, iconHtml(32, { ring: true }), 32, 32, path.join(OUT_ICONS, 'favicon-32.png'));
  } finally { await browser.close(); }
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { ogHtml, iconHtml };
