import { useEscape } from "../hooks/useEscape.js";

export function KeyboardShortcutsModal({ open, onClose }) {
  useEscape(open, onClose);
  if (!open) return null;

  const shortcuts = [
    { keys: "Ctrl+1", action: "Dashboard" },
    { keys: "Ctrl+2", action: "Experiments" },
    { keys: "Ctrl+3", action: "Dataset Browser" },
    { keys: "Ctrl+4", action: "Interpretation" },
    { keys: "Ctrl+5", action: "Model Viewer" },
    { keys: "Ctrl+6", action: "Terminal" },
    { keys: "Ctrl+7", action: "Settings" },
    { keys: "Ctrl+Enter", action: "Start Training" },
    { keys: "Ctrl+K", action: "Show Shortcuts" },
  ];

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div class="modal-dialog shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3 class="modal-title">Keyboard Shortcuts</h3>
          <button class="modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="shortcuts-list">
            {shortcuts.map((s) => (
              <div key={s.keys} class="shortcut-item">
                <kbd class="shortcut-key">{s.keys.replace("Ctrl", navigator.platform.includes("Mac") ? "\u2318" : "Ctrl")}</kbd>
                <span class="shortcut-action">{s.action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
