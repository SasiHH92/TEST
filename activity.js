'use strict';
// ============================================================
// KAMU BÍRÓSÁG – aktivitás-napló az admin műszerfalhoz (data/activity.json, a Neonba is mentve: storage 'activity')
//   - napi számok (Budapest szerinti nap, 90 nap): indult / befejeződött / megszakadt játék, egyedi játékosok, egyszerre online csúcs (játékos, szoba)
//   - óránkénti minták (48 óra): az órán belüli legtöbb online játékos / szoba / kapcsolat
//   - látogatottság (naponta): a főoldal megnyitásai (views), egyedi látogatók (visitors), ebből szobalinkről (invites) – keresőrobot, link-előnézet, előtöltés nem számít
// Az egyedi játékosok számolásához CSAK a mai nap rövid név-ujjlenyomatai élnek (sha256 első 10 karaktere), a napváltáskor törlődnek –
// név nem kerül tárolásra. Bot nem számít. Az egyedi látogatóhoz az IP-cím + böngésző-típus lenyomata kell egy NAPONTA ÚJ, véletlen kulccsal
// (sha256(kulcs | ip | user agent) első 12 karaktere): a kulcs és a lenyomatok a napváltáskor törlődnek, így a lenyomat másnap már senkihez
// sem köthető vissza; az IP-cím maga nem kerül tárolásra, süti nincs.
// ============================================================
const fs = require('fs');
const crypto = require('crypto');

const KEEP_DAYS = 90, KEEP_HOURS = 48, MAX_TODAY_IDS = 5000, MAX_TODAY_VISITORS = 20000;
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (t) => dayFmt.format(new Date(t)); // 'ÉÉÉÉ-HH-NN'
const hourOf = (t) => Math.floor(t / 3600000) * 3600000;
const tag = (name) => crypto.createHash('sha256').update(String(name || '').trim().toLowerCase()).digest('hex').slice(0, 10);
const blankDay = () => ({ started: 0, finished: 0, aborted: 0, players: 0, peakPlayers: 0, peakRooms: 0, views: 0, visitors: 0, invites: 0 });
// keresőrobot, link-előnézet (Discord, Messenger …), felügyelő, parancssori letöltő, fej nélküli böngésző: nem látogató
const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|meta-externalagent|embedly|whatsapp|telegram|discord|skype|slack|vkshare|bingpreview|lighthouse|pagespeed|headless|phantom|puppeteer|playwright|selenium|curl\/|wget|python|node-fetch|undici|axios|okhttp|go-http|java\/|libwww|httpclient|monitor|uptime|pingdom|statuscake|render\//i;
const isBotAgent = (ua) => { const s = String(ua || ''); return !s || s.length < 12 || BOT_UA.test(s); };

function createActivity({ file, persist = () => {}, now = () => Date.now() } = {}) {
  let data = { version: 1, days: {}, hours: [], today: { day: '', ids: [] } };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw === 'object') data = { ...data, ...raw, days: raw.days || {}, hours: Array.isArray(raw.hours) ? raw.hours : [], today: raw.today || data.today };
  } catch (_) { /* nincs még fájl: üresen indul */ }

  let timer = null, visitorSet = null; // a mai látogató-lenyomatok halmaza (gyors kereséshez; a fájlban tömb)
  function save() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try { fs.writeFileSync(file, JSON.stringify(data)); persist(); } catch (_) { /* a napló nem kritikus */ }
    }, 3000);
    if (timer.unref) timer.unref();
  }
  function day(t = now()) {
    const key = dayOf(t);
    if (data.today.day !== key) { data.today = { day: key, ids: [], visitors: [], salt: '' }; visitorSet = null; } // napváltás: a tegnapi ujjlenyomatok, a látogató-lenyomatok és a kulcs törlődnek
    if (!data.days[key]) {
      data.days[key] = blankDay();
      const keys = Object.keys(data.days).sort();
      while (keys.length > KEEP_DAYS) delete data.days[keys.shift()];
    }
    return data.days[key];
  }

  return {
    // egy játék elindult: a résztvevő (nem bot) játékosok neve csak az egyedi napi létszámhoz kell
    gameStarted(names = []) {
      const d = day();
      d.started++;
      const ids = new Set(data.today.ids);
      for (const n of names) { if (ids.size >= MAX_TODAY_IDS) break; ids.add(tag(n)); }
      data.today.ids = [...ids];
      d.players = ids.size;
      save();
    },
    // a főoldal megnyitása (server.js GET /): ip a valódi játékos-cím (client-ip.js), ua a böngésző; invite: szobalinkről (/?room=KÓD)
    visit({ ip = '', ua = '', invite = false } = {}) {
      const d = day();
      if (!data.today.salt) data.today.salt = crypto.randomBytes(16).toString('hex');
      if (!Array.isArray(data.today.visitors)) data.today.visitors = [];
      if (!visitorSet) visitorSet = new Set(data.today.visitors);
      d.views = (d.views || 0) + 1;
      if (invite) d.invites = (d.invites || 0) + 1;
      const id = crypto.createHash('sha256').update(data.today.salt + '|' + ip + '|' + ua).digest('hex').slice(0, 12);
      if (!visitorSet.has(id) && visitorSet.size < MAX_TODAY_VISITORS) { visitorSet.add(id); data.today.visitors.push(id); }
      d.visitors = visitorSet.size;
      save();
    },
    gameFinished() { day().finished++; save(); },
    gameAborted() { day().aborted++; save(); },
    // percenkénti minta: a napi csúcs és az óránkénti legtöbb
    sample({ players = 0, rooms = 0, sockets = 0 } = {}) {
      const t = now(), d = day(t);
      let changed = false;
      if (players > d.peakPlayers) { d.peakPlayers = players; changed = true; }
      if (rooms > d.peakRooms) { d.peakRooms = rooms; changed = true; }
      const h = hourOf(t);
      let last = data.hours[data.hours.length - 1];
      if (!last || last.t !== h) { last = { t: h, players: 0, rooms: 0, sockets: 0 }; data.hours.push(last); changed = true; }
      if (players > last.players) { last.players = players; changed = true; }
      if (rooms > last.rooms) { last.rooms = rooms; changed = true; }
      if (sockets > last.sockets) { last.sockets = sockets; changed = true; }
      const cut = h - (KEEP_HOURS - 1) * 3600000;
      while (data.hours.length && data.hours[0].t < cut) { data.hours.shift(); changed = true; }
      if (changed) save();
    },
    // a műszerfalnak: az utolsó `n` nap (hiányzó nap = 0) és az utolsó 48 óra (hiányzó óra = 0)
    summary(n = 30) {
      const t = now();
      day(t);
      const days = [];
      for (let i = n - 1; i >= 0; i--) {
        const key = dayOf(t - i * 86400000);
        days.push({ day: key, ...blankDay(), ...(data.days[key] || {}) });
      }
      const byHour = new Map(data.hours.map((x) => [x.t, x]));
      const hours = [];
      for (let i = KEEP_HOURS - 1; i >= 0; i--) {
        const h = hourOf(t) - i * 3600000;
        hours.push({ t: h, players: 0, rooms: 0, sockets: 0, ...(byHour.get(h) || {}) });
      }
      return { days, hours };
    },
    flush() { if (timer) { clearTimeout(timer); timer = null; try { fs.writeFileSync(file, JSON.stringify(data)); persist(); } catch (_) { /* */ } } }
  };
}

module.exports = { createActivity, dayOf, isBotAgent, KEEP_DAYS, KEEP_HOURS };
