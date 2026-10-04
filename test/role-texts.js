'use strict';
// ============================================================
// KAMU BÍRÓSÁG – szerep- és szöveg-teszt (statikus kliens-ellenőrzés)
// Minden szerep a SAJÁT kártyatípusát, címét, színét és tippjét látja,
// a szerepcímkék teljes nevek, és a kulcs-UI elemek ott vannak.
// Futtatás: node test/role-texts.js
// ============================================================

const fs = require('fs');
const path = require('path');

let fails = 0;
function ok(cond, label) {
  if (cond) { console.log('  OK  ' + label); }
  else { fails++; console.log('  HIBA ' + label); }
}

const client = fs.readFileSync(path.join(__dirname, '..', 'public', 'client.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

console.log('1) Titkos kártyák: szerepenként a helyes cím + típus + tipp');
// ÜGYÉSZ
ok(client.includes('A TITKOS BIZONYÍTÉKAID'), 'ügyész címe: A TITKOS BIZONYÍTÉKAID');
ok(/role === 'prosecutor'[^]*?BIZONYÍTÉK', 't-evidence/.test(client), 'ügyész kártyatípusa BIZONYÍTÉK (piros t-evidence)');
ok(client.includes('Ezekre építsd a vádbeszédet!'), 'ügyész tippe: "Ezekre építsd a vádbeszédet!"');
// VÁDLOTT
ok(client.includes('A TITKOS ALIBID'), 'vádlott címe: A TITKOS ALIBID');
ok(/role === 'defendant'[^]*?'ALIBI', 't-alibi'/.test(client), 'vádlott kártyatípusa ALIBI (borostyán t-alibi)');
ok(client.includes('Erre építsd a védekezésed!'), 'vádlott tippe: "Erre építsd a védekezésed!"');
// VÉDŐÜGYVÉD
ok(client.includes('A TITKOS TRÜKKJEID'), 'védőügyvéd címe: A TITKOS TRÜKKJEID');
ok(!client.includes('A TITKOS TRÜKKJEID (védőügyvédként)'), 'nincs többé félrevezető "(védőügyvédként)" utótag');
ok(client.includes("cardHtml('TRÜKK', 't-trick'"), 'védőügyvéd kártyatípusa TRÜKK (kék t-trick)');
ok(client.includes('Ezekkel erősítsd a védőbeszédedet!'), 'védő tippe: "Ezekkel erősítsd a védőbeszédedet!"');
// A HIBA: a védőügyvéd kártyáján "vádlott" szöveg volt.
// Ellenőrzés: a defender prep-ág blokkjában (a blokk elejétől a tipp-ig) nincs "vádlott".
{
  const start = client.indexOf("role === 'defender' && S.tricks");
  const end = client.indexOf('Ezekkel erősítsd a védőbeszédedet!', start);
  const block = client.slice(start, end);
  ok(!block.includes('vádlott'), 'A VÉDŐÜGYVÉD kártya-ágban NINCS "vádlott" szöveg (az eredeti hiba)');
}
// TANÚ
ok(client.includes('A TITKOS TANÚKÁRTYÁD'), 'tanú címe: A TITKOS TANÚKÁRTYÁD');
ok(client.includes('Ez alapján tegyél vallomást!'), 'tanú tippe: "Ez alapján tegyél vallomást!"');
// KIHÍVÁS
ok(client.includes('A TITKOS KIHÍVÁSOD'), 'kihívás címe: A TITKOS KIHÍVÁSOD');
ok(!client.includes('(ügyész)\' : \' (vádlott)'), 'nincs többé rögzített (ügyész)/(vádlott) kihívás-címke');

console.log('2) Szerepcímkék: teljes nevek mindenhol');
ok(client.includes("ROLE_LABEL = {\n  prosecutor: 'ÜGYÉSZ'"), 'ROLE_LABEL: ÜGYÉSZ');
ok(client.includes("defendant: 'VÁDLOTT'"), 'ROLE_LABEL: VÁDLOTT');
ok(client.includes("defender: 'VÉDŐ'"), 'ROLE_LABEL: VÉDŐ');
ok(client.includes("witness: 'TANÚ'"), 'ROLE_LABEL: TANÚ');
ok(client.includes("juror: 'ESKÜDT'"), 'ROLE_LABEL: ESKÜDT');
ok(client.includes("judge: 'BÍRÓ'"), 'ROLE_LABEL: BÍRÓ');
ok(client.includes('roleLabel(role)'), 'a ponttábla a roleLabel-t használja (nem ROLE_SHORT rövidítést)');
ok(!/sb-role[^]*ROLE_SHORT/.test(client), 'a ponttábla NEM a kétbetűs rövidítéseket írja');
// A régi rövidítések (ÜÜ/VÁ/VÉ/TA/ES) eltűntek a ponttábláról:
ok(!client.match(/ROLE_SHORT\s*=\s*{[^}]*'ÜÜ'/), 'nincs többé "ÜÜ" rövidítés a sidebarhoz');

console.log('3) Színpad: szerepcímke a névcímkéken + bíró-jelzés');
ok(client.includes('plate-role') || client.includes('st-role'), 'színpadi névcímkén szerepcímke (.plate-role)');
ok(css.includes('.st-role'), 'a .st-role stílus megvan');
ok(client.includes('is-round-judge'), 'a körbíró glow-jelzése a színpadon');
ok(css.includes('.judge-slot.round-judge'), 'a bíró figura "BÍRÓ" jelzése stílusban');
ok(client.includes('rb-judge'), 'fázis-sávban "Ebben a körben X a bíró" sor');
ok(client.includes('Ebben a körben'), 'a bíró-üzenet szövege megvan');

console.log('4) Rendet a teremben: csak a körbíró');
ok(server.includes("d.currentJudgeId) ? d.currentJudgeId : null"), 'szerver: order_in_court a KÖR BÍRÓJÁT ellenőrzi');
ok(!server.includes("game.hostId() !== sess.playerId) return;\n    game.broadcastAll('order_in_court'"),
  'szerver: NEM többé a házigazda-checkon múlik');
ok(client.includes("S.currentJudgeId && S.currentJudgeId === MY.playerId"), 'kliens: a gomb csak a körbírónál látszik');

console.log('5) Esküdt-pont + ítélet képernyő');
ok(game.includes('ESKÜDT-PONT'), 'motor: esküdt-pont blokk megvan');
ok(game.includes('jurorPoint'), 'motor: jurorPoint jelölés a votes-ban');
ok(client.includes('juror-plus'), 'kliens: "+1" megjelenítés az ítélet képernyőn');
ok(game.includes("guiltyVotes === notGuiltyVotes"), 'döntetlen: mindenki +1');

console.log('6) Kilépés / vissza / megerősítés');
ok(client.includes('Biztosan kilépsz a szobából?'), 'kilépés-megerősítés szöveg');
ok(client.includes('confirmDialog'), 'stílusos megerősítő ablak');
ok(client.includes('popstate'), 'böngésző-vissza gomb kezelése');
ok(client.includes('history.pushState'), 'history-őr (a vissza ne dobjon ki hirtelen)');
ok(html.includes('btnLeaveLobby') && !html.includes('btnBackToName'), 'a lobbyban egyetlen KILÉPÉS gomb van (nincs külön VISSZA)');
ok(client.includes('leaveToMenu'), 'egységes kilépés-funkció');
ok(game.includes('transferHostFrom'), 'motor: házigazda-átadás');
ok(client.includes('host_changed'), 'kliens: host-átadás toast');
ok(game.includes('lobbyNotice'), 'motor: lobby-visszaesés üzenet');

console.log('7) Glow / kijelölés');
ok(css.includes('podium-gold'), 'végeredmény: arany glow');
ok(css.includes('podium-silver') && css.includes('podium-bronze'), 'ezüst + bronz glow');
ok(css.includes('verdict-glow-red') && css.includes('verdict-glow-green'), 'ítélet: győztes oldal glow');
ok(css.includes('.vote-btn.chosen') && css.includes('.vote-btn.faded'), 'szavazás: leadott kiemelve, másik halvány');
ok(css.includes('.confirm-modal'), 'megerősítő ablak stílusa');

console.log(fails === 0 ? '\nÖSSZES ALTERSZT ZÖLD ✔' : '\n' + fails + ' TESZT PIROS ✘');
process.exit(fails === 0 ? 0 : 1);
