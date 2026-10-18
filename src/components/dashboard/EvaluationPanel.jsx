import { allRuns } from "../../state/experiments.js";
import { navigate } from "../../state/router.js";
import { CheckCircleIcon, ArrowRightIcon, XIcon, AlertIcon } from "./icons.jsx";

// Headline metrics first; anything else AutoTimm reports follows alphabetically.
const ORDER = ["accuracy", "f1", "precision", "recall", "loss"];
const LABELS = { accuracy: "Accuracy", f1: "F1 score", precision: "Precision", recall: "Recall", loss: "Loss" };

const metricName = (key) => key.replace(/^test\//, "");

function sortMetrics(entries) {
  const rank = (k) => {
    const i = ORDER.indexOf(metricName(k).toLowerCase());
    return i === -1 ? ORDER.length : i;
  };
  return entries.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

function labelFor(key) {
  const name = metricName(key);
  return LABELS[name.toLowerCase()] || name.replace(/[_/]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Scores in [0, 1] read as percentages; losses and anything else as numbers. */
function formatMetric(key, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return { text: "—", pct: null };
  const isLoss = /loss/i.test(metricName(key));
  if (!isLoss && value >= 0 && value <= 1) return { text: `${(value * 100).toFixed(1)}%`, pct: value * 100 };
  return { text: Math.abs(value) < 10 ? value.toFixed(4) : value.toFixed(2), pct: null };
}

function MetricTile({ name, value, hero }) {
  const { text, pct } = formatMetric(name, value);
  return (
    <div class={`dash-eval-metric${hero ? " dash-eval-metric--hero" : ""}`} title={String(value)}>
      <span class="dash-eval-metric-label">{labelFor(name)}</span>
      <span class="dash-eval-metric-value">{text}</span>
      {pct != null ? (
        <div class="dash-bar dash-bar--eval"><div class="dash-bar-fill" style={{ width: `${pct}%` }} /></div>
      ) : (
        <span class="dash-eval-metric-note">Lower is better</span>
      )}
    </div>
  );
}

/**
 * Test-split evaluation status: running progress, the finished metrics, or the
 * error. `state` is "running" | "done" | "error".
 */
export function EvaluationPanel({ state, metrics = {}, batch = 0, totalBatches = 0, error, runId, onStop, onDismiss }) {
  const run = runId ? allRuns.value.find((r) => r.id === runId) : null;
  const runName = run?.name || run?.id;
  const entries = sortMetrics(Object.entries(metrics).filter(([, v]) => typeof v === "number"));
  const pct = totalBatches > 0 ? Math.min(100, (batch / totalBatches) * 100) : 0;

  const title = state === "done" ? "Evaluation complete" : state === "error" ? "Evaluation failed" : "Evaluating";
  const subtitle =
    state === "running"
      ? totalBatches > 0
        ? `Batch ${batch} of ${totalBatches} on the test split`
        : "Preparing the test split…"
      : state === "done"
        ? `${entries.length} ${entries.length === 1 ? "metric" : "metrics"} on the test split`
        : "The test step didn't finish";

  return (
    <section class={`dash-eval dash-eval--${state}`} aria-live="polite">
      <header class="dash-eval-head">
        <span class="dash-eval-icon" aria-hidden="true">
          {state === "running" ? <span class="dash-eval-spinner" /> : state === "done" ? <CheckCircleIcon size={18} /> : <AlertIcon size={18} />}
        </span>
        <div class="dash-eval-text">
          <strong>
            {title}
            {runName && <span class="dash-eval-run">{runName}</span>}
          </strong>
          <span>{subtitle}</span>
        </div>
        <div class="dash-eval-actions">
          {state === "running" && onStop && (
            <button class="dash-btn dash-btn--danger dash-btn--sm" onClick={onStop}>Stop</button>
          )}
          {state !== "running" && run && (
            <button class="dash-btn dash-btn--quiet dash-btn--sm" onClick={() => navigate("run-detail", { runId: run.id })}>
              View run <ArrowRightIcon size={14} />
            </button>
          )}
          {state !== "running" && onDismiss && (
            <button class="dash-icon-btn" onClick={onDismiss} title="Dismiss" aria-label="Dismiss evaluation results">
              <XIcon size={15} />
            </button>
          )}
        </div>
      </header>

      {state === "running" && (
        <div class="dash-bar dash-bar--eval dash-eval-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div class="dash-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}

      {entries.length > 0 && (
        <div class="dash-eval-metrics">
          {entries.map(([k, v], i) => <MetricTile key={k} name={k} value={v} hero={i === 0} />)}
        </div>
      )}

      {state === "error" && error && <div class="dash-note dash-note--err dash-eval-error">{error}</div>}
    </section>
  );
}
