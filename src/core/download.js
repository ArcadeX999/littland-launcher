const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
// Chromium's network stack: honours system proxies and is more reliable than
// Node's fetch on some connections (IPv6 connect timeouts).
const { net } = require('electron');

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function fetchJson(url, { attempts = 3, method, headers, body } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await net.fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        method,
        headers,
        body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= attempts) {
        const reason = err.name === 'TimeoutError' || err.name === 'AbortError' ? 'sin respuesta' : err.message;
        throw new Error(`No se pudo descargar ${url} (${reason})`);
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const STALL_MS = 30000;
const ATTEMPTS = 6;

/**
 * One download attempt. A partial .part file left by a previous attempt is
 * resumed with an HTTP Range request, so flaky connections still make progress.
 */
async function downloadOnce(url, dest, { sha1, onProgress }) {
  const controller = new AbortController();
  let body = null;
  let failStalled;
  // Electron's net.fetch doesn't always end the body stream on abort, so a
  // stall also tears the stream down and rejects the attempt directly.
  const stalled = new Promise((_, reject) => (failStalled = reject));
  stalled.catch(() => {});
  const onStall = () => {
    const err = new Error(`La descarga se quedó sin respuesta: ${url}`);
    controller.abort();
    if (body) body.destroy(err);
    failStalled(err);
  };
  let timer = setTimeout(onStall, STALL_MS);
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(onStall, STALL_MS);
  };

  const tmp = dest + '.part';
  const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  const attempt = async () => {
    const headers = have ? { Range: `bytes=${have}-` } : {};
    const res = await net.fetch(url, { signal: controller.signal, cache: 'no-store', headers });
    // 416: the server says our partial file is already complete (or bogus); let the hash decide.
    if (res.status === 416) return;
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    const resumed = res.status === 206;
    const offset = resumed ? have : 0;
    const total = offset + (Number(res.headers.get('content-length')) || 0);
    let received = offset;
    body = Readable.fromWeb(res.body);
    body.on('data', (chunk) => {
      resetTimer();
      received += chunk.length;
      if (onProgress) onProgress(received, total);
    });
    await pipeline(body, fs.createWriteStream(tmp, { flags: resumed ? 'a' : 'w' }));
  };
  try {
    await Promise.race([attempt(), stalled]);
  } finally {
    clearTimeout(timer);
  }

  if (sha1) {
    const actual = await sha1File(tmp);
    if (actual.toLowerCase() !== sha1.toLowerCase()) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`Hash incorrecto para ${path.basename(dest)} (esperado ${sha1}, recibido ${actual})`);
    }
  }
  fs.renameSync(tmp, dest);
}

/**
 * Downloads `url` to `dest` atomically (writes to .part, then renames),
 * retrying on network errors, stalls and hash mismatches.
 * onProgress(bytesSoFar, totalBytes) is called while streaming.
 */
async function downloadFile(url, dest, { sha1, onProgress } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      return await downloadOnce(url, dest, { sha1, onProgress });
    } catch (err) {
      if (attempt >= ATTEMPTS) {
        const cause = err.cause?.code || err.cause?.message;
        throw new Error(`No se pudo descargar ${path.basename(dest)}: ${err.message}${cause ? ` (${cause})` : ''}`);
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/** Runs async `worker` over `items` with at most `limit` in flight. */
async function runPool(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

module.exports = { sha1File, fetchJson, downloadFile, runPool };
