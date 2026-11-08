// Model exports per run (TorchScript / ONNX / TensorRT files kept in the run
// folder). Lives outside components so a running export keeps its progress
// when the user leaves the Deploy page and comes back.

import { signal } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** runId → ExportInfo[] ({ format, path, sizeBytes, modifiedMs }). Missing = not loaded yet. */
export const runExports = signal({});
/** "runId:format" → { stage, startedAt } for exports in progress. */
export const exportJobs = signal({});
/** "runId:format" → last error message. */
export const exportErrors = signal({});

export const jobKey = (runId, format) => `${runId}:${format}`;

function setKey(sig, key, value) {
  const next = { ...sig.value };
  if (value === undefined) delete next[key];
  else next[key] = value;
  sig.value = next;
}

let listening = false;
function ensureProgressListener() {
  if (listening) return;
  listening = true;
  listen("export-progress", ({ payload }) => {
    const key = jobKey(payload.runId, payload.format);
    const job = exportJobs.value[key];
    if (job) setKey(exportJobs, key, { ...job, stage: payload.stage });
  }).catch(() => {
    listening = false;
  });
}

/** Reload the export list for a run. `loc` = { projectPath, runId, sshCommand }. */
export async function refreshExports(loc) {
  const list = await invoke("list_exports", loc);
  setKey(runExports, loc.runId, list);
  return list;
}

/** Build (or with `force`, rebuild) one export. Resolves to its ExportInfo. */
export async function buildExport(loc, format, taskClass, force = false) {
  const key = jobKey(loc.runId, format);
  if (exportJobs.value[key]) return null;
  ensureProgressListener();
  setKey(exportErrors, key, undefined);
  const startedAt = Date.now();
  setKey(exportJobs, key, { stage: "locate", startedAt });
  try {
    const info = await invoke("export_model", { ...loc, taskClass, format, force });
    return { info, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    setKey(exportErrors, key, String(err));
    throw err;
  } finally {
    setKey(exportJobs, key, undefined);
    // TensorRT also leaves an ONNX export behind; a failed rebuild may remove a file.
    refreshExports(loc).catch(() => {});
  }
}

export async function saveExport(loc, runName, format) {
  setKey(exportErrors, jobKey(loc.runId, format), undefined);
  try {
    return await invoke("save_export", { ...loc, runName, format });
  } catch (err) {
    setKey(exportErrors, jobKey(loc.runId, format), String(err));
    throw err;
  }
}

export async function deleteExport(loc, format) {
  await invoke("delete_export", { ...loc, format });
  const list = (runExports.value[loc.runId] || []).filter((e) => e.format !== format);
  setKey(runExports, loc.runId, list);
}
