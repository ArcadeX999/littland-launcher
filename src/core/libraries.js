const fs = require('fs');
const path = require('path');
const { paths, readJson, writeJson } = require('./paths');
const { downloadFile, sha1File, runPool } = require('./download');
const { getVersionJson } = require('./mojang');

const OS_NAME = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];

/** Mojang library rules: allowed unless the rules say otherwise for this OS. */
function allowedOnThisOs(lib) {
  if (!lib.rules) return true;
  let allowed = false;
  for (const rule of lib.rules) {
    if (!rule.os || rule.os.name === OS_NAME) allowed = rule.action === 'allow';
  }
  return allowed;
}

/** "group:artifact:version[:classifier]" -> Maven relative path. */
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
  return [...group.split('.'), artifact, version, file].join('/');
}

async function isValid(file, sha1) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return false;
  return !sha1 || (await sha1File(file)) === sha1;
}

/**
 * Downloads and verifies the client jar plus every vanilla and Fabric library.
 * minecraft-launcher-core only checks these exist (and never awaits its own
 * hash check), so a cut connection would otherwise leave a broken install.
 */
async function ensureLibraries(mcVersion, fabricId, onStatus) {
  const vanilla = await getVersionJson(mcVersion);
  const fabric = readJson(path.join(paths.game, 'versions', fabricId, `${fabricId}.json`), { libraries: [] });
  const libDir = path.join(paths.game, 'libraries');
  // minecraft-launcher-core reads the vanilla JSON from here when present.
  writeJson(path.join(paths.game, 'versions', fabricId, `${mcVersion}.json`), vanilla);

  const items = [
    {
      file: path.join(paths.game, 'versions', fabricId, `${fabricId}.jar`),
      url: vanilla.downloads.client.url,
      sha1: vanilla.downloads.client.sha1,
    },
  ];
  for (const lib of vanilla.libraries) {
    const artifact = lib.downloads?.artifact;
    if (!artifact?.url || !allowedOnThisOs(lib)) continue;
    items.push({ file: path.join(libDir, artifact.path), url: artifact.url, sha1: artifact.sha1 });
  }
  for (const lib of fabric.libraries) {
    const rel = mavenPath(lib.name);
    const base = (lib.url || 'https://maven.fabricmc.net/').replace(/\/?$/, '/');
    items.push({ file: path.join(libDir, rel), url: base + rel, sha1: lib.sha1 });
  }

  onStatus({ text: 'Comprobando librerías...', progress: null });
  const missing = [];
  for (const item of items) {
    if (!(await isValid(item.file, item.sha1))) missing.push(item);
  }
  if (!missing.length) return;

  let done = 0;
  const failed = [];
  await runPool(missing, 6, async (item) => {
    try {
      fs.rmSync(item.file, { force: true });
      await downloadFile(item.url, item.file, { sha1: item.sha1 });
    } catch (err) {
      failed.push(err);
    }
    done++;
    onStatus({ text: `Descargando librerías (${done}/${missing.length})`, progress: done / missing.length });
  });
  if (failed.length) {
    throw new Error(`${failed.length} librerías no se pudieron descargar, pulsa JUGAR de nuevo para reintentar (${failed[0].message})`);
  }
}

module.exports = { ensureLibraries };
