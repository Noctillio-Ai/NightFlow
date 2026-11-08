import { useState, useEffect } from "preact/hooks";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { notify } from "../../utils/notifications.js";
import { formatBytes, formatRelativeTime } from "../../utils/format.js";
import { gpuAvailable } from "../../state/dashboard.js";
import {
  runExports, exportJobs, exportErrors, jobKey,
  refreshExports, buildExport, saveExport, deleteExport,
} from "../../state/exports.js";
import {
  FORMATS, FORMAT_BY_ID, taskClassFor, runLocation, useCopy, elapsedLabel,
  CheckIcon, CopyIcon, DownloadIcon, FolderIcon, TrashIcon, RefreshIcon, LayersIcon, AlertIcon,
} from "./shared.jsx";

/** Stages `export_model` reports through `export-progress`, per format. */
const STAGES = {
  torchscript: [["locate", "Finding checkpoint"], ["convert", "Tracing to TorchScript"]],
  onnx: [["locate", "Finding checkpoint"], ["convert", "Converting to ONNX"]],
  tensorrt: [["locate", "Finding checkpoint"], ["convert", "Converting to ONNX"], ["engine", "Building engine"]],
};

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function Progress({ format, job }) {
  const now = useNow(true);
  const stages = STAGES[format];
  const idx = Math.max(0, stages.findIndex(([id]) => id === job.stage));
  const pct = Math.round(((idx + 0.5) / stages.length) * 100);
  return (
    <div class="dpm-progress" role="status" aria-live="polite">
      <div class="dpm-tile-line">
        <span class="dpm-tile-value dpm-tile-value--sm">{stages[idx][1]}…</span>
        <span class="dpm-tile-detail">Step {idx + 1} of {stages.length} · {elapsedLabel(now - job.startedAt)}</span>
      </div>
      <div class="dpm-bar"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

const stop = (fn) => (e) => { e.stopPropagation(); fn(e); };

function FormatTile({ f, info, job, error, isRemote, disabledReason, selected, onSelect, onBuild, onSave, onDelete, savedPath }) {
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, copy] = useCopy();

  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  const save = async () => {
    setSaving(true);
    try { await onSave(); } finally { setSaving(false); }
  };

  const state = job ? "building" : info ? "ready" : disabledReason ? "disabled" : "empty";
  const chip = {
    ready: <span class="dpm-chip dpm-chip--ok"><CheckIcon size={10} /> Ready</span>,
    building: <span class="dpm-chip dpm-chip--live"><span class="dpm-live-dot" /> Exporting</span>,
    disabled: <span class="dpm-chip">Unavailable</span>,
    empty: <span class="dpm-chip">Not exported</span>,
  }[state];

  return (
    <div class={`dpm-tile is-${state}${selected ? " is-selected" : ""}`} onClick={onSelect}>
      <span class="dpm-tile-icon">{f.icon}</span>

      <div class="dpm-tile-main">
        <div class="dpm-tile-top">
          <button type="button" class="dpm-tile-name" onClick={stop(onSelect)} aria-pressed={selected} title="Show the script for this format">
            {f.label} <code>{f.ext}</code>
          </button>
          {chip}
        </div>
        {job ? (
          <Progress format={f.id} job={job} />
        ) : info ? (
          <div class="dpm-tile-line" title={info.path}>
            <span class="dpm-tile-value">{formatBytes(info.sizeBytes)}</span>
            <span class="dpm-tile-detail">
              Exported {info.modifiedMs ? formatRelativeTime(info.modifiedMs) : ""}{isRemote ? " · on training machine" : ""}
            </span>
          </div>
        ) : (
          <div class="dpm-tile-line">
            <span class="dpm-tile-value dpm-tile-value--muted">{f.tagline}</span>
            <span class="dpm-tile-detail" title={disabledReason || f.desc}>{disabledReason || f.desc}</span>
          </div>
        )}
      </div>

      <div class="dpm-tile-actions">
        {state === "ready" && (
          <>
            <div class="dpm-tools">
              <button type="button" class="dpm-icon-btn" onClick={stop(() => onBuild(true))} title="Rebuild from the checkpoint" aria-label={`Rebuild ${f.label}`}>
                <RefreshIcon size={14} />
              </button>
              {!isRemote && (
                <button type="button" class="dpm-icon-btn" onClick={stop(() => revealItemInDir(info.path).catch((e) => notify("Could not open folder", String(e))))} title="Show in folder" aria-label={`Show ${f.label} in folder`}>
                  <FolderIcon size={14} />
                </button>
              )}
              <button type="button" class="dpm-icon-btn" onClick={stop(() => copy(info.path))} title={copied ? "Copied" : "Copy file path"} aria-label={`Copy ${f.label} path`}>
                {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              </button>
              {confirm ? (
                <button type="button" class="dpm-icon-btn dpm-icon-btn--danger" onClick={stop(() => { setConfirm(false); onDelete(); })}>Delete?</button>
              ) : (
                <button type="button" class="dpm-icon-btn" onClick={stop(() => setConfirm(true))} title="Delete export" aria-label={`Delete ${f.label}`}>
                  <TrashIcon size={14} />
                </button>
              )}
            </div>
            <button type="button" class="dash-btn dash-btn--primary dpm-tile-btn" onClick={stop(save)} disabled={saving}>
              {saving ? <span class="download-spinner" /> : <DownloadIcon size={14} />}
              {saving ? "Saving…" : "Download"}
            </button>
          </>
        )}
        {state === "empty" && (
          <button type="button" class="dash-btn dpm-tile-btn" onClick={stop(() => onBuild(false))}>
            <LayersIcon size={14} /> Export
          </button>
        )}
      </div>

      {savedPath && !job && (
        <div class="dpm-tile-msg dpm-tile-msg--ok">
          <CheckIcon size={12} /><span>Saved to <code>{savedPath}</code></span>
          <button type="button" class="dpm-link" onClick={stop(() => revealItemInDir(savedPath).catch(() => {}))}>Show</button>
        </div>
      )}
      {error && !job && (
        <div class="dpm-tile-msg dpm-tile-msg--err" title={error}><AlertIcon size={12} /><span>{error}</span></div>
      )}
    </div>
  );
}

/** One tile per export format. Clicking a tile picks the script's format. */
export function FormatTiles({ run, project, selected, onSelect }) {
  const loc = runLocation(project, run);
  const byFormat = Object.fromEntries((runExports.value[run.id] || []).map((e) => [e.format, e]));
  const isRemote = project?.connectionType === "remote";
  const [listError, setListError] = useState("");
  const [saved, setSaved] = useState({});

  const refresh = async () => {
    if (!project) return;
    try {
      await refreshExports(loc);
      setListError("");
    } catch (err) {
      setListError(String(err));
    }
  };

  useEffect(() => { refresh(); }, [run.id, project?.projectPath]);

  const build = async (format, force) => {
    onSelect(format);
    try {
      const res = await buildExport(loc, format, taskClassFor(project.taskType, project), force);
      if (res) {
        setSaved((s) => ({ ...s, [format]: undefined }));
        notify("Export ready", `${FORMAT_BY_ID[format].label} finished in ${elapsedLabel(res.elapsedMs)}`);
      }
    } catch (err) {
      notify("Export failed", String(err));
    }
  };

  const save = async (format) => {
    try {
      const path = await saveExport(loc, run.name || run.id, format);
      setSaved((s) => ({ ...s, [format]: path }));
      notify("Model saved", `${FORMAT_BY_ID[format].label} saved to ${path}`);
    } catch (err) {
      notify("Download failed", String(err));
      refresh();
    }
  };

  const remove = async (format) => {
    try {
      await deleteExport(loc, format);
      setSaved((s) => ({ ...s, [format]: undefined }));
    } catch (err) {
      notify("Delete failed", String(err));
    }
  };

  return (
    <>
      {listError && (
        <div class="dpm-tile-msg dpm-tile-msg--err"><AlertIcon size={12} /><span>Could not check existing exports: {listError}</span></div>
      )}
      <div class="dpm-tiles">
        {FORMATS.map((f) => {
          const key = jobKey(run.id, f.id);
          return (
            <FormatTile
              key={f.id}
              f={f}
              info={byFormat[f.id]}
              job={exportJobs.value[key]}
              error={exportErrors.value[key]}
              isRemote={isRemote}
              disabledReason={f.id === "tensorrt" && !gpuAvailable.value && !byFormat[f.id] ? "Needs an NVIDIA GPU on the training machine." : ""}
              selected={selected === f.id}
              savedPath={saved[f.id]}
              onSelect={() => onSelect(f.id)}
              onBuild={(force) => build(f.id, force)}
              onSave={() => save(f.id)}
              onDelete={() => remove(f.id)}
            />
          );
        })}
      </div>
    </>
  );
}
