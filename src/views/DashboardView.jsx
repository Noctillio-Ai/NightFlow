import { useState, useEffect } from "preact/hooks";
import { TrainingPanel } from "../components/TrainingPanel.jsx";
import { Card, Dot } from "../components/dashboard/Card.jsx";
import { ProjectHero } from "../components/dashboard/ProjectHero.jsx";
import { WorkspaceBanner } from "../components/dashboard/WorkspaceBanner.jsx";
import { ResultsCard } from "../components/dashboard/ResultsCard.jsx";
import { RecentRunsCard } from "../components/dashboard/RecentRunsCard.jsx";
import { MachineHealth } from "../components/dashboard/MachineHealth.jsx";
import { MetricChart } from "../components/dashboard/MetricChart.jsx";
import { ConnectCard } from "../components/dashboard/ConnectCard.jsx";
import { SyncPanel } from "../components/dashboard/SyncPanel.jsx";
import {
  CheckCircleIcon,
  CropIcon,
  CubeIcon,
  DatabaseIcon,
  FlaskIcon,
  PlayIcon,
  SlidersIcon,
  TerminalIcon,
} from "../components/dashboard/icons.jsx";
import { useSystemMetrics } from "../hooks/useSystemMetrics.js";
import {
  stats,
  sshConnected,
  sshConnectionError,
  clearSshConnectionError,
  dashboardSynced,
  dashboardSyncing,
  syncShowingCompletion,
  datasetPathStatus,
  datasetValidation,
  envInfo,
  syncConfig,
  platform,
} from "../state/dashboard.js";
import { currentProject } from "../state/projects.js";
import { navigate } from "../state/router.js";
import { getTrainingReadiness } from "../utils/trainingReadiness.js";
import {
  startTraining,
  trainingActive,
  trainingEpoch,
  trainingMaxEpochs,
  trainingProgress,
  trainingLossCurve,
  trainingAccCurve,
} from "../state/training.js";
import { projectRuns, resolveBackboneName } from "../state/experiments.js";
import { addToQueue, projectQueue, removeFromQueue, queueLength } from "../state/queue.js";
import { useEscape } from "../hooks/useEscape.js";
import { runSeries, baseName } from "../utils/runCurves.js";

function SshErrorModal() {
  const error = sshConnectionError.value;
  useEscape(!!error, clearSshConnectionError);
  if (!error) return null;

  return (
    <div class="modal-overlay" onClick={() => clearSshConnectionError()}>
      <div
        class="modal-dialog ssh-error-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h3 class="modal-title">SSH Connection Failed</h3>
          <button
            class="modal-close-btn"
            onClick={() => clearSshConnectionError()}
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="ssh-error-icon">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p class="ssh-error-message">{error.message}</p>
          {error.message && (
            <p class="ssh-error-hint">
              {/timed?\s*out|timeout/i.test(error.message)
                ? "Check that the host is reachable and the SSH port (default 22) is open."
                : /refused/i.test(error.message)
                  ? "The remote machine actively refused the connection. Verify sshd is running."
                  : /permission|auth|denied|publickey/i.test(error.message)
                    ? "Authentication failed. Check your SSH key or credentials in the project settings."
                    : /resolve|unknown host|no such host/i.test(error.message)
                      ? "Could not resolve the hostname. Verify the address in project settings."
                      : "Check the SSH command in project settings and ensure the remote machine is accessible."}
            </p>
          )}
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-primary"
            onClick={() => clearSshConnectionError()}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// steps: "fit+test" (default), "fit", or "test"
function buildStepsCommand(project, steps = "fit+test") {
  const env = envInfo.value;
  const useVenv = env && (env.status === "exists" || env.status === "created");
  const isConda = useVenv && env.envType === "conda";
  const isWindows = project.connectionType !== "remote" && platform.value === "windows";
  const sep = isWindows ? "\\" : "/";
  const pp = (project.projectPath.endsWith("/") || project.projectPath.endsWith("\\"))
    ? project.projectPath.slice(0, -1)
    : project.projectPath;

  const cfg = `${pp}${sep}config.yaml`;

  if (isConda) {
    return `__STEPS_JSON__:${JSON.stringify({ mode: "conda", env_path: `${pp}${sep}.venv`, config_path: cfg, steps })}`;
  } else {
    const venvPython = isWindows
      ? `${pp}\\.venv\\Scripts\\python.exe`
      : `${pp}/.venv/bin/python`;
    const python = useVenv ? venvPython : (isWindows ? "python" : "python3");
    return `__STEPS_JSON__:${JSON.stringify({ mode: "direct", env_path: python, config_path: cfg, steps })}`;
  }
}

function buildTrainingCommand(project) {
  return buildStepsCommand(project, "fit+test");
}

function buildTestCommand(project) {
  return buildStepsCommand(project, "test");
}

// Human-readable version shown in the dashboard's command preview.
function buildCommandDisplay(project, steps = "fit+test") {
  const env = envInfo.value;
  const useVenv = env && (env.status === "exists" || env.status === "created");
  const isConda = useVenv && env.envType === "conda";
  const isWindows = project.connectionType !== "remote" && platform.value === "windows";
  const sep = isWindows ? "\\" : "/";
  const pp = (project.projectPath.endsWith("/") || project.projectPath.endsWith("\\"))
    ? project.projectPath.slice(0, -1)
    : project.projectPath;

  const cfg = `${pp}${sep}config.yaml`;

  const cmds = [];
  if (isConda) {
    const run = `conda run --live-stream -p ${pp}${sep}.venv python -m autotimm`;
    if (steps.includes("fit"))  cmds.push(`${run} fit  --config ${cfg}`);
    if (steps.includes("test")) cmds.push(`${run} test --config ${cfg}`);
  } else {
    const venvPy = isWindows
      ? `${pp}\\.venv\\Scripts\\python.exe`
      : `${pp}/.venv/bin/python`;
    const py = useVenv ? venvPy : (isWindows ? "python" : "python3");
    if (steps.includes("fit"))  cmds.push(`${py} -m autotimm fit  --config ${cfg}`);
    if (steps.includes("test")) cmds.push(`${py} -m autotimm test --config ${cfg}`);
  }
  return cmds.join(" &&\n");
}

const modKey = typeof navigator !== "undefined" && navigator.platform.includes("Mac") ? "\u2318" : "Ctrl";

const ACCELERATORS = { cuda: "CUDA", mps: "Apple Metal", cpu: "CPU", auto: "Auto device" };

function deviceLabel(project) {
  const accel = project.accelerator || (project.gpuDevices?.trim() ? "cuda" : "auto");
  const ids = project.gpuDevices?.trim();
  if (accel === "cuda" && ids) return `CUDA · GPU${ids.includes(",") ? "s" : ""} ${ids}`;
  return ACCELERATORS[accel] || accel;
}

function readinessState(readiness, active) {
  if (active) return "live";
  return readiness.blocked ? "err" : "ok";
}

/** The newest run that has any per-epoch history to chart. */
function latestChartableRun(runs) {
  return [...runs]
    .sort((a, b) => new Date(b.created) - new Date(a.created))
    .map((run) => ({ run, series: runSeries(run) }))
    .find(({ series }) => series.trainLoss.length || series.valLoss.length || series.valAcc.length);
}

function ConfigTile({ icon, label, value, hint }) {
  return (
    <div class="dash-config">
      <span class="dash-config-icon">{icon}</span>
      <div class="dash-config-body">
        <span class="dash-config-label">{label}</span>
        <span class="dash-config-value" title={typeof value === "string" ? value : undefined}>
          {value}
          {hint && <small>{hint}</small>}
        </span>
      </div>
    </div>
  );
}

function ExperimentCard() {
  const project = currentProject.value;
  const active = trainingActive.value;
  const [tab, setTab] = useState("loss");
  if (!project) return null;

  const command = buildTrainingCommand(project);
  const testCommand = buildTestCommand(project);
  const commandDisplay = buildCommandDisplay(project);
  const testCommandDisplay = buildCommandDisplay(project, "test");
  const validation = datasetValidation.value;
  const env = envInfo.value;
  const readiness = getTrainingReadiness({ project, validation, pathStatus: datasetPathStatus.value, environment: env, active });

  const handleTrainClick = async () => {
    const runId = crypto.randomUUID();
    try {
      await syncConfig(project, project.id, runId);
      await startTraining(command, project.projectPath, runId, { projectId: project.id });
    } catch (error) { alert(`Could not start training: ${error.message || error}`); }
  };

  // Ctrl/Cmd+Enter starts training, as advertised in the shortcuts modal. It
  // lives here so it inherits the button's own guards rather than duplicating
  // them: this only mounts on a synced dashboard with a project selected.
  useEffect(() => {
    if (readiness.blocked) return;
    function onKey(e) {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      handleTrainClick();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readiness.blocked, project?.id, command]);

  const handleTestClick = async () => {
    // Find the latest completed run to use its checkpoint
    const completed = projectRuns.value
      .filter((r) => r.status === "completed")
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    const latestRun = completed[0];
    if (!latestRun) return;

    // Evaluate under the completed run's ID: config.yaml points AutoTimm at its
    // checkpoint, and the test results are saved onto that run.
    try {
      await syncConfig(project, project.id, latestRun.id);
      await startTraining(testCommand, project.projectPath, latestRun.id, { testOnly: true, projectId: project.id });
    } catch (error) { alert(`Could not start evaluation: ${error.message || error}`); }
  };

  // Chart source: the live run while training, otherwise the newest run with history.
  const latest = active ? null : latestChartableRun(projectRuns.value);
  const series = active
    ? { trainLoss: trainingLossCurve.value || [], valLoss: [], valAcc: trainingAccCurve.value || [] }
    : latest?.series || { trainLoss: [], valLoss: [], valAcc: [] };
  const chartCaption = active ? "Live" : latest ? latest.run.name || latest.run.id : null;

  const datasetPath = project.folderPath || project.trainPath;
  const classes = validation?.info?.classes || project.numClasses;
  const maxEpochs = active ? trainingMaxEpochs.value || project.maxEpochs || 10 : project.maxEpochs || 10;
  const epochNow = Math.min(maxEpochs, (trainingEpoch.value || 0) + 1);
  const progress = active ? trainingProgress.value : 0;

  return (
    <Card
      class="dash-experiment"
      icon={<FlaskIcon size={18} />}
      title="Current experiment"
      aside={
        <>
          <span class="dash-state" role="status">
            <Dot state={readinessState(readiness, active)} />
            {active ? "Training" : readiness.blocked ? readiness.label : "Ready to train"}
          </span>
          <span class="dash-chip dash-chip--sm">{deviceLabel(project)}</span>
        </>
      }
    >
      <div class="dash-config-row">
        <ConfigTile icon={<CubeIcon size={18} />} label="Model" value={resolveBackboneName(project)} />
        <ConfigTile
          icon={<DatabaseIcon size={18} />}
          label="Dataset"
          value={baseName(datasetPath) || "—"}
          hint={classes ? `${classes} classes` : null}
        />
        <ConfigTile
          icon={<CropIcon size={18} />}
          label="Image size"
          value={project.imageSize ? `${project.imageSize} × ${project.imageSize}` : "Default"}
        />
      </div>

      <div class="dash-params">
        <div class="dash-param dash-param--epoch">
          <span class="dash-param-label">{active ? "Epoch" : "Epochs"}</span>
          {active ? (
            <>
              <span class="dash-param-value">{epochNow} <small>/ {maxEpochs}</small></span>
              <div class="dash-progress">
                <div class="dash-bar dash-bar--ok"><div class="dash-bar-fill" style={{ width: `${progress}%` }} /></div>
                <span>{progress}%</span>
              </div>
            </>
          ) : (
            <span class="dash-param-value">{maxEpochs} <small>planned</small></span>
          )}
        </div>
        <div class="dash-param">
          <span class="dash-param-label">Batch size</span>
          <span class="dash-param-value">{project.batchSize || <small>Default</small>}</span>
        </div>
        <div class="dash-param">
          <span class="dash-param-label">Learning rate</span>
          <span class="dash-param-value">{project.learningRate || <small>Default</small>}</span>
        </div>
        <div class="dash-param">
          <span class="dash-param-label">Optimizer</span>
          <span class="dash-param-value">{project.optimizer || <small>Default</small>}</span>
        </div>
      </div>

      <div class="dash-chart-block">
        <div class="dash-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "loss"} class={`dash-tab${tab === "loss" ? " dash-tab--active" : ""}`} onClick={() => setTab("loss")}>
            Training loss
          </button>
          <button role="tab" aria-selected={tab === "acc"} class={`dash-tab${tab === "acc" ? " dash-tab--active" : ""}`} onClick={() => setTab("acc")}>
            Validation accuracy
          </button>
          <div class="dash-legend">
            {chartCaption && <span class="dash-chart-sub">{chartCaption}</span>}
            {tab === "loss" ? (
              <>
                {series.trainLoss.length > 0 && <span><i style={{ background: "#3b82f6" }} />Train loss</span>}
                {series.valLoss.length > 0 && <span><i style={{ background: "#8b5cf6" }} />Val loss</span>}
              </>
            ) : (
              series.valAcc.length > 0 && <span><i style={{ background: "#22c55e" }} />Val accuracy</span>
            )}
          </div>
        </div>
        {tab === "loss" ? (
          <MetricChart
            height={180}
            series={[
              { label: "Train loss", data: series.trainLoss, color: "#3b82f6" },
              { label: "Val loss", data: series.valLoss, color: "#8b5cf6" },
            ]}
            yFormat={(v) => v.toFixed(Math.abs(v) >= 10 ? 1 : 3)}
            tickFormat={(v) => String(Number(v.toFixed(2)))}
            empty={active ? "Waiting for the first epoch…" : "Loss curves appear after your first run"}
          />
        ) : (
          <MetricChart
            height={180}
            series={[{ label: "Val accuracy", data: series.valAcc, color: "#22c55e", area: true }]}
            yDomain={[0, 1]}
            yFormat={(v) => `${(v * 100).toFixed(v === 0 || v === 1 || v === 0.5 ? 0 : 1)}%`}
            empty={active ? "Waiting for the first validation pass…" : "Accuracy appears after your first run"}
          />
        )}
      </div>

      <details class="dash-command">
        <summary><TerminalIcon size={14} /> Training command</summary>
        <code>{commandDisplay}</code>
      </details>

      {readiness.blocked && !active && (
        <div class="dash-note dash-note--err" id="training-readiness-detail">{readiness.detail}</div>
      )}

      <div class="dash-actions">
        {active ? (
          <button
            class="dash-btn dash-btn--primary dash-btn--lg"
            onClick={() => {
              const runId = crypto.randomUUID();
              addToQueue(project.id, { command, cwd: project.projectPath, runId });
            }}
          >
            + Add to queue
          </button>
        ) : (
          <button
            class="dash-btn dash-btn--primary dash-btn--lg"
            onClick={handleTrainClick}
            disabled={readiness.blocked}
            title={readiness.blocked ? readiness.detail : `Start training (${modKey}+Enter)`}
            aria-describedby={readiness.blocked ? "training-readiness-detail" : undefined}
          >
            <PlayIcon size={16} />
            Start training
            <kbd class="dash-kbd">{modKey}↵</kbd>
          </button>
        )}
        {stats.value.completed > 0 && (
          <button
            class="dash-btn dash-btn--outline"
            onClick={handleTestClick}
            disabled={active}
            title={active ? "A training run is already active" : testCommandDisplay}
          >
            <CheckCircleIcon size={16} />
            Run test
          </button>
        )}
        <button class="dash-btn dash-btn--outline dash-actions-end" onClick={() => navigate("experiments")}>
          <SlidersIcon size={16} />
          Experiments
        </button>
      </div>
      {queueLength.value > 0 && (
        <span class="dash-muted">{queueLength.value} queued {queueLength.value === 1 ? "run" : "runs"} waiting</span>
      )}
    </Card>
  );
}

function QueueCard() {
  const queued = projectQueue.value.filter((q) => q.status === "queued");
  if (queued.length === 0) return null;
  return (
    <Card class="dash-queue" title="Queued runs" aside={<span class="dash-muted">{queued.length} pending</span>}>
      <ul class="dash-queue-list">
        {queued.map((q, i) => (
          <li key={q.id}>
            <span class="dash-queue-index">#{i + 1}</span>
            <span>Queued run</span>
            <span class="dash-muted">
              {new Date(q.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button class="dash-icon-btn" onClick={() => removeFromQueue(q.id)} title="Remove from queue" aria-label="Remove from queue">
              &times;
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Overview() {
  const { metrics, error, retry } = useSystemMetrics();
  return (
    <>
      <WorkspaceBanner />
      <TrainingPanel />
      <div class="dash-grid">
        <ExperimentCard />
        <ResultsCard />
      </div>
      <QueueCard />
      <RecentRunsCard />
      <MachineHealth metrics={metrics} error={error} onRetry={retry} />
    </>
  );
}

export function DashboardView() {
  const connected = sshConnected.value;
  const synced = dashboardSynced.value;
  const syncing = dashboardSyncing.value;
  const showingCompletion = syncShowingCompletion.value;
  const showOverview = connected && !syncing && !showingCompletion && synced;

  return (
    <div class="dashboard-view dash">
      <ProjectHero />
      {!connected ? (
        <ConnectCard />
      ) : !showOverview ? (
        <SyncPanel />
      ) : (
        <Overview />
      )}
      <SshErrorModal />
    </div>
  );
}
