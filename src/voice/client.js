const dgram = require('dgram');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// See voice/PROTOCOL.md.
const PROTOCOL_VERSION = 1;
const T = {
  HELLO: 0x01,
  WELCOME: 0x02,
  ENCRYPTED: 0x10,
  C_AUDIO: 0x20,
  C_PING: 0x21,
  C_STATE: 0x22,
  C_BYE: 0x23,
  S_AUDIO: 0x30,
  S_POSITIONS: 0x31,
  S_PONG: 0x32,
  S_STATE: 0x33,
  S_SPEAKER: 0x34,
  S_BYE: 0x35,
};
const STATUS = ['OK', 'NOT_ONLINE', 'ADDRESS_MISMATCH', 'BAD_VERSION', 'DISABLED'];
const PLATFORM_JAVA = 0;
const HELLO_RETRY_MS = 2000;
const PING_MS = 2000;
const SERVER_TIMEOUT_MS = 8000;

/**
 * UDP client for the LittlandVoice plugin. Emits:
 *   'status'    { state: 'connecting'|'connected'|'disconnected', reason? }
 *   'audio'     { speaker, sequence, data: Buffer }
 *   'positions' { listener: {x,y,z,yaw,pitch}, speakers: [{id,x,y,z}] }
 *   'speaker'   { id, name, platform }
 *   'state'     { muted, deafened, echo }
 */
class VoiceClient extends EventEmitter {
  constructor({ host, port, name }) {
    super();
    this.host = host;
    this.port = port;
    this.name = name;
    this.socket = null;
    this.session = null; // { id, key, distance }
    this.timers = [];
    this.lastHeard = 0;
    this.closed = false;
  }

  start() {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => this.onMessage(msg));
    this.socket.on('error', (err) => this.emit('status', { state: 'connecting', reason: err.message }));
    this.socket.bind(() => this.handshake());
  }

  handshake() {
    if (this.closed) return;
    this.session = null;
    this.ecdh = crypto.createECDH('prime256v1');
    this.ecdh.generateKeys();
    this.emit('status', { state: 'connecting' });
    this.clearTimers();
    const sendHello = () => {
      const name = Buffer.from(this.name, 'utf8');
      const hello = Buffer.concat([
        Buffer.from([T.HELLO, PROTOCOL_VERSION]),
        this.ecdh.getPublicKey(), // 65 bytes, uncompressed
        Buffer.from([name.length]),
        name,
        Buffer.from([PLATFORM_JAVA]),
      ]);
      this.socket.send(hello, this.port, this.host);
    };
    sendHello();
    this.timers.push(setInterval(sendHello, HELLO_RETRY_MS));
  }

  onMessage(msg) {
    if (!msg.length) return;
    if (msg[0] === T.WELCOME) return this.onWelcome(msg);
    if (msg[0] !== T.ENCRYPTED || !this.session || msg.length < 1 + 4 + 12 + 16) return;
    if (msg.readInt32BE(1) !== this.session.id) return;

    let inner;
    try {
      const nonce = msg.subarray(5, 17);
      const tag = msg.subarray(msg.length - 16);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.session.key, nonce);
      decipher.setAuthTag(tag);
      inner = Buffer.concat([decipher.update(msg.subarray(17, msg.length - 16)), decipher.final()]);
    } catch {
      return; // forged or corrupted
    }
    this.lastHeard = Date.now();
    this.onInner(inner);
  }

  onWelcome(msg) {
    if (this.session) return;
    const status = msg[1];
    if (status !== 0) {
      // NOT_ONLINE: the player is still joining; keep retrying quietly.
      this.emit('status', { state: 'connecting', reason: STATUS[status] || `status ${status}` });
      if (status === 3 || status === 4) this.close(STATUS[status]);
      return;
    }
    const serverKey = msg.subarray(2, 67);
    const secret = this.ecdh.computeSecret(serverKey);
    const key = crypto.createHash('sha256').update(secret).update('littland-voice-v1').digest();
    this.session = { id: msg.readInt32BE(67), key, distance: msg.readUInt16BE(71) };
    this.lastHeard = Date.now();
    this.clearTimers();
    this.timers.push(setInterval(() => this.ping(), PING_MS));
    this.emit('status', { state: 'connected', distance: this.session.distance });
    if (this.localState) this.setState(this.localState);
  }

  onInner(b) {
    switch (b[0]) {
      case T.S_AUDIO:
        this.emit('audio', { speaker: b.readUInt32BE(1), sequence: b.readUInt32BE(5), data: b.subarray(9) });
        break;
      case T.S_POSITIONS: {
        const listener = {
          x: b.readFloatBE(1),
          y: b.readFloatBE(5),
          z: b.readFloatBE(9),
          yaw: b.readFloatBE(13),
          pitch: b.readFloatBE(17),
        };
        const count = b[21];
        const speakers = [];
        for (let i = 0, o = 22; i < count; i++, o += 16) {
          speakers.push({ id: b.readUInt32BE(o), x: b.readFloatBE(o + 4), y: b.readFloatBE(o + 8), z: b.readFloatBE(o + 12) });
        }
        this.emit('positions', { listener, speakers });
        break;
      }
      case T.S_STATE: {
        const f = b[1];
        this.emit('state', { muted: !!(f & 1), deafened: !!(f & 2), echo: !!(f & 4) });
        break;
      }
      case T.S_SPEAKER: {
        const len = b[5];
        this.emit('speaker', { id: b.readUInt32BE(1), name: b.toString('utf8', 6, 6 + len), platform: b[6 + len] });
        break;
      }
      case T.S_BYE: {
        const reason = b.toString('utf8', 2, 2 + b[1]);
        this.emit('status', { state: 'connecting', reason });
        this.handshake(); // e.g. server restart: try again
        break;
      }
      default:
    }
  }

  ping() {
    if (Date.now() - this.lastHeard > SERVER_TIMEOUT_MS) {
      this.emit('status', { state: 'connecting', reason: 'Sin respuesta del servidor de voz' });
      this.handshake();
      return;
    }
    const b = Buffer.alloc(9);
    b[0] = T.C_PING;
    b.writeBigUInt64BE(BigInt(Date.now()), 1);
    this.sendInner(b);
  }

  sendAudio(sequence, opus) {
    const b = Buffer.alloc(5 + opus.length);
    b[0] = T.C_AUDIO;
    b.writeUInt32BE(sequence >>> 0, 1);
    Buffer.from(opus.buffer || opus, opus.byteOffset || 0, opus.byteLength ?? opus.length).copy(b, 5);
    this.sendInner(b);
  }

  /** Client-side mute/deafen (launcher buttons). */
  setState({ muted, deafened }) {
    this.localState = { muted, deafened };
    this.sendInner(Buffer.from([T.C_STATE, (muted ? 1 : 0) | (deafened ? 2 : 0)]));
  }

  sendInner(inner) {
    if (!this.session || this.closed) return;
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.session.key, nonce);
    const body = Buffer.concat([cipher.update(inner), cipher.final(), cipher.getAuthTag()]);
    const head = Buffer.alloc(5);
    head[0] = T.ENCRYPTED;
    head.writeInt32BE(this.session.id, 1);
    this.socket.send(Buffer.concat([head, nonce, body]), this.port, this.host);
  }

  clearTimers() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  close(reason) {
    if (this.closed) return;
    this.sendInner(Buffer.from([T.C_BYE]));
    this.closed = true;
    this.clearTimers();
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.emit('status', { state: 'disconnected', reason });
  }
}

module.exports = { VoiceClient };
