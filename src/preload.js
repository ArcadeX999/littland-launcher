const { contextBridge, ipcRenderer } = require('electron');

// Errors thrown in main arrive as "Error invoking remote method 'x': Error: msg".
async function call(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
}

contextBridge.exposeInMainWorld('launcher', {
  config: () => call('config'),
  accounts: {
    list: () => call('accounts:list'),
    addOffline: (name) => call('accounts:addOffline', name),
    addMicrosoft: () => call('accounts:addMicrosoft'),
    remove: (id) => call('accounts:remove', id),
    select: (id) => call('accounts:select', id),
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  versions: () => call('versions:list'),
  mods: {
    list: () => call('mods:list'),
    search: (params) => call('mods:search', params),
    install: (id) => call('mods:install', id),
    update: (id) => call('mods:update', id),
    remove: (id) => call('mods:remove', id),
    setEnabled: (id, on) => call('mods:setEnabled', id, on),
    checkUpdates: () => call('mods:checkUpdates'),
  },
  ping: () => call('server:ping'),
  discordOnline: () => call('discord:online'),
  appVersion: () => call('app:version'),
  update: {
    state: () => call('update:state'),
    install: () => call('update:install'),
  },
  voice: {
    sendAudio: (sequence, data) => ipcRenderer.send('voice:audio', sequence, data),
    setState: (state) => ipcRenderer.send('voice:setState', state),
  },
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  launch: () => call('game:launch'),
  on: (event, cb) => ipcRenderer.on(event, (_e, payload) => cb(payload)),
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.send('open:external', url),
  openGameFolder: () => ipcRenderer.send('open:folder'),
});
