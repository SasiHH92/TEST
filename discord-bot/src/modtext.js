'use strict';
// Szöveg-normalizálás a moderációhoz: ékezetek, kis/nagybetű, „leet” írásmód, betű-ismétlés, szétszórt betűk.

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '€': 'e', '|': 'l' };

// Ékezetmentes, kisbetűs alak (ő → o, ű → u, ß → ss)
function fold(s) {
  return String(s || '').normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[​-‏⁠﻿­]/g, '').toLowerCase().replace(/ß/g, 'ss');
}
const collapse = (w) => w.replace(/(.)\1+/g, '$1'); // kurvaaa → kurva, nigger → niger
// Egy szó (listabejegyzés) kanonikus alakja
const foldWord = (w) => collapse(fold(w).replace(/[^a-z]/g, ''));

// A teljes szöveg tokenjei (leet-feloldással), betű-ismétlés nélkül
function tokens(text) {
  const t = fold(text).replace(/[0134578@$!€|]/g, (c) => LEET[c] || c);
  return t.split(/[^a-z]+/).filter(Boolean).map(collapse);
}

// „k u r v a”, „k.u.r.v.a”, „k-u-r-v-a”: legalább 4 egybetűs, elválasztott betű összefűzve
function spacedWords(text) {
  const t = fold(text).replace(/[0134578@$!€|]/g, (c) => LEET[c] || c);
  const out = [];
  const re = /(?:^|[^a-z])((?:[a-z][\s.\-_*,]+){3,}[a-z])(?![a-z])/g;
  let m;
  while ((m = re.exec(t))) out.push(collapse(m[1].replace(/[^a-z]/g, '')));
  return out;
}

const letters = (s) => (String(s).match(/\p{L}/gu) || []);
function capsRatio(text) {
  const l = letters(text);
  if (l.length < 12) return 0;
  const up = l.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length;
  return up / l.length;
}
function emojiCount(text) {
  const uni = (String(text).match(/\p{Extended_Pictographic}/gu) || []).length;
  const custom = (String(text).match(/<a?:\w{2,32}:\d{5,25}>/g) || []).length;
  return uni + custom;
}

module.exports = { fold, foldWord, collapse, tokens, spacedWords, capsRatio, emojiCount, letters };
