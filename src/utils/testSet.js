// Where AutoTimm looks for a project's test split. A test step without one
// fails, so training skips it when none of these exist.

const join = (dir, ...parts) => {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return [dir.replace(/[\\/]+$/, ""), ...parts].join(sep);
};

/** COCO detection test files, in AutoTimm's default layout (matches train2017/val2017). */
export const cocoDetectionTestPaths = (dir) => ({
  images: join(dir, "test2017"),
  annotations: join(dir, "annotations", "instances_test2017.json"),
});

/**
 * Ways the test split can be laid out, as alternatives of paths that must all
 * exist: [[a, b], [c]] means (a and b) or c. Empty when the project has none.
 */
export function testSetCandidates(project) {
  const task = project.taskType || "Classification";
  const fmt = project.datasetFormat;
  if (fmt === "CSV" || fmt === "JSONL") return project.testPath?.trim() ? [[project.testPath.trim()]] : [];
  const dir = project.folderPath?.trim();
  if (!dir) return [];

  if (task === "Object Detection") {
    const { images, annotations } = cocoDetectionTestPaths(dir);
    return [[images, annotations]];
  }
  if (task === "Instance Segmentation") {
    return [
      [join(dir, "annotations", "instances_test2017.json")],
      [join(dir, "annotations", "instances_test.json")],
    ];
  }
  if (task === "Semantic Segmentation") {
    switch (fmt) {
      case "COCO": return [[join(dir, "annotations", "stuff_test.json")]];
      case "Cityscapes": return [[join(dir, "leftImg8bit", "test"), join(dir, "gtFine", "test")]];
      // Without a split file VOC falls back to every image, which isn't a test set.
      case "VOC": return [[join(dir, "ImageSets", "Segmentation", "test.txt")]];
      default: return [[join(dir, "test", "images"), join(dir, "test", "masks")]];
    }
  }
  return [[join(dir, "test")]];
}

/**
 * Whether the project has a test split. `exists(path)` resolves to a boolean;
 * a path that can't be checked counts as missing.
 */
export async function detectTestSet(project, exists) {
  const check = (path) => Promise.resolve(exists(path)).then(Boolean, () => false);
  for (const paths of testSetCandidates(project)) {
    const found = await Promise.all(paths.map(check));
    if (found.every(Boolean)) return true;
  }
  return false;
}
