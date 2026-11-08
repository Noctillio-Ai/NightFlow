/** "just now", "5m ago", "3h ago", "2d ago", then a short date. */
export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Compact duration between two timestamps: "45s", "12m", "1h 05m". */
export function formatDuration(start, end) {
  if (!start || !end) return "—";
  const secs = Math.floor((new Date(end) - new Date(start)) / 1000);
  if (!(secs >= 0)) return "—";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/** Fraction (0–1) as a percentage with one decimal, or "—". */
export function formatPercent(value) {
  return value != null ? `${(value * 100).toFixed(1)}%` : "—";
}

/** Byte count as "812 B", "4.20 KB", "21.3 MB", "143 MB", "1.07 GB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${units[i]}`;
}
