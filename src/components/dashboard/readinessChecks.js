import {
  datasetPathStatus,
  datasetValidation,
  condaInfo,
  uvInfo,
  envInfo,
} from "../../state/dashboard.js";
import { baseName } from "../../utils/runCurves.js";

// Every readiness check the dashboard knows about, derived from the state the
// sync step stores. Reading these signals inside a component subscribes it.

const envTag = (info) =>
  info.status === "created" ? "Installed" : info.status === "system" ? "System" : "Ready";

const fmtCount = (n) => (typeof n === "number" ? n.toLocaleString() : n);

/** Parent folder of a path, for the secondary line under a dataset name. */
function parentDir(path) {
  const trimmed = String(path).replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return cut > 0 ? trimmed.slice(0, cut) : "";
}

/** "conda 26.1.1" → "26.1.1" (the tile label already says which tool). */
const stripTool = (version, tool) => String(version).replace(new RegExp(`^${tool}\\s+`, "i"), "");

/**
 * Every check the dashboard knows about, as
 * { key, kind, label, value, primary, detail, tag, state }.
 * `value` is the full text (used as a tooltip); `primary`/`detail` are the
 * two display lines.
 */
export function collectChecks(project) {
  const status = datasetPathStatus.value;
  const validation = datasetValidation.value;
  const checks = [];
  const splitFiles = project.datasetFormat === "CSV" || project.datasetFormat === "JSONL";

  const pathCheck = (key, label, path) => {
    const exists = status[key];
    checks.push({
      key,
      kind: "path",
      label,
      value: path,
      primary: exists === false ? "Not found" : baseName(path),
      detail: exists === false ? path : parentDir(path),
      tag: exists === true ? "Found" : exists === false ? "Missing" : "—",
      state: exists === true ? "ok" : exists === false ? "err" : "idle",
    });
  };
  if (splitFiles) {
    if (project.trainPath) pathCheck("trainPath", "Train", project.trainPath);
    if (project.valPath) pathCheck("valPath", "Val", project.valPath);
    if (project.testPath) pathCheck("testPath", "Test", project.testPath);
  } else if (project.folderPath) {
    pathCheck("folderPath", "Dataset", project.folderPath);
  }

  if (validation && !splitFiles) {
    const info = validation.info || {};
    const chips = [
      info.classes && `${fmtCount(info.classes)} classes`,
      info.images && `${fmtCount(info.images)} images`,
      info.masks && `${fmtCount(info.masks)} masks`,
      info.categories && `${fmtCount(info.categories)} categories`,
      info.splits && `splits: ${info.splits}`,
    ].filter(Boolean);
    checks.push({
      key: "structure",
      kind: "structure",
      label: "Structure",
      value: validation.valid ? chips.join(" · ") || "valid" : validation.errors?.[0] || "invalid structure",
      primary: validation.valid ? chips[0] || "Valid layout" : "Invalid layout",
      detail: validation.valid ? chips.slice(1).join(" · ") || project.datasetFormat || "" : validation.errors?.[0] || "",
      tag: validation.valid ? "Valid" : "Invalid",
      state: validation.valid ? (validation.warnings?.length ? "warn" : "ok") : "err",
    });
  }

  const conda = condaInfo.value;
  const uv = uvInfo.value;
  const pkg = conda?.installed ? conda : uv;
  if (pkg) {
    checks.push({
      key: "pkg",
      kind: "pkg",
      label: conda?.installed ? "conda" : "uv",
      value: pkg.installed ? pkg.version || "installed" : pkg.message,
      primary: pkg.installed ? stripTool(pkg.version || "Installed", conda?.installed ? "conda" : "uv") : "Not installed",
      detail: pkg.installed ? "Package manager" : pkg.message || "",
      tag: pkg.installed ? "Ready" : "Missing",
      state: pkg.installed ? "ok" : "err",
    });
  }

  const env = envInfo.value;
  if (env) {
    if (env.status === "error") {
      checks.push({
        key: "env",
        kind: "python",
        label: "Python env",
        value: env.message,
        primary: "Setup failed",
        detail: env.message,
        tag: "Error",
        state: "err",
      });
    } else {
      checks.push({
        key: "python",
        kind: "python",
        label: "Python",
        value: env.pythonVersion || "unknown",
        primary: env.pythonVersion || "Unknown",
        detail: env.status === "system" ? "System interpreter" : "Project environment",
        tag: envTag(env),
        state: "ok",
      });
      checks.push({
        key: "autotimm",
        kind: "lib",
        label: "AutoTimm",
        value: env.autotimmVersion || "not installed",
        primary: env.autotimmVersion || "Not installed",
        detail: env.warning ? "Reinstall failed · previous version in use" : "Training library",
        // A failed reinstall leaves the previous version in use.
        tag: !env.autotimmVersion ? "Missing" : env.warning ? "Not updated" : envTag(env),
        state: !env.autotimmVersion ? "err" : env.warning ? "warn" : "ok",
      });
    }
  }
  return { checks, validation, splitFiles };
}
