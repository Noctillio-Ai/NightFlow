// Helpers for test-split metrics. A test run is a single evaluation, so each
// test/* tag holds one value; re-running the test replaces it.

import { headlineFor, pickTag } from "./headline.js";

// Structured test outputs stored alongside scalars, not single numbers.
const NON_SCALAR = new Set(["test/confusion_matrix", "test/per_class_metrics"]);

/** The task's headline test score (accuracy, or mAP for detection) from a flat `{ tag: number }` map, or null. */
export function pickTestAcc(metrics, taskType) {
  return pickTag(metrics, headlineFor(taskType).testTags);
}

/** Latest value of every test/* scalar, as a flat `{ tag: number }` map. */
export function testMetricsFromScalars(scalars) {
  const out = {};
  for (const [tag, points] of Object.entries(scalars || {})) {
    if (!tag.startsWith("test/") || NON_SCALAR.has(tag) || !Array.isArray(points) || !points.length) continue;
    const last = points[points.length - 1];
    const value = typeof last === "number" ? last : last?.value;
    if (typeof value === "number" && Number.isFinite(value)) out[tag] = value;
  }
  return out;
}

/**
 * Pull the command's steps out of a `__STEPS_JSON__:` training command and
 * return the same command with only the test step, or null if it isn't one.
 */
export function toTestOnlyCommand(command) {
  const prefix = "__STEPS_JSON__:";
  if (typeof command !== "string" || !command.startsWith(prefix)) return null;
  try {
    const spec = JSON.parse(command.slice(prefix.length));
    return `${prefix}${JSON.stringify({ ...spec, steps: "test" })}`;
  } catch {
    return null;
  }
}

/** The steps string ("fit+test", "test", …) of a `__STEPS_JSON__:` command, or "". */
export function commandSteps(command) {
  const prefix = "__STEPS_JSON__:";
  if (typeof command !== "string" || !command.startsWith(prefix)) return "";
  try {
    return String(JSON.parse(command.slice(prefix.length)).steps || "");
  } catch {
    return "";
  }
}
