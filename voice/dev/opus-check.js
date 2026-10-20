// Checks that Electron can encode/decode Opus with the voice settings.
//   node_modules\electron\dist\electron.exe voice/dev/opus-check.js
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  // Same kind of page as the launcher (file://), which counts as a secure context.
  await win.loadFile(require('path').join(__dirname, 'blank.html'));
  const result = await win.webContents.executeJavaScript(`(async () => {
    const enc = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 24000, opus: { frameDuration: 20000, complexity: 8 } };
    const dec = { codec: 'opus', sampleRate: 48000, numberOfChannels: 1 };
    const out = { encSupported: (await AudioEncoder.isConfigSupported(enc)).supported, decSupported: (await AudioDecoder.isConfigSupported(dec)).supported };
    const packets = [];
    const encoder = new AudioEncoder({ output: (c) => { const d = new Uint8Array(c.byteLength); c.copyTo(d); packets.push(d); }, error: (e) => out.encErr = String(e) });
    encoder.configure(enc);
    // 1 s of a 440 Hz tone in 20 ms frames
    for (let f = 0; f < 50; f++) {
      const pcm = new Float32Array(960);
      for (let i = 0; i < 960; i++) pcm[i] = 0.3 * Math.sin(2 * Math.PI * 440 * (f * 960 + i) / 48000);
      const a = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 960, numberOfChannels: 1, timestamp: f * 20000, data: pcm });
      encoder.encode(a); a.close();
    }
    await encoder.flush();
    out.packets = packets.length;
    out.avgBytes = Math.round(packets.reduce((s, p) => s + p.length, 0) / packets.length);
    out.toc = packets[10][0] >> 3; out.stereo = !!(packets[10][0] & 4);
    let frames = 0, energy = 0;
    const decoder = new AudioDecoder({ output: (a) => { const pcm = new Float32Array(a.numberOfFrames); a.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' }); frames += a.numberOfFrames; for (const v of pcm) energy += v * v; a.close(); }, error: (e) => out.decErr = String(e) });
    decoder.configure(dec);
    packets.forEach((p, i) => decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: i * 20000, data: p })));
    await decoder.flush();
    out.decodedMs = Math.round(frames / 48);
    out.rms = Math.sqrt(energy / frames).toFixed(3); // 0.3 sine -> ~0.212
    return out;
  })()`);
  console.log(JSON.stringify(result));
  app.exit(0);
}).catch((err) => {
  console.log('ERROR', err.message);
  app.exit(1);
});
