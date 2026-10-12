'use strict';
// Vicces "bírósági" kártya, ha valaki elfogadja a szabályzatot és belép a bíróságra. A kártya az 💬・általános csatornába kerül.
// Nem kér privilegizált intentet: a ✅ gomb lenyomásakor készül. A név csak szövegként szerepel (nincs pingelés).
const { EmbedBuilder, ChannelType, escapeMarkdown } = require('discord.js');
const { findChannel } = require('./setup');

const CHANNEL_NAME = '💬・általános';
const CHARGES = [
  'Gyanús, hogy túl jól nézett ki a belépőjén',
  'Jogosulatlan jókedv a tárgyalóteremben',
  'Szándékos belépés bírói engedély nélkül',
  'Közveszélyes mémgyártás',
  'Hamis tanúzás a saját profilképe ellen',
  'Lopott kávé a bírói pulpituson',
  'Zaklatás: túl lelkesen köszönt mindenkit',
  'Tiltott fegyverviselés (nagyon éles poénok)',
];
const VERDICTS = [
  'Bűnös, de szerethető. Felfüggesztett kuncogás.',
  'Felmentve, mert a bíró éppen nem figyelt.',
  'Három nap kötelező nevetés.',
  'A bíróság úgy dönt: marad, és hozza a rágcsát.',
  'Elhalasztva, amíg elő nem kerül egy jó kamu alibi.',
  'Ítélet: örökös esküdti státusz.',
];
const pick = (list, n) => list[Math.abs(n) % list.length];

function joinCard(name, seed = Date.now()) {
  const clean = String(name || 'Ismeretlen').replace(/\s+/g, ' ').slice(0, 60);
  return new EmbedBuilder().setColor(0xc9a227).setTitle('⚖️ ÚJ VÁDLOTT A TEREMBEN')
    .setDescription('**' + clean + '** csatlakozott a Kamu Bírósághoz! 🎉')
    .addFields(
      { name: '📜 Vád', value: pick(CHARGES, seed) },
      { name: '🔨 Előzetes ítélet', value: pick(VERDICTS, seed >> 3) },
    ).setFooter({ text: 'Kamu Bíróság • minden kamu, kivéve a jókedv' });
}

async function postJoinCard(guild, name, log = console) {
  try {
    const ch = findChannel(guild, CHANNEL_NAME, [ChannelType.GuildText], null);
    if (!ch) return false;
    await ch.send({ embeds: [joinCard(name)], allowedMentions: { parse: [] } });
    return true;
  } catch (e) { log.error('[bot] belépő-kártya sikertelen:', e.message); return false; }
}

module.exports = { joinCard, postJoinCard, CHANNEL_NAME };
