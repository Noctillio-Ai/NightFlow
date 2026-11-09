// Export / import file format (pure; no I/O). See state/transfer.js for the
// actions and src-tauri/src/transfer.rs for archives.
//
// An export is one project, made from (and imported into) that project's
// settings:
//   { format: "nightflow", version: 2, level, createdAt, app,
//     includesConnection, project, runs, strippedFields,
//     archive?: { files, bytes, checkpoints } }   // Full exports only
//
// Levels: "lite" (settings only), "standard" (+ runs and metrics),
// "full" (standard + project files, packed by the backend as .nightflow).
//
// Older files still import: v1 exports ({ project, runs }) and bare project
// configs.

export const FORMAT = "nightflow";
export const FORMAT_VERSION = 2;
export const LEVELS = ["lite", "standard", "full"];

/** Machine-specific settings left out when connection details are excluded. */
export const CONNECTION_FIELDS = [
  "sshCommand",
  "projectPath",
  "folderPath",
  "trainPath",
  "valPath",
  "testPath",
  "imageFolderPath",
];

/** Dataset path fields, by the key their bundled copy uses in an archive. */
export const DATASET_KEYS = {
  folder: "folderPath",
  train: "trainPath",
  val: "valPath",
  test: "testPath",
  images: "imageFolderPath",
};

const isTabular = (format) => format === "CSV" || format === "JSONL";

/**
 * The dataset paths a project uses, as bundling sources:
 * [{ key, field, path, kind: "dir" | "file" }]. Folder-style formats use the
 * dataset folder; CSV/JSONL use the split files plus the image folder.
 */
export function datasetSources(project) {
  const p = project || {};
  const out = [];
  const add = (key, kind) => {
    const field = DATASET_KEYS[key];
    const path = String(p[field] || "").trim();
    if (path) out.push({ key, field, path, kind });
  };
  if (isTabular(p.datasetFormat)) {
    add("train", "file");
    add("val", "file");
    add("test", "file");
    add("images", "dir");
  } else {
    add("folder", "dir");
  }
  return out;
}

/** Dataset fields shown for a project's format (whether or not they're set). */
export function datasetFields(format) {
  return isTabular(format) ? ["trainPath", "valPath", "testPath", "imageFolderPath"] : ["folderPath"];
}

/**
 * `path` with the home folder written as "~" so it still works for another
 * user name or OS ("/Users/ana/data" → "~/data"). Other paths are unchanged.
 */
export function portablePath(path, home) {
  if (typeof path !== "string" || !path || !home) return path;
  const h = home.replace(/[\\/]+$/, "");
  if (path === h) return "~";
  for (const sep of ["/", "\\"]) {
    if (path.startsWith(h + sep)) return `~${sep}${path.slice(h.length + 1)}`;
  }
  return path;
}

/** Applies portablePath to every string in `value` (deeply). */
function portableDeep(value, home) {
  if (typeof value === "string") return portablePath(value, home);
  if (Array.isArray(value)) return value.map((v) => portableDeep(v, home));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = portableDeep(v, home);
    return out;
  }
  return value;
}

/**
 * Dataset settings for an import whose archive bundled the dataset: each
 * bundled path now lives in `<projectFolder>/dataset/<key>/`.
 */
export function bundledDatasetPaths(manifest, projectFolder, platform) {
  const sep = platform === "windows" ? "\\" : "/";
  const base = String(projectFolder || "").replace(/[\\/]+$/, "");
  const out = {};
  for (const d of manifest.archive?.dataset || []) {
    const field = DATASET_KEYS[d.key];
    if (!field || !base) continue;
    const dir = `${base}${sep}dataset${sep}${d.key}`;
    out[field] = d.kind === "file" ? `${dir}${sep}${String(d.path).split(/[\\/]/).pop()}` : `${dir}${sep}`;
  }
  return out;
}

/** Internal state never exported. */
const VOLATILE_FIELDS = ["syncMetadata"];

// ── Paths ──

/** An absolute path: /x, ~/x, C:\x, C:/x or \\server\share. */
export function looksLikePath(v) {
  if (typeof v !== "string" || v.length < 2 || /\s{2,}|\n/.test(v)) return false;
  return /^(\/|~\/|~$|[A-Za-z]:[\\/]|\\\\)/.test(v) && /[\\/]/.test(v);
}

const basename = (p) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";

/** Replaces every absolute-path string inside `value` with its last segment. */
export function scrubPaths(value) {
  if (looksLikePath(value)) return basename(value);
  if (Array.isArray(value)) return value.map(scrubPaths);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubPaths(v);
    return out;
  }
  return value;
}

// ── Export ──

/** Project settings for export; `strippedFields` lists what was left out. */
export function exportProject(project, includeConnection) {
  const p = { ...project };
  for (const k of VOLATILE_FIELDS) delete p[k];
  const strippedFields = [];
  if (!includeConnection) {
    for (const k of CONNECTION_FIELDS) {
      if (p[k] && p[k] !== "localhost") strippedFields.push(k);
      if (k in p) p[k] = k === "sshCommand" && p.connectionType !== "remote" ? "localhost" : "";
    }
  }
  return { project: p, strippedFields };
}

/** A run record for export; absolute paths are scrubbed without connection details. */
export function exportRun(run, includeConnection, home) {
  if (!includeConnection) return scrubPaths({ ...run });
  return home ? portableDeep({ ...run }, home) : { ...run };
}

/**
 * The export of one project. Lite drops runs. Full is written as a Standard
 * manifest; the backend adds `archive` when packing.
 */
export function buildManifest({ level, project, runs = [], includeConnection, appVersion = "", now = new Date(), home = "" }) {
  if (!LEVELS.includes(level)) throw new Error(`Unknown export level: ${level}`);
  const { project: p, strippedFields } = exportProject(project, includeConnection);
  // Local paths travel as "~/…" (a remote project's paths are on the server,
  // which doesn't change with this machine).
  const portable = includeConnection && project.connectionType !== "remote" ? home : "";
  if (portable) for (const k of CONNECTION_FIELDS) if (k !== "sshCommand") p[k] = portablePath(p[k], portable);
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    level,
    createdAt: now.toISOString(),
    app: { name: "NightFlow", version: appVersion },
    includesConnection: !!includeConnection,
    project: p,
    runs: level === "lite" ? [] : runs.map((r) => exportRun(r, includeConnection, portable)),
    strippedFields,
  };
}

const slug = (s) =>
  String(s || "project").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";

/** "Retail-Shelf-standard-2026-11-09.json" / "….nightflow" for Full. */
export function suggestFileName({ level, name, now = new Date() }) {
  const date = now.toISOString().slice(0, 10);
  return `${slug(name)}-${level}-${date}.${level === "full" ? "nightflow" : "json"}`;
}

// ── Import ──

const isProjectLike = (o) => !!o && typeof o === "object" && !Array.isArray(o) && typeof o.taskType === "string";

const validRuns = (runs) => (Array.isArray(runs) ? runs.filter((r) => r && typeof r.id === "string") : []);

/**
 * Parses an export (any supported version) into the v2 shape.
 * Returns { manifest } or { error } with a readable message.
 */
export function parseManifest(text) {
  let data;
  try {
    data = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    return { error: "The file isn't valid JSON." };
  }
  if (!data || typeof data !== "object") return { error: "This isn't a NightFlow export." };

  if (data.format === FORMAT) {
    if (typeof data.version !== "number" || data.version > FORMAT_VERSION) {
      return { error: "This file was made by a newer version of NightFlow. Update the app to import it." };
    }
    if (!isProjectLike(data.project)) return { error: "The export has no valid project settings." };
    return {
      manifest: {
        ...data,
        level: LEVELS.includes(data.level) ? data.level : "standard",
        runs: validRuns(data.runs),
        strippedFields: Array.isArray(data.strippedFields) ? data.strippedFields : [],
      },
    };
  }

  const legacy = (project, runs) => ({
    manifest: {
      format: FORMAT,
      version: 1,
      legacy: true,
      level: runs.length ? "standard" : "lite",
      createdAt: null,
      includesConnection: true,
      project,
      runs,
      strippedFields: [],
    },
  });
  // v1 export: { project, runs }
  if (isProjectLike(data.project)) return legacy(data.project, validRuns(data.runs));
  // The old whole-database backup holds many projects; imports are per project.
  if (Array.isArray(data.projects)) {
    return { error: "This is a backup of several projects. Import exports of a single project instead." };
  }
  // Bare project config
  if (isProjectLike(data)) return legacy(data, []);
  return { error: "This isn't a NightFlow export." };
}

/** Next numeric project id after `ids`. */
export function nextProjectId(ids) {
  return String(Math.max(0, ...ids.map((id) => Number(id) || 0)) + 1);
}

/** The name to give an imported project so it doesn't collide. */
export function importName(name, existingNames) {
  const base = (name || "Imported project").trim();
  if (!existingNames.has(base)) return base;
  const first = `${base} (imported)`;
  if (!existingNames.has(first)) return first;
  for (let i = 2; ; i++) {
    const n = `${base} (imported ${i})`;
    if (!existingNames.has(n)) return n;
  }
}

/**
 * Records ready to save for one exported project. Runs always get fresh ids
 * (so importing next to the original never overwrites its runs); `runIdMap`
 * maps old → new for renaming run folders in a Full import.
 */
export function materializeImport(manifest, { projectId, name, overrides = {}, newId }) {
  const project = { ...manifest.project, ...overrides, id: projectId };
  if (name) project.name = name;
  for (const k of VOLATILE_FIELDS) delete project[k];
  const runIdMap = {};
  const runs = (manifest.runs || []).map((r) => {
    const id = newId();
    runIdMap[r.id] = id;
    return { ...r, id, projectId };
  });
  return { project, runs, runIdMap };
}

/** One-line summary of an export for previews. */
export function describeManifest(m) {
  const runs = m.runs.length;
  const parts = [m.project.name || "Untitled project"];
  if (m.level !== "lite") parts.push(`${runs} run${runs === 1 ? "" : "s"}`);
  if (m.archive) parts.push(`${m.archive.files} file${m.archive.files === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
