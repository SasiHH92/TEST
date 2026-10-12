'use strict';
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { runSetup, checkStatus, findRole } = require('./setup');
const { JOIN_BUTTON_ID, ACCEPT_BUTTON_ID } = require('./content');
const { postJoinCard } = require('./joincard');
const { ROLES } = require('./spec');

const adminOnly = (b) => b.setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setContexts(0);

const DEFINITIONS = [
  adminOnly(new SlashCommandBuilder().setName('setup').setDescription('Felépíti a teljes Kamu Bíróság szervert (role-ok, csatornák, jogok, embedek)')),
  adminOnly(new SlashCommandBuilder().setName('setup-status').setDescription('Ellenőrzi, hogy minden role, csatorna és jogosultság megvan-e')),
  new SlashCommandBuilder().setName('kapcsol').setDescription('Összeköti a Discord-fiókodat a Kamu Bíróság fiókoddal')
    .setContexts(0)
    .addStringOption((o) => o.setName('kod').setDescription('A weboldalon kapott egyszer használatos kód').setRequired(true).setMinLength(6).setMaxLength(12)),
  new SlashCommandBuilder().setName('targyalas').setDescription('Új Kamu Bíróság-tárgyalás nyitása (a szobát a rendszer automatikusan létrehozza)').setContexts(0),
  new SlashCommandBuilder().setName('tamogatas').setDescription('Önkéntesen támogathatod a Kamu Bíróság fejlesztését (nem jár érte előny)').setContexts(0),
  adminOnly(new SlashCommandBuilder().setName('moderacio').setDescription('Az automatikus moderáció állapota és statisztikája')),
  adminOnly(new SlashCommandBuilder().setName('setup-repair').setDescription('Pótolja a hiányzó elemeket, a közösségi tartalmat nem törli')),
].map((c) => c.toJSON());

// Csak a szerver tulajdonosa vagy Administrator jogú tag. (A Discord-oldali alapértelmezés
// felülírható a szerverbeállításokban, ezért a bot maga is ellenőriz.)
function isAuthorized(interaction) {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  return !!interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
}

const ICON = { ok: '✅', warn: '⚠️', fail: '❌' };

function formatReport(title, report) {
  const lines = [`**${title}**`];
  if (report.created.length) lines.push(`🆕 Létrehozva (${report.created.length}):`, ...report.created.map((l) => `• ${l}`));
  if (report.fixed.length) lines.push(`🔧 Javítva (${report.fixed.length}):`, ...report.fixed.map((l) => `• ${l}`));
  lines.push(`✔️ Már megvolt: ${report.kept} elem`);
  if (report.warnings.length) lines.push('⚠️ Figyelmeztetés:', ...[...new Set(report.warnings)].map((l) => `• ${l}`));
  if (report.errors.length) lines.push('❌ Hiba:', ...[...new Set(report.errors)].map((l) => `• ${l}`));
  if (report.errors.some((l) => /nem látja|Missing Access/i.test(l))) {
    lines.push('🔧 **Teendő:** a bot nem látja a fenti csatornákat (valószínűleg egy korábbi futás elrejtette előle). Szerverbeállítások → Szerepkörök → a bot role-ja → add meg ideiglenesen az **Administrator** jogot, futtasd újra a `/setup-repair` parancsot, majd **vedd le** az Administrator jogot (a javítás után a bot saját jogot kap a csatornákra).');
  }
  if (!report.errors.length) lines.push('🎉 Kész.');
  return lines.join('\n');
}

function formatStatus(status) {
  const bad = status.items.filter((i) => i.level !== 'ok');
  const okCount = status.items.length - bad.length;
  const lines = [`**Szerver állapot: ${status.ok ? '✅ minden rendben' : '❌ hiányosságok vannak'}**`, `${okCount}/${status.items.length} ellenőrzés rendben.`];
  if (bad.length) lines.push(...bad.map((i) => `${ICON[i.level]} ${i.text}`));
  if (!status.ok) lines.push('\nJavítás: `/setup-repair`');
  return lines.join('\n');
}

// Discord üzenethossz-korlát: 2000 karakter
function clip(text) {
  return text.length <= 1900 ? text : text.slice(0, 1890) + '\n… (rövidítve)';
}

async function handleCommand(interaction) {
  if (!isAuthorized(interaction)) {
    return interaction.reply({ content: '⛔ Ezt a parancsot csak a szerver tulajdonosa vagy egy Administrator jogú tag használhatja.', flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  switch (interaction.commandName) {
    case 'setup':
      return interaction.editReply(clip(formatReport('Setup', await runSetup(guild, { mode: 'setup' }))));
    case 'setup-repair':
      return interaction.editReply(clip(formatReport('Javítás', await runSetup(guild, { mode: 'repair' }))));
    case 'setup-status':
      return interaction.editReply(clip(formatStatus(await checkStatus(guild))));
    default:
      return interaction.editReply('Ismeretlen parancs.');
  }
}

async function handleButton(interaction) {
  if (!interaction.guild || (interaction.customId !== JOIN_BUTTON_ID && interaction.customId !== ACCEPT_BUTTON_ID)) return false;
  const eph = MessageFlags.Ephemeral;
  // A régi üdvözlő gomb már nem ad rangot: előbb a szabályzatot kell elfogadni.
  if (interaction.customId === JOIN_BUTTON_ID) {
    await interaction.reply({ content: '📜 Előbb olvasd el a **szabályzat** csatornát, és ott kattints a **✅ Elolvastam és elfogadom** gombra.', flags: eph });
    return true;
  }
  const role = findRole(interaction.guild, ROLES.find((r) => r.key === 'player').name);
  if (!role) {
    await interaction.reply({ content: 'A ⚖️ Játékos role még nem létezik – szólj egy adminnak.', flags: eph });
    return true;
  }
  if (interaction.member.roles.cache.has(role.id)) {
    await interaction.reply({ content: '✅ A szabályzatot már elfogadtad, a Játékos rangod megvan.', flags: eph });
    return true;
  }
  try {
    await interaction.member.roles.add(role, 'Szabályzat elfogadva');
    await interaction.reply({ content: '✅ Elfogadtad a szabályzatot! Üdv a bíróságon – megkaptad a **Játékos** rangot, a szerver többi része megnyílt.', flags: eph });
    await postJoinCard(interaction.guild, interaction.member.displayName || (interaction.user && interaction.user.username));
  } catch {
    await interaction.reply({ content: 'Nem sikerült a rangot kiosztani. Szólj egy adminnak.', flags: eph });
  }
  return true;
}

// A /tamogatas válasza (csak a kérőnek látszik): rövid, nyomásmentes, hivatkozással a támogatási oldalra. Nincs ígéret ellenszolgáltatásra.
function supportPayload(baseUrl) {
  const url = String(baseUrl || '').trim().replace(/\/+$/, '');
  const embed = new EmbedBuilder().setColor(0xc9a227).setTitle('❤️ Támogasd a Kamu Bíróságot!')
    .setDescription('„A tárgyalás ingyenes, de a fejlesztő kávéja nem!” ☕\nA támogatás teljesen önkéntes, és nem jár érte semmilyen ellenszolgáltatás vagy játékbeli előny.');
  if (!url) return { embeds: [embed], components: [] };
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('A támogatási oldal').setEmoji('❤️').setStyle(ButtonStyle.Link).setURL(url + '/tamogatas'))] };
}

module.exports = { supportPayload, DEFINITIONS, isAuthorized, handleCommand, handleButton, formatReport, formatStatus };
