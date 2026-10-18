// Display helpers for a run's hyperparameters.

// Convert snake_case / camelCase keys to Title Case labels
export function formatLabel(key) {
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
export function filterHparams(hp) {
  if (!hp) return {};
  const filtered = {};
  for (const [key, val] of Object.entries(hp)) {
    if (HPARAM_EXCLUDE.has(key)) continue;
    if (isNoisyValue(val)) continue;
    filtered[key] = val;
  }
  return filtered;
}

export function formatHparamValue(key, val) {
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
