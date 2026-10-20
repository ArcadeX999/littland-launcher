// LittlandVoice audio engine: microphone -> Opus -> main process (UDP), and
// UDP -> Opus decode -> per-speaker 3D panner -> speakers. Uses `api` from renderer.js.

const SAMPLE_RATE = 48000;
const FRAME = 960; // 20 ms
const HANGOVER_FRAMES = 15; // keep sending 300 ms after speech ends
const PREROLL_FRAMES = 3; // also send the 60 ms before speech was detected
const ECHO_SPEAKER = 0xffffffff;

class VoiceEngine {
  constructor() {
    this.ctx = null;
    this.speakers = new Map(); // id -> { decoder, node, panner, name, lastAudio, timestamp }
    this.names = new Map();
    this.distance = 48;
    this.settings = null;
    this.sequence = 0;
    this.hangover = 0;
    this.talking = false;
    this.preroll = [];
    this.muted = false;
    this.deafened = false;
    this.network = false; // false = mic test only
    this.onLevel = null; // (dB, talking) for the UI meter
  }

  /** Starts the microphone. With network=false it's a local mic test (optionally hearing yourself). */
  async start({ settings, network, distance, monitor = false }) {
    await this.stop();
    this.settings = settings;
    this.network = network;
    if (distance) this.distance = distance;

    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
    if (settings.outputDevice && this.ctx.setSinkId) {
      await this.ctx.setSinkId(settings.outputDevice).catch(() => {});
    }
    await this.ctx.audioWorklet.addModule('voice-worklet.js');

    this.master = this.ctx.createGain();
    this.master.gain.value = settings.volume ?? 1;
    this.master.connect(this.ctx.destination);

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: settings.inputDevice ? { exact: settings.inputDevice } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.micGain = this.ctx.createGain();
    this.micGain.gain.value = settings.micGain ?? 1;
    this.capture = new AudioWorkletNode(this.ctx, 'voice-capture', { numberOfOutputs: 0 });
    source.connect(this.micGain).connect(this.capture);
    this.capture.port.onmessage = (e) => this.onFrame(e.data);

    if (monitor) {
      this.monitor = this.ctx.createGain();
      this.micGain.connect(this.monitor).connect(this.master);
    }

    if (network) {
      this.encoder = new AudioEncoder({
        output: (chunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          api.voice.sendAudio(this.sequence++, data);
        },
        error: (err) => console.error('[voz] encoder', err),
      });
      this.encoder.configure({
        codec: 'opus',
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        bitrate: 24000,
        opus: { frameDuration: 20000, complexity: 8 },
      });
      this.timestamp = 0;
    }
  }

  async stop() {
    for (const id of [...this.speakers.keys()]) this.dropSpeaker(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    try {
      if (this.encoder && this.encoder.state !== 'closed') this.encoder.close();
    } catch {
      // already closed
    }
    if (this.ctx) await this.ctx.close().catch(() => {});
    this.ctx = this.stream = this.encoder = this.capture = this.monitor = null;
    this.talking = false;
  }

  get running() {
    return !!this.ctx;
  }

  // ---------------------------------------------------------------- capture

  onFrame(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const db = 10 * Math.log10(sum / frame.length + 1e-12);

    const loud = db > (this.settings.threshold ?? -50);
    if (loud) this.hangover = HANGOVER_FRAMES;
    else if (this.hangover > 0) this.hangover--;
    const talking = this.hangover > 0 && !this.muted;
    this.onLevel?.(db, talking);

    if (!this.network || !this.encoder || this.encoder.state !== 'configured') {
      this.talking = talking;
      return;
    }
    if (talking) {
      // Speech onsets are quiet and fall under the threshold: send what came just before.
      if (!this.talking) this.preroll.splice(0).forEach((f) => this.encode(f));
      this.encode(frame);
    } else {
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
    }
    if (!talking && this.talking) {
      // "Stopped talking" must go after the last encoded frames, not before them.
      const encoder = this.encoder;
      encoder
        .flush()
        .then(() => {
          if (this.encoder === encoder) api.voice.sendAudio(this.sequence++, new Uint8Array(0));
        })
        .catch(() => {});
    }
    this.talking = talking;
  }

  encode(frame) {
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: FRAME,
      numberOfChannels: 1,
      timestamp: this.timestamp,
      data: frame,
    });
    this.timestamp += 20000;
    this.encoder.encode(data);
    data.close();
  }

  setMicGain(value) {
    if (this.micGain) this.micGain.gain.value = value;
  }

  setVolume(value) {
    if (this.master) this.master.gain.value = value;
  }

  setThreshold(value) {
    if (this.settings) this.settings.threshold = value;
  }

  // ---------------------------------------------------------------- playback

  speaker(id) {
    let s = this.speakers.get(id);
    if (s || !this.ctx) return s;
    const node = new AudioWorkletNode(this.ctx, 'voice-playback', { numberOfInputs: 0, outputChannelCount: [1] });
    const panner = new PannerNode(this.ctx, {
      panningModel: 'HRTF',
      distanceModel: 'linear',
      refDistance: 2,
      maxDistance: this.distance,
      rolloffFactor: 1,
    });
    node.connect(panner).connect(this.master);
    node.port.onmessage = ({ data }) => {
      const who = id === ECHO_SPEAKER ? 'eco' : this.names.get(id) || `#${id}`;
      log(`[Voz] ${who}: búfer ${data.targetMs} ms, ${data.cuts} cortes, ${data.dropped} trozos descartados (últimos 5 s)`);
    };
    const decoder = new AudioDecoder({
      output: (audio) => {
        const pcm = new Float32Array(audio.numberOfFrames);
        audio.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
        audio.close();
        node.port.postMessage(pcm, [pcm.buffer]);
      },
      error: (err) => console.error('[voz] decoder', err),
    });
    decoder.configure({ codec: 'opus', sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
    s = { id, node, panner, decoder, lastAudio: 0, timestamp: 0 };
    this.speakers.set(id, s);
    return s;
  }

  dropSpeaker(id) {
    const s = this.speakers.get(id);
    if (!s) return;
    try {
      if (s.decoder.state !== 'closed') s.decoder.close();
    } catch {
      // already closed
    }
    s.node.disconnect();
    s.panner.disconnect();
    this.speakers.delete(id);
  }

  onAudio({ speaker, data }) {
    if (!this.ctx || this.deafened) return;
    const s = this.speaker(speaker);
    if (!s) return;
    if (!data.byteLength) {
      s.lastAudio = 0; // stopped talking
      s.node.port.postMessage('end');
      return;
    }
    s.lastAudio = performance.now();
    if (s.decoder.state !== 'configured') return;
    s.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: s.timestamp, data }));
    s.timestamp += 20000;
  }

  /** Minecraft coords map straight onto Web Audio's (right-handed, Y up). */
  onPositions({ listener, speakers }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const L = this.ctx.listener;
    const yaw = (listener.yaw * Math.PI) / 180;
    const pitch = (listener.pitch * Math.PI) / 180;
    // Minecraft: yaw 0 looks toward +Z, 90 toward -X; pitch > 0 looks down.
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = -Math.sin(pitch);
    const fz = Math.cos(yaw) * Math.cos(pitch);
    if (L.positionX) {
      L.positionX.setTargetAtTime(listener.x, t, 0.05);
      L.positionY.setTargetAtTime(listener.y, t, 0.05);
      L.positionZ.setTargetAtTime(listener.z, t, 0.05);
      L.forwardX.setTargetAtTime(fx, t, 0.05);
      L.forwardY.setTargetAtTime(fy, t, 0.05);
      L.forwardZ.setTargetAtTime(fz, t, 0.05);
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setPosition(listener.x, listener.y, listener.z);
      L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
    for (const p of speakers) {
      const s = this.speakers.get(p.id >>> 0);
      if (!s) continue;
      s.panner.positionX.setTargetAtTime(p.x, t, 0.05);
      s.panner.positionY.setTargetAtTime(p.y, t, 0.05);
      s.panner.positionZ.setTargetAtTime(p.z, t, 0.05);
    }
  }

  /** Names of whoever spoke in the last 400 ms (for the UI). */
  talkingNow() {
    const now = performance.now();
    const names = [];
    for (const s of this.speakers.values()) {
      if (s.lastAudio && now - s.lastAudio < 400) {
        names.push(s.id === ECHO_SPEAKER ? 'Eco (tú)' : this.names.get(s.id) || '…');
      }
    }
    return names;
  }
}

const voice = new VoiceEngine();
