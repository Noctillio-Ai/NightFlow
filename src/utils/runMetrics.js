// Turns a run's logged scalars ({ "train/loss": [{ step|epoch, value }], … })
// into charts that pair training and validation curves per metric, plus a few
// facts that are safe to state about a finished run.

// Structured outputs stored alongside the scalars, not curves.
const NON_SCALAR = /(?:^|\/)(?:confusion_matrix|per_class_metrics)$/;
// Preferred chart order; anything else follows alphabetically.
const ORDER = ["loss", "accuracy", "acc", "f1", "precision", "recall"];

/** Points → values ordered by epoch/step, keeping the last value per step. */
export function seriesOf(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  if (typeof points[0] === "number") return points.filter((v) => Number.isFinite(v));
  const byStep = new Map();
  points.forEach((p, i) => {
    if (p && Number.isFinite(p.value)) byStep.set(p.step ?? p.epoch ?? i, p.value);
  });
  return [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Position of a metric in the preferred chart order (unknown names last). */
export function rankMetric(name) {
  const i = ORDER.indexOf(String(name).toLowerCase());
  return i === -1 ? ORDER.length : i;
}

/** Losses and errors improve downwards; everything else upwards. */
export const lowerIsBetter = (name) => /loss|error|mae|mse|rmse/i.test(name);

/** Index of the best value (min or max), or -1. */
export function bestIndex(values, lowerBetter) {
  let best = -1;
  values.forEach((v, i) => {
    if (best === -1 || (lowerBetter ? v < values[best] : v > values[best])) best = i;
  });
  return best;
}

/**
 * Chartable metrics, train and validation paired by name:
 * [{ name, train: number[], val: number[] }]. Test metrics (single values) and
 * sanity-check passes are left out; other tags (e.g. a learning-rate log) get
 * their own single-series chart under `train`.
 */
export function pairMetrics(scalars = {}) {
  const groups = new Map();
  const group = (name) => {
    if (!groups.has(name)) groups.set(name, { name, train: [], val: [] });
    return groups.get(name);
  };
  for (const [tag, points] of Object.entries(scalars)) {
    if (NON_SCALAR.test(tag) || /^sanity_val|^test[/_]/.test(tag)) continue;
    const m = tag.match(/^(train|val)[/_](.+)$/);
    if (m) {
      // Lightning logs "loss_step" and "loss_epoch"; the epoch series is the curve.
      if (/_step$/.test(m[2])) continue;
      const name = m[2].replace(/_epoch$/, "");
      const values = seriesOf(points);
      const g = group(name);
      if (values.length > g[m[1]].length) g[m[1]] = values;
    } else {
      const values = seriesOf(points);
      if (values.length > 1) group(tag).train = values;
    }
  }
  return [...groups.values()]
    .filter((g) => g.train.length + g.val.length > 1)
    .sort((a, b) => rankMetric(a.name) - rankMetric(b.name) || a.name.localeCompare(b.name));
}

/**
 * At most one observation worth calling out, or null. Only fires on clear
 * signals so it never guesses:
 * - overfitting: validation loss rose ≥5% from its best while training loss kept falling
 * - still improving: validation accuracy peaked on the last epoch after a real gain
 */
export function runInsight(metrics) {
  const loss = metrics.find((m) => m.name === "loss");
  if (loss && loss.val.length >= 4 && loss.train.length >= 2) {
    const best = bestIndex(loss.val, true);
    const last = loss.val.length - 1;
    const rise = (loss.val[last] - loss.val[best]) / Math.abs(loss.val[best] || 1);
    const trainFell = loss.train[loss.train.length - 1] < loss.train[Math.min(best, loss.train.length - 1)];
    if (best <= last - 2 && rise >= 0.05 && trainFell) {
      return {
        tone: "warn",
        title: `Validation loss rose ${Math.round(rise * 100)}% after epoch ${best + 1}`,
        // NightFlow keeps Lightning's default checkpoint, which is the last epoch's.
        detail: `Training loss kept falling, so the model is likely overfitting. The saved checkpoint is from the last epoch, not epoch ${best + 1}; early stopping on validation loss or stronger augmentation can help next time.`,
      };
    }
  }
  const acc = metrics.find((m) => m.name === "accuracy" || m.name === "acc");
  if (acc && acc.val.length >= 4) {
    const vals = acc.val;
    const last = vals.length - 1;
    const gain = vals[last] - vals[Math.max(0, last - 3)];
    if (bestIndex(vals, false) === last && gain >= 0.005) {
      return {
        tone: "info",
        title: "Validation accuracy was still improving at the last epoch",
        detail: `It gained ${(gain * 100).toFixed(1)} points over the final ${Math.min(3, last)} epochs. Training for more epochs may help.`,
      };
    }
  }
  return null;
}
