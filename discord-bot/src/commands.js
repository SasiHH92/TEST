'use strict';
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { runSetup, checkStatus, findRole } = require('./setup');
const { JOIN_BUTTON_ID } = require('./content');
const { ROLES } = require('./spec');

const adminOnly = (b) => b.setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setContexts(0);

const DEFINITIONS = [
  adminOnly(new SlashCommandBuilder().setName('setup').setDescription('Felépíti a teljes Kamu Bíróság szervert (role-ok, csatornák, jogok, embedek)')),
  adminOnly(new SlashCommandBuilder().setName('setup-status').setDescription('Ellenőrzi, hogy minden role, csatorna és jogosultság megvan-e')),
  new SlashCommandBuilder().setName('kapcsol').setDescription('Összeköti a Discord-fiókodat a Kamu Bíróság fiókoddal')
    .setContexts(0)
    .addStringOption((o) => o.setName('kod').setDescription('A weboldalon kapott egyszer használatos kód').setRequired(true).setMinLength(6).setMaxLength(12)),
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
  if (report.errors.length) lines.push('❌ Hiba:', ...report.errors.map((l) => `• ${l}`));
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
  if (interaction.customId !== JOIN_BUTTON_ID || !interaction.guild) return false;
  const role = findRole(interaction.guild, ROLES.find((r) => r.key === 'player').name);
  if (!role) {
    await interaction.reply({ content: 'A ⚖️ Játékos role még nem létezik – szólj egy adminnak.', flags: MessageFlags.Ephemeral });
    return true;
  }
  try {
    await interaction.member.roles.add(role, 'Játékos gomb');
    await interaction.reply({ content: '⚖️ Üdv a bíróságon! Megkaptad a **Játékos** rangot.', flags: MessageFlags.Ephemeral });
  } catch {
    await interaction.reply({ content: 'Nem sikerült a rangot kiosztani. Szólj egy adminnak.', flags: MessageFlags.Ephemeral });
  }
  return true;
}

module.exports = { DEFINITIONS, isAuthorized, handleCommand, handleButton, formatReport, formatStatus };
