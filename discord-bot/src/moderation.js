'use strict';
// Discord-moderáció: szabálymotor (modrules) + opcionális MI (modai) + büntetési létra + stáb-napló + visszavonás.
// Bekapcsolás: MODERATION=1 (és a Developer Portalon a „Message Content Intent” engedélyezése; lásd README).
// A stáb tagjait (Tulajdonos / Fejlesztő / Moderátor role, Administrator, szerver-tulajdonos) és a botokat nem moderáljuk.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType } = require('discord.js');
const { STRUCTURE } = require('./spec');
const { evaluate, createFloodTracker, worst } = require('./modrules');
const { createAi } = require('./modai');
const wordlists = require('./wordlists');
const { isStaff } = require('./court');
const { letters } = require('./modtext');

const LOG_NAME = STRUCTURE.flatMap((c) => c.channels).find((c) => c.name.endsWith('mod-napló')).name;
const STRIKE_WINDOW_MS = 24 * 60 * 60 * 1000;
const POINTS = { low: 1, medium: 2, high: 4 };
const UNDO_PREFIX = 'kamu:mod:untimeout:';
const SEV_COLOR = { low: 0xf1c40f, medium: 0xe67e22, high: 0xe74c3c };

function loadConfig(env = process.env) {
  return {
    enabled: env.MODERATION === '1',
    profanity: env.MOD_PROFANITY === 'off' ? 'off' : 'delete',
    ai: env.MOD_AI === '1' && !!env.ANTHROPIC_API_KEY,
    aiKey: env.ANTHROPIC_API_KEY || '',
    aiModel: env.MOD_AI_MODEL || 'claude-haiku-5-5',
    aiText: ['all', 'off'].includes(env.MOD_AI_TEXT) ? env.MOD_AI_TEXT : 'new', // new = az 1 hétnél frissebb tagok szövege
    wordlistFile: env.MOD_WORDLIST_FILE || ''
  };
}

function createModerator({ client, log = console, config = loadConfig(), fetchImpl = fetch, now = () => Date.now(), setTimer = setTimeout } = {}) {
  const lists = wordlists.load(config.wordlistFile);
  const flood = createFloodTracker({ now });
  const ai = createAi({ apiKey: config.ai ? config.aiKey : '', model: config.aiModel, fetchImpl, now, log });
  const strikes = new Map(); // userId -> [{ t, points }]
  const stats = { checked: 0, deleted: 0, timeouts: 0, aiCalls: 0, aiFlags: 0, byRule: {} };

  const strikesOf = (id) => { const t = now(); const l = (strikes.get(id) || []).filter((s) => t - s.t < STRIKE_WINDOW_MS); strikes.set(id, l); return l; };

  function logChannel(guild) {
    return guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === LOG_NAME) || null;
  }
  const exemptChannel = (ch) => !!ch && ch.name === LOG_NAME;

  async function aiFindings(message, member, text) {
    if (!ai.enabled) return [];
    const out = [];
    const flag = (v, rule) => {
      if (!v) return;
      stats.aiCalls++;
      if (v.severity >= 2 && v.confidence >= 0.7) {
        stats.aiFlags++;
        out.push({ rule, severity: v.severity >= 3 ? 'high' : 'medium', category: v.category, reason: 'MI-értékelés: ' + (v.reason || v.category), ai: true });
      }
    };
    const atts = [...(message.attachments ? message.attachments.values() : [])].filter(ai.isScannableImage).slice(0, 3);
    for (const a of atts) flag(await ai.classifyImage(a.url), 'ai-image');
    const wantsText = config.aiText === 'all' || (config.aiText === 'new' && member && member.joinedTimestamp && now() - member.joinedTimestamp < 7 * 24 * 3600 * 1000);
    if (!out.length && wantsText && letters(text).length >= 12) flag(await ai.classifyText(text), 'ai-text');
    return out;
  }

  async function notify(message, text) {
    try {
      const m = await message.channel.send({ content: text, allowedMentions: { users: [message.author.id] } });
      setTimer(() => { m.delete().catch(() => {}); }, 9000).unref?.();
    } catch (_) { /* nincs jog a csatornában */ }
  }

  function snippet(text) {
    const t = String(text || '').replace(/```/g, "'''").slice(0, 300);
    return t ? '```\n' + t + '\n```' : '*(nincs szöveg)*';
  }

  async function handleMessage(message, { edited = false } = {}) {
    if (!message || !message.guild || !message.author || message.author.bot || message.webhookId || message.system) return null;
    if (exemptChannel(message.channel)) return null;
    const member = message.member;
    if (isStaff(member)) return null;
    stats.checked++;
    const text = message.content || '';
    const attachments = [...(message.attachments ? message.attachments.values() : [])].map((a) => ({ name: a.name, contentType: a.contentType, size: a.size }));
    const base = evaluate(text, {
      lists, opts: { profanity: config.profanity },
      mentionUsers: message.mentions && message.mentions.users ? message.mentions.users.size : 0,
      mentionRoles: message.mentions && message.mentions.roles ? message.mentions.roles.size : 0,
      mentionEveryone: !!(message.mentions && message.mentions.everyone),
      attachments
    }).findings;
    let findings = [...base, ...(edited ? [] : flood.check(message.author.id, text, message.channel.id))];
    if (!findings.length) findings = await aiFindings(message, member, text);
    if (!findings.length) return null;

    const top = worst(findings);
    for (const f of findings) stats.byRule[f.rule] = (stats.byRule[f.rule] || 0) + 1;

    // 1) törlés
    let deleted = false;
    try { await message.delete(); deleted = true; stats.deleted++; } catch (_) { /* már törölve / nincs jog */ }

    // 2) büntetés-létra (24 órás ablak)
    const list = strikesOf(message.author.id);
    list.push({ t: now(), points: POINTS[top.severity] });
    const total = list.reduce((n, s) => n + s.points, 0);
    let timeoutMin = total >= 10 ? 1440 : total >= 7 ? 60 : total >= 4 ? 10 : 0;
    if (top.severity === 'high') timeoutMin = Math.max(timeoutMin, 60);
    let timedOut = false, timeoutNote = '';
    if (timeoutMin) {
      if (member && member.moderatable !== false && typeof member.timeout === 'function') {
        try { await member.timeout(timeoutMin * 60 * 1000, 'Automatikus moderáció: ' + top.rule); timedOut = true; stats.timeouts++; }
        catch (e) { timeoutNote = 'A némítás nem sikerült (jog / hierarchia): ' + (e.message || e); log.error('[moderáció] ' + timeoutNote); }
      } else timeoutNote = 'A tag nem némítható (a bot role-ja nem elég magas).';
    }

    // 3) a tag értesítése (DM, ha lehet) + rövid, magától eltűnő jelzés a csatornában
    const warn = `Az üzeneted törölve lett a(z) **${message.guild.name}** szerveren: ${top.reason}.` + (timedOut ? ` Ideiglenesen némítva vagy (${timeoutMin} perc).` : '') + ' Kérjük, tartsd be a 📜・szabályzat pontjait.';
    let dm = false;
    try { await message.author.send(warn); dm = true; } catch (_) { /* tiltott DM */ }
    if (!dm) await notify(message, `<@${message.author.id}>, az üzeneted törölve: ${top.reason}.`);

    // 4) stáb-napló
    const ch = logChannel(message.guild);
    if (ch) {
      const embed = new EmbedBuilder().setColor(SEV_COLOR[top.severity]).setTitle(`🛡️ Moderáció: ${top.rule}${edited ? ' (szerkesztett üzenet)' : ''}`)
        .addFields(
          { name: 'Tag', value: `<@${message.author.id}> (${message.author.username})`, inline: true },
          { name: 'Csatorna', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Súlyosság', value: `${top.severity} • pontok (24 óra): ${total}`, inline: true },
          { name: 'Ok', value: findings.map((f) => f.reason).join('; ').slice(0, 900) },
          { name: 'Művelet', value: [deleted ? 'üzenet törölve' : 'törlés nem sikerült', timedOut ? `némítva ${timeoutMin} percre` : null, dm ? 'DM-ben értesítve' : null, timeoutNote || null].filter(Boolean).join(' • ') },
          { name: 'Tartalom', value: snippet(text) + (attachments.length ? '\nMellékletek: ' + attachments.map((a) => a.name).join(', ').slice(0, 200) : '') }
        ).setTimestamp(new Date(now()));
      const payload = { embeds: [embed] };
      if (timedOut) payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(UNDO_PREFIX + message.author.id).setLabel('↩ Visszavonás (téves volt)').setStyle(ButtonStyle.Secondary))];
      try { await ch.send(payload); } catch (e) { log.error('[moderáció] a napló-csatornába nem sikerült írni: ' + e.message); }
    }
    return { action: 'moderated', rule: top.rule, severity: top.severity, deleted, timedOut, timeoutMin, total, findings };
  }

  // Stáb: a némítás visszavonása (téves riasztás), a büntetőpontok törlésével
  async function handleButton(interaction) {
    if (!interaction.customId.startsWith(UNDO_PREFIX)) return false;
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: '⛔ Ezt csak a stáb teheti.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const userId = interaction.customId.slice(UNDO_PREFIX.length);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const member = await interaction.guild.members.fetch(userId);
      await member.timeout(null, 'Moderáció visszavonva: ' + interaction.user.username);
      strikes.delete(userId);
      await interaction.editReply('↩ A némítás feloldva, a büntetőpontok törölve.');
    } catch (e) {
      await interaction.editReply('❌ Nem sikerült: ' + (e.message || e));
    }
    return true;
  }

  async function handleCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(describe());
  }

  function describe() {
    const rules = Object.entries(stats.byRule).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', ') || '—';
    return [
      '**Moderáció:** ' + (config.enabled ? '✅ bekapcsolva' : '⚪ kikapcsolva (MODERATION=1 kell, lásd README)'),
      `Vizsgált üzenetek: ${stats.checked} • törölt: ${stats.deleted} • némítás: ${stats.timeouts}`,
      `Szabályok szerint: ${rules}`,
      `Káromkodás: ${config.profanity === 'off' ? 'engedett' : 'törlés'} • MI: ${ai.enabled ? `bekapcsolva (${config.aiModel}, szöveg: ${config.aiText}); hívások: ${stats.aiCalls}, jelzések: ${stats.aiFlags}` : 'kikapcsolva'}`,
      `Napló-csatorna: ${LOG_NAME}`
    ].join('\n');
  }

  return { handleMessage, handleButton, handleCommand, describe, stats, config, _strikes: strikes };
}

module.exports = { createModerator, loadConfig, LOG_NAME, UNDO_PREFIX };
