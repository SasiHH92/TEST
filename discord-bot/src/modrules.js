'use strict';
// A moderáció szabálymotorja: tiszta függvények (nincs Discord, nincs hálózat), ezért offline tesztelhető.
// evaluate() → { findings: [{ rule, severity, category, reason }] }, severity: low | medium | high.
const { tokens, spacedWords, capsRatio, emojiCount, fold } = require('./modtext');

const SEV = { low: 1, medium: 2, high: 3 };

const INVITE_RE = /(?:discord(?:app)?\.(?:gg|com\/invite)|discord\.me|dsc\.gg)\/[\w-]+/i;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi;
const OFFICIAL_HOSTS = new Set(['discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'discordstatus.com', 'steamcommunity.com', 'steampowered.com', 'store.steampowered.com', 'roblox.com']);
const BAD_HOSTS = ['grabify.link', 'iplogger.org', 'iplogger.com', 'iplogger.ru', '2no.co', 'yip.su', 'blasze.tk', 'leancoding.co', 'stopify.co', 'freegiftcards.co', 'ps3cool.us', 'gyazo.nl', 'ipgrabber.ru'];
const SHORTENERS = ['bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'ow.ly', 'tiny.cc', 'bl.ink', 'v.gd'];
const EXEC_EXT = /\.(?:exe|scr|bat|cmd|com|msi|jar|apk|lnk|vbs|vbe|ps1|psm1|dll|hta|reg|cpl|js|jse|wsf|appimage|dmg|pkg|sh)$/i;
const SCAM_RE = [
  /(?:free|ingyen\w*|gift|ajandek\w*)\s+(?:discord\s+)?(?:nitro|steam|robux|v-?bucks|skin\w*|cs2?go?)/,
  /nitro\s+(?:gift|giveaway|ingyen\w*|free)/,
  /(?:claim|igenyl\w*)\s+(?:your|a)?\s*(?:free|reward|prize|nyeremeny\w*|crypto|token|airdrop)/,
  /airdrop/, /(?:crypto|bitcoin|btc|eth)\s+(?:giveaway|doubl\w+|invest\w*)/,
  /(?:dm|pm|ir[dj])\s+me\s+(?:for|to)\s+(?:earn|invest|free)/,
  /(?:you(?:'|’)?ve|you have)\s+been\s+(?:selected|chosen)/, /verify\s+(?:your\s+)?(?:account|wallet).*(?:link|click)/
];

function hostOf(url) {
  try { return new URL(/^https?:/i.test(url) ? url : 'http://' + url).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return ''; }
}
const hostMatches = (host, list) => list.some((h) => host === h || host.endsWith('.' + h));

function wordFindings(text, lists, opts) {
  const out = [];
  const toks = tokens(text);
  const candidates = [...toks, ...spacedWords(text)];
  const joined = ' ' + toks.join(' ') + ' ';
  const matches = (t, e) => (e.prefix ? t.startsWith(e.w) : t === e.w);
  const isAllowed = (t) => lists.allow.some((a) => matches(t, a));
  const hit = (list) => {
    for (const e of list) {
      if (e.w.includes(' ')) { if (joined.includes(' ' + e.w + ' ') || (e.prefix && joined.includes(' ' + e.w))) return e.w; continue; }
      for (const t of candidates) if (matches(t, e) && !isAllowed(t)) return e.w;
    }
    return null;
  };
  const h = hit(lists.hate);
  if (h) out.push({ rule: 'hate', severity: 'high', category: 'hate', reason: 'Gyűlöletbeszéd / sértő megkülönböztetés vagy uszítás' });
  else if (opts.profanity !== 'off') {
    const p = hit(lists.profanity);
    if (p) out.push({ rule: 'profanity', severity: 'low', category: 'profanity', reason: 'Durva szóhasználat' });
  }
  return out;
}

/**
 * @param {string} text
 * @param {object} ctx { mentionUsers, mentionRoles, mentionEveryone, attachments:[{name,contentType,size}], lists, opts }
 */
function evaluate(text, ctx) {
  const findings = [];
  const raw = String(text || '');
  const lists = ctx.lists;
  const opts = ctx.opts || {};

  findings.push(...wordFindings(raw, lists, opts));

  // Meghívók, linkek
  if (INVITE_RE.test(raw)) findings.push({ rule: 'invite', severity: 'medium', category: 'advertising', reason: 'Idegen Discord-meghívó (reklám)' });
  const urls = raw.match(URL_RE) || [];
  const hosts = urls.map(hostOf).filter(Boolean);
  const scamText = SCAM_RE.some((re) => re.test(fold(raw)));
  for (const h of hosts) {
    if (hostMatches(h, BAD_HOSTS)) { findings.push({ rule: 'bad-link', severity: 'high', category: 'scam', reason: 'IP-naplózó / kártékony link' }); break; }
  }
  for (const h of hosts) {
    // Hasonmás-domain: "discord"/"steam" szerepel, de nem a hivatalos cím (adathalászat)
    if (/d[il1]sc[o0]r[dcl]|steam|n[il1]tro/.test(h) && !hostMatches(h, [...OFFICIAL_HOSTS])) { findings.push({ rule: 'phishing', severity: 'high', category: 'scam', reason: 'Gyanús, hasonmás weboldal (adathalászat)' }); break; }
  }
  if (hosts.some((h) => hostMatches(h, SHORTENERS))) findings.push({ rule: 'shortener', severity: 'low', category: 'link', reason: 'Rövidített (elrejtett célú) link' });
  if (scamText && (urls.length || ctx.mentionEveryone)) findings.push({ rule: 'scam-text', severity: 'high', category: 'scam', reason: 'Átverés-gyanús üzenet (ingyen Nitro / nyeremény / kripto)' });
  else if (scamText) findings.push({ rule: 'scam-text', severity: 'medium', category: 'scam', reason: 'Átverés-gyanús szöveg' });

  // Tömeges említés
  if ((ctx.mentionUsers || 0) >= (opts.maxMentions || 5) || (ctx.mentionRoles || 0) >= 3 || ctx.mentionEveryone) {
    findings.push({ rule: 'mass-mention', severity: 'high', category: 'spam', reason: 'Tömeges említés' });
  }

  // Formai spam
  if (capsRatio(raw) >= 0.75) findings.push({ rule: 'caps', severity: 'low', category: 'spam', reason: 'Csupa nagybetű' });
  if (emojiCount(raw) >= (opts.maxEmoji || 12)) findings.push({ rule: 'emoji-flood', severity: 'low', category: 'spam', reason: 'Emoji-áradat' });
  if (/(.)\1{14,}/u.test(raw)) findings.push({ rule: 'char-repeat', severity: 'low', category: 'spam', reason: 'Ismétlődő karakterek' });
  if (/\p{M}{4,}/u.test(raw.normalize('NFD'))) findings.push({ rule: 'zalgo', severity: 'low', category: 'spam', reason: 'Olvashatatlan (zalgo) szöveg' });
  if (raw.length > 1800 && (raw.match(/\s/g) || []).length < 20) findings.push({ rule: 'wall', severity: 'low', category: 'spam', reason: 'Értelmetlen szövegfal' });

  // Mellékletek
  for (const a of ctx.attachments || []) {
    if (EXEC_EXT.test(a.name || '')) { findings.push({ rule: 'exec-attachment', severity: 'high', category: 'malware', reason: 'Futtatható / veszélyes melléklet (' + String(a.name).slice(0, 40) + ')' }); break; }
  }
  return { findings };
}

// Több üzenetes minták (flood, ismétlés, több csatornás spam). Állapot: felhasználónként időbélyegek.
function createFloodTracker({ now = () => Date.now(), floodCount = 6, floodMs = 8000, dupCount = 3, dupMs = 30000, crossChannels = 3, crossMs = 60000 } = {}) {
  const hist = new Map(); // userId -> [{ t, key, channel }]
  return {
    check(userId, text, channelId) {
      const t = now();
      const key = tokens(text).join(' ') || fold(text).trim();
      const list = (hist.get(userId) || []).filter((e) => t - e.t < Math.max(floodMs, dupMs, crossMs));
      list.push({ t, key, channel: channelId });
      hist.set(userId, list);
      const out = [];
      if (list.filter((e) => t - e.t < floodMs).length >= floodCount) out.push({ rule: 'flood', severity: 'medium', category: 'spam', reason: 'Üzenet-áradat (túl gyors írás)' });
      if (key.length >= 4 && list.filter((e) => e.key === key && t - e.t < dupMs).length >= dupCount) out.push({ rule: 'repeat', severity: 'medium', category: 'spam', reason: 'Ugyanaz az üzenet ismételve' });
      if (key.length >= 8) {
        const chans = new Set(list.filter((e) => e.key === key && t - e.t < crossMs).map((e) => e.channel));
        if (chans.size >= crossChannels) out.push({ rule: 'cross-spam', severity: 'high', category: 'spam', reason: 'Ugyanaz az üzenet több csatornában (spam / átverés)' });
      }
      if (hist.size > 5000) for (const [k, v] of hist) if (!v.length || t - v[v.length - 1].t > 120000) hist.delete(k);
      return out;
    }
  };
}

const worst = (findings) => findings.reduce((a, f) => (!a || SEV[f.severity] > SEV[a.severity] ? f : a), null);

module.exports = { evaluate, createFloodTracker, worst, SEV, hostOf };
