import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { allRuns } from "../state/experiments.js";
import {
  planFullExport,
  exportJson,
  exportFull,
  cancelTransfer,
  importIntoProject,
  canReplace,
  localPathsExist,
} from "../state/transfer.js";
import { buildManifest, describeManifest, datasetFields } from "../utils/transfer.js";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { formatBytes } from "../utils/format.js";
import { sshHost } from "../utils/sshCommand.js";
import { isTopDialog } from "./Dialog.jsx";
import { defaultProjectPath, pathPlatform, normalizeProjectPath } from "../utils/projectPaths.js";
import { platform } from "../state/dashboard.js";

// Export and import for the project whose settings are open.
// Dialog chrome reuses the .ssk-* styles (ssh-keys.css); parts specific to
// this flow are .xf-* (transfer.css).

const TONE = "#60a5fa"; // Settings → Import / export

const I = {
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="M20 6 9 17l-5-5" />,
  warn: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></>,
  feather: <><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" /><path d="M16 8 2 22M17.5 15H9" /></>,
  layers: <><path d="m12 2 10 5-10 5L2 7Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>,
  box: <><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  swap: <><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></>,
  folder: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
};

function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {I[name]}
    </svg>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "2 trained models · 2 checkpoints · 5 runs · dataset: 1,204 files" */
function describeSummary(sum) {
  if (!sum) return "";
  const parts = [plural(sum.models, "trained model"), plural(sum.checkpoints, "checkpoint"), plural(sum.runs, "run") + " with files"];
  if (sum.dataset_files) parts.push(`dataset: ${plural(sum.dataset_files, "file")} (${formatBytes(sum.dataset_bytes)})`);
  return parts.join(" · ");
}

const errText = (e) => (typeof e === "string" ? e : e?.message || "Something went wrong.");
const fileName = (p) => String(p || "").split(/[\\/]/).pop();

/** Escape closes only this dialog, unless a transfer is running. */
function useEscape(onClose, busy, ref) {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Escape") return;
      // Another dialog opened on top of this one handles its own Escape.
      if (!isTopDialog(ref.current)) return;
      e.stopPropagation();
      if (!busy) onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, busy]);
}

function Shell({ title, sub, icon, onClose, busy, children }) {
  const ref = useRef(null);
  useEscape(onClose, busy, ref);
  return createPortal(
    <div class="wizard-overlay ssk-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={ref} class="ssk-dialog xf-dialog" style={{ "--ssk-tone": TONE }} role="dialog" aria-modal="true" aria-labelledby="xf-title">
        <header class="ssk-head">
          <span class="ssk-head-icon"><Icon name={icon} size={20} /></span>
          <div class="ssk-head-text">
            <h2 id="xf-title">{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button class="ssk-icon-btn" onClick={onClose} disabled={busy} aria-label="Close"><Icon name="x" /></button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Progress({ p, label }) {
  const pct = p && p.total > 0 ? Math.min(100, (p.done / p.total) * 100) : null;
  return (
    <div class="xf-progress" role="status">
      <div class="xf-progress-top">
        <span>{label}</span>
        <span class="xf-mono">{p ? `${formatBytes(p.done)}${p.total ? ` of ${formatBytes(p.total)}` : ""}` : "Starting…"}</span>
      </div>
      <div class={`xf-bar${pct === null ? " is-indeterminate" : ""}`}>
        <div class="xf-bar-fill" style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      {p?.file && <span class="xf-progress-file xf-mono" title={p.file}>{p.file}</span>}
    </div>
  );
}

function Switch({ on, onChange, label, hint, id }) {
  return (
    <div class={`xf-toggle${on ? " is-on" : ""}`}>
      <div class="xf-toggle-text">
        <span class="ssk-label" id={`${id}-label`}>{label}</span>
        {hint && <span class="ssk-hint">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on ? "true" : "false"}
        aria-labelledby={`${id}-label`}
        class={`xf-switch${on ? " on" : ""}`}
        onClick={() => onChange(!on)}
      >
        <span class="wz-switch-thumb" />
      </button>
    </div>
  );
}

function Done({ title, path, children, onClose }) {
  return (
    <>
      <div class="ssk-body">
        <div class="ssk-created">
          <span class="ssk-created-icon"><Icon name="check" size={18} /></span>
          <span class="ssk-key-text">
            <span class="ssk-key-line"><span class="xf-strong">{title}</span></span>
            {path && <span class="ssk-key-path" title={path}>{path}</span>}
            {children}
          </span>
        </div>
      </div>
      <footer class="ssk-foot">
        <span class="ssk-foot-note" />
        {path && (
          <button class="ssk-btn" onClick={() => revealItemInDir(path).catch(() => {})}>
            <Icon name="folder" size={14} /> Show in folder
          </button>
        )}
        <button class="ssk-btn ssk-btn--primary" onClick={onClose}>Done</button>
      </footer>
    </>
  );
}

// ── Export ──

const LEVEL_INFO = {
  lite: { icon: "feather", label: "Lite", desc: "Settings only. A template to start a similar project." },
  standard: { icon: "layers", label: "Standard", desc: "Settings and every run: metrics, notes, tags and test results." },
  full: { icon: "box", label: "Full", desc: "Standard plus the run files: logs, checkpoints and exported models." },
};

const CKPT_OPTIONS = [
  { id: "best_last", label: "Best + last" },
  { id: "all", label: "All" },
  { id: "none", label: "None" },
];

export function ExportDialog({ project, onClose, onExported }) {
  const runs = useMemo(() => allRuns.value.filter((r) => r.projectId === project.id), [project.id]);
  const remote = project.connectionType === "remote";
  const [level, setLevel] = useState("standard");
  const [connTouched, setConnTouched] = useState(false);
  const [includeConn, setIncludeConn] = useState(true);
  const [ckpt, setCkpt] = useState("best_last");
  const [withData, setWithData] = useState(false);
  const [plan, setPlan] = useState(null); // null | "loading" | { … } | { error }
  const [state, setState] = useState("idle"); // idle | saving | done
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [opId] = useState(() => crypto.randomUUID());

  // Connection details default off for Lite (a template you might share), on otherwise.
  const conn = connTouched ? includeConn : level !== "lite";

  // Sizes of the JSON levels, from the manifest that would be written.
  const jsonSize = useMemo(() => {
    const size = (lvl) => new Blob([JSON.stringify(buildManifest({ level: lvl, project, runs, includeConnection: conn }))]).size;
    return { lite: size("lite"), standard: size("standard") };
  }, [project, runs, conn]);

  useEffect(() => {
    if (level !== "full" || plan) return;
    setPlan("loading");
    planFullExport(project)
      .then((p) => setPlan(p))
      .catch((e) => setPlan({ error: errText(e) }));
  }, [level]);

  const planReady = plan && plan !== "loading" && !plan.error;
  const dataFound = planReady ? plan.dataset.filter((d) => d.found) : [];
  const dataMissing = planReady ? plan.dataset.filter((d) => !d.found) : [];
  const dataBytes = dataFound.reduce((n, d) => n + d.bytes, 0);
  const dataFiles = dataFound.reduce((n, d) => n + d.files, 0);
  const fullBytes = planReady ? plan[ckpt].bytes + (withData ? dataBytes : 0) : null;
  const estimate = level === "full" ? (fullBytes === null ? null : fullBytes + jsonSize.standard) : jsonSize[level];
  const busy = state === "saving";

  async function run() {
    setError("");
    setState("saving");
    setProgress(null);
    try {
      const res = level === "full"
        ? await exportFull({ projectId: project.id, includeConnection: conn, includeDataset: withData && dataFound.length > 0, checkpoints: ckpt, opId, onProgress: setProgress })
        : await exportJson({ projectId: project.id, level, includeConnection: conn });
      if (!res) {
        setState("idle"); // Save dialog cancelled
        return;
      }
      setResult(res);
      setState("done");
      onExported?.({ ...res, level });
    } catch (e) {
      const msg = errText(e);
      setError(msg === "Cancelled" ? "Export cancelled. Nothing was saved." : msg);
      setState("idle");
    }
  }

  const sub = `${runs.length} run${runs.length === 1 ? "" : "s"} · ${remote ? `files on ${sshHost(project.sshCommand)}` : "files on this machine"}`;

  if (state === "done") {
    return (
      <Shell title={`Exported “${project.name}”`} icon="upload" onClose={onClose}>
        <Done title={`${LEVEL_INFO[level].label} export saved`} path={result.path} onClose={onClose}>
          {level === "full" && (
            <>
              <span class="ssk-key-meta">{result.files} files · {formatBytes(result.archive_bytes)} archive</span>
              <span class="ssk-key-meta">{describeSummary(result.summary)}</span>
            </>
          )}
        </Done>
      </Shell>
    );
  }

  return (
    <Shell title={`Export “${project.name}”`} sub={sub} icon="upload" onClose={onClose} busy={busy}>
      <div class="ssk-body">
        <div class="ssk-subhead"><span>What to include</span></div>
        <div class="xf-levels" role="radiogroup" aria-label="Export level">
          {["lite", "standard", "full"].map((id) => {
            const info = LEVEL_INFO[id];
            const size = id === "full" ? (fullBytes === null ? null : fullBytes + jsonSize.standard) : jsonSize[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={level === id ? "true" : "false"}
                class={`ssk-pick xf-level${level === id ? " is-on" : ""}`}
                disabled={busy}
                onClick={() => setLevel(id)}
              >
                <span class="xf-level-icon"><Icon name={info.icon} size={17} /></span>
                <span class="ssk-key-text">
                  <span class="ssk-key-line">
                    <span class="xf-strong">{info.label}</span>
                    <span class="ssk-chip">{id === "full" ? ".nightflow" : ".json"}</span>
                  </span>
                  <span class="xf-level-desc">{info.desc}</span>
                </span>
                <span class="xf-size xf-mono">
                  {size === null ? (id === "full" && plan === "loading" ? "…" : "") : `≈ ${formatBytes(size)}`}
                </span>
              </button>
            );
          })}
        </div>

        {level === "full" && (
          <div class="xf-full">
            {plan === "loading" && (
              <div class="ssk-empty"><span class="ssk-spinner" /> Measuring files{remote ? ` on ${sshHost(project.sshCommand)}` : ""}…</div>
            )}
            {plan?.error && <p class="ssk-error" role="alert">{plan.error}</p>}
            {plan && plan !== "loading" && !plan.error && (
              <>
                <div class="xf-row">
                  <span class="ssk-label">Checkpoints</span>
                  <div class="xf-seg" role="radiogroup" aria-label="Checkpoints">
                    {CKPT_OPTIONS.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={ckpt === o.id ? "true" : "false"}
                        class={`xf-seg-btn${ckpt === o.id ? " is-active" : ""}`}
                        disabled={busy}
                        onClick={() => setCkpt(o.id)}
                      >
                        {o.label}
                        <span class="xf-seg-size">{formatBytes(plan[o.id].bytes)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <span class="ssk-hint">
                  {plan[ckpt].files} files from {plan.runs_with_files.length} of {runs.length} run{runs.length === 1 ? "" : "s"}.
                  {" "}“Best” is each run's newest checkpoint other than last.ckpt.
                  {remote && " Files are downloaded from the server over SSH."}
                </span>
                <span class={`xf-found${plan.models + plan.checkpoints === 0 ? " is-empty" : ""}`}>
                  {plan.models + plan.checkpoints === 0
                    ? "No trained models or checkpoints found in this project's run folders (logs/<run>/)."
                    : `Found ${plural(plan.models, "trained model")} and ${plural(plan.checkpoints, "checkpoint")} in the run folders.`}
                </span>
                <Switch
                  id="xf-data"
                  on={withData && dataFound.length > 0}
                  onChange={setWithData}
                  label="Include dataset"
                  hint={
                    dataFound.length
                      ? `${plural(dataFiles, "file")}, ${formatBytes(dataBytes)}. Imported into the project folder, with its dataset paths updated.`
                      : "No dataset files found at this project's dataset paths."
                  }
                />
                {dataMissing.length > 0 && (
                  <span class="xf-found is-empty">
                    Not found{remote ? " on the server" : ""}: {dataMissing.map((d) => d.key).join(", ")}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        <Switch
          id="xf-conn"
          on={conn}
          onChange={(v) => { setConnTouched(true); setIncludeConn(v); }}
          label="Include connection details"
          hint={
            conn
              ? "Keeps the SSH command (host, user, key path) and the project and dataset paths."
              : "Leaves out the SSH command and absolute paths; you'll fill them in when importing."
          }
        />

        {busy && level === "full" && <Progress p={progress} label={remote ? "Downloading and packing" : "Packing"} />}
        {error && <p class="ssk-error" role="alert">{error}</p>}
      </div>
      <footer class="ssk-foot">
        <span class="ssk-foot-note">{estimate !== null ? `About ${formatBytes(estimate)}` : ""}</span>
        {busy && level === "full" ? (
          <button class="ssk-btn" onClick={() => cancelTransfer(opId)}>Cancel export</button>
        ) : (
          <button class="ssk-btn" onClick={onClose} disabled={busy}>Cancel</button>
        )}
        <button
          class="ssk-btn ssk-btn--primary"
          onClick={run}
          disabled={busy || (level === "full" && (plan === "loading" || !!plan?.error))}
        >
          {busy ? <><span class="ssk-spinner" /> Exporting…</> : "Export…"}
        </button>
      </footer>
    </Shell>
  );
}

// ── Import ──

const LEVEL_LABEL = { lite: "Lite", standard: "Standard", full: "Full" };
const FIELD_LABEL = {
  sshCommand: "SSH command",
  projectPath: "project folder",
  folderPath: "dataset folder",
  trainPath: "train file",
  valPath: "validation file",
  testPath: "test file",
  imageFolderPath: "image folder",
};

/**
 * file: result of chooseImportFile(). project: the project whose settings
 * are open (the one "Replace" applies to), or null from the start screen,
 * where the only option is a new project.
 */
export function ImportDialog({ file, project, onClose, onImported }) {
  const m = file.manifest;
  const src = m.project;
  const isArchive = file.kind === "archive";
  const stripped = new Set(m.strippedFields);
  const srcRemote = src.connectionType === "remote";
  const replaceCheck = project ? canReplace(project.id) : { ok: false };
  const currentRuns = project ? allRuns.value.filter((r) => r.projectId === project.id).length : 0;

  const [mode, setMode] = useState("new");
  const replacing = mode === "replace";

  // A Full import puts the files on this machine, so the project runs locally.
  const runsLocally = isArchive && srcRemote;
  const needsSsh = !runsLocally && srcRemote && (stripped.has("sshCommand") || !src.sshCommand);
  // Path style of the imported project's folder: remote folders are "~/…".
  const folderPlatform = pathPlatform(runsLocally ? "localhost" : src.connectionType, platform.value);

  const suggestedFolder = () => {
    if (replacing) return project?.projectPath || src.projectPath || defaultProjectPath(src.name, folderPlatform);
    if (!isArchive && src.projectPath && !stripped.has("projectPath")) return src.projectPath;
    return defaultProjectPath(src.name, folderPlatform);
  };
  const [folder, setFolder] = useState(suggestedFolder);
  const [folderTouched, setFolderTouched] = useState(false);
  const [ssh, setSsh] = useState(() => (project?.connectionType === "remote" ? project.sshCommand : "") || "");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [state, setState] = useState("idle"); // idle | importing | done
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [opId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!folderTouched) setFolder(suggestedFolder());
    setConfirmReplace(false);
  }, [mode]);

  // Dataset: bundled in the archive, or paths to confirm on this machine.
  const bundled = isArchive && (m.archive?.dataset?.length || 0) > 0;
  const targetLocal = runsLocally || !srcRemote;
  const fields = bundled ? [] : datasetFields(src.datasetFormat).filter((f) => src[f] || stripped.has(f) || (replacing && project?.[f]));
  const initialPaths = () =>
    Object.fromEntries(fields.map((f) => [f, (!stripped.has(f) && src[f]) || (replacing && project?.[f]) || ""]));
  const [dataPaths, setDataPaths] = useState(initialPaths);
  const [exists, setExists] = useState({});
  useEffect(() => {
    setDataPaths(initialPaths());
  }, [mode]);
  // Check the paths on this machine (not for a project that stays remote).
  useEffect(() => {
    if (!targetLocal) return;
    const entries = Object.entries(dataPaths).filter(([, v]) => v.trim());
    let live = true;
    const t = setTimeout(() => {
      localPathsExist(entries.map(([, v]) => v)).then((res) => {
        if (live) setExists(Object.fromEntries(entries.map(([k], i) => [k, res[i]])));
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [JSON.stringify(dataPaths), targetLocal]);

  async function browse(field) {
    const isDir = field === "folderPath" || field === "imageFolderPath";
    const picked = await openDialog({ directory: isDir, multiple: false, title: `Choose the ${FIELD_LABEL[field]}` }).catch(() => null);
    if (picked) setDataPaths((d) => ({ ...d, [field]: isDir ? normalizeProjectPath(picked, platform.value) : picked }));
  }

  const busy = state === "importing";
  const ready =
    folder.trim() !== "" &&
    (!needsSsh || /^ssh\s+\S/.test(ssh.trim())) &&
    (!replacing || (replaceCheck.ok && confirmReplace));

  async function run() {
    setError("");
    setState("importing");
    setProgress(null);
    const overrides = { projectPath: normalizeProjectPath(folder, folderPlatform) };
    if (runsLocally) Object.assign(overrides, { connectionType: "localhost", sshCommand: "localhost" });
    else if (needsSsh) overrides.sshCommand = ssh.trim();
    // Dataset paths as confirmed here (a bundled dataset is re-pointed on import).
    for (const [k, v] of Object.entries(dataPaths)) overrides[k] = v.trim();
    try {
      const id = await importIntoProject(file, { mode, projectId: project?.id, overrides, opId, onProgress: setProgress });
      setState("done");
      onImported?.(id);
    } catch (e) {
      const msg = errText(e);
      setError(msg === "Cancelled" ? "Import cancelled. Nothing was added; files already copied were left in place." : msg);
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <Shell title="Import complete" icon="download" onClose={onClose}>
        <Done title={replacing ? `Replaced “${project?.name}”` : "Project created"} onClose={onClose}>
          <span class="ssk-key-meta">{describeManifest(m)}{isArchive ? ` · files in ${folder}` : ""}</span>
        </Done>
      </Shell>
    );
  }

  return (
    <Shell title={`Import “${fileName(file.path)}”`} sub={`${formatBytes(file.bytes)} · ${m.createdAt ? `exported ${new Date(m.createdAt).toLocaleString()}` : "older export format"}`} icon="download" onClose={onClose} busy={busy}>
      <div class="ssk-body">
        <div class="xf-summary">
          <span class="xf-level-icon"><Icon name={m.level === "full" ? "box" : m.level === "lite" ? "feather" : "layers"} size={18} /></span>
          <span class="ssk-key-text">
            <span class="ssk-key-line">
              <span class="xf-strong">{src.name}</span>
              <span class="ssk-chip ssk-chip--tone">{LEVEL_LABEL[m.level]}</span>
              <span class="ssk-chip">{src.taskType}</span>
            </span>
            <span class="ssk-key-meta">
              {m.level === "lite" ? "Settings only" : `${m.runs.length} run${m.runs.length === 1 ? "" : "s"}`}
              {m.archive && ` · ${m.archive.files} files (${formatBytes(m.archive.bytes)})`}
              {srcRemote ? ` · remote project` : " · local project"}
            </span>
            {m.archive?.summary && <span class="ssk-key-meta">{describeSummary(m.archive.summary)}</span>}
            {!m.includesConnection && (
              <span class="xf-note"><Icon name="lock" size={12} /> Exported without connection details</span>
            )}
          </span>
        </div>

        {project && (
          <>
        <div class="ssk-subhead"><span>Import as</span></div>
        <div class="xf-modes" role="radiogroup" aria-label="Import as">
          <button type="button" role="radio" aria-checked={!replacing ? "true" : "false"} class={`ssk-pick xf-mode${!replacing ? " is-on" : ""}`} disabled={busy} onClick={() => setMode("new")}>
            <span class="xf-level-icon"><Icon name="plus" size={17} /></span>
            <span class="ssk-key-text">
              <span class="xf-strong">New project</span>
              <span class="xf-level-desc">Adds it next to your other projects. Nothing existing changes.</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={replacing ? "true" : "false"}
            class={`ssk-pick xf-mode xf-mode--replace${replacing ? " is-on" : ""}`}
            disabled={busy || !replaceCheck.ok}
            title={replaceCheck.ok ? "" : replaceCheck.reason}
            onClick={() => setMode("replace")}
          >
            <span class="xf-level-icon"><Icon name="swap" size={17} /></span>
            <span class="ssk-key-text">
              <span class="xf-strong">Replace “{project.name}”</span>
              <span class="xf-level-desc">
                {replaceCheck.ok ? "Swaps this project's settings and run history for the file's." : replaceCheck.reason}
              </span>
            </span>
          </button>
        </div>
          </>
        )}

        <div class="ssk-form xf-form">
          <label class="ssk-field">
            <span class="ssk-label">Project folder</span>
            <span class="ssk-input-wrap">
              <input class="ssk-input" type="text" value={folder} spellcheck={false} disabled={busy} onInput={(e) => { setFolder(e.target.value); setFolderTouched(true); }} />
            </span>
            <span class="ssk-hint">
              {isArchive
                ? `The run files are unpacked here (${formatBytes(m.archive?.bytes ?? 0)}). Existing files with the same names are overwritten.`
                : "Where this project keeps its logs, checkpoints and exports."}
            </span>
          </label>
          {needsSsh && (
            <label class="ssk-field">
              <span class="ssk-label">SSH command</span>
              <span class="ssk-input-wrap">
                <input class="ssk-input" type="text" value={ssh} placeholder="ssh user@gpu-server" spellcheck={false} disabled={busy} onInput={(e) => setSsh(e.target.value)} />
              </span>
              <span class="ssk-hint">The export didn't include how to reach the server.</span>
            </label>
          )}
        </div>

        {runsLocally && (
          <p class="ssk-help ssk-help--note">
            <Icon name="warn" size={13} /> This was a remote project. Its files come to this machine, so the imported project
            runs locally. Switch it back to Remote in Settings → Connection if you need to.
          </p>
        )}
        {bundled ? (
          <div class="xf-dataset-note">
            <Icon name="folder" size={15} />
            <span>
              <strong>Dataset included</strong> ({plural(m.archive.summary?.dataset_files || 0, "file")}). It goes into{" "}
              <code>{normalizeProjectPath(folder || "…", folderPlatform)}dataset/</code> and the project's dataset paths are updated.
            </span>
          </div>
        ) : (
          fields.length > 0 && (
            <div class="xf-dataset">
              <div class="ssk-subhead">
                <span>Dataset{targetLocal ? " on this machine" : " on the server"}</span>
              </div>
              {fields.map((f) => {
                const v = dataPaths[f] || "";
                const state = !targetLocal || !v.trim() ? null : exists[f];
                return (
                  <label key={f} class="ssk-field">
                    <span class="ssk-label">
                      {FIELD_LABEL[f][0].toUpperCase() + FIELD_LABEL[f].slice(1)}
                      {state === true && <span class="xf-path-ok"><Icon name="check" size={12} /> Found</span>}
                      {state === false && <span class="xf-path-missing"><Icon name="warn" size={12} /> Not found here</span>}
                    </span>
                    <span class="xf-path-row">
                      <span class="ssk-input-wrap">
                        <input
                          class="ssk-input"
                          type="text"
                          value={v}
                          spellcheck={false}
                          disabled={busy}
                          placeholder={stripped.has(f) ? "Not included in the export" : ""}
                          onInput={(e) => setDataPaths((d) => ({ ...d, [f]: e.target.value }))}
                        />
                      </span>
                      {targetLocal && (
                        <button type="button" class="ssk-btn" onClick={() => browse(f)} disabled={busy}>Browse…</button>
                      )}
                    </span>
                  </label>
                );
              })}
              <span class="ssk-hint">
                {targetLocal
                  ? "Paths from another machine often differ. Point these at where the dataset is here, or change them later in Settings → Dataset."
                  : "Paths on the training server. You can change them later in Settings → Dataset."}
              </span>
            </div>
          )
        )}

        {replacing && (
          <label class="xf-confirm">
            <input type="checkbox" checked={confirmReplace} disabled={busy} onChange={(e) => setConfirmReplace(e.target.checked)} />
            <span>
              Replace “{project.name}”'s settings and its {currentRuns} run record{currentRuns === 1 ? "" : "s"}.
              Files in the project folder aren't deleted.
            </span>
          </label>
        )}

        {busy && isArchive && <Progress p={progress} label="Unpacking files" />}
        {error && <p class="ssk-error" role="alert">{error}</p>}
      </div>
      <footer class="ssk-foot">
        <span class="ssk-foot-note">{m.legacy ? "Older export format: imported as-is." : ""}</span>
        {busy && isArchive ? (
          <button class="ssk-btn" onClick={() => cancelTransfer(opId)}>Cancel import</button>
        ) : (
          <button class="ssk-btn" onClick={onClose} disabled={busy}>Cancel</button>
        )}
        <button class={`ssk-btn ssk-btn--primary${replacing ? " xf-btn-danger" : ""}`} onClick={run} disabled={busy || !ready}>
          {busy ? <><span class="ssk-spinner" /> Importing…</> : replacing ? "Replace project" : "Create project"}
        </button>
      </footer>
    </Shell>
  );
}
