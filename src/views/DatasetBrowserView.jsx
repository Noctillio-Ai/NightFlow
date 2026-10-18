import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { currentProject } from "../state/projects.js";
import { datasetValidation } from "../state/dashboard.js";
import { navigate } from "../state/router.js";
import {
  AlertIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  CheckIcon,
  SlidersIcon,
  XIcon,
} from "../components/dashboard/icons.jsx";

const PAGE_SIZE = 50;
const CLASS_PREVIEW = 12; // classes listed before "Show all"
const DENSITIES = ["auto", 4, 5, 6, 7, 8];

const SPLIT_LABELS = { train: "Train", val: "Validation", valid: "Validation", validation: "Validation", test: "Test" };
const splitLabel = (s) => SPLIT_LABELS[s] || s.charAt(0).toUpperCase() + s.slice(1);

function extractFilename(filePath) {
  if (!filePath) return "";
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

/** Stable per-class colour from the class's position in the sorted list. */
const classColor = (index) => `hsl(${(index * 137.508) % 360} 65% 58%)`;

/** How even the class sizes are: largest class vs smallest. */
function classBalance(counts) {
  const values = Object.values(counts).filter((n) => n > 0);
  if (values.length < 2) return null;
  const ratio = Math.max(...values) / Math.min(...values);
  if (ratio <= 1.5) return { label: "Balanced", state: "ok", ratio };
  if (ratio <= 3) return { label: "Slightly imbalanced", state: "warn", ratio };
  return { label: "Imbalanced", state: "err", ratio };
}

/** Remember a small UI preference per viewer; storage may be unavailable. */
function usePref(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });
  const set = (v) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
  };
  return [value, set];
}

const GridIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
);
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <circle cx="8.5" cy="8.5" r="5.5" /><line x1="13" y1="13" x2="18" y2="18" />
  </svg>
);

function Pagination({ offset, total, onPage }) {
  const current = Math.floor(offset / PAGE_SIZE);
  const pages = Math.ceil(total / PAGE_SIZE);
  const nums = [...new Set([0, pages - 1, current - 2, current - 1, current, current + 1, current + 2])]
    .filter((p) => p >= 0 && p < pages)
    .sort((a, b) => a - b);
  return (
    <nav class="db-pagination" aria-label="Pages">
      <div class="db-pages">
        <button class="db-page db-page--arrow" disabled={current === 0} onClick={() => onPage(0)} title="First page" aria-label="First page">«</button>
        <button class="db-page db-page--arrow" disabled={current === 0} onClick={() => onPage(current - 1)} title="Previous page" aria-label="Previous page">‹</button>
        {nums.map((p, i) => (
          <>
            {i > 0 && p - nums[i - 1] > 1 && <span class="db-page-gap">…</span>}
            <button key={p} class={`db-page${p === current ? " db-page--active" : ""}`} onClick={() => onPage(p)} aria-current={p === current ? "page" : undefined}>
              {p + 1}
            </button>
          </>
        ))}
        <button class="db-page db-page--arrow" disabled={current >= pages - 1} onClick={() => onPage(current + 1)} title="Next page" aria-label="Next page">›</button>
        <button class="db-page db-page--arrow" disabled={current >= pages - 1} onClick={() => onPage(pages - 1)} title="Last page" aria-label="Last page">»</button>
      </div>
      <span class="db-pagination-info">
        {(offset + 1).toLocaleString()}–{Math.min(offset + PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
      </span>
    </nav>
  );
}

function Lightbox({ image, color, position, total, onClose, onPrev, onNext, hasPrev, hasNext }) {
  const [copied, setCopied] = useState(false);
  // Tiny images (e.g. 32×32 CIFAR) are scaled up; keep their pixels crisp.
  const [tinyPath, setTinyPath] = useState(null);
  const tiny = tinyPath === image.path;
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(image.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div class="db-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${image.label} — ${extractFilename(image.path)}`}>
      <button class="db-lightbox-nav db-lightbox-nav--prev" disabled={!hasPrev} onClick={(e) => { e.stopPropagation(); onPrev(); }} aria-label="Previous image" title="Previous (←)">‹</button>
      <figure class="db-lightbox-body" onClick={(e) => e.stopPropagation()}>
        <div class="db-lightbox-frame">
          <img
            src={convertFileSrc(image.path)}
            alt={image.label}
            class={tiny ? "db-pixelated" : undefined}
            onLoad={(e) => {
              const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
              setTinyPath(Math.max(w, h) <= 128 ? image.path : null);
            }}
          />
        </div>
        <figcaption>
          <div class="db-lightbox-title">
            <span class="db-dot" style={{ background: color }} />
            <strong>{image.label}</strong>
            <span class="db-lightbox-name">{extractFilename(image.path)}</span>
            <span class="db-lightbox-pos">{position.toLocaleString()} of {total.toLocaleString()}</span>
          </div>
          <div class="db-lightbox-path">
            <code title={image.path}><bdi>{image.path}</bdi></code>
            <button class="db-lightbox-copy" onClick={copyPath} title="Copy file path">
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />} {copied ? "Copied" : "Copy path"}
            </button>
          </div>
        </figcaption>
      </figure>
      <button class="db-lightbox-nav db-lightbox-nav--next" disabled={!hasNext} onClick={(e) => { e.stopPropagation(); onNext(); }} aria-label="Next image" title="Next (→)">›</button>
      <button class="db-lightbox-close" onClick={onClose} title="Close (Esc)" aria-label="Close"><XIcon size={18} /></button>
    </div>
  );
}

export function DatasetBrowserView() {
  const project = currentProject.value;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [selectedClasses, setSelectedClasses] = useState(new Set());
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const pendingLightbox = useRef(null); // "first" | "last" after paging from the lightbox
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSplit, setActiveSplit] = useState("train");
  const [detectedSplits, setDetectedSplits] = useState([]);
  const [splitStats, setSplitStats] = useState({}); // { split: { total, class_counts } }
  const [showAllClasses, setShowAllClasses] = useState(false);
  const [viewMode, setViewMode] = usePref("nf-dataset-view", "grid");
  const [density, setDensity] = usePref("nf-dataset-density", "auto");
  const searchRef = useRef(null);

  const isCsvOrJsonl = project?.datasetFormat === "CSV" || project?.datasetFormat === "JSONL";
  const datasetFormat = project?.datasetFormat || "Folder";
  const imageFolderPath = project?.imageFolderPath || "";
  const invalid = !!(datasetValidation.value && !datasetValidation.value.valid);

  // For Folder format, auto-detect splits from folder structure
  const folderPath = project?.folderPath || project?.trainPath || "";
  useEffect(() => {
    if (isCsvOrJsonl || !folderPath) {
      setDetectedSplits([]);
      return;
    }
    invoke("detect_dataset_splits", { path: folderPath })
      .then((splits) => setDetectedSplits(splits || []))
      .catch(() => setDetectedSplits([]));
  }, [folderPath, isCsvOrJsonl]);

  // Build available splits
  let availableSplits = [];
  let splitPaths = null;
  if (isCsvOrJsonl) {
    splitPaths = {};
    if (project?.trainPath) splitPaths.train = project.trainPath;
    if (project?.valPath) splitPaths.val = project.valPath;
    if (project?.testPath) splitPaths.test = project.testPath;
    availableSplits = Object.keys(splitPaths);
  } else if (detectedSplits.length > 0) {
    availableSplits = detectedSplits;
  }

  const effectiveSplit = availableSplits.includes(activeSplit) ? activeSplit : availableSplits[0] || "train";
  const datasetPath = isCsvOrJsonl && splitPaths ? splitPaths[effectiveSplit] || "" : folderPath;
  const splitsKey = availableSplits.join(",");

  const browseArgs = (split, extra) => ({
    path: isCsvOrJsonl && splitPaths ? splitPaths[split] || "" : folderPath,
    format: datasetFormat,
    imageFolder: imageFolderPath || null,
    imageColumn: project?.imageColumn?.trim() || null,
    labelColumn: project?.labelColumn?.trim() || null,
    labelColumns: project?.taskType === "Multi-Label Classification"
      ? (project.labelColumns || "").split(",").map((v) => v.trim()).filter(Boolean)
      : null,
    split: detectedSplits.length > 0 && !isCsvOrJsonl ? split : null,
    classFilter: null,
    search: null,
    ...extra,
  });

  // Per-split totals and class counts (unfiltered) for the tabs and the sidebar.
  useEffect(() => {
    if (!folderPath && !isCsvOrJsonl) return;
    const splits = availableSplits.length ? availableSplits : [effectiveSplit];
    let cancelled = false;
    Promise.all(
      splits.map((s) =>
        invoke("browse_dataset", browseArgs(s, { limit: 0, offset: 0 }))
          .then((r) => [s, { total: r.total, class_counts: r.class_counts || {} }])
          .catch(() => [s, null]),
      ),
    ).then((entries) => {
      if (!cancelled) setSplitStats(Object.fromEntries(entries.filter(([, v]) => v)));
    });
    return () => { cancelled = true; };
  }, [splitsKey, folderPath, datasetFormat, imageFolderPath, project?.imageColumn, project?.labelColumn, project?.labelColumns, project?.taskType, detectedSplits.length]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filterKey = [...selectedClasses].sort().join("\0");

  // The current page of images
  useEffect(() => {
    if (!datasetPath) return;
    setLoading(true);
    setError(null);
    invoke("browse_dataset", browseArgs(effectiveSplit, {
      limit: PAGE_SIZE,
      offset,
      classFilter: selectedClasses.size > 0 ? [...selectedClasses] : null,
      search: searchQuery || null,
    }))
      .then((result) => {
        setData(result);
        setLoading(false);
        // Paging from inside the lightbox: land on the first/last image of the new page.
        if (pendingLightbox.current && result.images?.length) {
          setLightboxIdx(pendingLightbox.current === "first" ? 0 : result.images.length - 1);
        }
        pendingLightbox.current = null;
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [datasetPath, datasetFormat, offset, filterKey, imageFolderPath, project?.imageColumn, project?.labelColumn, project?.labelColumns, project?.taskType, searchQuery, effectiveSplit, detectedSplits]);

  const images = data?.images || [];
  const total = data?.total || 0;

  const stepLightbox = useCallback((delta) => {
    setLightboxIdx((idx) => {
      if (idx == null) return idx;
      const next = idx + delta;
      if (next >= 0 && next < images.length) return next;
      if (delta > 0 && offset + PAGE_SIZE < total) {
        pendingLightbox.current = "first";
        setOffset(offset + PAGE_SIZE);
      } else if (delta < 0 && offset > 0) {
        pendingLightbox.current = "last";
        setOffset(Math.max(0, offset - PAGE_SIZE));
      }
      return idx;
    });
  }, [images.length, offset, total]);

  // Keyboard: Esc / arrows in the lightbox, "/" focuses search.
  useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName);
      if (lightboxIdx != null) {
        if (e.key === "Escape") setLightboxIdx(null);
        else if (e.key === "ArrowRight") stepLightbox(1);
        else if (e.key === "ArrowLeft") stepLightbox(-1);
        return;
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIdx, stepLightbox]);

  const toggleClass = useCallback((className) => {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(className)) next.delete(className);
      else next.add(className);
      return next;
    });
    setOffset(0);
  }, []);

  const clearFilters = () => {
    setSelectedClasses(new Set());
    setSearchInput("");
    setSearchQuery("");
    setOffset(0);
  };

  const switchSplit = (split) => {
    setActiveSplit(split);
    setOffset(0);
    setSelectedClasses(new Set());
    setSearchInput("");
    setSearchQuery("");
    setShowAllClasses(false);
  };

  if (!project) {
    return (
      <div class="dataset-browser-view dash">
        <div class="db-empty">No project selected.</div>
      </div>
    );
  }

  if (!datasetPath) {
    return (
      <div class="dataset-browser-view dash">
        <div class="db-empty">
          <strong>No dataset configured</strong>
          <span>Set a dataset path in project settings to browse its images.</span>
          <button class="dash-btn dash-btn--primary" onClick={() => navigate("settings")}>Open settings</button>
        </div>
      </div>
    );
  }

  const stats = splitStats[effectiveSplit];
  const classCounts = stats?.class_counts || data?.class_counts || {};
  const classNames = Object.keys(classCounts).sort();
  const colorOf = (name) => classColor(Math.max(0, classNames.indexOf(name)));
  const maxCount = Math.max(1, ...Object.values(classCounts));
  const splitTotal = stats?.total ?? Object.values(classCounts).reduce((s, n) => s + n, 0);
  const balance = classBalance(classCounts);
  const visibleClasses = showAllClasses ? classNames : classNames.slice(0, CLASS_PREVIEW);
  const filtering = selectedClasses.size > 0 || !!searchQuery;
  const filterLabel = selectedClasses.size === 1
    ? [...selectedClasses][0]
    : selectedClasses.size > 1
      ? `${selectedClasses.size} classes`
      : "All classes";
  const lightboxImage = lightboxIdx != null ? images[lightboxIdx] : null;
  const gridStyle = density === "auto" ? undefined : { "--db-cols": density };

  return (
    <div class="dataset-browser-view dash db">
      {/* Summary + actions */}
      <div class="db-topbar">
        <div class="db-summary">
          <span><strong>{splitTotal.toLocaleString()}</strong> images</span>
          <span class="db-sep" aria-hidden="true" />
          <span><strong>{classNames.length.toLocaleString()}</strong> {classNames.length === 1 ? "class" : "classes"}</span>
          <span class="db-sep" aria-hidden="true" />
          <span class="db-muted">{datasetFormat} dataset</span>
        </div>
        <div class="db-topbar-actions">
          <button class="dash-btn dash-btn--quiet" onClick={() => navigate("settings")}>
            <SlidersIcon size={15} /> Dataset settings
          </button>
          <div class="db-segmented" role="group" aria-label="Layout">
            <button class={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} aria-pressed={viewMode === "grid"} title="Grid view"><GridIcon /></button>
            <button class={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"} title="List view"><ListIcon /></button>
          </div>
        </div>
      </div>

      {/* Split tabs */}
      {availableSplits.length > 1 && (
        <div class="db-tabs" role="tablist">
          {availableSplits.map((split) => (
            <button
              key={split}
              role="tab"
              aria-selected={effectiveSplit === split}
              class={`db-tab${effectiveSplit === split ? " active" : ""}`}
              onClick={() => switchSplit(split)}
            >
              {splitLabel(split)}
              {splitStats[split] && <span class="db-tab-count">{splitStats[split].total.toLocaleString()}</span>}
            </button>
          ))}
        </div>
      )}

      {invalid && (
        <div class="db-invalid">
          <AlertIcon size={16} />
          <div>
            <strong>Dataset structure is invalid</strong>
            <ul>{datasetValidation.value.errors.map((err, i) => <li key={i}>{err}</li>)}</ul>
          </div>
        </div>
      )}
      {error && <div class="dash-note dash-note--err">{error}</div>}

      <div class="db-body">
        {/* Sidebar: health + classes */}
        {classNames.length > 0 && !invalid && (
          <aside class="db-side">
            <section class="db-card">
              <h3 class="db-card-title">Dataset health</h3>
              <dl class="db-health">
                <div><dt>Total images</dt><dd>{splitTotal.toLocaleString()}</dd></div>
                <div><dt>Classes</dt><dd>{classNames.length.toLocaleString()}</dd></div>
                <div><dt>Avg per class</dt><dd>{Math.round(Object.values(classCounts).reduce((s, n) => s + n, 0) / classNames.length).toLocaleString()}</dd></div>
                {balance && (
                  <div title={`The largest class has ${balance.ratio.toFixed(1)}× the images of the smallest`}>
                    <dt>Class balance</dt>
                    <dd class={`db-balance db-balance--${balance.state}`}><span class="dash-dot" />{balance.label}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section class="db-card db-classes">
              <div class="db-card-head">
                <h3 class="db-card-title">Classes</h3>
                {selectedClasses.size > 0 && (
                  <button class="db-link" onClick={() => { setSelectedClasses(new Set()); setOffset(0); }}>
                    Clear ({selectedClasses.size})
                  </button>
                )}
              </div>
              <ul>
                {visibleClasses.map((c) => {
                  const active = selectedClasses.has(c);
                  return (
                    <li key={c}>
                      <button class={`db-class${active ? " active" : ""}`} onClick={() => toggleClass(c)} aria-pressed={active} title={`Show only ${c}`}>
                        <span class="db-dot" style={{ background: colorOf(c) }} />
                        <span class="db-class-name">{c}</span>
                        <span class="db-class-count">{(classCounts[c] || 0).toLocaleString()}</span>
                        <span class="db-class-bar" aria-hidden="true">
                          <span style={{ width: `${((classCounts[c] || 0) / maxCount) * 100}%`, background: colorOf(c) }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {classNames.length > CLASS_PREVIEW && (
                <button class="db-showall" onClick={() => setShowAllClasses(!showAllClasses)}>
                  {showAllClasses ? "Show fewer classes" : `Show all ${classNames.length} classes`}
                  <span class={showAllClasses ? "db-chev-up" : undefined}>{showAllClasses ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}</span>
                </button>
              )}
            </section>
          </aside>
        )}

        {/* Main: toolbar, results, grid/list, pagination */}
        <section class="db-main">
          <div class="db-toolbar">
            <label class={`db-search${invalid ? " disabled" : ""}`}>
              <SearchIcon />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search filenames or labels…"
                value={searchInput}
                disabled={invalid}
                onInput={(e) => { setSearchInput(e.target.value); setOffset(0); }}
              />
              {searchInput ? (
                <button class="db-search-clear" onClick={() => { setSearchInput(""); setSearchQuery(""); setOffset(0); }} title="Clear search" aria-label="Clear search">
                  <XIcon size={13} />
                </button>
              ) : (
                <kbd class="db-kbd">/</kbd>
              )}
            </label>
            {viewMode === "grid" && (
              <label class="db-select">
                <span class="sr-only">Images per row</span>
                <select value={density} onChange={(e) => setDensity(e.target.value === "auto" ? "auto" : Number(e.target.value))}>
                  {DENSITIES.map((d) => <option key={d} value={d}>{d === "auto" ? "Auto size" : `${d} per row`}</option>)}
                </select>
                <ChevronDownIcon size={14} />
              </label>
            )}
          </div>

          <div class="db-results">
            <span>
              <strong>{filterLabel}</strong>
              {searchQuery && <> matching “{searchQuery}”</>}
              <span class="db-muted"> · {total.toLocaleString()} {total === 1 ? "image" : "images"}{total > 0 && ` · ${(offset + 1).toLocaleString()}–${Math.min(offset + PAGE_SIZE, total).toLocaleString()} shown`}</span>
            </span>
            {filtering && <button class="db-link" onClick={clearFilters}>Clear filters</button>}
          </div>

          {loading && !data ? (
            <div class="db-grid" style={gridStyle}>
              {Array.from({ length: 14 }, (_, i) => <div key={i} class="db-card-img db-skeleton" />)}
            </div>
          ) : images.length === 0 ? (
            <div class="db-empty">
              <strong>No images</strong>
              <span>
                {searchQuery ? `Nothing matches “${searchQuery}”.` : selectedClasses.size > 0 ? "No images in the selected classes." : "No images were found in this dataset."}
              </span>
              {filtering && <button class="dash-btn dash-btn--quiet" onClick={clearFilters}>Clear filters</button>}
            </div>
          ) : viewMode === "grid" ? (
            <div class={`db-grid${loading ? " db-loading" : ""}`} style={gridStyle}>
              {images.map((img, i) => {
                const filename = extractFilename(img.path);
                return (
                  <button key={img.path} class="db-card-img" onClick={() => setLightboxIdx(i)} title={`${img.label} — ${filename}`}>
                    <span class="db-thumb"><img src={convertFileSrc(img.path)} alt={img.label} loading="lazy" /></span>
                    <span class="db-card-meta">
                      <span class="db-card-label"><span class="db-dot" style={{ background: colorOf(img.label) }} />{img.label}</span>
                      <span class="db-card-file">{filename}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div class={`db-list${loading ? " db-loading" : ""}`} role="list">
              {images.map((img, i) => (
                <button key={img.path} class="db-row" role="listitem" onClick={() => setLightboxIdx(i)}>
                  <span class="db-row-n">{(offset + i + 1).toLocaleString()}</span>
                  <span class="db-row-thumb"><img src={convertFileSrc(img.path)} alt="" loading="lazy" /></span>
                  <span class="db-card-label"><span class="db-dot" style={{ background: colorOf(img.label) }} />{img.label}</span>
                  <span class="db-row-file">{extractFilename(img.path)}</span>
                  <span class="db-row-path" title={img.path}><bdi>{img.path}</bdi></span>
                </button>
              ))}
            </div>
          )}

          {total > PAGE_SIZE && <Pagination offset={offset} total={total} onPage={(p) => setOffset(p * PAGE_SIZE)} />}
        </section>
      </div>

      {lightboxImage && (
        <Lightbox
          image={lightboxImage}
          color={colorOf(lightboxImage.label)}
          position={offset + lightboxIdx + 1}
          total={total}
          onClose={() => setLightboxIdx(null)}
          onPrev={() => stepLightbox(-1)}
          onNext={() => stepLightbox(1)}
          hasPrev={offset + lightboxIdx > 0}
          hasNext={offset + lightboxIdx + 1 < total}
        />
      )}
    </div>
  );
}
