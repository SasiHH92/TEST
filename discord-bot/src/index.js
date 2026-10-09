'use strict';
require('dotenv').config({ quiet: true });
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { DEFINITIONS, handleCommand, handleButton } = require('./commands');
const announcer = require('./announcer');
const { createBackend } = require('./backend');
const { createCourtSync } = require('./court');

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('Hiányzik a DISCORD_BOT_TOKEN. Másold a .env.example fájlt .env néven, és töltsd ki (lásd README.md).');
  process.exit(1);
}
const onlyGuild = (process.env.DISCORD_GUILD_ID || '').trim();

// Egyetlen intent: Guilds. Privilegizált intent (tagok, üzenettartalom) NEM kell.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
announcer.attach(client);

// Kamu Bíróság backend (a web az igazság): URL + szolgáltatás-token. Nélkülük csak a /setup parancsok működnek.
const backend = createBackend({ baseUrl: process.env.BACKEND_URL, token: process.env.BOT_SERVICE_TOKEN });
const court = createCourtSync({ client, backend, gameUrl: (process.env.KAMU_GAME_URL || process.env.BACKEND_URL || '').trim().replace(/\/+$/, '') });

async function registerCommands(guild) {
  if (onlyGuild && guild.id !== onlyGuild) return;
  try {
    await guild.commands.set(DEFINITIONS);
    console.log(`[bot] parancsok regisztrálva: ${guild.name}`);
  } catch (err) {
    console.error(`[bot] parancsregisztráció sikertelen (${guild.name}):`, err.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] bejelentkezve: ${c.user.tag}`);
  for (const guild of c.guilds.cache.values()) await registerCommands(guild);
  court.start();
});
client.on(Events.GuildCreate, registerCommands);

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (onlyGuild && interaction.guildId !== onlyGuild) return;
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'kapcsol') await court.handleLinkCommand(interaction);
      else await handleCommand(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('kamu:court:')) await court.handleButton(interaction);
      else await handleButton(interaction);
    }
  } catch (err) {
    console.error('[bot] interakció hiba:', err);
    const msg = '❌ Váratlan hiba történt, nézd meg a bot naplóját.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, ephemeral: true });
    } catch { /* az interakció lejárt */ }
  }
});

client.on(Events.Error, (err) => console.error('[bot] kliens hiba:', err.message));
process.on('unhandledRejection', (err) => console.error('[bot] unhandledRejection:', err));
process.on('SIGINT', () => { court.stop(); return client.destroy().finally(() => process.exit(0)); });

client.login(token).catch((err) => {
  console.error('[bot] belépés sikertelen (rossz token?):', err.message);
  process.exit(1);
});

module.exports = { client, announcer };
