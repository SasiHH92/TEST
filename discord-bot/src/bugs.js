'use strict';
// A weboldalon beküldött hibajelentések kiposztolása a 🐛・hibajelentés csatornába (fórumbejegyzés vagy sima üzenet), a jelentés alatt
// állapot-választóval (Új / Folyamatban / Jegelve / Megoldva / Elvetve / Nem reprodukálható), amit csak a stáb állíthat.
// A backend a forrás: a bot a várakozó jelentéseket lekérdezi, kiposztolja, majd késznek jelöli (így újraindításkor sem vész el, és nem duplikál);
// az állapot is a backendben tárolódik, a Discord-üzenet csak megjeleníti.
const { EmbedBuilder, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { findChannel } = require('./setup');
const { STRUCTURE } = require('./spec');

const CHANNEL_NAME = '🐛・hibajelentés';
const STAFF_LOG = STRUCTURE.flatMap((c) => c.channels).find((c) => c.name.endsWith('mod-napló')).name;
const KIND_LABEL = { bug: 'Hiba', sound: 'Hang / Voice', ui: 'Kinézet / UI', room: 'Szoba / Lobby', other: 'Egyéb' };
const KIND_TAG = { bug: null, sound: 'Hang / Voice', ui: 'Kinézet / UI', room: 'Szoba / Lobby', other: null };
const SCREEN_LABEL = { auth: 'Belépés', name: 'Névválasztás', menu: 'Főmenü', lobby: 'Lobbi', game: 'Játék közben' };
// állapot: kulcs -> felirat, emoji, színe, a fórum megfelelő címkéje (ha van)
const STATUS = {
  new: { label: 'Új', emoji: '🐞', color: 0xe74c3c, tag: null },
  progress: { label: 'Folyamatban', emoji: '🔧', color: 0xf39c12, tag: 'Folyamatban' },
  ice: { label: 'Jegelve', emoji: '🧊', color: 0x74b9ff, tag: 'Jegelve' },
  done: { label: 'Megoldva', emoji: '✅', color: 0x2ecc71, tag: 'Megoldva' },
  wontfix: { label: 'Elvetve', emoji: '🚫', color: 0x7f8c8d, tag: null },
  cantrepro: { label: 'Nem reprodukálható', emoji: '❓', color: 0x9b59b6, tag: 'Nem reprodukálható' }
};
const STATUS_TAGS = new Set(Object.values(STATUS).map((s) => s.tag).filter(Boolean));
const SELECT_PREFIX = 'kamu:bug:status:';
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function reportEmbed(r) {
  const st = STATUS[r.status] || STATUS.new;
  const e = new EmbedBuilder().setColor(st.color).setTitle(clip(`${st.emoji} ${r.id} – ${KIND_LABEL[r.kind] || 'Hiba'}`, 250))
    .setDescription(clip(r.text, 3500))
    .addFields(
      { name: 'Állapot', value: `${st.emoji} ${st.label}`, inline: true },
      { name: 'Beküldte', value: clip(r.name || 'vendég', 60) + (r.account ? ' (fiókos)' : ' (vendég)'), inline: true },
      { name: 'Hol', value: clip(SCREEN_LABEL[r.where] || r.where || '–', 40), inline: true },
    )
    .setTimestamp(new Date(r.ts))
    .setFooter({ text: 'Kamu Bíróság • weboldali hibajelentés' + (r.statusBy ? ' • állapotot állította: ' + clip(r.statusBy, 40) : '') });
  if (r.room) e.addFields({ name: 'Szobakód', value: r.room, inline: true });
  if (r.userAgent) e.addFields({ name: 'Eszköz', value: clip(r.userAgent, 160) });
  return e;
}

// A jelentés alatti állapot-választó (az aktuális állapot előre kijelölve).
function statusRow(r) {
  const cur = STATUS[r.status] ? r.status : 'new';
  const menu = new StringSelectMenuBuilder().setCustomId(SELECT_PREFIX + r.id).setPlaceholder('Állapot módosítása (csak a stáb)')
    .addOptions(Object.entries(STATUS).map(([key, s]) => ({ label: s.label, value: key, emoji: s.emoji, default: key === cur })));
  return new ActionRowBuilder().addComponents(menu);
}

// Kiposztolás a hibajelentés csatornába (fórumbejegyzés vagy sima üzenet). Hibát dob, ha nincs csatorna vagy a Discord elutasítja.
async function postOne(guild, r) {
  const ch = findChannel(guild, CHANNEL_NAME, [ChannelType.GuildForum], null) || findChannel(guild, CHANNEL_NAME, [ChannelType.GuildText], null);
  if (!ch) throw new Error('nincs "' + CHANNEL_NAME + '" csatorna (futtasd a /setup-repair parancsot)');
  const payload = { embeds: [reportEmbed(r)], components: [statusRow(r)], allowedMentions: { parse: [] } };
  if (ch.type === ChannelType.GuildForum) {
    const wanted = KIND_TAG[r.kind];
    const tag = wanted && ch.availableTags ? ch.availableTags.find((t) => t.name === wanted) : null;
    const th = await ch.threads.create({ name: clip(`${r.id} – ${KIND_LABEL[r.kind] || 'Hiba'}: ${r.text.replace(/\s+/g, ' ')}`, 90), message: payload, appliedTags: tag ? [tag.id] : [] });
    return th.id;
  }
  const m = await ch.send(payload);
  return m.id;
}

// Tartalék: ha a hibajelentés csatornába nem sikerül, a jelentés a stáb naplócsatornájába kerül (a hiba okával), hogy ne vesszen el.
async function postFallback(guild, r, reason) {
  const ch = findChannel(guild, STAFF_LOG, [ChannelType.GuildText], null);
  if (!ch) return null;
  const m = await ch.send({ content: '⚠️ A hibajelentést nem sikerült a **' + CHANNEL_NAME + '** csatornába tenni, ezért itt van. Ok: `' + clip(reason, 300).replace(/`/g, "'") + '`', embeds: [reportEmbed(r)], components: [statusRow(r)], allowedMentions: { parse: [] } });
  return m.id;
}

function createBugSync({ client, backend, onlyGuild = '', log = console, everyMs = 15000, isStaff = () => false }) {
  let timer = null, busy = false, again = false;
  async function run() {
    let done = 0;
    const list = await backend.pendingBugs();
    const guilds = [...client.guilds.cache.values()].filter((g) => !onlyGuild || g.id === onlyGuild);
    if (list.length && !guilds.length) log.error('[bot] hibajelentés vár, de a bot egy szerverben sem tag.');
    for (const r of list) {
      let ref = null, reason = '';
      for (const g of guilds) {
        try { ref = await postOne(g, r); } catch (e) { reason = e.message || String(e); log.error('[bot] hibajelentés (' + r.id + ') posztolása sikertelen:', reason); }
        if (!ref) { try { ref = await postFallback(g, r, reason || 'ismeretlen'); } catch (e) { log.error('[bot] a tartalék posztolás is sikertelen:', e.message); } }
        if (ref) break;
      }
      if (!ref) continue; // semelyik csatorna nem működik: a következő körben újra próbáljuk
      await backend.bugPosted(r.id, ref);
      log.log('[bot] hibajelentés kiposztolva: ' + r.id + (reason ? ' (tartalék csatornába)' : ''));
      done++;
    }
    return done;
  }
  async function drain() {
    if (!backend.enabled) return 0;
    if (busy) { again = true; return 0; } // közben új jelentés jött: a futás végén még egyszer lefutunk
    busy = true;
    let done = 0;
    try {
      do { again = false; done += await run(); } while (again);
    } catch (e) { log.error('[bot] hibajelentések lekérdezése sikertelen:', e.message); } finally { busy = false; }
    return done;
  }

  // Az állapot-választó kezelése: csak a stáb módosíthat; az új állapot a backendbe kerül, az üzenet (és a fórum címkéje) frissül.
  async function handleSelect(interaction) {
    const id = interaction.customId.startsWith(SELECT_PREFIX) ? interaction.customId.slice(SELECT_PREFIX.length) : null;
    if (!id) return false;
    const eph = MessageFlags.Ephemeral;
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: '⛔ A hibajelentések állapotát csak a stáb (Tulajdonos, Fejlesztő, Moderátor) módosíthatja.', flags: eph });
      return true;
    }
    const status = interaction.values && interaction.values[0];
    if (!STATUS[status]) { await interaction.reply({ content: 'Ismeretlen állapot.', flags: eph }); return true; }
    let r;
    try {
      r = await backend.bugStatus(id, status, (interaction.member && interaction.member.displayName) || (interaction.user && interaction.user.username) || '');
    } catch (e) {
      await interaction.reply({ content: '❌ Az állapotot nem sikerült elmenteni: ' + (e.message || 'ismeretlen hiba'), flags: eph });
      return true;
    }
    await interaction.update({ embeds: [reportEmbed(r)], components: [statusRow(r)] });
    // fórumbejegyzésnél a megfelelő címke is: a régi állapot-címkék lecserélődnek, a típus-címkék maradnak
    try {
      const th = interaction.channel;
      if (th && th.isThread && th.isThread() && th.parent && th.parent.type === ChannelType.GuildForum) {
        const tags = th.parent.availableTags || [];
        const keep = (th.appliedTags || []).filter((tid) => { const t = tags.find((x) => x.id === tid); return t && !STATUS_TAGS.has(t.name); });
        const want = STATUS[status].tag && tags.find((t) => t.name === STATUS[status].tag);
        await th.setAppliedTags(want ? [...keep, want.id].slice(0, 5) : keep);
      }
    } catch (e) { log.error('[bot] a fórum-címke frissítése nem sikerült:', e.message); }
    return true;
  }

  return {
    drain,
    handleSelect,
    start() { drain(); timer = setInterval(drain, everyMs); if (timer.unref) timer.unref(); },
    stop() { clearInterval(timer); }
  };
}

module.exports = { createBugSync, reportEmbed, statusRow, STATUS, CHANNEL_NAME };
