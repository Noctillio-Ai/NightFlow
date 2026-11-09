import { Dialog } from "./Dialog.jsx";

const GROUPS = [
  {
    label: "Go to",
    items: [
      { keys: ["Mod", "1"], action: "Dashboard" },
      { keys: ["Mod", "2"], action: "Experiments" },
      { keys: ["Mod", "3"], action: "Dataset Browser" },
      { keys: ["Mod", "4"], action: "Interpretation" },
      { keys: ["Mod", "5"], action: "Model Viewer" },
      { keys: ["Mod", "6"], action: "Terminal" },
      { keys: ["Mod", "7"], action: "Settings" },
    ],
  },
  {
    label: "Actions",
    items: [
      { keys: ["Mod", "Enter"], action: "Start training" },
      { keys: ["Mod", "K"], action: "Show shortcuts" },
    ],
  },
];

export function KeyboardShortcutsModal({ open, onClose }) {
  if (!open) return null;
  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);
  const label = (k) => (k === "Mod" ? (isMac ? "⌘" : "Ctrl") : k === "Enter" ? "↵" : k);

  return (
    <Dialog title="Keyboard shortcuts" sub="Work faster without the mouse." icon="keyboard" size="lg" onClose={onClose}>
      {GROUPS.map((g) => (
        <section key={g.label} class="nfd-shortcut-group">
          <div class="nfd-subhead">{g.label}</div>
          <div class="nfd-shortcuts">
            {g.items.map((s) => (
              <div key={s.action} class="nfd-shortcut">
                <span>{s.action}</span>
                <span class="nfd-keys" aria-label={s.keys.map(label).join(" + ")}>
                  {s.keys.map((k) => <kbd key={k}>{label(k)}</kbd>)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </Dialog>
  );
}
