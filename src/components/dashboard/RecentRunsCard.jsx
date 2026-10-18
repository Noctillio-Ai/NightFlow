import { stats } from "../../state/dashboard.js";
import { projectRuns, filterStatus } from "../../state/experiments.js";
import { navigate } from "../../state/router.js";
import { formatPercent } from "../../utils/format.js";
import { baseName } from "../../utils/runCurves.js";
import { Card, Dot } from "./Card.jsx";
import { ArrowRightIcon, ClockIcon, LineChartIcon } from "./icons.jsx";

const LIMIT = 3;
const STATUS_DOT = { completed: "ok", running: "live", failed: "err", queued: "idle" };
const STATUS_LABEL = { completed: "Completed", running: "Running", failed: "Failed", queued: "Queued" };

function formatStarted(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The latest runs as a compact table; rows open the run detail view. */
export function RecentRunsCard() {
  const all = projectRuns.value;
  const s = stats.value;
  const runs = [...all].sort((a, b) => new Date(b.created) - new Date(a.created)).slice(0, LIMIT);
  const openAll = () => {
    filterStatus.value = "all";
    navigate("experiments");
  };

  const summary = [
    `${s.totalRuns} ${s.totalRuns === 1 ? "run" : "runs"}`,
    s.running ? `${s.running} running` : null,
    s.completed ? `${s.completed} completed` : null,
    s.failed ? `${s.failed} failed` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Card
      class="dash-runs"
      icon={<ClockIcon size={18} />}
      title="Recent runs"
      aside={
        <>
          {all.length > 0 && <span class="dash-muted">{summary}</span>}
          {all.length > 0 && (
            <button class="dash-link" onClick={openAll}>
              View all <ArrowRightIcon size={14} />
            </button>
          )}
        </>
      }
    >
      {runs.length === 0 ? (
        <div class="dash-empty">No runs yet. Start training to see your experiments here.</div>
      ) : (
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Started</th>
                <th>Model</th>
                <th>Dataset</th>
                <th class="num">Epochs</th>
                <th class="num">Best val acc</th>
                <th>Status</th>
                <th class="actions"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => navigate("run-detail", { runId: r.id })}>
                  <td class="mono strong">{r.name || r.id}</td>
                  <td>{formatStarted(r.created)}</td>
                  <td>{r.backbone || r.model || "—"}</td>
                  <td title={r.dataset}>{baseName(r.dataset) || "—"}</td>
                  <td class="num">{r.epochs || "—"}</td>
                  <td class={`num strong${r.bestAcc != null && r.bestAcc === s.bestAcc ? " best" : ""}`}>{formatPercent(r.bestAcc)}</td>
                  <td>
                    <span class="dash-status">
                      <Dot state={STATUS_DOT[r.status] || "idle"} />
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td class="actions">
                    <button
                      class="dash-icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate("run-detail", { runId: r.id });
                      }}
                      title="View charts and details"
                      aria-label={`Open ${r.name || r.id}`}
                    >
                      <LineChartIcon size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
