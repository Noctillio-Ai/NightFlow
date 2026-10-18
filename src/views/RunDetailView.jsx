import { useState, useEffect } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { navigate, routeParams } from "../state/router.js";
import { allRuns, loadRunScalars, loadRunHparams, updateRun } from "../state/experiments.js";
import { currentProject, updateProject } from "../state/projects.js";
import { ClassificationReport } from "../components/run/ClassificationReport.jsx";
import { InferenceTab } from "../components/InferenceTab.jsx";
import { MetricChart } from "../components/dashboard/MetricChart.jsx";
import { EvaluationPanel } from "../components/dashboard/EvaluationPanel.jsx";
import {
  AlertIcon,
  ChartBarsIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  LayersIcon,
  LineChartIcon,
  SlidersIcon,
  TrophyIcon,
  XIcon,
} from "../components/dashboard/icons.jsx";
import { formatDuration, formatRelativeTime } from "../utils/format.js";
import { baseName } from "../utils/runCurves.js";
import { testMetricsFromScalars } from "../utils/testMetrics.js";
import { pairMetrics, runInsight, bestIndex, lowerIsBetter } from "../utils/runMetrics.js";

// Convert snake_case / camelCase keys to Title Case labels
function formatLabel(key) {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Keys to exclude from hparams display (internal/noise from PyTorch Lightning)
const HPARAM_EXCLUDE = new Set([
  "_class_path", "class_path", "_target_", "_recursive_",
  "callbacks", "logger", "log_dir", "default_root_dir",
  "enable_checkpointing", "enable_progress_bar", "enable_model_summary",
  "num_sanity_val_steps", "check_val_every_n_epoch",
  "log_every_n_steps", "detect_anomaly", "deterministic",
  "benchmark", "inference_mode", "use_distributed_sampler",
  "profiler", "reload_dataloaders_every_n_epochs",
  "val_check_interval", "limit_train_batches", "limit_val_batches",
  "limit_test_batches", "limit_predict_batches",
  "fast_dev_run", "overfit_batches", "barebones",
  "plugins", "sync_batchnorm", "strategy",
  "data_dir", "data_directory", "instantiator", "_instantiator",
]);

// Returns true if a value is a "noisy" object or deeply nested structure
function isNoisyValue(val) {
  if (val === null || val === undefined) return true;
  if (typeof val === "object" && !Array.isArray(val)) {
    // Skip objects that look like internal config (e.g. {class_path: ..., init_args: ...})
    const keys = Object.keys(val);
    if (keys.includes("class_path") || keys.includes("_target_")) return true;
    if (keys.length > 6) return true; // deeply nested config blobs
  }
  return false;
}

// Filter and clean hparams for display
function filterHparams(hp) {
  if (!hp) return {};
  const filtered = {};
  for (const [key, val] of Object.entries(hp)) {
    if (HPARAM_EXCLUDE.has(key)) continue;
    if (isNoisyValue(val)) continue;
    filtered[key] = val;
  }
  return filtered;
}

function formatHparamValue(key, val) {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val)) return val.map(String).join(", ");
  if (typeof val === "object") return JSON.stringify(val);
  if (typeof val === "number") {
    // Small floats like learning rates look better in exponential notation
    if (Math.abs(val) > 0 && Math.abs(val) < 0.01) return val.toExponential(1);
    return String(val);
  }
  return String(val);
}


const STATUS = {
  completed: { label: "Completed", eyebrow: "Completed run", tone: "ok" },
  running: { label: "Running", eyebrow: "Training in progress", tone: "live" },
  failed: { label: "Failed", eyebrow: "Failed run", tone: "err" },
  queued: { label: "Queued", eyebrow: "Queued run", tone: "idle" },
};

const TRAIN_COLOR = "#3b82f6";
const VAL_COLOR = "#a855f7";

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
const num = (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4)) : "—");
/** Scores in [0, 1] read as percentages; losses and the rest as numbers. */
const isScore = (name, values) => !lowerIsBetter(name) && values.length > 0 && values.every((v) => v >= 0 && v <= 1);
const fmtFor = (name, values) => (isScore(name, values) ? pct : num);
/** Shorter labels for the y axis. */
const tickFor = (name, values) =>
  isScore(name, values) ? (v) => `${Math.round(v * 100)}%` : (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : String(+v.toFixed(2)));

/** First defined value among a run's hyperparameter aliases (camelCase or file snake_case). */
function hpValue(hp, ...keys) {
  for (const k of keys) {
    const v = hp?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function TagsInput({ tags = [], runId }) {
  const [input, setInput] = useState("");

  function addTag(e) {
    if (e.key !== "Enter" || !input.trim()) return;
    const newTag = input.trim();
    if (!tags.includes(newTag)) updateRun(runId, { tags: [...tags, newTag] });
    setInput("");
  }

  return (
    <div class="rd-tags">
      {tags.map((tag) => (
        <span key={tag} class="rd-tag">
          {tag}
          <button onClick={() => updateRun(runId, { tags: tags.filter((t) => t !== tag) })} aria-label={`Remove tag ${tag}`}>
            <XIcon size={11} />
          </button>
        </span>
      ))}
      <input
        type="text"
        class="rd-tag-input"
        placeholder="+ Add tag"
        value={input}
        onInput={(e) => setInput(e.currentTarget.value)}
        onKeyDown={addTag}
        aria-label="Add a tag (press Enter)"
      />
    </div>
  );
}

function NotesCard({ notes = "", runId }) {
  const [value, setValue] = useState(notes);
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(notes), [notes]);

  function save() {
    if (value === notes) return;
    updateRun(runId, { notes: value });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <section class="rd-card">
      <div class="rd-card-head">
        <h3>Notes</h3>
        {saved && <span class="rd-saved"><CheckIcon size={12} /> Saved</span>}
      </div>
      <textarea
        class="rd-notes"
        value={value}
        onInput={(e) => setValue(e.currentTarget.value)}
        onBlur={save}
        placeholder="Why did you run this? What changed? Notes save when you click away."
      />
    </section>
  );
}

function Kpi({ icon, label, value, detail, highlight }) {
  return (
    <div class={`rd-kpi${highlight ? " rd-kpi--hl" : ""}`}>
      <span class="rd-kpi-icon">{icon}</span>
      <div>
        <span class="rd-kpi-label">{label}</span>
        <strong class={`rd-kpi-value${value === "—" ? " rd-kpi-value--empty" : ""}`}>{value}</strong>
        {detail && <span class="rd-kpi-detail">{detail}</span>}
      </div>
    </div>
  );
}

function CurveCard({ metric }) {
  const lower = lowerIsBetter(metric.name);
  const both = metric.train.length > 0 && metric.val.length > 0;
  const fmt = fmtFor(metric.name, [...metric.train, ...metric.val]);
  const focus = metric.val.length ? metric.val : metric.train;
  const best = bestIndex(focus, lower);
  const series = [
    metric.train.length && { label: both ? "Train" : formatLabel(metric.name), data: metric.train, color: TRAIN_COLOR },
    metric.val.length && { label: "Validation", data: metric.val, color: VAL_COLOR },
  ].filter(Boolean);
  const markerSeries = metric.val.length ? series.length - 1 : 0;
  const epochs = Math.max(metric.train.length, metric.val.length);

  return (
    <section class="rd-chart">
      <header>
        <div>
          <h4>{formatLabel(metric.name)}</h4>
          <span>
            {best >= 0 ? `Best ${metric.val.length ? "validation" : ""} ${fmt(focus[best])} at epoch ${best + 1}` : `${epochs} epochs`}
            {lower ? " · lower is better" : ""}
          </span>
        </div>
        <div class="rd-legend">
          {series.map((s) => (
            <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      </header>
      <MetricChart
        height={190}
        series={series}
        yFormat={fmt}
        tickFormat={tickFor(metric.name, [...metric.train, ...metric.val])}
        marker={best >= 0 ? { series: markerSeries, at: best } : null}
        empty="No values logged"
      />
    </section>
  );
}

function getAugmentationSteps(preset, hp) {
  const size = hp.image_size || hp.imageSize || 224;
  const meanStd = "mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]";

  switch (String(preset).toLowerCase()) {
    case "default":
      return [
        `Random Resized Crop (${size}x${size})`,
        "Random Horizontal Flip (p=0.5)",
        "Color Jitter (brightness=0.2, contrast=0.2, saturation=0.2)",
        "Convert to Tensor",
        `Normalize (${meanStd})`
      ];
    case "autoaugment":
      return [
        `Random Resized Crop (${size}x${size})`,
        "Random Horizontal Flip (p=0.5)",
        "AutoAugment (policy=ImageNet)",
        "Convert to Tensor",
        `Normalize (${meanStd})`
      ];
    case "randaugment":
      return [
        `Random Resized Crop (${size}x${size})`,
        "Random Horizontal Flip (p=0.5)",
        "RandAugment (num_ops=2, magnitude=9)",
        "Convert to Tensor",
        `Normalize (${meanStd})`
      ];
    case "trivialaugment":
      return [
        `Random Resized Crop (${size}x${size})`,
        "Random Horizontal Flip (p=0.5)",
        "TrivialAugmentWide",
        "Convert to Tensor",
        `Normalize (${meanStd})`
      ];
    case "strong":
      return [
        `Random Resized Crop (${size}x${size})`,
        "Horizontal Flip (p=0.5)",
        "Affine Transform (scale=0.8-1.2, rotate=\u00b115\u00b0, translate=\u00b110%, p=0.5)",
        "Blur / Gaussian Noise (p=0.3)",
        "Color Jitter (brightness=0.3, contrast=0.3, saturation=0.3, hue=0.1, p=0.8)",
        "Coarse Dropout (holes=1-3, size=5-15%, p=0.3)",
        `Normalize (${meanStd})`,
        "Convert to Tensor"
      ];
    case "light":
      return [
        `Random Resized Crop (${size}x${size})`,
        "Horizontal Flip (p=0.5)",
        "Convert to Tensor",
        `Normalize (${meanStd})`
      ];
    default:
      return null;
  }
}

export function RunDetailView() {
  const { runId } = routeParams.value;
  const run = allRuns.value.find((r) => r.id === runId);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("curves");
  const [fileHparams, setFileHparams] = useState(null);
  const [showAllParams, setShowAllParams] = useState(false);
  const [augOpen, setAugOpen] = useState(false);
  const [inferenceOpen, setInferenceOpen] = useState(false);
  const [hasCkpt, setHasCkpt] = useState(false);
  const [copied, setCopied] = useState(false);
  const [insightHidden, setInsightHidden] = useState(false);

  // Check if checkpoint file exists for this run
  useEffect(() => {
    if (!run || run.status !== "completed") { setHasCkpt(false); return; }
    const project = currentProject.value;
    if (!project) return;
    const sshCmd = project.connectionType === "remote" ? project.sshCommand : null;
    invoke("check_runs_checkpoints", {
      projectPath: project.projectPath,
      runIds: [run.id],
      sshCommand: sshCmd,
    }).then((ids) => setHasCkpt(ids.includes(run.id)))
      .catch(() => setHasCkpt(false));
  }, [runId, run?.status]);

  // Auto-detect class names for existing projects that lack them
  useEffect(() => {
    const project = currentProject.value;
    if (!project || (project.classNames && project.classNames.length > 0)) return;
    const folderPath = project.folderPath;
    const format = project.datasetFormat || "Folder";
    if (!folderPath || format !== "Folder") return;
    invoke("browse_dataset", {
      path: folderPath.trim(),
      format,
      limit: 0,
      offset: 0,
      classFilter: null,
      imageFolder: null,
      search: null,
      split: null,
    }).then((result) => {
      if (result?.class_counts) {
        const names = Object.keys(result.class_counts).sort();
        if (names.length > 0) {
          updateProject(project.id, { classNames: names });
        }
      }
    }).catch(() => {});
  }, [currentProject.value?.id]);

  // Close inference drawer on Escape
  useEffect(() => {
    if (!inferenceOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setInferenceOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inferenceOpen]);

  // If run has no scalars in IndexedDB, try loading from its JSONL file
  useEffect(() => {
    if (!run || (run.scalars && Object.keys(run.scalars).length > 0)) return;
    setLoading(true);
    loadRunScalars(run).finally(() => setLoading(false));
  }, [runId]);

  // Load hyperparameters from hparams.yaml on disk
  useEffect(() => {
    if (!run) return;

    // If we already have file-based hparams cached on the run, use those
    if (run.fileHparams && Object.keys(run.fileHparams).length > 0) {
      setFileHparams(run.fileHparams);
      return;
    }

    loadRunHparams(run).then((hparams) => {
      if (hparams) setFileHparams(hparams);
    });
  }, [runId]);


  const hasScalars = run?.scalars && Object.keys(run.scalars).length > 0;
  const metrics = hasScalars ? pairMetrics(run.scalars) : [];
  const testMetrics = hasScalars ? testMetricsFromScalars(run.scalars) : {};
  const hasTest = Object.keys(testMetrics).length > 0;

  // ── Classification data (confusion matrices for train / val / test) ──
  const projectClassNames = currentProject.value?.classNames || [];

  // Detect generic "Class 0", "Class 1", ... labels
  const isGenericLabels = (labels) =>
    Array.isArray(labels) && labels.length > 0 && labels.every((l, i) => l === `Class ${i}`);

  // Resolve labels: prefer real CM labels, then project classNames, then generic
  function resolveLabels(cm) {
    const lbl = cm?.labels;
    const mat = cm?.matrix || cm;
    if (lbl && !isGenericLabels(lbl)) return lbl;
    if (projectClassNames.length > 0) return projectClassNames;
    if (lbl) return lbl;
    return Array.isArray(mat) ? mat.map((_, i) => `Class ${i}`) : [];
  }

  // Map per-class metric labels to resolved names
  function resolvePerClass(raw, labels) {
    if (!raw || !Array.isArray(raw)) return raw;
    const hasReal = labels.length > 0 && !isGenericLabels(labels);
    if (!hasReal) return raw;
    return raw.map((item) => {
      const idx = item.class_index ?? parseInt(item.label, 10);
      if (!isNaN(idx) && idx >= 0 && idx < labels.length) {
        return { ...item, label: labels[idx] };
      }
      return item;
    });
  }

  // Extract confusion matrices + per-class metrics for each stage
  const cmStages = {};
  for (const stage of ["train", "val", "test"]) {
    const cmKey = stage === "test" ? "confusionMatrix" : `${stage}ConfusionMatrix`;
    const pcmKey = stage === "test" ? "perClassMetrics" : `${stage}PerClassMetrics`;
    const cm = run?.[cmKey] || run?.scalars?.[`${stage}/confusion_matrix`] || null;
    const rawPcm = run?.[pcmKey] || run?.scalars?.[`${stage}/per_class_metrics`] || null;
    if (cm || rawPcm) {
      const labels = resolveLabels(cm);
      cmStages[stage] = {
        cm,
        pcm: resolvePerClass(rawPcm, labels),
        labels,
      };
    }
  }
  const hasClassificationData = Object.keys(cmStages).length > 0;


  const tabs = [
    metrics.length > 0 && { id: "curves", label: "Training curves", count: metrics.length },
    hasTest && { id: "test", label: "Test results", count: Object.keys(testMetrics).length },
    hasClassificationData && { id: "classification", label: "Classification" },
  ].filter(Boolean);
  const tabIds = tabs.map((t) => t.id).join(",");

  // Keep the active tab valid as data loads or the run changes.
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === activeTab)) setActiveTab(tabs[0].id);
  }, [runId, tabIds]);
  useEffect(() => setInsightHidden(false), [runId]);

  if (!run) {
    return (
      <div class="run-detail-view dash rd">
        <div class="rd-missing">
          <strong>Run not found</strong>
          <span>It may have been deleted.</span>
          <button class="dash-btn dash-btn--quiet" onClick={() => navigate("experiments")}>Back to Experiments</button>
        </div>
      </div>
    );
  }

  // Merge both sources: file hparams (more detailed) + project-captured hparams (always available).
  // This ensures augmentation, backbone, etc. survive even if log files are deleted.
  const mergedHp = { ...(run.hyperparameters || {}), ...(fileHparams || {}) };
  const hp = filterHparams(mergedHp);
  const status = STATUS[run.status] || { label: run.status || "Unknown", eyebrow: "Run", tone: "idle" };

  // Headline numbers
  const loss = metrics.find((m) => m.name === "loss");
  const acc = metrics.find((m) => m.name === "accuracy" || m.name === "acc");
  const valAcc = acc?.val || [];
  const bestAccIdx = bestIndex(valAcc, false);
  const bestAcc = Number.isFinite(run.bestAcc) ? run.bestAcc : valAcc[bestAccIdx];
  const valLoss = loss?.val || [];
  const finalLoss = valLoss.length ? valLoss[valLoss.length - 1] : run.valLoss;
  const bestLossIdx = bestIndex(valLoss, true);
  const plannedEpochs = Number(hpValue(mergedHp, "maxEpochs", "max_epochs")) || null;
  const epochsDone = run.epochs || Math.max(valAcc.length, valLoss.length) || 0;
  const duration = run.finishedAt ? formatDuration(run.created, run.finishedAt) : null;
  const insight = !insightHidden && run.status === "completed" ? runInsight(metrics) : null;

  // Configuration shown up front; everything else behind "Show all".
  const preset = hpValue(mergedHp, "augmentationPreset", "augmentation_preset") || "default";
  const config = [
    ["Backbone", run.backbone || run.model],
    ["Task", run.taskType],
    ["Dataset", run.dataset && baseName(run.dataset), run.dataset],
    ["Epochs", plannedEpochs],
    ["Batch size", hpValue(mergedHp, "batchSize", "batch_size")],
    ["Learning rate", hpValue(mergedHp, "lr", "learningRate", "learning_rate")],
    ["Optimizer", hpValue(mergedHp, "optimizer")],
    ["Scheduler", hpValue(mergedHp, "scheduler")],
    ["Weight decay", hpValue(mergedHp, "weightDecay", "weight_decay")],
    ["Image size", hpValue(mergedHp, "imageSize", "image_size")],
    ["Precision", hpValue(mergedHp, "precision")],
    ["Seed", hpValue(mergedHp, "seed")],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");
  const allParams = Object.entries(hp);
  const augSteps = getAugmentationSteps(preset, hp);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(run.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div class="run-detail-view dash rd">
      {/* ── Header ── */}
      <header class="rd-head">
        <div class="rd-head-main">
          <span class={`rd-eyebrow rd-tone--${status.tone}`}>{status.eyebrow}</span>
          <div class="rd-title">
            <h2>{run.name || run.id}</h2>
            <span class={`rd-status rd-tone--${status.tone}`}><span class="rd-status-dot" />{status.label}</span>
          </div>
          <div class="rd-meta">
            <button class="rd-id" onClick={copyId} title="Copy run ID">
              <code>{run.id}</code>
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
            {run.created && <span title={new Date(run.created).toLocaleString()}>Started {formatRelativeTime(run.created)}</span>}
            {duration && duration !== "—" && <span>Took {duration}</span>}
            {epochsDone > 0 && <span>{epochsDone} {epochsDone === 1 ? "epoch" : "epochs"}</span>}
          </div>
          <TagsInput tags={run.tags || []} runId={run.id} />
        </div>
        {run.status === "completed" && hasCkpt && (
          <button class="dash-btn dash-btn--primary rd-deploy" onClick={() => setInferenceOpen(true)} title="Export the model and generate an inference script">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Deploy model
          </button>
        )}
      </header>

      {/* ── Headline numbers ── */}
      <div class="rd-kpis">
        <Kpi
          highlight
          icon={<TrophyIcon size={20} />}
          label="Best validation accuracy"
          value={pct(bestAcc)}
          detail={bestAccIdx >= 0 ? `Epoch ${bestAccIdx + 1} of ${valAcc.length}` : "No validation accuracy logged"}
        />
        <Kpi
          icon={<CheckCircleIcon size={20} />}
          label="Test accuracy"
          value={pct(run.testAcc)}
          detail={Number.isFinite(run.testAcc) ? "On the held-out test set" : "Not tested yet"}
        />
        <Kpi
          icon={<LineChartIcon size={20} />}
          label="Final validation loss"
          value={num(finalLoss)}
          detail={bestLossIdx >= 0 ? `Best ${num(valLoss[bestLossIdx])} at epoch ${bestLossIdx + 1}` : "Lower is better"}
        />
        <Kpi
          icon={<LayersIcon size={20} />}
          label="Epochs"
          value={epochsDone ? String(epochsDone) : "—"}
          detail={plannedEpochs ? (epochsDone < plannedEpochs && run.status === "completed" ? `of ${plannedEpochs} planned · stopped early` : `of ${plannedEpochs} planned`) : status.label}
        />
      </div>

      <div class="rd-body">
        {/* ── Left: configuration, notes, augmentation ── */}
        <aside class="rd-side">
          <section class="rd-card">
            <div class="rd-card-head"><h3><SlidersIcon size={15} /> Training configuration</h3></div>
            {config.length ? (
              <dl class="rd-kv">
                {config.map(([k, v, full]) => (
                  <div key={k}><dt>{k}</dt><dd title={full || String(v)}>{formatHparamValue(k, v)}</dd></div>
                ))}
              </dl>
            ) : (
              <span class="rd-muted">No configuration recorded.</span>
            )}
            {allParams.length > 0 && (
              <>
                <button class="rd-more" onClick={() => setShowAllParams(!showAllParams)} aria-expanded={showAllParams}>
                  {showAllParams ? "Hide all parameters" : `Show all parameters (${allParams.length})`}
                  <span class={showAllParams ? "rd-chev-open" : undefined}><ChevronDownIcon size={14} /></span>
                </button>
                {showAllParams && (
                  <dl class="rd-kv rd-kv--all">
                    {allParams.map(([k, v]) => (
                      <div key={k}><dt>{formatLabel(k)}</dt><dd title={formatHparamValue(k, v)}>{formatHparamValue(k, v)}</dd></div>
                    ))}
                  </dl>
                )}
              </>
            )}
          </section>

          <NotesCard notes={run.notes || ""} runId={run.id} />

          {augSteps && (
            <section class="rd-card">
              <button class="rd-card-toggle" onClick={() => setAugOpen(!augOpen)} aria-expanded={augOpen}>
                <h3><LayersIcon size={15} /> Augmentation <span class="rd-muted">· {preset}</span></h3>
                <span class={augOpen ? "rd-chev-open" : undefined}><ChevronDownIcon size={14} /></span>
              </button>
              {augOpen && (
                <ol class="rd-aug">
                  {augSteps.map((step, idx) => <li key={idx}>{step}</li>)}
                </ol>
              )}
            </section>
          )}
        </aside>

        {/* ── Right: insight, tabs, charts ── */}
        <section class="rd-main">
          {insight && (
            <div class={`rd-insight rd-insight--${insight.tone}`} role="note">
              <span class="rd-insight-icon">{insight.tone === "warn" ? <AlertIcon size={18} /> : <LineChartIcon size={18} />}</span>
              <div>
                <strong>{insight.title}</strong>
                <span>{insight.detail}</span>
              </div>
              <button class="dash-icon-btn" onClick={() => setInsightHidden(true)} aria-label="Dismiss"><XIcon size={14} /></button>
            </div>
          )}

          {tabs.length > 1 && (
            <div class="rd-tabs" role="tablist">
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={activeTab === t.id} class={`rd-tab${activeTab === t.id ? " active" : ""}`} onClick={() => setActiveTab(t.id)}>
                  {t.label}
                  {t.count != null && <span class="rd-tab-count">{t.count}</span>}
                </button>
              ))}
            </div>
          )}

          {loading && !hasScalars ? (
            <div class="rd-charts">
              {[0, 1, 2, 3].map((i) => <div key={i} class="rd-chart rd-skeleton" />)}
            </div>
          ) : tabs.length === 0 ? (
            <div class="rd-empty">
              <ChartBarsIcon size={22} />
              <strong>No metrics for this run</strong>
              <span>{run.status === "running" ? "Curves appear after the first epoch finishes." : "Nothing was logged, or the run's log files are missing."}</span>
            </div>
          ) : activeTab === "test" ? (
            <EvaluationPanel state="done" metrics={testMetrics} />
          ) : activeTab === "classification" ? (
            <ClassificationReport stages={cmStages} />
          ) : (
            <div class="rd-charts">
              {metrics.map((m) => <CurveCard key={m.name} metric={m} />)}
            </div>
          )}
        </section>
      </div>

      {/* Inference Script — slide-over drawer (always mounted, visibility toggled) */}
      <div class={`inference-drawer-overlay${inferenceOpen ? "" : " hidden"}`} onClick={() => setInferenceOpen(false)}>
        <div class={`inference-drawer${inferenceOpen ? "" : " hidden"}`} onClick={(e) => e.stopPropagation()}>
          <div class="inference-drawer-header">
            <h3 class="inference-drawer-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.55">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Deploy Model
            </h3>
            <button class="inference-drawer-close" onClick={() => setInferenceOpen(false)} title="Close (Esc)">
              ✕
            </button>
          </div>
          <div class="inference-drawer-body">
            <InferenceTab run={run} project={currentProject.value} />
          </div>
        </div>
      </div>
    </div>
  );
}
