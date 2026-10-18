import { signal, computed } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentProjectId, currentProject, projectList } from "./projects.js";
import { addRun, updateRun, allRuns, generateRunName, resolveBackboneName } from "./experiments.js";
import { processQueue } from "./queue.js";
import { initNotifications, notify } from "../utils/notifications.js";
import { pickTestAcc, toTestOnlyCommand, commandSteps } from "../utils/testMetrics.js";
import { syncConfig } from "./dashboard.js";

// Alias for backward compat within this file
const _notify = notify;

// ── Per-project training state ───────────────────────────────────────────────

const _startingProjects = new Set();
const _trainingState = signal({}); // { [projectId]: TrainingState }

const _defaultTraining = () => ({
  active: false,
  reconnected: false, // true if restored from an orphaned session
  runId: null,
  event: null, // last event type
  epoch: 0,
  maxEpochs: 0,
  step: 0,
  totalSteps: 0,
  loss: null,
  metrics: {},
  testMetrics: {}, // metrics from autotimm test step
  testBatch: 0,
  testTotalBatches: 0,
  error: null,
  testOnly: false, // true when running evaluation without training
  pendingTest: null, // { command } — a reattached fit+test run still owes its test step
  fastDevRun: false,
  lossCurve: [],
  accCurve: [],
  scalars: {}, // { [tag]: [{ step, value }] } — all metrics accumulated per epoch
  epochStartTime: null, // timestamp when current epoch started
  estimatedRemaining: null, // estimated remaining time in ms
});

function _get(projectId) {
  return _trainingState.value[projectId] ?? _defaultTraining();
}

function _set(projectId, updates) {
  const current = _get(projectId);
  _trainingState.value = {
    ..._trainingState.value,
    [projectId]: { ...current, ...updates },
  };
}

// ── Computed signals for active project ──────────────────────────────────────

export const trainingActive = computed(
  () => _get(currentProjectId.value).active,
);
/** True while any project has a training/test process running. */
export const anyTrainingActive = computed(() =>
  Object.values(_trainingState.value).some((s) => s.active),
);
export const trainingReconnected = computed(
  () => _get(currentProjectId.value).reconnected,
);
export const trainingEvent = computed(() => _get(currentProjectId.value).event);
export const trainingEpoch = computed(() => _get(currentProjectId.value).epoch);
export const trainingMaxEpochs = computed(
  () => _get(currentProjectId.value).maxEpochs,
);
export const trainingStep = computed(() => _get(currentProjectId.value).step);
export const trainingLoss = computed(() => _get(currentProjectId.value).loss);
export const trainingLossCurve = computed(() => _get(currentProjectId.value).lossCurve);
export const trainingAccCurve = computed(() => _get(currentProjectId.value).accCurve);
export const trainingMetrics = computed(
  () => _get(currentProjectId.value).metrics,
);
export const trainingError = computed(() => _get(currentProjectId.value).error);
export const trainingTestOnly = computed(
  () => _get(currentProjectId.value).testOnly,
);
export const trainingFastDevRun = computed(
  () => _get(currentProjectId.value).fastDevRun,
);
export const trainingTestMetrics = computed(
  () => _get(currentProjectId.value).testMetrics,
);

export const trainingTestBatch = computed(
  () => _get(currentProjectId.value).testBatch,
);
export const trainingTestTotalBatches = computed(
  () => _get(currentProjectId.value).testTotalBatches,
);

export const trainingTestProgress = computed(() => {
  const s = _get(currentProjectId.value);
  if (s.testTotalBatches === 0) return 0;
  return Math.round((s.testBatch / s.testTotalBatches) * 100);
});

export const trainingEstimatedRemaining = computed(
  () => _get(currentProjectId.value).estimatedRemaining,
);

export const trainingProgress = computed(() => {
  const s = _get(currentProjectId.value);
  if (!s.active || s.maxEpochs === 0) return 0;
  return Math.round(((s.epoch + 1) / s.maxEpochs) * 100);
});

export function getTrainingRunId(projectId) {
  return _get(projectId).runId;
}

// ── Start / stop training ────────────────────────────────────────────────────

export async function startTraining(command, cwd, passedRunId, { testOnly = false, projectId = currentProjectId.value } = {}) {
  if (!projectId) return;

  if (_get(projectId).active || _startingProjects.has(projectId)) throw new Error("Training already running for this project");
  const project = projectList.value.find((p) => p.id === projectId);
  if (!project) throw new Error("Training project no longer exists");
  if (project.connectionType === "remote") throw new Error("Managed training currently launches local processes only. Run AutoTimm in the connected remote terminal to train on the remote machine.");
  const runId = passedRunId || crypto.randomUUID();
  const runName = generateRunName();

  // Collect hyperparameters from the project
  const hyperparameters = {};
  if (project?.learningRate != null && project.learningRate !== "")
    hyperparameters.lr = Number(project.learningRate);
  if (project?.optimizer) hyperparameters.optimizer = project.optimizer;
  if (project?.scheduler && project.scheduler !== "none")
    hyperparameters.scheduler = project.scheduler;
  if (project?.weightDecay != null && project.weightDecay !== "")
    hyperparameters.weightDecay = Number(project.weightDecay);
  if (project?.batchSize != null && project.batchSize !== "")
    hyperparameters.batchSize = Number(project.batchSize);
  if (project?.maxEpochs != null && project.maxEpochs !== "")
    hyperparameters.maxEpochs = Number(project.maxEpochs);
  if (project?.imageSize != null && project.imageSize !== "")
    hyperparameters.imageSize = Number(project.imageSize);
  if (project?.precision) hyperparameters.precision = project.precision;
  if (project?.gradientClipVal != null && project.gradientClipVal !== "")
    hyperparameters.gradientClipVal = Number(project.gradientClipVal);
  if (project?.freezeBackbone) hyperparameters.freezeBackbone = true;
  if (project?.seed != null && project.seed !== "")
    hyperparameters.seed = Number(project.seed);
  if (project?.augmentationPreset)
    hyperparameters.augmentationPreset = project.augmentationPreset;
  if (project?.numClasses != null && project.numClasses !== "")
    hyperparameters.numClasses = Number(project.numClasses);

  // Create a run record in experiments — persist everything so RunDetail
  // can render fully even if log files are later deleted.
  _startingProjects.add(projectId);
  let runCreated = false;
  // A test-only run evaluates an existing run's checkpoint, so its results
  // belong on that run rather than on a new record.
  const attachToExisting = testOnly && allRuns.value.some((r) => r.id === runId);
  try {
  if (!attachToExisting) await addRun({
    id: runId,
    name: runName,
    projectId,
    status: "running",
    model: project?.modelCategory ?? "unknown",
    backbone: resolveBackboneName(project),
    taskType: project?.taskType || "Classification",
    dataset: project?.folderPath || project?.trainPath || "unknown",
    bestAcc: null,
    testAcc: null,
    valLoss: null,
    epochs: 0,
    lr: hyperparameters.lr ?? null,
    hyperparameters,
    testMetrics: {},
    scalars: {},
    lossCurve: [],
    accCurve: [],
    tags: [],
    notes: "",
    created: new Date().toISOString(),
  });

  runCreated = !attachToExisting;
  _set(projectId, {
    ..._defaultTraining(),
    active: true,
    testOnly,
    runId,
    event: "preparing",
  });

    await invoke("start_training", {
      sessionId: projectId,
      runId,
      runName,
      command,
      cwd: cwd || project?.projectPath || null,
    });
  } catch (err) {
    _set(projectId, {
      active: false,
      event: "training_error",
      error: `${err}`,
    });
    if (runCreated) await updateRun(runId, { status: "failed" });
    throw err;
  } finally {
    _startingProjects.delete(projectId);
  }
}

export async function stopTraining() {
  const projectId = currentProjectId.value;
  if (!projectId) return;

  const state = _get(projectId);
  const project = currentProject.value;
  try {
    await invoke("stop_training", {
      sessionId: projectId,
      projectPath: project?.projectPath || null,
    });
  } catch (err) {
    console.error("Failed to stop training:", err);
  }

  _set(projectId, { active: false, event: "stopped", reconnected: false });

  if (state.runId && !state.testOnly) {
    await updateRun(state.runId, { status: "failed" });
  }
}

export async function forceResetTraining() {
  const projectId = currentProjectId.value;
  if (!projectId) return;

  const state = _get(projectId);
  const project = currentProject.value;
  try {
    await invoke("force_reset_training", {
      sessionId: projectId,
      projectPath: project?.projectPath || null,
    });
  } catch (err) {
    console.error("Failed to force reset training:", err);
  }

  _set(projectId, _defaultTraining());

  if (state.runId && state.active && !state.testOnly) {
    await updateRun(state.runId, { status: "failed" });
  }
}

// ── Event processing (shared between live and replay) ────────────────────────

function _processEvent(session_id, data) {
  const state = _get(session_id);

  switch (data.event) {
    case "training_started":
      _set(session_id, {
        event: "training_started",
        maxEpochs: data.max_epochs ?? 0,
        totalSteps: data.total_steps ?? 0,
        fastDevRun: data.fast_dev_run ?? false,
      });
      break;

    case "tuning_started":
      _set(session_id, { event: "tuning_started" });
      break;

    case "tuning_complete":
      _set(session_id, { event: "tuning_complete" });
      break;

    case "testing_started":
      _set(session_id, {
        event: "testing_started",
        testMetrics: {},
        testBatch: 0,
        testTotalBatches: data.total_batches ?? 0,
      });
      break;

    case "test_batch_end":
      _set(session_id, {
        event: "test_batch_end",
        testBatch: data.batch ?? state.testBatch,
        testTotalBatches: data.total_batches ?? state.testTotalBatches,
      });
      break;

    case "testing_complete": {
      const testMetrics = data.metrics ?? {};
      const testAcc = pickTestAcc(testMetrics);

      // Start from the run's saved scalars so a test-only run (whose live
      // state has no train/val history) doesn't wipe the run's curves.
      const savedRun = state.runId ? allRuns.value.find((r) => r.id === state.runId) : null;
      const prevScalars = { ...(savedRun?.scalars || {}), ..._get(session_id).scalars };
      // A test is one evaluation: re-running it replaces the previous values.
      for (const [tag, value] of Object.entries(testMetrics)) {
        if (value == null) continue;
        prevScalars[tag] = [{ step: 0, value }];
      }

      // Capture confusion matrix and per-class metrics for all splits (test, train, val)
      const confusionMatrix = data.confusion_matrix ?? null;
      const perClassMetrics = data.per_class_metrics ?? null;
      const trainCM = data.train_confusion_matrix ?? null;
      const trainPCM = data.train_per_class_metrics ?? null;
      const valCM = data.val_confusion_matrix ?? null;
      const valPCM = data.val_per_class_metrics ?? null;
      if (confusionMatrix) prevScalars["test/confusion_matrix"] = confusionMatrix;
      if (perClassMetrics) prevScalars["test/per_class_metrics"] = perClassMetrics;
      if (trainCM) prevScalars["train/confusion_matrix"] = trainCM;
      if (trainPCM) prevScalars["train/per_class_metrics"] = trainPCM;
      if (valCM) prevScalars["val/confusion_matrix"] = valCM;
      if (valPCM) prevScalars["val/per_class_metrics"] = valPCM;

      _set(session_id, {
        event: "testing_complete",
        testMetrics,
        scalars: prevScalars,
      });

      if (state.runId) {
        const updates = { testMetrics, scalars: prevScalars };
        if (testAcc != null) updates.testAcc = testAcc;
        if (confusionMatrix) updates.confusionMatrix = confusionMatrix;
        if (perClassMetrics) updates.perClassMetrics = perClassMetrics;
        if (trainCM) updates.trainConfusionMatrix = trainCM;
        if (trainPCM) updates.trainPerClassMetrics = trainPCM;
        if (valCM) updates.valConfusionMatrix = valCM;
        if (valPCM) updates.valPerClassMetrics = valPCM;
        updateRun(state.runId, updates);
      }

      // Send OS notification for testing completion
      _notify(
        "Testing Complete",
        testAcc != null
          ? `Test accuracy: ${(testAcc * 100).toFixed(1)}%`
          : "Model evaluation finished.",
      );
      break;
    }

    case "epoch_started":
      _set(session_id, {
        event: "epoch_started",
        epoch: data.epoch ?? 0,
        maxEpochs: data.max_epochs ?? state.maxEpochs,
        epochStartTime: Date.now(),
      });
      break;

    case "batch_end":
      _set(session_id, {
        event: "batch_end",
        step: data.step ?? state.step,
        totalSteps: data.total_steps ?? state.totalSteps,
        loss: data.loss ?? state.loss,
      });
      break;

    case "epoch_end": {
      const metrics = data.metrics ?? {};
      const epoch = data.epoch ?? state.epoch;
      const loss = metrics["train/loss"] ?? metrics["loss"] ?? state.loss;
      const lossCurve = [..._get(session_id).lossCurve];
      if (loss != null) lossCurve.push(loss);

      // Accumulate all metrics into scalars
      const prevScalars = { ..._get(session_id).scalars };
      for (const [tag, value] of Object.entries(metrics)) {
        if (value == null) continue;
        if (!prevScalars[tag]) prevScalars[tag] = [];
        prevScalars[tag] = [...prevScalars[tag], { step: epoch, value }];
      }

      // Calculate estimated remaining time
      let estimatedRemaining = state.estimatedRemaining;
      if (state.epochStartTime && state.maxEpochs > 0) {
        const epochDuration = Date.now() - state.epochStartTime;
        const remaining = epochDuration * (state.maxEpochs - epoch - 1);
        estimatedRemaining = remaining > 0 ? remaining : null;
      }

      _set(session_id, {
        event: "epoch_end",
        epoch,
        metrics,
        loss,
        lossCurve,
        scalars: prevScalars,
        estimatedRemaining,
      });

      if (state.runId) {
        updateRun(state.runId, {
          epochs: epoch + 1,
          valLoss: metrics["val/loss"] ?? null,
          lossCurve,
          scalars: prevScalars,
        });
      }
      break;
    }

    case "validation_end": {
      const metrics = data.metrics ?? {};
      const epoch = data.epoch ?? state.epoch;
      const acc = metrics["val/accuracy"] ?? metrics["val/acc"] ?? null;
      const accCurve = [..._get(session_id).accCurve];
      if (acc != null) accCurve.push(acc);

      const bestAcc = accCurve.length > 0 ? Math.max(...accCurve) : null;

      // Accumulate all validation metrics into scalars
      const prevScalars = { ..._get(session_id).scalars };
      for (const [tag, value] of Object.entries(metrics)) {
        if (value == null) continue;
        if (!prevScalars[tag]) prevScalars[tag] = [];
        prevScalars[tag] = [...prevScalars[tag], { step: epoch, value }];
      }

      _set(session_id, {
        event: "validation_end",
        metrics: { ..._get(session_id).metrics, ...metrics },
        accCurve,
        scalars: prevScalars,
      });

      if (state.runId) {
        updateRun(state.runId, {
          bestAcc,
          valLoss: metrics["val/loss"] ?? null,
          accCurve,
          scalars: prevScalars,
        });
      }
      break;
    }

    case "training_complete": {
      const finalMetrics = data.final_metrics ?? state.metrics;
      _set(session_id, {
        event: "training_complete",
        active: false,
        reconnected: false,
        metrics: finalMetrics,
        estimatedRemaining: null,
      });

      if (state.runId && !state.testOnly) {
        // Persist all accumulated data so RunDetail can render without files
        const finalUpdate = {
          status: "completed",
          epochs: state.epoch + 1,
          lossCurve: state.lossCurve,
          accCurve: state.accCurve,
          scalars: state.scalars,
          bestAcc: state.accCurve.length > 0 ? Math.max(...state.accCurve) : null,
          valLoss: state.metrics?.["val/loss"] ?? null,
        };
        if (Object.keys(state.testMetrics).length > 0) {
          finalUpdate.testMetrics = state.testMetrics;
          const tAcc = pickTestAcc(state.testMetrics);
          if (tAcc != null) finalUpdate.testAcc = tAcc;
        }
        updateRun(state.runId, finalUpdate);
      }

      // A fit+test run reattached after an app restart lost the process that
      // would have run its test step; run it now against the same run.
      if (state.pendingTest && state.runId) {
        _set(session_id, { pendingTest: null });
        _startPendingTest(session_id, state.runId, state.pendingTest.command);
      }

      // Test-only runs already notified on testing_complete.
      if (state.testOnly) {
        processQueue(session_id);
        break;
      }

      // Send OS notification
      const bestAcc = state.accCurve.length > 0
        ? (Math.max(...state.accCurve) * 100).toFixed(1) + "%"
        : null;
      _notify(
        "Training Complete",
        bestAcc
          ? `Run finished with best accuracy: ${bestAcc}`
          : "Training finished successfully.",
      );

      // Process next queued run
      processQueue(session_id);
      break;
    }

    case "training_error": {
      const errorMsg = data.error ?? "Unknown error";
      _set(session_id, {
        event: "training_error",
        active: false,
        reconnected: false,
        error: errorMsg,
        estimatedRemaining: null,
      });

      // A failed evaluation leaves the evaluated run's own status alone.
      if (state.runId && !state.testOnly) {
        updateRun(state.runId, { status: "failed" });
      }

      _notify(
        state.testOnly ? "Testing Failed" : "Training Failed",
        errorMsg.length > 100 ? errorMsg.slice(0, 100) + "..." : errorMsg,
      );

      // Process next queued run
      processQueue(session_id, "failed");
      break;
    }
  }
}

// ── Reconnect to orphaned training sessions ─────────────────────────────────

/** Run the test step a reattached fit+test run never got, against that run. */
async function _startPendingTest(projectId, runId, command) {
  const project = projectList.value.find((p) => String(p.id) === String(projectId));
  if (!project?.projectPath || !command) return;
  try {
    // Point config.yaml at this run so AutoTimm loads its checkpoint.
    await syncConfig(project, project.id, runId);
    await startTraining(command, project.projectPath, runId, { testOnly: true, projectId: project.id });
  } catch (err) {
    console.warn(`[training] Could not run the pending test for ${project.name}:`, err);
  }
}

/**
 * Check all projects for orphaned training sessions that survived an app crash.
 * For each found:
 *   - If process is still alive: replay log, start log watcher, restore UI state
 *   - If process is dead: replay log to get final state, mark run complete/failed
 */
export async function recoverOrphanedSessions() {
  const projects = projectList.value;
  const activeRunIds = new Set(); // runs whose process is still alive
  for (const project of projects) {
    if (!project.projectPath) continue;

    try {
      const result = await invoke("check_training_session", {
        projectPath: project.projectPath,
      });

      if (!result.found || !result.meta) continue;

      const { meta } = result;
      const projectId = meta.session_id;

      // Find or recreate the run record
      let runId = meta.run_id;
      const existingRun = allRuns.value.find((r) => r.id === runId);
      if (!existingRun) {
        // Run was lost from IndexedDB — recreate it
        runId = meta.run_id;
        const hp = {};
        if (project.learningRate != null && project.learningRate !== "")
          hp.lr = Number(project.learningRate);
        if (project.optimizer) hp.optimizer = project.optimizer;
        if (project.scheduler && project.scheduler !== "none")
          hp.scheduler = project.scheduler;
        if (project.weightDecay != null && project.weightDecay !== "")
          hp.weightDecay = Number(project.weightDecay);
        if (project.batchSize != null && project.batchSize !== "")
          hp.batchSize = Number(project.batchSize);
        if (project.maxEpochs != null && project.maxEpochs !== "")
          hp.maxEpochs = Number(project.maxEpochs);
        if (project.imageSize != null && project.imageSize !== "")
          hp.imageSize = Number(project.imageSize);
        if (project.precision) hp.precision = project.precision;
        if (project.gradientClipVal != null && project.gradientClipVal !== "")
          hp.gradientClipVal = Number(project.gradientClipVal);
        if (project.freezeBackbone) hp.freezeBackbone = true;
        if (project.seed != null && project.seed !== "")
          hp.seed = Number(project.seed);
        if (project.augmentationPreset)
          hp.augmentationPreset = project.augmentationPreset;
        if (project.numClasses != null && project.numClasses !== "")
          hp.numClasses = Number(project.numClasses);
        await addRun({
          id: runId,
          name: generateRunName(),
          projectId,
          status: "running",
          model: project.modelCategory ?? "unknown",
          backbone: resolveBackboneName(project),
          taskType: project.taskType || "Classification",
          dataset: project.folderPath || project.trainPath || "unknown",
          bestAcc: null,
          testAcc: null,
          valLoss: null,
          epochs: 0,
          lr: hp.lr ?? null,
          hyperparameters: hp,
          testMetrics: {},
          scalars: {},
          lossCurve: [],
          accCurve: [],
          tags: [],
          notes: "",
          created: new Date(meta.started_at * 1000).toISOString(),
        });
      }

      // Set state to active so _processEvent works
      _set(projectId, {
        ..._defaultTraining(),
        active: true,
        reconnected: true,
        // A reattached "Run test" must not overwrite the evaluated run on finish.
        testOnly: commandSteps(meta.command) === "test",
        runId,
      });

      // Read all events from the log file and process synchronously
      // (Using read_training_log instead of replay_training_log to avoid
      //  async event delivery race where state isn't updated before we read it)
      const events = await invoke("read_training_log", {
        logFile: meta.log_file,
      });
      for (const data of events) {
        _processEvent(projectId, data);
      }

      // Did this fit+test run finish (or will it finish) without its test step?
      const steps = commandSteps(meta.command).split("+");
      const owesTest =
        steps.includes("fit") && steps.includes("test") &&
        !events.some((e) => typeof e?.event === "string" && e.event.startsWith("test"));
      const testCommand = owesTest ? toTestOnlyCommand(meta.command) : null;

      // Check final state after replay
      const stateAfterReplay = _get(projectId);

      if (result.alive) {
        // Process still running — override any stale error from the log
        // (e.g. a BrokenPipeError recorded when the app previously closed)
        if (
          !stateAfterReplay.active ||
          stateAfterReplay.event === "training_error"
        ) {
          _set(projectId, {
            active: true,
            reconnected: true,
            event:
              stateAfterReplay.event === "training_error"
                ? stateAfterReplay.epoch > 0
                  ? "epoch_end"
                  : "training_started"
                : stateAfterReplay.event,
            error: null,
          });
          if (runId) {
            await updateRun(runId, { status: "running" });
          }
        }
        activeRunIds.add(runId);
        // When the watched fit finishes, training_complete runs the test step.
        if (testCommand) _set(projectId, { pendingTest: { command: testCommand } });
        // Start watching log file for new events
        console.log(
          `[training] Reconnected to orphaned training for ${project.name} (PID ${meta.pid})`,
        );
        invoke("watch_training_log", {
          sessionId: projectId,
          logFile: meta.log_file,
          pid: meta.pid,
        }); // fire-and-forget, runs until process dies
      } else {
        // Process is dead — if we never got training_complete, mark as failed
        if (stateAfterReplay.active) {
          _set(projectId, {
            active: false,
            reconnected: false,
            event:
              stateAfterReplay.event === "training_complete"
                ? "training_complete"
                : "training_error",
            error:
              stateAfterReplay.event === "training_complete"
                ? null
                : "Training process exited unexpectedly",
          });
          if (runId) {
            const finalStatus =
              stateAfterReplay.event === "training_complete"
                ? "completed"
                : "failed";
            await updateRun(runId, { status: finalStatus });
          }
        }
        console.log(
          `[training] Recovered completed/failed orphaned training for ${project.name}`,
        );
        // Fit finished while the app was closed; run the test step it never got.
        if (testCommand && _get(projectId).event === "training_complete") {
          _startPendingTest(projectId, runId, testCommand);
        }
      }
    } catch (err) {
      // check_training_session can fail for non-local projects — ignore
      console.debug(
        `[training] Could not check orphaned session for ${project.name}:`,
        err,
      );
    }
  }
  return activeRunIds;
}

/**
 * Settle runs still marked "running" that no live process belongs to — e.g.
 * the app closed before the final status was saved. Each run's own event log
 * says how it ended: completed if training (or a test-only evaluation)
 * finished, failed otherwise. Runs without a local log are left alone.
 */
async function settleStaleRuns(activeRunIds = new Set()) {
  const stale = allRuns.value.filter(
    (r) => r.status === "running" && !activeRunIds.has(r.id) && !_get(r.projectId).active,
  );
  for (const run of stale) {
    const project = projectList.value.find((p) => p.id === run.projectId);
    if (!project?.projectPath || project.connectionType === "remote") continue;
    const sep = project.projectPath.includes("\\") ? "\\" : "/";
    const base = project.projectPath.replace(/[\\/]+$/, "");
    const logFile = [base, "logs", run.id, `${run.id}.jsonl`].join(sep);
    let events;
    try {
      events = await invoke("read_training_log", { logFile });
    } catch {
      continue; // no local log to go by
    }
    if (!Array.isArray(events)) continue;
    const finished = [...events].reverse().find(
      (e) => e?.event === "training_complete" || e?.event === "testing_complete",
    );
    const update = finished ? { status: "completed" } : { status: "failed" };
    if (finished?.timestamp) update.finishedAt = new Date(finished.timestamp * 1000).toISOString();
    try {
      await updateRun(run.id, update);
      console.log(`[training] Settled stale run ${run.name || run.id} as ${update.status}`);
    } catch (err) {
      console.warn(`[training] Could not settle run ${run.id}:`, err);
    }
  }
}

// ── Event listener setup ─────────────────────────────────────────────────────

let _unlistenEvent = null;
let _unlistenLog = null;

export async function initTrainingListeners(dataLoaded = Promise.resolve()) {
  // Avoid double-init
  if (_unlistenEvent) return;

  // Request notification permission
  initNotifications();

  _unlistenEvent = await listen("training-event", (e) => {
    const { session_id, data } = e.payload;
    const state = _get(session_id);
    // Allow training_complete, test events, and errors through even when
    // active is false — the Rust backend emits training_complete after both
    // fit+test finish, and tail-task events may arrive slightly out of order.
    const evt = data.event;
    const alwaysAllow = evt === "training_complete" || evt === "training_error"
      || evt === "testing_started" || evt === "test_batch_end"
      || evt === "testing_complete";
    if (!state.active && !alwaysAllow) return;
    _processEvent(session_id, data);
  });

  _unlistenLog = await listen("training-log", (_e) => {
    // Stderr logs — could forward to a log panel in the future
  });

  // Check for orphaned sessions from a previous app crash once projects and
  // runs are loaded — otherwise recovery can't find the run and overwrites it.
  dataLoaded
    .catch(() => {})
    .then(() => recoverOrphanedSessions())
    .then((activeRunIds) => settleStaleRuns(activeRunIds));
}

/** Remove per-project training state when a project is deleted. */
export function cleanupTrainingState(projectId) {
  const { [projectId]: _, ...rest } = _trainingState.value;
  _trainingState.value = rest;
}

export function cleanupTrainingListeners() {
  if (_unlistenEvent) {
    _unlistenEvent();
    _unlistenEvent = null;
  }
  if (_unlistenLog) {
    _unlistenLog();
    _unlistenLog = null;
  }
}
