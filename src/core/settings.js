const os = require('os');
const { paths, readJson, writeJson } = require('./paths');

const totalGb = Math.floor(os.totalmem() / 1024 ** 3);

function getSettings() {
  return {
    ramGb: Math.max(2, Math.min(6, Math.floor(totalGb / 2))),
    hideOnLaunch: true,
    version: null, // null = the server's default version
    totalGb,
    ...readJson(paths.settings, {}),
    totalGb,
  };
}

function setSettings(patch) {
  const { totalGb: _ignored, ...current } = getSettings();
  const next = { ...current, ...patch };
  next.ramGb = Math.max(1, Math.min(totalGb, Number(next.ramGb) || 4));
  writeJson(paths.settings, next);
  return getSettings();
}

module.exports = { getSettings, setSettings };
