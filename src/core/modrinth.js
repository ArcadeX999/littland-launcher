const { app } = require('electron');
const { fetchJson } = require('./download');

const API = 'https://api.modrinth.com/v2';
// Modrinth asks API clients to identify themselves.
const HEADERS = { 'User-Agent': `littland-launcher/${app.getVersion()}` };

function get(path, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const qs = params.toString();
  return fetchJson(`${API}${path}${qs ? `?${qs}` : ''}`, { headers: HEADERS });
}

/** Client-side Fabric mods for one Minecraft version. */
function search({ query, sort = 'relevance', offset = 0, limit = 20, mcVersion }) {
  return get('/search', {
    query: query || undefined,
    index: sort,
    offset: String(offset),
    limit: String(limit),
    facets: [
      ['project_type:mod'],
      ['categories:fabric'],
      [`versions:${mcVersion}`],
      ['client_side:required', 'client_side:optional'],
    ],
  });
}

function getProject(idOrSlug) {
  return get(`/project/${encodeURIComponent(idOrSlug)}`);
}

function getVersion(versionId) {
  return get(`/version/${encodeURIComponent(versionId)}`);
}

/** Newest Fabric version of a project for `mcVersion`, preferring releases over betas. */
async function latestVersion(projectId, mcVersion) {
  const versions = await get(`/project/${encodeURIComponent(projectId)}/version`, {
    loaders: ['fabric'],
    game_versions: [mcVersion],
  });
  return versions.find((v) => v.version_type === 'release') || versions[0] || null;
}

/** Maps file sha1 -> Modrinth version for files Modrinth knows about. */
function versionsByHash(hashes) {
  if (!hashes.length) return Promise.resolve({});
  return fetchJson(`${API}/version_files`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes, algorithm: 'sha1' }),
  });
}

/** Basic info for several projects at once. */
function getProjects(ids) {
  if (!ids.length) return Promise.resolve([]);
  return get('/projects', { ids });
}

module.exports = { search, getProject, getVersion, latestVersion, versionsByHash, getProjects };
