const net = require('net');
const dns = require('dns').promises;

function varInt(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buf, offset) {
  let value = 0;
  let size = 0;
  let byte;
  do {
    if (offset + size >= buf.length) return null;
    byte = buf[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size++;
  } while (byte & 0x80);
  return { value, size };
}

function packet(id, payload) {
  const body = Buffer.concat([varInt(id), payload]);
  return Buffer.concat([varInt(body.length), body]);
}

/**
 * Resolves the address the way the Minecraft client does: an explicit port is
 * used as-is, otherwise a _minecraft._tcp SRV record wins over host:25565.
 */
async function resolveAddress(address) {
  const [host, portStr] = address.split(':');
  if (portStr) return { host, port: Number(portStr) };
  try {
    const [srv] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (srv) return { host: srv.name, port: srv.port };
  } catch {
    // No SRV record: fall through to the default port.
  }
  return { host, port: 25565 };
}

/** Minecraft Server List Ping. Resolves { online, players, max, motd, version, ping }. */
async function pingServer(address, timeoutMs = 8000) {
  const { host, port } = await resolveAddress(address);

  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let data = Buffer.alloc(0);
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ online: false }));
    socket.on('error', () => finish({ online: false }));

    socket.on('connect', () => {
      const hostBuf = Buffer.from(host, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      const handshake = Buffer.concat([varInt(-1), varInt(hostBuf.length), hostBuf, portBuf, varInt(1)]);
      socket.write(packet(0x00, handshake));
      socket.write(packet(0x00, Buffer.alloc(0)));
    });

    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      const len = readVarInt(data, 0);
      if (!len || data.length < len.size + len.value) return;
      let offset = len.size;
      offset += readVarInt(data, offset).size; // packet id
      const strLen = readVarInt(data, offset);
      offset += strLen.size;
      try {
        const json = JSON.parse(data.subarray(offset, offset + strLen.value).toString('utf8'));
        finish({
          online: true,
          players: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          version: json.version?.name || '',
          motd: flattenMotd(json.description),
          ping: Date.now() - started,
        });
      } catch {
        finish({ online: false });
      }
    });
  });
}

function flattenMotd(desc) {
  if (!desc) return '';
  if (typeof desc === 'string') return desc.replace(/§./g, '');
  return ((desc.text || '') + (desc.extra || []).map(flattenMotd).join('')).replace(/§./g, '');
}

/**
 * Members online in the Discord server behind an invite link
 * (discord.gg/CODE or discord.com/invite/CODE), or null if unavailable.
 */
async function discordOnline(inviteUrl) {
  const code = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/i.exec(inviteUrl || '')?.[1];
  if (!code) return null;
  try {
    // Lazy: needs Electron's network stack, unlike the ping above.
    const { fetchJson } = require('./download');
    const invite = await fetchJson(`https://discord.com/api/v10/invites/${code}?with_counts=true`, { attempts: 1 });
    return invite.approximate_presence_count ?? null;
  } catch {
    return null;
  }
}

module.exports = { pingServer, discordOnline };
