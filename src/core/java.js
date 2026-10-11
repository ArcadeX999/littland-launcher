const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const { paths } = require('./paths');
const { downloadFile } = require('./download');
const { getVersionJson } = require('./mojang');

/** Java major version Mojang requires for a given Minecraft version. */
async function requiredJava(mcVersion) {
  const version = await getVersionJson(mcVersion);
  return version.javaVersion?.majorVersion || 8;
}

function adoptiumTarget() {
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
  if (!os || !arch) throw new Error(`Plataforma no soportada: ${process.platform}/${process.arch}`);
  return { os, arch };
}

function findJavaBinary(dir) {
  const exe = process.platform === 'win32' ? 'javaw.exe' : 'java';
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === exe && path.basename(current) === 'bin') return full;
    }
  }
  return null;
}

/**
 * Makes sure a Java runtime of `major` version exists inside the launcher's
 * runtime folder (downloaded from Adoptium) and returns the path to it.
 */
async function ensureJava(major, onStatus) {
  const dir = path.join(paths.runtime, `java-${major}`);
  const marker = path.join(dir, '.installed');
  if (fs.existsSync(marker)) {
    const bin = findJavaBinary(dir);
    if (bin) return bin;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const { os, arch } = adoptiumTarget();
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`;
  const archive = path.join(paths.runtime, `java-${major}${os === 'windows' ? '.zip' : '.tar.gz'}`);

  onStatus({ text: `Descargando Java ${major}...`, progress: 0 });
  await downloadFile(url, archive, {
    onProgress: (got, total) => total && onStatus({ text: `Descargando Java ${major}...`, progress: got / total }),
  });

  onStatus({ text: `Instalando Java ${major}...`, progress: null });
  if (os === 'windows') {
    new AdmZip(archive).extractAllTo(dir, true);
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', dir]);
  }
  fs.rmSync(archive, { force: true });

  const bin = findJavaBinary(dir);
  if (!bin) throw new Error(`No se encontró el ejecutable de Java ${major} tras instalarlo`);
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  fs.writeFileSync(marker, new Date().toISOString());
  return bin;
}

module.exports = { requiredJava, ensureJava };
