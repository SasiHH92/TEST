'use strict';
// A weboldalon beküldött hibajelentések kiposztolása a 🐛・hibajelentés csatornába (fórumbejegyzés vagy sima üzenet).
// A backend a forrás: a bot a várakozó jelentéseket lekérdezi, kiposztolja, majd késznek jelöli (így újraindításkor sem vész el, és nem duplikál).
const { EmbedBuilder, ChannelType } = require('discord.js');
const { findChannel } = require('./setup');

const CHANNEL_NAME = '🐛・hibajelentés';
const KIND_LABEL = { bug: 'Hiba', sound: 'Hang / Voice', ui: 'Kinézet / UI', room: 'Szoba / Lobby', other: 'Egyéb' };
const KIND_TAG = { bug: null, sound: 'Hang / Voice', ui: 'Kinézet / UI', room: 'Szoba / Lobby', other: null };
const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function reportEmbed(r) {
  const e = new EmbedBuilder().setColor(0xe74c3c).setTitle(clip(`🐞 ${r.id} – ${KIND_LABEL[r.kind] || 'Hiba'}`, 250))
    .setDescription(clip(r.text, 3500))
    .addFields(
      { name: 'Beküldte', value: clip(r.name || 'vendég', 60) + (r.account ? ' (fiókos)' : ' (vendég)'), inline: true },
      { name: 'Hol', value: clip(r.where || '–', 40), inline: true },
    )
    .setTimestamp(new Date(r.ts)).setFooter({ text: 'Kamu Bíróság • weboldali hibajelentés' });
  if (r.room) e.addFields({ name: 'Szobakód', value: r.room, inline: true });
  if (r.userAgent) e.addFields({ name: 'Eszköz', value: clip(r.userAgent, 160) });
  return e;
}

async function postOne(guild, r) {
  const ch = findChannel(guild, CHANNEL_NAME, [ChannelType.GuildForum], null) || findChannel(guild, CHANNEL_NAME, [ChannelType.GuildText], null);
  if (!ch) return null;
  const payload = { embeds: [reportEmbed(r)], allowedMentions: { parse: [] } };
  if (ch.type === ChannelType.GuildForum) {
    const wanted = KIND_TAG[r.kind];
    const tag = wanted && ch.availableTags ? ch.availableTags.find((t) => t.name === wanted) : null;
    const th = await ch.threads.create({ name: clip(`${r.id} – ${KIND_LABEL[r.kind] || 'Hiba'}: ${r.text.replace(/\s+/g, ' ')}`, 90), message: payload, appliedTags: tag ? [tag.id] : [] });
    return th.id;
  }
  const m = await ch.send(payload);
  return m.id;
}

function createBugSync({ client, backend, onlyGuild = '', log = console, everyMs = 15000 }) {
  let timer = null, busy = false;
  async function drain() {
    if (busy || !backend.enabled) return 0;
    busy = true;
    let done = 0;
    try {
      const list = await backend.pendingBugs();
      const guilds = [...client.guilds.cache.values()].filter((g) => !onlyGuild || g.id === onlyGuild);
      for (const r of list) {
        let ref = null;
        for (const g of guilds) { try { ref = await postOne(g, r); } catch (e) { log.error('[bot] hibajelentés posztolása sikertelen:', e.message); } if (ref) break; }
        if (!ref) continue; // nincs csatorna / hiba: később újra próbáljuk
        await backend.bugPosted(r.id, ref);
        done++;
      }
    } catch (e) { log.error('[bot] hibajelentések lekérdezése sikertelen:', e.message); } finally { busy = false; }
    return done;
  }
  return {
    drain,
    start() { drain(); timer = setInterval(drain, everyMs); if (timer.unref) timer.unref(); },
    stop() { clearInterval(timer); }
  };
}

module.exports = { createBugSync, reportEmbed, CHANNEL_NAME };
