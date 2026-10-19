'use strict';
// ============================================================
// KAMU BÍRÓSÁG – SAJÁT PROFIL, "bűnügyi akta" (client.js renderProfileStats, profile.css, badges.js profileHtml / next)
//  A) a számok a statisztikából (a számláló a végértéken áll meg), a pecsét a priusz szerint (büntetlen / büntetett / új)
//  B) 5 szerep-kártya képpel (a saját avatár szerep-képe, ennek hiányában az alapfigura), a 0-s szerep halvány; ítélet-mérleg
//  C) jelvények: érmék haladással, "Következő" sáv; a műveleti gombok (Bolt, Küldetések, Barátok, Ranglista) megnyílnak
//  D) gépen, álló és fekvő telefonon: nincs kilógó elem, egymásra futó szöveg, vízszintes görgetés; nincs JS-hiba
// Futtatás: node test/profile-dash.js
// ============================================================
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright-core')); } catch (_) { /* lent SKIP */ }
const PORT = Number(process.env.PROFILE_PORT || 3276), BASE = 'http://127.0.0.1:' + PORT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kamu-profile-'));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, failed = 0;
const check = async (name, work) => { try { await work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };
const zero = { vadlott: 0, bunos: 0, artatlan: 0, dijak: 0, jatek: 0, gyozelem: 0, pont: 0, korok: 0, ugyesz: 0, ugyeszSiker: 0, vedo: 0, vedoSiker: 0, biro: 0, tanu: 0, kihivas: 0 };
const USERS = {
  'Akta Aladár': { ...zero, jatek: 14, gyozelem: 6, korok: 41, pont: 160, vadlott: 8, bunos: 3, artatlan: 5, ugyesz: 6, ugyeszSiker: 5, vedo: 4, vedoSiker: 2, biro: 9, tanu: 0, dijak: 3, kihivas: 6 },
  'Tiszta Teréz': { ...zero, jatek: 4, korok: 10, vadlott: 1, artatlan: 1, ugyesz: 1, vedo: 1, biro: 3, tanu: 2 }
};
const PW = 'Csak helyi tesztjelszo 123!';
const mail = (u) => (u.startsWith('Akta') ? 'aladar' : 'terez') + '@example.invalid';

// a profil-akta mérése: kilógás, egymásra futó szövegek, vízszintes görgetés
function auditDash() {
  const out = [], box = document.querySelector('#profileStats'), vw = document.documentElement.clientWidth;
  for (const el of box.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    if (r.right > vw + 1 || r.left < -1) out.push('kilóg: ' + el.className);
  }
  const texts = [...box.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && el.getBoundingClientRect().width);
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const x = texts[i], y = texts[j]; if (x.contains(y) || y.contains(x)) continue;
    const a = x.getBoundingClientRect(), b = y.getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) out.push('átfed: „' + x.textContent.trim().slice(0, 24) + '” × „' + y.textContent.trim().slice(0, 24) + '”');
  }
  if (document.documentElement.scrollWidth > vw + 1) out.push('vízszintes görgetés');
  return out;
}

(async () => {
  if (!chromium) { console.log('SKIP: a playwright-core nincs telepítve.'); process.exit(0); }
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH }] : [{ channel: 'msedge' }, { channel: 'chrome' }, {}];
  let browser = null; for (const o of attempts) { try { browser = await chromium.launch({ headless: true, ...o }); break; } catch (_) { /* */ } }
  if (!browser) { console.log('SKIP: nincs böngésző.'); process.exit(0); }
  const f = (x) => path.join(tmp, x);
  fs.writeFileSync(f('s.json'), JSON.stringify(USERS));
  const server = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), stdio: 'ignore', env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DISCORD_BOT_TOKEN: '', RENDER: '', AUTH_BASE_URL: BASE, DATABASE_URL: '',
    AUTH_STORE_PATH: f('a.json'), KB_AVATARS_FILE: f('av.json'), KB_STATS_FILE: f('s.json'), KB_DMS_FILE: f('d.json'), KB_ERRORS_FILE: f('e.json'), KB_CARDFB_FILE: f('cf.json'),
    KB_PACKS_FILE: f('p.json'), KB_COURTS_FILE: f('c.json'), KB_MODERATION_FILE: f('m.json'), KB_BUGREPORTS_FILE: f('b.json') } });
  const errors = [];
  const open = async (user, viewport, mobile, extra) => {
    const context = await browser.newContext({ viewport, isMobile: !!mobile, hasTouch: !!mobile, locale: 'hu-HU', ...(extra || {}) });
    await context.addInitScript(() => { try { localStorage.setItem('kb_helpSeen', '1'); localStorage.setItem('kb_introSeen', '1'); } catch (_) { /* */ } });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.fill('#authLoginEmail', mail(user)); await page.fill('#authLoginPassword', PW);
    await page.locator('#authLoginEmail').evaluate((el) => el.closest('form').requestSubmit());
    await page.waitForSelector('#profileStats .pd-role', { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('#profileStats.pd-anim'), null, { timeout: 8000 });
    return { context, page };
  };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (_) { /* */ } await pause(150); }
    for (const u of Object.keys(USERS)) {
      const st = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ username: u, email: mail(u), password: PW, confirmPassword: PW }) }).then((r) => r.status);
      assert.equal(st, 201, 'regisztráció: ' + u);
    }
    const { context, page } = await open('Akta Aladár', { width: 1366, height: 768 });
    await check('A) a számok a statisztikából, a számláló a végértéken áll; büntetett priusznál piros pecsét', async () => {
      const r = await page.evaluate(() => ({
        nums: [...document.querySelectorAll('#profileStats [data-count]')].map((n) => n.textContent === n.dataset.count ? n.textContent : 'X' + n.textContent + '/' + n.dataset.count),
        big: [...document.querySelectorAll('.pd-big b')].slice(0, 2).map((b) => b.textContent),
        stamp: document.querySelector('.pd-stamp').className + ' ' + document.querySelector('.pd-stamp').textContent,
        ring: getComputedStyle(document.querySelector('.pd-ring')).getPropertyValue('--pdp').trim()
      }));
      assert.ok(!r.nums.some((n) => n.startsWith('X')), 'számláló: ' + r.nums.join(' '));
      assert.deepEqual(r.big, ['14', '6']);
      assert.match(r.stamp, /bad.*BÜNTETETT ELŐÉLETŰ.*3× elítélve/);
      assert.equal(r.ring, '43');
    });
    await check('B) 5 szerep-kártya képpel és számmal; a 0-s szerep (tanú) halvány; ítélet-mérleg 3 bűnös / 5 felmentve', async () => {
      const r = await page.evaluate(async () => {
        const cards = [...document.querySelectorAll('.pd-role')];
        await Promise.all(cards.map((c) => c.querySelector('img').decode().catch(() => null)));
        return {
          names: cards.map((c) => c.querySelector('.pd-role-name').textContent), n: cards.map((c) => c.querySelector('.pd-role-n').textContent),
          zero: cards.filter((c) => c.classList.contains('zero')).map((c) => c.querySelector('.pd-role-name').textContent),
          imgs: cards.map((c) => { const i = c.querySelector('img'); return i.naturalWidth > 0 && !/\.svg/.test(i.src); }),
          verdict: [...document.querySelectorAll('.pd-verdict .pdv-tag')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()).join(' | ')
        };
      });
      assert.deepEqual(r.names, ['Vádlott', 'Ügyész', 'Védő', 'Bíró', 'Tanú']);
      assert.deepEqual(r.n, ['8×', '6×', '4×', '9×', '0×']);
      assert.deepEqual(r.zero, ['Tanú']);
      assert.deepEqual(r.imgs, [true, true, true, true, true], 'minden kártyán betöltött raszterkép');
      assert.equal(r.verdict, 'BŰNÖS 3 | 5 FELMENTVE');
    });
    await check('C) jelvények: 14 érme, a megszerzettek jelölve, "Következő" a legközelebbi (Bírói talár 9 / 10)', async () => {
      const r = await page.evaluate(() => ({ all: document.querySelectorAll('.ps-badges .pb').length, got: document.querySelectorAll('.ps-badges .pb.got').length,
        next: document.querySelector('.pb-next').textContent, api: window.kbBadges.next({ jatek: 4 }) }));
      assert.equal(r.all, 14); assert.equal(r.got, 7);
      assert.match(r.next, /Következő: Bírói talár.*9 \/ 10/);
      assert.equal(r.api.id, 'veteran'); assert.equal(r.api.have, 4); assert.equal(r.api.need, 10);
    });
    await check('C) a műveleti gombok megnyitják a boltot, a küldetéseket, a barátokat és a ranglistát', async () => {
      const shown = async (sel) => page.waitForFunction((s) => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && (e.open !== false) && e.getBoundingClientRect().height > 0; }, sel, { timeout: 5000 }).then(() => true, () => false);
      await page.click('#btnShopOpen'); assert.ok(await shown('#shopModal'), 'bolt');
      await page.click('#shopClose'); await pause(300);
      await page.click('#btnQuestsOpen'); assert.ok(await shown('#shopModal'), 'küldetések');
      assert.equal(await page.getAttribute('#shopTabQuests', 'aria-selected'), 'true');
      await page.click('#shopClose'); await pause(300);
      await page.click('#btnFriendsOpen'); assert.ok(await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => !d.classList.contains('hidden') && d.getBoundingClientRect().height > 0 && /BARÁT/i.test(d.textContent)), null, { timeout: 5000 }).then(() => true, () => false), 'barátok');
      await page.keyboard.press('Escape'); await pause(200);
      await page.evaluate(() => { for (const d of document.querySelectorAll('[role="dialog"]')) if (!d.classList.contains('hidden') && /BARÁT/i.test(d.textContent)) { const x = d.querySelector('button[id$="Close"], .btn.ghost'); if (x) x.click(); } });
      await pause(300);
      await page.click('#btnRankOpen'); assert.ok(await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => !d.classList.contains('hidden') && d.getBoundingClientRect().height > 0 && /RANGLISTA/i.test(d.textContent)), null, { timeout: 5000 }).then(() => true, () => false), 'ranglista');
    });
    await check('D) gépen (1366×768): nincs kilógó elem, egymásra futó szöveg, vízszintes görgetés', async () => {
      await page.keyboard.press('Escape'); await page.mouse.move(2, 2); await pause(400); // (az egér ne maradjon egy gomb fölött: a hover-nagyítás nem mérendő)
      assert.deepEqual(await page.evaluate(auditDash), []);
    });
    await context.close();

    for (const [w, h] of [[390, 844], [844, 390], [360, 640]]) {
      const v = await open('Tiszta Teréz', { width: w, height: h }, true);
      await check('D) telefon ' + w + '×' + h + ': nincs kilógó elem, egymásra futó szöveg, vízszintes görgetés; büntetlen pecsét', async () => {
        assert.deepEqual(await v.page.evaluate(auditDash), []);
        assert.match(await v.page.evaluate(() => document.querySelector('.pd-stamp').className + ' ' + document.querySelector('.pd-stamp').textContent), /good.*BÜNTETLEN/);
      });
      await v.context.close();
    }
    const rm = await open('Tiszta Teréz', { width: 1366, height: 768 }, false, { reducedMotion: 'reduce' });
    await check('csökkentett mozgásnál nincs belépő animáció, a számok rögtön a helyükön', async () => {
      const r = await rm.page.evaluate(() => ({ anim: document.querySelector('#profileStats').classList.contains('pd-anim'), n: document.querySelector('.pd-big b').textContent }));
      assert.equal(r.anim, false); assert.equal(r.n, '4');
    });
    await rm.context.close();
    await check('nincs JS-hiba', async () => { assert.deepEqual(errors, []); });
  } finally { await browser.close(); server.kill(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* */ } }
  console.log('\nProfil-akta: ' + passed + ' sikeres, ' + failed + ' hibás.');
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})();
