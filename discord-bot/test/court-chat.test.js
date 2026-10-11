'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Collection, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { makeGuild } = require('./fake-guild');
const { runSetup } = require('../src/setup');
const { createCourtSync, CHANNEL_NAME } = require('../src/court');

function session(over = {}) {
  return {
    id: 'KAMU-2001', caseNo: 'KAMU-2001', status: 'WAITING', roomCode: 'ABCD', minPlayers: 3, maxPlayers: 8, hostUserId: 'h', drawnAt: null, finishedAt: null,
    participants: [{ uid: 'h', name: 'Host', discordUserId: '111111111111', role: null }, { uid: 'a', name: 'Anna', discordUserId: '222222222222', role: null }],
    discord: { guildId: null, channelId: null, messageId: null, chatChannelId: '', announced: [], appliedRoles: {} }, ...over
  };
}
function stubBackend(state) {
  const calls = [];
  return {
    calls, enabled: true,
    getSession: async () => JSON.parse(JSON.stringify(state.s)),
    listSessions: async () => [JSON.parse(JSON.stringify(state.s))],
    setPanel: async (id, ref) => { state.s.discord = { ...state.s.discord, ...ref }; },
    setChat: async (id, cid) => { calls.push(['chat', cid]); state.s.discord.chatChannelId = cid; },
    setVoice: async (id, cid) => { calls.push(['voice', cid]); state.s.discord.voiceChannelId = cid; },
    announce: async (id, key) => { if (state.s.discord.announced.includes(key)) return false; state.s.discord.announced.push(key); return true; },
    setAppliedRoles: async () => {}
  };
}
const quiet = { logs: [], log() {}, error(...a) { this.logs.push(a.join(' ')); } };

async function env() {
  const guild = makeGuild();
  await runSetup(guild);
  guild.addMember('111111111111'); guild.addMember('222222222222');
  const state = { s: session() };
  const backend = stubBackend(state);
  quiet.logs = [];
  const court = createCourtSync({ client: { guilds: { cache: new Collection([[guild.id, guild]]) } }, backend, gameUrl: 'https://x.example', log: quiet, chatGraceMs: 0 });
  return { guild, state, backend, court };
}
const chatChannel = (guild) => [...guild.channels.cache.values()].find((c) => c.name.startsWith('⚖️・targyalas-'));
const voiceChannel = (guild) => [...guild.channels.cache.values()].find((c) => c.name.startsWith('🔊 Tárgyalás #'));

test('csevegő: a tárgyaláshoz saját, rejtett csatorna jön létre a játék kategóriában, a jelentkezők látják', async () => {
  const { guild, court } = await env();
  await court.reconcile('KAMU-2001');
  const ch = chatChannel(guild);
  assert.ok(ch);
  const panel = [...guild.channels.cache.values()].find((c) => c.name === CHANNEL_NAME);
  assert.equal(ch.parentId, panel.parentId, 'ugyanabban a kategóriában, mint a játék-kereső');
  assert.ok(ch.permissionOverwrites.cache.get(guild.roles.everyone.id).deny.has(P.ViewChannel));
  assert.ok(ch.permissionOverwrites.cache.get('222222222222').allow.has(P.ViewChannel));
  assert.equal(ch.messageStore.size, 1, 'üdvözlő üzenet egyszer');
  // privát hangcsatorna: Connect/Speak a jelentkezőknek, mások nem is látják
  const vc = voiceChannel(guild);
  assert.ok(vc, 'hangcsatorna is készül');
  assert.equal(vc.type, ChannelType.GuildVoice);
  assert.equal(vc.parentId, panel.parentId);
  assert.ok(vc.permissionOverwrites.cache.get(guild.roles.everyone.id).deny.has(P.ViewChannel));
  const vo = vc.permissionOverwrites.cache.get('222222222222');
  assert.ok(vo.allow.has(P.Connect) && vo.allow.has(P.Speak) && vo.allow.has(P.ViewChannel));
  assert.ok(!vo.allow.has(P.SendMessages), 'hangcsatornán nincs szöveg-jog');
});

test('csevegő: ha egy jelentkező már nem tagja a szervernek (a létrehozás elbukik), a csatorna és a panel akkor is létrejön', async () => {
  const { guild, state, court } = await env();
  state.s.participants.push({ uid: 'x', name: 'Kilépett', discordUserId: '999999999999', role: null });
  const orig = guild.channels.create.bind(guild.channels);
  guild.channels.create = async (opts) => {
    if ((opts.permissionOverwrites || []).some((o) => o.id === '999999999999')) throw new Error('Unknown Member');
    return orig(opts);
  };
  const origEdit = null; void origEdit;
  await court.reconcile('KAMU-2001');
  const ch = chatChannel(guild);
  assert.ok(ch, 'a csevegő létrejött');
  assert.ok(ch.permissionOverwrites.cache.has('222222222222'), 'a többi jelentkező hozzáfér');
  assert.ok([...guild.channels.cache.values()].some((c) => c.messageStore && [...c.messageStore.values()].some((m) => m.embeds.some((e) => e.footer && e.footer.text.includes('kamu:court:KAMU-2001')))), 'a panel is kint van');
});

test('hangcsatorna: a panelen link-gomb a hangcsatornára; a jelentkezés után a jelentkező hozzáfér; a visszalépő elveszti', async () => {
  const { guild, state, court } = await env();
  await court.reconcile('KAMU-2001');
  const vc = voiceChannel(guild);
  const panelMsg = [...guild.channels.cache.values()].flatMap((c) => (c.messageStore ? [...c.messageStore.values()] : [])).find((m) => m.embeds.some((e) => e.footer && e.footer.text.includes('kamu:court:KAMU-2001')));
  const links = panelMsg.components.flatMap((r) => r.toJSON().components).filter((x) => x.url).map((x) => x.url);
  assert.ok(links.includes('https://discord.com/channels/' + guild.id + '/' + vc.id), 'hangcsatorna link-gomb: ' + links);
  state.s.participants.push({ uid: 'z', name: 'Zoli', discordUserId: '333333333333', role: null });
  guild.addMember('333333333333');
  await court.reconcile('KAMU-2001');
  assert.ok(vc.permissionOverwrites.cache.get('333333333333').allow.has(P.Connect));
  state.s.participants = state.s.participants.filter((p) => p.uid !== 'z');
  await court.reconcile('KAMU-2001');
  assert.ok(!vc.permissionOverwrites.cache.has('333333333333'), 'visszalépett: nincs hozzáférés');
});

test('csevegő: nem létező csatornánál (kézzel törölték) újra létrehozza; lemondott tárgyalásnál töröl és kiüríti a backendet', async () => {
  const { guild, state, backend, court } = await env();
  await court.reconcile('KAMU-2001');
  const first = chatChannel(guild);
  guild.channels.cache.delete(first.id);
  await court.reconcile('KAMU-2001');
  const second = chatChannel(guild);
  assert.ok(second && second.id !== first.id);
  state.s.status = 'CANCELLED';
  await court.reconcile('KAMU-2001');
  assert.equal(chatChannel(guild), undefined, 'törölve');
  assert.equal(voiceChannel(guild), undefined, 'a hangcsatorna is törölve');
  assert.equal(state.s.discord.chatChannelId, '');
  assert.equal(state.s.discord.voiceChannelId, '');
  assert.deepEqual(backend.calls.filter((c) => c[0] === 'chat').pop(), ['chat', '']);
});

test('csevegő: befejezett tárgyalásnál a türelmi idő alatt megmarad, utána törlődik', async () => {
  const { guild, state, court } = await env();
  let t = 1_000_000;
  const court2 = createCourtSync({ client: { guilds: { cache: new Collection([[guild.id, guild]]) } }, backend: stubBackend(state), gameUrl: '', log: quiet, chatGraceMs: 600000, now: () => t });
  await court2.reconcile('KAMU-2001');
  assert.ok(chatChannel(guild));
  state.s.status = 'FINISHED'; state.s.finishedAt = t;
  t += 60000;
  await court2.reconcile('KAMU-2001');
  assert.ok(chatChannel(guild) && voiceChannel(guild), 'még kint');
  t += 600000;
  await court2.reconcile('KAMU-2001');
  assert.equal(chatChannel(guild), undefined, 'törölve a türelmi idő után');
  assert.equal(voiceChannel(guild), undefined);
  void court; void ChannelType;
});
