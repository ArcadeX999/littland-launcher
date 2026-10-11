const fs = require('fs');
const path = require('path');
const { paths, writeJson } = require('./paths');
const { fetchJson, downloadFile, sha1File, runPool } = require('./download');

const versionCache = new Map();

/** Mojang's version JSON (libraries, assetIndex, javaVersion...) for a Minecraft version. */
async function getVersionJson(mcVersion) {
  if (versionCache.has(mcVersion)) return versionCache.get(mcVersion);
  const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new Error(`Minecraft ${mcVersion} no existe en el manifiesto de Mojang`);
  const json = await fetchJson(entry.url);
  versionCache.set(mcVersion, json);
  return json;
}

/**
 * Downloads the game's assets (sounds, textures, languages) with bounded
 * concurrency and retries. minecraft-launcher-core fires thousands of requests
 * at once and some never settle, so we fill the folder first and it skips them.
 */
async function ensureAssets(mcVersion, customId, onStatus) {
  const version = await getVersionJson(mcVersion);
  const assetsDir = path.join(paths.game, 'assets');
  const index = await fetchJson(version.assetIndex.url);
  writeJson(path.join(assetsDir, 'indexes', `${version.assetIndex.id}.json`), index);
  // minecraft-launcher-core reads the index under the custom version's name and
  // never re-downloads it if a (possibly truncated) copy already exists.
  writeJson(path.join(assetsDir, 'indexes', `${customId}.json`), index);

  onStatus({ text: 'Comprobando recursos del juego...', progress: null });
  const unique = new Map();
  for (const { hash } of Object.values(index.objects)) unique.set(hash, true);

  const missing = [];
  for (const hash of unique.keys()) {
    const file = path.join(assetsDir, 'objects', hash.slice(0, 2), hash);
    if (!fs.existsSync(file) || (await sha1File(file)) !== hash) missing.push({ hash, file });
  }
  if (!missing.length) return;

  let done = 0;
  const failed = [];
  await runPool(missing, 8, async ({ hash, file }) => {
    try {
      await downloadFile(`https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`, file, { sha1: hash });
    } catch (err) {
      failed.push(err);
    }
    done++;
    if (done % 10 === 0 || done === missing.length) {
      onStatus({ text: `Descargando recursos (${done}/${missing.length})`, progress: done / missing.length });
    }
  });
  if (failed.length) {
    throw new Error(`${failed.length} recursos no se pudieron descargar, pulsa JUGAR de nuevo para reintentar (${failed[0].message})`);
  }
}

module.exports = { getVersionJson, ensureAssets };
