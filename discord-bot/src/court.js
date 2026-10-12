'use strict';
// A Discord oldali felület a backend tárgyalásaihoz: jelentkezési panel, gombok, szerepsorsolás-üzenet,
// ideiglenes "Kamu | …" role-ok. NINCS saját állapota: minden a backendből jön (reconcile), így a bot
// újraindulása után a panelek, jelentkezők és szerepek a backend állapotából állnak helyre.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType, OverwriteType, MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { STRUCTURE, ROLES: SERVER_ROLES } = require('./spec');
const { findChannel } = require('./setup');
const { permissionName } = require('./permissions');
const { normName } = require('./util');
const { BackendError } = require('./backend');

const CHANNEL_NAME = STRUCTURE.flatMap((c) => c.channels).find((c) => c.name.endsWith('játék-kereső')).name;
const STAFF_NAMES = new Set(SERVER_ROLES.filter((r) => ['owner', 'dev', 'mod'].includes(r.key)).map((r) => normName(r.name)));

// A tárgyalás szerepei (a backend kulcsai) és a hozzájuk tartozó ideiglenes Discord role-ok.
const TEMP_ROLES = {
  judge: { name: 'Kamu | Bíró', label: 'Bíró', icon: '👨‍⚖️', color: 0xf1c40f },
  prosecutor: { name: 'Kamu | Ügyész', label: 'Ügyész', icon: '🔴', color: 0xe74c3c },
  defender: { name: 'Kamu | Védő', label: 'Védőügyvéd', icon: '🔵', color: 0x3498db },
  defendant: { name: 'Kamu | Vádlott', label: 'Vádlott', icon: '🧑', color: 0xf39c12 },
  witness: { name: 'Kamu | Tanú', label: 'Tanú', icon: '🗣️', color: 0x2ecc71 },
  juror: { name: 'Kamu | Esküdt', label: 'Esküdtek', icon: '👥', color: 0x9b59b6 }
};
const TEMP_ORDER = ['judge', 'prosecutor', 'defender', 'defendant', 'witness', 'juror'];
const TEMP_NAMES = new Set(Object.values(TEMP_ROLES).map((r) => normName(r.name)));
const DANGEROUS = [P.Administrator, P.ManageGuild, P.ManageRoles, P.ManageChannels, P.KickMembers, P.BanMembers, P.ManageMessages, P.ModerateMembers];

const STATUS_TEXT = {
  WAITING: 'JELENTKEZÉS', LOCKED: 'LEZÁRVA', DRAWING: 'SORSOLÁS', READY: 'SZEREPEK KIOSZTVA',
  IN_PROGRESS: 'FOLYAMATBAN', FINISHED: 'BEFEJEZVE', CANCELLED: 'LEMONDVA'
};
const STATUS_COLOR = { WAITING: 0x2ecc71, LOCKED: 0xf1c40f, DRAWING: 0xf1c40f, READY: 0x3498db, IN_PROGRESS: 0xe67e22, FINISHED: 0x7f8c8d, CANCELLED: 0xc0392b };
const LIVE = ['WAITING', 'LOCKED', 'DRAWING', 'READY', 'IN_PROGRESS'];

const BTN = (id, action, label, style, disabled) => new ButtonBuilder().setCustomId(`kamu:court:${action}:${id}`).setLabel(label).setStyle(style).setDisabled(!!disabled);

function mention(p) { return p.discordUserId ? `<@${p.discordUserId}>` : `**${p.name}**`; }

function renderPanel(s, gameUrl) {
  const live = LIVE.includes(s.status);
  const embed = new EmbedBuilder()
    .setColor(STATUS_COLOR[s.status] || 0x95a5a6)
    .setTitle(live ? '⚖️ ÚJ KAMU BÍRÓSÁGI TÁRGYALÁS' : s.status === 'FINISHED' ? '🏁 A TÁRGYALÁS BEFEJEZŐDÖTT' : '✖️ A TÁRGYALÁS LEMONDVA')
    .setDescription(`**Ügy:** #${s.caseNo}\n**Állapot:** ${STATUS_TEXT[s.status] || s.status}`)
    .addFields({ name: `Játékosok: ${s.participants.length}/${s.maxPlayers}`, value: s.participants.map((p) => `• ${mention(p)}`).join('\n') || '—' })
    .setFooter({ text: `Kamu Bíróság • kamu:court:${s.id}` });
  if (s.participants.some((p) => p.role)) {
    const lines = TEMP_ORDER.map((r) => {
      const who = s.participants.filter((p) => p.role === r);
      return who.length ? `${TEMP_ROLES[r].icon} **${TEMP_ROLES[r].label}:** ${who.map(mention).join(', ')}` : null;
    }).filter(Boolean);
    embed.addFields({ name: 'Szerepek', value: lines.join('\n') });
  }
  if (live) {
    // A link egyből a tárgyalás szobájába visz (a szerver szükség esetén létrehozza), és jelentkezésnek is számít.
    const where = (s.roomCode ? `Szobakód: **${s.roomCode}**\n` : '') + (gameUrl ? `${gameUrl}/?court=${s.id}\n` : '');
    embed.addFields({ name: 'Csatlakozás', value: where + 'A linkkel egyből a szobába lépsz (jelentkezésnek is számít).' });
  }
  if (live && s.discord && (s.discord.chatChannelId || s.discord.voiceChannelId)) {
    embed.addFields({ name: 'Csatornák (csak a jelentkezőknek)', value: [s.discord.chatChannelId ? '💬 <#' + s.discord.chatChannelId + '>' : null, s.discord.voiceChannelId ? '🔊 <#' + s.discord.voiceChannelId + '>' : null, 'A tárgyalás végén törlődnek.'].filter(Boolean).join('\n') });
  }
  if (s.status === 'CANCELLED' && s.cancelReason) embed.addFields({ name: 'Ok', value: s.cancelReason });
  const components = [];
  if (live) {
    components.push(new ActionRowBuilder().addComponents(
      BTN(s.id, 'join', '⚖️ Jelentkezem', ButtonStyle.Success, s.status !== 'WAITING'),
      BTN(s.id, 'leave', '❌ Visszalépek', ButtonStyle.Secondary, s.status === 'IN_PROGRESS'),
      ...(gameUrl ? [new ButtonBuilder().setLabel('🚪 Belépés a szobába').setStyle(ButtonStyle.Link).setURL(`${gameUrl}/?court=${s.id}`)] : []),
      ...(s.discord && s.discord.voiceChannelId && s.discord.guildId ? [new ButtonBuilder().setLabel('🔊 Hangcsatorna').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${s.discord.guildId}/${s.discord.voiceChannelId}`)] : [])));
    components.push(new ActionRowBuilder().addComponents(
      s.status === 'LOCKED' ? BTN(s.id, 'unlock', '🔓 Megnyit', ButtonStyle.Secondary, false) : BTN(s.id, 'lock', '🔒 Lezár', ButtonStyle.Secondary, s.status !== 'WAITING'),
      BTN(s.id, 'draw', '🎲 Sorsolás', ButtonStyle.Primary, !['WAITING', 'LOCKED', 'READY'].includes(s.status)),
      BTN(s.id, 'start', '▶️ Indítás', ButtonStyle.Success, s.status !== 'READY'),
      BTN(s.id, 'finish', '🏁 Vége', ButtonStyle.Secondary, s.status !== 'IN_PROGRESS'),
      BTN(s.id, 'cancel', '✖️ Lemond', ButtonStyle.Danger, false)));
  }
  return { embeds: [embed], components };
}

function rolesEmbed(s) {
  const lines = TEMP_ORDER.map((r) => {
    const who = s.participants.filter((p) => p.role === r);
    return who.length ? `${TEMP_ROLES[r].icon} **${TEMP_ROLES[r].label}:** ${who.map(mention).join(', ')}` : null;
  }).filter(Boolean);
  return new EmbedBuilder().setColor(0x3498db).setTitle('🎲 A SZEREPEK KIOSZTVA').setDescription(`Ügy: #${s.caseNo}\n${lines.join('\n')}`);
}

function isStaff(member) {
  if (!member) return false;
  if (member.guild && member.guild.ownerId === member.id) return true;
  if (member.permissions && member.permissions.has(P.Administrator)) return true;
  return !!(member.roles && member.roles.cache && member.roles.cache.some((r) => STAFF_NAMES.has(normName(r.name))));
}

const ERROR_TEXT = {
  not_linked: '🔗 A Discord-fiókod még nincs összekötve a Kamu-fiókoddal.\n1. Jelentkezz be a weboldalon, a menüben kattints az **Összekötés** gombra.\n2. A kapott kódot írd be itt: `/kapcsol kod:<kód>`.\nEzután újra megnyomhatod a gombot.',
  forbidden: '⛔ Ezt a műveletet a tárgyalás vezetője vagy a stáb végezheti.',
  full: '🚫 A tárgyalás betelt.',
  closed_signup: '🔒 A jelentkezés lezárult.'
};
const OK_TEXT = {
  join: '⚖️ Jelentkeztél! A weboldalon is megjelentél.', leave: '👋 Visszaléptél.', lock: '🔒 A jelentkezés lezárva.', unlock: '🔓 A jelentkezés újra nyitva.',
  draw: '🎲 A szerepek kiosztva!', start: '▶️ A tárgyalás elindult!', finish: '🏁 A tárgyalás befejezve.', cancel: '✖️ A tárgyalás lemondva.'
};

const CHAT_ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.AddReactions];
const VOICE_ALLOW = [P.ViewChannel, P.Connect, P.Speak];
const chatName = (s) => '⚖️・targyalas-' + String(s.id).replace(/^KAMU-/, '');
const voiceName = (s) => '🔊 Tárgyalás #' + String(s.id).replace(/^KAMU-/, '');

function createCourtSync({ client, backend, gameUrl = '', log = console, onBug = () => {}, reconcileEveryMs = 60000, chatGraceMs = 10 * 60 * 1000, now = () => Date.now() }) {
  const lastRender = new Map(); // id -> JSON (felesleges szerkesztés elkerülése)
  const cache = new Map();      // id -> legutóbbi backend-állapot (role-ütközések elkerülése)
  const chains = new Map();     // id -> Promise (egy tárgyalás egyeztetései sorban futnak)
  let stopStream = null, timer = null;

  function guildFor(s) {
    if (s.discord && s.discord.guildId && client.guilds.cache.get(s.discord.guildId)) return client.guilds.cache.get(s.discord.guildId);
    const only = (process.env.DISCORD_GUILD_ID || '').trim();
    if (only) return client.guilds.cache.get(only) || null;
    return client.guilds.cache.first() || null;
  }

  // ----- ideiglenes role-ok -----
  async function ensureTempRole(guild, key) {
    const spec = TEMP_ROLES[key];
    let role = guild.roles.cache.find((r) => !r.managed && normName(r.name) === normName(spec.name));
    if (!role) role = await guild.roles.create({ name: spec.name, color: spec.color, hoist: false, mentionable: false, permissions: [], reason: 'Kamu Bíróság tárgyalás' });
    return role;
  }
  const safeRole = (guild, role) => role && !role.managed && role.id !== guild.id && TEMP_NAMES.has(normName(role.name)) &&
    !DANGEROUS.some((b) => role.permissions.has(b, false)) && role.position < guild.members.me.roles.highest.position;

  async function memberOf(guild, did) {
    try { return await guild.members.fetch(did); } catch (e) { return null; } // kilépett / nem tag
  }

  // Egy tag ideiglenes role-jait a kívánt (vagy üres) állapotra hozza. Csak a "Kamu | …" role-okhoz nyúl.
  async function setMemberTempRoles(guild, member, wantKeys) {
    const wantNames = new Set(wantKeys.map((k) => normName(TEMP_ROLES[k].name)));
    for (const role of [...member.roles.cache.values()]) {
      if (TEMP_NAMES.has(normName(role.name)) && !wantNames.has(normName(role.name)) && safeRole(guild, role)) {
        await member.roles.remove(role, 'Kamu Bíróság: tárgyalás vége / szerepváltás');
      }
    }
    for (const key of wantKeys) {
      const role = await ensureTempRole(guild, key);
      if (!safeRole(guild, role)) { log.error(`[bot] a(z) ${role.name} role nem kezelhető (a bot role-ja legyen magasabb).`); continue; }
      if (!member.roles.cache.has(role.id)) await member.roles.add(role, 'Kamu Bíróság: kisorsolt szerep');
    }
  }

  // Más élő tárgyalás is kérheti ugyanazt a tagot: a levételnél figyelembe vesszük.
  function wantedElsewhere(exceptId, did) {
    const out = [];
    for (const [id, s] of cache) {
      if (id === exceptId || !['READY', 'IN_PROGRESS'].includes(s.status)) continue;
      for (const p of s.participants) if (p.discordUserId === did && p.role) out.push(p.role);
    }
    return out;
  }

  async function syncRoles(guild, s) {
    const wanted = {};
    if (['READY', 'IN_PROGRESS'].includes(s.status)) {
      for (const p of s.participants) if (p.discordUserId && p.role) wanted[p.discordUserId] = [p.role];
    }
    const applied = (s.discord && s.discord.appliedRoles) || {};
    const next = {};
    for (const did of new Set([...Object.keys(wanted), ...Object.keys(applied)])) {
      const member = await memberOf(guild, did);
      if (!member) { continue; }
      const want = [...new Set([...(wanted[did] || []), ...(wanted[did] ? [] : wantedElsewhere(s.id, did))])];
      await setMemberTempRoles(guild, member, want);
      if (wanted[did]) next[did] = wanted[did];
    }
    const same = JSON.stringify(Object.entries(next).sort()) === JSON.stringify(Object.entries(applied).sort());
    if (!same) await backend.setAppliedRoles(s.id, next);
  }

  // ----- panel -----
  async function fetchMessage(channel, id) {
    try { return await channel.messages.fetch(id); } catch (e) { return null; }
  }
  async function ensurePanel(guild, channel, s) {
    const payload = renderPanel(s, gameUrl);
    const key = JSON.stringify(payload.embeds.map((e) => e.toJSON())) + JSON.stringify(payload.components.map((c) => c.toJSON()));
    let msg = s.discord && s.discord.messageId ? await fetchMessage(channel, s.discord.messageId) : null;
    if (!msg) {
      msg = await channel.send(payload);
      await backend.setPanel(s.id, { guildId: guild.id, channelId: channel.id, messageId: msg.id });
      lastRender.set(s.id, key);
      return msg;
    }
    if (lastRender.get(s.id) !== key) { await msg.edit(payload); lastRender.set(s.id, key); }
    return msg;
  }
  async function announceOnce(channel, s, key, build) {
    if (await backend.announce(s.id, key)) await channel.send(build());
  }

  // ----- a tárgyalás saját csatornái (csevegő + hang): csak a jelentkezők (és a stáb) látják; a tárgyalás végén törlődnek -----
  const AUX = {
    chat: { key: 'chatChannelId', name: chatName, type: ChannelType.GuildText, allow: CHAT_ALLOW, set: (id, v) => backend.setChat(id, v) },
    voice: { key: 'voiceChannelId', name: voiceName, type: ChannelType.GuildVoice, allow: VOICE_ALLOW, set: (id, v) => backend.setVoice(id, v) }
  };
  const wantedMembers = (s) => new Set(s.participants.filter((p) => p.discordUserId).map((p) => p.discordUserId));
  function auxOverwrites(guild, s, kind) {
    const spec = AUX[kind];
    const out = [
      { id: guild.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: guild.members.me.id, type: OverwriteType.Member, allow: kind === 'voice' ? [P.ViewChannel, P.Connect, P.Speak] : [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks] }
    ];
    for (const r of SERVER_ROLES.filter((x) => ['owner', 'dev', 'mod'].includes(x.key))) {
      const role = guild.roles.cache.find((x) => !x.managed && normName(x.name) === normName(r.name));
      if (role) out.push({ id: role.id, type: OverwriteType.Role, allow: spec.allow });
    }
    for (const did of wantedMembers(s)) out.push({ id: did, type: OverwriteType.Member, allow: spec.allow });
    return out;
  }
  async function ensureAux(guild, panelChannel, s, kind) {
    const spec = AUX[kind];
    s.discord = s.discord || {};
    let ch = s.discord[spec.key] ? guild.channels.cache.get(s.discord[spec.key]) : null;
    if (!ch) {
      const base = {
        name: spec.name(s), type: spec.type, parent: panelChannel.parentId || undefined, reason: 'Kamu Bíróság tárgyalás-csatorna'
      };
      if (kind === 'chat') base.topic = 'A(z) #' + s.caseNo + ' tárgyalás csevegője. A tárgyalás végén ez a csatorna törlődik.';
      try {
        ch = await guild.channels.create({ ...base, permissionOverwrites: auxOverwrites(guild, s, kind) });
      } catch (e) {
        // pl. egy jelentkező már nem tagja a szervernek: alap-jogokkal létrehozzuk, a tagokat egyenként adjuk hozzá
        log.error('[bot] a(z) ' + kind + ' csatorna teljes jogosultság-listával nem jött létre (' + e.message + '), egyenként próbálom.');
        ch = await guild.channels.create({ ...base, permissionOverwrites: auxOverwrites(guild, { ...s, participants: [] }, kind) });
      }
      await spec.set(s.id, ch.id);
      s.discord[spec.key] = ch.id;
      if (kind === 'chat' && await backend.announce(s.id, 'chat:welcome')) {
        await ch.send({ embeds: [new EmbedBuilder().setColor(0xc9a227).setTitle('💬 A tárgyalás csevegője')
          .setDescription('Itt beszélgethettek a(z) **#' + s.caseNo + '** tárgyalás alatt (csak a jelentkezők és a stáb látja).\nA csatornák a tárgyalás végén (pl. ha a gazda kilép) automatikusan törlődnek.')] }).catch(() => {});
      }
      if (wantedMembers(s).size && ![...wantedMembers(s)].every((d) => ch.permissionOverwrites.cache.has(d))) await syncAuxMembers(ch, s, guild, kind);
      return ch;
    }
    await syncAuxMembers(ch, s, guild, kind);
    return ch;
  }
  async function syncAuxMembers(ch, s, guild, kind) {
    // jogosultságok igazítása a jelentkezőkhöz (új jelentkező belép, aki visszalépett, kikerül)
    const me = guild.members.me.id, want = wantedMembers(s), allow = AUX[kind].allow;
    for (const did of want) {
      if (ch.permissionOverwrites.cache.has(did)) continue;
      try { await ch.permissionOverwrites.edit(did, Object.fromEntries(allow.map((b) => [permissionName(b), true])), { reason: 'jelentkezett' }); }
      catch (e) { log.error('[bot] a csatorna-jog nem adható meg (' + did + '): ' + e.message); } // pl. nem tagja a szervernek
    }
    for (const ow of [...ch.permissionOverwrites.cache.values()]) {
      const isMember = ow.type !== undefined ? ow.type === OverwriteType.Member : !guild.roles.cache.has(ow.id);
      if (isMember && ow.id !== me && !want.has(ow.id)) await ch.permissionOverwrites.delete(ow.id, 'visszalépett');
    }
  }
  // true = a csatornák nincsenek (már) kint; false = még kint vannak (a befejezett tárgyalás türelmi ideje / törlési hiba)
  async function closeAux(guild, s) {
    const d = s.discord || {};
    if (!d.chatChannelId && !d.voiceChannelId) return true;
    if (s.status === 'FINISHED' && now() - (s.finishedAt || 0) < chatGraceMs) return false; // a befejezés után még egy ideig megmarad
    let ok = true;
    for (const kind of Object.keys(AUX)) {
      const spec = AUX[kind], id = d[spec.key];
      if (!id) continue;
      const ch = guild.channels.cache.get(id);
      if (ch) {
        try { await ch.delete('A tárgyalás véget ért'); } catch (e) { log.error('[bot] a csatorna törlése nem sikerült: ' + e.message); ok = false; continue; }
      }
      await spec.set(s.id, '');
      d[spec.key] = '';
    }
    return ok;
  }

  async function reconcileOne(s) {
    cache.set(s.id, s);
    const guild = guildFor(s);
    if (!guild) return;
    const channel = s.discord && s.discord.channelId && guild.channels.cache.get(s.discord.channelId) ||
      findChannel(guild, CHANNEL_NAME, [ChannelType.GuildText], null);
    if (!channel) { log.error(`[bot] hiányzik a(z) ${CHANNEL_NAME} csatorna – futtasd a /setup-repair parancsot.`); return; }
    const live = LIVE.includes(s.status);
    s.discord = s.discord || {};
    if (!s.discord.guildId) s.discord.guildId = guild.id; // a hangcsatorna linkjéhez (a backend a panel kitételekor jegyzi meg)
    // 1) role-ok (a tárgyalás vége után is eltávolítjuk, ha maradt)
    await syncRoles(guild, s);
    // 2) csevegőcsatorna (élő tárgyalásnál létrehozza / igazítja; a végén törli)
    let chatDone = true;
    try {
      if (live) { await ensureAux(guild, channel, s, 'chat'); await ensureAux(guild, channel, s, 'voice'); } else chatDone = await closeAux(guild, s);
    } catch (e) {
      log.error('[bot] a tárgyalás-csevegő kezelése sikertelen (' + s.id + '): ' + e.message);
      if (!live) chatDone = false;
    }
    // 3) panel
    if (live || (s.discord && s.discord.messageId)) await ensurePanel(guild, channel, s);
    // 4) egyszeri állapotüzenetek (a backend jegyzi, melyik ment ki: újraindítás után sem duplikál)
    if (s.status === 'READY') {
      await announceOnce(channel, s, 'drawn:' + (s.drawnAt || 0), () => ({ embeds: [rolesEmbed(s)] }));
    }
    if (s.status === 'IN_PROGRESS') {
      await announceOnce(channel, s, 'started', () => ({ embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('⚖️ A TÁRGYALÁS ELKEZDŐDÖTT!').setDescription(`Ügy: #${s.caseNo}` + (s.roomCode ? `\nSzobakód: **${s.roomCode}**` : ''))] }));
    }
    if (!live && !chatDone) return; // a csevegő törlésére még vár: később újra
    if (!live) {
      const title = s.status === 'FINISHED' ? '🏁 A TÁRGYALÁS BEFEJEZŐDÖTT' : '✖️ A TÁRGYALÁS LEMONDVA';
      await announceOnce(channel, s, 'end:' + s.status, () => ({ embeds: [new EmbedBuilder().setColor(STATUS_COLOR[s.status]).setTitle(title).setDescription(`Ügy: #${s.caseNo}\nAz ideiglenes szerepek lekerültek.`)] }));
      await backend.announce(s.id, 'closed:' + s.status); // a backend innen tudja: a Discord-takarítás kész
      cache.delete(s.id);
    }
  }

  function reconcile(id) {
    const next = (chains.get(id) || Promise.resolve()).catch(() => {}).then(async () => {
      let s;
      try { s = await backend.getSession(id); } catch (e) { if (e instanceof BackendError && e.status === 404) return; throw e; }
      await reconcileOne(s);
    }).catch((e) => log.error(`[bot] egyeztetési hiba (${id}):`, e.message));
    chains.set(id, next);
    return next;
  }
  async function reconcileAll() {
    let list;
    try { list = await backend.listSessions(); } catch (e) { log.error('[bot] a tárgyalások lekérése sikertelen:', e.message); return; }
    for (const s of list) await reconcile(s.id);
  }

  // ----- interakciók -----
  async function handleButton(interaction) {
    const m = /^kamu:court:(join|leave|lock|unlock|draw|start|finish|cancel):(KAMU-\d+)$/.exec(interaction.customId);
    if (!m) return false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [, action, id] = m;
    try {
      const r = await backend.act(id, action, {
        discordUserId: interaction.user.id, discordUsername: interaction.user.username,
        staff: isStaff(interaction.member), requestId: interaction.id,
        ...(action === 'draw' && cache.get(id) && cache.get(id).status === 'READY' ? { force: true } : {})
      });
      await interaction.editReply((r.already ? 'ℹ️ Ez már megtörtént. ' : '') + OK_TEXT[action]);
    } catch (e) {
      await interaction.editReply(ERROR_TEXT[e.code] || ('❌ ' + (e.message || 'Hiba történt.')));
    }
    reconcile(id);
    return true;
  }

  async function handleLinkCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const r = await backend.link({ code: interaction.options.getString('kod', true), discordUserId: interaction.user.id, discordUsername: interaction.user.username });
      await interaction.editReply(`✅ Összekötve a(z) **${r.kamuUsername}** Kamu-fiókkal. Mostantól a Discordról is jelentkezhetsz a tárgyalásokra.`);
    } catch (e) {
      await interaction.editReply('❌ ' + (e.message || 'Az összekötés nem sikerült.'));
    }
  }

  async function handleOpenCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const r = await backend.createSession({ discordUserId: interaction.user.id, discordUsername: interaction.user.username });
      await interaction.editReply((r.already ? 'ℹ️ Ehhez már van tárgyalás. ' : '⚖️ A tárgyalás megnyílt! ') + `Ügy: **#${r.session.id}**
A jelentkezési panel pár másodpercen belül megjelenik a 🎮・játék-kereső csatornában.
Érd el a szobát: ${gameUrl ? gameUrl + '/?court=' + r.session.id : 'a weboldalon'}`);
      reconcile(r.session.id);
    } catch (e) {
      await interaction.editReply(ERROR_TEXT[e.code] || ('❌ ' + (e.message || 'Nem sikerült megnyitni a tárgyalást.')));
    }
  }

  function start() {
    if (!backend.enabled) { log.log('[bot] BACKEND_URL / BOT_SERVICE_TOKEN hiányzik: a tárgyalás-integráció ki van kapcsolva (a /setup működik).'); return; }
    let pending = new Map();
    stopStream = backend.subscribe((evt) => {
      if (evt && evt.type === 'bug') { onBug(); return; } // új hibajelentés: a bug-szinkron rögtön kiposztolja
      clearTimeout(pending.get(evt.sessionId));
      pending.set(evt.sessionId, setTimeout(() => { pending.delete(evt.sessionId); reconcile(evt.sessionId); }, 150));
    }, { onOpen: () => { log.log('[bot] kapcsolódva a Kamu Bíróság szerverhez.'); reconcileAll(); } });
    timer = setInterval(reconcileAll, reconcileEveryMs);
    if (timer.unref) timer.unref();
  }
  function stop() { if (stopStream) stopStream(); clearInterval(timer); }

  return { start, stop, reconcile, reconcileAll, handleButton, handleLinkCommand, handleOpenCommand, renderPanel: (s) => renderPanel(s, gameUrl), _cache: cache };
}

module.exports = { createCourtSync, renderPanel, isStaff, TEMP_ROLES, TEMP_NAMES, CHANNEL_NAME };
