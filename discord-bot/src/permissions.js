'use strict';
// A bot által kért jogok – semmi több. Minden tétel indoklással.
const { PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');

const BOT_PERMISSIONS = [
  [P.ManageRoles, 'role-ok létrehozása, rendezése'],
  [P.ManageChannels, 'kategóriák, csatornák, jogosultság-felülírások, fórum-címkék'],
  [P.ViewChannel, 'csatornák látása'],
  [P.SendMessages, 'embedek és értesítések küldése'],
  [P.SendMessagesInThreads, 'válasz fórum-posztokban'],
  [P.EmbedLinks, 'embedek megjelenítése'],
  [P.ReadMessageHistory, 'a saját korábbi üzenetek megtalálása (hogy ne duplikáljon)'],
  [P.ManageThreads, 'a sablon-poszt kitűzése a fórumokban'],
  // A Discord csak olyan jogot enged egy csatornán megadni, amellyel a bot maga is rendelkezik:
  [P.AttachFiles, 'a stáb csatorna-jogainak beállításához'],
  [P.AddReactions, 'a bétás csatornák jogainak beállításához'],
  [P.Connect, 'a hangcsatornák jogainak beállításához'],
  [P.Speak, 'a hangcsatornák jogainak beállításához'],
];

const BOT_PERMISSION_BITS = BOT_PERMISSIONS.reduce((acc, [bit]) => acc | bit, 0n);

function permissionName(bit) {
  return new PermissionsBitField(bit).toArray()[0];
}

// A hiányzó jogok nevei (üres tömb = rendben). Az Administrator mindent fed.
function missingBotPermissions(perms) {
  if (perms.has(P.Administrator)) return [];
  return BOT_PERMISSIONS.filter(([bit]) => !perms.has(bit)).map(([bit]) => permissionName(bit));
}

module.exports = { BOT_PERMISSIONS, BOT_PERMISSION_BITS, missingBotPermissions, permissionName };
