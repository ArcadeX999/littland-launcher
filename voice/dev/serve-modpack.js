// Serves ../../modpack on http://127.0.0.1:8766 with voice enabled on the local
// test server, for `voice/dev/run-launcher.ps1`.
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', 'modpack');

http
  .createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/manifest.json') {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      manifest.voice = { enabled: true, host: '127.0.0.1', port: 24454 };
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(manifest));
    }
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-length': fs.statSync(file).size });
    fs.createReadStream(file).pipe(res);
  })
  .listen(8766, '127.0.0.1', () => console.log('Modpack de pruebas en http://127.0.0.1:8766/manifest.json (voz -> 127.0.0.1:24454)'));
