// Per-epoch series for dashboard charts. Runs trained in-app carry
// `lossCurve`/`accCurve`; runs imported by sync usually only have `scalars`
// ({ [tag]: [{ step, value }] }), so fall back to the matching scalar tag.

const TAGS = {
  trainLoss: ["train/loss_epoch", "train/loss", "train_loss", "loss"],
  valLoss: ["val/loss", "val_loss"],
  valAcc: ["val/accuracy", "val/acc", "val_accuracy", "val_acc"],
};

/** Scalar points → values ordered by step, keeping the last value per step. */
function scalarValues(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const byStep = new Map();
  for (const p of points) {
    if (p && Number.isFinite(p.value)) byStep.set(p.step ?? byStep.size, p.value);
  }
  return [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

function fromScalars(run, kind) {
  const scalars = run?.scalars || {};
  for (const tag of TAGS[kind]) {
    const values = scalarValues(scalars[tag]);
    if (values.length) return values;
  }
  return [];
}

const finite = (arr) => (Array.isArray(arr) ? arr.filter((v) => Number.isFinite(v)) : []);

/** { trainLoss, valLoss, valAcc } — each a plain number[] (possibly empty). */
export function runSeries(run) {
  if (!run) return { trainLoss: [], valLoss: [], valAcc: [] };
  const lossCurve = finite(run.lossCurve);
  const accCurve = finite(run.accCurve);
  return {
    trainLoss: lossCurve.length ? lossCurve : fromScalars(run, "trainLoss"),
    valLoss: fromScalars(run, "valLoss"),
    valAcc: accCurve.length ? accCurve : fromScalars(run, "valAcc"),
  };
}

/** Index of the maximum value, or -1 for an empty series. */
export function argMax(values) {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (best === -1 || values[i] > values[best]) best = i;
  }
  return best;
}

/** Last path segment of a file path (POSIX or Windows), ignoring a trailing slash. */
export function baseName(path) {
  if (!path) return "";
  const parts = String(path).replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || String(path);
}
