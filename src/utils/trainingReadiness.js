// Unknown checks are not failures: only known problems block a launch.
export function getTrainingReadiness({ project, validation, pathStatus = {}, environment, active = false }) {
  if (active) return { label: "Training in progress", detail: "Wait for the current run to finish before starting another.", blocked: true };
  if (validation && !validation.valid) return { label: "Dataset needs attention", detail: validation.errors?.[0] || "Resolve the dataset structure errors below before training.", blocked: true };
  const splitFiles = project.datasetFormat === "CSV" || project.datasetFormat === "JSONL";
  const fields = splitFiles ? ["trainPath", "valPath", "testPath"] : ["folderPath"];
  const missing = fields.filter((field) => project[field] && pathStatus[field] === false);
  if (missing.length) {
    const names = { trainPath: "training file", valPath: "validation file", testPath: "test file", folderPath: "dataset folder" };
    return { label: "Dataset needs attention", detail: `Missing ${missing.map((field) => names[field]).join(", ")}. Update the paths in project settings, then sync again.`, blocked: true };
  }
  if (environment?.status === "error") return { label: "Environment needs attention", detail: environment.message || "Resolve the Python environment error below, then sync again.", blocked: true };
  return { label: "Ready to launch", detail: validation?.valid ? "Workspace synced and dataset validated. Start training with your project configuration." : "Workspace synced. Review your dataset and configuration before starting training.", blocked: false };
}
