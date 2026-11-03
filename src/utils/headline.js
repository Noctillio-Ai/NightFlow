// The one score runs are ranked by: accuracy, or mAP for object detection.
// Whatever the task, it's stored on the run as bestAcc (best validation
// value), accCurve (validation value per epoch) and testAcc.

import { formatPercent } from "./format.js";

const ACCURACY = {
  name: "accuracy",
  title: "Accuracy",
  short: "acc",
  valTags: ["val/accuracy", "val/acc", "val_accuracy", "val_acc"],
  testTags: ["test/accuracy", "test/acc", "test/MulticlassAccuracy"],
  percent: true,
  format: formatPercent,
};

// COCO mAP@[.5:.95], shown the way detection tools report it (0.452).
const MAP = {
  name: "mAP",
  title: "mAP",
  short: "mAP",
  valTags: ["val/map"],
  testTags: ["test/map"],
  percent: false,
  format: (v) => (Number.isFinite(v) ? v.toFixed(3) : "—"),
};

/** Headline metric for a task type. */
export const headlineFor = (taskType) => (taskType === "Object Detection" ? MAP : ACCURACY);

/** First finite value among `tags` in a flat `{ tag: number }` map, or null. */
export function pickTag(metrics, tags) {
  for (const tag of tags) {
    const v = metrics?.[tag];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}
