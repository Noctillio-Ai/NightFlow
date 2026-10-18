import { stats } from "../../state/dashboard.js";
import { projectRuns } from "../../state/experiments.js";
import { currentProject } from "../../state/projects.js";
import { navigate } from "../../state/router.js";
import { headlineFor } from "../../utils/headline.js";
import { runSeries, argMax } from "../../utils/runCurves.js";
import { Card } from "./Card.jsx";
import { MetricChart } from "./MetricChart.jsx";
import { ChartBarsIcon, CheckCircleIcon, TrophyIcon } from "./icons.jsx";

const runLabel = (r) => r.name || r.id;

function ResultTile({ icon, label, value, detail, run }) {
  const content = (
    <>
      <span class="dash-result-icon">{icon}</span>
      <span class="dash-result-body">
        <span class="dash-result-label">{label}</span>
        <span class={`dash-result-value${value === "—" ? " dash-result-value--empty" : ""}`}>{value}</span>
        <span class="dash-result-detail">{detail}</span>
      </span>
    </>
  );
  return run ? (
    <button class="dash-result dash-result--link" onClick={() => navigate("run-detail", { runId: run.id })} title={`Open ${runLabel(run)}`}>
      {content}
    </button>
  ) : (
    <div class="dash-result">{content}</div>
  );
}

/** Best validation/test score (accuracy, or mAP for detection) and the best run's validation curve. */
export function ResultsCard() {
  const s = stats.value;
  const h = headlineFor(currentProject.value?.taskType);
  const runs = projectRuns.value;
  const bestVal = s.bestAcc != null ? runs.find((r) => r.status === "completed" && r.bestAcc === s.bestAcc) : null;
  const bestTest = s.bestTestAcc != null ? runs.find((r) => r.testAcc === s.bestTestAcc) : null;
  const valAcc = bestVal ? runSeries(bestVal).valAcc : [];
  const bestEpoch = argMax(valAcc);

  return (
    <Card
      class="dash-results"
      icon={<ChartBarsIcon size={18} />}
      title="Recent results"
      aside={
        bestVal && (
          <button class="dash-badge dash-badge--ok" onClick={() => navigate("run-detail", { runId: bestVal.id })}>
            Best model
          </button>
        )
      }
    >
      <div class="dash-results-tiles">
        <ResultTile
          icon={<TrophyIcon size={20} />}
          label={`Best validation ${h.name}`}
          value={h.format(s.bestAcc)}
          detail={bestVal ? `${bestEpoch >= 0 ? `Epoch ${bestEpoch + 1} · ` : ""}${runLabel(bestVal)}` : "No completed runs yet"}
          run={bestVal}
        />
        <ResultTile
          icon={<CheckCircleIcon size={20} />}
          label={`Best test ${h.name}`}
          value={h.format(s.bestTestAcc)}
          detail={bestTest ? runLabel(bestTest) : "Run a test to see results"}
          run={bestTest}
        />
      </div>

      <div class="dash-chart-block dash-chart-block--fill">
        <div class="dash-chart-head">
          <span class="dash-chart-title">Validation {h.name}</span>
          {bestVal && <span class="dash-chart-sub">{runLabel(bestVal)}</span>}
        </div>
        <MetricChart
          height={196}
          fill
          series={[{ label: `Val ${h.name}`, data: valAcc, color: "#22c55e", area: true }]}
          yDomain={[0, 1]}
          yFormat={h.percent ? (v) => `${(v * 100).toFixed(v === 0 || v === 1 || v === 0.5 ? 0 : 1)}%` : (v) => v.toFixed(2)}
          marker={bestEpoch >= 0 ? { series: 0, at: bestEpoch } : null}
          empty={bestVal ? "No per-epoch history recorded for this run" : "Results appear after your first completed run"}
        />
      </div>
    </Card>
  );
}
