import {
  trainingActive,
  trainingReconnected,
  trainingEvent,
  trainingEpoch,
  trainingMaxEpochs,
  trainingStep,
  trainingLoss,
  trainingLossCurve,
  trainingProgress,
  trainingError,
  trainingFastDevRun,
  trainingMetrics,
  trainingTestMetrics,
  trainingTestBatch,
  trainingTestTotalBatches,
  trainingEstimatedRemaining,
  trainingTestOnly,
  stopTraining,
  forceResetTraining,
  getTrainingRunId,
} from "../state/training.js";
import { currentProjectId } from "../state/projects.js";
import { Sparkline } from "./Sparkline.jsx";
import { EvaluationPanel } from "./dashboard/EvaluationPanel.jsx";

function formatDuration(ms) {
  if (ms == null || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "< 1m";
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function ProgressBar({ value }) {
  return (
    <div class="training-progress-track">
      <div
        class="training-progress-fill"
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

function StatusLabel({ event, reconnected }) {
  const labels = {
    preparing: "Starting...",
    tuning_started: "Auto-tuning...",
    tuning_complete: "Tuning complete",
    training_started: "Starting...",
    testing_started: "Running tests...",
    test_batch_end: "Testing",
    testing_complete: "Testing complete",
    epoch_started: "Training",
    batch_end: "Training",
    epoch_end: "Epoch complete",
    validation_end: "Validating",
    training_complete: "Complete",
    training_error: "Failed",
    stopped: "Stopped",
  };
  const label = labels[event] || "Idle";
  return (
    <span class="training-status-label">
      {reconnected ? `Reconnected \u00b7 ${label}` : label}
    </span>
  );
}

export function TrainingPanel() {
  const active = trainingActive.value;
  const reconnected = trainingReconnected.value;
  const event = trainingEvent.value;
  const error = trainingError.value;

  // Don't show if nothing has happened
  if (!active && !event) return null;

  const epoch = trainingEpoch.value;
  const maxEpochs = trainingMaxEpochs.value;
  const step = trainingStep.value;
  const loss = trainingLoss.value;
  const progress = trainingProgress.value;
  const fastDev = trainingFastDevRun.value;
  const metrics = trainingMetrics.value;

  const testOnly = trainingTestOnly.value;
  const isError = event === "training_error" || event === "stopped";
  const isDone = event === "training_complete";

  const showTest = event === "testing_started" || event === "test_batch_end" || event === "testing_complete";
  const testMetrics = trainingTestMetrics.value;
  const hasTestMetrics = Object.keys(testMetrics).length > 0;
  const evalProps = {
    metrics: testMetrics,
    batch: trainingTestBatch.value,
    totalBatches: trainingTestTotalBatches.value,
    runId: getTrainingRunId(currentProjectId.value),
  };

  // For test-only runs, skip the training panel entirely
  if (testOnly) {
    const state = isError ? "error" : active && event !== "testing_complete" ? "running" : "done";
    return (
      <EvaluationPanel
        {...evalProps}
        state={state}
        error={error}
        onStop={stopTraining}
        onDismiss={forceResetTraining}
      />
    );
  }

  return (
    <>
      <div
        class={`training-panel${isError ? " training-panel--error" : isDone && !showTest ? " training-panel--done" : ""}`}
      >
        <div class="training-panel-header">
          <div class="training-panel-title-row">
            {active && !showTest && <div class="training-panel-spinner" />}
            <span class="training-panel-title">
              {fastDev ? "Fast Dev Run" : "Training"}
            </span>
            <StatusLabel event={active && !showTest ? event : isDone || showTest ? "training_complete" : event} reconnected={reconnected} />
          </div>
          <div class="training-panel-actions">
            {active && !showTest && (
              <button class="training-stop-btn" onClick={stopTraining}>
                Stop
              </button>
            )}
            {!active && (isError || isDone) && (
              <button class="training-reset-btn" onClick={forceResetTraining}>
                Dismiss
              </button>
            )}
          </div>
        </div>

        {active && !showTest && (
          <>
            <ProgressBar value={progress} />
            <div class="training-panel-stats">
              <div class="training-stat">
                <span class="training-stat-label">Epoch</span>
                <span class="training-stat-value">
                  {epoch + 1} / {maxEpochs} · Step {step}
                  {(() => {
                    const eta = formatDuration(trainingEstimatedRemaining.value);
                    return eta ? <span class="training-eta"> · ~{eta} left</span> : null;
                  })()}
                </span>
              </div>
              {loss != null && (
                <div class="training-stat">
                  <span class="training-stat-label">Loss</span>
                  <span class="training-stat-value" style="display:flex;align-items:center;gap:6px">
                    {loss.toFixed(4)}
                    <Sparkline data={trainingLossCurve.value} width={80} height={20} />
                  </span>
                </div>
              )}
              {Object.entries(metrics).map(([key, val]) => {
                if (key === "train/loss" || key === "loss") return null;
                const label = key
                  .replace(/^(train|val|test)\//, "")
                  .replace(/_/g, " ");
                const prefix = key.startsWith("val/")
                  ? "Val"
                  : key.startsWith("train/")
                    ? "Train"
                    : key.startsWith("test/")
                      ? "Test"
                      : "";
                const displayLabel = prefix ? `${prefix} ${label}` : label;
                const displayVal =
                  typeof val === "number" && Number.isFinite(val)
                    ? val < 1 && val > -1
                      ? val.toFixed(4)
                      : val.toFixed(2)
                    : typeof val === "number" ? "—" : val;
                return (
                  <div class="training-stat" key={key}>
                    <span class="training-stat-label">{displayLabel}</span>
                    <span class="training-stat-value">{displayVal}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Show done message only when training is complete and test hasn't started */}
        {!showTest && isDone && (
          <div class="training-panel-done-msg">
            Training finished successfully.
          </div>
        )}

        {isError && error && <div class="training-panel-error">{error}</div>}
      </div>

      {/* Evaluation on the test split; stays up after the whole run finishes */}
      {(showTest || (isDone && hasTestMetrics)) && (
        <EvaluationPanel
          {...evalProps}
          state={event === "testing_complete" || isDone ? "done" : "running"}
          onStop={active ? stopTraining : undefined}
        />
      )}
    </>
  );
}
