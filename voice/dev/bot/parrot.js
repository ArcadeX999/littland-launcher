// "Loro": joins the local test server 5 blocks east of spawn and repeats
// whatever it hears, so a real player can check their voice and 3D audio.
//   node voice/dev/bot/parrot.js
const mineflayer = require('mineflayer');
const { VoiceClient } = require('../../../src/voice/client');

const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: 'Loro', version: '1.21.8', auth: 'offline' });
let voice;
const stats = { packets: 0, bytes: 0, ends: 0, speakers: new Map(), toc: new Map(), gaps: [] };
let lastArrival = 0;

bot.once('spawn', () => {
  bot.chat('/tp Loro 5 -60 0');
  voice = new VoiceClient({ host: '127.0.0.1', port: 24454, name: 'Loro' });
  voice.on('status', (s) => console.log(`[voz] ${s.state}${s.reason ? `: ${s.reason}` : ''}`));
  voice.on('speaker', (s) => stats.speakers.set(s.id, s.name));
  voice.on('audio', ({ speaker, sequence, data }) => {
    if (!data.length) {
      stats.ends++;
      voice.sendAudio(sequence, Buffer.alloc(0));
      return;
    }
    const now = performance.now();
    if (lastArrival && now - lastArrival < 500) stats.gaps.push(now - lastArrival); // within speech
    lastArrival = now;
    stats.packets++;
    stats.bytes += data.length;
    // Opus TOC byte: config (bits 3-7) and stereo flag (bit 2).
    const key = `config ${data[0] >> 3}${data[0] & 4 ? ' stereo' : ' mono'}`;
    stats.toc.set(key, (stats.toc.get(key) || 0) + 1);
    voice.sendAudio(sequence, data); // repeat it back
  });
  voice.start();
  console.log('Loro en el juego (5 bloques al este del spawn). Habla y te repetirá.');
});

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]);
}

setInterval(() => {
  if (!stats.packets && !stats.ends) return;
  const names = [...stats.speakers.values()].join(', ') || '?';
  console.log(
    `oído de ${names}: ${stats.packets} paquetes, media ${Math.round(stats.bytes / Math.max(1, stats.packets))} bytes, ` +
      `${stats.ends} fin-de-frase, ${[...stats.toc].map(([k, v]) => `${k}: ${v}`).join(', ')}` +
      (stats.gaps.length ? ` | llegada entre paquetes: mediana ${pct(stats.gaps, 0.5)} ms, p95 ${pct(stats.gaps, 0.95)} ms, máx ${pct(stats.gaps, 1)} ms` : '')
  );
  stats.packets = stats.bytes = stats.ends = 0;
  stats.gaps = [];
  stats.toc.clear();
}, 3000);

bot.on('kicked', (r) => console.log('expulsado', r));
bot.on('error', (e) => console.log('error', e.message));
process.on('SIGINT', () => {
  voice?.close();
  bot.quit();
  process.exit(0);
});
