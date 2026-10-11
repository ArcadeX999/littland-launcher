#!/usr/bin/env node
/**
 * Builds a new launcher version for GitHub Releases.
 *
 *   npm run release            -> 1.0.0 -> 1.0.1
 *   npm run release -- minor   -> 1.0.0 -> 1.1.0
 *
 * Then upload the three files it prints to a new release on
 * https://github.com/ArcadeX999/littland-launcher/releases/new
 * Installed launchers pick it up on their next start.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));

const bump = process.argv[2] || 'patch';
const [major, minor, patch] = pkg.version.split('.').map(Number);
pkg.version =
  bump === 'major' ? `${major + 1}.0.0` : bump === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Versión ${pkg.version}\n`);

execSync('npx electron-builder --win --publish never', { cwd: root, stdio: 'inherit' });

const exe = `Littland-Launcher-Setup-${pkg.version}.exe`;
console.log(`
Listo. Crea una release en:
  https://github.com/ArcadeX999/littland-launcher/releases/new
  - Tag: v${pkg.version}
  - Sube estos 3 archivos de la carpeta dist/:
      ${exe}
      ${exe}.blockmap
      latest.yml
  - Pulsa "Publish release".
Los launchers instalados se actualizarán solos al abrirse.`);
