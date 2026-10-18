import { useEffect, useRef, useState } from "preact/hooks";
import { navigate, routeParams } from "../state/router.js";
import { allRuns, projectRuns, loadRunScalars, loadRunHparams } from "../state/experiments.js";
import { MetricChart } from "../components/dashboard/MetricChart.jsx";
import { useEscape } from "../hooks/useEscape.js";
import {
  ChartBarsIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  SlidersIcon,
  TrophyIcon,
  XIcon,
} from "../components/dashboard/icons.jsx";
import { formatPercent, formatRelativeTime } from "../utils/format.js";
import { formatLabel } from "../utils/hparams.js";
import { lowerIsBetter } from "../utils/runMetrics.js";
import {
  RUN_COLORS,
  MAX_COMPARE,
  metricsBySplit,
  compareSplits,
  headlineMetrics,
  configRows,
  leader,
  formatValue,
  formatDelta,
  comparisonMarkdown,
} from "../utils/compareRuns.js";

const STATUS = {
  completed: { label: "Completed", tone: "ok" },
  running: { label: "Running", tone: "live" },
  failed: { label: "Failed", tone: "err" },
  queued: { label: "Queued", tone: "idle" },
};

const PlusIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const ArrowUpIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const ArrowDownIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);

/** Scores in [0, 1] read as percentages; losses and the rest as numbers. */
const kindOf = (name, values) => (!lowerIsBetter(name) && values.length > 0 && values.every((v) => v >= 0 && v <= 1) ? "score" : "number");
const tickFor = (kind) => (kind === "score" ? (v) => `${Math.round(v * 100)}%` : (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : String(+v.toFixed(2))));
const runName = (r) => r.name || r.id;

function Dot({ color }) {
  return <i class="cmp-dot" style={{ background: color }} />;
}

/** Leader's margin over the runner-up, arrow pointing the way the metric improves. */
function Delta({ kind, lead, lower, title }) {
  if (!lead || lead.delta === 0) return null;
  return (
    <span class="cmp-delta" title={title}>
      {lower ? <ArrowDownIcon /> : <ArrowUpIcon />}
      {formatDelta(kind, lead.delta)}
    </span>
  );
}

/** Popover listing the project's other runs. */
function RunPicker({ candidates, onPick, onClose, align = "right" }) {
  const ref = useRef(null);
  useEscape(true, onClose);
  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div class={`cmp-picker cmp-picker--${align}`} ref={ref} role="menu">
      {candidates.length === 0 ? (
        <span class="cmp-picker-empty">No other runs in this project.</span>
      ) : (
        candidates.map((r) => (
          <button key={r.id} role="menuitem" class="cmp-picker-item" onClick={() => onPick(r.id)}>
            <span class="cmp-picker-name">{runName(r)}</span>
            <span class="cmp-picker-meta">
              {STATUS[r.status]?.label || r.status}
              {r.created && ` · ${formatRelativeTime(r.created)}`}
              {Number.isFinite(r.bestAcc) && ` · val ${formatPercent(r.bestAcc)}`}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function RunCard({ run, color, candidates, onReplace, onRemove }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[run.status] || { label: run.status || "Unknown", tone: "idle" };
  const when = run.finishedAt || run.created;
  const close = () => setOpen(false);

  return (
    <section class="cmp-run" style={{ "--run": color }}>
      <div class="cmp-run-top">
        <span class="cmp-run-swatch" />
        <button class="cmp-run-name" onClick={() => navigate("run-detail", { runId: run.id })} title="Open run">
          {runName(run)}
        </button>
        <div class="cmp-run-actions">
          <div class="cmp-picker-anchor">
            <button class="dash-btn dash-btn--quiet cmp-change" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
              Change run <ChevronDownIcon size={14} />
            </button>
            {open && <RunPicker candidates={candidates} onClose={close} onPick={(id) => { close(); onReplace(id); }} />}
          </div>
          {onRemove && (
            <button class="dash-icon-btn" onClick={onRemove} aria-label={`Remove ${runName(run)} from the comparison`} title="Remove from comparison">
              <XIcon size={14} />
            </button>
          )}
        </div>
      </div>
      <dl class="cmp-run-meta">
        <div><dt class="sr-only">Status</dt><dd><span class={`rd-status rd-tone--${status.tone}`}><span class="rd-status-dot" />{status.label}</span></dd></div>
        <div><dt>Backbone</dt><dd>{run.backbone || run.model || "—"}</dd></div>
        {when && (
          <div>
            <dt>{run.finishedAt ? "Finished" : "Started"}</dt>
            <dd title={new Date(when).toLocaleString()}>
              {new Date(when).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </dd>
          </div>
        )}
        <div><dt>Epochs</dt><dd>{run.epochs || "—"}</dd></div>
      </dl>
    </section>
  );
}

function AddRunCard({ candidates, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="cmp-picker-anchor cmp-run cmp-run--empty">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <PlusIcon /> Pick a run to compare against
      </button>
      {open && <RunPicker align="left" candidates={candidates} onClose={() => setOpen(false)} onPick={(id) => { setOpen(false); onPick(id); }} />}
    </div>
  );
}

function Headline({ runs, colors, metrics }) {
  return (
    <section class="cmp-glance">
      <div class="cmp-glance-intro">
        <h3><TrophyIcon size={16} /> Winner at a glance</h3>
        <span>Best value per run. Higher is better, except loss and time.</span>
      </div>
      {metrics.length === 0 ? (
        <span class="cmp-muted cmp-glance-empty">Not enough shared metrics to compare yet.</span>
      ) : (
        metrics.map((m) => {
          const { lead } = m;
          const shown = lead ? [lead.index, lead.runnerUp] : [];
          const all = m.values.map((v, i) => `${runName(runs[i])}: ${formatValue(m.kind, v)}`).join("\n");
          return (
            <div key={m.id} class="cmp-glance-cell" title={all}>
              <span class="cmp-glance-label">{m.label}</span>
              <div class="cmp-glance-values">
                {shown.map((i, k) => (
                  <span key={i} class={k === 0 ? "cmp-glance-lead" : "cmp-glance-next"}>
                    <Dot color={colors[i]} />
                    {formatValue(m.kind, m.values[i])}
                  </span>
                ))}
                <Delta kind={m.kind} lead={lead} lower={m.lower} title={lead && `${runName(runs[lead.index])} leads ${runName(runs[lead.runnerUp])}`} />
              </div>
              {runs.length > 2 && lead && <span class="cmp-glance-who">{runName(runs[lead.index])} leads</span>}
            </div>
          );
        })
      )}
    </section>
  );
}

function Legend({ runs, colors, indices }) {
  return (
    <div class="rd-legend cmp-legend">
      {indices.map((i) => (
        <span key={i}><i style={{ background: colors[i] }} />{runName(runs[i])}</span>
      ))}
    </div>
  );
}

/** One metric's curves, one line per run. */
function CurveCard({ name, runs, colors, perRun }) {
  const present = perRun.map((v, i) => (v?.length ? i : -1)).filter((i) => i >= 0);
  const all = present.flatMap((i) => perRun[i]);
  const kind = kindOf(name, all);
  const lower = lowerIsBetter(name);
  const finals = perRun.map((v) => (v?.length ? v[v.length - 1] : undefined));
  const lead = leader(finals, lower);
  const fmt = (v) => formatValue(kind, v);

  return (
    <section class="rd-chart cmp-chart">
      <header>
        <div class="cmp-chart-title">
          <h4>{formatLabel(name)}</h4>
          <Delta kind={kind} lead={lead} lower={lower} title={lead && `Last epoch: ${runName(runs[lead.index])} leads ${runName(runs[lead.runnerUp])}`} />
        </div>
        <Legend runs={runs} colors={colors} indices={present} />
      </header>
      <MetricChart
        height={210}
        series={present.map((i) => ({ label: runName(runs[i]), data: perRun[i], color: colors[i] }))}
        yFormat={fmt}
        tickFormat={tickFor(kind)}
        endLabels
        dots
        empty="No values logged"
      />
    </section>
  );
}

/** Single-value metrics (a test pass): one bar per run. */
function BarsCard({ name, runs, colors, perRun }) {
  const values = perRun.map((v) => (v?.length ? v[v.length - 1] : undefined));
  const present = values.map((v, i) => (Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  const kind = kindOf(name, present.map((i) => values[i]));
  const lower = lowerIsBetter(name);
  const lead = leader(values, lower);
  const max = Math.max(...present.map((i) => Math.abs(values[i])), 1e-9);
  const scale = kind === "score" ? 1 : max;

  return (
    <section class="rd-chart cmp-chart">
      <header>
        <div class="cmp-chart-title">
          <h4>{formatLabel(name)}</h4>
          <Delta kind={kind} lead={lead} lower={lower} />
        </div>
        {lower && <span class="cmp-muted cmp-small">Lower is better</span>}
      </header>
      <div class="cmp-bars">
        {present.map((i) => (
          <div key={i} class={`cmp-bar-row${lead?.index === i ? " cmp-bar-row--lead" : ""}`}>
            <span class="cmp-bar-name"><Dot color={colors[i]} />{runName(runs[i])}</span>
            <div class="cmp-bar"><span style={{ width: `${Math.max(1, (Math.abs(values[i]) / scale) * 100)}%`, background: colors[i] }} /></div>
            <strong>{formatValue(kind, values[i])}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ConfigCard({ runs, colors, rows }) {
  const [showAll, setShowAll] = useState(false);
  const diff = rows.filter((r) => r.differs);
  const shown = showAll ? rows : diff;

  return (
    <section class="cmp-config">
      <div class="cmp-config-intro">
        <h3><SlidersIcon size={15} /> Configuration differences</h3>
        <span>
          {diff.length === 0
            ? "Every recorded setting is the same."
            : `${diff.length} of ${rows.length} settings differ. ${showAll ? "Differences are highlighted." : "Only those are shown."}`}
        </span>
        {rows.length > diff.length && (
          <button class="rd-more" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
            {showAll ? "Show differences only" : `Show all ${rows.length} settings`}
            <span class={showAll ? "rd-chev-open" : undefined}><ChevronDownIcon size={14} /></span>
          </button>
        )}
      </div>
      {shown.length > 0 ? (
        <div class="cmp-config-wrap">
          <table class="cmp-config-table" style={{ "--cols": runs.length }}>
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                {runs.map((r, i) => (
                  <th key={r.id} scope="col" style={{ "--run": colors[i] }}><Dot color={colors[i]} />{runName(r)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key} class={row.differs ? "cmp-row--diff" : undefined}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i} style={{ "--run": colors[i] }} title={v}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <span class="cmp-muted cmp-config-empty">
          {rows.length === 0 ? "No settings were recorded for these runs." : "Nothing to show."}
        </span>
      )}
    </section>
  );
}

export function CompareRunsView() {
  const ids = Array.isArray(routeParams.value.runIds) ? routeParams.value.runIds : [];
  const runs = ids.map((id) => allRuns.value.find((r) => r.id === id)).filter(Boolean).slice(0, MAX_COMPARE);
  const colors = runs.map((_, i) => RUN_COLORS[i]);
  const [loading, setLoading] = useState(false);
  const [split, setSplit] = useState(null);
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = runs.map((r) => r.id).join(",");

  // Load curves and hparams.yaml for runs that don't have them cached.
  useEffect(() => {
    const missing = runs.filter((r) => !r.scalars || Object.keys(r.scalars).length === 0);
    const noHparams = runs.filter((r) => !missing.includes(r) && !r.fileHparams);
    if (!missing.length && !noHparams.length) return;
    setLoading(missing.length > 0);
    Promise.all([...missing.map((r) => loadRunScalars(r)), ...noHparams.map((r) => loadRunHparams(r))]).finally(() => setLoading(false));
  }, [key]);

  const setRuns = (next) => navigate("compare-runs", { runIds: next });
  const inComparison = new Set(runs.map((r) => r.id));
  const candidates = projectRuns.value
    .filter((r) => !inComparison.has(r.id))
    .sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));

  const bySplit = runs.map((r) => metricsBySplit(r.scalars));
  const splits = compareSplits(bySplit);
  const activeSplit = splits.find((s) => s.id === split) || splits.find((s) => s.id === "val") || splits[0];
  const headline = headlineMetrics(runs, bySplit);
  const rows = configRows(runs);

  if (runs.length === 0) {
    return (
      <div class="run-detail-view dash rd cmp">
        <div class="rd-missing">
          <strong>No runs selected</strong>
          <span>Select two or more runs in Experiments to compare them.</span>
          <button class="dash-btn dash-btn--quiet" onClick={() => navigate("experiments")}>Back to Experiments</button>
        </div>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(comparisonMarkdown(runs, headline, rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div class="run-detail-view dash rd cmp">
      <header class="cmp-head">
        <div>
          <h2>Compare runs</h2>
          <span>Side-by-side metrics and configuration for {runs.length} runs.</span>
        </div>
        <div class="cmp-head-actions">
          {runs.length < MAX_COMPARE && (
            <div class="cmp-picker-anchor">
              <button class="dash-btn dash-btn--quiet" onClick={() => setAdding(!adding)} aria-expanded={adding} aria-haspopup="menu">
                <PlusIcon /> Add run
              </button>
              {adding && (
                <RunPicker
                  candidates={candidates}
                  onClose={() => setAdding(false)}
                  onPick={(id) => { setAdding(false); setRuns([...runs.map((r) => r.id), id]); }}
                />
              )}
            </div>
          )}
          <button class="dash-btn dash-btn--quiet" onClick={copy} title="Copy the comparison as Markdown tables">
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            {copied ? "Copied" : "Copy as Markdown"}
          </button>
        </div>
      </header>

      <div class="cmp-runs">
        {runs.map((r, i) => (
          <RunCard
            key={r.id}
            run={r}
            color={colors[i]}
            candidates={candidates}
            onReplace={(id) => setRuns(runs.map((x) => (x.id === r.id ? id : x.id)))}
            onRemove={runs.length > 2 ? () => setRuns(runs.filter((x) => x.id !== r.id).map((x) => x.id)) : null}
          />
        ))}
        {runs.length === 1 && <AddRunCard candidates={candidates} onPick={(id) => setRuns([runs[0].id, id])} />}
      </div>

      {runs.length > 1 && <Headline runs={runs} colors={colors} metrics={headline} />}

      {splits.length > 0 && (
        <div class="rd-tabs" role="tablist">
          {splits.map((s) => (
            <button key={s.id} role="tab" aria-selected={activeSplit?.id === s.id} class={`rd-tab${activeSplit?.id === s.id ? " active" : ""}`} onClick={() => setSplit(s.id)}>
              {s.label}
              <span class="rd-tab-count">{s.metrics.length}</span>
            </button>
          ))}
        </div>
      )}

      {loading && splits.length === 0 ? (
        <div class="rd-charts cmp-charts">
          {[0, 1, 2, 3].map((i) => <div key={i} class="rd-chart rd-skeleton" />)}
        </div>
      ) : splits.length === 0 ? (
        <div class="rd-empty">
          <ChartBarsIcon size={22} />
          <strong>No metrics to compare</strong>
          <span>None of these runs have logged metrics, or their log files are missing.</span>
        </div>
      ) : (
        <div class="rd-charts cmp-charts">
          {activeSplit.metrics.map((name) => {
            const perRun = bySplit.map((s) => s[activeSplit.id]?.[name]);
            const curve = perRun.some((v) => v?.length > 1);
            const Card = curve ? CurveCard : BarsCard;
            return <Card key={`${activeSplit.id}/${name}`} name={name} runs={runs} colors={colors} perRun={perRun} />;
          })}
        </div>
      )}

      <ConfigCard runs={runs} colors={colors} rows={rows} />
    </div>
  );
}
