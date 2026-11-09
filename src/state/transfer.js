import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { homeDir } from "@tauri-apps/api/path";
import { save, open } from "@tauri-apps/plugin-dialog";
import { saveProject, saveRun, deleteRun as dbDeleteRun } from "../db/database.js";
import { projectList, selectProject } from "./projects.js";
import { allRuns, loadRuns } from "./experiments.js";
import { isProjectConnected } from "./dashboard.js";
import { isProjectTraining } from "./training.js";
import {
  buildManifest,
  parseManifest,
  materializeImport,
  nextProjectId,
  importName,
  suggestFileName,
  datasetSources,
  bundledDatasetPaths,
} from "../utils/transfer.js";
import { platform } from "./dashboard.js";

// ── Export / import actions ──────────────────────────────────────────────────
//
// Formats and the pure logic live in utils/transfer.js; archives (Full) are
// packed and unpacked by the backend (src-tauri/src/transfer.rs).

let _appVersion = null;
async function appVersion() {
  if (_appVersion === null) _appVersion = await getVersion().catch(() => "");
  return _appVersion;
}

let _home = null;
/** This machine's home folder, for "~/…" paths in exports. */
async function home() {
  if (_home === null) _home = await homeDir().catch(() => "");
  return _home;
}

const runsOf = (projectId) => allRuns.value.filter((r) => r.projectId === projectId);
const errText = (e) => (typeof e === "string" ? e : e?.message || "Something went wrong.");

/** Projects a restore could replace (not connected and not training). */
export function canReplace(projectId) {
  if (isProjectTraining(projectId)) return { ok: false, reason: "Training is running in this project." };
  if (isProjectConnected(projectId)) return { ok: false, reason: "Disconnect this project first." };
  return { ok: true };
}

const datasetArgs = (project) => datasetSources(project).map(({ key, path, kind }) => ({ key, path, kind }));

/**
 * What a Full export would contain: sizes under each checkpoint policy, the
 * models and checkpoints found, and each dataset path's size (or that it's
 * missing).
 */
export function planFullExport(project) {
  const remote = project.connectionType === "remote";
  return invoke("full_export_plan", {
    projectPath: project.projectPath || "",
    sshCommand: remote ? project.sshCommand : null,
    runIds: runsOf(project.id).map((r) => r.id),
    dataset: datasetArgs(project),
  });
}

/** Which of `paths` exist on this machine. */
export const localPathsExist = (paths) => invoke("local_paths_exist", { paths }).catch(() => paths.map(() => false));

/**
 * Lite / Standard export of a project to a JSON file the user picks.
 * Resolves to { path } or null when the Save dialog is cancelled.
 */
export async function exportJson({ projectId, level, includeConnection }) {
  const project = projectList.value.find((p) => p.id === projectId);
  if (!project) throw new Error("Project not found.");
  const manifest = buildManifest({
    level,
    project,
    runs: runsOf(projectId),
    includeConnection,
    appVersion: await appVersion(),
    home: await home(),
  });
  const path = await save({
    title: "Export project",
    defaultPath: suggestFileName({ level, name: project.name }),
    filters: [{ name: "NightFlow export", extensions: ["json"] }],
  });
  if (!path) return null;
  await invoke("write_transfer_json", { path, contents: JSON.stringify(manifest, null, 2) });
  return { path };
}

/** Subscribes to backend progress for one operation. Returns an unlisten fn. */
async function watchProgress(opId, onProgress) {
  if (!onProgress) return () => {};
  return listen("transfer-progress", (e) => {
    if (e.payload?.op_id === opId) onProgress(e.payload);
  });
}

export const cancelTransfer = (opId) => invoke("cancel_transfer", { opId });

/**
 * Full export of one project to a .nightflow archive. checkpoints:
 * "best_last" | "all" | "none". Resolves to { path, files, bytes,
 * archive_bytes } or null when the Save dialog is cancelled.
 */
export async function exportFull({ projectId, includeConnection, includeDataset = false, checkpoints, opId, onProgress }) {
  const project = projectList.value.find((p) => p.id === projectId);
  if (!project) throw new Error("Project not found.");
  const runs = runsOf(projectId);
  const manifest = buildManifest({ level: "full", project, runs, includeConnection, appVersion: await appVersion(), home: await home() });
  const path = await save({
    title: "Export project with files",
    defaultPath: suggestFileName({ level: "full", name: project.name }),
    filters: [{ name: "NightFlow archive", extensions: ["nightflow"] }],
  });
  if (!path) return null;
  const unlisten = await watchProgress(opId, onProgress);
  try {
    const res = await invoke("full_export", {
      opId,
      dest: path,
      manifest: JSON.stringify(manifest),
      projectPath: project.projectPath || "",
      sshCommand: project.connectionType === "remote" ? project.sshCommand : null,
      runIds: runs.map((r) => r.id),
      checkpoints,
      dataset: includeDataset ? datasetArgs(project) : [],
    });
    return { path, ...res };
  } finally {
    unlisten();
  }
}

/**
 * Lets the user pick an export and reads it.
 * Resolves to { path, kind: "json"|"archive", bytes, manifest } or null.
 * Rejects with a readable message for files that can't be imported.
 */
export async function chooseImportFile() {
  const path = await open({
    title: "Import project",
    multiple: false,
    directory: false,
    filters: [{ name: "NightFlow export", extensions: ["json", "nightflow"] }],
  });
  if (!path) return null;
  const file = await invoke("read_transfer_file", { path }).catch((e) => {
    throw new Error(errText(e));
  });
  const { manifest, error } = parseManifest(file.manifest);
  if (error) throw new Error(error);
  return { path, kind: file.kind, bytes: file.bytes, manifest };
}

/**
 * Imports an export from a project's settings.
 *   mode "new":     creates a new project from the file.
 *   mode "replace": replaces project `projectId`'s settings and run history
 *                   (its id stays, so it keeps its place in the sidebar).
 * overrides: settings to apply on top of the file's (e.g. a project folder
 * or SSH command that wasn't exported).
 * For a Full archive, files are unpacked into the project folder first and
 * the records are saved only once that succeeds. Resolves to the project id.
 */
export async function importIntoProject(file, { mode, projectId, overrides = {}, opId, onProgress }) {
  const replacing = mode === "replace";
  if (replacing) {
    const check = canReplace(projectId);
    if (!check.ok) throw new Error(check.reason);
  }
  const id = replacing ? projectId : nextProjectId(projectList.value.map((p) => p.id));
  // Replacing keeps this project's name; a new project gets the file's, made unique.
  const name = replacing
    ? projectList.value.find((p) => p.id === id)?.name
    : importName(file.manifest.project.name, new Set(projectList.value.map((p) => p.name)));
  const plan = materializeImport(file.manifest, { projectId: id, name, overrides, newId: () => crypto.randomUUID() });
  // A bundled dataset is unpacked into <project>/dataset/<key>/; point the
  // project's dataset paths there.
  const bundled = file.kind === "archive" ? bundledDatasetPaths(file.manifest, plan.project.projectPath, platform.value) : {};
  Object.assign(plan.project, bundled);

  if (file.kind === "archive" && (Object.keys(plan.runIdMap).length || Object.keys(bundled).length)) {
    if (!plan.project.projectPath) throw new Error("Choose a project folder for the files.");
    const unlisten = await watchProgress(opId, onProgress);
    try {
      await invoke("import_archive_files", {
        opId,
        path: file.path,
        destProjectPath: plan.project.projectPath,
        runIdMap: plan.runIdMap,
        totalBytes: file.manifest.archive?.bytes ?? null,
      });
    } finally {
      unlisten();
    }
  }

  if (replacing) {
    for (const r of runsOf(id)) await dbDeleteRun(r.id);
  }
  await saveProject(plan.project);
  for (const r of plan.runs) await saveRun(r);
  projectList.value = replacing
    ? projectList.value.map((p) => (p.id === id ? plan.project : p))
    : [...projectList.value, plan.project];
  await loadRuns();
  if (!replacing) selectProject(id);
  return id;
}
