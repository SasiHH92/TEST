'use strict';
// Meghívó link generálása: npm run invite
require('dotenv').config({ quiet: true });
const { BOT_PERMISSION_BITS, BOT_PERMISSIONS, permissionName } = require('./permissions');

const clientId = process.env.DISCORD_CLIENT_ID;
if (!clientId) {
  console.error('Hiányzik a DISCORD_CLIENT_ID a .env fájlból.');
  process.exit(1);
}
const url = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&scope=bot%20applications.commands&permissions=${BOT_PERMISSION_BITS}`;
console.log('Kért jogok:');
for (const [bit, why] of BOT_PERMISSIONS) console.log(`  - ${permissionName(bit)}: ${why}`);
console.log(`\nMeghívó link:\n${url}`);
