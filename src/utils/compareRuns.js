// Data for the Compare runs view: per-split metric curves, who leads on each
// headline number, and which hyperparameters differ between runs.

import { seriesOf, bestIndex, rankMetric } from "./runMetrics.js";
import { filterHparams, formatHparamValue, formatLabel } from "./hparams.js";

/** One colour per compared run, by position. */
export const RUN_COLORS = ["#3b82f6", "#a855f7", "#f59e0b", "#14b8a6", "#ec4899", "#84cc16"];
export const MAX_COMPARE = RUN_COLORS.length;

// Structured outputs stored alongside the scalars, not curves.
const NON_SCALAR = /(?:^|\/)(?:confusion_matrix|per_class_metrics)$/;

export const SPLIT_LABELS = { train: "Train", val: "Validation", test: "Test", sanity_val: "Sanity check", other: "Other" };
const SPLIT_ORDER = ["train", "val", "test", "sanity_val"];

/**
 * A run's scalars grouped by split: { train: { loss: number[] }, val: {…}, … }.
 * Lightning's per-step series are dropped and "_epoch" suffixes removed, so
 * "train/loss_epoch" and "train/loss" are the same curve.
 */
export function metricsBySplit(scalars = {}) {
  const out = {};
  for (const [tag, points] of Object.entries(scalars || {})) {
    if (NON_SCALAR.test(tag)) continue;
    const slash = tag.indexOf("/");
    const split = slash > 0 ? tag.slice(0, slash) : "other";
    const raw = slash > 0 ? tag.slice(slash + 1) : tag;
    if (/_step$/.test(raw)) continue;
    const name = raw.replace(/_epoch$/, "");
    const values = seriesOf(points);
    if (!values.length) continue;
    out[split] ||= {};
    if (values.length > (out[split][name]?.length || 0)) out[split][name] = values;
  }
  return out;
}

/** Splits present in any run, in a stable order, with the metric names in each. */
export function compareSplits(bySplitList) {
  const names = new Map();
  for (const bySplit of bySplitList) {
    for (const [split, metrics] of Object.entries(bySplit || {})) {
      if (!names.has(split)) names.set(split, new Set());
      Object.keys(metrics).forEach((m) => names.get(split).add(m));
    }
  }
  const rank = (s) => (SPLIT_ORDER.includes(s) ? SPLIT_ORDER.indexOf(s) : SPLIT_ORDER.length);
  return [...names.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([id, set]) => ({
      id,
      label: SPLIT_LABELS[id] || formatLabel(id),
      metrics: [...set].sort((a, b) => rankMetric(a) - rankMetric(b) || a.localeCompare(b)),
    }));
}

/**
 * The best value among runs and how far ahead it is of the next best:
 * { index, value, runnerUp, delta } or null when fewer than two runs have one.
 */
export function leader(values, lowerBetter) {
  const ranked = values
    .map((value, index) => ({ index, value }))
    .filter((e) => Number.isFinite(e.value))
    .sort((a, b) => (lowerBetter ? a.value - b.value : b.value - a.value));
  if (ranked.length < 2) return null;
  const [first, second] = ranked;
  return { index: first.index, value: first.value, runnerUp: second.index, runnerUpValue: second.value, delta: first.value - second.value };
}

/** Wall-clock training time in ms, or null if the run hasn't finished. */
export function runDurationMs(run) {
  if (!run?.created || !run?.finishedAt) return null;
  const ms = new Date(run.finishedAt) - new Date(run.created);
  return ms > 0 ? ms : null;
}

const extreme = (values, lower) => {
  const i = bestIndex(values || [], lower);
  return i >= 0 ? values[i] : undefined;
};

/**
 * Headline numbers per run, for the "winner at a glance" strip. Each entry has
 * one value per run (undefined when the run doesn't have it); only entries at
 * least two runs share are returned.
 */
export function headlineMetrics(runs, bySplitList) {
  const pick = (fn) => runs.map((r, i) => fn(r, bySplitList[i] || {}));
  const entries = [
    {
      id: "val_acc",
      label: "Validation accuracy",
      kind: "score",
      values: pick((r, s) => extreme(s.val?.accuracy || s.val?.acc, false) ?? r.bestAcc ?? undefined),
    },
    { id: "val_f1", label: "Validation F1", kind: "score", values: pick((r, s) => extreme(s.val?.f1, false)) },
    {
      id: "val_loss",
      label: "Lowest validation loss",
      kind: "number",
      lower: true,
      values: pick((r, s) => extreme(s.val?.loss, true) ?? r.valLoss ?? undefined),
    },
    {
      id: "test_acc",
      label: "Test accuracy",
      kind: "score",
      values: pick((r, s) => r.testAcc ?? extreme(s.test?.accuracy || s.test?.acc, false)),
    },
    { id: "time", label: "Training time", kind: "duration", lower: true, values: pick((r) => runDurationMs(r) ?? undefined) },
  ];
  return entries
    .map((e) => ({ ...e, values: e.values.map((v) => (Number.isFinite(v) ? v : undefined)) }))
    .filter((e) => e.values.filter((v) => v !== undefined).length >= 2)
    .map((e) => ({ ...e, lead: leader(e.values, !!e.lower) }));
}

// Settings stored under different names by the app (camelCase) and by
// hparams.yaml (snake_case) are the same setting.
const ALIASES = { learningrate: "lr" };
const canonical = (key) => {
  const k = key.toLowerCase().replace(/[_\s-]/g, "");
  return ALIASES[k] || k;
};
// Most relevant settings first; the rest alphabetically.
const PRIORITY = ["backbone", "dataset", "lr", "batchsize", "maxepochs", "optimizer", "scheduler", "augmentationpreset", "imagesize", "weightdecay", "precision", "seed"];

/**
 * Hyperparameters side by side:
 * [{ key, label, values: string[] (one per run, "—" if unset), differs }].
 * The file's hparams.yaml wins over the settings the app recorded.
 */
export function configRows(runs) {
  const perRun = runs.map((r) => {
    const merged = new Map();
    const add = (k, v) => {
      if (v === undefined || v === null || v === "") return;
      const c = canonical(k);
      merged.set(c, { label: merged.get(c)?.label || k, value: v });
    };
    add("backbone", r.backbone || r.model);
    add("dataset", r.dataset ? String(r.dataset).replace(/[\\/]+$/, "").split(/[\\/]/).pop() : undefined);
    Object.entries(filterHparams(r.hyperparameters || {})).forEach(([k, v]) => add(k, v));
    Object.entries(filterHparams(r.fileHparams || {})).forEach(([k, v]) => add(k, v));
    return merged;
  });

  const keys = new Map();
  perRun.forEach((m) => m.forEach((e, k) => !keys.has(k) && keys.set(k, e.label)));
  const rank = (k) => (PRIORITY.includes(k) ? PRIORITY.indexOf(k) : PRIORITY.length);

  return [...keys.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, rawLabel]) => {
      const values = perRun.map((m) => (m.has(key) ? formatHparamValue(key, m.get(key).value) : "—"));
      const label = key === "lr" ? "Learning rate" : formatLabel(rawLabel);
      return { key, label, values, differs: new Set(values).size > 1 };
    });
}

/** "12m 14s", "1h 05m", "48s". */
export function formatMs(ms) {
  if (!Number.isFinite(ms)) return "—";
  const secs = Math.round(Math.abs(ms) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${String(secs % 60).padStart(2, "0")}s`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** Value formatter for a headline kind. */
export function formatValue(kind, v) {
  if (!Number.isFinite(v)) return "—";
  if (kind === "score") return `${(v * 100).toFixed(1)}%`;
  if (kind === "duration") return formatMs(v);
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(4);
}

/** How far the leader is ahead, signed in the metric's own direction: "+1.0 pts", "−0.0530", "−3m 27s". */
export function formatDelta(kind, delta) {
  if (!Number.isFinite(delta)) return "";
  const sign = delta < 0 ? "−" : "+";
  const abs = Math.abs(delta);
  if (kind === "score") return `${sign}${(abs * 100).toFixed(1)} pts`;
  if (kind === "duration") return `${sign}${formatMs(abs)}`;
  return `${sign}${abs >= 100 ? abs.toFixed(1) : abs.toFixed(4)}`;
}

/** The comparison as Markdown tables, for pasting into notes or a PR. */
export function comparisonMarkdown(runs, headline, rows) {
  const names = runs.map((r) => r.name || r.id);
  const esc = (s) => String(s).replace(/\|/g, "\\|");
  const table = (head, body) =>
    [`| ${head.map(esc).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...body.map((r) => `| ${r.map(esc).join(" | ")} |`)].join("\n");

  const parts = [`## Run comparison: ${names.join(" vs ")}`];
  if (headline.length) {
    parts.push(
      table(
        ["Metric", ...names],
        headline.map((h) => [
          h.label,
          ...h.values.map((v, i) => `${formatValue(h.kind, v)}${h.lead?.index === i ? " **best**" : ""}`),
        ]),
      ),
    );
  }
  const diff = rows.filter((r) => r.differs);
  if (diff.length) parts.push("### Configuration differences", table(["Parameter", ...names], diff.map((r) => [r.label, ...r.values])));
  return parts.join("\n\n") + "\n";
}
