import { useEffect, useRef, useState } from "preact/hooks";

const PAD = { top: 16, right: 12, bottom: 34, left: 44 };
let chartSeq = 0;

/** ~`count` evenly spaced "nice" ticks covering [min, max]. */
function niceTicks(min, max, count = 3) {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/** Track the rendered size of an element. */
function useSize(fallback = { width: 480, height: 0 }) {
  const ref = useRef(null);
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width > 0) setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/** Epoch numbers (1-based) to label: 1, then round multiples up to n. */
function epochTicks(n, maxTicks) {
  if (n <= 1) return [1];
  const raw = n / Math.max(1, maxTicks - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((st) => st >= raw) || raw;
  const ticks = [1];
  for (let e = step; e <= n; e += step) if (e - ticks[ticks.length - 1] >= step * 0.6) ticks.push(e);
  return ticks;
}

/**
 * Epoch chart for one or more per-epoch series.
 * series: [{ label, data: number[], color, area? }]
 * marker: { series: index, at: epochIndex } highlights one point (e.g. best epoch).
 */
export function MetricChart({ series, height: fixedHeight = 200, fill = false, yFormat = (v) => v.toFixed(2), tickFormat, yDomain, marker, empty = "No data yet" }) {
  const [ref, size] = useSize();
  const width = size.width;
  // `fill` charts take their container's height (set by CSS), never below the given height.
  const height = fill ? Math.max(fixedHeight, size.height) : fixedHeight;
  const fmtTick = tickFormat || yFormat;
  const [hover, setHover] = useState(null);
  const uid = useRef(null);
  if (uid.current == null) uid.current = `dash-grad-${++chartSeq}`;
  const valid = series.filter((s) => s.data && s.data.length > 0);

  if (valid.length === 0) {
    return (
      <div class={`dash-chart dash-chart--empty${fill ? " dash-chart--fill" : ""}`} ref={ref} style={{ minHeight: `${fixedHeight}px` }}>
        <span>{empty}</span>
      </div>
    );
  }

  const n = Math.max(...valid.map((s) => s.data.length));
  const all = valid.flatMap((s) => s.data);
  let [yMin, yMax] = yDomain || [Math.min(...all), Math.max(...all)];
  if (!yDomain) {
    const span = yMax - yMin || Math.abs(yMax) || 1;
    yMin -= span * 0.08;
    yMax += span * 0.08;
  }
  const ticks = yDomain ? niceTicks(yDomain[0], yDomain[1], 2) : niceTicks(yMin, yMax, 3);
  yMin = Math.min(yMin, ticks[0]);
  yMax = Math.max(yMax, ticks[ticks.length - 1]);

  const cw = Math.max(10, width - PAD.left - PAD.right);
  const ch = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (n <= 1 ? cw / 2 : (i / (n - 1)) * cw);
  const y = (v) => PAD.top + ch - ((v - yMin) / (yMax - yMin || 1)) * ch;

  const xTicks = epochTicks(n, Math.max(2, Math.floor(cw / 70))).map((e) => e - 1);

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = n <= 1 ? 0 : Math.round(((px - PAD.left) / cw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const markerSeries = marker ? valid[marker.series] || valid[0] : null;
  const markerAt = marker && markerSeries && marker.at >= 0 && marker.at < markerSeries.data.length ? marker.at : null;

  return (
    <div class={`dash-chart${fill ? " dash-chart--fill" : ""}`} ref={ref} style={fill ? { minHeight: `${fixedHeight}px` } : undefined}>
      <svg
        class={fill ? "dash-chart-svg--fill" : undefined}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={valid.map((s) => s.label).join(", ") + " by epoch"}
      >
        <defs>
          {valid.map((s, si) => (
            <linearGradient key={si} id={`${uid.current}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color={s.color} stop-opacity="0.28" />
              <stop offset="100%" stop-color={s.color} stop-opacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line class="dash-chart-grid" x1={PAD.left} x2={PAD.left + cw} y1={y(t)} y2={y(t)} />
            <text class="dash-chart-tick" x={PAD.left - 8} y={y(t)} text-anchor="end" dominant-baseline="middle">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <g key={`x${i}`}>
            <line class="dash-chart-grid dash-chart-grid--v" x1={x(i)} x2={x(i)} y1={PAD.top} y2={PAD.top + ch} />
            <text class="dash-chart-tick" x={x(i)} y={PAD.top + ch + 14} text-anchor="middle">{i + 1}</text>
          </g>
        ))}
        <text class="dash-chart-axis" x={PAD.left + cw / 2} y={height - 3} text-anchor="middle">Epoch</text>

        {valid.map((s, si) => {
          const pts = s.data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          return (
            <g key={s.label}>
              {s.area && s.data.length > 1 && (
                <polygon
                  points={`${x(0)},${PAD.top + ch} ${pts.join(" ")} ${x(s.data.length - 1)},${PAD.top + ch}`}
                  fill={`url(#${uid.current}-${si})`}
                />
              )}
              {s.data.length > 1 ? (
                <polyline class="dash-chart-line" points={pts.join(" ")} stroke={s.color} />
              ) : (
                <circle cx={x(0)} cy={y(s.data[0])} r="3" fill={s.color} />
              )}
            </g>
          );
        })}

        {markerAt != null && (
          <g>
            <line class="dash-chart-marker" x1={x(markerAt)} x2={x(markerAt)} y1={PAD.top} y2={PAD.top + ch} />
            <circle cx={x(markerAt)} cy={y(markerSeries.data[markerAt])} r="4.5" fill={markerSeries.color} class="dash-chart-dot" />
          </g>
        )}

        {hover != null && (
          <g>
            <line class="dash-chart-hover" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ch} />
            {valid.map((s) =>
              hover < s.data.length ? (
                <circle key={s.label} cx={x(hover)} cy={y(s.data[hover])} r="3.5" fill={s.color} class="dash-chart-dot" />
              ) : null,
            )}
          </g>
        )}
      </svg>

      {markerAt != null && hover == null && (
        <div
          class="dash-chart-tip dash-chart-tip--marker"
          style={{ left: `${x(markerAt)}px`, top: `${y(markerSeries.data[markerAt])}px` }}
        >
          {yFormat(markerSeries.data[markerAt])}
        </div>
      )}
      {hover != null && (
        <div
          class={`dash-chart-tip${x(hover) > width * 0.65 ? " dash-chart-tip--left" : ""}`}
          style={{ left: `${x(hover)}px`, top: `${PAD.top}px` }}
        >
          <div class="dash-chart-tip-title">Epoch {hover + 1}</div>
          {valid.map((s) =>
            hover < s.data.length ? (
              <div class="dash-chart-tip-row" key={s.label}>
                <span class="dash-chart-swatch" style={{ background: s.color }} />
                {s.label}
                <strong>{yFormat(s.data[hover])}</strong>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
