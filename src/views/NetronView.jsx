import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { notify } from "../utils/notifications.js";
import { completedRuns, selectedRunId, selectedRun } from "../state/interpretation.js";
import { currentProject } from "../state/projects.js";
import { navigate } from "../state/router.js";
import { formatRelativeTime } from "../utils/format.js";
import { AlertIcon, ArrowRightIcon, CubeIcon, DatabaseIcon, LayersIcon, RefreshIcon, XIcon } from "../components/dashboard/icons.jsx";

const modelSrc = signal(null);
const loadedRunId = signal(null);
const loading = signal(false);
/** When the current export started (ms), for the elapsed timer. */
const exportStartedAt = signal(0);
const error = signal(null);
/** Models opened this session, newest first: [{ runId, runName, backbone, src, at }]. */
const recent = signal([]);

const TASK_CLASS = {
  Classification: "ImageClassifier",
  "Multi-Label Classification": "ImageClassifier",
  "Semantic Segmentation": "SemanticSegmentor",
  "Instance Segmentation": "InstanceSegmentor",
};

const hpOf = (run, ...keys) => {
  for (const src of [run?.fileHparams, run?.hyperparameters]) for (const k of keys) if (src?.[k] != null && src[k] !== "") return src[k];
  return undefined;
};

async function handleLoad() {
  const run = selectedRun.value;
  const project = currentProject.value;
  if (!run || !project) return;

  loading.value = true;
  exportStartedAt.value = Date.now();
  error.value = null;
  modelSrc.value = null;

  try {
    const sshCommand = project.connectionType === "remote" ? project.sshCommand : null;
    const taskClass =
      project.taskType === "Object Detection"
        ? project.detectionArch === "yolox" ? "YOLOXDetector" : "ObjectDetector"
        : TASK_CLASS[project.taskType] || "ImageClassifier";

    const ptPath = await invoke("export_jit_model", {
      projectPath: project.projectPath,
      runId: run.id,
      taskClass,
      sshCommand,
    });

    const src = `/netron/index.html?url=${encodeURIComponent(convertFileSrc(ptPath))}`;
    modelSrc.value = src;
    loadedRunId.value = run.id;
    recent.value = [
      { runId: run.id, runName: run.name || run.id, backbone: run.backbone || run.model, src, at: new Date().toISOString() },
      ...recent.value.filter((r) => r.runId !== run.id),
    ].slice(0, 6);
    notify("Model Loaded", "Model exported and loaded into Netron viewer.");
  } catch (err) {
    error.value = typeof err === "string" ? err : err.message || "Export failed";
    notify("Model Export Failed", error.value);
  } finally {
    loading.value = false;
  }
}

/** Show a model exported earlier this session without exporting it again. */
function reopen(entry) {
  if (completedRuns.value.some((r) => r.id === entry.runId)) selectedRunId.value = entry.runId;
  error.value = null;
  modelSrc.value = entry.src;
  loadedRunId.value = entry.runId;
}

function handleClear() {
  modelSrc.value = null;
  loadedRunId.value = null;
  error.value = null;
}

const GraphIcon = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="5" r="2.6" /><circle cx="5.5" cy="18.5" r="2.6" /><circle cx="18.5" cy="18.5" r="2.6" />
    <path d="M10.7 7.2 6.8 16.2M13.3 7.2l3.9 9" />
  </svg>
);
const ExternalIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);
const DocIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" />
  </svg>
);

/** What the run's settings say about the model's shape: input → backbone → head. */
function Pipeline({ run, classes, size, task, busy }) {
  const steps = [
    { kind: "io", title: "Input", detail: size ? `1 × 3 × ${size} × ${size}` : "Image tensor" },
    { kind: "backbone", title: run?.backbone || run?.model || "Backbone", detail: "Feature extractor" },
    { kind: "head", title: task === "Classification" || task === "Multi-Label Classification" ? "Classifier head" : `${task || "Task"} head`, detail: task || "Task-specific layers" },
    { kind: "io", title: "Output", detail: classes ? `${classes} classes` : "Predictions" },
  ];
  return (
    <div class={`nv-pipe${busy ? " nv-pipe--busy" : ""}`} aria-label="Model outline">
      <span class="nv-pipe-label">Outline from this run’s settings</span>
      <ol>
        {steps.map((s) => (
          <li key={s.title + s.kind} class={`nv-pipe-step nv-pipe-step--${s.kind}`}>
            <strong>{s.title}</strong>
            <span>{s.detail}</span>
          </li>
        ))}
      </ol>
      <span class="nv-pipe-foot">Open in Netron for every layer.</span>
    </div>
  );
}

const fmtElapsed = (s) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

/** Shown in place of the Open button while the checkpoint is exported. */
function ExportProgress() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - exportStartedAt.value) / 1000));
  return (
    <div class="nv-progress" role="status" aria-live="polite">
      <div class="nv-progress-row">
        <span class="nv-progress-icon"><span class="nv-spinner" /></span>
        <div class="nv-progress-text">
          <strong>Exporting to TorchScript</strong>
          <span>Loading the checkpoint and tracing the model. Large models can take a minute.</span>
        </div>
        <span class="nv-progress-time" title="Elapsed">{fmtElapsed(secs)}</span>
      </div>
      <div class="nv-progress-bar"><i /></div>
    </div>
  );
}

function Hero({ run, runs }) {
  const project = currentProject.value;
  const classes = project?.classNames?.length || hpOf(run, "numClasses", "num_classes");
  const size = hpOf(run, "imageSize", "image_size");
  const task = run?.taskType || project?.taskType;
  const busy = loading.value;

  return (
    <section class="nv-hero">
      <div class="nv-hero-main">
        <div class="nv-hero-head">
          <span class="nv-hero-icon"><GraphIcon /></span>
          <div>
            <h2>Inspect this model in Netron</h2>
            <p>Export the selected run’s checkpoint and explore its architecture, tensor shapes and layer parameters.</p>
          </div>
        </div>

        {run ? (
          <div class="nv-model">
            <span class="nv-model-icon"><CubeIcon size={20} /></span>
            <div class="nv-model-text">
              <div class="nv-model-title">
                <strong>{run.backbone || run.model || run.name}</strong>
                <span class="nv-pill nv-pill--ok"><i />Checkpoint ready</span>
              </div>
              <div class="nv-chips">
                <span class="nv-chip nv-chip--run">{run.name || run.id}</span>
                {task && <span class="nv-chip">{task}</span>}
                {classes ? <span class="nv-chip">{classes} classes</span> : null}
                {size ? <span class="nv-chip">{size} × {size} input</span> : null}
              </div>
            </div>
          </div>
        ) : (
          <div class="nv-model nv-model--empty">
            <span class="nv-model-icon"><CubeIcon size={20} /></span>
            <div class="nv-model-text">
              <strong>{runs.length ? "Choose a run to inspect" : "No runs with a checkpoint yet"}</strong>
              <span class="nv-model-meta">
                {runs.length ? "Pick a completed run from the menu above." : "Train a model to completion, then come back to see its architecture."}
              </span>
            </div>
          </div>
        )}

        {runs.length === 0 ? (
          <button class="dash-btn dash-btn--quiet nv-open" onClick={() => navigate("dashboard")}>Go to the dashboard <ArrowRightIcon size={15} /></button>
        ) : busy ? (
          <ExportProgress />
        ) : (
          <>
            <button class="dash-btn dash-btn--primary nv-open" disabled={!run} onClick={handleLoad}>
              <ExternalIcon /> Open in Netron
            </button>
            <span class="nv-hint">Creates a TorchScript export of the checkpoint for local inspection.</span>
          </>
        )}

        {error.value && (
          <div class="nv-error" role="alert">
            <AlertIcon size={16} />
            <span>{error.value}</span>
          </div>
        )}

        <div class="nv-features">
          <h3>What you can inspect</h3>
          <ul>
            <li class="nv-tone--blue"><span class="nv-feat-icon"><GraphIcon size={18} /></span><div><strong>Architecture graph</strong><span>The model’s structure and how its layers connect.</span></div></li>
            <li class="nv-tone--green"><span class="nv-feat-icon"><LayersIcon size={18} /></span><div><strong>Tensor shapes</strong><span>Input and output shapes for each layer.</span></div></li>
            <li class="nv-tone--amber"><span class="nv-feat-icon"><DocIcon /></span><div><strong>Layer parameters</strong><span>Weights, biases and other attributes.</span></div></li>
          </ul>
        </div>
      </div>

      <Pipeline run={run} classes={classes} size={size} task={task} busy={busy} />
    </section>
  );
}

function Recent() {
  const runs = completedRuns.value;
  if (!recent.value.length) return null;
  return (
    <section class="nv-recent">
      <header>
        <h3>Recently opened</h3>
        <span class="nv-muted">This session · opens without exporting again</span>
      </header>
      <div class="nv-recent-list">
        {recent.value.map((r) => {
          const still = runs.some((x) => x.id === r.runId);
          return (
            <button key={r.runId} class="nv-recent-item" onClick={() => reopen(r)} disabled={!still} title={still ? "Open in Netron" : "This run is no longer available"}>
              <span class="nv-model-icon"><CubeIcon size={18} /></span>
              <span class="nv-recent-text">
                <strong>{r.runName}</strong>
                <small>{r.backbone}</small>
              </span>
              <small class="nv-recent-when">{formatRelativeTime(r.at)}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function NetronView() {
  const runs = completedRuns.value;
  const run = selectedRun.value;
  const open = !!modelSrc.value;
  const loadedRun = runs.find((r) => r.id === loadedRunId.value);

  return (
    <div class={`dash nv${open ? " nv--open" : ""}`}>
      <header class="nv-bar">
        <select
          class="nv-select"
          value={selectedRunId.value}
          aria-label="Run"
          disabled={runs.length === 0 || loading.value}
          onChange={(e) => {
            selectedRunId.value = e.currentTarget.value;
            error.value = null;
          }}
        >
          <option value="">{runs.length ? "Select a run…" : "No runs with a checkpoint"}</option>
          {runs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || r.id} · {r.backbone || r.model}
            </option>
          ))}
        </select>
        {run && <span class="nv-pill nv-pill--ok nv-pill--lg"><i />Completed</span>}
        {open && (
          <div class="nv-bar-actions">
            <span class="nv-muted">
              Showing <strong>{loadedRun?.name || "model"}</strong>
            </span>
            {run && run.id !== loadedRunId.value && (
              <button class="dash-btn dash-btn--primary" onClick={handleLoad} disabled={loading.value}>
                {loading.value ? <span class="nv-spinner" /> : <ExternalIcon />} Open {run.name || "selected run"}
              </button>
            )}
            <button class="dash-btn dash-btn--quiet" onClick={handleLoad} disabled={!run || loading.value} title="Export the checkpoint again">
              <RefreshIcon size={14} /> Re-export
            </button>
            <button class="dash-icon-btn" onClick={handleClear} aria-label="Close model" title="Close model"><XIcon size={15} /></button>
          </div>
        )}
      </header>

      {open ? (
        <iframe class="nv-frame" src={modelSrc.value} title="Netron Model Viewer" sandbox="allow-scripts allow-same-origin allow-popups" />
      ) : (
        <div class="nv-cold">
          <Hero run={run} runs={runs} />
          <Recent />
          {runs.length === 0 && (
            <p class="nv-muted nv-cold-note">
              <DatabaseIcon size={14} /> Only completed runs with a saved checkpoint can be inspected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
