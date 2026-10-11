const fs = require('fs');
const path = require('path');
const { paths, readJson, writeJson } = require('./paths');
const { downloadFile } = require('./download');
const { loadManifest, resolveVersion } = require('./modsync');
const { getSettings } = require('./settings');
const modrinth = require('./modrinth');

/*
 * Mods the player installs from Modrinth, on top of the server's modpack.
 * Stored per Minecraft version in usermods.json:
 *   { "1.21.8": { "<projectId>": { projectId, slug, title, iconUrl, versionId,
 *       versionNumber, filename, url, sha1, enabled, auto, requires: [projectId] } } }
 * `auto` marks mods pulled in only as a dependency, removed when nothing needs them.
 */

// Mod operations touch the same files, so they run one at a time.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(() => fn());
  queue = run.catch(() => {});
  return run;
}

const modsDir = () => path.join(paths.game, 'mods');
const loadAll = () => readJson(paths.userMods, {});
const saveAll = (data) => writeJson(paths.userMods, data);

function fileName(mod) {
  return mod.enabled ? mod.filename : `${mod.filename}.disabled`;
}

/** Server policy from the manifest: { enabled, blocked: Set of project ids/slugs }. */
function policyOf(manifest) {
  const p = manifest.userMods || {};
  return {
    enabled: p.enabled !== false,
    blocked: new Set((p.blocked || []).map((s) => String(s).toLowerCase())),
  };
}

function isBlocked(policy, project) {
  return policy.blocked.has(String(project.projectId || project.project_id || project.id).toLowerCase())
    || policy.blocked.has(String(project.slug).toLowerCase());
}

/** The version the player will launch, with its manifest entry and policy. */
async function context() {
  const manifest = await loadManifest();
  const { mcVersion, entry } = resolveVersion(manifest, getSettings().version);
  return { mcVersion, entry, policy: policyOf(manifest) };
}

const serverCache = new Map();

/**
 * Identifies the server's own mods on Modrinth (by sha1) so the browser can
 * show them as included and never install a second copy.
 */
async function serverMods(mcVersion, entry) {
  const files = entry.files.filter((f) => /^mods\/[^/]+\.jar$/.test(f.path));
  const key = mcVersion + files.map((f) => f.sha1).join();
  if (serverCache.has(key)) return serverCache.get(key);

  let byHash = {};
  let projects = [];
  try {
    byHash = await modrinth.versionsByHash(files.map((f) => f.sha1));
    projects = await modrinth.getProjects([...new Set(Object.values(byHash).map((v) => v.project_id))]);
  } catch {
    // Offline: still list the files, just without Modrinth details.
  }
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const result = files.map((f) => {
    const version = byHash[f.sha1];
    const project = version && projectById.get(version.project_id);
    return {
      projectId: version?.project_id || null,
      slug: project?.slug || null,
      title: project?.title || path.basename(f.path),
      iconUrl: project?.icon_url || null,
      versionNumber: version?.version_number || '',
      filename: path.basename(f.path),
    };
  });
  serverCache.set(key, result);
  return result;
}

/** Files the sync step must keep/download for the player's mods of `mcVersion`. */
async function filesFor(mcVersion, entry, policy) {
  if (!policy.enabled) return [];
  const server = await serverMods(mcVersion, entry);
  const serverIds = new Set(server.map((m) => m.projectId).filter(Boolean));
  const serverFiles = new Set(server.map((m) => m.filename));
  return Object.values(loadAll()[mcVersion] || {})
    .filter((m) => !isBlocked(policy, m) && !serverIds.has(m.projectId) && !serverFiles.has(m.filename))
    .map((m) => ({ path: `mods/${fileName(m)}`, url: m.url, sha1: m.sha1 }));
}

/** Everything the "Instalados" tab shows. */
async function list() {
  const { mcVersion, entry, policy } = await context();
  const user = Object.values(loadAll()[mcVersion] || {})
    .map((m) => ({ ...m, blocked: isBlocked(policy, m) }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { mcVersion, allowed: policy.enabled, server: await serverMods(mcVersion, entry), user };
}

/** Modrinth search annotated with what's already installed or not allowed. */
async function search(params) {
  const { mcVersion, entry, policy } = await context();
  const [result, server] = await Promise.all([
    modrinth.search({ ...params, mcVersion }),
    serverMods(mcVersion, entry),
  ]);
  const serverIds = new Set(server.map((m) => m.projectId));
  const mine = loadAll()[mcVersion] || {};
  return {
    mcVersion,
    allowed: policy.enabled,
    total: result.total_hits,
    hits: result.hits.map((h) => ({
      projectId: h.project_id,
      slug: h.slug,
      title: h.title,
      author: h.author,
      description: h.description,
      iconUrl: h.icon_url,
      downloads: h.downloads,
      categories: h.display_categories || h.categories,
      state: serverIds.has(h.project_id)
        ? 'server'
        : isBlocked(policy, h)
          ? 'blocked'
          : mine[h.project_id]
            ? 'installed'
            : null,
    })),
  };
}

/** Installs a project (and its required dependencies) into `mods`, recording it. */
async function installTree(state, projectId, versionId, auto, onStatus) {
  if (state.visited.has(projectId)) return;
  state.visited.add(projectId);
  if (state.serverIds.has(projectId)) return;

  const existing = state.mods[projectId];
  if (existing && !state.forceUpdate.has(projectId)) {
    if (!auto) existing.auto = false;
    return;
  }

  const [project, version] = await Promise.all([
    modrinth.getProject(projectId),
    versionId ? modrinth.getVersion(versionId) : modrinth.latestVersion(projectId, state.mcVersion),
  ]);
  if (isBlocked(state.policy, project)) throw new Error(`${project.title} no está permitido en este servidor`);
  if (!version || !version.game_versions.includes(state.mcVersion) || !version.loaders.includes('fabric')) {
    throw new Error(`${project.title} no tiene versión de Fabric para Minecraft ${state.mcVersion}`);
  }
  const file = version.files.find((f) => f.primary) || version.files[0];

  onStatus?.(`Descargando ${project.title}...`);
  const mod = {
    projectId,
    slug: project.slug,
    title: project.title,
    iconUrl: project.icon_url,
    versionId: version.id,
    versionNumber: version.version_number,
    filename: file.filename,
    url: file.url,
    sha1: file.hashes.sha1,
    enabled: existing ? existing.enabled : true,
    auto: existing ? existing.auto && auto : auto,
    requires: [],
  };
  await downloadFile(mod.url, path.join(modsDir(), fileName(mod)), { sha1: mod.sha1 });
  if (existing && existing.filename !== mod.filename) {
    fs.rmSync(path.join(modsDir(), fileName(existing)), { force: true });
  }
  state.mods[projectId] = mod;

  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required') continue;
    const depProject = dep.project_id || (await modrinth.getVersion(dep.version_id)).project_id;
    mod.requires.push(depProject);
    await installTree(state, depProject, dep.version_id, true, onStatus);
  }
}

async function withState(fn) {
  const { mcVersion, entry, policy } = await context();
  if (!policy.enabled) throw new Error('El servidor no permite instalar mods propios');
  const all = loadAll();
  const mods = (all[mcVersion] = all[mcVersion] || {});
  const server = await serverMods(mcVersion, entry);
  const state = {
    mcVersion,
    policy,
    mods,
    serverIds: new Set(server.map((m) => m.projectId).filter(Boolean)),
    visited: new Set(),
    forceUpdate: new Set(),
  };
  try {
    await fn(state);
  } finally {
    // Keep whatever finished downloading even if a later dependency failed.
    saveAll(all);
  }
  return list();
}

function install(projectId, onStatus) {
  return serial(() => withState((state) => installTree(state, projectId, null, false, onStatus)));
}

/** Re-resolves the newest version of a mod and its dependencies. */
function update(projectId, onStatus) {
  return serial(() => withState(async (state) => {
    const mod = state.mods[projectId];
    if (!mod) return;
    state.forceUpdate.add(projectId);
    await installTree(state, projectId, null, mod.auto, onStatus);
  }));
}

/** Removes a mod plus any auto-installed dependencies nothing else needs. */
function remove(projectId) {
  return serial(() => removeNow(projectId));
}

async function removeNow(projectId) {
  const { mcVersion } = await context();
  const all = loadAll();
  const mods = all[mcVersion] || {};
  const drop = (id) => {
    fs.rmSync(path.join(modsDir(), fileName(mods[id])), { force: true });
    delete mods[id];
  };
  if (mods[projectId]) drop(projectId);

  let pruned = true;
  while (pruned) {
    pruned = false;
    const needed = new Set(Object.values(mods).flatMap((m) => m.requires || []));
    for (const [id, m] of Object.entries(mods)) {
      if (m.auto && !needed.has(id)) {
        drop(id);
        pruned = true;
      }
    }
  }
  saveAll(all);
  return list();
}

/** Enables/disables a mod by renaming it to/from *.jar.disabled. */
function setEnabled(projectId, enabled) {
  return serial(() => setEnabledNow(projectId, enabled));
}

async function setEnabledNow(projectId, enabled) {
  const { mcVersion } = await context();
  const all = loadAll();
  const mods = all[mcVersion] || {};
  if (!mods[projectId]) return list();

  const toggle = (mod, on) => {
    if (mod.enabled === on) return;
    const from = path.join(modsDir(), fileName(mod));
    mod.enabled = on;
    if (fs.existsSync(from)) fs.renameSync(from, path.join(modsDir(), fileName(mod)));
  };

  if (enabled) {
    // A mod can't run without its dependencies, so switch those on too.
    const seen = new Set();
    const enableTree = (id) => {
      const mod = mods[id];
      if (!mod || seen.has(id)) return;
      seen.add(id);
      toggle(mod, true);
      (mod.requires || []).forEach(enableTree);
    };
    enableTree(projectId);
  } else {
    const dependents = Object.values(mods).filter((m) => m.enabled && (m.requires || []).includes(projectId));
    if (dependents.length) {
      throw new Error(`${mods[projectId].title} es necesario para ${dependents.map((m) => m.title).join(', ')}`);
    }
    toggle(mods[projectId], false);
  }
  saveAll(all);
  return list();
}

/** Project ids of the player's mods with a newer Modrinth version. */
async function checkUpdates() {
  const { mcVersion } = await context();
  const mods = Object.values(loadAll()[mcVersion] || {});
  const results = await Promise.all(
    mods.map(async (m) => {
      try {
        const latest = await modrinth.latestVersion(m.projectId, mcVersion);
        return latest && latest.id !== m.versionId ? m.projectId : null;
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

module.exports = { list, search, install, update, remove, setEnabled, checkUpdates, filesFor, policyOf };
