'use strict';
// A Discord-meghívó minden helyen ugyanaz, külső és biztonságos (új lap, noopener).
const fs = require('fs'), path = require('path'), assert = require('assert');
const URL_ = 'https://discord.gg/yyG7hH4aEB';
const files = { 'public/index.html': 3, 'public/client.js': 1, 'public/tamogatas.html': 1 };
for (const [f, n] of Object.entries(files)) {
  const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const all = s.match(/https:\/\/discord\.gg\/[A-Za-z0-9]+/g) || [];
  assert.strictEqual(all.length, n, f + ': meghívók száma');
  assert(all.every((u) => u === URL_), f + ': eltérő meghívó');
  const tags = s.match(/<a [^>]*discord\.gg[^>]*>|"<a [^']*discord\.gg[^']*>/g) || [];
  for (const t of tags) assert(/target="_blank"/.test(t) && /rel="noopener noreferrer"/.test(t), f + ': hiányzó target/rel');
}
console.log('discord-invite OK');
