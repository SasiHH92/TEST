'use strict';

// ============================================================
// KAMU BÍRÓSÁG – levélküldés (Resend) és a sablonok összekötése
//
// Beállítás (környezeti változók; a kulcs csak a szerveren él, a böngészőbe soha nem kerül):
//   RESEND_API_KEY            a Resend API-kulcsa (régi név is jó: AUTH_MAIL_API_KEY)
//   EMAIL_FROM                a hitelesített feladó, pl. "Kamu Bíróság <noreply@kamubirosag.com>" (régi név: AUTH_MAIL_FROM)
//   EMAIL_HEADER_IMAGE_URL    (nem kötelező) a levelek fejléc-képe; https cím, 600 px széles kép ajánlott. Kép nélkül szöveges fejléc van.
//   DISCORD_INVITE_URL        (nem kötelező) a láblécben megjelenő Discord-meghívó
//   EMAIL_DRY_RUN=1           fejlesztéshez: NEM megy ki levél, a tartalom a konzolra (és az EMAIL_OUTBOX_FILE fájlba) kerül
// A levélküldés akkor "él", ha van kulcs ÉS feladó ÉS érvényes AUTH_BASE_URL (a linkek ebből készülnek).
// A küldés hibái nem állítják meg a játékot: a hívó dönt, hogy mi történik (a hiba szövege megtisztítva, kulcs és cím nélkül).
// ============================================================

const { render, NAMES, SAMPLE } = require('./mail-templates');
const fs = require('fs');
const path = require('path');
const { scrub } = require('./errorlog');

const SEND_TIMEOUT_MS = 10000;

function httpsUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch (_) { return ''; }
}

/**
 * @param {object} o
 *  env, origin (AUTH_BASE_URL), sendMail (teszteknél: közvetlen küldő), resendClient (teszteknél: Resend-szerű kliens), log
 */
function createMailer(o = {}) {
  const env = o.env || process.env;
  const origin = String(o.origin || '').replace(/\/+$/, '');
  const apiKey = String(env.RESEND_API_KEY || env.AUTH_MAIL_API_KEY || '').trim();
  const from = String(env.EMAIL_FROM || env.AUTH_MAIL_FROM || '').trim();
  const headerImage = httpsUrl(env.EMAIL_HEADER_IMAGE_URL);
  const discordUrl = httpsUrl(env.DISCORD_INVITE_URL) || 'https://discord.gg/yyG7hH4aEB';
  const dryRun = String(env.EMAIL_DRY_RUN || '') === '1';
  const outbox = String(env.EMAIL_OUTBOX_FILE || '').trim();
  const enabled = !!(origin && (o.sendMail || o.resendClient || dryRun || (apiKey && from)));
  let client = o.resendClient || null;

  function resend() {
    if (!client) { const { Resend } = require('resend'); client = new Resend(apiKey); }
    return client;
  }

  // Egy kész levél (to, subject, html, text) elküldése. Hiba esetén error.mail === true.
  async function send(message) {
    if (o.sendMail) return o.sendMail(message);
    if (dryRun) { // fejlesztői mód: semmi nem megy ki; a levél (HTML-lel együtt) fájlba kerül, hogy átnézhető legyen
      (o.log || console).log('[levél – száraz futtatás] ' + scrub(message.to, 80) + ' ← ' + message.subject);
      if (outbox) { fs.mkdirSync(path.dirname(path.resolve(outbox)), { recursive: true }); fs.appendFileSync(path.resolve(outbox), JSON.stringify({ at: Date.now(), ...message }) + '\n'); }
      return { id: 'dry-run' };
    }
    const fail = (text, cause) => { const e = new Error(text); e.mail = true; if (cause) e.cause = cause; return e; };
    let result;
    try {
      result = await Promise.race([
        resend().emails.send({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text, ...(message.tags ? { tags: message.tags } : {}) }),
        new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('időtúllépés')), SEND_TIMEOUT_MS); if (t.unref) t.unref(); })
      ]);
    } catch (err) { throw fail('Mail delivery failed: ' + scrub(err && err.message, 200), err); } // hálózati hiba / időtúllépés
    if (result && result.error) {
      const e = result.error;
      throw fail('Mail delivery failed (' + (e.statusCode || e.status || '?') + ')' + (e.message ? ': ' + scrub(e.message, 200) : ''), e);
    }
    return result && result.data;
  }

  // Sablon kirenderelése a beállításokkal (kép, cím, Discord) – küldés nélkül.
  const build = (name, data) => render(name, data, { origin, headerImage, discordUrl });
  // Sablon + küldés egyben.
  async function sendTemplate(name, to, data) {
    const m = build(name, data);
    return send({ to, subject: m.subject, html: m.html, text: m.text, tags: [{ name: 'template', value: name }] });
  }

  return {
    enabled, dryRun, origin, headerImage, discordUrl, hasKey: !!apiKey, hasFrom: !!from,
    send, sendTemplate, build, templates: NAMES, sample: SAMPLE
  };
}

module.exports = { createMailer };
