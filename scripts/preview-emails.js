'use strict';
// Az összes e-mail sablon HTML-előnézete fájlba (NEM küld levelet): node scripts/preview-emails.js [kimeneti-mappa] [--header https://...kep.jpg]
// A kimenet (alapból email-preview/) böngészőben megnyitható; a mappa nem része a tárolónak.
const fs = require('fs');
const path = require('path');
const { render, NAMES, SAMPLE } = require('../mail-templates');

const args = process.argv.slice(2);
const hi = args.indexOf('--header');
const headerImage = hi >= 0 ? args[hi + 1] : process.env.EMAIL_HEADER_IMAGE_URL || '';
const out = path.resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--header') || 'email-preview');
fs.mkdirSync(out, { recursive: true });
const cfg = { origin: process.env.AUTH_BASE_URL || 'https://kamubirosag.com', headerImage, discordUrl: process.env.DISCORD_INVITE_URL || 'https://discord.gg/yyG7hH4aEB' };
const rows = [];
for (const name of NAMES) {
  const m = render(name, SAMPLE[name], cfg);
  fs.writeFileSync(path.join(out, name + '.html'), m.html);
  fs.writeFileSync(path.join(out, name + '.txt'), m.text);
  rows.push('<li><a href="' + name + '.html">' + name + '</a> – ' + m.subject.replace(/</g, '&lt;') + ' (<a href="' + name + '.txt">szöveg</a>)</li>');
}
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>E-mail előnézet</title><h1>Kamu Bíróság – e-mail sablonok</h1><ul>' + rows.join('') + '</ul>');
console.log('Kész: ' + NAMES.length + ' sablon -> ' + out + (headerImage ? ' (fejlécképpel)' : ' (szöveges fejléccel)'));
