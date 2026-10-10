'use strict';
// Induló szólisták a moderációhoz. FIGYELEM: ez kiindulópont, nem tökéletes szótár; a MOD_WORDLIST_FILE-ban megadott JSON-nal
// bővíthető / szűkíthető: { "hate": [...], "profanity": [...], "allow": [...] }. A bejegyzések ékezet nélküli, kisbetűs TÖVEK
// (a szó elejéhez illesztünk, így a ragozott alakok is találatot adnak); a listák a betű-ismétlést és a „leet” írásmódot is elkapják.
const fs = require('fs');
const { foldWord } = require('./modtext');

const DEFAULTS = {
  // Gyűlöletbeszéd, szidalmazó megkülönböztetés, öngyilkosságra / bántalmazásra uszítás: azonnali törlés + némítás
  hate: [
    'nigger*', 'nigga*', 'faggot*', 'kike', 'tranny', 'chink', 'spic', 'retard*',
    'buzi*', 'buzeran*', 'zsidozo*', 'ciganyozo*', 'cigányozó*',
    'heil hitler', 'sieg heil', 'white power', 'gazkamra*', 'gazositsuk',
    'dogolj meg', 'oldd meg magad', 'kys', 'kill yourself', 'kill urself'
  ],
  // Durva káromkodás: törlés + pontszám (a MOD_PROFANITY=off kikapcsolja)
  profanity: [
    'kurva*', 'geci*', 'fasz*', 'picsa*', 'basz*', 'bazdmeg*', 'bazmeg*', 'szopd', 'szopj', 'kibaszott*', 'kocsog*',
    'fuck*', 'shit', 'shitty', 'bitch*', 'cunt*', 'asshole*', 'dickhead*', 'motherfucker*', 'wanker*'
  ],
  // Kivételek (a tőillesztés téves találatai): ezek a szavak nem számítanak (pontos szó vagy tő*)
  allow: ['bazalt*', 'bazar*', 'bazilika*', 'baszk*', 'shitake', 'shiitake', 'bitchfork', 'faszkep']
};

function load(file) {
  const out = { hate: [...DEFAULTS.hate], profanity: [...DEFAULTS.profanity], allow: [...DEFAULTS.allow] };
  if (file) {
    try {
      const extra = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const k of ['hate', 'profanity', 'allow']) if (Array.isArray(extra[k])) out[k].push(...extra[k].filter((x) => typeof x === 'string'));
    } catch (e) { console.error('[moderáció] a szólista-fájl nem olvasható:', e.message); }
  }
  // '*' végű bejegyzés = tő (szó eleji illesztés), egyébként pontos szó; a többszavas kifejezések pontosan illeszkednek
  const prep = (list) => [...new Map(list.map((raw) => {
    const prefix = /\*$/.test(String(raw).trim());
    const w = String(raw).replace(/\*$/, '').split(/\s+/).map(foldWord).filter(Boolean).join(' ');
    return [w + (prefix ? '*' : ''), { w, prefix }];
  }).filter(([, e]) => e.w.length >= 3)).values()];
  return { hate: prep(out.hate), profanity: prep(out.profanity), allow: prep(out.allow) };
}

module.exports = { load, DEFAULTS };
