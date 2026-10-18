import { Fragment } from "preact";
import { signal } from "@preact/signals";
import { useCallback, useState } from "preact/hooks";
import {
  filteredRuns,
  projectRuns,
  filterText,
  filterStatus,
  sortField,
  sortDir,
  toggleSort,
  deleteRun,
} from "../state/experiments.js";
import { navigate } from "../state/router.js";
import { useEscape } from "../hooks/useEscape.js";
import { formatDuration, formatPercent, formatRelativeTime } from "../utils/format.js";
import { baseName } from "../utils/runCurves.js";
import { RUN_COLORS, MAX_COMPARE } from "../utils/compareRuns.js";
import { ArrowRightIcon, ChartBarsIcon, LineChartIcon, PlayIcon, TrophyIcon, XIcon } from "./dashboard/icons.jsx";

export const selectedRunIds = signal(new Set());

const columns = [
  { key: "_check", label: "", sortable: false },
  { key: "name", label: "Run" },
  { key: "status", label: "Status" },
  { key: "tags", label: "Tags", sortable: false },
  { key: "backbone", label: "Model" },
  { key: "dataset", label: "Dataset" },
  { key: "created", label: "Started" },
  { key: "_duration", label: "Duration" },
  { key: "bestAcc", label: "Val acc", num: true },
  { key: "testAcc", label: "Test acc", num: true },
  { key: "valLoss", label: "Val loss", num: true },
];

const SORTS = [
  { id: "created:desc", label: "Newest first" },
  { id: "created:asc", label: "Oldest first" },
  { id: "bestAcc:desc", label: "Best val accuracy" },
  { id: "testAcc:desc", label: "Best test accuracy" },
  { id: "valLoss:asc", label: "Lowest val loss" },
  { id: "_duration:desc", label: "Longest duration" },
  { id: "name:asc", label: "Name (A–Z)" },
];

const STATUS_LABELS = { completed: "Completed", running: "Running", failed: "Failed", queued: "Queued" };

function SortIcon({ field }) {
  const active = sortField.value === field;
  return (
    <span class={`rt-sort${active ? " active" : ""}`} aria-hidden="true">
      {active ? (sortDir.value === "asc" ? "\u2191" : "\u2193") : "\u2195"}
    </span>
  );
}

function Status({ status }) {
  return (
    <span class={`rt-status rt-status--${STATUS_LABELS[status] ? status : "queued"}`}>
      <span class="rt-status-dot" />
      {STATUS_LABELS[status] || status || "Unknown"}
    </span>
  );
}

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
  </svg>
);

function toggleSelect(runId, e) {
  e.stopPropagation();
  const next = new Set(selectedRunIds.value);
  if (next.has(runId)) next.delete(runId);
  else next.add(runId);
  selectedRunIds.value = next;
}

function toggleSelectAll() {
  const ids = filteredRuns.value.map((r) => r.id);
  const allSelected =
    ids.length > 0 && ids.every((id) => selectedRunIds.value.has(id));
  selectedRunIds.value = allSelected ? new Set() : new Set(ids);
}

function DeleteRunsDialog({ count, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false);
  useEscape(!busy, onCancel);
  return (
    <div class="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div
        class="modal-dialog delete-runs-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-runs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h3 class="modal-title" id="delete-runs-title">
            Delete {count} {count === 1 ? "run" : "runs"}?
          </h3>
        </div>
        <div class="modal-body">
          <p class="delete-runs-text">
            The selected {count === 1 ? "run is" : "runs are"} removed from
            NightFlow. This can’t be undone.
          </p>
        </div>
        <div class="modal-footer">
          <button class="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            class="btn btn-danger"
            autoFocus
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function clearFilters() {
  filterText.value = "";
  filterStatus.value = "all";
}

async function deleteSelected(ids) {
  for (const id of ids) {
    await deleteRun(id);
  }
  selectedRunIds.value = new Set();
}

/** Mini summary of one selected run in the comparison dock. */
function DockRun({ run, color }) {
  const duration = formatDuration(run.created, run.finishedAt);
  return (
    <button class="rt-dock-run" style={{ "--run": color }} onClick={() => navigate("run-detail", { runId: run.id })} title="Open run">
      <div class="rt-dock-run-top">
        <strong>{run.name ?? run.id}</strong>
        <Status status={run.status} />
      </div>
      <span class="rt-dock-run-meta">
        {[run.backbone || run.model, formatRelativeTime(run.created), duration !== "\u2014" && duration].filter(Boolean).join(" \u00b7 ")}
      </span>
      <dl>
        <div><dt>Val acc</dt><dd>{formatPercent(run.bestAcc)}</dd></div>
        <div><dt>Test acc</dt><dd>{formatPercent(run.testAcc)}</dd></div>
        <div><dt>Val loss</dt><dd>{run.valLoss != null ? run.valLoss.toFixed(4) : "\u2014"}</dd></div>
      </dl>
    </button>
  );
}

function CompareDock({ selected, onClear }) {
  const ready = selected.length >= 2 && selected.length <= MAX_COMPARE;
  const shown = selected.slice(0, 2);
  return (
    <div class="rt-dock" role="region" aria-label="Comparison">
      <div class="rt-dock-intro">
        <span class="rt-dock-icon"><ChartBarsIcon size={20} /></span>
        <div>
          <strong>{selected.length < 2 ? "Select one more run" : ready ? "Comparison ready" : `Up to ${MAX_COMPARE} runs at a time`}</strong>
          <span>
            {selected.length < 2
              ? "Pick another run to compare accuracy, loss and configuration."
              : ready
                ? "Compare curves, headline metrics and configuration changes."
                : `Deselect ${selected.length - MAX_COMPARE} to compare.`}
          </span>
        </div>
      </div>
      <div class="rt-dock-runs">
        {shown.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 && <span class="rt-dock-vs">vs</span>}
            <DockRun run={r} color={RUN_COLORS[i]} />
          </Fragment>
        ))}
        {selected.length > shown.length && <span class="rt-dock-more">+{selected.length - shown.length} more</span>}
      </div>
      <div class="rt-dock-actions">
        <button
          class="dash-btn dash-btn--primary rt-dock-open"
          disabled={!ready}
          onClick={() => navigate("compare-runs", { runIds: selected.map((r) => r.id) })}
        >
          <LineChartIcon size={16} /> Open comparison <ArrowRightIcon size={15} />
        </button>
        <button class="dash-link rt-dock-clear" onClick={onClear}>Clear selection</button>
      </div>
    </div>
  );
}

export function RunsTable() {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const closeConfirm = useCallback(() => setConfirmDelete(false), []);
  const runs = filteredRuns.value;
  const all = projectRuns.value;
  const ids = runs.map((r) => r.id);
  // Selection order sets each run's colour, matching the compare view.
  const selected = [...selectedRunIds.value].map((id) => all.find((r) => r.id === id)).filter(Boolean);
  const selectedIndex = new Map(selected.map((r, i) => [r.id, i]));
  const best = (key, pick) => {
    const vals = runs.map((r) => r[key]).filter((v) => v != null);
    return vals.length > 1 ? pick(...vals) : null;
  };
  const bestVal = best("bestAcc", Math.max);
  const bestTest = best("testAcc", Math.max);
  const bestLoss = best("valLoss", Math.min);
  const hasFilters = filterText.value !== "" || filterStatus.value !== "all";
  const allChecked = ids.length > 0 && ids.every((id) => selectedRunIds.value.has(id));
  const someChecked = selected.length > 0;

  const counts = all.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {});
  const top = all.filter((r) => Number.isFinite(r.bestAcc)).sort((a, b) => b.bestAcc - a.bestAcc)[0];
  const sortId = `${sortField.value}:${sortDir.value}`;
  const clearSelection = () => (selectedRunIds.value = new Set());

  return (
    <div class="rt dash">
      <header class="rt-head">
        <div class="rt-title">
          <h2>Experiments</h2>
          <span>{all.length} {all.length === 1 ? "run" : "runs"}</span>
        </div>
        <div class="rt-summary">
          {["running", "completed", "failed"].map((s) =>
            counts[s] ? (
              <button key={s} class={`rt-chip rt-status--${s}${filterStatus.value === s ? " active" : ""}`} onClick={() => (filterStatus.value = filterStatus.value === s ? "all" : s)} title={`Show only ${s} runs`}>
                <span class="rt-status-dot" />{counts[s]} {s}
              </button>
            ) : null,
          )}
          {top && (
            <button class="rt-chip rt-chip--best" onClick={() => navigate("run-detail", { runId: top.id })} title={`${top.name ?? top.id}: open run`}>
              <TrophyIcon size={14} /> Best val. accuracy <strong>{formatPercent(top.bestAcc)}</strong>
            </button>
          )}
          <button class="dash-btn dash-btn--primary" onClick={() => navigate("dashboard")} title="Start a new training run from the dashboard">
            <PlayIcon size={14} /> New run
          </button>
        </div>
      </header>

      <div class="rt-toolbar">
        <label class="rt-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Filter by name, model, dataset or tag…"
            value={filterText}
            onInput={(e) => (filterText.value = e.currentTarget.value)}
            aria-label="Filter runs"
          />
          {filterText.value && (
            <button class="rt-search-clear" onClick={() => (filterText.value = "")} aria-label="Clear filter"><XIcon size={13} /></button>
          )}
        </label>
        <select class="rt-select" value={filterStatus} onChange={(e) => (filterStatus.value = e.currentTarget.value)} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
          <option value="queued">Queued</option>
        </select>
        <select
          class="rt-select"
          value={SORTS.some((o) => o.id === sortId) ? sortId : ""}
          onChange={(e) => {
            const [f, d] = e.currentTarget.value.split(":");
            sortField.value = f;
            sortDir.value = d;
          }}
          aria-label="Sort by"
        >
          {!SORTS.some((o) => o.id === sortId) && <option value="">Custom sort</option>}
          {SORTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {someChecked && (
          <div class="rt-selection">
            <span class="rt-selection-count">{selected.length} selected</span>
            <button
              class="dash-btn dash-btn--primary"
              disabled={selected.length < 2 || selected.length > MAX_COMPARE}
              onClick={() => navigate("compare-runs", { runIds: selected.map((r) => r.id) })}
              title={selected.length < 2 ? "Select at least two runs" : selected.length > MAX_COMPARE ? `Compare up to ${MAX_COMPARE} runs` : undefined}
            >
              <LineChartIcon size={15} /> Compare
            </button>
            <button class="dash-btn dash-btn--quiet" onClick={clearSelection}>Clear</button>
            <button class="dash-btn dash-btn--danger" onClick={() => setConfirmDelete(true)}>
              <TrashIcon /> Delete {selected.length}
            </button>
          </div>
        )}
      </div>

      <div class="rt-table-wrap">
        <table class="rt-table">
          <thead>
            <tr>
              {columns.map((col) =>
                col.key === "_check" ? (
                  <th key="_check" class="rt-check">
                    <input type="checkbox" checked={allChecked} onChange={toggleSelectAll} aria-label="Select all runs" />
                  </th>
                ) : (
                  <th
                    key={col.key}
                    class={`${col.sortable === false ? "" : "sortable"}${col.num ? " num" : ""}`}
                    onClick={col.sortable === false ? undefined : () => toggleSort(col.key)}
                    aria-sort={sortField.value === col.key ? (sortDir.value === "asc" ? "ascending" : "descending") : undefined}
                  >
                    {col.label}
                    {col.sortable !== false && <SortIcon field={col.key} />}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr class="rt-empty-row">
                <td colSpan={columns.length}>
                  <div class="rt-empty">
                    {hasFilters ? (
                      <>
                        <strong>No runs match these filters</strong>
                        <button class="dash-btn dash-btn--quiet" onClick={clearFilters}>Clear filters</button>
                      </>
                    ) : (
                      <>
                        <strong>No runs yet</strong>
                        <span>Runs you train in this project appear here.</span>
                        <button class="dash-btn dash-btn--quiet" onClick={() => navigate("dashboard")}>Start training from the dashboard</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
            {runs.map((run) => {
              const idx = selectedIndex.get(run.id);
              const isSel = idx !== undefined;
              const color = isSel && idx < MAX_COMPARE ? RUN_COLORS[idx] : undefined;
              const duration = formatDuration(run.created, run.finishedAt);
              const dataset = run.dataset && run.dataset !== "unknown" ? run.dataset : null;
              return (
                <tr
                  key={run.id}
                  class={`rt-row${isSel ? " selected" : ""}`}
                  style={color ? { "--run": color } : undefined}
                  onClick={() => navigate("run-detail", { runId: run.id })}
                >
                  <td class="rt-check" onClick={(e) => toggleSelect(run.id, e)}>
                    <input type="checkbox" checked={isSel} onChange={() => {}} aria-label={`Select ${run.name ?? run.id}`} />
                  </td>
                  <td class="rt-name">
                    <span>{run.name ?? run.id}</span>
                    {color && <span class="rt-pick">#{idx + 1}</span>}
                  </td>
                  <td><Status status={run.status} /></td>
                  <td>
                    {run.tags?.length > 0 ? (
                      <div class="rt-tags">{run.tags.map((tag) => <span key={tag} class="rt-tag">{tag}</span>)}</div>
                    ) : (
                      <span class="rt-muted">—</span>
                    )}
                  </td>
                  <td class="rt-model">
                    <span>{run.backbone || run.model || "\u2014"}</span>
                    {run.backbone && run.model && run.model !== "unknown" && <small>{run.model}</small>}
                  </td>
                  <td class="rt-dataset" title={dataset || undefined}>
                    {dataset ? (
                      <>
                        <span>{baseName(dataset)}</span>
                        <small>{dataset}</small>
                      </>
                    ) : (
                      <span class="rt-muted">—</span>
                    )}
                  </td>
                  <td class="rt-when" title={run.created ? new Date(run.created).toLocaleString() : undefined}>
                    <span>{formatRelativeTime(run.created)}</span>
                    {run.created && (
                      <small>
                        {new Date(run.created).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </small>
                    )}
                  </td>
                  <td class="rt-mono">{duration}</td>
                  <td class={`num rt-mono${run.bestAcc != null && run.bestAcc === bestVal ? " rt-best" : ""}`} title={run.bestAcc != null ? run.bestAcc.toFixed(4) : undefined}>
                    {formatPercent(run.bestAcc)}
                  </td>
                  <td class={`num rt-mono${run.testAcc != null && run.testAcc === bestTest ? " rt-best" : ""}`} title={run.testAcc != null ? run.testAcc.toFixed(4) : undefined}>
                    {formatPercent(run.testAcc)}
                  </td>
                  <td class={`num rt-mono${run.valLoss != null && run.valLoss === bestLoss ? " rt-best" : ""}`}>
                    {run.valLoss != null ? run.valLoss.toFixed(4) : "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {someChecked && <CompareDock selected={selected} onClear={clearSelection} />}

      {confirmDelete && (
        <DeleteRunsDialog
          count={selected.length}
          onCancel={closeConfirm}
          onConfirm={async () => {
            await deleteSelected(selected.map((r) => r.id));
            setConfirmDelete(false);
          }}
        />
      )}
    </div>
  );
}
