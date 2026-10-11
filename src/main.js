const path = require('path');
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const { setupUpdater } = require('./updater');

if (!app.requestSingleInstanceLock()) app.quit();

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 960,
    minHeight: 660,
    frame: false,
    backgroundColor: '#070d08',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  // Core modules need `app` ready (paths use app.getPath).
  const { config } = require('./core/paths');
  const accounts = require('./core/accounts');
  const { launchGame, getSettings, setSettings, getVersions, isRunning } = require('./core/launch');
  const userMods = require('./core/usermods');
  const { pingServer, discordOnline } = require('./core/status');

  const send = (event, payload) => win && !win.isDestroyed() && win.webContents.send(event, payload);

  ipcMain.handle('config', () => ({
    serverName: config.serverName,
    serverAddress: config.serverAddress,
    branding: config.branding || {},
    links: config.links || {},
  }));
  ipcMain.handle('discord:online', () => discordOnline(config.links?.discord));
  ipcMain.handle('accounts:list', () => accounts.list());
  ipcMain.handle('accounts:addOffline', (_e, name) => accounts.addOffline(name));
  ipcMain.handle('accounts:addMicrosoft', () => accounts.addMicrosoft());
  ipcMain.handle('accounts:remove', (_e, id) => accounts.remove(id));
  ipcMain.handle('accounts:select', (_e, id) => accounts.select(id));
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:set', (_e, patch) => setSettings(patch));
  ipcMain.handle('versions:list', () => getVersions());
  ipcMain.handle('server:ping', () => pingServer(config.serverAddress));

  // Changing files in mods/ while Minecraft has them open fails on Windows.
  const whenIdle = (fn) => {
    if (isRunning()) throw new Error('Cierra Minecraft para cambiar los mods');
    return fn();
  };
  const modProgress = (text) => send('mods:progress', text);
  ipcMain.handle('mods:list', () => userMods.list());
  ipcMain.handle('mods:search', (_e, params) => userMods.search(params));
  ipcMain.handle('mods:install', (_e, id) => whenIdle(() => userMods.install(id, modProgress)));
  ipcMain.handle('mods:update', (_e, id) => whenIdle(() => userMods.update(id, modProgress)));
  ipcMain.handle('mods:remove', (_e, id) => whenIdle(() => userMods.remove(id)));
  ipcMain.handle('mods:setEnabled', (_e, id, on) => whenIdle(() => userMods.setEnabled(id, on)));
  ipcMain.handle('mods:checkUpdates', () => userMods.checkUpdates());

  ipcMain.handle('game:launch', async () => {
    const result = await launchGame((event, payload) => {
      send(event, payload);
      if (event === 'state' && !payload.running && win && !win.isVisible()) win.show();
    });
    if (result.hideOnLaunch) win.hide();
  });

  ipcMain.on('window:minimize', () => win.minimize());
  ipcMain.on('window:close', () => win.close());
  ipcMain.on('open:external', (_e, url) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.on('open:folder', () => shell.openPath(require('./core/paths').paths.game));

  createWindow();

  // Launcher self-update. The last event is kept so a UI that loads later
  // (or reloads) still learns that an update is waiting.
  let updateState = null;
  const updater = setupUpdater((event, payload) => {
    if (event !== 'update:progress') updateState = { event, ...payload };
    send(event, payload);
  });
  ipcMain.handle('update:state', () => updateState);
  ipcMain.handle('update:install', () => {
    if (isRunning()) throw new Error('Cierra Minecraft antes de actualizar el launcher');
    updater.install();
  });
  ipcMain.handle('app:version', () => app.getVersion());
});

app.on('window-all-closed', () => app.quit());
