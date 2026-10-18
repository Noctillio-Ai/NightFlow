import { useRef, useState } from "preact/hooks";
import { convertFileSrc } from "@tauri-apps/api/core";
import { navigate } from "../state/router.js";
import { currentProject } from "../state/projects.js";
import {
  INTERPRETATION_METHODS,
  isTransformer,
  completedRuns,
  selectedRunId,
  selectedRun,
  uploadedImage,
  selectedMethods,
  overlayStrength,
  interpretationHistory,
  selectRun,
  toggleMethod,
  setImage,
  clearImage,
  reopenInterpretation,
  runInterpretation,
  interpretationLoading,
  interpretationResult,
  interpretationError,
} from "../state/interpretation.js";
import { AlertIcon, ChartBarsIcon, CheckIcon, PlayIcon, XIcon } from "../components/dashboard/icons.jsx";
import { formatRelativeTime } from "../utils/format.js";

const ImageIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="8.5" r="1.6" /><path d="m21 15-5-5L5 21" />
  </svg>
);
const UploadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const FocusIcon = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" /><circle cx="12" cy="12" r="3.5" />
  </svg>
);

const ACCEPT = "image/png,image/jpeg,image/webp,image/bmp";
const hpOf = (run, ...keys) => {
  for (const src of [run?.fileHparams, run?.hyperparameters]) for (const k of keys) if (src?.[k] != null && src[k] !== "") return src[k];
  return undefined;
};

/** Picks an image file by click or drop. */
function useImagePicker() {
  const ref = useRef(null);
  const pick = (file) => file && file.type.startsWith("image/") && setImage(file);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={(e) => {
        pick(e.currentTarget.files?.[0]);
        e.currentTarget.value = "";
      }}
    />
  );
  return { input, open: () => ref.current?.click(), pick };
}

function DropZone() {
  const { input, open, pick } = useImagePicker();
  const [over, setOver] = useState(false);
  return (
    <div
      class={`ip-drop${over ? " ip-drop--over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer?.files?.[0]); }}
    >
      {input}
      <span class="ip-drop-icon"><ImageIcon size={34} /></span>
      <strong>Drop an image here</strong>
      <span class="ip-or">or</span>
      <button class="dash-btn dash-btn--primary ip-choose" onClick={open}><UploadIcon /> Choose image</button>
      <span class="ip-drop-hint">PNG, JPG, WEBP or BMP</span>
    </div>
  );
}

function ImagePreview({ image }) {
  const { input, open, pick } = useImagePicker();
  return (
    <div class="ip-preview" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer?.files?.[0]); }}>
      {input}
      <div class="ip-preview-img"><img src={image.url} alt={image.name} /></div>
      <div class="ip-preview-bar">
        <span class="ip-preview-name" title={image.name}><ImageIcon size={15} />{image.name}</span>
        {image.size > 0 && <span class="ip-muted">{(image.size / 1024).toFixed(image.size > 1024 * 1024 ? 0 : 1)} KB</span>}
        <div class="ip-preview-actions">
          <button class="dash-btn dash-btn--quiet" onClick={open}>Replace</button>
          <button class="dash-icon-btn" onClick={clearImage} aria-label="Remove image" title="Remove image"><XIcon size={14} /></button>
        </div>
      </div>
    </div>
  );
}

function Settings({ run, image, loading }) {
  const methods = selectedMethods.value;
  const transformer = isTransformer(run);
  const reason = !run ? "Choose a run first." : !image ? "Add an image to explain." : methods.length === 0 ? "Pick at least one method." : null;
  return (
    <section class="ip-card ip-settings">
      <h3>Analysis settings</h3>

      <div class="ip-field">
        <span class="ip-label">Explanation methods <span class="ip-muted">· {methods.length} selected</span></span>
        <div class="ip-methods">
          {INTERPRETATION_METHODS.map((m) => {
            const on = methods.includes(m.id);
            const unsupported = m.transformer && run && !transformer;
            return (
              <button
                key={m.id}
                class={`ip-method${on ? " active" : ""}${unsupported ? " ip-method--dim" : ""}`}
                aria-pressed={on}
                onClick={() => toggleMethod(m.id)}
                title={unsupported ? `${m.desc}. This run's backbone isn't a transformer, so it will fail.` : m.desc}
              >
                <span class="ip-method-check">{on && <CheckIcon size={11} />}</span>
                <span class="ip-method-text">
                  <strong>{m.label}</strong>
                  <small>{unsupported ? "Transformers only" : m.desc}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div class="ip-field">
        <span class="ip-label">
          Heatmap overlay
          <span class="ip-value">{Math.round(overlayStrength.value * 100)}%</span>
        </span>
        <input
          type="range"
          class="ip-range"
          min="0"
          max="100"
          value={Math.round(overlayStrength.value * 100)}
          style={{ "--p": `${overlayStrength.value * 100}%` }}
          onInput={(e) => (overlayStrength.value = Number(e.currentTarget.value) / 100)}
          aria-label="Heatmap overlay strength"
        />
        <span class="ip-hint">Fades the heatmaps in over the original image. Updates instantly, no re-run needed.</span>
      </div>

      <button class="dash-btn dash-btn--primary ip-run" disabled={!!reason || loading} onClick={runInterpretation}>
        {loading ? <span class="ip-spinner" /> : <PlayIcon size={14} />}
        {loading ? "Running…" : "Run interpretation"}
      </button>
      {reason && !loading && <span class="ip-hint ip-hint--center">{reason}</span>}
    </section>
  );
}

const methodSrc = (result, id) =>
  result?.results?.[id] ? result.images?.[id] || `${convertFileSrc(result.results[id])}?t=${result.stamp}` : null;

/** Original and heatmap stacked; the overlay follows the overlay-strength setting. */
function Stacked({ image, src, alt, split }) {
  return (
    <div class="ip-stack">
      <img src={image.url} alt={image.name} />
      {src && (
        <img
          class="ip-stack-overlay"
          src={src}
          alt={alt}
          style={{ opacity: overlayStrength.value, clipPath: split != null ? `inset(0 0 0 ${split}%)` : undefined }}
        />
      )}
    </div>
  );
}

/** Large view of one method with a draggable original | heatmap divider. */
function Stage({ image, method, src, error, loading }) {
  const [split, setSplit] = useState(50);
  return (
    <div class="ip-stage">
      <div class="ip-stage-frame">
        <Stacked image={image} src={src} alt={`${method?.label} heatmap`} split={src ? split : null} />
        {src && (
          <>
            <div class="ip-split-line" style={{ left: `${split}%` }}><span /></div>
            <span class="ip-stage-tag ip-stage-tag--l">Original</span>
            <span class="ip-stage-tag ip-stage-tag--r">{method.label}</span>
            <input
              class="ip-split-input"
              type="range"
              min="0"
              max="100"
              value={split}
              onInput={(e) => setSplit(Number(e.currentTarget.value))}
              aria-label="Drag to compare the original with the heatmap"
            />
          </>
        )}
        {loading && <div class="ip-stage-state"><span class="ip-spinner" />Computing heatmaps…</div>}
        {!loading && error && (
          <div class="ip-stage-state ip-stage-state--err">
            <AlertIcon size={20} />
            <strong>{method.label} failed</strong>
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Results({ run, image, result, loading }) {
  const classNames = currentProject.value?.classNames || [];
  const ids = loading ? selectedMethods.value : result?.methods || Object.keys(result?.results || {});
  const shown = INTERPRETATION_METHODS.filter((m) => ids.includes(m.id));
  const [active, setActive] = useState(null);
  const [view, setView] = useState("focus");
  const firstOk = shown.find((m) => result?.results?.[m.id]) || shown[0];
  const current = shown.find((m) => m.id === active) || firstOk;
  const idx = result?.predicted_class;
  const hasPred = Number.isInteger(idx) && !loading;
  const ok = shown.filter((m) => result?.results?.[m.id]).length;

  return (
    <section class="ip-card ip-results">
      <header class="ip-results-head">
        <div>
          <h3>Results</h3>
          <span class="ip-muted">
            {loading
              ? `Running ${shown.length} ${shown.length === 1 ? "method" : "methods"} on ${run?.name || "the selected run"}…`
              : `${ok} of ${shown.length} ${shown.length === 1 ? "method" : "methods"} succeeded${run ? ` · ${run.name || run.id}` : ""}`}
          </span>
        </div>
        <div class="ip-seg" role="group" aria-label="Layout">
          <button class={view === "focus" ? "active" : ""} aria-pressed={view === "focus"} onClick={() => setView("focus")}>Focus</button>
          <button class={view === "grid" ? "active" : ""} aria-pressed={view === "grid"} onClick={() => setView("grid")}>Compare all</button>
        </div>
      </header>

      {view === "grid" ? (
        <div class="ip-grid">
          <figure class="ip-tile">
            <Stacked image={image} />
            <figcaption><strong>Original</strong><span>Your image, for reference</span></figcaption>
          </figure>
          {shown.map((m) => {
            const err = !loading && result?.errors?.[m.id];
            return (
              <figure key={m.id} class={`ip-tile${err ? " ip-tile--err" : ""}`} onClick={() => { setActive(m.id); setView("focus"); }} title="Open in focus view">
                <Stacked image={image} src={loading ? null : methodSrc(result, m.id)} alt={`${m.label} heatmap`} />
                {loading && <div class="ip-tile-state"><span class="ip-spinner" /></div>}
                {err && <div class="ip-tile-state"><AlertIcon size={16} /></div>}
                <figcaption><strong>{m.label}</strong><span>{err ? "Failed" : m.desc}</span></figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        <div class="ip-focus">
          <div class="ip-info">
            <div class={`ip-side-card ip-pred${hasPred ? "" : " ip-pred--pending"}`}>
              <span class="ip-pred-icon"><ChartBarsIcon size={18} /></span>
              <div class="ip-pred-body">
                <span class="ip-side-label">Predicted class</span>
                <strong title={hasPred ? classNames[idx] ?? `Class ${idx}` : undefined}>
                  {hasPred ? classNames[idx] ?? `Class ${idx}` : loading ? "Predicting…" : "—"}
                </strong>
              </div>
              {hasPred && <code class="ip-pred-idx" title="Class index">#{idx}</code>}
            </div>

            {current && (
              <div class="ip-side-card">
                <span class="ip-side-label">Reading {current.label}</span>
                <p class="ip-side-text">{current.desc}. Warm areas pushed the model toward its prediction the most.</p>
                <div class="ip-scale-row">
                  <span>Low</span>
                  <div class="ip-scale"><i /></div>
                  <span>High</span>
                </div>
              </div>
            )}

            <div class="ip-side-card ip-side-card--list">
              <span class="ip-side-label">Methods <span class="ip-side-count">{shown.filter((m) => result?.results?.[m.id]).length}/{shown.length}</span></span>
              <ul class="ip-status">
                {shown.map((m) => {
                  const state = loading ? "busy" : result?.results?.[m.id] ? "ok" : "err";
                  const on = current?.id === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        class={`ip-status--${state}${on ? " active" : ""}`}
                        onClick={() => setActive(m.id)}
                        aria-pressed={on}
                        title={state === "err" ? result?.errors?.[m.id] : `Show ${m.label}`}
                      >
                        <i />
                        <span class="ip-status-name">{m.label}</span>
                        {state !== "ok" && <span class="ip-status-state">{state === "busy" ? "Running" : "Failed"}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          <div class="ip-focus-main">
            <Stage
              image={image}
              method={current}
              loading={loading}
              src={loading || !current ? null : methodSrc(result, current.id)}
              error={!loading && current ? result?.errors?.[current.id] : null}
            />
            <div class="ip-strip" role="tablist" aria-label="Methods">
              {shown.map((m) => {
                const err = !loading && result?.errors?.[m.id];
                const on = current?.id === m.id;
                return (
                  <button key={m.id} role="tab" aria-selected={on} class={`ip-strip-item${on ? " active" : ""}${err ? " ip-strip-item--err" : ""}`} onClick={() => setActive(m.id)}>
                    <span class="ip-strip-thumb">
                      <Stacked image={image} src={loading ? null : methodSrc(result, m.id)} alt="" />
                      {err && <span class="ip-strip-badge"><AlertIcon size={12} /></span>}
                      {loading && <span class="ip-strip-badge ip-strip-badge--busy"><span class="ip-spinner" /></span>}
                    </span>
                    <span class="ip-strip-label">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>
      )}
    </section>
  );
}

/** Small, abstract previews of each output (illustrations, not data). */
const StepArt = {
  image: () => (
    <div class="ip-art ip-art--image">
      <span class="ip-art-frame"><ImageIcon size={26} /></span>
    </div>
  ),
  class: () => (
    <div class="ip-art ip-art--class">
      {[92, 38, 22].map((w, i) => (
        <span key={i} class={i === 0 ? "top" : undefined}><i style={{ width: `${w}%` }} /></span>
      ))}
    </div>
  ),
  heat: () => (
    <div class="ip-art ip-art--heat">
      <span class="ip-art-frame"><span class="ip-art-glow" /><FocusIcon size={26} /></span>
    </div>
  ),
};

function WhatYouGet() {
  const steps = [
    { art: "image", tone: "blue", title: "Original image", desc: "The image you add, shown for reference." },
    { art: "class", tone: "green", title: "Predicted class", desc: "What this run’s model thinks the image shows." },
    { art: "heat", tone: "amber", title: "Attention heatmaps", desc: "One per method, highlighting the regions that drove the prediction." },
  ];
  return (
    <section class="ip-card ip-steps">
      <header>
        <h3>What you’ll get</h3>
        <span class="ip-muted">Add an image and run to see all three.</span>
      </header>
      <ol>
        {steps.map((s, i) => {
          const Art = StepArt[s.art];
          return (
            <li key={s.title} class={`ip-step ip-tone--${s.tone}`}>
              <Art />
              <div class="ip-step-text">
                <span class="ip-step-num">Step {i + 1}</span>
                <strong>{s.title}</strong>
                <span>{s.desc}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Recent({ entries, current }) {
  const classNames = currentProject.value?.classNames || [];
  return (
    <section class="ip-card ip-recent">
      <header>
        <h3>Recent</h3>
        <span class="ip-muted">This session · click to reopen</span>
      </header>
      <div class="ip-recent-list">
        {entries.map((e) => {
          const idx = e.result.predicted_class;
          const first = Object.values(e.result.images || {})[0];
          const on = current?.stamp === e.result.stamp;
          return (
            <button key={e.id} class={`ip-recent-item${on ? " active" : ""}`} onClick={() => reopenInterpretation(e)} aria-current={on || undefined}>
              <span class="ip-recent-thumb">
                <Stacked image={e.image} src={first} alt="" />
              </span>
              <span class="ip-recent-text">
                <strong>{Number.isInteger(idx) ? classNames[idx] ?? `Class ${idx}` : "No prediction"}</strong>
                <small title={e.image.name}>{e.image.name}</small>
                <small>{e.runName} · {formatRelativeTime(e.at)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function InterpretationView() {
  const runs = completedRuns.value;
  const run = selectedRun.value;
  const image = uploadedImage.value;
  const loading = interpretationLoading.value;
  const result = interpretationResult.value;
  const history = interpretationHistory.value;

  const classes = currentProject.value?.classNames?.length || hpOf(run, "numClasses", "num_classes");
  const size = hpOf(run, "imageSize", "image_size");
  const showResults = image && (loading || result);

  return (
    <div class="dash ip">
      <header class="ip-head">
        <div class="ip-title">
          <h2>Interpretation</h2>
          <span class="ip-muted">See which parts of an image drove a model’s prediction.</span>
        </div>
        <div class="ip-runbar">
          <select class="ip-select" value={selectedRunId.value} onChange={(e) => selectRun(e.currentTarget.value)} aria-label="Run" disabled={runs.length === 0}>
            <option value="">{runs.length ? "Select a run…" : "No runs with a checkpoint"}</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name || r.id} · {r.backbone || r.model}
              </option>
            ))}
          </select>
          {run && (
            <>
              <span class="ip-chip ip-chip--ok" title="Checkpoint found"><i />Checkpoint ready</span>
              {classes ? <span class="ip-chip">{classes} classes</span> : null}
              {size ? <span class="ip-chip">{size} × {size} input</span> : null}
            </>
          )}
        </div>
      </header>

      {runs.length === 0 ? (
        <div class="rd-empty">
          <ChartBarsIcon size={22} />
          <strong>No runs to interpret yet</strong>
          <span>Interpretation needs a completed run with a saved checkpoint.</span>
          <button class="dash-btn dash-btn--quiet" onClick={() => navigate("experiments")}>Go to Experiments</button>
        </div>
      ) : (
        <>
          <div class="ip-main">
            <section class="ip-card ip-explain">
              <h3 class="ip-big">Explain a prediction</h3>
              <span class="ip-muted">Add an image to see what influenced {run ? <strong>{run.name || run.id}</strong> : "the model"}’s decision.</span>
              {image ? <ImagePreview image={image} /> : <DropZone />}
            </section>
            <Settings run={run} image={image} loading={loading} />
          </div>

          {interpretationError.value && (
            <div class="ip-error" role="alert">
              <AlertIcon size={16} />
              <span>{interpretationError.value}</span>
            </div>
          )}

          {showResults ? <Results run={run} image={image} result={result} loading={loading} /> : <WhatYouGet />}
          {history.length > 0 && <Recent entries={history} current={result} />}
        </>
      )}
    </div>
  );
}
