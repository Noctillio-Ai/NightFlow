import { useEffect } from "preact/hooks";
import {
  sshInfo,
  sshConnecting,
  toggleSshConnection,
  lastSyncedAt,
  resyncReason,
  stats,
} from "../../state/dashboard.js";
import { currentProject } from "../../state/projects.js";
import { resolveBackboneName } from "../../state/experiments.js";
import { navigate } from "../../state/router.js";
import { formatPercent, formatRelativeTime } from "../../utils/format.js";
import { baseName } from "../../utils/runCurves.js";
import {
  ArrowRightIcon,
  ChartBarsIcon,
  CubeIcon,
  DatabaseIcon,
  LayersIcon,
  SlidersIcon,
  TerminalIcon,
} from "./icons.jsx";

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

function Step({ n, title, detail }) {
  return (
    <li class="dash-connect-step">
      <span class="dash-connect-step-n" aria-hidden="true">{n}</span>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </li>
  );
}

function Fact({ icon, label, value, sub, title }) {
  return (
    <div class="dash-connect-fact" title={title}>
      <span class="dash-connect-fact-icon">{icon}</span>
      <div>
        <span class="dash-connect-fact-label">{label}</span>
        <strong>{value}</strong>
        {sub && <span class="dash-connect-fact-sub">{sub}</span>}
      </div>
    </div>
  );
}

/** Disconnected dashboard: what we'll connect to, what happens next, and the project at a glance. */
export function ConnectCard() {
  const project = currentProject.value;
  const host = sshInfo.value?.host || "localhost";
  const remote = project?.connectionType === "remote";
  const connecting = sshConnecting.value;
  const syncedAt = lastSyncedAt.value;
  const s = stats.value;

  // ⌘/Ctrl+Enter connects, mirroring the shortcut that starts training once connected.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !sshConnecting.value) {
        e.preventDefault();
        toggleSshConnection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!project) return null;

  const dataset = project.folderPath || project.trainPath;
  const syncDetail =
    resyncReason.value === "settings"
      ? "Your settings changed, so NightFlow syncs again right after connecting."
      : remote
        ? "Checks the remote environment and dataset each time you connect."
        : syncedAt
          ? `Synced ${formatRelativeTime(syncedAt)}, so you'll go straight to the dashboard.`
          : "Builds a Python 3.12 environment with AutoTimm and validates your dataset. The first sync takes a few minutes.";
  const trainDetail = s.totalRuns
    ? `${s.totalRuns} ${s.totalRuns === 1 ? "run" : "runs"} so far${s.bestAcc != null ? ` · best validation accuracy ${formatPercent(s.bestAcc)}` : ""}.`
    : "Launch your first run with the project's model and hyperparameters.";

  return (
    <section class="dashboard-connect-card dash-connect" aria-labelledby="dash-connect-title">
      <div class="dash-connect-main">
        <div class="dash-connect-head">
          <span class="dash-connect-symbol" aria-hidden="true"><TerminalIcon size={22} /></span>
          <div>
            <span class="dash-connect-eyebrow"><span class="dash-dot dash-dot--idle" /> Not connected</span>
            <h3 id="dash-connect-title">
              Connect to <code>{host}</code>
            </h3>
          </div>
        </div>
        <p class="dash-connect-desc">
          {remote
            ? "NightFlow opens an SSH session to your machine, prepares the training environment, and checks your dataset before you train."
            : "NightFlow uses this computer to prepare the training environment, check your dataset, and run training."}
        </p>

        <div class="dash-connect-actions">
          <button class="dash-btn dash-btn--primary dash-btn--lg" onClick={toggleSshConnection} disabled={connecting}>
            {connecting ? (
              <><span class="dash-eval-spinner dash-connect-spinner" aria-hidden="true" /> Connecting…</>
            ) : (
              <>Connect workspace <ArrowRightIcon size={16} /></>
            )}
            {!connecting && <kbd class="dash-kbd">{isMac ? "⌘" : "Ctrl"}↵</kbd>}
          </button>
          <button class="dash-btn dash-btn--quiet" onClick={() => navigate("settings")}>
            <SlidersIcon size={15} /> Edit connection
          </button>
        </div>

        <div class="dash-connect-next">
          <span class="dash-connect-label">What happens next</span>
          <ol>
            <Step n={1} title="Connect" detail={remote ? `Opens an SSH session to ${host}.` : "Opens a local session on this computer."} />
            <Step n={2} title="Sync" detail={syncDetail} />
            <Step n={3} title="Train" detail={trainDetail} />
          </ol>
        </div>
      </div>

      <aside class="dash-connect-side" aria-label="Project summary">
        <span class="dash-connect-label">This project</span>
        <Fact icon={<TerminalIcon size={16} />} label="Connection" value={remote ? "SSH" : "Local"} sub={remote ? host : "This computer"} />
        <Fact
          icon={<DatabaseIcon size={16} />}
          label="Dataset"
          value={baseName(dataset) || "Not set"}
          sub={project.datasetFormat ? `${project.datasetFormat} dataset` : null}
          title={dataset}
        />
        <Fact icon={<LayersIcon size={16} />} label="Task" value={project.taskType || "Classification"} />
        <Fact icon={<CubeIcon size={16} />} label="Model" value={resolveBackboneName(project)} sub={project.modelCategory ? `${project.modelCategory} tier` : null} />
        <Fact
          icon={<ChartBarsIcon size={16} />}
          label="Runs"
          value={s.totalRuns ? `${s.totalRuns} ${s.totalRuns === 1 ? "run" : "runs"}` : "None yet"}
          sub={s.bestAcc != null ? `Best val ${formatPercent(s.bestAcc)}` : null}
        />
      </aside>
    </section>
  );
}
