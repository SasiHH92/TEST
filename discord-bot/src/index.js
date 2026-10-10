'use strict';
// A bot két módon indulhat:
//  - önállóan:   node src/index.js   (a .env fájlból; a saját gépeden vagy külön szolgáltatásként)
//  - beágyazva:  a játék szervere (server.js) hívja a startBot()-ot ugyanabban a folyamatban, így nem kell külön gép.
// A require() önmagában semmit nem indít el.
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { DEFINITIONS, handleCommand, handleButton, isAuthorized } = require('./commands');
const announcer = require('./announcer');
const { createBackend } = require('./backend');
const { createCourtSync } = require('./court');
const { createModerator, loadConfig } = require('./moderation');

/**
 * @param {object} o
 *  token, backendUrl, serviceToken, gameUrl, guildId, embedded (true: hiba esetén nem lép ki a folyamat), log, env
 */
function startBot(o) {
  const log = o.log || console;
  const env = o.env || process.env;
  const onlyGuild = String(o.guildId || '').trim();
  const fatal = (msg) => { log.error(msg); if (!o.embedded) process.exit(1); };
  if (!o.token) { fatal('Hiányzik a DISCORD_BOT_TOKEN. Másold a .env.example fájlt .env néven, és töltsd ki (lásd README.md).'); return null; }

  const backend = createBackend({ baseUrl: o.backendUrl, token: o.serviceToken, log });
  let current = null;

  // withModeration: üzenet-olvasó intentek (GuildMessages + MessageContent, utóbbi PRIVILEGIZÁLT: a Developer Portalon engedélyezni kell).
  // Ha a Portalon nincs engedélyezve, a bot moderáció nélkül indul újra (a játék-integráció nem sérül).
  function boot(withModeration) {
    const intents = [GatewayIntentBits.Guilds];
    if (withModeration) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
    const client = new Client({ intents });
    announcer.attach(client);
    const court = createCourtSync({ client, backend, gameUrl: String(o.gameUrl || o.backendUrl || '').trim().replace(/\/+$/, ''), log });
    const modConfig = loadConfig(env);
    const moderator = createModerator({ client, log, config: { ...modConfig, enabled: withModeration } });

    async function registerCommands(guild) {
      if (onlyGuild && guild.id !== onlyGuild) return;
      try {
        await guild.commands.set(DEFINITIONS);
        log.log(`[bot] parancsok regisztrálva: ${guild.name}`);
      } catch (err) {
        log.error(`[bot] parancsregisztráció sikertelen (${guild.name}):`, err.message);
      }
    }

    client.once(Events.ClientReady, async (c) => {
      log.log(`[bot] bejelentkezve: ${c.user.tag}` + (withModeration ? ' (moderáció: be)' : ''));
      for (const guild of c.guilds.cache.values()) await registerCommands(guild);
      court.start();
    });
    client.on(Events.GuildCreate, registerCommands);

    if (withModeration) {
      const onMessage = (edited) => async (a, b) => {
        try {
          const message = edited ? b : a;
          if (onlyGuild && message.guildId !== onlyGuild) return;
          if (message.partial) { try { await message.fetch(); } catch (_) { return; } }
          await moderator.handleMessage(message, { edited });
        } catch (err) { log.error('[moderáció] hiba:', err.message); }
      };
      client.on(Events.MessageCreate, onMessage(false));
      client.on(Events.MessageUpdate, onMessage(true));
    }

    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (onlyGuild && interaction.guildId !== onlyGuild) return;
        if (interaction.isChatInputCommand()) {
          if (interaction.commandName === 'kapcsol') await court.handleLinkCommand(interaction);
          else if (interaction.commandName === 'targyalas') await court.handleOpenCommand(interaction);
          else if (interaction.commandName === 'moderacio') {
            if (!isAuthorized(interaction)) await interaction.reply({ content: '⛔ Ezt csak admin használhatja.', ephemeral: true });
            else await moderator.handleCommand(interaction);
          } else await handleCommand(interaction);
        } else if (interaction.isButton()) {
          if (interaction.customId.startsWith('kamu:court:')) await court.handleButton(interaction);
          else if (interaction.customId.startsWith('kamu:mod:')) await moderator.handleButton(interaction);
          else await handleButton(interaction);
        }
      } catch (err) {
        log.error('[bot] interakció hiba:', err);
        const msg = '❌ Váratlan hiba történt, nézd meg a bot naplóját.';
        try {
          if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
          else await interaction.reply({ content: msg, ephemeral: true });
        } catch { /* az interakció lejárt */ }
      }
    });

    client.on(Events.Error, (err) => log.error('[bot] kliens hiba:', err.message));
    client.login(o.token).catch((err) => {
      court.stop();
      client.destroy();
      if (withModeration && (err.code === 'DisallowedIntents' || /disallowed intents/i.test(err.message))) {
        log.error('[bot] A „Message Content Intent” nincs engedélyezve a Developer Portalon (Bot fül → Privileged Gateway Intents), ezért a moderáció nélkül indulok újra.');
        current = boot(false);
        return;
      }
      fatal('[bot] belépés sikertelen (rossz token?): ' + err.message);
    });
    return { client, court, moderator, stop: () => { court.stop(); return client.destroy(); } };
  }

  current = boot(loadConfig(env).enabled);
  return { get client() { return current.client; }, get court() { return current.court; }, get moderator() { return current.moderator; }, stop: () => current.stop() };
}

module.exports = { startBot, announcer };

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const bot = startBot({
    token: process.env.DISCORD_BOT_TOKEN, backendUrl: process.env.BACKEND_URL, serviceToken: process.env.BOT_SERVICE_TOKEN,
    gameUrl: process.env.KAMU_GAME_URL || process.env.BACKEND_URL, guildId: process.env.DISCORD_GUILD_ID
  });
  process.on('unhandledRejection', (err) => console.error('[bot] unhandledRejection:', err));
  process.on('SIGINT', () => { if (bot) Promise.resolve(bot.stop()).finally(() => process.exit(0)); else process.exit(0); });
}
