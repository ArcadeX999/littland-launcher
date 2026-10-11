const fs = require('fs');
const path = require('path');
const { paths, writeJson } = require('./paths');
const { fetchJson } = require('./download');

const META = 'https://meta.fabricmc.net/v2';

async function latestLoader(mcVersion) {
  const loaders = await fetchJson(`${META}/versions/loader/${encodeURIComponent(mcVersion)}`);
  const stable = loaders.find((l) => l.loader.stable) || loaders[0];
  if (!stable) throw new Error(`Fabric no tiene loader para Minecraft ${mcVersion}`);
  return stable.loader.version;
}

/**
 * Installs the Fabric version profile (game/versions/<id>/<id>.json) so
 * minecraft-launcher-core can launch it as a custom version. Returns the id.
 */
async function ensureFabric(mcVersion, loaderVersion) {
  const loader = loaderVersion || (await latestLoader(mcVersion));
  const id = `fabric-loader-${loader}-${mcVersion}`;
  const file = path.join(paths.game, 'versions', id, `${id}.json`);
  if (fs.existsSync(file)) return id;

  const profile = await fetchJson(
    `${META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`
  );
  writeJson(file, profile);
  return id;
}

module.exports = { ensureFabric };
