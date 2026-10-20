// Automated LittlandVoice test: two bots join the local test server and talk
// through the real voice client (src/voice/client.js).
//   node voice/dev/bot/test.js            (server from voice/dev/run-server.ps1)
const mineflayer = require('mineflayer');
const { VoiceClient } = require('../../../src/voice/client');

const HOST = '127.0.0.1';
const GAME_PORT = 25565;
const VOICE_PORT = 24454;
const ECHO = 0xffffffff;

const results = [];
const check = (ok, name, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function join(name) {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({ host: HOST, port: GAME_PORT, username: name, version: '1.21.8', auth: 'offline' });
    bot.once('spawn', () => resolve(bot));
    bot.once('error', reject);
    bot.once('kicked', (r) => reject(new Error(`kicked: ${JSON.stringify(r)}`)));
  });
}

function voiceFor(name) {
  const client = new VoiceClient({ host: HOST, port: VOICE_PORT, name });
  const log = { audio: [], speakers: [], positions: null, state: null, statuses: [] };
  client.on('audio', (a) => log.audio.push(a));
  client.on('speaker', (s) => log.speakers.push(s));
  client.on('positions', (p) => (log.positions = p));
  client.on('state', (s) => (log.state = s));
  client.on('status', (s) => log.statuses.push(s));
  client.start();
  return { client, log };
}

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
}

/** Sends n fake "Opus" frames (the relay never decodes them). */
async function talk(client, n = 5, tag = 1) {
  for (let i = 0; i < n; i++) {
    client.sendAudio(i, Buffer.from([0xf8, tag, i, 0xaa, 0xbb]));
    await sleep(20);
  }
}

(async () => {
  console.log('Conectando bots...');
  const botA = await join('BotA');
  const botB = await join('BotB');
  await sleep(1000);
  botA.chat('/tp BotA 0 -60 0');
  botB.chat('/tp BotB 4 -60 0');
  await sleep(800);

  // Handshake
  const nobody = voiceFor('Nadie');
  await sleep(2500);
  check(nobody.log.statuses.some((s) => s.reason === 'NOT_ONLINE'), 'jugador no conectado es rechazado');
  nobody.client.close();

  const A = voiceFor('BotA');
  const B = voiceFor('BotB');
  check(await waitFor(() => A.log.statuses.some((s) => s.state === 'connected')), 'BotA conectado a la voz');
  check(await waitFor(() => B.log.statuses.some((s) => s.state === 'connected')), 'BotB conectado a la voz');

  // Positions
  check(await waitFor(() => B.log.positions && B.log.positions.speakers.length === 1), 'BotB recibe la posición de BotA');
  const pA = B.log.positions.speakers[0];
  check(Math.abs(pA.x) < 1 && Math.abs(pA.z) < 1, 'posición de BotA correcta', `x=${pA.x.toFixed(1)} z=${pA.z.toFixed(1)}`);
  const idA = pA.id;

  // Audio relay
  B.log.audio = [];
  await talk(A.client, 5, 1);
  check(await waitFor(() => B.log.audio.length === 5), 'BotB oye a BotA (5/5 paquetes)', `${B.log.audio.length}`);
  check(B.log.audio.every((a) => a.speaker === idA && a.data[1] === 1), 'el audio llega intacto y con el emisor correcto');
  check(B.log.speakers.some((s) => s.id === idA && s.name === 'BotA'), 'BotB recibe el nombre de BotA');
  check(A.log.audio.length === 0, 'BotA no se oye a sí mismo');

  // Client mute
  A.client.setState({ muted: true, deafened: false });
  await waitFor(() => A.log.state && A.log.state.muted);
  B.log.audio = [];
  await talk(A.client, 5, 2);
  await sleep(400);
  check(B.log.audio.length === 0, 'silenciado desde el launcher: no se transmite');
  A.client.setState({ muted: false, deafened: false });
  await waitFor(() => A.log.state && !A.log.state.muted);

  // Deafen via /voz
  botB.chat('/voz ensordecer');
  check(await waitFor(() => B.log.state && B.log.state.deafened), '/voz ensordecer actualiza el estado');
  B.log.audio = [];
  await talk(A.client, 5, 3);
  await sleep(400);
  check(B.log.audio.length === 0, 'ensordecido: no recibe audio');
  botB.chat('/voz ensordecer');
  await waitFor(() => B.log.state && !B.log.state.deafened);

  // Distance
  botB.chat('/tp BotB 100 -60 0');
  await sleep(1000);
  B.log.audio = [];
  await talk(A.client, 5, 4);
  await sleep(400);
  check(B.log.audio.length === 0, 'a 100 bloques no se oye (alcance 48)');
  check(!B.log.positions.speakers.some((s) => s.id === idA), 'fuera de alcance BotA desaparece de las posiciones');
  botB.chat('/tp BotB 4 -60 0');
  await sleep(1000);
  B.log.audio = [];
  await talk(A.client, 5, 5);
  check(await waitFor(() => B.log.audio.length === 5), 'al volver cerca se oye otra vez');

  // Echo test
  botA.chat('/voz eco');
  check(await waitFor(() => A.log.state && A.log.state.echo), '/voz eco activa el eco');
  A.log.audio = [];
  await talk(A.client, 5, 6);
  check(await waitFor(() => A.log.audio.filter((a) => a.speaker === ECHO).length === 5), 'eco: BotA se oye a sí mismo');
  check(A.log.positions.speakers.some((s) => s.id === ECHO), 'eco: aparece delante en las posiciones');
  botA.chat('/voz eco');

  // Quit -> session ends
  botA.quit();
  check(await waitFor(() => !B.log.positions.speakers.some((s) => s.id === idA), 4000), 'al salir BotA deja de aparecer');

  A.client.close();
  B.client.close();
  botB.quit();
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} PRUEBA(S) FALLARON` : `\nTODAS LAS PRUEBAS PASARON (${results.length})`);
  setTimeout(() => process.exit(failed ? 1 : 0), 300);
})().catch((err) => {
  console.error('ERROR', err);
  process.exit(1);
});
