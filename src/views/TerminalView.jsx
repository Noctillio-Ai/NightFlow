import { useEffect } from "preact/hooks";
import { useTerminal } from "../hooks/useTerminal.js";
import { currentProject } from "../state/projects.js";
import {
  sshConnected,
  sshConnecting,
  toggleSshConnection,
  platform,
} from "../state/dashboard.js";
import { MAX_TERMINAL_TABS, tabNumber } from "../state/terminalTabs.js";

const svg = (body, size = 14, sw = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const stopIcon = svg('<rect x="6" y="6" width="12" height="12" rx="2"/>');
const restartIcon = svg('<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>');
const clearIcon = svg('<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="m18 9-6 6M12 9l6 6"/>');
const promptIcon = svg('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>', 14, 2.2);
const plusIcon = svg('<path d="M12 5v14M5 12h14"/>', 15, 2);
const closeIcon = svg('<path d="M18 6 6 18M6 6l12 12"/>', 12, 2.2);
const checkIcon = svg('<path d="M20 6 9 17l-5-5"/>', 22, 2.5);
const serverIcon = svg('<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>', 22, 2);
const failIcon = svg('<path d="M18 6 6 18M6 6l12 12"/>', 22, 2.5);

const Svg = ({ html }) => <span class="term-svg" dangerouslySetInnerHTML={{ __html: html }} />;

export function TerminalView() {
  const project = currentProject.value;
  const rawSsh = project?.sshCommand;
  const projectSshCommand =
    rawSsh && rawSsh.trim() && rawSsh.trim().toLowerCase() !== "localhost"
      ? rawSsh.trim()
      : null;
  const hasProject = !!project;
  const isSSH = !!projectSshCommand;
  const projectId = project?.id ?? null;

  const enabled = !isSSH || sshConnected.value || sshConnecting.value;
  const showTerminal = !isSSH || sshConnected.value;

  const {
    containerRef,
    dims,
    alive,
    info,
    sshStatus,
    sshMessage,
    clear,
    kill,
    restart,
    focus,
    tabs,
    activeTab,
    tabMeta,
    addTab,
    selectTab,
    closeTab,
  } = useTerminal({
    projectId,
    sshCommand: projectSshCommand,
    isProject: hasProject,
    projectPath: project?.projectPath ?? null,
    enabled,
  });

  const isMac = platform.value === "macos";
  const canAddTab = tabs.length < MAX_TERMINAL_TABS;
  const newTabHint = isMac ? "⌘T" : "Ctrl+Shift+T";

  // New tab: Cmd+T on macOS, Ctrl+Shift+T elsewhere (plain Ctrl+T is the
  // shell's transpose-chars). Capture phase, so xterm doesn't swallow it.
  useEffect(() => {
    if (!showTerminal) return;
    function onKey(e) {
      const combo = isMac
        ? e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
        : e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;
      if (combo && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        e.stopPropagation();
        addTab();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [showTerminal, isMac, projectId]);

  // The active tab's own SSH handshake (its overlay covers only the terminal
  // area, so the other tabs stay reachable).
  const showOverlay = isSSH && sshStatus !== "idle";
  const isConnecting = sshStatus === "connecting";
  const isConnected = sshStatus === "connected";
  const isFailed = sshStatus === "failed";
  // Remote project with no live session yet: nothing for xterm to show.
  const showIdle = isSSH && !showTerminal;
  const waiting = sshConnecting.value;

  // Numbers stay with their tab, so closing one doesn't rename the others.
  const tabLabel = (id) => {
    const shell = tabMeta[id]?.shell || (isSSH ? "ssh" : "shell");
    const n = tabNumber(id);
    return n === 1 ? shell : `${shell} ${n}`;
  };
  // Any tab can close while another is open; the last one stays.
  const canClose = tabs.length > 1;

  return (
    <div class="terminal-view">
      {showIdle && (
        <div class="terminal-connection-overlay">
          <div
            class={`terminal-connection-status ${waiting ? "is-connecting" : "is-idle"}`}
            role="status"
          >
            <div class="terminal-connection-icon">
              {waiting ? (
                <div class="terminal-connection-spinner" />
              ) : (
                <Svg html={serverIcon} />
              )}
            </div>
            <div class="terminal-connection-copy">
              <span class="terminal-connection-eyebrow">
                {waiting ? "Connecting" : "Not connected"}
              </span>
              <span class="terminal-connection-target">{projectSshCommand}</span>
            </div>
            <div class="terminal-connection-text">
              {waiting
                ? "Opening an SSH session to your remote instance…"
                : "Connect to your remote instance to open a shell on it."}
            </div>
            {waiting ? (
              <div class="terminal-connection-progress">
                <div class="terminal-connection-progress-bar" />
              </div>
            ) : (
              <button
                class="dash-btn dash-btn--primary terminal-connect-btn"
                onClick={toggleSshConnection}
              >
                Connect
              </button>
            )}
          </div>
        </div>
      )}

      {showTerminal && (
        <>
          <div class="terminal-toolbar">
            <div class="terminal-tabs" role="tablist" aria-label="Terminal sessions">
              {tabs.map((t, i) => {
                const active = t.id === activeTab;
                // The active tab reads live state; others use their last known.
                const tabAlive = active ? alive : tabMeta[t.id]?.alive !== false;
                const closable = canClose;
                return (
                  <div
                    key={t.id}
                    class={`terminal-tab${active ? " is-active" : ""}${tabAlive ? "" : " is-dead"}${closable ? " is-closable" : ""}`}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    aria-selected={active ? "true" : "false"}
                    title={`${tabLabel(t.id)} · ${tabAlive ? "Running" : "Exited"}`}
                    onClick={() => selectTab(t.id)}
                    onMouseDown={(e) => {
                      // Middle-click closes, as in browsers and editors.
                      if (e.button === 1 && closable) {
                        e.preventDefault();
                        closeTab(t.id);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
                        selectTab(next.id);
                      }
                    }}
                  >
                    <span class="terminal-tab-icon">
                      <Svg html={promptIcon} />
                    </span>
                    <span class="terminal-toolbar-shell">{tabLabel(t.id)}</span>
                    <span class={`terminal-toolbar-status ${tabAlive ? "alive" : "dead"}`}>
                      <span class="terminal-status-text">{tabAlive ? "Running" : "Exited"}</span>
                    </span>
                    {closable && (
                      <button
                        class="terminal-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                        title={
                          t.id === projectId
                            ? "Close tab (the project stays connected)"
                            : "Close tab"
                        }
                        aria-label={`Close ${tabLabel(t.id)}`}
                      >
                        <Svg html={closeIcon} />
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                class="terminal-tab-add"
                onClick={addTab}
                disabled={!canAddTab}
                title={canAddTab ? `New tab (${newTabHint})` : `Up to ${MAX_TERMINAL_TABS} tabs`}
                aria-label="New terminal tab"
              >
                <Svg html={plusIcon} />
              </button>
            </div>
            <div class="terminal-toolbar-right">
              {info && (
                <span class="terminal-toolbar-userhost">
                  {info.isSSH ? info.sshTarget : info.user && info.hostname ? `${info.user}@${info.hostname}` : ""}
                </span>
              )}
              <span class="terminal-toolbar-dims" title="Columns × rows">
                {dims.cols} × {dims.rows}
              </span>
              <div class="terminal-toolbar-actions">
                <button
                  class="terminal-toolbar-btn"
                  onClick={clear}
                  title="Clear scrollback"
                  aria-label="Clear scrollback"
                >
                  <Svg html={clearIcon} />
                </button>
                {alive ? (
                  <button
                    class="terminal-toolbar-btn terminal-toolbar-btn-kill"
                    onClick={kill}
                    title="Stop this shell"
                    aria-label="Stop this shell"
                  >
                    <Svg html={stopIcon} />
                  </button>
                ) : (
                  <button
                    class="terminal-toolbar-btn terminal-toolbar-btn-restart"
                    onClick={restart}
                    title="Restart this shell"
                    aria-label="Restart this shell"
                  >
                    <Svg html={restartIcon} />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div class="terminal-stage">
            <div
              class="terminal-xterm-container"
              ref={containerRef}
              onClick={focus}
            />
            {showOverlay && (
              <div class="terminal-connection-overlay">
                <div class={`terminal-connection-status is-${sshStatus}`} role="status">
                  <div class="terminal-connection-icon">
                    {isConnecting && <div class="terminal-connection-spinner" />}
                    {isConnected && <Svg html={checkIcon} />}
                    {isFailed && <Svg html={failIcon} />}
                  </div>
                  <div class="terminal-connection-copy">
                    <span class="terminal-connection-eyebrow">
                      {isConnecting ? "Connecting" : isConnected ? "Connected" : "Connection failed"}
                    </span>
                    <span class="terminal-connection-target">{projectSshCommand}</span>
                  </div>
                  <div class="terminal-connection-text">{sshMessage}</div>
                  <div class="terminal-connection-progress">
                    <div class="terminal-connection-progress-bar" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
