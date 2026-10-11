const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * Keeps the launcher itself up to date from GitHub Releases
 * (see "publish" in package.json). Updates download in the background and
 * install when the player restarts the launcher or clicks "Reiniciar".
 *
 * `send(event, payload)` forwards 'update:available' / 'update:progress' /
 * 'update:ready' / 'update:error' to the UI.
 */
function setupUpdater(send) {
  // Dev runs (npm start) have no release to compare against, unless a test
  // config is forced via LITTLAND_UPDATE_TEST.
  if (!app.isPackaged && !process.env.LITTLAND_UPDATE_TEST) return { install: () => {} };
  if (process.env.LITTLAND_UPDATE_TEST) autoUpdater.forceDevUpdateConfig = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => send('update:available', { version: info.version }));
  autoUpdater.on('download-progress', (p) => send('update:progress', { percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => send('update:ready', { version: info.version }));
  autoUpdater.on('error', (err) => send('update:error', { message: String(err?.message || err) }));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 60 * 60 * 1000);

  return {
    // isSilent=true: no installer wizard; isForceRunAfter=true: reopen the launcher.
    install: () => autoUpdater.quitAndInstall(true, true),
  };
}

module.exports = { setupUpdater };
