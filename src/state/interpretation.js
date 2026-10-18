import { signal, computed, effect } from "@preact/signals";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { projectRuns } from "./experiments.js";
import { currentProject } from "./projects.js";

export const INTERPRETATION_METHODS = [
  { id: "gradcam", label: "GradCAM", desc: "Class activation mapping" },
  { id: "gradcampp", label: "GradCAM++", desc: "Better for multiple objects" },
  {
    id: "integrated_gradients",
    label: "Integrated Gradients",
    desc: "Pixel-level attribution",
  },
  { id: "smoothgrad", label: "SmoothGrad", desc: "Noise-reduced gradients" },
  {
    id: "attention_rollout",
    label: "Attention Rollout",
    desc: "For Vision Transformers",
    transformer: true,
  },
  {
    id: "attention_flow",
    label: "Attention Flow",
    desc: "Transformer attention flow",
    transformer: true,
  },
];

/** Attention methods only work on transformer backbones. */
export const isTransformer = (run) => /vit|deit|swin|beit|eva|cait|xcit|levit|pit_|mvit/i.test(run?.backbone || run?.model || "");

/** Methods that make sense for a run's backbone, in display order. */
export function defaultMethods(run) {
  const base = ["gradcam", "gradcampp", "integrated_gradients"];
  return isTransformer(run) ? [...base, "attention_rollout"] : base;
}

// All completed runs for the current project
const allCompletedRuns = computed(() =>
  projectRuns.value.filter((r) => r.status === "completed"),
);

// Set of run IDs that have a checkpoint on disk
const _runIdsWithCheckpoint = signal(new Set());

// Reactively check which completed runs actually have checkpoints
effect(() => {
  const project = currentProject.value;
  const runs = allCompletedRuns.value;
  if (!project?.projectPath || runs.length === 0) {
    _runIdsWithCheckpoint.value = new Set();
    return;
  }

  let cancelled = false;
  const runIds = runs.map((r) => r.id);
  const sshCommand =
    project.connectionType === "remote" ? project.sshCommand : null;
  invoke("check_runs_checkpoints", {
    projectPath: project.projectPath,
    runIds,
    sshCommand,
  })
    .then((idsWithCkpt) => {
      if (!cancelled) _runIdsWithCheckpoint.value = new Set(idsWithCkpt);
    })
    .catch(() => {
      if (!cancelled) _runIdsWithCheckpoint.value = new Set();
    });
  return () => { cancelled = true; };
});

// Only runs that have a checkpoint on disk
export const completedRuns = computed(() =>
  allCompletedRuns.value.filter((r) => _runIdsWithCheckpoint.value.has(r.id)),
);

export const selectedRunId = signal("");
export const selectedRun = computed(
  () => completedRuns.value.find((r) => r.id === selectedRunId.value) || null,
);

export const uploadedImage = signal(null);
export const selectedMethods = signal(defaultMethods(null));
/** 0–1: how strongly the heatmap overlays are shown over the original image. */
export const overlayStrength = signal(1);
/** This session's interpretations, newest first: [{ id, runId, runName, image, result, methods, at }]. */
export const interpretationHistory = signal([]);
const MAX_HISTORY = 8;

export const interpretationLoading = signal(false);
export const interpretationError = signal(null);
export const interpretationResult = signal(null);

export function selectRun(id) {
  selectedRunId.value = id;
  selectedMethods.value = defaultMethods(completedRuns.value.find((r) => r.id === id));
  interpretationResult.value = null;
  interpretationError.value = null;
}

export function toggleMethod(id) {
  const current = selectedMethods.value;
  selectedMethods.value = current.includes(id) ? current.filter((m) => m !== id) : [...current, id];
}

export function setImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImage.value = { name: file.name, url: e.target.result, size: file.size };
    interpretationResult.value = null;
    interpretationError.value = null;
  };
  reader.readAsDataURL(file);
}

/** Show a previous interpretation from this session again. */
export function reopenInterpretation(entry) {
  if (completedRuns.value.some((r) => r.id === entry.runId)) selectedRunId.value = entry.runId;
  uploadedImage.value = entry.image;
  interpretationResult.value = entry.result;
  interpretationError.value = null;
}

export function clearImage() {
  uploadedImage.value = null;
  interpretationResult.value = null;
  interpretationError.value = null;
}

export async function runInterpretation() {
  const run = selectedRun.value;
  const project = currentProject.value;
  const image = uploadedImage.value;

  if (!run || !project || !image) return;

  interpretationLoading.value = true;
  interpretationError.value = null;
  interpretationResult.value = null;

  try {
    const projectPath = project.projectPath;
    const runId = run.id;
    const sshCommand =
      project.connectionType === "remote" ? project.sshCommand : null;

    // Save the uploaded image to disk
    const imagePath = await invoke("save_interpretation_image", {
      projectPath,
      runId,
      imageBase64: image.url,
    });

    // Determine task class from project settings
    const taskClassMap = {
      Classification: "ImageClassifier",
      "Multi-Label Classification": "ImageClassifier",
      "Object Detection":
        project.detectionArch === "yolox" ? "YOLOXDetector" : "ObjectDetector",
      "Semantic Segmentation": "SemanticSegmentor",
      "Instance Segmentation": "InstanceSegmentor",
    };
    const taskClass = taskClassMap[project.taskType] || "ImageClassifier";

    // Run interpretation (in display order)
    const methods = INTERPRETATION_METHODS.map((m) => m.id).filter((id) => selectedMethods.value.includes(id));
    const result = await invoke("run_interpretation", {
      projectPath,
      runId,
      imagePath,
      methods,
      taskClass,
      sshCommand,
    });

    // Surface top-level error from Python script failure
    if (result.error) {
      interpretationError.value = result.error;
    }

    // Heatmaps are written to the same file names on every run, so keep a
    // copy of each in memory: the view and the history then show this run's
    // images, not a later run's or a cached earlier one.
    const stamp = Date.now();
    const images = await snapshotImages(result.results || {}, stamp);
    const stamped = { ...result, methods, images, stamp };
    interpretationResult.value = stamped;
    if (!result.error && Object.keys(images).length) {
      const next = [
        { id: stamp, runId, runName: run.name || run.id, image, result: stamped, at: new Date().toISOString() },
        ...interpretationHistory.value,
      ];
      next.slice(MAX_HISTORY).forEach((e) => Object.values(e.result.images || {}).forEach(revoke));
      interpretationHistory.value = next.slice(0, MAX_HISTORY);
    }
  } catch (err) {
    interpretationError.value =
      typeof err === "string" ? err : err.message || "Interpretation failed";
  } finally {
    interpretationLoading.value = false;
  }
}

const revoke = (url) => url?.startsWith("blob:") && URL.revokeObjectURL(url);

/** { method: path } → { method: url }, as blob URLs when the file can be read. */
async function snapshotImages(paths, stamp) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([id, path]) => {
      const src = `${convertFileSrc(path)}?t=${stamp}`;
      try {
        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        return [id, URL.createObjectURL(await res.blob())];
      } catch {
        return [id, src];
      }
    }),
  );
  return Object.fromEntries(entries);
}
