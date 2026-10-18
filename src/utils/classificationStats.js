// Summary statistics for a classification confusion matrix
// (rows = actual class, columns = predicted class).

const safeDiv = (a, b) => (b > 0 ? a / b : 0);

/**
 * Per-class precision / recall / F1 and support, plus overall accuracy and
 * macro F1. Precision/recall/F1 come from `perClass` (AutoTimm's own numbers)
 * when given, otherwise from the matrix; support always comes from the matrix.
 */
export function classificationStats(matrix, labels = [], perClass = null) {
  const n = Array.isArray(matrix) ? matrix.length : 0;
  if (!n) return null;
  const rowSum = matrix.map((row) => row.reduce((s, v) => s + (Number(v) || 0), 0));
  const colSum = matrix[0].map((_, j) => matrix.reduce((s, row) => s + (Number(row[j]) || 0), 0));
  const total = rowSum.reduce((s, v) => s + v, 0);
  const correct = matrix.reduce((s, row, i) => s + (Number(row[i]) || 0), 0);
  const given = new Map((perClass || []).map((m, i) => [m.class_index ?? i, m]));

  const classes = matrix.map((row, i) => {
    const tp = Number(row[i]) || 0;
    const fromMatrix = {
      precision: safeDiv(tp, colSum[i]),
      recall: safeDiv(tp, rowSum[i]),
    };
    fromMatrix.f1 = safeDiv(2 * fromMatrix.precision * fromMatrix.recall, fromMatrix.precision + fromMatrix.recall);
    const m = given.get(i);
    return {
      index: i,
      label: labels[i] ?? `Class ${i}`,
      support: rowSum[i],
      correct: tp,
      precision: Number.isFinite(m?.precision) ? m.precision : fromMatrix.precision,
      recall: Number.isFinite(m?.recall) ? m.recall : fromMatrix.recall,
      f1: Number.isFinite(m?.f1) ? m.f1 : fromMatrix.f1,
    };
  });

  const macroF1 = classes.reduce((s, c) => s + c.f1, 0) / n;
  const byF1 = [...classes].sort((a, b) => b.f1 - a.f1);
  return {
    total,
    accuracy: safeDiv(correct, total),
    macroF1,
    classes,
    best: byF1[0],
    worst: byF1[byF1.length - 1],
    // Clearly behind the rest: F1 more than 10 points under the macro average.
    flagged: new Set(classes.filter((c) => c.f1 < macroF1 - 0.1).map((c) => c.index)),
    rowSum,
  };
}

/** The largest off-diagonal cells: [{ actual, predicted, count, share }], share = count / actual-class size. */
export function confusedPairs(matrix, limit = 5) {
  const pairs = [];
  (matrix || []).forEach((row, i) => {
    const size = row.reduce((s, v) => s + (Number(v) || 0), 0);
    row.forEach((v, j) => {
      const count = Number(v) || 0;
      if (i !== j && count > 0) pairs.push({ actual: i, predicted: j, count, share: safeDiv(count, size) });
    });
  });
  return pairs.sort((a, b) => b.count - a.count || b.share - a.share).slice(0, limit);
}
