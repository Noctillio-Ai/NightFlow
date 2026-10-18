import { useState } from "preact/hooks";
import { classificationStats, confusedPairs } from "../../utils/classificationStats.js";
import { AlertIcon, ArrowRightIcon, ChartBarsIcon, CheckCircleIcon, TrophyIcon } from "../dashboard/icons.jsx";

const STAGE_LABELS = { test: "Test", val: "Validation", train: "Train" };
const STAGE_ORDER = ["test", "val", "train"];
const SORTS = [
  { id: "f1", label: "F1" },
  { id: "precision", label: "Precision" },
  { id: "recall", label: "Recall" },
  { id: "class", label: "Class" },
];

const pct = (v, digits = 1) => (Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : "—");
const count = (v) => (Number.isFinite(v) ? v.toLocaleString() : "—");

const GridIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const ShuffleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
);

function Tile({ icon, tone, label, value, detail }) {
  return (
    <div class={`cr-tile cr-tone--${tone}`}>
      <span class="cr-tile-icon">{icon}</span>
      <div>
        <span class="cr-tile-label">{label}</span>
        <strong class="cr-tile-value" title={value}>{value}</strong>
        <span class="cr-tile-detail">{detail}</span>
      </div>
    </div>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div class="cr-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} class={value === o.id ? "active" : ""} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Matrix({ matrix, labels, rowSum, mode }) {
  // Colour by share of the actual class, so big and small classes compare fairly.
  const offMax = Math.max(1e-9, ...matrix.flatMap((row, i) => row.map((v, j) => (i === j ? 0 : (Number(v) || 0) / (rowSum[i] || 1)))));
  return (
    <div class="cr-matrix-wrap">
      <table class="cr-matrix">
        <thead>
          <tr>
            <th class="cr-corner" scope="col"><span>Actual ↓ · Predicted →</span></th>
            {labels.map((l) => <th key={l} scope="col" title={l}><span>{l}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={i}>
              <th scope="row" title={labels[i]}>{labels[i]}</th>
              {row.map((v, j) => {
                const n = Number(v) || 0;
                const share = rowSum[i] ? n / rowSum[i] : 0;
                const diag = i === j;
                // Correct: green by share. Mistakes: amber relative to the worst mistake.
                const strength = diag ? share : share / offMax;
                const style = n === 0 && !diag ? undefined : { "--a": (diag ? 0.18 + 0.62 * strength : 0.03 + 0.62 * strength).toFixed(3) };
                return (
                  <td
                    key={j}
                    class={`cr-cell${diag ? " cr-cell--hit" : n ? " cr-cell--miss" : ""}${strength > 0.6 ? " cr-cell--strong" : ""}`}
                    style={style}
                    title={`Actual ${labels[i]} → predicted ${labels[j]}: ${count(n)} (${pct(share)} of ${labels[i]})`}
                  >
                    {mode === "rate" ? (share ? pct(share, share < 0.1 ? 1 : 0) : "0") : count(n)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Confusion matrix + per-class report for one or more evaluated splits.
 * stages: { test|val|train: { cm, pcm, labels } } as built by RunDetailView.
 */
export function ClassificationReport({ stages }) {
  const available = STAGE_ORDER.filter((s) => stages[s]?.cm);
  const [stage, setStage] = useState(available[0]);
  const [mode, setMode] = useState("count");
  const [sortBy, setSortBy] = useState("f1");

  const current = stages[available.includes(stage) ? stage : available[0]];
  const matrix = current?.cm?.matrix || (Array.isArray(current?.cm) ? current.cm : null);
  const stats = matrix ? classificationStats(matrix, current.labels, current.pcm) : null;

  if (!stats) {
    return <div class="rd-empty"><strong>No confusion matrix</strong><span>This run didn't log one.</span></div>;
  }

  const labels = stats.classes.map((c) => c.label);
  const pairs = confusedPairs(matrix, 5);
  const sorted = [...stats.classes].sort((a, b) =>
    sortBy === "class" ? a.index - b.index : b[sortBy] - a[sortBy] || a.index - b.index,
  );
  const stageName = STAGE_LABELS[available.includes(stage) ? stage : available[0]];
  const worstFlagged = stats.flagged.has(stats.worst.index);

  return (
    <div class="cr">
      {available.length > 1 && (
        <div class="cr-stagebar">
          <span>Evaluated on</span>
          <Segmented label="Split" value={stage} onChange={setStage} options={available.map((s) => ({ id: s, label: STAGE_LABELS[s] }))} />
        </div>
      )}

      <div class="cr-tiles">
        <Tile tone="ok" icon={<CheckCircleIcon size={20} />} label={`${stageName} accuracy`} value={pct(stats.accuracy)} detail={`${count(stats.total)} images`} />
        <Tile tone="blue" icon={<ChartBarsIcon size={20} />} label="Macro F1" value={pct(stats.macroF1)} detail={`Average over ${stats.classes.length} classes`} />
        <Tile tone="gold" icon={<TrophyIcon size={20} />} label="Best class" value={stats.best.label} detail={`${pct(stats.best.f1)} F1`} />
        <Tile
          tone={worstFlagged ? "warn" : "muted"}
          icon={<AlertIcon size={20} />}
          label={worstFlagged ? "Needs review" : "Weakest class"}
          value={stats.worst.label}
          detail={`${pct(stats.worst.f1)} F1${worstFlagged ? " · well below average" : ""}`}
        />
      </div>

      <div class="cr-grid">
        <section class="cr-card">
          <header class="cr-card-head">
            <span class="cr-card-icon"><GridIcon /></span>
            <div class="cr-card-title">
              <h4>Confusion matrix</h4>
              <span>Rows are the actual class, columns the prediction</span>
            </div>
            <Segmented label="Show" value={mode} onChange={setMode} options={[{ id: "count", label: "Count" }, { id: "rate", label: "Rate" }]} />
          </header>
          <Matrix matrix={matrix} labels={labels} rowSum={stats.rowSum} mode={mode} />
        </section>

        <section class="cr-card">
          <header class="cr-card-head">
            <span class="cr-card-icon"><ShuffleIcon /></span>
            <div class="cr-card-title">
              <h4>Most confused pairs</h4>
              <span>Largest mistakes, as a share of the actual class</span>
            </div>
          </header>
          {pairs.length === 0 ? (
            <span class="cr-muted">No mistakes on this split.</span>
          ) : (
            <ol class="cr-pairs">
              {pairs.map((p) => (
                <li key={`${p.actual}-${p.predicted}`}>
                  <div class="cr-pair-names">
                    <strong>{labels[p.actual]}</strong>
                    <ArrowRightIcon size={14} />
                    <strong>{labels[p.predicted]}</strong>
                  </div>
                  <div class="cr-pair-bar"><span style={{ width: `${Math.min(100, p.share * 100 / Math.max(...pairs.map((x) => x.share)))}%` }} /></div>
                  <span class="cr-pair-meta">
                    {count(p.count)} images · {pct(p.share)} of {labels[p.actual]}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section class="cr-card">
        <header class="cr-card-head">
          <span class="cr-card-icon"><ChartBarsIcon size={18} /></span>
          <div class="cr-card-title">
            <h4>Per-class performance</h4>
            <span>{sortBy === "class" ? "In class order" : `Sorted by ${SORTS.find((s) => s.id === sortBy).label}, highest first`}</span>
          </div>
          <Segmented label="Sort by" value={sortBy} onChange={setSortBy} options={SORTS} />
        </header>
        <div class="cr-table-wrap">
          <table class="cr-table">
            <thead>
              <tr>
                <th class="num">#</th>
                <th>Class</th>
                <th class="cr-bar-col"><span class="sr-only">{sortBy === "class" ? "F1" : SORTS.find((s) => s.id === sortBy).label} bar</span></th>
                <th class="num">Precision</th>
                <th class="num">Recall</th>
                <th class="num">F1</th>
                <th class="num">Images</th>
                <th><span class="sr-only">Status</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, rank) => {
                const flagged = stats.flagged.has(c.index);
                const barValue = sortBy === "class" ? c.f1 : c[sortBy];
                return (
                  <tr key={c.index} class={flagged ? "cr-row--flag" : undefined}>
                    <td class="num cr-muted">{rank + 1}</td>
                    <td class="cr-class">{c.label}</td>
                    <td class="cr-bar-col"><div class="cr-bar"><span style={{ width: `${barValue * 100}%` }} /></div></td>
                    <td class={`num${sortBy === "precision" ? " cr-sorted" : ""}`}>{pct(c.precision)}</td>
                    <td class={`num${sortBy === "recall" ? " cr-sorted" : ""}`}>{pct(c.recall)}</td>
                    <td class={`num${sortBy === "f1" ? " cr-sorted" : ""}`}>{pct(c.f1)}</td>
                    <td class="num cr-muted">{count(c.support)}</td>
                    <td>{flagged && <span class="cr-flag" title="F1 is more than 10 points below the class average">Review</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
