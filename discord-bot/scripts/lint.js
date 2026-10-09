'use strict';
// Egyszerű lint: szintaxis-ellenőrzés + tiltott minták (kemény kódolt token, console.log(token)).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = [];
for (const dir of ['src', 'scripts', 'test']) {
  for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith('.js')) files.push(path.join(root, dir, f));
}
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.error(r.stderr); }
  const src = fs.readFileSync(f, 'utf8');
  if (/[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/.test(src)) { bad++; console.error(`${f}: token-szerű sztring!`); }
  if (/console\.\w+\([^)]*process\.env\.DISCORD_BOT_TOKEN/.test(src)) { bad++; console.error(`${f}: a token naplózása tilos`); }
}
const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
if (!/^\.env$/m.test(gi)) { bad++; console.error('.gitignore: hiányzik a .env'); }
console.log(bad ? `lint: ${bad} hiba` : `lint: ${files.length} fájl rendben`);
process.exit(bad ? 1 : 0);
