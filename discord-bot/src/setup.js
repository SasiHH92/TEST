'use strict';
// A szerver felépítése (/setup), helyreállítása (/setup-repair) és ellenőrzése (/setup-status).
// Soha nem töröl semmit: csak létrehoz, kiegészít, jogosultságot javít. Minden lépés idempotens.
const { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ROLES, PRESETS, STRUCTURE, TAGS, TYPE_OF } = require('./spec');
const { normName } = require('./util');
const { missingBotPermissions, permissionName } = require('./permissions');
const content = require('./content');

const REASON = 'Kamu Bíróság setup';
const isCommunity = (guild) => Array.isArray(guild.features) && guild.features.includes('COMMUNITY');

// ---------- keresők ----------

function findRole(guild, name) {
  const key = normName(name);
  return guild.roles.cache.find((r) => !r.managed && r.id !== guild.id && normName(r.name) === key) || null;
}

function findChannel(guild, name, types, parentId) {
  const key = normName(name);
  const found = guild.channels.cache.filter((c) => types.includes(c.type) && normName(c.name) === key);
  return found.find((c) => (c.parentId || null) === parentId) || found.first() || null;
}

function rolesByKey(guild) {
  const out = {};
  for (const r of ROLES) out[r.key] = findRole(guild, r.name);
  return out;
}

function subjectId(guild, me, roles, subject) {
  if (subject === 'everyone') return guild.roles.everyone.id;
  if (subject === 'bot') return me.id;
  return roles[subject] ? roles[subject].id : null;
}

function flagObject(rule) {
  const o = {};
  for (const b of rule.allow || []) o[permissionName(b)] = true;
  for (const b of rule.deny || []) o[permissionName(b)] = false;
  return o;
}

function overwriteMissing(channel, id, rule) {
  const ow = channel.permissionOverwrites.cache.get(id);
  const miss = [];
  for (const b of rule.allow || []) if (!ow || !ow.allow.has(b)) miss.push('+' + permissionName(b));
  for (const b of rule.deny || []) if (!ow || !ow.deny.has(b)) miss.push('-' + permissionName(b));
  return miss;
}

function tagsMissing(channel, tagKey) {
  const have = new Set((channel.availableTags || []).map((t) => normName(t.name)));
  return TAGS[tagKey].filter((t) => !have.has(normName(t.name)));
}

// ---------- jelentés ----------

function newReport() {
  return { created: [], fixed: [], kept: 0, warnings: [], errors: [] };
}

async function guarded(report, label, fn) {
  try {
    return await fn();
  } catch (err) {
    report.errors.push(`${label}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

async function getMe(guild) {
  return guild.members.me || (await guild.members.fetchMe());
}

// ---------- felépítés ----------

async function ensureRoles(guild, me, report) {
  for (const spec of ROLES) {
    let role = findRole(guild, spec.name);
    if (!role) {
      role = await guarded(report, `role ${spec.name}`, () => guild.roles.create({
        name: spec.name, color: spec.color, hoist: spec.hoist, mentionable: false, permissions: [], reason: REASON,
      }));
      if (role) report.created.push(`role: ${spec.name}`);
    } else {
      report.kept++;
    }
  }
  await orderRoles(guild, me, report);
  const botRole = findRole(guild, ROLES.find((r) => r.key === 'bot').name);
  if (botRole && !me.roles.cache.has(botRole.id)) {
    const done = await guarded(report, 'a 🤖 Bot role kiosztása a botnak', () => me.roles.add(botRole, REASON));
    if (done) report.fixed.push('a bot megkapta a 🤖 Bot role-t');
  }
}

// A saját role-ok meglévő pozíció-készletét osztja újra a kívánt sorrendben, így a közösség
// más role-jai nem mozdulnak el.
async function orderRoles(guild, me, report) {
  const list = ROLES.map((s) => findRole(guild, s.name));
  if (list.some((r) => !r)) return;
  const topBot = me.roles.highest.position;
  const above = list.filter((r) => r.position >= topBot);
  if (above.length) {
    report.warnings.push(`A bot role-ja nem a legmagasabb: ${above.map((r) => r.name).join(', ')} nem kezelhető. ` +
      'Server Settings → Roles: húzd a bot role-ját a lista tetejére (a Tulajdonos fölé).');
    return;
  }
  const inOrder = list.every((r, i) => i === 0 || list[i - 1].position > r.position);
  if (inOrder) return;
  const slots = list.map((r) => r.position).sort((a, b) => b - a);
  const updates = list.map((role, i) => ({ role, position: slots[i] }));
  const done = await guarded(report, 'role-sorrend', () => guild.roles.setPositions(updates));
  if (done) report.fixed.push('role-hierarchia rendezve');
}

async function applyPreset(guild, me, roles, channel, presetName, report, label) {
  for (const rule of PRESETS[presetName]) {
    const id = subjectId(guild, me, roles, rule.subject);
    if (!id) continue;
    const miss = overwriteMissing(channel, id, rule);
    if (!miss.length) continue;
    const ok = await guarded(report, `jogosultság ${label}`, () => channel.permissionOverwrites.edit(id, flagObject(rule), { reason: REASON }));
    if (ok) report.fixed.push(`jogosultság: ${label} (${rule.subject}) ${miss.join(' ')}`);
  }
}

async function ensureCategory(guild, spec, report) {
  let cat = findChannel(guild, spec.name, [ChannelType.GuildCategory], null);
  if (!cat) {
    cat = await guarded(report, `kategória ${spec.name}`, () => guild.channels.create({ name: spec.name, type: ChannelType.GuildCategory, reason: REASON }));
    if (cat) report.created.push(`kategória: ${spec.name}`);
  } else report.kept++;
  return cat;
}

function createOptions(guild, spec, parent) {
  const opts = { name: spec.name, parent: parent ? parent.id : undefined, reason: REASON };
  if (spec.topic) opts.topic = spec.topic;
  if (spec.slowmode) opts.rateLimitPerUser = spec.slowmode;
  return opts;
}

async function ensureChannel(guild, spec, parent, report) {
  const pid = parent ? parent.id : null;
  if (spec.kind === 'voice') {
    let ch = findChannel(guild, spec.name, [ChannelType.GuildVoice], pid);
    if (!ch) {
      ch = await guarded(report, `csatorna ${spec.name}`, () => guild.channels.create({ ...createOptions(guild, spec, parent), type: ChannelType.GuildVoice }));
      if (ch) report.created.push(`csatorna: ${spec.name}`);
    } else report.kept++;
    return ch;
  }
  if (spec.kind === 'forum') {
    let ch = findChannel(guild, spec.name, [ChannelType.GuildForum], pid);
    if (!ch && isCommunity(guild)) {
      const opts = { ...createOptions(guild, spec, parent), type: ChannelType.GuildForum };
      opts.availableTags = TAGS[spec.tags].map((t) => ({ name: t.name, emoji: { id: null, name: t.emoji } }));
      if (spec.tags === 'idea') opts.defaultReactionEmoji = { id: null, name: '👍' };
      ch = await guarded(report, `fórum ${spec.name}`, () => guild.channels.create(opts));
      if (ch) report.created.push(`fórum: ${spec.name}`);
      return ch;
    }
    if (ch) {
      report.kept++;
      const missing = tagsMissing(ch, spec.tags);
      if (missing.length) {
        const tags = [...(ch.availableTags || []), ...missing.map((t) => ({ name: t.name, emoji: { id: null, name: t.emoji } }))].slice(0, 20);
        const done = await guarded(report, `címkék ${spec.name}`, () => ch.setAvailableTags(tags, REASON));
        if (done) report.fixed.push(`fórum-címkék pótolva: ${spec.name}`);
      }
      return ch;
    }
    // Nincs Community mód → sima szövegcsatorna
    let txt = findChannel(guild, spec.name, [ChannelType.GuildText], pid);
    if (!txt) {
      txt = await guarded(report, `csatorna ${spec.name}`, () => guild.channels.create({ ...createOptions(guild, spec, parent), type: ChannelType.GuildText }));
      if (txt) report.created.push(`csatorna: ${spec.name} (szövegcsatorna – a szerver nem Community, ezért nem fórum)`);
    } else report.kept++;
    if (txt) report.warnings.push(`${spec.name}: nem fórum, mert a szerver nem Community. Kapcsold be (Server Settings → Enable Community), majd futtasd a /setup-repair parancsot – létrehozza a fórumot (a régi csatornát nem törli).`);
    return txt;
  }
  let ch = findChannel(guild, spec.name, [ChannelType.GuildText], pid);
  if (!ch) {
    ch = await guarded(report, `csatorna ${spec.name}`, () => guild.channels.create({ ...createOptions(guild, spec, parent), type: ChannelType.GuildText }));
    if (ch) report.created.push(`csatorna: ${spec.name}`);
  } else report.kept++;
  return ch;
}

// ---------- tartalom (embedek) ----------

async function findOwnMessage(channel, me, key) {
  const msgs = await channel.messages.fetch({ limit: 50 });
  return msgs.find((m) => m.author && m.author.id === me.id && content.hasMarker(m, key)) || null;
}

function welcomeComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(content.JOIN_BUTTON_ID).setLabel('Játékos leszek').setEmoji('⚖️').setStyle(ButtonStyle.Success),
  )];
}

async function ensureEmbed(channel, me, key, ctx, mode, report) {
  const payload = { embeds: [content.build(key, ctx)] };
  if (key === 'welcome') payload.components = welcomeComponents();
  const existing = await findOwnMessage(channel, me, key);
  if (!existing) {
    await channel.send(payload);
    report.created.push(`üzenet: ${channel.name} (${key})`);
  } else if (mode === 'setup') {
    await existing.edit(payload);
    report.fixed.push(`üzenet frissítve: ${channel.name} (${key})`);
  }
}

async function findThread(forum, name) {
  const active = await forum.threads.fetchActive();
  let t = active.threads.find((x) => normName(x.name) === normName(name));
  if (t) return t;
  const archived = await forum.threads.fetchArchived();
  t = archived.threads.find((x) => normName(x.name) === normName(name));
  return t || null;
}

async function ensureForumPost(forum, key, ctx, mode, report) {
  const name = key === 'bugs' ? '📌 Hibajelentés sablon – olvasd el!' : '📌 Ötletláda – olvasd el!';
  const existing = await findThread(forum, name);
  if (existing) {
    if (mode === 'setup') {
      const starter = await existing.fetchStarterMessage().catch(() => null);
      if (starter && starter.author.id === ctx.me.id) await starter.edit({ embeds: [content.build(key, ctx)] });
    }
    return;
  }
  const thread = await forum.threads.create({ name, message: { embeds: [content.build(key, ctx)] }, reason: REASON });
  report.created.push(`fórum-poszt: ${forum.name} (${key})`);
  await thread.pin(REASON).catch(() => report.warnings.push(`${forum.name}: a sablon-posztot nem sikerült kitűzni.`));
}

async function ensureContent(channel, spec, me, ctx, mode, report) {
  if (!spec.embed) return;
  if (channel.type === ChannelType.GuildForum) await ensureForumPost(channel, spec.embed, ctx, mode, report);
  else await ensureEmbed(channel, me, spec.embed, ctx, mode, report);
}

// ---------- fő belépők ----------

async function runSetup(guild, { mode = 'setup' } = {}) {
  const report = newReport();
  const me = await getMe(guild);
  const missing = missingBotPermissions(me.permissions);
  if (missing.length) {
    report.errors.push(`A botnak hiányzó jogai vannak: ${missing.join(', ')}. Hívd meg újra a README-ben lévő linkkel, vagy add meg a jogokat a bot role-jának.`);
    return report;
  }
  await guarded(report, 'role-ok', () => ensureRoles(guild, me, report));
  const roles = rolesByKey(guild);
  const ctx = { me, roles };

  for (const catSpec of STRUCTURE) {
    const cat = await ensureCategory(guild, catSpec, report);
    if (cat) await guarded(report, `kategória-jogok ${catSpec.name}`, () => applyPreset(guild, me, roles, cat, catSpec.perm, report, catSpec.name));
    for (const spec of catSpec.channels) {
      const ch = await ensureChannel(guild, spec, cat, report);
      if (!ch) continue;
      await guarded(report, `jogok ${spec.name}`, () => applyPreset(guild, me, roles, ch, spec.perm, report, spec.name));
    }
  }
  // A szabályzat csatorna említéséhez az összes csatorna létrejötte után töltjük a tartalmat
  const rulesSpec = STRUCTURE[0].channels.find((c) => c.embed === 'rules');
  const rulesCh = findChannel(guild, rulesSpec.name, [ChannelType.GuildText], null);
  ctx.rulesChannelId = rulesCh ? rulesCh.id : null;
  for (const catSpec of STRUCTURE) {
    for (const spec of catSpec.channels) {
      if (!spec.embed) continue;
      const ch = findChannel(guild, spec.name, [ChannelType.GuildForum], null) || findChannel(guild, spec.name, [ChannelType.GuildText], null);
      if (ch) await guarded(report, `tartalom ${spec.name}`, () => ensureContent(ch, spec, me, ctx, mode, report));
    }
  }
  return report;
}

async function checkStatus(guild) {
  const items = [];
  const add = (level, text) => items.push({ level, text }); // ok | warn | fail
  const me = await getMe(guild);
  const missing = missingBotPermissions(me.permissions);
  add(missing.length ? 'fail' : 'ok', missing.length ? `Bot jogok hiányoznak: ${missing.join(', ')}` : 'Bot jogok rendben');

  const roles = rolesByKey(guild);
  for (const spec of ROLES) add(roles[spec.key] ? 'ok' : 'fail', `Role: ${spec.name}${roles[spec.key] ? '' : ' – hiányzik'}`);
  const list = ROLES.map((s) => roles[s.key]);
  if (list.every(Boolean)) {
    const inOrder = list.every((r, i) => i === 0 || list[i - 1].position > r.position);
    add(inOrder ? 'ok' : 'fail', inOrder ? 'Role-hierarchia rendben' : 'Role-hierarchia hibás (futtasd: /setup-repair)');
    const above = list.filter((r) => r.position >= me.roles.highest.position);
    if (above.length) add('fail', 'A bot role-ja nem a legmagasabb – húzd a lista tetejére');
  }

  const community = isCommunity(guild);
  for (const catSpec of STRUCTURE) {
    const cat = findChannel(guild, catSpec.name, [ChannelType.GuildCategory], null);
    if (!cat) { add('fail', `Kategória hiányzik: ${catSpec.name}`); continue; }
    add('ok', `Kategória: ${catSpec.name}`);
    for (const spec of catSpec.channels) {
      const types = spec.kind === 'forum' ? [ChannelType.GuildForum, ChannelType.GuildText] : [TYPE_OF[spec.kind]];
      const found = findChannel(guild, spec.name, types, cat.id);
      let ch = found;
      if (spec.kind === 'forum') {
        const forum = findChannel(guild, spec.name, [ChannelType.GuildForum], cat.id);
        if (forum) ch = forum;
      }
      if (!ch) { add('fail', `Csatorna hiányzik: ${spec.name}`); continue; }
      if (spec.kind === 'forum' && ch.type !== ChannelType.GuildForum) {
        add(community ? 'fail' : 'warn', `${spec.name}: szövegcsatorna, nem fórum${community ? ' (futtasd: /setup-repair)' : ' (a szerver nem Community)'}`);
      } else if (spec.kind === 'forum') {
        const tm = tagsMissing(ch, spec.tags);
        add(tm.length ? 'fail' : 'ok', tm.length ? `${spec.name}: hiányzó címkék: ${tm.map((t) => t.name).join(', ')}` : `Fórum: ${spec.name}`);
      } else add('ok', `Csatorna: ${spec.name}`);
      const bad = [];
      for (const rule of PRESETS[spec.perm]) {
        const id = subjectId(guild, me, roles, rule.subject);
        if (id && overwriteMissing(ch, id, rule).length) bad.push(rule.subject);
      }
      if (bad.length) add('fail', `Jogosultság eltér: ${spec.name} (${[...new Set(bad)].join(', ')})`);
      if (spec.embed && ch.messages) {
        const key = spec.embed;
        let has = false;
        try {
          if (ch.type === ChannelType.GuildForum) {
            const t = await findThread(ch, key === 'bugs' ? '📌 Hibajelentés sablon – olvasd el!' : '📌 Ötletláda – olvasd el!');
            has = !!t;
          } else has = !!(await findOwnMessage(ch, me, key));
        } catch { has = false; }
        add(has ? 'ok' : 'fail', `${has ? 'Tartalom' : 'Tartalom hiányzik'}: ${spec.name}`);
      }
    }
    const badCat = [];
    for (const rule of PRESETS[catSpec.perm]) {
      const id = subjectId(guild, me, roles, rule.subject);
      if (id && overwriteMissing(cat, id, rule).length) badCat.push(rule.subject);
    }
    if (badCat.length) add('fail', `Kategória-jogosultság eltér: ${catSpec.name}`);
  }
  return { items, ok: items.every((i) => i.level !== 'fail') };
}

module.exports = { runSetup, checkStatus, findRole, findChannel, isCommunity };
