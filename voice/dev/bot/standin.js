// Joins the local test server as a stand-in for a Bedrock player, so the
// Android app (in the emulator, without Minecraft) can connect its voice as
// that player. The emulator's traffic reaches the server from 127.0.0.1, the
// same IP as this bot, so the voice auth passes.
//   node voice/dev/bot/standin.js MovilTest
const mineflayer = require('mineflayer');

const name = process.argv[2] || 'MovilTest';
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: name, version: '1.21.8', auth: 'offline' });
bot.once('spawn', () => {
  bot.chat(`/tp ${name} -5 -60 0`);
  console.log(`${name} está en el juego (5 bloques al oeste del spawn), haciendo de jugador de Bedrock.`);
});
bot.on('kicked', (r) => console.log('expulsado', r));
bot.on('error', (e) => console.log('error', e.message));
process.on('SIGINT', () => {
  bot.quit();
  process.exit(0);
});
