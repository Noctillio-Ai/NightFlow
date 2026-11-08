// Project settings: which fields exist and which category of the settings
// screen each one lives in. Every editable field belongs to exactly one
// category, so per-category "unsaved changes" dots are always complete
// (tests/settingsCategories.test.js enforces this).

/** Project fields the settings screen can edit (saved with Save changes). */
export const EDITABLE_KEYS = [
  "name",
  "connectionType",
  "sshCommand",
  "projectPath",
  "modelCategory",
  "detectionArch",
  "segHeadType",
  "datasetFormat",
  "folderPath",
  "trainPath",
  "valPath",
  "testPath",
  "numClasses",
  "maxEpochs",
  "learningRate",
  "batchSize",
  "optimizer",
  "scheduler",
  "weightDecay",
  "precision",
  "gradientClipVal",
  "imageSize",
  "augmentationPreset",
  "freezeBackbone",
  "seed",
  "earlyStopping",
  "earlyStoppingPatience",
  "earlyStoppingMonitor",
  "gpuDevices",
  "imageFolderPath",
  "imageColumn",
  "labelColumn",
  "labelColumns",
  "accelerator",
  "numWorkers",
  "compileModel",
];

/**
 * Left-hand navigation, in display order. `keys` are the project fields shown
 * in that category; categories without keys hold app-wide tools.
 */
export const SETTINGS_GROUPS = [
  {
    label: "Project",
    items: [
      { id: "general", label: "General", desc: "Name, location and identity", keys: ["name", "projectPath"] },
      { id: "connection", label: "Connection", desc: "Where training runs", keys: ["connectionType", "sshCommand"] },
      {
        id: "dataset",
        label: "Dataset",
        desc: "Format, paths and classes",
        keys: [
          "datasetFormat", "folderPath", "trainPath", "valPath", "testPath",
          "imageFolderPath", "imageColumn", "labelColumn", "labelColumns", "numClasses",
        ],
      },
    ],
  },
  {
    label: "Training",
    items: [
      { id: "model", label: "Model", desc: "Architecture and backbone", keys: ["modelCategory", "detectionArch", "segHeadType", "freezeBackbone", "compileModel"] },
      {
        id: "hyperparameters",
        label: "Hyperparameters",
        desc: "Optimisation, schedule and stopping",
        keys: [
          "maxEpochs", "learningRate", "batchSize", "weightDecay", "optimizer", "scheduler",
          "gradientClipVal", "seed", "earlyStopping", "earlyStoppingMonitor", "earlyStoppingPatience",
        ],
      },
      { id: "input", label: "Input & augmentation", desc: "Image size and augmentation", keys: ["imageSize", "augmentationPreset"] },
      { id: "hardware", label: "Hardware", desc: "Device, precision and data loading", keys: ["accelerator", "gpuDevices", "precision", "numWorkers"] },
    ],
  },
  {
    label: "App",
    items: [
      { id: "appearance", label: "Appearance", desc: "Theme and app tour", keys: [] },
      { id: "ssh", label: "SSH keys", desc: "Keys found in ~/.ssh", keys: [] },
      { id: "transfer", label: "Import / export", desc: "Move projects between machines", keys: [] },
      { id: "danger", label: "Danger zone", desc: "Delete this project or all data", keys: [], danger: true },
    ],
  },
];

export const SETTINGS_CATEGORIES = SETTINGS_GROUPS.flatMap((g) => g.items);

/** Category ids whose fields differ between `draft` and the saved `source`. */
export function dirtyCategories(draft, source) {
  const out = new Set();
  for (const c of SETTINGS_CATEGORIES) {
    if (c.keys.some((k) => draft[k] !== (source[k] ?? ""))) out.add(c.id);
  }
  return out;
}
