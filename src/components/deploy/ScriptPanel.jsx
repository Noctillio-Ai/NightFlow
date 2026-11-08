import { useState, useMemo, useEffect } from "preact/hooks";
import { platform, gpuAvailable } from "../../state/dashboard.js";
import { runExports } from "../../state/exports.js";
import { generateInferenceScript, highlightPython, deviceOptions, defaultDevice, requirementsFor } from "./script.js";
import { FORMAT_BY_ID, Field, CopyButton, PythonLogo, AlertIcon, Svg } from "./shared.jsx";

const SlidersIcon = ({ size }) => (
  <Svg size={size}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></Svg>
);

/** All state behind the generated inference.py for one run and format. */
export function useInferenceScript({ run, project, hp, format }) {
  const taskType = run.taskType || project?.taskType || "Classification";
  const backbone = run.backbone || run.model || "efficientnet_b0";
  const trainedSize = hp.image_size || hp.imageSize || 224;
  const trainedClasses = hp.num_classes || hp.numClasses || project?.numClasses || 10;

  const [device, setDevice] = useState(() => defaultDevice(platform.value, gpuAvailable.value));
  const [imagePath, setImagePath] = useState("image.jpg");
  const [imageSize, setImageSize] = useState(String(trainedSize));
  const [numClasses, setNumClasses] = useState(String(trainedClasses));
  const [confThreshold, setConfThreshold] = useState("0.5");
  const [classNames, setClassNames] = useState((project?.classNames || []).join(", "));

  // Hyperparameters load after mount; adopt them until the user edits the field.
  useEffect(() => setImageSize((v) => (v === "224" ? String(trainedSize) : v)), [trainedSize]);
  useEffect(() => setNumClasses((v) => (v === "10" ? String(trainedClasses) : v)), [trainedClasses]);

  const fmt = FORMAT_BY_ID[format];
  const devices = deviceOptions(format, platform.value);
  const effectiveDevice = format === "tensorrt" ? "cuda" : devices.some((d) => d.id === device) ? device : "cpu";
  const modelPath = `${run.name || run.id}${fmt.ext}`;

  const nameCount = classNames.split(",").map((s) => s.trim()).filter(Boolean).length;
  const nClasses = parseInt(numClasses, 10) || 0;
  const classWarn = nameCount > 0 && nClasses > 0 && nameCount !== nClasses
    ? `${nameCount} ${nameCount === 1 ? "name" : "names"} for ${nClasses} classes. Unnamed predictions will fail.`
    : "";

  const script = generateInferenceScript({
    taskType,
    backbone,
    numClasses: numClasses || trainedClasses,
    imageSize: imageSize || trainedSize,
    modelPath,
    imagePath,
    device: effectiveDevice,
    confThreshold: parseFloat(confThreshold) || 0.5,
    classNames,
    exportFormat: format,
  });

  return {
    taskType, trainedSize, fmt, devices, modelPath, classWarn, script,
    pipLine: requirementsFor(format, effectiveDevice, taskType),
    usesThreshold: ["Object Detection", "Instance Segmentation", "Multi-Label Classification"].includes(taskType),
    isMultiLabel: taskType === "Multi-Label Classification",
    values: { device: effectiveDevice, imagePath, imageSize, numClasses, confThreshold, classNames },
    set: { setDevice, setImagePath, setImageSize, setNumClasses, setConfThreshold, setClassNames },
  };
}

export function ScriptSettings({ s, format }) {
  const { values: v, set } = s;
  return (
    <section class="rd-card dpm-settings">
      <div class="rd-card-head">
        <h3><SlidersIcon size={15} /> Script settings</h3>
      </div>
      <div class="dpm-settings-fields">
        <Field label="Input image">
          <input type="text" value={v.imagePath} onInput={(e) => set.setImagePath(e.currentTarget.value)} placeholder="image.jpg" spellcheck={false} />
        </Field>
        {s.devices.length > 0 ? (
          <Field label={format === "onnx" ? "Execution provider" : "Device"}>
            <select value={v.device} onChange={(e) => set.setDevice(e.currentTarget.value)}>
              {s.devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Device">
            <input type="text" value="CUDA (TensorRT)" disabled />
          </Field>
        )}
        <div class="dpm-field-pair">
          <Field label="Image size" warn={Number(v.imageSize) !== Number(s.trainedSize) ? `Trained at ${s.trainedSize}` : ""}>
            <input type="number" value={v.imageSize} onInput={(e) => set.setImageSize(e.currentTarget.value)} min="32" max="2048" />
          </Field>
          <Field label="Classes">
            <input type="number" value={v.numClasses} onInput={(e) => set.setNumClasses(e.currentTarget.value)} min="1" />
          </Field>
        </div>
        {s.usesThreshold && (
          <Field label={s.isMultiLabel ? "Sigmoid threshold" : "Confidence threshold"}>
            <input type="number" value={v.confThreshold} onInput={(e) => set.setConfThreshold(e.currentTarget.value)} min="0" max="1" step="0.05" />
          </Field>
        )}
        <Field label="Class names" warn={s.classWarn}>
          <textarea rows={2} value={v.classNames} onInput={(e) => set.setClassNames(e.currentTarget.value)} placeholder="cat, dog, bird, …" spellcheck={false} />
        </Field>
      </div>
    </section>
  );
}

export function ScriptEditor({ s, run, format }) {
  const exported = (runExports.value[run.id] || []).some((e) => e.format === format);
  const highlighted = useMemo(() => highlightPython(s.script), [s.script]);
  const lineCount = s.script.split("\n").length;
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"), [lineCount]);

  return (
    <section class="dpm-editor" aria-label="Inference script">
      <div class="dpm-editor-head">
        <span class="dpm-editor-file">
          <PythonLogo size={15} />
          inference.py
          <span class="dpm-chip">{s.fmt.label}</span>
          <span class="dpm-editor-lines">{lineCount} lines</span>
        </span>
        <CopyButton text={s.script} label="Copy script" />
      </div>
      <div class="dpm-pip">
        <span class="dpm-pip-prompt" aria-hidden="true">$</span>
        <code>{s.pipLine}</code>
        <CopyButton text={s.pipLine} label="Copy install command" iconOnly />
      </div>
      <div class="dpm-code">
        <div class="dpm-gutter" aria-hidden="true">{gutter}</div>
        <pre><code dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
      </div>
      <div class={`dpm-editor-foot${exported ? "" : " is-warn"}`}>
        {exported ? (
          <>Put <code>{s.modelPath}</code> next to the script, then run <code>python inference.py</code></>
        ) : (
          <><AlertIcon size={12} /> Export {s.fmt.label} above to get <code>{s.modelPath}</code></>
        )}
      </div>
    </section>
  );
}
