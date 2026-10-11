const $ = (id) => document.getElementById(id);
const api = window.launcher;

let accounts = { selected: null, list: [] };
let busy = false;

// ---------- helpers ----------

function headUrl(account) {
  return `https://mc-heads.net/avatar/${account.type === 'msa' ? account.uuid : account.name}/64`;
}

function setProgress(text, progress) {
  $('progress-text').textContent = text;
  const bar = $('progress-fill').parentElement;
  bar.classList.toggle('indeterminate', progress === null);
  $('progress-fill').style.width = progress === null ? '' : `${Math.round(progress * 100)}%`;
}

function setBusy(value) {
  busy = value;
  $('btn-play').disabled = value;
  $('version').disabled = value;
  $('btn-play').textContent = value ? 'INICIANDO...' : '⛏ JUGAR';
}

function log(line) {
  const el = $('console');
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
  el.textContent += line.endsWith('\n') ? line : line + '\n';
  if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-150000);
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ---------- accounts ----------

function renderAccounts() {
  const current = accounts.list.find((a) => a.id === accounts.selected);
  if (current) {
    $('account-head').src = headUrl(current);
    $('account-name').textContent = current.name;
    $('account-type').textContent = current.type === 'msa' ? 'Microsoft' : 'No premium';
  } else {
    $('account-head').removeAttribute('src');
    $('account-name').textContent = 'Sin cuenta';
    $('account-type').textContent = 'Haz clic para agregar';
  }

  const list = $('account-list');
  list.replaceChildren();
  if (!accounts.list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Todavía no hay cuentas';
    list.append(li);
    return;
  }
  for (const acc of accounts.list) {
    const li = document.createElement('li');
    li.classList.toggle('selected', acc.id === accounts.selected);

    const img = document.createElement('img');
    img.src = headUrl(acc);
    const info = document.createElement('div');
    info.className = 'info';
    info.textContent = acc.name;
    const small = document.createElement('small');
    small.textContent = acc.type === 'msa' ? 'Microsoft' : 'No premium';
    info.append(small);
    const del = document.createElement('button');
    del.textContent = 'Quitar';
    del.onclick = async (e) => {
      e.stopPropagation();
      accounts = await api.accounts.remove(acc.id);
      renderAccounts();
    };

    li.onclick = async () => {
      accounts = await api.accounts.select(acc.id);
      renderAccounts();
    };
    li.append(img, info, del);
    list.append(li);
  }
}

async function withAccountError(fn) {
  $('account-error').textContent = '';
  try {
    accounts = await fn();
    renderAccounts();
    return true;
  } catch (err) {
    const msg = String(err.message || err);
    $('account-error').textContent = /error\.gui\.closed/.test(msg) ? 'Inicio de sesión cancelado' : msg;
    return false;
  }
}

$('account-chip').onclick = () => $('dlg-accounts').showModal();

$('btn-add-ms').onclick = async () => {
  $('btn-add-ms').disabled = true;
  await withAccountError(() => api.accounts.addMicrosoft());
  $('btn-add-ms').disabled = false;
};

$('form-offline').onsubmit = async (e) => {
  e.preventDefault();
  const name = $('offline-name').value.trim();
  if (await withAccountError(() => api.accounts.addOffline(name))) $('offline-name').value = '';
};

// ---------- settings ----------

async function openSettings() {
  const s = await api.settings.get();
  $('ram').max = s.totalGb;
  $('ram').value = s.ramGb;
  $('ram-value').textContent = s.ramGb;
  $('ram-total').textContent = `(de ${s.totalGb} GB)`;
  $('hide-on-launch').checked = s.hideOnLaunch;
  $('dlg-settings').showModal();
}

$('btn-settings').onclick = openSettings;
$('ram').oninput = () => ($('ram-value').textContent = $('ram').value);
$('ram').onchange = () => api.settings.set({ ramGb: Number($('ram').value) });
$('hide-on-launch').onchange = () => api.settings.set({ hideOnLaunch: $('hide-on-launch').checked });
$('btn-folder').onclick = () => api.openGameFolder();

// ---------- versions ----------

async function loadVersions() {
  const select = $('version');
  try {
    const { versions, default: def, selected } = await api.versions();
    select.replaceChildren(
      ...versions.map((v) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v === def ? `${v} (recomendada)` : v;
        opt.selected = v === selected;
        return opt;
      })
    );
    select.disabled = false;
  } catch (err) {
    select.replaceChildren(new Option('Sin conexión'));
    log(`[ERROR] ${err.message}`);
  }
}

$('version').onchange = async () => {
  await api.settings.set({ version: $('version').value });
  document.dispatchEvent(new Event('version-changed'));
};

// ---------- console / dialogs / window ----------

$('btn-console').onclick = () => {
  $('dlg-console').showModal();
  $('console').scrollTop = $('console').scrollHeight;
};
document.querySelectorAll('.close-dialog').forEach((b) => (b.onclick = () => b.closest('dialog').close()));
$('btn-min').onclick = () => api.minimize();
$('btn-close').onclick = () => api.close();

// ---------- play ----------

$('btn-play').onclick = async () => {
  if (busy) return;
  if (!accounts.selected) {
    $('dlg-accounts').showModal();
    return;
  }
  setBusy(true);
  log('--- Iniciando ---');
  try {
    await api.launch();
  } catch (err) {
    setBusy(false);
    setProgress(`Error: ${err.message}`, 0);
    log(`[ERROR] ${err.message}`);
  }
};

api.on('status', ({ text, progress }) => setProgress(text, progress));
api.on('log', log);
api.on('state', ({ running, code }) => {
  if (running) return;
  setBusy(false);
  setProgress(code ? `Minecraft se cerró con código ${code} (revisa la consola)` : 'Listo para jugar', code ? 0 : 1);
});

// ---------- server status ----------

async function refreshStatus() {
  const s = await api.ping();
  $('pill-players').classList.toggle('offline', !s.online);
  if (s.online) {
    $('pill-players-n').textContent = s.players;
    $('stat-online').textContent = s.players;
    $('stat-max').textContent = s.max;
    $('stat-ping').textContent = `${s.ping} ms`;
    $('stat-status').textContent = 'ONLINE';
    $('stat-version').textContent = s.version || 'Estado';
  } else {
    $('pill-players-n').textContent = '0';
    for (const id of ['stat-online', 'stat-max', 'stat-ping']) $(id).textContent = '-';
    $('stat-status').textContent = 'OFFLINE';
    $('stat-version').textContent = 'Estado';
  }
}

async function refreshDiscord() {
  const n = await api.discordOnline();
  $('pill-discord').hidden = n === null;
  if (n !== null) $('pill-discord-n').textContent = n;
}

function toast(text) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 1800);
}

/** Floating pixels like the website background. */
function spawnParticles(count = 26) {
  const box = $('particles');
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    if (i % 5 === 0) p.className = 'gold';
    const size = 2 + Math.round(Math.random() * 3);
    p.style.left = `${Math.random() * 100}%`;
    p.style.width = p.style.height = `${size}px`;
    p.style.animationDuration = `${9 + Math.random() * 12}s`;
    p.style.animationDelay = `${-Math.random() * 20}s`;
    box.append(p);
  }
}

function applyBranding(cfg) {
  const b = cfg.branding || {};
  const title = b.title || cfg.serverName.toUpperCase();
  $('brand-title').textContent = title;
  $('hero-title').textContent = title;
  $('brand-accent').textContent = b.titleAccent || '';
  $('hero-accent').textContent = b.titleAccent || '';
  $('brand-sub').textContent = (b.subtitle || 'Minecraft Server').toUpperCase();
  $('hero-tagline').textContent = b.tagline || '';
  $('hero-desc').textContent = b.description || '';
  $('season-badge').hidden = !b.badge;
  $('season-badge').textContent = b.badge || '';
  $('features').replaceChildren(
    ...(b.features || []).map((f) => {
      const tag = document.createElement('span');
      const { text, color } = typeof f === 'string' ? { text: f } : f;
      tag.className = `feature ${color || ''}`;
      tag.textContent = text;
      return tag;
    })
  );
  document.title = `${title}${b.titleAccent ? ` ${b.titleAccent}` : ''} Launcher`;

  $('server-ip').textContent = cfg.serverAddress;
  $('btn-copy-ip').onclick = () => {
    api.copyText(cfg.serverAddress);
    toast('¡IP COPIADA!');
  };

  const discord = cfg.links.discord;
  $('btn-discord').hidden = !discord;
  $('btn-discord').onclick = () => api.openExternal(discord);
  $('pill-discord').onclick = () => discord && api.openExternal(discord);
}

// ---------- launcher self-update ----------

function showUpdate(state) {
  const pill = $('update-pill');
  if (!state || state.event === 'update:error') {
    pill.hidden = true;
    return;
  }
  pill.hidden = false;
  pill.classList.toggle('ready', state.event === 'update:ready');
  if (state.event === 'update:ready') {
    pill.textContent = `✓ v${state.version} lista · REINICIAR`;
    pill.title = 'Reinicia el launcher para usar la nueva versión';
  } else {
    pill.textContent = `⬇ Actualizando launcher${state.percent != null ? ` ${state.percent}%` : '...'}`;
    pill.title = '';
  }
}

$('update-pill').onclick = async () => {
  if (!$('update-pill').classList.contains('ready')) return;
  try {
    await api.update.install();
  } catch (err) {
    toast(err.message.toUpperCase());
  }
};

let pendingVersion = null;
api.on('update:available', ({ version }) => {
  pendingVersion = version;
  showUpdate({ event: 'update:available', version });
});
api.on('update:progress', ({ percent }) => showUpdate({ event: 'update:progress', version: pendingVersion, percent }));
api.on('update:ready', (p) => showUpdate({ event: 'update:ready', ...p }));
api.on('update:error', (p) => {
  log(`[Actualización] ${p.message}`);
  showUpdate(null);
});

// ---------- init ----------

(async () => {
  const cfg = await api.config();
  applyBranding(cfg);
  spawnParticles();
  showUpdate(await api.update.state());
  $('app-version').textContent = `Littland Launcher v${await api.appVersion()}`;

  accounts = await api.accounts.list();
  renderAccounts();
  setProgress('Listo para jugar', 0);
  loadVersions();

  refreshStatus();
  setInterval(refreshStatus, 30000);
  refreshDiscord();
  setInterval(refreshDiscord, 120000);
})();
