import { CsvColumnFields } from "../components/CsvColumnFields.jsx";
import { useState, useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import { validateTrainingProject } from "../utils/configBuilder.js";
import { theme, toggleTheme } from "../state/theme.js";
import {
  currentProject,
  updateProject,
  openDeleteDialog,
  addProject,
  MODEL_CATEGORIES,
  YOLOX_MODEL_CATEGORIES,
  DETECTION_MODEL_CATEGORIES,
  SEGMENTATION_MODEL_CATEGORIES,
  DATASET_FORMATS,
  DETECTION_ARCHS,
  SEG_HEAD_TYPES,
} from "../state/projects.js";
import { sshConnected, syncConfig, platform, requireResync } from "../state/dashboard.js";
import { allRuns, loadRuns } from "../state/experiments.js";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog.jsx";
import { clearAllData, saveRun } from "../db/database.js";
import { downloadFile } from "../utils/exportRuns.js";
import { projectList } from "../state/projects.js";
import { navigate } from "../state/router.js";
import { startTutorial } from "../state/tutorial.js";

import { EDITABLE_KEYS, SETTINGS_GROUPS, SETTINGS_CATEGORIES, dirtyCategories } from "../utils/settingsCategories.js";

const READONLY_KEYS = ["taskType"];

/** Tasks whose CSV datasets carry a mask column alongside the image column. */
const SEGMENTATION_TASKS = ["Semantic Segmentation", "Instance Segmentation"];

function pick(obj) {
  const out = {};
  // Include editable fields
  for (const k of EDITABLE_KEYS) {
    // Provide default values for fields that might not exist in older projects
    out[k] = obj[k] !== undefined ? obj[k] : "";
  }
  // Include read-only fields (needed for rendering but not editable)
  for (const k of READONLY_KEYS) {
    out[k] = obj[k];
  }
  return out;
}

function isDirty(draft, source) {
  for (const k of EDITABLE_KEYS) {
    if (draft[k] !== (source[k] ?? "")) return true;
  }
  return false;
}

const pathBase = () => platform.value === "windows" ? "~\\nightflow\\projects\\" : "~/nightflow/projects/";
const sanitizeForPath = (n) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sunIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const moonIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const trashIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const lockIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
// Same glyph the Interpretation view uses for its drop zone.
const imageIcon = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

const SECTION_ICON_PATHS = {
  general: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  connection: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  dataset: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  model: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  hyperparameters: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  input: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  hardware: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  appearance: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  ssh: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  transfer: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
  danger: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
};

function svgIcon(paths, size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/** Icon for a settings category (tile in the panel header, plain in the nav). */
function SectionIcon({ id, size = 17, tile = true }) {
  return (
    <span
      class={tile ? "sv-icon" : "sv-nav-icon"}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svgIcon(SECTION_ICON_PATHS[id] || SECTION_ICON_PATHS.general, size) }}
    />
  );
}

/** On/off switch for boolean settings. */
function Toggle({ on, disabled, label, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      class={`settings-switch${on ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span class="settings-switch-thumb" />
    </button>
  );
}

/**
 * One setting: label and hint on the left, the control on the right.
 * `stack` puts the control under the text (wide content such as CSV columns).
 */
function Row({ label, hint, children, stack = false, as = "label" }) {
  const Tag = as;
  return (
    <Tag class={`sv-row${stack ? " sv-row--stack" : ""}`}>
      <span class="sv-row-text">
        <span class="sv-row-label">{label}</span>
        {hint && <span class="sv-row-hint">{hint}</span>}
      </span>
      <span class="sv-row-control">{children}</span>
    </Tag>
  );
}

/** Native select with the app's chevron. */
function Select({ value, onChange, disabled, children, size = "md" }) {
  return (
    <span class={`sv-select sv-w-${size}`}>
      <select class="settings-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </span>
  );
}

/** Two-to-four option segmented control. */
function Seg({ value, options, onChange, disabled, label }) {
  return (
    <span class="sv-seg sv-seg--sm" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          class={value === o.value ? "is-active" : ""}
          disabled={disabled}
          onClick={() => value !== o.value && onChange(o.value)}
        >
          {o.icon && <span class="sv-seg-icon" dangerouslySetInnerHTML={{ __html: o.icon }} />}
          {o.label}
        </button>
      ))}
    </span>
  );
}

const numOrEmpty = (v) => (v === "" ? "" : Number(v));

function SshKeysList() {
  const [keys, setKeys] = useState(null);
  useEffect(() => {
    invoke("list_ssh_keys")
      .then((k) => setKeys(Array.isArray(k) ? k : []))
      .catch(() => setKeys([]));
  }, []);
  if (keys === null) return <p class="sv-empty">Looking for keys…</p>;
  if (keys.length === 0) return <p class="sv-empty">No SSH keys found in ~/.ssh/. Remote projects use your SSH config and agent.</p>;
  return (
    <div class="sv-keys">
      {keys.map((k) => (
        <div key={k.name} class="sv-key">
          <span class="sv-key-icon" dangerouslySetInnerHTML={{ __html: svgIcon(SECTION_ICON_PATHS.ssh, 15) }} />
          <span class="sv-key-text">
            <span class="sv-key-name">{k.name}</span>
            <span class="sv-key-fp" title={k.fingerprint}>{k.fingerprint}</span>
          </span>
          <span class="sv-key-type">{k.key_type}</span>
        </div>
      ))}
    </div>
  );
}

/** Category shown on the right; kept across visits to the settings view. */
const settingsCategory = signal("general");

function ClearAllDataRow() {
  const [showDialog, setShowDialog] = useState(false);
  return (
    <>
      <Row as="div" label="Clear all data" hint="Wipes every project, run and metric from the app. Cannot be undone.">
        <button class="settings-danger-btn" onClick={() => setShowDialog(true)}>
          <span dangerouslySetInnerHTML={{ __html: trashIcon }} />
          Clear all data
        </button>
      </Row>
      {showDialog && <ClearAllDataDialog onClose={() => setShowDialog(false)} />}
    </>
  );
}

function ClearAllDataDialog({ onClose }) {
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const confirmed = confirmText.toLowerCase() === "permanently delete";

  async function handleClear() {
    if (!confirmed) return;
    setClearing(true);
    try {
      await clearAllData();
      projectList.value = [];
      allRuns.value = [];
      navigate("dashboard");
      window.location.reload();
    } catch (err) {
      console.error("Failed to clear data:", err);
      setClearing(false);
    }
  }

  return (
    <div
      class="wizard-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="delete-dialog">
        <div class="delete-dialog-header">
          <h2>Clear All Data</h2>
          <button class="wizard-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div class="delete-dialog-body">
          <p class="delete-dialog-warning">
            This will permanently delete <strong>all projects</strong>, runs,
            and metrics from the app. This action cannot be undone.
          </p>
          <p class="delete-dialog-prompt">
            Type <strong>permanently delete</strong> to confirm:
          </p>
          <input
            class="wizard-input delete-dialog-input"
            type="text"
            placeholder="Type permanently delete to confirm"
            value={confirmText}
            onInput={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && confirmed) handleClear();
            }}
            autoFocus
          />
        </div>
        <div class="wizard-footer">
          <button class="wizard-btn wizard-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            class="wizard-btn wizard-btn-danger"
            disabled={!confirmed || clearing}
            onClick={handleClear}
          >
            {clearing ? "Clearing..." : "Delete Everything"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsView() {
  const proj = currentProject.value;
  const [draft, setDraft] = useState(() => {
    if (!proj) return {};
    const pickedData = pick(proj);
    // Ensure critical fields have values for proper rendering
    if (!pickedData.connectionType) pickedData.connectionType = "localhost";
    if (!pickedData.sshCommand) pickedData.sshCommand = "localhost";
    if (!pickedData.taskType) pickedData.taskType = "Classification";
    if (!pickedData.modelCategory) pickedData.modelCategory = "Edge";
    if (!pickedData.datasetFormat) pickedData.datasetFormat = "Folder";
    if (!pickedData.detectionArch) pickedData.detectionArch = "fcos";
    if (!pickedData.segHeadType) pickedData.segHeadType = "deeplabv3plus";
    return pickedData;
  });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);
  const [augPreviewOpen, setAugPreviewOpen] = useState(false);
  const [augPreviewImages, setAugPreviewImages] = useState([]);
  const [augPreviewLoading, setAugPreviewLoading] = useState(false);
  const [augPreviewError, setAugPreviewError] = useState(null);
  const [augSourceImage, setAugSourceImage] = useState(null);
  const [augDragging, setAugDragging] = useState(false);

  /** Shared by the file picker and the drop target. */
  const runAugPreview = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(",")[1];
      setAugSourceImage(b64);
      setAugPreviewLoading(true);
      setAugPreviewError(null);
      setAugPreviewImages([]);
      invoke("preview_augmentation", {
        projectPath: proj.projectPath,
        imageBase64: b64,
        preset: draft.augmentationPreset || "default",
        sshCommand: proj.connectionType === "remote" ? proj.sshCommand : null,
      })
        // The command resolves to the array of base64 images itself.
        .then((images) => setAugPreviewImages(images || []))
        .catch((err) => {
          setAugPreviewImages([]);
          setAugPreviewError(
            typeof err === "string" ? err : err?.message || "Preview failed",
          );
        })
        .finally(() => setAugPreviewLoading(false));
    };
    reader.readAsDataURL(file);
  };

  const resetAugPreview = () => {
    setAugSourceImage(null);
    setAugPreviewImages([]);
    setAugPreviewError(null);
  };

  // Re-sync draft when switching projects
  useEffect(() => {
    if (proj) {
      const pickedData = pick(proj);
      // Ensure critical fields have values for proper rendering
      if (!pickedData.connectionType) pickedData.connectionType = "localhost";
      if (!pickedData.sshCommand) pickedData.sshCommand = "localhost";
      if (!pickedData.taskType) pickedData.taskType = "Classification";
      if (!pickedData.modelCategory) pickedData.modelCategory = "Edge";
      if (!pickedData.datasetFormat) pickedData.datasetFormat = "Folder";
      if (!pickedData.detectionArch) pickedData.detectionArch = "fcos";
      if (!pickedData.segHeadType) pickedData.segHeadType = "deeplabv3plus";
      setDraft(pickedData);
    }
  }, [proj?.id]);

  if (!proj)
    return (
      <div class="settings-view">
        <p class="settings-empty">No project selected.</p>
      </div>
    );

  const locked = sshConnected.value;
  const runCount = allRuns.value.filter((r) => r.projectId === proj.id).length;
  const dirty = isDirty(draft, proj);

  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  function ensureTrailingSlash(p) {
    if (!p || p.endsWith("/") || p.endsWith("\\")) return p;
    return p + (platform.value === "windows" ? "\\" : "/");
  }

  async function handleSave() {
    try {
      const normalized = { ...draft };
      validateTrainingProject(normalized);
      if (normalized.projectPath)
        normalized.projectPath = ensureTrailingSlash(normalized.projectPath);
      if (normalized.folderPath)
        normalized.folderPath = ensureTrailingSlash(normalized.folderPath);
      await updateProject(proj.id, normalized);
      // Regenerate config.yaml with updated settings
      const updatedProject = { ...proj, ...normalized };
      await syncConfig(updatedProject, proj.id);
      // The last sync's dataset/environment results may no longer apply.
      await requireResync(proj.id);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error saving project:", error);
      alert(`Could not save training configuration: ${error.message || error}`);
    }
  }

  function handleDiscard() {
    setDraft(pick(proj));
    setSaved(false);
  }

  const isDetection = draft.taskType === "Object Detection";
  const isSegmentation =
    draft.taskType === "Semantic Segmentation" ||
    draft.taskType === "Instance Segmentation";
  const datasetFormats = DATASET_FORMATS[draft.taskType] || [];
  const modelCatSource =
    isDetection && draft.detectionArch === "yolox"
      ? YOLOX_MODEL_CATEGORIES
      : isDetection
        ? DETECTION_MODEL_CATEGORIES
        : isSegmentation
          ? SEGMENTATION_MODEL_CATEGORIES
          : MODEL_CATEGORIES;
  const modelCatDesc = draft.modelCategory
    ? modelCatSource[draft.modelCategory]?.desc
    : null;

  const derivedProjectPath = draft.name
    ? `${pathBase()}${sanitizeForPath(draft.name)}`
    : pathBase();

  const category = SETTINGS_CATEGORIES.find((c) => c.id === settingsCategory.value) || SETTINGS_CATEGORIES[0];
  const dirtyCats = dirtyCategories(draft, proj);

  function exportProject() {
    const config = { ...proj };
    // Remove internal/volatile fields
    delete config.syncMetadata;
    const projectRuns = allRuns.value.filter((r) => r.projectId === proj.id);
    const json = JSON.stringify({ project: config, runs: projectRuns }, null, 2);
    downloadFile(json, `${(proj.name || "project").replace(/\s+/g, "-")}-export.json`, "application/json");
  }

  function importProject() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        // Support new format { project, runs } and legacy flat config
        const config = parsed.project ? { ...parsed.project } : parsed;
        const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
        // Assign new ID
        config.id = String(Math.max(0, ...projectList.value.map((p) => Number(p.id) || 0)) + 1);
        config.name = config.name ? `${config.name} (imported)` : "Imported Project";
        delete config.syncMetadata;
        await addProject(config);
        // Import associated runs with updated projectId
        for (const run of runs) await saveRun({ ...run, projectId: config.id });
        if (runs.length > 0) await loadRuns();
      } catch (err) {
        console.error("Failed to import project:", err);
      }
    };
    input.click();
  }

  const fmtLower = (draft.datasetFormat || "").toLowerCase();
  const winPath = platform.value === "windows";
  const isTabular = draft.datasetFormat === "CSV" || draft.datasetFormat === "JSONL";
  const accelerator = draft.accelerator || (draft.gpuDevices ? "cuda" : "auto");

  const panels = {
    general: (
      <>
        <Row label="Project name">
          <input class="settings-input sv-w-lg" type="text" value={draft.name} placeholder="My Project" disabled={locked} onInput={(e) => set("name", e.target.value)} />
        </Row>
        <Row label="Project folder" hint="Logs, checkpoints and exports are stored here">
          <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.projectPath || ""} placeholder={derivedProjectPath} disabled={locked} onInput={(e) => set("projectPath", e.target.value)} />
        </Row>
        <Row as="div" label="Task type" hint="Set when the project was created">
          <span class="sv-static"><span dangerouslySetInnerHTML={{ __html: lockIcon }} />{draft.taskType}</span>
        </Row>
        <Row as="div" label="Project ID">
          <span class="sv-static sv-static--mono">{proj.id}</span>
        </Row>
      </>
    ),

    connection: (
      <>
        <Row as="div" label="Run training on" hint={draft.connectionType === "remote" ? "A machine reached over SSH" : "This computer"}>
          <Seg
            label="Run training on"
            value={draft.connectionType || "localhost"}
            disabled={locked}
            options={[{ value: "localhost", label: "This machine" }, { value: "remote", label: "Remote (SSH)" }]}
            onChange={(v) => {
              set("connectionType", v);
              if (v === "localhost") set("sshCommand", "localhost");
              else if (draft.sshCommand === "localhost") set("sshCommand", "");
            }}
          />
        </Row>
        {draft.connectionType === "remote" && (
          <Row label="SSH command" hint="How you'd connect from a terminal">
            <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.sshCommand} placeholder="ssh user@host" disabled={locked} onInput={(e) => set("sshCommand", e.target.value)} />
          </Row>
        )}
      </>
    ),

    dataset: (
      <>
        <Row label="Format" hint={`${datasetFormats.length} format${datasetFormats.length !== 1 ? "s" : ""} available for ${draft.taskType}`}>
          <Select value={draft.datasetFormat || ""} disabled={locked} onChange={(v) => set("datasetFormat", v)}>
            <option value="">Select format</option>
            {datasetFormats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        </Row>
        {draft.datasetFormat && !isTabular && (
          <Row label="Dataset folder" hint={`The ${draft.datasetFormat} dataset root`}>
            <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.folderPath || ""} placeholder={winPath ? "C:\\path\\to\\dataset" : "/path/to/dataset"} disabled={locked} onInput={(e) => set("folderPath", e.target.value)} />
          </Row>
        )}
        {isTabular && (
          <>
            <Row label="Train file">
              <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.trainPath || ""} placeholder={winPath ? `C:\\path\\to\\train.${fmtLower}` : `/path/to/train.${fmtLower}`} disabled={locked} onInput={(e) => set("trainPath", e.target.value)} />
            </Row>
            <Row label="Validation file" hint="Optional">
              <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.valPath || ""} placeholder={winPath ? `C:\\path\\to\\val.${fmtLower}` : `/path/to/val.${fmtLower}`} disabled={locked} onInput={(e) => set("valPath", e.target.value)} />
            </Row>
            <Row label="Test file">
              <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.testPath || ""} placeholder={winPath ? `C:\\path\\to\\test.${fmtLower}` : `/path/to/test.${fmtLower}`} disabled={locked} onInput={(e) => set("testPath", e.target.value)} />
            </Row>
            {/* Semantic segmentation resolves this as AutoTimm's data_dir and
                instance segmentation as its image_dir; both resolve mask paths
                alongside images, while the other tasks have no mask column. */}
            <Row
              label={SEGMENTATION_TASKS.includes(draft.taskType) ? "Image / mask root" : "Image root"}
              hint={SEGMENTATION_TASKS.includes(draft.taskType) ? "Resolves relative image and mask paths" : "Resolves relative image paths"}
            >
              <input class="settings-input settings-input-mono sv-w-xl" value={draft.imageFolderPath} disabled={locked} onInput={(e) => set("imageFolderPath", e.target.value)} />
            </Row>
          </>
        )}
        {draft.datasetFormat === "CSV" && (
          <div class="sv-row sv-row--block">
            <CsvColumnFields value={draft} onChange={set} disabled={locked} />
          </div>
        )}
        {!isDetection && (
          <Row label="Number of classes">
            <input class="settings-input sv-w-sm" type="number" min="2" value={draft.numClasses} placeholder="e.g. 10" disabled={locked} onInput={(e) => set("numClasses", numOrEmpty(e.target.value))} />
          </Row>
        )}
      </>
    ),

    model: (
      <>
        <Row label="Model category" hint={modelCatDesc || "Deployment target tier"}>
          <Select value={draft.modelCategory} disabled={locked} onChange={(v) => set("modelCategory", v)}>
            <option value="">Select category</option>
            {Object.keys(modelCatSource).map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Row>
        {isDetection && (
          <Row label="Detection architecture">
            <Select value={draft.detectionArch} disabled={locked} onChange={(v) => set("detectionArch", v)}>
              {DETECTION_ARCHS.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Row>
        )}
        {isSegmentation && (
          <Row label="Segmentation head">
            <Select value={draft.segHeadType} disabled={locked} onChange={(v) => set("segHeadType", v)}>
              {SEG_HEAD_TYPES.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </Row>
        )}
        <Row as="div" label="Freeze backbone" hint="Keep pretrained backbone weights fixed">
          <Toggle on={!!draft.freezeBackbone} disabled={locked} label="Freeze backbone" onChange={(v) => set("freezeBackbone", v)} />
        </Row>
        <Row as="div" label="Compile model" hint="Faster on CUDA; leave off for CPU and Metal">
          <Toggle on={!!draft.compileModel} disabled={locked} label="Compile model" onChange={(v) => set("compileModel", v)} />
        </Row>
      </>
    ),

    hyperparameters: (
      <>
        <Row label="Max epochs">
          <input class="settings-input sv-w-sm" type="number" min="1" value={draft.maxEpochs} disabled={locked} onInput={(e) => set("maxEpochs", numOrEmpty(e.target.value))} />
        </Row>
        <Row label="Batch size">
          <input class="settings-input sv-w-sm" type="number" min="1" value={draft.batchSize} placeholder="auto" disabled={locked} onInput={(e) => set("batchSize", numOrEmpty(e.target.value))} />
        </Row>
        <Row label="Learning rate" hint="Empty uses the AutoTimm default">
          <input class="settings-input sv-w-sm" type="number" step="any" value={draft.learningRate} placeholder="auto" disabled={locked} onInput={(e) => set("learningRate", numOrEmpty(e.target.value))} />
        </Row>
        <Row label="Optimizer">
          <Select value={draft.optimizer} disabled={locked} onChange={(v) => set("optimizer", v)}>
            <option value="">Auto (default)</option>
            <option value="adamw">AdamW</option>
            <option value="adam">Adam</option>
            <option value="sgd">SGD</option>
          </Select>
        </Row>
        <Row label="Scheduler">
          <Select value={draft.scheduler} disabled={locked} onChange={(v) => set("scheduler", v)}>
            <option value="">Auto (default)</option>
            <option value="cosine">Cosine</option>
            <option value="step">Step</option>
            <option value="onecycle">OneCycle</option>
            <option value="none">None</option>
          </Select>
        </Row>
        <Row label="Weight decay" hint="L2 regularization">
          <input class="settings-input sv-w-sm" type="number" step="any" value={draft.weightDecay} placeholder="auto" disabled={locked} onInput={(e) => set("weightDecay", numOrEmpty(e.target.value))} />
        </Row>
        <Row label="Gradient clip" hint="Max gradient norm">
          <input class="settings-input sv-w-sm" type="number" step="any" value={draft.gradientClipVal} placeholder="auto" disabled={locked} onInput={(e) => set("gradientClipVal", numOrEmpty(e.target.value))} />
        </Row>
        <Row label="Seed" hint="Empty for a random seed">
          <input class="settings-input sv-w-sm" type="number" min="0" value={draft.seed} placeholder="random" disabled={locked} onInput={(e) => set("seed", numOrEmpty(e.target.value))} />
        </Row>
        <div class="sv-subhead">Early stopping</div>
        <Row as="div" label="Stop early" hint="Halt when the metric stops improving">
          <Toggle on={!!draft.earlyStopping} disabled={locked} label="Early stopping" onChange={(v) => set("earlyStopping", v)} />
        </Row>
        {draft.earlyStopping && (
          <>
            <Row label="Monitor" hint={isDetection ? "Detection only logs mAP" : null}>
              <Select value={isDetection ? "val/map" : draft.earlyStoppingMonitor} disabled={locked || isDetection} onChange={(v) => set("earlyStoppingMonitor", v)}>
                {isDetection ? (
                  // Detection logs no validation loss or accuracy.
                  <option value="val/map">Validation mAP</option>
                ) : (
                  <>
                    <option value="val/loss">Validation loss</option>
                    <option value="val/accuracy">Validation accuracy</option>
                  </>
                )}
              </Select>
            </Row>
            <Row label="Patience" hint="Epochs without improvement">
              <input class="settings-input sv-w-sm" type="number" min="1" value={draft.earlyStoppingPatience} placeholder="10" disabled={locked} onInput={(e) => set("earlyStoppingPatience", numOrEmpty(e.target.value))} />
            </Row>
          </>
        )}
      </>
    ),

    input: (
      <>
        <Row label="Image size" hint="Input resolution in pixels">
          <input class="settings-input sv-w-sm" type="number" min="1" value={draft.imageSize} placeholder="auto" disabled={locked} onInput={(e) => set("imageSize", numOrEmpty(e.target.value))} />
        </Row>
        <Row as="div" label="Augmentation preset" hint="Random transforms applied while training">
          <span class="sv-inline">
            <Select value={draft.augmentationPreset} disabled={locked} onChange={(v) => set("augmentationPreset", v)}>
              {/* Mirrors AutoTimm's TORCHVISION_PRESETS registry, in order. */}
              <option value="">Auto (default)</option>
              <option value="default">Default</option>
              <option value="autoaugment">AutoAugment</option>
              <option value="randaugment">RandAugment</option>
              <option value="trivialaugment">TrivialAugment</option>
              <option value="light">Light</option>
            </Select>
            <button type="button" class="settings-action-btn" onClick={() => setAugPreviewOpen(true)} disabled={locked}>
              Preview
            </button>
          </span>
        </Row>
      </>
    ),

    hardware: (
      <>
        <Row label="Accelerator">
          <Select
            value={accelerator}
            disabled={locked}
            onChange={(v) => { set("accelerator", v); if (v !== "cuda") set("gpuDevices", ""); }}
          >
            <option value="auto">Auto (training machine)</option>
            <option value="cuda">NVIDIA CUDA</option>
            <option value="mps">Apple Metal (MPS)</option>
            <option value="cpu">CPU</option>
          </Select>
        </Row>
        {(accelerator === "cuda" || accelerator === "auto") && (
          <Row label="GPU devices" hint="CUDA indices, e.g. 0 or 0,1">
            <input class="settings-input settings-input-mono sv-w-sm" type="text" value={draft.gpuDevices} placeholder="auto" disabled={locked} onInput={(e) => set("gpuDevices", e.target.value)} />
          </Row>
        )}
        <Row label="Precision">
          <Select value={draft.precision} disabled={locked} onChange={(v) => set("precision", v)}>
            <option value="">Auto (default)</option>
            <option value="32">32-bit (float32)</option>
            <option value="16-mixed">16-mixed (AMP)</option>
            <option value="bf16-mixed">bf16-mixed</option>
          </Select>
        </Row>
        <Row label="Data-loader workers" hint="Empty uses the AutoTimm default">
          <input class="settings-input sv-w-sm" type="number" min="0" value={draft.numWorkers} placeholder="auto" disabled={locked} onInput={(e) => set("numWorkers", numOrEmpty(e.target.value))} />
        </Row>
      </>
    ),

    appearance: (
      <>
        <Row as="div" label="Theme">
          <Seg
            label="Theme"
            value={theme.value}
            options={[{ value: "dark", label: "Dark", icon: moonIcon }, { value: "light", label: "Light", icon: sunIcon }]}
            onChange={toggleTheme}
          />
        </Row>
        <Row as="div" label="App tour" hint="Replay the first-run walkthrough">
          <button type="button" class="settings-action-btn" onClick={startTutorial}>Restart tour</button>
        </Row>
      </>
    ),

    ssh: <SshKeysList />,

    transfer: (
      <>
        <Row as="div" label="Export this project" hint="Settings and runs as one JSON file">
          <button type="button" class="settings-action-btn" onClick={exportProject}>Export</button>
        </Row>
        <Row as="div" label="Import a project" hint="Creates a new project from an exported file">
          <button type="button" class="settings-action-btn" onClick={importProject}>Import</button>
        </Row>
      </>
    ),

    danger: (
      <>
        <Row as="div" label="Delete this project" hint="Removes the project and its runs from NightFlow. Cannot be undone.">
          <button class="settings-danger-btn" disabled={locked} onClick={() => openDeleteDialog(proj.id)}>
            <span dangerouslySetInnerHTML={{ __html: trashIcon }} />
            Delete project
          </button>
        </Row>
        <ClearAllDataRow />
      </>
    ),
  };

  return (
    <div class="settings-view dash rd sv">
      <header class="rd-head sv-head">
        <div class="rd-head-main">
          <span class="rd-eyebrow sv-eyebrow">Project settings</span>
          <div class="rd-title">
            <h2>{proj.name || "Untitled project"}</h2>
          </div>
          <div class="sv-chips">
            <span class="sv-chip">{proj.taskType || "Classification"}</span>
            {proj.datasetFormat && <span class="sv-chip">{proj.datasetFormat} dataset</span>}
            <span class="sv-chip">
              {proj.connectionType === "remote" ? (proj.sshCommand || "Remote").replace(/^ssh\s+/, "") : "Local compute"}
            </span>
            <span class="sv-chip">{runCount} {runCount === 1 ? "run" : "runs"}</span>
          </div>
        </div>
      </header>

      {locked && (
        <div class="rd-insight sv-locked" role="status">
          <span class="rd-insight-icon" dangerouslySetInnerHTML={{ __html: lockIcon }} />
          <div>
            <strong>Settings are locked while connected</strong>
            <span>Disconnect from the dashboard to make changes. Saved changes trigger a fresh sync on the next connect.</span>
          </div>
        </div>
      )}

      <div class="sv-layout">
        <nav class="sv-nav" aria-label="Settings categories">
          {SETTINGS_GROUPS.map((g) => (
            <div key={g.label} class="sv-nav-group">
              <div class="sv-nav-label">{g.label}</div>
              {g.items.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  class={`sv-nav-item${c.id === category.id ? " is-active" : ""}${c.danger ? " is-danger" : ""}`}
                  aria-current={c.id === category.id ? "page" : undefined}
                  onClick={() => (settingsCategory.value = c.id)}
                >
                  <SectionIcon id={c.id} size={15} tile={false} />
                  <span class="sv-nav-text">{c.label}</span>
                  {dirtyCats.has(c.id) && <span class="sv-nav-dot" title="Unsaved changes" />}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div class="sv-main">
        <section class={`sv-panel${category.danger ? " is-danger" : ""}`} aria-labelledby="sv-panel-title">
          <header class="sv-panel-head">
            <SectionIcon id={category.id} />
            <div>
              <h2 id="sv-panel-title">{category.label}</h2>
              <p>{category.desc}</p>
            </div>
          </header>
          <div class="sv-rows">{panels[category.id]}</div>
        </section>
          {/* Save bar */}
          <div class={`settings-save-bar ${dirty || saved ? "visible" : ""}`}>
            {saved ? (
              <div class="settings-saved-msg">
                <span dangerouslySetInnerHTML={{ __html: checkIcon }} />
                Changes saved · the project will sync again when you connect
              </div>
            ) : (
              <>
                <span class="settings-save-hint">You have unsaved changes</span>
                <div class="settings-save-actions">
                  <button class="settings-discard-btn" onClick={handleDiscard}>
                    Discard
                  </button>
                  <button
                    class="settings-save-btn"
                    disabled={locked}
                    onClick={handleSave}
                  >
                    Save Changes
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <DeleteProjectDialog />

      {augPreviewOpen && (
        <div class="modal-overlay" onClick={() => setAugPreviewOpen(false)}>
          <div class="modal-dialog aug-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div class="modal-header">
              <h3 class="modal-title">Augmentation Preview</h3>
              <button
                class="modal-close-btn"
                onClick={() => setAugPreviewOpen(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div class="modal-body">
              <div class="aug-preview-meta">
                <span class="aug-preview-preset-label">Preset</span>
                <span class="aug-preview-preset">
                  {draft.augmentationPreset || "Auto (default)"}
                </span>
              </div>

              {!augSourceImage ? (
                <label
                  class={`aug-preview-upload${augDragging ? " dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setAugDragging(true);
                  }}
                  onDragLeave={() => setAugDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setAugDragging(false);
                    runAugPreview(e.dataTransfer?.files?.[0]);
                  }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    style="display:none"
                    onChange={(e) => runAugPreview(e.target.files?.[0])}
                  />
                  <span
                    class="aug-preview-upload-icon"
                    dangerouslySetInnerHTML={{ __html: imageIcon }}
                  />
                  <span class="aug-preview-upload-title">
                    Drop an image here or click to browse
                  </span>
                  <span class="aug-preview-upload-hint">Supports PNG, JPG, WEBP</span>
                </label>
              ) : (
                <>
                  <div class="aug-preview-source">
                    <img
                      class="aug-preview-source-img"
                      src={`data:image/png;base64,${augSourceImage}`}
                      alt="Source"
                    />
                    <div class="aug-preview-source-meta">
                      <span class="aug-preview-source-label">Source image</span>
                      <span class="settings-hint">
                        {augPreviewImages.length > 0
                          ? `${augPreviewImages.length} variants generated`
                          : "Each variant re-samples the preset's random transforms."}
                      </span>
                    </div>
                    <button class="settings-action-btn" onClick={resetAugPreview}>
                      Choose different
                    </button>
                  </div>

                  {augPreviewLoading ? (
                    // Indeterminate on purpose: the backend returns all variants
                    // in one shot, so there is no real progress to report.
                    <div class="aug-preview-loading">
                      <div class="aug-preview-progress">
                        <div class="aug-preview-progress-bar" />
                      </div>
                      <span class="settings-hint">Generating augmented images…</span>
                    </div>
                  ) : augPreviewError ? (
                    <p class="settings-hint settings-hint-error">{augPreviewError}</p>
                  ) : augPreviewImages.length > 0 ? (
                    <div class="aug-preview-grid">
                      {augPreviewImages.map((img, i) => (
                        <figure key={i} class="aug-preview-cell">
                          <img
                            class="aug-preview-img"
                            src={`data:image/png;base64,${img}`}
                            alt={`Augmented variant ${i + 1}`}
                          />
                          <figcaption class="aug-preview-cell-index">{i + 1}</figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <p class="settings-hint">
                      No augmented images generated. Ensure the project environment is set up.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
