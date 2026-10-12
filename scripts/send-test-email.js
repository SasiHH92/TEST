'use strict';
// Egyetlen próbalevél küldése a saját gépedről (a saját Resend-kulcsoddal): node scripts/send-test-email.js cimzett@example.com [sablon]
// Sablonok: welcome, confirmEmail, passwordReset, passwordChanged, gameInvite, securityNotice (alapból: welcome).
// Szükséges környezeti változók: RESEND_API_KEY, EMAIL_FROM, AUTH_BASE_URL (a linkek ebből készülnek). A kulcsot SOHA ne írd a parancsba / tárolóba:
// PowerShell:  $env:RESEND_API_KEY="..."; $env:EMAIL_FROM="Kamu Bíróság <noreply@kamubirosag.com>"; $env:AUTH_BASE_URL="https://kamubirosag.com"; node scripts/send-test-email.js te@example.com
const { createMailer } = require('../mailer');

(async () => {
  const [to, template = 'welcome'] = process.argv.slice(2);
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { console.error('Használat: node scripts/send-test-email.js cimzett@example.com [sablon]'); process.exit(1); }
  const mailer = createMailer({ env: process.env, origin: process.env.AUTH_BASE_URL || '' });
  if (!mailer.enabled) { console.error('A levélküldés nincs beállítva: kell a RESEND_API_KEY, az EMAIL_FROM és az AUTH_BASE_URL.'); process.exit(1); }
  if (!mailer.templates.includes(template)) { console.error('Ismeretlen sablon. Lehetséges: ' + mailer.templates.join(', ')); process.exit(1); }
  if (mailer.dryRun) console.log('(száraz futtatás: nem megy ki levél)');
  const data = { ...mailer.sample[template] };
  if (data.url) data.url = data.url.replace('https://example.invalid', mailer.origin);
  try {
    await mailer.sendTemplate(template, to, data);
    console.log('Elküldve: ' + template + ' -> ' + to + (mailer.headerImage ? ' (fejlécképpel)' : ' (szöveges fejléccel)'));
  } catch (e) { console.error('A küldés nem sikerült: ' + e.message); process.exit(2); }
})();
