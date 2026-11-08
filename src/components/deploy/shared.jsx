import { useState, useEffect } from "preact/hooks";

// ── Icons ────────────────────────────────────────────────────────────────────

export const Svg = ({ size = 14, sw = 2, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const CheckIcon = ({ size }) => <Svg size={size} sw={2.5}><polyline points="20 6 9 17 4 12" /></Svg>;
export const CopyIcon = ({ size }) => (
  <Svg size={size}><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>
);
export const DownloadIcon = ({ size }) => (
  <Svg size={size}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Svg>
);
export const UploadIcon = ({ size }) => (
  <Svg size={size}><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></Svg>
);
export const AlertIcon = ({ size }) => (
  <Svg size={size}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></Svg>
);
export const FolderIcon = ({ size }) => (
  <Svg size={size}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Svg>
);
export const TrashIcon = ({ size }) => (
  <Svg size={size}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></Svg>
);
export const RefreshIcon = ({ size }) => (
  <Svg size={size}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></Svg>
);
export const LayersIcon = ({ size }) => (
  <Svg size={size}><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></Svg>
);
export const ChevronIcon = ({ size = 14 }) => <Svg size={size} sw={2.2}><polyline points="6 9 12 15 18 9" /></Svg>;
export const ArrowLeftIcon = ({ size }) => <Svg size={size}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></Svg>;
export const PackageIcon = ({ size }) => (
  <Svg size={size} sw={1.8}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </Svg>
);
export const CodeIcon = ({ size }) => <Svg size={size}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></Svg>;

export const PythonLogo = ({ size = 14 }) => (
  <svg class="python-logo" width={size} height={size} viewBox="0 0 256 255" aria-hidden="true">
    <path d="M126.916.072c-64.832 0-60.784 28.115-60.784 28.115l.072 29.128h61.868v8.745H41.631S.145 61.355.145 126.77c0 65.417 36.21 63.097 36.21 63.097h21.61v-30.356s-1.165-36.21 35.632-36.21h61.362s34.475.557 34.475-33.319V33.97S194.67.072 126.916.072zM92.802 19.66a11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13 11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.13z" class="python-top" />
    <path d="M128.757 254.126c64.832 0 60.784-28.115 60.784-28.115l-.072-29.127H127.6v-8.745h86.441s41.486 4.705 41.486-60.712c0-65.416-36.21-63.096-36.21-63.096h-21.61v30.355s1.165 36.21-35.632 36.21h-61.362s-34.475-.557-34.475 33.32v56.013s-5.235 33.897 62.518 33.897zm34.114-19.586a11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.131 11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13z" class="python-bottom" />
  </svg>
);

// ── Formats ──────────────────────────────────────────────────────────────────

export const FORMATS = [
  {
    id: "torchscript", label: "TorchScript", ext: ".pt", tagline: "PyTorch native",
    desc: "Runs anywhere PyTorch is installed. The simplest option.",
    icon: <Svg size={18}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></Svg>,
  },
  {
    id: "onnx", label: "ONNX", ext: ".onnx", tagline: "Cross-platform",
    desc: "Runs on ONNX Runtime, OpenVINO or TensorRT, without PyTorch.",
    icon: <Svg size={18}><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /><path d="M12 8v8" /></Svg>,
  },
  {
    id: "tensorrt", label: "TensorRT", ext: ".engine", tagline: "NVIDIA optimized",
    desc: "Fastest GPU inference. Built from the ONNX export, and only runs on the GPU model it was built on.",
    icon: <Svg size={18}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" /></Svg>,
  },
];
export const FORMAT_BY_ID = Object.fromEntries(FORMATS.map((f) => [f.id, f]));

// ── Project helpers ──────────────────────────────────────────────────────────

const TASK_CLASS = {
  Classification: "ImageClassifier",
  "Multi-Label Classification": "ImageClassifier",
  "Semantic Segmentation": "SemanticSegmentor",
  "Instance Segmentation": "InstanceSegmentor",
};

export function taskClassFor(taskType, project) {
  if (taskType === "Object Detection") {
    return project?.detectionArch === "yolox" ? "YOLOXDetector" : "ObjectDetector";
  }
  return TASK_CLASS[taskType] || "ImageClassifier";
}

export function sshFor(project) {
  return project?.connectionType === "remote" ? project.sshCommand : null;
}

/** Arguments every export command takes. */
export function runLocation(project, run) {
  return { projectPath: project?.projectPath, runId: run.id, sshCommand: sshFor(project) };
}

// ── Small UI pieces ──────────────────────────────────────────────────────────

export function useCopy() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = (text) => navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => {});
  return [copied, copy];
}

export function CopyButton({ text, label = "Copy", iconOnly = false, className = "" }) {
  const [copied, copy] = useCopy();
  return (
    <button
      type="button"
      class={`${iconOnly ? "dpm-icon-btn" : "dash-btn dash-btn--sm"} ${className}`}
      onClick={() => copy(text)}
      title={copied ? "Copied" : label}
      aria-label={label}
    >
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
      {!iconOnly && (copied ? "Copied" : label)}
    </button>
  );
}

export function Field({ label, wide, hint, warn, children }) {
  return (
    <label class={`dpm-field${wide ? " dpm-field--wide" : ""}`}>
      <span class="dpm-field-label">{label}</span>
      {children}
      {warn ? <span class="dpm-hint dpm-hint--warn">{warn}</span> : hint && <span class="dpm-hint">{hint}</span>}
    </label>
  );
}

export function Note({ tone = "ok", children }) {
  return (
    <div class={`dpm-note dpm-note--${tone}`} role={tone === "err" ? "alert" : "status"}>
      {tone === "err" ? <AlertIcon size={13} /> : <CheckIcon size={13} />}
      <span>{children}</span>
    </div>
  );
}

export function elapsedLabel(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
