'use strict';
// Memóriában élő, minimális Discord-szerver a setup logika offline teszteléséhez.
// Csak azt a felületet implementálja, amit a src/setup.js használ.
const { Collection, ChannelType, PermissionFlagsBits, PermissionsBitField, EmbedBuilder } = require('discord.js');

let seq = 1000;
const nextId = () => String(++seq);

function toEmbedJson(e) {
  return e instanceof EmbedBuilder ? e.toJSON() : e;
}

function makeMessage(channel, authorId, payload) {
  const msg = {
    id: nextId(),
    author: { id: authorId },
    embeds: (payload.embeds || []).map(toEmbedJson),
    components: payload.components || [],
    async edit(p) { msg.embeds = (p.embeds || []).map(toEmbedJson); if (p.components) msg.components = p.components; msg.edited = (msg.edited || 0) + 1; return msg; },
  };
  channel.messageStore.set(msg.id, msg);
  return msg;
}

function makeChannel(guild, opts) {
  const ch = {
    id: nextId(),
    guild,
    name: opts.name,
    type: opts.type,
    parentId: opts.parent || null,
    topic: opts.topic || null,
    rateLimitPerUser: opts.rateLimitPerUser || 0,
    availableTags: (opts.availableTags || []).map((t) => ({ id: nextId(), ...t })),
    messageStore: new Collection(),
    permissionOverwrites: {
      cache: new Collection(),
      async edit(target, flags) {
        const id = target.id || target;
        let ow = ch.permissionOverwrites.cache.get(id);
        if (!ow) { ow = { id, allow: new PermissionsBitField(), deny: new PermissionsBitField() }; ch.permissionOverwrites.cache.set(id, ow); }
        for (const [name, val] of Object.entries(flags)) {
          const bit = PermissionFlagsBits[name];
          if (bit === undefined) throw new Error(`ismeretlen jog: ${name}`);
          if (val === true) { ow.allow = ow.allow.add(bit); ow.deny = ow.deny.remove(bit); }
          else if (val === false) { ow.deny = ow.deny.add(bit); ow.allow = ow.allow.remove(bit); }
        }
        return ch;
      },
    },
    messages: {
      async fetch(arg) {
        if (typeof arg === 'string') {
          const m = ch.messageStore.get(arg);
          if (!m) { const e = new Error('Unknown Message'); e.code = 10008; throw e; }
          return m;
        }
        return new Collection([...ch.messageStore.entries()].reverse());
      },
    },
    async send(payload) { return makeMessage(ch, guild.members.me.id, payload); },
    async setAvailableTags(tags) { ch.availableTags = tags.map((t) => ({ id: t.id || nextId(), ...t })); return ch; },
    async setParent(id) { ch.parentId = id; return ch; },
  };
  if (opts.type === ChannelType.GuildForum) {
    const threads = new Collection();
    ch.threadStore = threads;
    ch.threads = {
      async create({ name, message }) {
        const t = { id: nextId(), name, pinned: false };
        t.starter = makeMessage(ch, guild.members.me.id, message);
        t.fetchStarterMessage = async () => t.starter;
        t.pin = async () => { t.pinned = true; };
        threads.set(t.id, t);
        return t;
      },
      async fetchActive() { return { threads }; },
      async fetchArchived() { return { threads: new Collection() }; },
    };
  }
  return ch;
}

function makeGuild({ community = false, botPermissions = null, ownerId = 'owner1' } = {}) {
  const guild = {
    id: 'guild1',
    ownerId,
    features: community ? ['COMMUNITY'] : [],
    roles: null,
    channels: null,
    members: null,
    calls: { channelCreates: 0, roleCreates: 0 },
  };

  const rolesCache = new Collection();
  const everyone = { id: guild.id, name: '@everyone', position: 0, managed: false };
  const botRole = { id: nextId(), name: 'KamuBot', position: 1, managed: true, permissions: new PermissionsBitField(PermissionsBitField.All) };
  rolesCache.set(everyone.id, everyone);
  rolesCache.set(botRole.id, botRole);
  guild.roles = {
    cache: rolesCache,
    everyone,
    async create(opts) {
      guild.calls.roleCreates++;
      for (const r of rolesCache.values()) if (r.position >= 1) r.position++; // az új role a 1. helyre kerül (alulra)
      const role = { id: nextId(), name: opts.name, color: opts.color, hoist: opts.hoist, position: 1, managed: false, permissions: new PermissionsBitField(opts.permissions || []) };
      rolesCache.set(role.id, role);
      return role;
    },
    async setPositions(updates) {
      for (const u of updates) rolesCache.get(u.role.id).position = u.position;
      return guild;
    },
  };

  const meRoles = new Collection([[botRole.id, botRole]]);
  const me = {
    id: 'bot1',
    permissions: botPermissions || new PermissionsBitField(PermissionsBitField.All),
    roles: {
      cache: meRoles,
      get highest() { return [...meRoles.values()].sort((a, b) => b.position - a.position)[0]; },
      async add(role) { meRoles.set(role.id, role); },
    },
  };
  const memberStore = new Map();
  guild.members = {
    me,
    async fetchMe() { return me; },
    async fetch(id) { const m = memberStore.get(String(id)); if (!m) { const e = new Error('Unknown Member'); e.code = 10007; throw e; } return m; }
  };
  guild.name = 'Teszt szerver';
  // Teszt-segéd: új tag (a role-ok a guild.roles.cache-ből jönnek)
  guild.addMember = (id, roleNames = []) => {
    const cache = new Collection();
    for (const n of roleNames) { const r = [...rolesCache.values()].find((x) => x.name === n); if (r) cache.set(r.id, r); }
    const m = { id: String(id), guild, permissions: new PermissionsBitField(), roles: { cache, async add(role) { cache.set(role.id, role); }, async remove(role) { cache.delete(role.id); } } };
    memberStore.set(m.id, m);
    return m;
  };

  const chCache = new Collection();
  guild.channels = {
    cache: chCache,
    async create(opts) {
      guild.calls.channelCreates++;
      if (opts.type === ChannelType.GuildForum && !guild.features.includes('COMMUNITY')) throw new Error('Forum csak Community szerveren');
      const ch = makeChannel(guild, opts);
      chCache.set(ch.id, ch);
      return ch;
    },
  };
  return guild;
}

module.exports = { makeGuild, makeMessage };
