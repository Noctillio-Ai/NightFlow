import { CsvColumnFields } from "../components/CsvColumnFields.jsx";
import { showError } from "../state/dialogs.js";
import { Dialog, ConfirmPhrase, phraseMatches } from "../components/Dialog.jsx";
import { ExportDialog, ImportDialog } from "../components/ProjectTransfer.jsx";
import { chooseImportFile } from "../state/transfer.js";
import { SshKeySelect, SshKeysManager } from "../components/SshKeys.jsx";
import { sshKeyPath } from "../utils/sshCommand.js";
import { projectsBase, pathPlatform, isDefaultProjectPath, defaultProjectPath } from "../utils/projectPaths.js";
import { useState, useEffect, useRef, useContext } from "preact/hooks";
import { createContext, toChildArray, cloneElement, Fragment } from "preact";
import { layoutTiles } from "../utils/settingsGrid.js";
import { signal } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import { validateTrainingProject } from "../utils/configBuilder.js";
import { theme, toggleTheme } from "../state/theme.js";
import {
  currentProject,
  updateProject,
  openDeleteDialog,
  MODEL_CATEGORIES,
  YOLOX_MODEL_CATEGORIES,
  DETECTION_MODEL_CATEGORIES,
  SEGMENTATION_MODEL_CATEGORIES,
  DATASET_FORMATS,
  DETECTION_ARCHS,
  SEG_HEAD_TYPES,
} from "../state/projects.js";
import { sshConnected, syncConfig, platform, requireResync } from "../state/dashboard.js";
import { allRuns } from "../state/experiments.js";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog.jsx";
import { clearAllData } from "../db/database.js";
import { projectList, currentProjectId } from "../state/projects.js";
import { navigate } from "../state/router.js";
import { startTutorial } from "../state/tutorial.js";

import { EDITABLE_KEYS, SETTINGS_GROUPS, SETTINGS_CATEGORIES, dirtyCategories } from "../utils/settingsCategories.js";

const READONLY_KEYS = ["taskType"];

/** Accent hue per category: tints the nav, panel header, tiles and controls. */
const TONES = {
  general: "#818cf8",
  connection: "#22d3ee",
  dataset: "#fbbf24",
  model: "#a78bfa",
  hyperparameters: "#f472b6",
  input: "#34d399",
  hardware: "#fb923c",
  appearance: "#facc15",
  ssh: "#2dd4bf",
  transfer: "#60a5fa",
  danger: "#ef4444",
};
const tone = (id) => TONES[id] || TONES.general;

/** Fields changed in the draft but not yet saved; lets each tile mark itself. */
const DirtyKeys = createContext(new Set());

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

/** Default projects folder in the style of where this project's files live. */
const pathBase = (connectionType) => projectsBase(pathPlatform(connectionType, platform.value));
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
 * One setting, drawn as a tile in the panel grid. By default the label and
 * hint sit above a full-width control; `inline` keeps the control on the
 * right (switches, buttons, read-only values) and `wide` spans every column.
 */
/** Grid span vars a Group hands each tile (see utils/settingsGrid.js). */
const spanStyle = (span, span2) => (span > 1 || span2 > 1 ? { "--s": span, "--s2": span2 } : undefined);

function Row({ label, hint, children, inline = false, wide = false, as = "label", k, span = 1, span2 = 1 }) {
  const Tag = as;
  const edited = useContext(DirtyKeys).has(k);
  return (
    <Tag
      class={`sv-field${inline ? " sv-field--inline" : ""}${wide ? " sv-field--wide" : ""}${edited ? " is-edited" : ""}`}
      style={spanStyle(span, span2)}
    >
      {/* The body switches to a side-by-side row when the tile is wide. */}
      <span class="sv-field-body">
        <span class="sv-row-text">
          <span class="sv-row-label">
            {label}
            {edited && <span class="sv-edited">Edited</span>}
          </span>
          {hint && <span class="sv-row-hint">{hint}</span>}
        </span>
        <span class="sv-row-control">{children}</span>
      </span>
    </Tag>
  );
}

/** Titled group of tiles inside a panel. */
/** Flattens fragments and drops empty slots, keeping a stable key per tile. */
function tilesOf(children, prefix = "") {
  const out = [];
  toChildArray(children).forEach((child, i) => {
    if (child && child.type === Fragment) out.push(...tilesOf(child.props.children, `${prefix}${i}.`));
    else if (child && typeof child === "object") out.push({ node: child, key: child.key ?? child.props?.k ?? child.props?.id ?? `${prefix}${i}` });
  });
  return out;
}

/**
 * Titled group of tiles. The number of columns follows the number of tiles
 * and the last tile of an incomplete row stretches, so rows are always full.
 */
function Group({ title, children }) {
  const tiles = tilesOf(children);
  // Only Row / OverviewCard tiles take part; anything else keeps its own row.
  const isTile = (n) => n.type === Row || n.type === OverviewCard;
  const layout = layoutTiles(tiles.map((t) => ({ wide: !isTile(t.node) || !!t.node.props?.wide })));
  return (
    <div class="sv-group">
      {title && <div class="sv-subhead">{title}</div>}
      <div class="sv-grid" style={{ "--sv-cols": layout.cols, "--sv-cols2": layout.cols2 }}>
        {tiles.map((t, i) =>
          isTile(t.node)
            ? cloneElement(t.node, { key: t.key, span: layout.spans[i], span2: layout.spans2[i] })
            : cloneElement(t.node, { key: t.key }),
        )}
      </div>
    </div>
  );
}

/** Clickable summary card on the General panel that jumps to a category. */
function OverviewCard({ id, items, span = 1, span2 = 1 }) {
  const c = SETTINGS_CATEGORIES.find((x) => x.id === id);
  return (
    <button type="button" class="sv-ov" style={{ "--sv-tone": tone(id), ...spanStyle(span, span2) }} onClick={() => openCategory(id)}>
      <span class="sv-ov-head">
        <SectionIcon id={id} size={15} tile={false} />
        <span class="sv-ov-title">{c.label}</span>
        <span class="sv-ov-arrow" aria-hidden="true">→</span>
      </span>
      <dl class="sv-ov-list">
        {items.map(([k, v]) => (
          <div key={k} class="sv-ov-item">
            <dt>{k}</dt>
            <dd title={String(v)}>{v === "" || v == null ? "auto" : String(v)}</dd>
          </div>
        ))}
      </dl>
    </button>
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

/** Settings → Import / export, for the open project. */
function TransferPanel({ project }) {
  const [exporting, setExporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [pickError, setPickError] = useState("");
  const [picking, setPicking] = useState(false);

  async function pickImport() {
    setPickError("");
    setPicking(true);
    try {
      const file = await chooseImportFile();
      if (file) setImportFile(file);
    } catch (e) {
      setPickError(e?.message || String(e));
    } finally {
      setPicking(false);
    }
  }

  return (
    <Group>
      <Row as="div" inline wide label="Export this project" hint="Lite (settings), Standard (+ runs and metrics) or Full (+ logs, checkpoints and models)">
        <button type="button" class="settings-action-btn" onClick={() => setExporting(true)}>Export…</button>
      </Row>
      <Row as="div" inline wide label="Import" hint="Create a new project from an export, or replace this project with it">
        <button type="button" class="settings-action-btn" onClick={pickImport} disabled={picking}>
          {picking ? "Opening…" : "Import…"}
        </button>
      </Row>
      {pickError && <p class="sv-error" role="alert">{pickError}</p>}
      {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
      {importFile && <ImportDialog file={importFile} project={project} onClose={() => setImportFile(null)} />}
    </Group>
  );
}

/** Category shown on the right; kept across visits to the settings view. */
/**
 * Open category per project ({ [projectId]: categoryId }), kept across visits
 * to the settings view. Each project remembers its own; new ones start on
 * General.
 */
const settingsCategoryByProject = signal({});
const categoryOf = (projectId) => settingsCategoryByProject.value[projectId] || "general";
/** Opens a category in the current project's settings. */
function openCategory(id) {
  const pid = currentProjectId.value;
  settingsCategoryByProject.value = { ...settingsCategoryByProject.value, [pid]: id };
}

function ClearAllDataRow() {
  const [showDialog, setShowDialog] = useState(false);
  return (
    <>
      <Row as="div" inline wide label="Clear all data" hint="Wipes every project, run and metric from the app. Cannot be undone.">
        <button class="settings-danger-btn" onClick={() => setShowDialog(true)}>
          <span dangerouslySetInnerHTML={{ __html: trashIcon }} />
          Clear all data
        </button>
      </Row>
      {showDialog && <ClearAllDataDialog onClose={() => setShowDialog(false)} />}
    </>
  );
}

const CLEAR_PHRASE = "permanently delete";

function ClearAllDataDialog({ onClose }) {
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");
  const confirmed = phraseMatches(confirmText, CLEAR_PHRASE);
  const projects = projectList.value.length;
  const runs = allRuns.value.length;

  async function handleClear() {
    if (!confirmed || clearing) return;
    setClearing(true);
    setError("");
    try {
      await clearAllData();
      projectList.value = [];
      allRuns.value = [];
      navigate("dashboard");
      window.location.reload();
    } catch (err) {
      setError(`Couldn't clear the data: ${err?.message || err}`);
      setClearing(false);
    }
  }

  return (
    <Dialog
      title="Clear all data?"
      sub="Every project and run is removed from NightFlow. This can't be undone."
      icon="database"
      tone="danger"
      role="alertdialog"
      busy={clearing}
      onClose={onClose}
      footer={
        <>
          <button type="button" class="nfd-btn" onClick={onClose} disabled={clearing}>Cancel</button>
          <button type="button" class="nfd-btn nfd-btn--danger" disabled={!confirmed || clearing} onClick={handleClear}>
            {clearing ? <><span class="nfd-spinner" /> Clearing…</> : "Delete everything"}
          </button>
        </>
      }
    >
      <ul class="nfd-facts">
        <li><span class="nfd-fact-dot" />Projects<span class="nfd-fact-value">{projects} removed</span></li>
        <li><span class="nfd-fact-dot" />Runs, metrics and notes<span class="nfd-fact-value">{runs} removed</span></li>
        <li><span class="nfd-fact-dot is-kept" />Files in project folders<span class="nfd-fact-value">kept</span></li>
        <li><span class="nfd-fact-dot is-kept" />SSH keys added and preferences<span class="nfd-fact-value">kept</span></li>
      </ul>
      <p class="nfd-text">To keep a project, export it first from its <strong>Import / export</strong> settings.</p>
      <ConfirmPhrase phrase={CLEAR_PHRASE} value={confirmText} onInput={setConfirmText} onSubmit={handleClear} disabled={clearing} />
      {error && <p class="nfd-error" role="alert">{error}</p>}
    </Dialog>
  );
}

/**
 * Settings for the current project. Keyed by project so switching projects
 * starts a fresh page: no draft, preview or dialog carries over from the
 * project you were in.
 */
export function SettingsView() {
  const id = currentProject.value?.id;
  return <ProjectSettings key={id ?? "none"} />;
}

/** The editable copy of a project, with defaults for fields old projects lack. */
function initialDraft(proj) {
  if (!proj) return {};
  const d = pick(proj);
  if (!d.connectionType) d.connectionType = "localhost";
  if (!d.sshCommand) d.sshCommand = "localhost";
  if (!d.taskType) d.taskType = "Classification";
  if (!d.modelCategory) d.modelCategory = "Edge";
  if (!d.datasetFormat) d.datasetFormat = "Folder";
  if (!d.detectionArch) d.detectionArch = "fcos";
  if (!d.segHeadType) d.segHeadType = "deeplabv3plus";
  return d;
}

function ProjectSettings() {
  const proj = currentProject.value;
  const [draft, setDraft] = useState(() => initialDraft(proj));
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);
  const [augPreviewOpen, setAugPreviewOpen] = useState(false);
  const [augPreviewImages, setAugPreviewImages] = useState([]);
  const [augPreviewLoading, setAugPreviewLoading] = useState(false);
  const [augPreviewError, setAugPreviewError] = useState(null);
  const [augSourceImage, setAugSourceImage] = useState(null);
  const [augDragging, setAugDragging] = useState(false);

  // ⌘S / Ctrl+S saves when there is something to save.
  const saveRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && saveRef.current) {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      showError("Couldn't save the settings", error, "Your changes are still here; try saving again.");
    }
  }

  saveRef.current = dirty && !locked ? handleSave : null;
  const dirtyKeys = new Set(EDITABLE_KEYS.filter((k) => draft[k] !== (proj[k] ?? "")));
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

  function handleDiscard() {
    setDraft(initialDraft(proj));
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
    ? `${pathBase(draft.connectionType)}${sanitizeForPath(draft.name)}`
    : pathBase(draft.connectionType);

  const category = SETTINGS_CATEGORIES.find((c) => c.id === categoryOf(proj.id)) || SETTINGS_CATEGORIES[0];
  const dirtyCats = dirtyCategories(draft, proj);

  const fmtLower = (draft.datasetFormat || "").toLowerCase();
  const winPath = platform.value === "windows";
  const isTabular = draft.datasetFormat === "CSV" || draft.datasetFormat === "JSONL";
  const accelerator = draft.accelerator || (draft.gpuDevices ? "cuda" : "auto");

  const panels = {
    general: (
      <>
        <Group title="Identity">
        <Row k="name" label="Project name">
          <input class="settings-input sv-w-lg" type="text" value={draft.name} placeholder="My Project" disabled={locked} onInput={(e) => set("name", e.target.value)} />
        </Row>
        <Row k="projectPath" wide label="Project folder" hint="Logs, checkpoints and exports are stored here">
          <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.projectPath || ""} placeholder={derivedProjectPath} disabled={locked} onInput={(e) => set("projectPath", e.target.value)} />
        </Row>
        <Row as="div" inline label="Task type" hint="Set when the project was created">
          <span class="sv-static"><span dangerouslySetInnerHTML={{ __html: lockIcon }} />{draft.taskType}</span>
        </Row>
        <Row as="div" inline label="Project ID">
          <span class="sv-static sv-static--mono">{proj.id}</span>
        </Row>
        </Group>
        <Group title="Configuration at a glance">
          <OverviewCard id="connection" items={[["Runs on", draft.connectionType === "remote" ? "Remote (SSH)" : "This machine"], ["Host", draft.connectionType === "remote" ? (draft.sshCommand || "").replace(/^ssh\s+/, "") : "localhost"]]} />
          <OverviewCard id="dataset" items={[["Format", draft.datasetFormat], ["Classes", isDetection ? "from annotations" : draft.numClasses]]} />
          <OverviewCard id="model" items={[["Category", draft.modelCategory], [isDetection ? "Architecture" : isSegmentation ? "Head" : "Backbone", isDetection ? draft.detectionArch : isSegmentation ? draft.segHeadType : draft.freezeBackbone ? "frozen" : "trainable"]]} />
          <OverviewCard id="hyperparameters" items={[["Epochs", draft.maxEpochs], ["Batch size", draft.batchSize], ["Learning rate", draft.learningRate]]} />
          <OverviewCard id="input" items={[["Image size", draft.imageSize], ["Augmentation", draft.augmentationPreset]]} />
          <OverviewCard id="hardware" items={[["Accelerator", accelerator], ["Precision", draft.precision]]} />
        </Group>
      </>
    ),

    connection: (
      <Group>
        <Row k="connectionType" as="div" label="Run training on" hint={draft.connectionType === "remote" ? "A machine reached over SSH" : "This computer"}>
          <Seg
            label="Run training on"
            value={draft.connectionType || "localhost"}
            disabled={locked}
            options={[{ value: "localhost", label: "This machine" }, { value: "remote", label: "Remote (SSH)" }]}
            onChange={(v) => {
              set("connectionType", v);
              // A still-default folder follows the new location's path style.
              if (isDefaultProjectPath(draft.projectPath, draft.name)) {
                set("projectPath", defaultProjectPath(draft.name, pathPlatform(v, platform.value)));
              }
              if (v === "localhost") set("sshCommand", "localhost");
              else if (draft.sshCommand === "localhost") set("sshCommand", "");
            }}
          />
        </Row>
        {draft.connectionType === "remote" && (
          <Row k="sshCommand" wide label="SSH command" hint="How you'd connect from a terminal">
            <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.sshCommand} placeholder="ssh user@host" disabled={locked} onInput={(e) => set("sshCommand", e.target.value)} />
          </Row>
        )}
        {draft.connectionType === "remote" && (
          <Row
            as="div"
            wide
            label="SSH key"
            hint={sshKeyPath(draft.sshCommand) ? "Only this key is offered to the server" : "Uses your SSH config and agent"}
          >
            <SshKeySelect
              command={draft.sshCommand}
              disabled={locked}
              onChange={(cmd) => set("sshCommand", cmd)}
              wrapClass="sv-select sv-w-xl"
              selectClass="settings-select"
            />
            <button type="button" class="sv-link" onClick={() => openCategory("ssh")}>
              Manage keys
            </button>
          </Row>
        )}
      </Group>
    ),

    dataset: (
      <>
        <Group title="Source">
        <Row k="datasetFormat" label="Format" hint={`${datasetFormats.length} format${datasetFormats.length !== 1 ? "s" : ""} available for ${draft.taskType}`}>
          <Select value={draft.datasetFormat || ""} disabled={locked} onChange={(v) => set("datasetFormat", v)}>
            <option value="">Select format</option>
            {datasetFormats.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        </Row>
        {draft.datasetFormat && !isTabular && (
          <Row k="folderPath" wide label="Dataset folder" hint={`The ${draft.datasetFormat} dataset root`}>
            <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.folderPath || ""} placeholder={winPath ? "C:\\path\\to\\dataset" : "/path/to/dataset"} disabled={locked} onInput={(e) => set("folderPath", e.target.value)} />
          </Row>
        )}
        {!isDetection && (
          <Row k="numClasses" label="Number of classes">
            <input class="settings-input sv-w-sm" type="number" min="2" value={draft.numClasses} placeholder="e.g. 10" disabled={locked} onInput={(e) => set("numClasses", numOrEmpty(e.target.value))} />
          </Row>
        )}
        </Group>
        {isTabular && (
          <Group title="Files">
            <Row k="trainPath" label="Train file">
              <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.trainPath || ""} placeholder={winPath ? `C:\\path\\to\\train.${fmtLower}` : `/path/to/train.${fmtLower}`} disabled={locked} onInput={(e) => set("trainPath", e.target.value)} />
            </Row>
            <Row k="valPath" label="Validation file" hint="Optional">
              <input class="settings-input settings-input-mono sv-w-xl" type="text" value={draft.valPath || ""} placeholder={winPath ? `C:\\path\\to\\val.${fmtLower}` : `/path/to/val.${fmtLower}`} disabled={locked} onInput={(e) => set("valPath", e.target.value)} />
            </Row>
            <Row k="testPath" label="Test file">
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
          </Group>
        )}
        {draft.datasetFormat === "CSV" && (
          <Group title="Columns">
            <div class="sv-field sv-field--wide sv-field--block">
              <CsvColumnFields value={draft} onChange={set} disabled={locked} />
            </div>
          </Group>
        )}
      </>
    ),

    model: (
      <>
        <Group title="Architecture">
        <Row k="modelCategory" label="Model category" hint={modelCatDesc || "Deployment target tier"}>
          <Select value={draft.modelCategory} disabled={locked} onChange={(v) => set("modelCategory", v)}>
            <option value="">Select category</option>
            {Object.keys(modelCatSource).map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Row>
        {isDetection && (
          <Row k="detectionArch" label="Detection architecture">
            <Select value={draft.detectionArch} disabled={locked} onChange={(v) => set("detectionArch", v)}>
              {DETECTION_ARCHS.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </Row>
        )}
        {isSegmentation && (
          <Row k="segHeadType" label="Segmentation head">
            <Select value={draft.segHeadType} disabled={locked} onChange={(v) => set("segHeadType", v)}>
              {SEG_HEAD_TYPES.map((h) => <option key={h} value={h}>{h}</option>)}
            </Select>
          </Row>
        )}
        </Group>
        <Group title="Behaviour">
        <Row k="freezeBackbone" as="div" inline label="Freeze backbone" hint="Keep pretrained backbone weights fixed">
          <Toggle on={!!draft.freezeBackbone} disabled={locked} label="Freeze backbone" onChange={(v) => set("freezeBackbone", v)} />
        </Row>
        <Row k="compileModel" as="div" inline label="Compile model" hint="Faster on CUDA; leave off for CPU and Metal">
          <Toggle on={!!draft.compileModel} disabled={locked} label="Compile model" onChange={(v) => set("compileModel", v)} />
        </Row>
        </Group>
      </>
    ),

    hyperparameters: (
      <>
        <Group title="Schedule">
        <Row k="maxEpochs" label="Max epochs">
          <input class="settings-input sv-w-sm" type="number" min="1" value={draft.maxEpochs} disabled={locked} onInput={(e) => set("maxEpochs", numOrEmpty(e.target.value))} />
        </Row>
        <Row k="batchSize" label="Batch size">
          <input class="settings-input sv-w-sm" type="number" min="1" value={draft.batchSize} placeholder="auto" disabled={locked} onInput={(e) => set("batchSize", numOrEmpty(e.target.value))} />
        </Row>
        <Row k="seed" label="Seed" hint="Empty for a random seed">
          <input class="settings-input sv-w-sm" type="number" min="0" value={draft.seed} placeholder="random" disabled={locked} onInput={(e) => set("seed", numOrEmpty(e.target.value))} />
        </Row>
        </Group>
        <Group title="Optimisation">
        <Row k="learningRate" label="Learning rate" hint="Empty uses the AutoTimm default">
          <input class="settings-input sv-w-sm" type="number" step="any" value={draft.learningRate} placeholder="auto" disabled={locked} onInput={(e) => set("learningRate", numOrEmpty(e.target.value))} />
        </Row>
        <Row k="optimizer" label="Optimizer">
          <Select value={draft.optimizer} disabled={locked} onChange={(v) => set("optimizer", v)}>
            <option value="">Auto (default)</option>
            <option value="adamw">AdamW</option>
            <option value="adam">Adam</option>
            <option value="sgd">SGD</option>
          </Select>
        </Row>
        <Row k="scheduler" label="Scheduler">
          <Select value={draft.scheduler} disabled={locked} onChange={(v) => set("scheduler", v)}>
            <option value="">Auto (default)</option>
            <option value="cosine">Cosine</option>
            <option value="step">Step</option>
            <option value="onecycle">OneCycle</option>
            <option value="none">None</option>
          </Select>
        </Row>
        <Row k="weightDecay" label="Weight decay" hint="L2 regularization">
          <input class="settings-input sv-w-sm" type="number" step="any" value={draft.weightDecay} placeholder="auto" disabled={locked} onInput={(e) => set("weightDecay", numOrEmpty(e.target.value))} />
        </Row>
        <Row k="gradientClipVal" label="Gradient clip" hint="Max gradient norm">
          <input class="settings-input sv-w-sm" type="number" step="any" value={draft.gradientClipVal} placeholder="auto" disabled={locked} onInput={(e) => set("gradientClipVal", numOrEmpty(e.target.value))} />
        </Row>
        </Group>
        <Group title="Early stopping">
        <Row k="earlyStopping" as="div" inline label="Stop early" hint="Halt when the metric stops improving">
          <Toggle on={!!draft.earlyStopping} disabled={locked} label="Early stopping" onChange={(v) => set("earlyStopping", v)} />
        </Row>
        {draft.earlyStopping && (
          <>
            <Row k="earlyStoppingMonitor" label="Monitor" hint={isDetection ? "Detection only logs mAP" : null}>
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
            <Row k="earlyStoppingPatience" label="Patience" hint="Epochs without improvement">
              <input class="settings-input sv-w-sm" type="number" min="1" value={draft.earlyStoppingPatience} placeholder="10" disabled={locked} onInput={(e) => set("earlyStoppingPatience", numOrEmpty(e.target.value))} />
            </Row>
          </>
        )}
        </Group>
      </>
    ),

    input: (
      <Group>
        <Row k="imageSize" label="Image size" hint="Input resolution in pixels">
          <input class="settings-input sv-w-sm" type="number" min="1" value={draft.imageSize} placeholder="auto" disabled={locked} onInput={(e) => set("imageSize", numOrEmpty(e.target.value))} />
        </Row>
        <Row k="augmentationPreset" as="div" label="Augmentation preset" hint="Random transforms applied while training">
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
      </Group>
    ),

    hardware: (
      <Group>
        <Row k="accelerator" label="Accelerator">
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
          <Row k="gpuDevices" label="GPU devices" hint="CUDA indices, e.g. 0 or 0,1">
            <input class="settings-input settings-input-mono sv-w-sm" type="text" value={draft.gpuDevices} placeholder="auto" disabled={locked} onInput={(e) => set("gpuDevices", e.target.value)} />
          </Row>
        )}
        <Row k="precision" label="Precision">
          <Select value={draft.precision} disabled={locked} onChange={(v) => set("precision", v)}>
            <option value="">Auto (default)</option>
            <option value="32">32-bit (float32)</option>
            <option value="16-mixed">16-mixed (AMP)</option>
            <option value="bf16-mixed">bf16-mixed</option>
          </Select>
        </Row>
        <Row k="numWorkers" label="Data-loader workers" hint="Empty uses the AutoTimm default">
          <input class="settings-input sv-w-sm" type="number" min="0" value={draft.numWorkers} placeholder="auto" disabled={locked} onInput={(e) => set("numWorkers", numOrEmpty(e.target.value))} />
        </Row>
      </Group>
    ),

    appearance: (
      <Group>
        <Row as="div" inline label="Theme" hint="Dark or light interface">
          <Seg
            label="Theme"
            value={theme.value}
            options={[{ value: "dark", label: "Dark", icon: moonIcon }, { value: "light", label: "Light", icon: sunIcon }]}
            onChange={toggleTheme}
          />
        </Row>
        <Row as="div" inline label="App tour" hint="Replay the first-run walkthrough">
          <button type="button" class="settings-action-btn" onClick={startTutorial}>Restart tour</button>
        </Row>
      </Group>
    ),

    ssh: <div class="sv-group"><SshKeysManager projectCommand={draft.connectionType === "remote" ? draft.sshCommand : ""} /></div>,

    transfer: <TransferPanel project={proj} />,

    danger: (
      <Group>
        <Row as="div" inline wide label="Delete this project" hint="Removes the project and its runs from NightFlow. Cannot be undone.">
          <button class="settings-danger-btn" disabled={locked} onClick={() => openDeleteDialog(proj.id)}>
            <span dangerouslySetInnerHTML={{ __html: trashIcon }} />
            Delete project
          </button>
        </Row>
        <ClearAllDataRow />
      </Group>
    ),
  };

  return (
    <div class="settings-view dash rd sv" style={{ "--sv-tone": tone(category.id) }}>
      <header class="sv-hero">
        <div class="sv-hero-glow" aria-hidden="true" />
        <div class="sv-hero-main">
          <span class="sv-avatar" aria-hidden="true">{(proj.name || "U").split(/[\s_-]+|(?=[A-Z][a-z])/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("")}</span>
          <div class="sv-hero-text">
            <span class="sv-eyebrow">Project settings</span>
            <h2 class="sv-hero-title">{proj.name || "Untitled project"}</h2>
            <span class="sv-hero-path" title={proj.projectPath || derivedProjectPath}>{proj.projectPath || derivedProjectPath}</span>
          </div>
        </div>
        <dl class="sv-stats">
          <div class="sv-stat" style={{ "--sv-tone": tone("general") }}>
            <dt>Task</dt>
            <dd>{proj.taskType || "Classification"}</dd>
          </div>
          <div class="sv-stat" style={{ "--sv-tone": tone("dataset") }}>
            <dt>Dataset</dt>
            <dd>{proj.datasetFormat || "—"}</dd>
          </div>
          <div class="sv-stat" style={{ "--sv-tone": tone("connection") }}>
            <dt>Compute</dt>
            <dd title={proj.sshCommand}>{proj.connectionType === "remote" ? (proj.sshCommand || "Remote").replace(/^ssh\s+/, "") : "Local"}</dd>
          </div>
          <div class="sv-stat" style={{ "--sv-tone": tone("hyperparameters") }}>
            <dt>Runs</dt>
            <dd class="sv-stat-num">{runCount}</dd>
          </div>
        </dl>
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
                  style={{ "--sv-tone": tone(c.id) }}
                  aria-current={c.id === category.id ? "page" : undefined}
                  onClick={() => openCategory(c.id)}
                >
                  <SectionIcon id={c.id} size={15} tile={false} />
                  <span class="sv-nav-text">{c.label}</span>
                  {dirtyCats.has(c.id) && (
                    <span class="sv-nav-badge" title="Unsaved changes">
                      {c.keys.filter((k) => dirtyKeys.has(k)).length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div class="sv-main">
        <section
          key={category.id}
          class={`sv-panel${category.danger ? " is-danger" : ""}`}
          style={{ "--sv-tone": tone(category.id) }}
          aria-labelledby="sv-panel-title"
        >
          <header class="sv-panel-head">
            <SectionIcon id={category.id} size={20} />
            <div class="sv-panel-title">
              <h2 id="sv-panel-title">{category.label}</h2>
              <p>{category.desc}</p>
            </div>
            {category.keys.length > 0 && (
              <div class="sv-panel-meta">
                <span class="sv-pill">{category.keys.length} settings</span>
                {dirtyCats.has(category.id) && (
                  <span class="sv-pill sv-pill--warn">
                    {category.keys.filter((k) => dirtyKeys.has(k)).length} edited
                  </span>
                )}
              </div>
            )}
          </header>
          <DirtyKeys.Provider value={dirtyKeys}>
            <div class="sv-body">{panels[category.id]}</div>
          </DirtyKeys.Provider>
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
                <span class="settings-save-hint">
                  {dirtyKeys.size} unsaved {dirtyKeys.size === 1 ? "change" : "changes"}
                  {dirtyCats.size > 0 && (
                    <span class="sv-save-cats">
                      in {[...dirtyCats].map((id) => SETTINGS_CATEGORIES.find((c) => c.id === id)?.label).join(", ")}
                    </span>
                  )}
                </span>
                <div class="settings-save-actions">
                  <button class="settings-discard-btn" onClick={handleDiscard}>
                    Discard
                  </button>
                  <button
                    class="settings-save-btn"
                    disabled={locked}
                    onClick={handleSave}
                  >
                    Save changes
                    <kbd class="sv-kbd">{isMac ? "⌘S" : "Ctrl+S"}</kbd>
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
