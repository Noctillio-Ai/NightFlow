import { useRef, useEffect, useState } from "preact/hooks";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { theme } from "../state/theme.js";
import {
  setSshConnected,
  setSshConnecting,
  terminalKey,
} from "../state/dashboard.js";
import {
  getTerminalTabs,
  addTerminalTab,
  selectTerminalTab,
  removeTerminalTab,
  setTerminalTabMeta,
  terminalTabMeta,
  isPrimaryTab,
} from "../state/terminalTabs.js";

// ── Themes ────────────────────────────────────────────────────────────────────

// Built from the app's tokens: neutral greys from style.css, the Terminal
// page accent (teal, utils/pageTones.js) for the cursor and selection, and the
// other page accents for ANSI colours so `ls`, git and test output read in the
// same palette as the rest of the UI. `background` is only a fallback: the
// live value comes from --term-bg (see getTermTheme).

const darkTheme = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  cursor: "#2dd4bf",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#2dd4bf38",
  selectionInactiveBackground: "#2dd4bf1f",
  selectionForeground: "#ffffff",
  scrollbarSliderBackground: "#7373734d",
  scrollbarSliderHoverBackground: "#73737380",
  scrollbarSliderActiveBackground: "#737373a6",
  black: "#262626",
  red: "#f87171",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#818cf8",
  magenta: "#f472b6",
  cyan: "#2dd4bf",
  white: "#d4d4d4",
  brightBlack: "#737373",
  brightRed: "#fca5a5",
  brightGreen: "#6ee7b7",
  brightYellow: "#fcd34d",
  brightBlue: "#a5b4fc",
  brightMagenta: "#f9a8d4",
  brightCyan: "#5eead4",
  brightWhite: "#fafafa",
};

const lightTheme = {
  background: "#f2f2f2",
  foreground: "#1f1f1f",
  cursor: "#0d9488",
  cursorAccent: "#f2f2f2",
  selectionBackground: "#0d948830",
  selectionInactiveBackground: "#0d94881c",
  selectionForeground: "#000000",
  scrollbarSliderBackground: "#6b6b6b40",
  scrollbarSliderHoverBackground: "#6b6b6b70",
  scrollbarSliderActiveBackground: "#6b6b6b99",
  black: "#1f1f1f",
  red: "#dc2626",
  green: "#059669",
  yellow: "#b45309",
  blue: "#4f46e5",
  magenta: "#db2777",
  cyan: "#0d9488",
  white: "#a3a3a3",
  brightBlack: "#6b6b6b",
  brightRed: "#ef4444",
  brightGreen: "#10b981",
  brightYellow: "#d97706",
  brightBlue: "#6366f1",
  brightMagenta: "#ec4899",
  brightCyan: "#14b8a6",
  brightWhite: "#3b3b3b",
};

// The terminal is drawn straight onto the page, so its canvas takes the page
// background from --term-bg (style.css) rather than a colour of its own.
const getTermTheme = () => {
  const base = theme.value === "dark" ? darkTheme : lightTheme;
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--term-bg")
    .trim();
  return bg ? { ...base, background: bg, cursorAccent: bg } : base;
};

// Prompt themes are usually tuned for dark backgrounds. On the light page,
// lift any colour that would be too faint to read; dark mode is left as-is.
const getContrastRatio = () => (theme.value === "dark" ? 1 : 3);

// ── Per-session terminal registry (persists across navigation) ────────────────
//
// _sessions: Map<sessionId, session>. A project's primary tab uses the project
// id as its session id; extra tabs use `<projectId>::<n>` (state/terminalTabs).
//   session = { term, fit, info, alive, sshCommand, isProject, projectPath,
//               owns (true for the primary tab: it drives the project's
//               SSH connected/connecting state),
//               onData, onResize, unlistenOutput, unlistenExit,
//               onAliveChange, onDimsChange, onStatusChange,
//               _termKey,
//               _sshStatus, _sshMessage, _sshTimeout }

const _sessions = new Map();
const _pending = new Map(); // sessionId -> Promise<session> while starting

// Detach all terminal elements from container except the one we're about to show.
// Uses removeChild (not innerHTML="") so the detached elements stay valid for re-attachment.
function _detachOtherSessions(container, keepElement) {
  Array.from(container.children).forEach((child) => {
    if (child !== keepElement) container.removeChild(child);
  });
}

function _destroySession(sessionId) {
  const s = _sessions.get(sessionId);
  if (!s) return;
  s.onData?.dispose();
  s.onResize?.dispose();
  s.unlistenOutput?.();
  s.unlistenExit?.();
  s.term.dispose();
  if (s._sshTimeout) clearTimeout(s._sshTimeout);
  _sessions.delete(sessionId);
}

function _setSessionStatus(s, status, message) {
  s._sshStatus = status;
  s._sshMessage = message;
  s.onStatusChange?.({ status, message });
}

function _handleSshOutput(s, sessionId, projectId, out) {
  const low = out.toLowerCase();
  if (s._sshStatus !== "connecting") return;

  const success =
    low.includes("welcome") ||
    low.includes("last login") ||
    /[$#]\s*$/.test(low);

  if (success) {
    if (s._sshTimeout) {
      clearTimeout(s._sshTimeout);
      s._sshTimeout = null;
    }
    _setSessionStatus(s, "connected", "SSH connection established");
    if (s.owns) {
      setSshConnected(true, projectId);
      setSshConnecting(false, projectId);
    }
    if (s.projectPath) {
      setTimeout(() => {
        invoke("pty_write", {
          sessionId,
          data: `cd ${s.projectPath}\r`,
        });
      }, 300);
    }
    setTimeout(() => {
      if (s._sshStatus === "connected") _setSessionStatus(s, "idle", "");
    }, 3000);
    return;
  }

  const failure =
    low.includes("connection refused") ||
    low.includes("connection timed out") ||
    low.includes("connection closed") ||
    low.includes("connection reset") ||
    low.includes("permission denied") ||
    low.includes("authentication failed") ||
    low.includes("publickey") ||
    low.includes("no such identity") ||
    low.includes("identity file") ||
    low.includes("key_load_public") ||
    low.includes("host key verification failed") ||
    low.includes("no route to host") ||
    low.includes("network is unreachable") ||
    low.includes("could not resolve hostname") ||
    low.includes("operation timed out") ||
    low.includes("broken pipe");

  if (failure) {
    if (s._sshTimeout) {
      clearTimeout(s._sshTimeout);
      s._sshTimeout = null;
    }
    _setSessionStatus(s, "failed", "SSH connection failed");
    if (s.owns) {
      setSshConnected(false, projectId);
      setSshConnecting(false, projectId);
    }
    setTimeout(() => {
      if (s._sshStatus === "failed") _setSessionStatus(s, "idle", "");
    }, 5000);
  }
}

async function _initSession(
  container,
  sessionId,
  projectId,
  sshCommand,
  isProject,
  projectPath,
) {
  const term = new Terminal({
    fontSize: 13,
    fontFamily:
      '"Hack Nerd Font Mono", "SF Mono", "Fira Code", "Cascadia Code", "Menlo", "Consolas", monospace',
    lineHeight: 1.2,
    fontWeightBold: "600",
    cursorBlink: false,
    cursorStyle: "block",
    cursorInactiveStyle: "outline",
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    theme: getTermTheme(),
    minimumContrastRatio: getContrastRatio(),
  });

  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(container);
  try {
    term.loadAddon(new WebglAddon());
  } catch (_) {
    /* ignore WebGL errors */
  }
  fit.fit();

  const s = {
    term,
    fit,
    info: null,
    alive: true,
    sshCommand,
    isProject,
    projectPath,
    owns: isProject && isPrimaryTab(projectId, sessionId),
    onData: null,
    onResize: null,
    unlistenOutput: null,
    unlistenExit: null,
    onAliveChange: null,
    onDimsChange: null,
    onStatusChange: null,
    _termKey: terminalKey.value,
    _sshStatus: "idle",
    _sshMessage: "",
    _sshTimeout: null,
  };

  // Listen only to output events for this session
  s.unlistenOutput = await listen("pty-output", (event) => {
    const { session_id, data } = event.payload;
    if (session_id !== sessionId) return;
    term.write(data);
    if (sshCommand && isProject) _handleSshOutput(s, sessionId, projectId, data);
  });

  s.unlistenExit = await listen("pty-exit", (event) => {
    const { session_id } = event.payload;
    if (session_id !== sessionId) return;
    s.alive = false;
    // A tab closed on purpose isn't a lost connection.
    if (s.closing) return;
    if (s.owns) setSshConnected(false, projectId);
    setTerminalTabMeta(sessionId, { alive: false });
    s.onAliveChange?.(false);
    term.writeln(
      "\r\n\x1b[2m[Process exited — press Restart to relaunch]\x1b[0m",
    );
  });

  try {
    const ptyAlive = await invoke("is_terminal_alive", {
      sessionId,
    }).catch(() => false);

    if (!ptyAlive) {
      // Spawn a fresh PTY for this project
      if (sshCommand && isProject) {
        _setSessionStatus(s, "connecting", `Connecting to ${sshCommand}...`);
        s._sshTimeout = setTimeout(() => {
          if (s._sshStatus === "connecting") {
            _setSessionStatus(s, "failed", "SSH connection timed out");
            if (s.owns) {
              setSshConnected(false, projectId);
              setSshConnecting(false, projectId);
            }
            term.writeln(
              "\r\n\x1b[31m[SSH connection timed out after 30 seconds]\x1b[0m",
            );
            setTimeout(() => {
              if (s._sshStatus === "failed") _setSessionStatus(s, "idle", "");
            }, 5000);
          }
        }, 30000);
      }
      const args = { sessionId, rows: term.rows, cols: term.cols };
      if (sshCommand) args.sshCommand = sshCommand;
      if (!sshCommand && projectPath) args.cwd = projectPath;
      await invoke("spawn_terminal", args);
      if (s.owns && !sshCommand) setSshConnected(true, projectId);
      if (s.owns && !sshCommand) setSshConnecting(false, projectId);
    } else if (sshCommand) {
      // PTY already running (spawned by dashboard connect) — send \r for a fresh prompt
      setTimeout(
        () => invoke("pty_write", { sessionId, data: "\r" }),
        150,
      );
    }
  } catch (err) {
    term.writeln(`\r\n\x1b[31mFailed to spawn terminal: ${err}\x1b[0m`);
    if (sshCommand && isProject) {
      if (s._sshTimeout) {
        clearTimeout(s._sshTimeout);
        s._sshTimeout = null;
      }
      _setSessionStatus(s, "failed", "Failed to spawn terminal");
      if (s.owns) setSshConnected(false, projectId);
    }
    if (s.owns) setSshConnecting(false, projectId);
  }

  s.info = await invoke("get_terminal_info", { sessionId }).catch(() => null);
  setTerminalTabMeta(sessionId, {
    alive: s.alive,
    shell: s.info?.isSSH ? "ssh" : s.info?.shell,
  });
  s.onData = term.onData((data) => invoke("pty_write", { sessionId, data }));
  s.onResize = term.onResize(({ cols, rows }) => {
    s.onDimsChange?.({ cols, rows });
    invoke("pty_resize", { sessionId, rows, cols });
  });

  return s;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTerminal({
  projectId = null,
  sshCommand = null,
  isProject = false,
  projectPath = null,
  enabled = true,
} = {}) {
  const containerRef = useRef(null);
  const [dims, setDims] = useState({ cols: 0, rows: 0 });
  const [alive, setAlive] = useState(true);
  const [info, setInfo] = useState(null);
  const [sshStatus, setSshStatus] = useState("idle");
  const [sshMessage, setSshMessageState] = useState("");

  // Reading the signal here re-renders the view when tabs change.
  const tabState = projectId ? getTerminalTabs(projectId) : null;
  const sessionId = tabState?.active ?? null;

  // Point the view's state at a session and keep it in sync.
  function bind(s) {
    s.onAliveChange = (v) => setAlive(v);
    s.onDimsChange = (d) => setDims(d);
    s.onStatusChange = ({ status, message }) => {
      setSshStatus(status);
      setSshMessageState(message);
    };
    setInfo(s.info);
    setAlive(s.alive);
    setDims({ cols: s.term.cols, rows: s.term.rows });
    setSshStatus(s._sshStatus);
    setSshMessageState(s._sshMessage);
    s.term.focus();
  }

  // Sync theme changes to all live terminals
  useEffect(() => {
    for (const s of _sessions.values()) {
      s.term.options.theme = getTermTheme();
      s.term.options.minimumContrastRatio = getContrastRatio();
    }
  }, [theme.value]);

  // Dispose xterm instances whose tab was closed elsewhere (e.g. on disconnect).
  useEffect(() => {
    if (!projectId) return;
    const open = new Set(tabState.tabs.map((t) => t.id));
    for (const id of [..._sessions.keys()]) {
      const ours = id === projectId || id.startsWith(`${projectId}::`);
      if (ours && !open.has(id)) _destroySession(id);
    }
  }, [projectId, tabState]);

  // Terminal lifecycle: show (or create) the active tab's session.
  useEffect(() => {
    if (!enabled || !sessionId) return;
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    (async () => {
      const existing = _sessions.get(sessionId);

      // Reinit the primary session if the terminal key changed (forced reconnect)
      if (
        existing &&
        isPrimaryTab(projectId, sessionId) &&
        existing._termKey !== terminalKey.value
      ) {
        await invoke("kill_terminal", { sessionId });
        _destroySession(sessionId);
        _detachOtherSessions(container, null);
      }

      let s = _sessions.get(sessionId);
      if (!s) {
        // One start per session, even if the tab is left and re-entered
        // while its shell is still coming up.
        let pending = _pending.get(sessionId);
        if (!pending) {
          _detachOtherSessions(container, null);
          pending = _initSession(
            container,
            sessionId,
            projectId,
            sshCommand,
            isProject,
            projectPath,
          ).then((ns) => {
            _pending.delete(sessionId);
            _sessions.set(sessionId, ns);
            ns._termKey = terminalKey.value;
            // Tab closed while starting: tear it straight down.
            if (!getTerminalTabs(projectId).tabs.some((t) => t.id === sessionId)) {
              ns.closing = true;
              ns.owns = false;
              _destroySession(sessionId);
              invoke("kill_terminal", { sessionId }).catch(() => {});
              return null;
            }
            return ns;
          }).catch((err) => {
            _pending.delete(sessionId);
            throw err;
          });
          _pending.set(sessionId, pending);
        }
        s = await pending;
      }
      if (cancelled || !s) return;

      // Swap in this tab's terminal, detaching any other session's element
      _detachOtherSessions(container, s.term.element);
      if (s.term.element?.parentElement !== container) {
        container.appendChild(s.term.element);
      }
      s.fit.fit();
      bind(s);
    })();

    const obs = new ResizeObserver(() => {
      const s = _sessions.get(sessionId);
      if (s?.fit) s.fit.fit();
    });
    obs.observe(container);

    return () => {
      cancelled = true;
      obs.disconnect();
      const s = _sessions.get(sessionId);
      if (s) {
        s.onAliveChange = null;
        s.onDimsChange = null;
        s.onStatusChange = null;
      }
    };
  }, [sessionId, sshCommand, enabled, terminalKey.value]);

  async function clear() {
    const s = _sessions.get(sessionId);
    s?.term?.clear();
    s?.term?.focus();
  }

  async function kill() {
    const s = _sessions.get(sessionId);
    const owns = isProject && isPrimaryTab(projectId, sessionId);
    if (s?._sshTimeout) {
      clearTimeout(s._sshTimeout);
      s._sshTimeout = null;
    }
    await invoke("kill_terminal", { sessionId });
    if (s) {
      if (owns) setSshConnected(false, projectId);
      s.alive = false;
      s.term.writeln("\r\n\x1b[2m[Terminal killed]\x1b[0m");
      _destroySession(sessionId);
    }
    setTerminalTabMeta(sessionId, { alive: false });
    setAlive(false);
    setSshStatus("idle");
    setSshMessageState("");
    if (owns) setSshConnecting(false, projectId);
  }

  async function restart() {
    const s = _sessions.get(sessionId);
    if (s?._sshTimeout) {
      clearTimeout(s._sshTimeout);
      s._sshTimeout = null;
    }
    setSshStatus("idle");
    setSshMessageState("");
    if (isProject && isPrimaryTab(projectId, sessionId)) {
      setSshConnecting(false, projectId);
    }
    await invoke("kill_terminal", { sessionId });
    _destroySession(sessionId);
    const container = containerRef.current;
    if (!container) return;
    _detachOtherSessions(container, null);
    const newS = await _initSession(
      container,
      sessionId,
      projectId,
      sshCommand,
      isProject,
      projectPath,
    );
    _sessions.set(sessionId, newS);
    newS._termKey = terminalKey.value;
    bind(newS);
  }

  function focus() {
    _sessions.get(sessionId)?.term?.focus();
  }

  function addTab() {
    if (projectId) addTerminalTab(projectId);
  }

  function selectTab(id) {
    if (projectId) selectTerminalTab(projectId, id);
  }

  /**
   * Closes a tab and its shell; allowed while another tab is open. Closing the
   * primary tab keeps the project connected: its session (and with it the
   * exit listener that would mark the project disconnected) is torn down
   * before the PTY is killed.
   */
  async function closeTab(id) {
    if (!projectId || (tabState?.tabs.length ?? 0) <= 1) return;
    const s = _sessions.get(id);
    if (s) {
      s.closing = true;
      s.owns = false;
      if (s._sshTimeout) clearTimeout(s._sshTimeout);
    }
    removeTerminalTab(projectId, id);
    _destroySession(id);
    await invoke("kill_terminal", { sessionId: id }).catch(() => {});
  }

  return {
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
    tabs: tabState?.tabs ?? [],
    activeTab: sessionId,
    tabMeta: terminalTabMeta.value,
    addTab,
    selectTab,
    closeTab,
  };
}
