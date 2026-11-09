import { signal } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";

// ── Terminal tabs ────────────────────────────────────────────────────────────
//
// Each project has one primary tab whose PTY session id is the project id.
// That session is the project's connection: the dashboard's Connect spawns it
// and SSH connected/connecting state follows it. Extra tabs get their own
// session ids (`<projectId>::<n>`), open their own shell (or their own ssh
// process for remote projects) and never touch the project's connection state.
//
// The primary tab can be closed while other tabs are open. Its shell goes away
// but the project stays connected (useTerminal drops the session's exit
// listener before killing it). Disconnecting or reconnecting the project
// resets the strip to a fresh primary tab.
//
// The registry lives outside the view so tabs survive navigating away.

export const MAX_TERMINAL_TABS = 8;

/** { [projectId]: { tabs: [{ id }], active: sessionId, next: number } } */
export const terminalTabs = signal({});

/** { [sessionId]: { alive?: boolean, shell?: string } } for tab labels/dots. */
export const terminalTabMeta = signal({});

export const isPrimaryTab = (projectId, sessionId) => sessionId === projectId;

export function getTerminalTabs(projectId) {
  return (
    terminalTabs.value[projectId] || {
      tabs: [{ id: projectId }],
      active: projectId,
      next: 2,
    }
  );
}

function _put(projectId, state) {
  terminalTabs.value = { ...terminalTabs.value, [projectId]: state };
}

/** Opens a new tab and makes it active. Returns its session id, or null at the cap. */
export function addTerminalTab(projectId) {
  const st = getTerminalTabs(projectId);
  if (st.tabs.length >= MAX_TERMINAL_TABS) return null;
  const id = `${projectId}::${st.next}`;
  _put(projectId, { tabs: [...st.tabs, { id }], active: id, next: st.next + 1 });
  return id;
}

export function selectTerminalTab(projectId, sessionId) {
  const st = getTerminalTabs(projectId);
  if (st.active === sessionId || !st.tabs.some((t) => t.id === sessionId)) return;
  _put(projectId, { ...st, active: sessionId });
}

/** Tab number shown in its label: 1 for the primary tab, n for `<id>::n`. */
export const tabNumber = (sessionId) => Number(String(sessionId).split("::")[1] || 1);

/** Removes a tab from the strip. The last remaining tab can't be removed. */
export function removeTerminalTab(projectId, sessionId) {
  const st = getTerminalTabs(projectId);
  const i = st.tabs.findIndex((t) => t.id === sessionId);
  if (i < 0 || st.tabs.length <= 1) return;
  const tabs = st.tabs.filter((t) => t.id !== sessionId);
  const active =
    st.active === sessionId ? (tabs[i] || tabs[i - 1]).id : st.active;
  _put(projectId, { ...st, tabs, active });
  const { [sessionId]: _gone, ...rest } = terminalTabMeta.value;
  terminalTabMeta.value = rest;
}

export function setTerminalTabMeta(sessionId, patch) {
  terminalTabMeta.value = {
    ...terminalTabMeta.value,
    [sessionId]: { ...terminalTabMeta.value[sessionId], ...patch },
  };
}

/**
 * Closes every extra tab of a project, kills their PTYs and brings back a
 * fresh primary tab (e.g. when the project disconnects or reconnects).
 * useTerminal disposes the matching xterm instances.
 */
export async function closeExtraTerminalTabs(projectId) {
  const st = terminalTabs.value[projectId];
  if (!st) return;
  const extra = st.tabs.filter((t) => !isPrimaryTab(projectId, t.id));
  _put(projectId, { tabs: [{ id: projectId }], active: projectId, next: st.next });
  const meta = { ...terminalTabMeta.value };
  for (const t of extra) delete meta[t.id];
  terminalTabMeta.value = meta;
  if (!extra.length) return;
  await Promise.all(
    extra.map((t) =>
      invoke("kill_terminal", { sessionId: t.id }).catch(() => {}),
    ),
  );
}
