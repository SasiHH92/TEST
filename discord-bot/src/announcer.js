'use strict';
// Későbbi játék-integráció: a Kamu Bíróság szerver ezekkel a függvényekkel küldhet
// Discord-értesítést. A klienst a bot index.js állítja be (attach).
const { EmbedBuilder } = require('discord.js');
const { ChannelType } = require('discord.js');
const { STRUCTURE } = require('./spec');
const { findChannel } = require('./setup');

let client = null;

function attach(c) {
  client = c;
}

function channelSpec(key) {
  for (const cat of STRUCTURE) for (const ch of cat.channels) if (ch.name.endsWith(key)) return ch;
  return null;
}

function resolve(guild, suffix) {
  const spec = channelSpec(suffix);
  return spec ? findChannel(guild, spec.name, [ChannelType.GuildText], null) : null;
}

function guilds(guildId) {
  if (!client) throw new Error('A Discord bot nincs elindítva.');
  if (guildId) return [client.guilds.cache.get(guildId)].filter(Boolean);
  return [...client.guilds.cache.values()];
}

// Új tárgyalás: bejelentés a 🎮・játék-kereső csatornába, a kód a 🔑・szobakódok csatornába.
async function announceNewTrial({ roomCode, host, mode, joinUrl, guildId } = {}) {
  if (!roomCode) throw new Error('roomCode kötelező');
  const embed = new EmbedBuilder()
    .setColor(0xc9a227)
    .setTitle('⚖️ ÚJ TÁRGYALÁS')
    .setDescription(`${host ? `**${host}** ` : 'Valaki '}tárgyalást nyitott! Szobakód: **${roomCode}**`)
    .setFooter({ text: 'Kamu Bíróság' });
  if (mode) embed.addFields({ name: 'Mód', value: String(mode), inline: true });
  if (joinUrl) embed.addFields({ name: 'Csatlakozás', value: joinUrl, inline: true });
  let sent = 0;
  for (const guild of guilds(guildId)) {
    for (const suffix of ['játék-kereső', 'szobakódok']) {
      const ch = resolve(guild, suffix);
      if (ch) { await ch.send({ embeds: [embed] }); sent++; }
    }
  }
  return sent;
}

// Eredmény/ítélet az 🏆・eredmények csatornába.
async function announceResult({ title, description, guildId } = {}) {
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle(title || '🏆 Ítélethirdetés').setDescription(description || '').setFooter({ text: 'Kamu Bíróság' });
  let sent = 0;
  for (const guild of guilds(guildId)) {
    const ch = resolve(guild, 'eredmények');
    if (ch) { await ch.send({ embeds: [embed] }); sent++; }
  }
  return sent;
}

module.exports = { attach, announceNewTrial, announceResult };
