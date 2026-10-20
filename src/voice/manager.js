const { VoiceClient } = require('./client');
const { resolveAddress } = require('../core/status');

let client = null;

/**
 * Connects to the server's LittlandVoice plugin while the game runs.
 * `voiceConfig` comes from the manifest ({ host?, port }); without a host the
 * game server's host (after SRV lookup) is used, since the plugin runs there.
 */
async function startVoice({ voiceConfig, serverAddress, name }, send) {
  stopVoice();
  const host = voiceConfig.host || (await resolveAddress(serverAddress)).host;
  const port = voiceConfig.port || 24454;
  const c = new VoiceClient({ host, port, name });
  client = c;
  c.on('status', (s) => send('voice:status', s));
  c.on('audio', ({ speaker, data }) => send('voice:audio', { speaker, data: new Uint8Array(data) }));
  c.on('positions', (p) => send('voice:positions', p));
  c.on('speaker', (s) => send('voice:speaker', s));
  c.on('state', (s) => send('voice:state', s));
  c.start();
}

function stopVoice() {
  if (!client) return;
  client.close();
  client = null;
}

function sendAudio(sequence, data) {
  client?.sendAudio(sequence, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

function setVoiceState(state) {
  client?.setState(state);
}

module.exports = { startVoice, stopVoice, sendAudio, setVoiceState };
