const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'launcher.config.json'), 'utf8')
);

// Lets you test a local modpack before uploading it (see README).
if (process.env.LITTLAND_MANIFEST_URL) config.manifestUrl = process.env.LITTLAND_MANIFEST_URL;
if (process.env.LITTLAND_SERVER_ADDRESS) config.serverAddress = process.env.LITTLAND_SERVER_ADDRESS;

const root = path.join(app.getPath('appData'), config.dataFolder || '.littland');

const paths = {
  root,
  game: path.join(root, 'game'),
  runtime: path.join(root, 'runtime'),
  accounts: path.join(root, 'accounts.json'),
  settings: path.join(root, 'settings.json'),
  manifestCache: path.join(root, 'manifest.cache.json'),
  userMods: path.join(root, 'usermods.json'),
};

for (const dir of [paths.root, paths.game, paths.runtime]) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = { config, paths, readJson, writeJson };
