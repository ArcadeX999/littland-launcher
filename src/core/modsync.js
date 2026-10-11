const fs = require('fs');
const path = require('path');
const { config, paths, readJson, writeJson } = require('./paths');
const { fetchJson, downloadFile, sha1File, runPool } = require('./download');

/**
 * Manifest shape:
 * {
 *   "default": "1.21.8",
 *   "versions": {
 *     "1.21.8": { "fabricLoader"?: "...", "java"?: 21, "managedDirs"?: ["mods"],
 *                 "files": [{ "path", "url", "sha1", "size" }] },
 *     ...
 *   }
 * }
 *
 * Fetches it, falling back to the last cached copy so players can still
 * launch if the web host is temporarily down.
 */
async function loadManifest() {
  try {
    const manifest = await fetchJson(config.manifestUrl);
    validateManifest(manifest);
    writeJson(paths.manifestCache, manifest);
    return manifest;
  } catch (err) {
    const cached = readJson(paths.manifestCache, null);
    if (cached) return cached;
    throw new Error(`No se pudo leer el manifest del servidor: ${err.message}`);
  }
}

function validateManifest(m) {
  if (!m || typeof m.versions !== 'object' || !Object.keys(m.versions).length) {
    throw new Error('El manifest no tiene "versions"');
  }
  if (!m.versions[m.default]) throw new Error(`La versión por defecto "${m.default}" no está en "versions"`);
  for (const [version, entry] of Object.entries(m.versions)) {
    if (!Array.isArray(entry.files)) entry.files = [];
    for (const f of entry.files) {
      if (!f.path || !f.url || !f.sha1) throw new Error(`Entrada inválida en ${version}: ${JSON.stringify(f)}`);
    }
  }
}

/** Versions offered by the server, newest first. */
function listVersions(manifest) {
  return Object.keys(manifest.versions).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true })
  );
}

/** Picks the player's chosen version if the server still offers it, else the default. */
function resolveVersion(manifest, wanted) {
  const mcVersion = manifest.versions[wanted] ? wanted : manifest.default;
  return { mcVersion, entry: manifest.versions[mcVersion] };
}

/** Resolves a manifest path inside the game folder, refusing anything that escapes it. */
function safeResolve(relPath) {
  const full = path.resolve(paths.game, relPath);
  if (!full.startsWith(path.resolve(paths.game) + path.sep)) {
    throw new Error(`Ruta no permitida en el manifest: ${relPath}`);
  }
  return full;
}

/**
 * Brings the game folder in line with one version's file list: downloads
 * missing or changed files and removes files in managed folders (default:
 * mods) that it doesn't list, so switching versions swaps the modpack.
 */
async function syncFiles(entry, onStatus) {
  const wanted = new Map();
  for (const f of entry.files) wanted.set(safeResolve(f.path), f);

  onStatus({ text: 'Comprobando archivos...', progress: null });
  const toDownload = [];
  for (const [full, f] of wanted) {
    if (!fs.existsSync(full) || (await sha1File(full)) !== f.sha1.toLowerCase()) {
      toDownload.push({ full, f });
    }
  }

  const managed = entry.managedDirs || ['mods'];
  let removed = 0;
  for (const dir of managed) {
    const full = safeResolve(dir);
    if (!fs.existsSync(full)) continue;
    for (const item of fs.readdirSync(full, { withFileTypes: true })) {
      const file = path.join(full, item.name);
      if (item.isFile() && !wanted.has(file)) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    }
  }

  let done = 0;
  await runPool(toDownload, 4, async ({ full, f }) => {
    const url = new URL(f.url, config.manifestUrl).href;
    await downloadFile(url, full, { sha1: f.sha1 });
    done++;
    onStatus({ text: `Descargando mods (${done}/${toDownload.length})`, progress: done / toDownload.length });
  });

  return { downloaded: toDownload.length, removed };
}

module.exports = { loadManifest, listVersions, resolveVersion, syncFiles };
