const crypto = require('crypto');
const { safeStorage } = require('electron');
const { Auth } = require('msmc');
const { Authenticator } = require('minecraft-launcher-core');
const { paths, readJson, writeJson } = require('./paths');

// Stored shape: { selected: id, list: [{ id, type: 'offline'|'msa', name, uuid, refresh? }] }
function load() {
  return readJson(paths.accounts, { selected: null, list: [] });
}

function save(data) {
  writeJson(paths.accounts, data);
}

function encrypt(text) {
  return safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(text).toString('base64')
    : 'raw:' + text;
}

function decrypt(value) {
  if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
  return value.slice(4);
}

/** Accounts without secrets, safe to send to the renderer. */
function list() {
  const data = load();
  return {
    selected: data.selected,
    list: data.list.map(({ id, type, name, uuid }) => ({ id, type, name, uuid })),
  };
}

function upsert(account) {
  const data = load();
  const existing = data.list.findIndex((a) => a.type === account.type && a.uuid === account.uuid);
  if (existing >= 0) {
    account.id = data.list[existing].id;
    data.list[existing] = account;
  } else {
    data.list.push(account);
  }
  data.selected = account.id;
  save(data);
  return list();
}

function addOffline(name) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('El nombre debe tener 3-16 caracteres: letras, números o _');
  }
  // Same UUID scheme vanilla servers use for offline players.
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return upsert({ id: crypto.randomUUID(), type: 'offline', name, uuid });
}

async function addMicrosoft() {
  const auth = new Auth('select_account');
  const xbox = await auth.launch('electron', { width: 500, height: 650, title: 'Iniciar sesión con Microsoft' });
  const mc = await xbox.getMinecraft();
  if (mc.isDemo()) throw new Error('Esta cuenta de Microsoft no tiene Minecraft: Java Edition');
  return upsert({
    id: crypto.randomUUID(),
    type: 'msa',
    name: mc.profile.name,
    uuid: mc.profile.id,
    refresh: encrypt(xbox.save()),
  });
}

function remove(id) {
  const data = load();
  data.list = data.list.filter((a) => a.id !== id);
  if (data.selected === id) data.selected = data.list[0]?.id || null;
  save(data);
  return list();
}

function select(id) {
  const data = load();
  if (data.list.some((a) => a.id === id)) data.selected = id;
  save(data);
  return list();
}

/** Returns the MCLC authorization object for the selected account, refreshing Microsoft tokens. */
async function getAuthorization() {
  const data = load();
  const account = data.list.find((a) => a.id === data.selected);
  if (!account) throw new Error('Selecciona o agrega una cuenta primero');

  if (account.type === 'offline') {
    const auth = await Authenticator.getAuth(account.name);
    return { ...auth, uuid: account.uuid };
  }

  try {
    const xbox = await new Auth('select_account').refresh(decrypt(account.refresh));
    const mc = await xbox.getMinecraft();
    account.refresh = encrypt(xbox.save());
    account.name = mc.profile.name;
    save(data);
    return mc.mclc();
  } catch (err) {
    throw new Error(`La sesión de Microsoft expiró, vuelve a iniciar sesión (${err.message || err})`);
  }
}

module.exports = { list, addOffline, addMicrosoft, remove, select, getAuthorization };
