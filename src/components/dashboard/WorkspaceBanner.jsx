import { useEffect, useState } from "preact/hooks";
import {
  sshInfo,
  sshConnecting,
  toggleSshConnection,
  dashboardSyncing,
  syncDashboard,
  lastSyncedAt,
} from "../../state/dashboard.js";
import { currentProject } from "../../state/projects.js";
import { formatRelativeTime } from "../../utils/format.js";
import { collectChecks } from "./readinessChecks.js";
import { Dot } from "./Card.jsx";
import {
  AlertIcon,
  CheckIcon,
  ChevronDownIcon,
  FlaskIcon,
  FolderIcon,
  LayersIcon,
  PackageIcon,
  RefreshIcon,
  TerminalIcon,
  XIcon,
} from "./icons.jsx";

const KIND_ICON = { path: FolderIcon, structure: LayersIcon, pkg: PackageIcon, python: TerminalIcon, lib: FlaskIcon };
const STATE_ICON = { ok: CheckIcon, warn: AlertIcon, err: XIcon };

/** "just now", "12m ago", … and a short date ("May 7") once it's over a week old. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function syncedLabel(at) {
  const then = new Date(at);
  if (Date.now() - then.getTime() < WEEK_MS) return formatRelativeTime(at);
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function CheckTile({ check }) {
  const KindIcon = KIND_ICON[check.kind] || CheckIcon;
  const StateIcon = STATE_ICON[check.state];
  return (
    <li class={`dash-check dash-check--${check.state}`} title={check.value}>
      <span class="dash-check-icon"><KindIcon size={16} /></span>
      <div class="dash-check-body">
        <div class="dash-check-top">
          <span class="dash-check-label">{check.label}</span>
          <span class="dash-check-tag">
            {StateIcon && <StateIcon size={11} stroke-width="2.6" />}
            {check.tag}
          </span>
        </div>
        <span class="dash-check-primary">{check.primary ?? check.value}</span>
        {check.detail && <span class="dash-check-detail">{check.detail}</span>}
      </div>
    </li>
  );
}

function formatUptime(connectedAt) {
  if (!connectedAt) return "0m";
  const mins = Math.max(0, Math.floor((Date.now() - new Date(connectedAt).getTime()) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

/** Re-render once a minute so uptime and "synced … ago" stay current. */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
}

/**
 * Connection + readiness status for a connected workspace: who we're connected
 * to, uptime, re-sync and disconnect, and an expandable list of readiness checks.
 */
export function WorkspaceBanner() {
  useMinuteTick();
  const project = currentProject.value;
  const info = sshInfo.value;
  const connecting = sshConnecting.value;
  const syncing = dashboardSyncing.value;
  const syncedAt = lastSyncedAt.value;
  const { checks, validation, splitFiles } = project ? collectChecks(project) : { checks: [] };
  const failing = checks.filter((c) => c.state === "err");
  const warnings = checks.filter((c) => c.state === "warn");
  const [open, setOpen] = useState(false);
  const expanded = open || failing.length > 0;

  if (!project || !info) return null;

  const state = failing.length ? "err" : warnings.length ? "warn" : "ok";
  const title = failing.length
    ? "Workspace needs attention"
    : syncing
      ? "Syncing workspace…"
      : "Workspace ready";
  const passed = checks.length - failing.length;
  const extraErrors = !splitFiles ? (validation?.errors || []).slice(1) : [];
  const notes = !splitFiles ? validation?.warnings || [] : [];

  return (
    <div class={`dash-banner dash-banner--${state}`}>
      <div class="dash-banner-row">
        <span class="dash-banner-led" aria-hidden="true"><Dot state={state === "ok" ? "live" : state} /></span>
        <div class="dash-banner-text">
          <strong>{title}</strong>
          <span class="dash-banner-sub">
            <span>Connected to <code>{info.host}</code></span>
            <span class="dash-banner-sep" aria-hidden="true" />
            <span>Up {formatUptime(info.connectedAt)}</span>
            <span class="dash-banner-sep" aria-hidden="true" />
            <span title={syncedAt ? `Last synced ${new Date(syncedAt).toLocaleString()}` : undefined}>
              {syncing ? "Syncing…" : syncedAt ? `Synced ${syncedLabel(syncedAt)}` : "Not synced yet"}
            </span>
          </span>
        </div>
        <div class="dash-banner-meta">
          {checks.length > 0 && (
            <button
              class="dash-banner-checks"
              onClick={() => setOpen(!open)}
              aria-expanded={expanded}
              disabled={failing.length > 0}
            >
              <span class="dash-banner-checks-count">
                {failing.length > 0 ? <XIcon size={12} stroke-width="2.6" /> : <CheckIcon size={12} stroke-width="2.6" />}
                {passed}/{checks.length}
              </span>
              checks passed
              {failing.length === 0 && (
                <span class={`dash-chevron${expanded ? " dash-chevron--open" : ""}`}><ChevronDownIcon size={14} /></span>
              )}
            </button>
          )}
          <button
            class="dash-btn dash-btn--quiet"
            onClick={syncDashboard}
            disabled={syncing}
            title="Re-sync project data"
          >
            <span class={syncing ? "dash-spin" : undefined}><RefreshIcon size={14} /></span>
            {syncing ? "Syncing…" : "Re-sync"}
          </button>
          <button class="dash-btn dash-btn--danger" onClick={toggleSshConnection} disabled={connecting}>
            {connecting ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </div>

      {expanded && checks.length > 0 && (
        <div class="dash-checks">
          <ul>
            {checks.map((c) => <CheckTile check={c} key={c.key} />)}
          </ul>
          {(extraErrors.length > 0 || notes.length > 0) && (
            <div class="dash-notes">
              {extraErrors.map((e, i) => <div key={`e${i}`} class="dash-note dash-note--err">{e}</div>)}
              {notes.map((w, i) => <div key={`w${i}`} class="dash-note dash-note--warn">{w}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
