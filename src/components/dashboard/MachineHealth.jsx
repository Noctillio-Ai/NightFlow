import { useState } from "preact/hooks";
import { Card, Dot } from "./Card.jsx";
import { ChipIcon, DiskIcon, GpuIcon, MemoryIcon, ThermometerIcon } from "./icons.jsx";

const GB = 1024 ** 3;
const ACTIVE_UTIL = 10; // % compute above which a GPU counts as busy
const BUSIEST = 4;

function loadTone(pct) {
  if (pct >= 90) return "crit";
  if (pct >= 75) return "high";
  return null;
}

function Bar({ pct, tone }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div class={`dash-bar dash-bar--${loadTone(clamped) || tone}`}>
      <div class="dash-bar-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

function ResourceTile({ icon, tone, label, value, unit, pct }) {
  return (
    <div class="dash-resource">
      <div class="dash-resource-head">
        <span class={`dash-resource-icon dash-tone--${tone}`}>{icon}</span>
        <span class="dash-resource-label">{label}</span>
      </div>
      <div class="dash-resource-value">
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
      <Bar pct={pct} tone={tone} />
    </div>
  );
}

function tempState(t) {
  if (t >= 85) return "err";
  if (t >= 70) return "warn";
  return "ok";
}

function GpuTile({ gpu }) {
  const vramPct = gpu.mem_total ? (gpu.mem_used / gpu.mem_total) * 100 : 0;
  return (
    <div class="dash-gpu">
      <span class="dash-gpu-icon"><GpuIcon size={16} /></span>
      <div class="dash-gpu-body">
        <div class="dash-gpu-head">
          <span class="dash-gpu-name" title={gpu.name}>GPU {gpu.index}</span>
          <span class="dash-gpu-util">{Math.round(gpu.utilization)}%</span>
        </div>
        <Bar pct={gpu.utilization} tone="gpu" />
        <div class="dash-gpu-foot">
          <span>{(gpu.mem_used / 1024).toFixed(1)} / {(gpu.mem_total / 1024).toFixed(1)} GB</span>
          <span class={`dash-temp dash-temp--${tempState(gpu.temperature)}`}>{gpu.temperature}°C</span>
        </div>
        <div class="dash-gpu-vram" title={`VRAM ${vramPct.toFixed(0)}%`}>
          <Bar pct={vramPct} tone="vram" />
        </div>
      </div>
    </div>
  );
}

function GpuPanel({ gpus }) {
  const [showAll, setShowAll] = useState(false);
  const avg = (fn) => gpus.reduce((sum, g) => sum + fn(g), 0) / gpus.length;
  const compute = avg((g) => g.utilization || 0);
  const vram = avg((g) => (g.mem_total ? (g.mem_used / g.mem_total) * 100 : 0));
  const temps = gpus.map((g) => g.temperature).filter((t) => Number.isFinite(t));
  const active = gpus.filter((g) => (g.utilization || 0) > ACTIVE_UTIL).length;
  const ranked = [...gpus].sort((a, b) => (b.utilization || 0) - (a.utilization || 0));
  const shown = showAll ? gpus : ranked.slice(0, BUSIEST);
  const names = [...new Set(gpus.map((g) => g.name))];

  return (
    <div class="dash-gpus">
      <div class="dash-gpus-head">
        <span class="dash-resource-icon dash-tone--gpu"><GpuIcon size={18} /></span>
        <div class="dash-gpus-title">
          <strong>{gpus.length > 1 ? "GPU cluster" : "GPU"}</strong>
          <span>
            {gpus.length > 1 ? `${gpus.length} GPUs · ${active} active · ${gpus.length - active} idle` : names[0]}
          </span>
        </div>
        {gpus.length > BUSIEST && (
          <button class="dash-btn dash-btn--quiet dash-btn--sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show busiest" : `View all ${gpus.length} GPUs`}
          </button>
        )}
      </div>

      <div class="dash-gpus-summary">
        <div class="dash-gpus-stat">
          <span class="dash-muted">Compute</span>
          <div class="dash-gpus-stat-row"><strong>{compute.toFixed(0)}%</strong><Bar pct={compute} tone="gpu" /></div>
        </div>
        <div class="dash-gpus-stat">
          <span class="dash-muted">VRAM</span>
          <div class="dash-gpus-stat-row"><strong>{vram.toFixed(0)}%</strong><Bar pct={vram} tone="vram" /></div>
        </div>
        {temps.length > 0 && (
          <div class="dash-gpus-stat dash-gpus-temp">
            <ThermometerIcon size={16} />
            <div>
              <span class="dash-muted">Temperature</span>
              <strong>
                {Math.min(...temps) === Math.max(...temps) ? `${temps[0]}°C` : `${Math.min(...temps)}–${Math.max(...temps)}°C`}
              </strong>
            </div>
          </div>
        )}
      </div>

      {gpus.length > 0 && (
        <>
          <span class="dash-gpus-caption">{gpus.length === 1 ? "Device" : showAll ? "All GPUs" : "Busiest GPUs"}</span>
          <div class={`dash-gpu-grid${gpus.length === 1 ? " dash-gpu-grid--single" : ""}`}>
            {shown.map((g) => <GpuTile key={g.index} gpu={g} />)}
          </div>
        </>
      )}
    </div>
  );
}

/** Host resources and GPUs from the shared system-metrics poll. */
export function MachineHealth({ metrics, error, onRetry }) {
  const gpus = metrics?.gpus || [];
  const cpuPct = metrics?.cpu_percent != null
    ? Math.min(100, metrics.cpu_percent)
    : metrics?.loadavg && metrics?.cpu_cores
      ? Math.min(100, (metrics.loadavg[0] / metrics.cpu_cores) * 100)
      : null;
  const memPct = metrics?.mem_total ? (metrics.mem_used / metrics.mem_total) * 100 : null;
  const diskPct = metrics?.disk_total ? (metrics.disk_used / metrics.disk_total) * 100 : null;
  const hot = gpus.some((g) => g.temperature >= 85);
  const strained = [cpuPct, memPct, diskPct].some((p) => p != null && p >= 90);
  const health = error ? "err" : !metrics ? "idle" : hot || strained ? "warn" : "ok";
  const healthLabel = error ? "Metrics unavailable" : !metrics ? "Reading metrics…" : hot || strained ? "Under heavy load" : "All systems healthy";

  return (
    <Card
      class="dash-health"
      icon={<ChipIcon size={18} />}
      title="Machine health"
      aside={<span class="dash-health-state"><Dot state={health === "ok" ? "live" : health} />{healthLabel}</span>}
    >
      {error ? (
        <div class="dash-empty dash-empty--err">
          <span>Couldn’t read system metrics: {error}</span>
          <button class="dash-btn dash-btn--quiet dash-btn--sm" onClick={onRetry}>Retry</button>
        </div>
      ) : !metrics ? (
        <div class="dash-health-grid">
          <div class="dash-resources">
            {[0, 1, 2].map((i) => <div class="dash-resource dash-skeleton" key={i} />)}
          </div>
        </div>
      ) : (
        <div class={`dash-health-grid${gpus.length ? "" : " dash-health-grid--solo"}`}>
          <div class="dash-resources">
            <ResourceTile
              icon={<ChipIcon size={18} />}
              tone="cpu"
              label="CPU"
              value={cpuPct != null ? `${cpuPct.toFixed(0)}%` : "—"}
              unit={metrics.cpu_cores ? `${metrics.cpu_cores} cores` : ""}
              pct={cpuPct}
            />
            <ResourceTile
              icon={<MemoryIcon size={18} />}
              tone="mem"
              label="Memory"
              value={metrics.mem_total ? (metrics.mem_used / GB).toFixed(1) : "—"}
              unit={metrics.mem_total ? `/ ${(metrics.mem_total / GB).toFixed(1)} GB` : ""}
              pct={memPct}
            />
            <ResourceTile
              icon={<DiskIcon size={18} />}
              tone="disk"
              label="Disk"
              value={metrics.disk_total ? (metrics.disk_used / GB).toFixed(0) : "—"}
              unit={metrics.disk_total ? `/ ${(metrics.disk_total / GB).toFixed(0)} GB` : ""}
              pct={diskPct}
            />
          </div>
          {gpus.length > 0 && <GpuPanel gpus={gpus} />}
        </div>
      )}
    </Card>
  );
}
