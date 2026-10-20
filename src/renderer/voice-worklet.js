// Audio-thread processors for LittlandVoice (loaded with audioWorklet.addModule).

const FRAME = 960; // 20 ms at 48 kHz

/** Collects microphone samples into 20 ms frames and posts them to the page. */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let offset = 0;
    while (offset < input.length) {
      const n = Math.min(FRAME - this.filled, input.length - offset);
      this.frame.set(input.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === FRAME) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(FRAME);
        this.filled = 0;
      }
    }
    return true;
  }
}

// Adaptive jitter buffer. It tracks how irregularly frames arrive (a peak
// that decays slowly) and keeps just enough audio queued to ride over it:
// ~40 ms on a steady connection, up to 200 ms on a bursty one.
const FRAME_S = 0.02;
const MIN_TARGET = 2; // frames
const MAX_TARGET = 10;
const SLACK = 4; // frames above target before dropping the oldest audio

/** Plays one speaker's decoded frames. */
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.buffering = true;
    this.lastArrival = 0;
    this.peakJitter = 0;
    this.starvedAt = -1;
    this.stats = { cuts: 0, dropped: 0, since: currentTime };
    this.ended = false;
    this.port.onmessage = (e) => (e.data === 'end' ? this.endOfSpeech() : this.receive(e.data));
  }

  get target() {
    return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.ceil(this.peakJitter / FRAME_S) + 1));
  }

  /** The speaker stopped talking: the coming silence is not network jitter. */
  endOfSpeech() {
    this.ended = true;
    this.lastArrival = 0;
  }

  receive(frame) {
    const now = currentTime;
    const gap = now - this.lastArrival;
    if (this.lastArrival) {
      const jitter = Math.abs(gap - FRAME_S);
      this.peakJitter = Math.max(jitter, this.peakJitter * 0.997);
    }
    this.lastArrival = now;
    // Ran dry while the speaker was still talking: an audible cut.
    if (this.starvedAt >= 0 && !this.ended) this.stats.cuts++;
    this.starvedAt = -1;
    this.ended = false;

    this.queue.push(frame);
    const target = this.target;
    if (this.queue.length > target + SLACK) {
      this.stats.dropped += this.queue.length - target;
      this.queue.splice(0, this.queue.length - target);
    }

    if (now - this.stats.since > 5) {
      if (this.stats.cuts || this.stats.dropped) {
        this.port.postMessage({ targetMs: target * 20, cuts: this.stats.cuts, dropped: this.stats.dropped });
      }
      this.stats = { cuts: 0, dropped: 0, since: now };
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    if (this.buffering) {
      if (this.queue.length < this.target) return true; // silence while (re)filling
      this.buffering = false;
    }
    let written = 0;
    while (written < out.length) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift();
        this.offset = 0;
        if (!this.current) {
          this.buffering = true;
          this.starvedAt = currentTime;
          break;
        }
      }
      const n = Math.min(out.length - written, this.current.length - this.offset);
      out.set(this.current.subarray(this.offset, this.offset + n), written);
      written += n;
      this.offset += n;
    }
    return true;
  }
}

registerProcessor('voice-capture', CaptureProcessor);
registerProcessor('voice-playback', PlaybackProcessor);
