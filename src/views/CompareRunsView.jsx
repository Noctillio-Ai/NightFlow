import { useState, useEffect } from "preact/hooks";
import { navigate, routeParams } from "../state/router.js";
import { allRuns, loadRunScalars } from "../state/experiments.js";
import { ChartPanel } from "../components/ChartPanel.jsx";
import { LineChart } from "../components/LineChart.jsx";

// Build tabs from scalar tags across all runs
function buildTabsCount(allScalarsByRun) {
    const tabs = {};
    for (const scalars of Object.values(allScalarsByRun)) {
        if (!scalars) continue;
        for (const tag of Object.keys(scalars)) {
            const slashIdx = tag.indexOf("/");
            const prefix = slashIdx > 0 ? tag.slice(0, slashIdx) : "other";
            if (!tabs[prefix]) tabs[prefix] = new Set();
            tabs[prefix].add(tag);
        }
    }
    // Convert sets to arrays
    const finalTabs = {};
    for (const [prefix, tagSet] of Object.entries(tabs)) {
        finalTabs[prefix] = Array.from(tagSet).sort();
    }
    return finalTabs;
}

// Strip prefix from tag for display
function stripPrefix(tag) {
    const idx = tag.indexOf("/");
    return idx > 0 ? tag.slice(idx + 1) : tag;
}

export function CompareRunsView() {
    const { runIds } = routeParams.value;
    // Fallback to empty array if no runIds provided
    const ids = Array.isArray(runIds) ? runIds : [];

    const selectedRuns = allRuns.value.filter((r) => ids.includes(r.id));
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState(null);

    useEffect(() => {
        if (selectedRuns.length === 0) return;

        // Load scalars for any runs that don't have them yet
        const runsToLoad = selectedRuns.filter(r => !r.scalars || Object.keys(r.scalars).length === 0);

        if (runsToLoad.length > 0) {
            setLoading(true);
            Promise.all(runsToLoad.map(r => loadRunScalars(r)))
                .finally(() => setLoading(false));
        }
    }, [ids.join(",")]);

    // Map run.id -> run.scalars
    const allScalarsByRun = {};
    let anyHasScalars = false;

    for (const r of selectedRuns) {
        if (r.scalars && Object.keys(r.scalars).length > 0) {
            allScalarsByRun[r.id] = r.scalars;
            anyHasScalars = true;
        }
    }

    const tabs = anyHasScalars ? buildTabsCount(allScalarsByRun) : {};
    const tabNames = Object.keys(tabs);
    const TAB_ORDER = ["train", "val", "test"];
    const sortedTabs = [
        ...TAB_ORDER.filter((t) => tabNames.includes(t)),
        ...tabNames.filter((t) => !TAB_ORDER.includes(t)),
    ];

    // Auto-select first tab
    useEffect(() => {
        if (sortedTabs.length > 0 && (!activeTab || !tabs[activeTab])) {
            setActiveTab(sortedTabs[0]);
        }
    }, [ids.join(","), sortedTabs.join(",")]);

    if (selectedRuns.length === 0) {
        return (
            <div class="run-detail-view">
                <button class="run-detail-back" onClick={() => navigate("experiments")}>
                    &larr; Back to Experiments
                </button>
                <div class="run-detail-error">No runs selected to compare.</div>
            </div>
        );
    }

    const currentTags = activeTab && tabs[activeTab] ? tabs[activeTab] : [];

    return (
        <div class="run-detail-view compare-runs-view">
            <div class="run-detail-header">
                <h2>Comparing {selectedRuns.length} Runs</h2>
            </div>

            <div class="run-detail-meta">
                {selectedRuns.map(r => (
                    <span key={r.id} class="run-meta-tag mono">
                        {r.name || r.id} ({r.model || 'Unknown'}, {r.dataset || 'Unknown'})
                    </span>
                ))}
            </div>

            <div class="run-detail-body compare-runs-body">
                <div class="run-detail-charts-area">
                    {loading && (
                        <div class="run-detail-loading">
                            Loading metrics from run logs...
                        </div>
                    )}

                    {anyHasScalars && sortedTabs.length > 0 ? (
                        <>
                            <div class="run-detail-tabs">
                                {sortedTabs.map((tab) => (
                                    <button
                                        key={tab}
                                        class={`run-detail-tab${activeTab === tab ? " active" : ""}`}
                                        onClick={() => setActiveTab(tab)}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>

                            <div class="run-detail-charts-grid">
                                {currentTags.map((tag) => {
                                    // Build series array for this tag
                                    const series = [];
                                    for (const r of selectedRuns) {
                                        const runScalars = allScalarsByRun[r.id];
                                        if (runScalars && runScalars[tag]) {
                                            const points = runScalars[tag];
                                            const data =
                                                typeof points[0] === "number"
                                                    ? points
                                                    : points.map((s) => ({
                                                        epoch: s.step ?? s.epoch ?? 0,
                                                        value: s.value,
                                                      }));
                                            series.push({
                                                label: r.name || r.id,
                                                data
                                            });
                                        }
                                    }

                                    if (series.length === 0) return null;

                                    return (
                                        <ChartPanel key={tag} title={stripPrefix(tag)}>
                                            <LineChart
                                                series={series}
                                                yLabel=""
                                                xLabel="Epoch"
                                            />
                                        </ChartPanel>
                                    );
                                })}
                            </div>
                        </>
                    ) : null}

                    {!loading && !anyHasScalars && (
                        <div class="run-detail-empty">
                            No metric data available for these runs.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
