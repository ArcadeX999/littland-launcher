const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { Client } = require('minecraft-launcher-core');
const { config, paths } = require('./paths');
const { getSettings, setSettings } = require('./settings');
const userMods = require('./usermods');
const { loadManifest, listVersions, resolveVersion, syncFiles } = require('./modsync');
const { ensureFabric } = require('./fabric');
const { ensureJava, requiredJava } = require('./java');
const { ensureAssets } = require('./mojang');
const { ensureLibraries } = require('./libraries');
const accounts = require('./accounts');

/**
 * On a fresh install, pre-create options.txt so the first-launch accessibility
 * screen doesn't block quickPlay, and default the game to the system language.
 */
function ensureFirstRunOptions() {
  const file = path.join(paths.game, 'options.txt');
  if (fs.existsSync(file)) return;
  const [base, region = base] = app.getLocale().toLowerCase().split('-');
  // "es-419" (Latin American Spanish) has no direct Minecraft equivalent.
  const lang = /^[a-z]{2}$/.test(region) ? `${base}_${region}` : base === 'es' ? 'es_mx' : `${base}_${base}`;
  fs.writeFileSync(file, `onboardAccessibility:false\nlang:${lang}\n`);
}

/** Versions the server offers, for the UI's selector. */
async function getVersions() {
  const manifest = await loadManifest();
  const { mcVersion } = resolveVersion(manifest, getSettings().version);
  return { versions: listVersions(manifest), default: manifest.default, selected: mcVersion };
}

let running = false;

const isRunning = () => running;

/**
 * Full launch flow: account -> manifest -> mods -> Java -> assets -> Fabric -> libraries -> Minecraft.
 * `emit(event, payload)` forwards status/log/state updates to the UI.
 */
async function launchGame(emit) {
  if (running) throw new Error('El juego ya se está iniciando');
  running = true;
  const status = (s) => emit('status', s);

  try {
    status({ text: 'Verificando cuenta...', progress: null });
    const authorization = await accounts.getAuthorization();

    status({ text: 'Leyendo configuración del servidor...', progress: null });
    const manifest = await loadManifest();

    const settings = getSettings();
    const { mcVersion, entry } = resolveVersion(manifest, settings.version);
    emit('log', `--- Minecraft ${mcVersion} ---`);

    const playerFiles = await userMods.filesFor(mcVersion, entry, userMods.policyOf(manifest));
    await syncFiles({ ...entry, files: [...entry.files, ...playerFiles] }, status);

    const javaMajor = entry.java || (await requiredJava(mcVersion));
    const javaPath = await ensureJava(javaMajor, status);

    status({ text: 'Preparando Fabric...', progress: null });
    const fabricId = await ensureFabric(mcVersion, entry.fabricLoader);

    await ensureAssets(mcVersion, fabricId, status);
    await ensureLibraries(mcVersion, fabricId, status);

    ensureFirstRunOptions();
    const client = new Client();

    client.on('progress', (p) => {
      status({ text: `Descargando Minecraft (${p.type})`, progress: p.total ? p.task / p.total : null });
    });
    client.on('data', (line) => emit('log', String(line)));
    client.on('debug', (line) => emit('log', String(line)));
    client.on('close', (code) => {
      running = false;
      emit('state', { running: false, code });
    });

    status({ text: 'Iniciando Minecraft...', progress: null });
    const proc = await client.launch({
      root: paths.game,
      authorization,
      javaPath,
      version: { number: mcVersion, type: 'release', custom: fabricId },
      memory: { max: `${settings.ramGb}G`, min: '1G' },
      quickPlay: config.serverAddress
        ? { type: 'multiplayer', identifier: config.serverAddress }
        : undefined,
      timeout: 30000,
      overrides: { detached: false },
    });

    if (!proc) throw new Error('Minecraft no pudo iniciarse, revisa la consola');
    // The manifest's "voice" section exists only when the server runs LittlandVoice.
    const voice = manifest.voice && manifest.voice.enabled !== false
      ? { voiceConfig: manifest.voice, serverAddress: config.serverAddress, name: authorization.name }
      : null;
    emit('state', { running: true, voice });
    status({ text: 'Jugando', progress: 1 });
    return { hideOnLaunch: settings.hideOnLaunch };
  } catch (err) {
    running = false;
    throw err;
  }
}

module.exports = { launchGame, getSettings, setSettings, getVersions, isRunning };
