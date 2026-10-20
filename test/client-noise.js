'use strict';
// ============================================================
// KAMU BÍRÓSÁG – client-noise.js: mi NEM kerül a böngészős hibanaplóba (idegen szkript, víruskereső, bővítmény, localhost), és mi IGEN
// A példák az éles admin Hibák lapjáról valók (2026-10-20).
// Futtatás: node test/client-noise.js
// ============================================================
const assert = require('assert/strict');
const { isClientNoise } = require('../client-noise');

let passed = 0, failed = 0;
const check = (name, work) => { try { work(); passed++; console.log('PASS: ' + name); } catch (e) { failed++; console.error('FAIL: ' + name + '\n  ' + (e && e.message || e)); } };

check('zaj: "Script error." fájl és sor nélkül (idegen eredetű, rejtett részletű szkript-hiba)', () => {
  assert.equal(isClientNoise('Script error.', ''), true);
  assert.equal(isClientNoise('Script error', ''), true);
  assert.equal(isClientNoise('Uncaught Script error.', undefined), true);
});
check('zaj: víruskereső / bővítmény / localhost CSP-sértés', () => {
  assert.equal(isClientNoise('CSP: style-src-elem – https://me.kis.v2.scr.kaspersky-labs.com/<token>/ab', 'kamubirosag.com/'), true);
  assert.equal(isClientNoise('CSP: img-src – http://localhost:3737/favicon.ico', ''), true);
  assert.equal(isClientNoise('CSP: script-src-elem – chrome-extension://abcdef/inject.js', ''), true);
  assert.equal(isClientNoise('CSP: img-src – http://127.0.0.1:8080/x.png', ''), true);
});
check('zaj: hiba egy böngésző-bővítmény fájljából', () => {
  assert.equal(isClientNoise('TypeError: x is undefined', 'chrome-extension://abc/content.js'), true);
  assert.equal(isClientNoise('TypeError: x is undefined', 'moz-extension://abc/content.js'), true);
});
check('NEM zaj: a játék saját hibái (fájllal és sorral) – a képen látott régi hibák is bekerülnének', () => {
  assert.equal(isClientNoise("Uncaught TypeError: Cannot read properties of null (reading 'classList')", 'kamubirosag.com/client.js'), false);
  assert.equal(isClientNoise('Uncaught ReferenceError: socket is not defined', 'kamubirosag.com/shop.js'), false);
  assert.equal(isClientNoise('Uncaught ReferenceError: $ is not defined', 'kamubirosag.com/auth.js'), false);
  assert.equal(isClientNoise('Script error.', 'kamubirosag.com/client.js'), false, 'fájllal már nem idegen');
  assert.equal(isClientNoise('Elkapatlan ígéret: hálózati hiba', ''), false);
});
check('NEM zaj: más CSP-sértés (pl. idegen szkript vagy kép a játék oldalán – ez hiba vagy támadási kísérlet)', () => {
  assert.equal(isClientNoise('CSP: script-src-elem – https://evil.example/x.js', 'kamubirosag.com/'), false);
  assert.equal(isClientNoise('CSP: img-src – https://cdn.example.com/kep.png', ''), false);
  assert.equal(isClientNoise('CSP: connect-src – wss://localhost.evil.example/', ''), false, 'a "localhost" szó egy idegen domainben nem elég');
});
check('üres / furcsa bemenet nem dob hibát', () => {
  assert.equal(isClientNoise(undefined, undefined), false);
  assert.equal(isClientNoise('', ''), false);
  assert.equal(isClientNoise(42, null), false);
});
console.log('\nBöngészős zajszűrő: ' + passed + ' sikeres, ' + failed + ' hibás.');
process.exit(failed ? 1 : 0);
