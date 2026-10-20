const os = require('os');
const { paths, readJson, writeJson } = require('./paths');

const totalGb = Math.floor(os.totalmem() / 1024 ** 3);

const VOICE_DEFAULTS = {
  enabled: true,
  inputDevice: '',
  outputDevice: '',
  threshold: -50, // dBFS needed to start sending
  micGain: 1,
  volume: 1,
};

function getSettings() {
  const saved = readJson(paths.settings, {});
  return {
    ramGb: Math.max(2, Math.min(6, Math.floor(totalGb / 2))),
    hideOnLaunch: true,
    version: null, // null = the server's default version
    totalGb,
    ...saved,
    voice: { ...VOICE_DEFAULTS, ...saved.voice },
    totalGb,
  };
}

function setSettings(patch) {
  const { totalGb: _ignored, ...current } = getSettings();
  const next = { ...current, ...patch, voice: { ...current.voice, ...patch.voice } };
  next.ramGb = Math.max(1, Math.min(totalGb, Number(next.ramGb) || 4));
  writeJson(paths.settings, next);
  return getSettings();
}

module.exports = { getSettings, setSettings };
