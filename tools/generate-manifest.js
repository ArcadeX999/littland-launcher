#!/usr/bin/env node
/**
 * Builds manifest.json for the launcher from a folder with one subfolder per
 * Minecraft version, each mirroring the client's game folder:
 *
 *   modpack/
 *     1.21.8/mods/*.jar
 *     1.21.8/config/...        (optional)
 *     1.21.11/mods/*.jar
 *
 * Usage:
 *   node tools/generate-manifest.js <folder> --default 1.21.8 [--managed mods,resourcepacks]
 *     [--blocked xray-mod,freecam] [--no-user-mods | --allow-user-mods]
 *
 *     [--voice-port 24454] [--voice-host fr01.holy.gg] [--no-voice]
 *
 * --voice-port enables the LittlandVoice chat (the plugin's UDP port).
 * --voice-host is only needed if voice runs on another machine than the game.
 *
 * Flags you leave out keep the value from the existing manifest.json.
 *
 * --blocked: Modrinth slugs or project ids players may not install themselves.
 * --no-user-mods: hide the in-launcher mod browser (only server mods are used).
 *
 * Optional per-version overrides go in <folder>/<version>/version.json, e.g.
 *   { "fabricLoader": "0.17.2", "java": 21 }
 *
 * Then upload the whole <folder> (including the generated manifest.json) to
 * your web host and point "manifestUrl" in launcher.config.json at it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const folder = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!folder) {
  console.error('Uso: node tools/generate-manifest.js <carpeta> [--default <versión>] [--blocked a,b] [--no-user-mods]');
  process.exit(1);
}

const root = path.resolve(folder);
// Settings not passed as flags are kept from the previous manifest.
const previous = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const managedDirs = (flag('managed') || 'mods').split(',').map((s) => s.trim()).filter(Boolean);

function listFiles(versionDir, version) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(versionDir, full).split(path.sep).join('/');
      if (rel === 'version.json') continue;
      const data = fs.readFileSync(full);
      files.push({
        path: rel,
        url: [version, ...rel.split('/')].map(encodeURIComponent).join('/'),
        sha1: crypto.createHash('sha1').update(data).digest('hex'),
        size: data.length,
      });
    }
  };
  walk(versionDir);
  return files;
}

const versions = {};
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d+(\.\d+)+$/.test(entry.name)) continue;
  const versionDir = path.join(root, entry.name);
  const overridesFile = path.join(versionDir, 'version.json');
  const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
  versions[entry.name] = { managedDirs, ...overrides, files: listFiles(versionDir, entry.name) };
}

const names = Object.keys(versions).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!names.length) {
  console.error(`No hay carpetas de versión (ej. ${path.join(folder, '1.21.8')}) dentro de ${root}`);
  process.exit(1);
}

const def = flag('default') || (versions[previous.default] ? previous.default : names[0]);
if (!versions[def]) {
  console.error(`La versión por defecto ${def} no tiene carpeta. Disponibles: ${names.join(', ')}`);
  process.exit(1);
}

const userMods = {
  enabled: args.includes('--no-user-mods')
    ? false
    : args.includes('--allow-user-mods') || previous.userMods?.enabled !== false,
  blocked:
    flag('blocked') !== undefined
      ? flag('blocked').split(',').map((s) => s.trim()).filter(Boolean)
      : previous.userMods?.blocked || [],
};

let voice = previous.voice || null;
if (args.includes('--no-voice')) voice = null;
else if (flag('voice-port') || flag('voice-host')) {
  voice = { ...voice, enabled: true, port: Number(flag('voice-port') || voice?.port || 24454) };
  if (flag('voice-host')) voice.host = flag('voice-host');
}

fs.writeFileSync(
  path.join(root, 'manifest.json'),
  JSON.stringify({ default: def, userMods, ...(voice && { voice }), versions }, null, 2)
);
console.log(`manifest.json generado (por defecto ${def}):`);
for (const v of names) console.log(`  ${v}: ${versions[v].files.length} archivos`);
console.log(voice ? `Chat de voz: puerto ${voice.port}${voice.host ? ` en ${voice.host}` : ''}` : 'Chat de voz: desactivado');
console.log(userMods.enabled ? `Mods de jugadores: permitidos${userMods.blocked.length ? ` (bloqueados: ${userMods.blocked.join(', ')})` : ''}` : 'Mods de jugadores: desactivados');
