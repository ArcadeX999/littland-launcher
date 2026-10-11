// Mods browser (Modrinth). Uses `$`, `api` and `busy` from renderer.js.

const mods = {
  query: '',
  sort: 'relevance',
  offset: 0,
  total: 0,
  updates: new Set(),
  working: false,
  searchSeq: 0,
};

// Modrinth lists loaders among categories; this launcher is Fabric-only, so hide them.
const LOADERS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'babric', 'liteloader', 'rift', 'modloader', 'ornithe', 'legacy-fabric', 'bta-babric', 'java-agent', 'nilloader']);

const CATEGORY_NAMES = {
  adventure: 'aventura',
  cursed: 'cursed',
  decoration: 'decoración',
  economy: 'economía',
  equipment: 'equipamiento',
  food: 'comida',
  'game-mechanics': 'mecánicas',
  library: 'librería',
  magic: 'magia',
  management: 'gestión',
  minigame: 'minijuego',
  mobs: 'criaturas',
  optimization: 'optimización',
  social: 'social',
  storage: 'almacenamiento',
  technology: 'tecnología',
  transportation: 'transporte',
  utility: 'utilidad',
  worldgen: 'generación',
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function formatCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} K`;
  return String(n);
}

function modIcon(url) {
  const img = el('img', { class: 'mod-icon', alt: '' });
  if (url) img.src = url;
  return img;
}

function openOnModrinth(slug) {
  if (slug) api.openExternal(`https://modrinth.com/mod/${slug}`);
}

function setModsStatus(text, isError = false) {
  $('mods-status').textContent = text || '';
  $('mods-status').classList.toggle('error', isError);
}

function setNotice(allowed) {
  $('mods-notice').hidden = allowed;
  $('mods-notice').textContent = allowed ? '' : 'El servidor no permite instalar mods propios. Solo se usan los mods del servidor.';
}

/** Runs a mod action with buttons locked and errors shown in the status bar. */
async function modAction(label, fn) {
  if (mods.working) return;
  mods.working = true;
  document.querySelectorAll('#dlg-mods .mod-actions button, #dlg-mods .switch input').forEach((b) => (b.disabled = true));
  setModsStatus(label);
  try {
    const result = await fn();
    setModsStatus('Listo. Los cambios se aplican la próxima vez que pulses JUGAR.');
    return result;
  } catch (err) {
    setModsStatus(err.message, true);
  } finally {
    mods.working = false;
    await Promise.all([renderInstalled(), refreshResultStates()]);
  }
}

// ---------- explore ----------

function resultCard(hit) {
  const actions = el('div', { class: 'mod-actions' });
  if (hit.state === 'server') actions.append(el('span', { class: 'state ok', text: 'Incluido por el servidor' }));
  else if (hit.state === 'blocked') actions.append(el('span', { class: 'state', text: 'No permitido' }));
  else if (hit.state === 'installed') actions.append(el('span', { class: 'state ok', text: '✓ Instalado' }));
  else {
    actions.append(
      el('button', {
        class: 'primary',
        text: 'Instalar',
        onclick: () => modAction(`Instalando ${hit.title}...`, () => api.mods.install(hit.projectId)),
      })
    );
  }

  return el('div', { class: 'mod-card', 'data-id': hit.projectId }, [
    modIcon(hit.iconUrl),
    el('div', { class: 'mod-body' }, [
      el('div', {}, [
        el('span', { class: 'mod-title', text: hit.title, title: 'Ver en Modrinth', onclick: () => openOnModrinth(hit.slug) }),
        el('span', { class: 'mod-author', text: `por ${hit.author}` }),
      ]),
      el('div', { class: 'mod-desc', text: hit.description, title: hit.description }),
      el('div', { class: 'mod-meta' }, [
        el('span', { text: `⬇ ${formatCount(hit.downloads)}` }),
        ...(hit.categories || [])
          .filter((c) => !LOADERS.has(c))
          .slice(0, 3)
          .map((c) => el('span', { class: 'tag', text: CATEGORY_NAMES[c] || c })),
      ]),
    ]),
    actions,
  ]);
}

async function runSearch(append = false) {
  const seq = ++mods.searchSeq;
  if (!append) mods.offset = 0;
  setModsStatus('Buscando...');
  try {
    const res = await api.mods.search({ query: mods.query, sort: mods.sort, offset: mods.offset });
    if (seq !== mods.searchSeq) return; // a newer search started meanwhile
    setNotice(res.allowed);
    $('mods-version').textContent = `Minecraft ${res.mcVersion} · Fabric`;
    mods.total = res.total;
    const list = $('mods-results');
    if (!append) list.replaceChildren();
    list.append(...res.hits.map(resultCard));
    if (!list.children.length) list.append(el('div', { class: 'empty', text: 'No se encontraron mods para esta versión.' }));
    mods.offset += res.hits.length;
    $('mods-more').hidden = mods.offset >= mods.total;
    setModsStatus(`${mods.total.toLocaleString('es')} mods compatibles con ${res.mcVersion}`);
  } catch (err) {
    if (seq === mods.searchSeq) setModsStatus(err.message, true);
  }
}

/** After installs/removals, re-render the visible result cards' buttons. */
async function refreshResultStates() {
  const cards = [...$('mods-results').querySelectorAll('.mod-card')];
  if (!cards.length) return;
  try {
    const { user, server } = await api.mods.list();
    const userIds = new Set(user.map((m) => m.projectId));
    const serverIds = new Set(server.map((m) => m.projectId));
    for (const card of cards) {
      const id = card.dataset.id;
      const actions = card.querySelector('.mod-actions');
      if (serverIds.has(id)) actions.replaceChildren(el('span', { class: 'state ok', text: 'Incluido por el servidor' }));
      else if (userIds.has(id)) actions.replaceChildren(el('span', { class: 'state ok', text: '✓ Instalado' }));
      else if (actions.querySelector('.state.ok')) {
        // Was installed and got removed: offer install again.
        const title = card.querySelector('.mod-title').textContent;
        actions.replaceChildren(
          el('button', {
            class: 'primary',
            text: 'Instalar',
            onclick: () => modAction(`Instalando ${title}...`, () => api.mods.install(id)),
          })
        );
      }
    }
  } catch {
    // Listing failed; the next search will fix the buttons.
  }
}

let searchTimer;
$('mods-query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    mods.query = $('mods-query').value.trim();
    runSearch();
  }, 350);
});
$('mods-sort').addEventListener('change', () => {
  mods.sort = $('mods-sort').value;
  runSearch();
});
$('mods-more').addEventListener('click', () => runSearch(true));

// ---------- installed ----------

function userCard(mod) {
  const toggle = el('label', { class: 'switch', title: mod.enabled ? 'Desactivar' : 'Activar' }, [
    el('input', {
      type: 'checkbox',
      ...(mod.enabled ? { checked: '' } : {}),
      onchange: (e) =>
        modAction(e.target.checked ? `Activando ${mod.title}...` : `Desactivando ${mod.title}...`, () =>
          api.mods.setEnabled(mod.projectId, e.target.checked)
        ),
    }),
    el('span'),
  ]);

  const actions = el('div', { class: 'mod-actions' }, [
    mods.updates.has(mod.projectId)
      ? el('button', {
          class: 'primary',
          text: 'Actualizar',
          onclick: () =>
            modAction(`Actualizando ${mod.title}...`, async () => {
              const r = await api.mods.update(mod.projectId);
              mods.updates.delete(mod.projectId);
              return r;
            }),
        })
      : null,
    toggle,
    el('button', {
      class: 'danger',
      text: 'Quitar',
      onclick: () => modAction(`Quitando ${mod.title}...`, () => api.mods.remove(mod.projectId)),
    }),
  ]);

  return el('div', { class: `mod-card small${mod.enabled ? '' : ' disabled'}` }, [
    modIcon(mod.iconUrl),
    el('div', { class: 'mod-body' }, [
      el('div', {}, [el('span', { class: 'mod-title', text: mod.title, onclick: () => openOnModrinth(mod.slug) })]),
      el('div', { class: 'mod-meta' }, [
        el('span', { text: mod.versionNumber }),
        mod.auto ? el('span', { class: 'tag', text: 'Dependencia' }) : null,
        mod.blocked ? el('span', { class: 'tag warn', text: 'Bloqueado por el servidor' }) : null,
        mods.updates.has(mod.projectId) ? el('span', { class: 'tag accent', text: 'Actualización disponible' }) : null,
      ]),
    ]),
    actions,
  ]);
}

function serverCard(mod) {
  return el('div', { class: 'mod-card small' }, [
    modIcon(mod.iconUrl),
    el('div', { class: 'mod-body' }, [
      el('div', {}, [el('span', { class: 'mod-title', text: mod.title, onclick: () => openOnModrinth(mod.slug) })]),
      el('div', { class: 'mod-meta' }, [el('span', { text: mod.versionNumber || mod.filename })]),
    ]),
    el('div', { class: 'mod-actions' }, [el('span', { class: 'state ok', text: 'Servidor' })]),
  ]);
}

async function renderInstalled() {
  try {
    const { mcVersion, allowed, user, server } = await api.mods.list();
    setNotice(allowed);
    $('mods-version').textContent = `Minecraft ${mcVersion} · Fabric`;
    $('installed-count').textContent = user.length ? `(${user.length})` : '';
    $('mods-user').replaceChildren(
      ...(user.length ? user.map(userCard) : [el('div', { class: 'empty', text: 'Aún no instalaste mods. Búscalos en "Explorar".' })])
    );
    $('mods-server').replaceChildren(
      ...(server.length ? server.map(serverCard) : [el('div', { class: 'empty', text: 'El servidor no añade mods.' })])
    );
    const pending = user.filter((m) => mods.updates.has(m.projectId)).length;
    $('updates-info').textContent = pending ? `${pending} actualización(es) disponible(s)` : '';
  } catch (err) {
    setModsStatus(err.message, true);
  }
}

$('btn-check-updates').addEventListener('click', async () => {
  $('btn-check-updates').disabled = true;
  setModsStatus('Buscando actualizaciones...');
  try {
    mods.updates = new Set(await api.mods.checkUpdates());
    setModsStatus(mods.updates.size ? '' : 'Todos tus mods están al día.');
  } catch (err) {
    setModsStatus(err.message, true);
  } finally {
    $('btn-check-updates').disabled = false;
    renderInstalled();
  }
});

// ---------- dialog / tabs ----------

function showTab(name) {
  document.querySelectorAll('#dlg-mods .tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('tab-browse').hidden = name !== 'browse';
  $('tab-installed').hidden = name !== 'installed';
  if (name === 'installed') renderInstalled();
}

document.querySelectorAll('#dlg-mods .tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

$('btn-mods').addEventListener('click', () => {
  $('dlg-mods').showModal();
  renderInstalled();
  if (!$('mods-results').children.length) runSearch();
});

api.on('mods:progress', (text) => setModsStatus(text));

// The selected Minecraft version decides which mods are shown.
document.addEventListener('version-changed', () => {
  mods.updates.clear();
  $('mods-results').replaceChildren();
  if ($('dlg-mods').open) {
    runSearch();
    renderInstalled();
  }
});
