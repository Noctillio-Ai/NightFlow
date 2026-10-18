import { useEffect, useRef, useState } from "preact/hooks";
import {
  dashboardSyncing,
  syncDashboard,
  stopSync,
  syncProgress,
  syncShowingCompletion,
  syncLogs,
  syncStartedAt,
  resyncReason,
  sshInfo,
  sshConnecting,
  toggleSshConnection,
} from "../../state/dashboard.js";
import { currentProject } from "../../state/projects.js";
import { buildSyncSteps, formatElapsed, SYNC_STAGES } from "../../utils/syncStages.js";
import { Dot } from "./Card.jsx";
import { AlertIcon, CheckIcon, CopyIcon, LockIcon, RefreshIcon, XIcon } from "./icons.jsx";

/** What each stage does, shown while it runs. */
function stageAbout(key, remote) {
  switch (key) {
    case "workspace":
      return remote
        ? "Connecting over SSH, creating the project folder on the remote machine, and making sure uv is installed to manage Python."
        : "Creating the project folder on this computer and making sure uv is installed to manage Python.";
    case "python":
      return "Building an isolated Python 3.12 environment (.venv) with uv and installing the latest AutoTimm. The first sync downloads packages and can take a few minutes; later syncs reuse the environment and only reinstall AutoTimm.";
    case "dataset":
      return "Checking that every dataset path exists and that the folder layout matches the format you chose.";
    case "runs":
      return "Importing runs and metrics from the project's logs folder, including test results.";
    default:
      return "";
  }
}

const IDLE_DETAIL = {
  workspace: "Project folder and uv",
  python: "Python 3.12 environment with AutoTimm",
  dataset: "Dataset paths and folder layout",
  runs: "Runs and metrics already on disk",
};

function StepMarker({ state, n }) {
  if (state === "done") return <span class="dash-sync-marker dash-sync-marker--done"><CheckIcon size={14} stroke-width="2.6" /></span>;
  if (state === "warn") return <span class="dash-sync-marker dash-sync-marker--warn"><AlertIcon size={13} stroke-width="2.4" /></span>;
  if (state === "error") return <span class="dash-sync-marker dash-sync-marker--error"><XIcon size={13} stroke-width="2.6" /></span>;
  if (state === "active") return <span class="dash-sync-marker dash-sync-marker--active"><span /></span>;
  return <span class="dash-sync-marker">{n}</span>;
}

/** Re-render every second while `on`. */
function useTicker(on) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => setT((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [on]);
}

function LogView({ logs }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logs.map((l) => `[${l.timestamp}] ${l.message}`).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div class="dash-sync-log">
      <div class="dash-sync-log-head">
        <span>Sync log</span>
        {logs.length > 0 && (
          <button class="dash-sync-log-copy" onClick={copy} title="Copy the full log">
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />} {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      <div class="dash-sync-log-body" ref={ref} role="log" aria-live="polite">
        {logs.length === 0 ? (
          <span class="dash-sync-log-empty">Messages appear here once the sync starts.</span>
        ) : (
          logs.map((l, i) => (
            <div key={i} class={`dash-sync-log-line dash-sync-log-line--${l.type}`}>
              <span class="dash-sync-log-time">{l.timestamp}</span>
              <span class="dash-sync-log-msg">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Connected-but-not-synced dashboard: the four sync stages with live progress,
 * what the current stage is doing, and the full sync log.
 */
export function SyncPanel() {
  const project = currentProject.value;
  const remote = project?.connectionType === "remote";
  const host = sshInfo.value?.host || "localhost";
  const syncing = dashboardSyncing.value;
  const complete = syncShowingCompletion.value;
  const logs = syncLogs.value;
  const progress = syncProgress.value;
  const startedAt = syncStartedAt.value;
  const settingsChanged = resyncReason.value === "settings";
  const migratingToUv = resyncReason.value === "uv-migration";
  useTicker(syncing);

  // Saved settings (or the move from conda to uv) invalidated the last sync:
  // start it without waiting for a click. Runs once per mount, so a failed
  // sync falls back to the button.
  useEffect(() => {
    if (resyncReason.value && !dashboardSyncing.value) syncDashboard();
  }, []);

  const lastMessage = logs[logs.length - 1]?.message || "";
  const phase = complete ? "complete" : syncing ? "syncing" : /^Sync failed/.test(lastMessage) ? "failed" : "idle";
  // Logs restored from an earlier sync don't describe this one.
  const live = phase !== "idle";
  const steps = buildSyncSteps(live ? logs : [], phase);
  const currentIdx = steps.findIndex((s) => s.state === "active" || (phase === "failed" && s.state === "error"));
  const current = currentIdx >= 0 ? steps[currentIdx] : null;
  const pct = phase === "complete" ? 100 : Math.round(progress);

  const title =
    phase === "complete" ? "Sync complete"
      : phase === "syncing" ? "Syncing project data"
        : phase === "failed" ? "Sync failed"
          : settingsChanged ? "Settings changed" : migratingToUv ? "Switching to uv" : "Sync project data";
  const subtitle =
    phase === "syncing" ? (current ? `Step ${currentIdx + 1} of ${SYNC_STAGES.length} · ${current.title}` : "Starting…")
      : phase === "complete" ? "Everything is ready. Opening the dashboard…"
        : phase === "failed" ? (current ? `Stopped at step ${currentIdx + 1} · ${current.title}` : "The sync stopped before finishing.")
          : settingsChanged
            ? "Your settings changed since the last sync, so the checks below need to run again."
            : migratingToUv
              ? "This project's Python environment was built with conda. Syncing replaces it with a faster uv environment; the first sync downloads packages again."
              : "Prepare the training environment, check the dataset, and import existing runs.";

  return (
    <div class="dash-sync">
      <div class="dash-sync-conn">
        <span class="dash-sync-conn-ok"><CheckIcon size={13} stroke-width="2.8" /></span>
        <span>
          Connected to <code>{host}</code>
          <span class="dash-muted"> · {remote ? "remote workspace" : "local workspace"}</span>
        </span>
        <button class="dash-btn dash-btn--quiet dash-btn--sm dash-sync-conn-btn" onClick={toggleSshConnection} disabled={sshConnecting.value}>
          Disconnect
        </button>
      </div>

      <section class={`dashboard-sync-card dash-sync-card dash-sync--${phase}`} aria-labelledby="dash-sync-title">
        <div class="dash-sync-main">
          <div class="dash-sync-head">
            <span class="dash-sync-icon" aria-hidden="true">
              {phase === "complete" ? <CheckIcon size={24} stroke-width="2.2" /> : phase === "failed" ? <AlertIcon size={22} /> : (
                <span class={syncing ? "dash-spin" : undefined}><RefreshIcon size={24} /></span>
              )}
            </span>
          </div>

          <div class="dash-sync-titlebar">
            <h3 id="dash-sync-title">{title}</h3>
            {live && <span class="dash-sync-pct">{pct}%</span>}
          </div>
          {live && (
            <div class="dash-bar dash-sync-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div class="dash-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div class="dash-sync-sub">
            <span>{subtitle}</span>
            {phase === "syncing" && startedAt && <span class="dash-muted">Elapsed {formatElapsed(Date.now() - startedAt)}</span>}
          </div>

          <ol class="dash-sync-steps">
            {steps.map((s, i) => (
              <li key={s.key} class={`dash-sync-step dash-sync-step--${s.state}`}>
                <StepMarker state={s.state} n={i + 1} />
                <div>
                  <strong>{s.title}</strong>
                  <span>
                    {s.state === "pending" ? (live ? "Waiting to start" : IDLE_DETAIL[s.key]) : s.detail || IDLE_DETAIL[s.key]}
                  </span>
                </div>
              </li>
            ))}
          </ol>

          <div class="dash-sync-actions">
            {phase === "syncing" ? (
              <button class="dash-btn dash-btn--outline" onClick={() => stopSync()}>Cancel sync</button>
            ) : phase !== "complete" ? (
              <button class="dash-btn dash-btn--primary dash-btn--lg" onClick={syncDashboard}>
                <RefreshIcon size={16} /> {phase === "failed" ? "Retry sync" : "Start sync"}
              </button>
            ) : null}
          </div>
        </div>

        <aside class="dash-sync-side">
          <div class="dash-sync-side-head">
            <h4>{live ? "What's happening" : "What sync does"}</h4>
            <span>{live ? "Live updates from the sync." : "Run it once per project, and again after changing settings."}</span>
          </div>

          <div class="dash-sync-now">
            <Dot state={phase === "failed" ? "err" : phase === "complete" ? "ok" : phase === "syncing" ? "live" : "idle"} />
            <div>
              <strong>{current ? current.title : phase === "complete" ? "All steps finished" : "Ready to sync"}</strong>
              <p>
                {current
                  ? stageAbout(current.key, remote)
                  : phase === "complete"
                    ? "The workspace, Python environment and dataset are ready for training."
                    : "Sync prepares the Python environment, checks your dataset, and imports runs already in the project folder."}
              </p>
            </div>
          </div>

          <LogView logs={live ? logs : []} />

          <div class="dash-sync-note">
            <span class="dash-sync-note-icon"><LockIcon size={16} /></span>
            <div>
              <strong>Your dataset is only read</strong>
              <p>Sync creates the project folder and a Python environment inside it. Dataset files are never modified, moved or deleted.</p>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
