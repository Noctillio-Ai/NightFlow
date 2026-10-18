// Turns the sync log (see addSyncLog in state/dashboard.js) into four steps.
// The stages run in this order in doSync, so the furthest stage that has
// logged anything is the one in progress.

// Detailed lines (commands, their output, notes) don't decide a step's state.
export const DETAIL_TYPES = new Set(["cmd", "out", "note"]);

export const SYNC_STAGES = [
  { key: "workspace", title: "Prepare workspace" },
  { key: "python", title: "Set up Python environment" },
  { key: "dataset", title: "Validate dataset" },
  { key: "runs", title: "Import runs" },
];

/** Stage index (0–3) a log message belongs to, or -1 for overall messages. */
export function stageOf(message) {
  const m = String(message || "").toLowerCase();
  // Check the environment first: its messages can also mention uv.
  if (/python|autotimm|environment/.test(m)) return 1;
  if (/connecting to ssh|local mode|project directory|directory ready|\buv\b|^warning:/.test(m)) return 0;
  if (m.includes("dataset") || /^[✓✗⚠]/.test(m)) return 2;
  if (/loading runs|run logs?|synced metrics/.test(m)) return 3;
  return -1;
}

/** A log line as a short step detail: no status glyph, no trailing ellipsis. */
export function cleanMessage(message) {
  return String(message || "").replace(/^[✓✗⚠]\s*/, "").replace(/\.{3}$/, "…");
}

/**
 * The four steps with a state ("done" | "active" | "pending" | "warn" | "error")
 * and the latest message for each. `phase` is "idle" | "syncing" | "complete" | "failed".
 */
export function buildSyncSteps(logs = [], phase = "idle") {
  const perStage = SYNC_STAGES.map(() => []);
  let current = -1;
  for (const log of logs) {
    if (DETAIL_TYPES.has(log.type)) continue;
    const s = stageOf(log.message);
    if (s < 0) continue;
    perStage[s].push(log);
    current = Math.max(current, s);
  }

  return SYNC_STAGES.map((stage, i) => {
    const entries = perStage[i];
    const last = entries[entries.length - 1];
    const hasError = entries.some((e) => e.type === "error");
    const hasWarn = entries.some((e) => e.type === "warning");
    let state;
    if (phase === "complete") state = hasError ? "error" : hasWarn ? "warn" : "done";
    else if (i < current) state = hasError ? "error" : hasWarn ? "warn" : "done";
    else if (i === current) state = phase === "syncing" ? "active" : phase === "failed" ? "error" : hasError ? "error" : "done";
    else state = "pending";
    // A finished step reads best as its last success, not an in-progress line.
    const lastSuccess = [...entries].reverse().find((e) => e.type === "success");
    const shown = state === "done" && lastSuccess ? lastSuccess : last;
    return { ...stage, state, detail: shown ? cleanMessage(shown.message) : null, logs: entries };
  });
}

/** "45s", "2m 05s" */
export function formatElapsed(ms) {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}
