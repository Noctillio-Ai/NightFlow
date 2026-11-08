import { useState, useEffect } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { navigate, routeParams } from "../state/router.js";
import { allRuns, loadRunHparams } from "../state/experiments.js";
import { currentProject } from "../state/projects.js";
import { runExports } from "../state/exports.js";
import { headlineFor } from "../utils/headline.js";
import { FormatTiles } from "../components/deploy/ModelFiles.jsx";
import { useInferenceScript, ScriptSettings, ScriptEditor } from "../components/deploy/ScriptPanel.jsx";
import { PublishCard } from "../components/deploy/PublishCard.jsx";
import { FORMATS, sshFor, ArrowLeftIcon, AlertIcon } from "../components/deploy/shared.jsx";

/** Deploy model — export a finished run, get code to run it, optionally publish it. */
export function DeployModelView() {
  const { runId } = routeParams.value;
  const run = allRuns.value.find((r) => r.id === runId);
  if (!run) {
    return (
      <div class="run-detail-view dash rd dpm">
        <div class="rd-missing">
          <strong>Run not found</strong>
          <span>It may have been deleted.</span>
          <button class="dash-btn dash-btn--quiet" onClick={() => navigate("experiments")}>Back to Experiments</button>
        </div>
      </div>
    );
  }
  return <DeployModel key={run.id} run={run} />;
}

function DeployModel({ run }) {
  const project = currentProject.value;
  const [fileHparams, setFileHparams] = useState(run.fileHparams || null);
  const [hasCkpt, setHasCkpt] = useState(null); // null = unknown

  useEffect(() => {
    if (run.fileHparams && Object.keys(run.fileHparams).length) return;
    loadRunHparams(run).then((h) => h && setFileHparams(h)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!project) return;
    invoke("check_runs_checkpoints", { projectPath: project.projectPath, runIds: [run.id], sshCommand: sshFor(project) })
      .then((ids) => setHasCkpt(ids.includes(run.id)))
      .catch(() => setHasCkpt(null));
  }, [project?.projectPath]);

  // Script format: follows the first exported format until the user picks one.
  const exported = (runExports.value[run.id] || []).map((e) => e.format);
  const [picked, setPicked] = useState(null);
  const format = picked || FORMATS.find((f) => exported.includes(f.id))?.id || "torchscript";

  const hp = { ...(run.hyperparameters || {}), ...(fileHparams || {}) };
  const script = useInferenceScript({ run, project, hp, format });

  const h = headlineFor(run.taskType);
  const imageSize = hp.image_size || hp.imageSize;
  const numClasses = hp.num_classes || hp.numClasses || project?.numClasses;
  const ready = exported.length > 0;
  const status = ready
    ? { tone: "ok", label: `${exported.length} of ${FORMATS.length} formats ready` }
    : { tone: "idle", label: "Not exported yet" };

  return (
    <div class="run-detail-view dash rd dpm">
      <header class="rd-head dpm-head">
        <div class="rd-head-main">
          <span class="rd-eyebrow rd-tone--ok">Deploy model</span>
          <div class="rd-title">
            <h2>{run.name || run.id}</h2>
            <span class={`rd-status rd-tone--${status.tone}`}><span class="rd-status-dot" />{status.label}</span>
          </div>
          <div class="rd-meta">
            <code class="dpm-meta-code">{run.backbone || run.model || "model"}</code>
            <span>{run.taskType || project?.taskType || "Classification"}</span>
            {imageSize && <span>{imageSize}×{imageSize} input</span>}
            {numClasses && <span>{numClasses} classes</span>}
          </div>
        </div>
        <div class="dpm-head-side">
          {Number.isFinite(run.bestAcc) && (
            <div class="dpm-stat dpm-stat--ok">
              <span class="dpm-stat-label">Best val {h.name}</span>
              <span class="dpm-stat-value">{h.format(run.bestAcc)}</span>
            </div>
          )}
          {Number.isFinite(run.testAcc) && (
            <div class="dpm-stat">
              <span class="dpm-stat-label">Test {h.name}</span>
              <span class="dpm-stat-value">{h.format(run.testAcc)}</span>
            </div>
          )}
          <button type="button" class="dash-btn dpm-back" onClick={() => navigate("run-detail", { runId: run.id })}>
            <ArrowLeftIcon size={15} /> Back to run
          </button>
        </div>
      </header>

      {hasCkpt === false && !ready && (
        <div class="rd-insight rd-insight--warn" role="status">
          <span class="rd-insight-icon"><AlertIcon size={16} /></span>
          <div>
            <strong>No checkpoint found</strong>
            <span>This run didn't save a model checkpoint, so there's nothing to export.</span>
          </div>
        </div>
      )}

      <FormatTiles run={run} project={project} selected={format} onSelect={setPicked} />

      <div class="rd-body dpm-body">
        <aside class="rd-side">
          <ScriptSettings s={script} format={format} />
          <PublishCard run={run} project={project} hp={hp} />
        </aside>
        <div class="rd-main">
          <ScriptEditor s={script} run={run} format={format} onSelect={setPicked} />
        </div>
      </div>
    </div>
  );
}
