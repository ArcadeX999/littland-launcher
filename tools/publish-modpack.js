#!/usr/bin/env node
/**
 * Regenerates modpack/manifest.json and pushes the modpack to GitHub Pages.
 * Players get the changes the next time they press JUGAR.
 *
 * Usage (any generate-manifest flag is forwarded):
 *   npm run publicar
 *   npm run publicar -- --default 1.21.11
 *   npm run publicar -- --blocked xray-mod,freecam
 */
const path = require('path');
const { execFileSync } = require('child_process');

const modpack = path.join(__dirname, '..', 'modpack');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: modpack, stdio: 'inherit' });
const output = (cmd, args) => execFileSync(cmd, args, { cwd: modpack, encoding: 'utf8' });

run(process.execPath, [path.join(__dirname, 'generate-manifest.js'), modpack, ...process.argv.slice(2)]);

run('git', ['add', '-A']);
if (!output('git', ['status', '--porcelain']).trim()) {
  console.log('\nNo hay cambios que publicar.');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
run('git', ['commit', '-q', '-m', `Actualizar modpack (${stamp})`]);
run('git', ['push', '-q']);
console.log('\nModpack publicado. GitHub Pages tarda 1-2 minutos en actualizarse.');
