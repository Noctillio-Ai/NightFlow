import { useEffect, useRef } from "preact/hooks";
import { createPortal } from "preact/compat";
import { alertQueue, closeAlert } from "../state/dialogs.js";

// Shared dialog shell: icon tile + title in a tone-tinted header, scrollable
// body, footer for actions. Rendered into <body> so transformed/animated
// ancestors can't clip it. Escape and a click on the backdrop close it
// (unless `busy`); focus moves inside, stays there on Tab, and returns to
// whatever had it before when the dialog closes.
//
// tone: "neutral" | "info" | "danger" | "warning" | "success"
// size: "sm" (400) | "md" (480) | "lg" (600)

const ICONS = {
  trash: <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  error: <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>,
  plugOff: <><path d="m19 5 3-3M2 22l3-3" /><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" /><path d="M7.5 13.5 10 11M10.5 16.5 13 14" /><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5" /><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
};

export function DialogIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** Overlays of every in-app dialog family, in the order they were opened. */
const OVERLAYS = ".nfd-overlay, .ssk-overlay, .wizard-overlay, .modal-overlay";

/**
 * True when `node` sits in the topmost open dialog. Dialogs are portalled to
 * <body> as they open, so the last overlay in the document is on top. Used so
 * Escape and Tab only act on the dialog in front.
 */
export function isTopDialog(node) {
  if (!node) return false;
  const all = document.querySelectorAll(OVERLAYS);
  const top = all[all.length - 1];
  return !!top && top.contains(node);
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let titleSeq = 0;

export function Dialog({
  title,
  sub,
  icon = "info",
  tone = "neutral",
  size = "md",
  role = "dialog",
  busy = false,
  dismissible = true,
  onClose,
  footer,
  children,
  class: extraClass = "",
}) {
  const ref = useRef(null);
  const idRef = useRef(`nfd-title-${++titleSeq}`);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const canClose = dismissible && !busy;
  const canCloseRef = useRef(canClose);
  canCloseRef.current = canClose;

  // Focus in on open, back out on close.
  useEffect(() => {
    const previous = document.activeElement;
    const node = ref.current;
    const target = node?.querySelector("[data-autofocus]") || node?.querySelector(".nfd-body " + FOCUSABLE) || node?.querySelector(".nfd-foot .nfd-btn:last-child");
    target?.focus();
    return () => {
      if (previous && typeof previous.focus === "function" && document.contains(previous)) previous.focus();
    };
  }, []);

  // Escape closes this dialog only; Tab stays inside it.
  useEffect(() => {
    function onKey(e) {
      if (!isTopDialog(ref.current)) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (canCloseRef.current) closeRef.current?.();
      } else if (e.key === "Tab" && ref.current) {
        const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  return createPortal(
    <div class="nfd-overlay" onMouseDown={(e) => e.target === e.currentTarget && canClose && onClose?.()}>
      <div
        ref={ref}
        class={`nfd nfd--${tone} nfd--${size}${extraClass ? ` ${extraClass}` : ""}`}
        role={role}
        aria-modal="true"
        aria-labelledby={idRef.current}
      >
        <header class="nfd-head">
          <span class="nfd-icon"><DialogIcon name={icon} size={20} /></span>
          <div class="nfd-head-text">
            <h2 id={idRef.current}>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          {dismissible && (
            <button type="button" class="nfd-close" onClick={onClose} disabled={busy} aria-label="Close">
              <DialogIcon name="x" size={16} />
            </button>
          )}
        </header>
        <div class="nfd-body">{children}</div>
        {footer && <footer class="nfd-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Type <phrase> to confirm" field for destructive actions. Shows a check
 * once the phrase matches; Enter runs `onSubmit` when it does.
 */
export function ConfirmPhrase({ phrase, value, onInput, onSubmit, disabled }) {
  const ok = value.trim().toLowerCase() === phrase.toLowerCase();
  return (
    <label class={`nfd-confirm${ok ? " is-ok" : ""}`}>
      <span class="nfd-confirm-label">
        Type <code>{phrase}</code> to confirm
      </span>
      <span class="nfd-confirm-input">
        <input
          type="text"
          value={value}
          placeholder={phrase}
          spellcheck={false}
          autoComplete="off"
          disabled={disabled}
          data-autofocus
          onInput={(e) => onInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ok && onSubmit?.()}
        />
        <span class="nfd-confirm-check" aria-hidden="true"><DialogIcon name="check" size={14} /></span>
      </span>
    </label>
  );
}

export const phraseMatches = (value, phrase) => value.trim().toLowerCase() === phrase.toLowerCase();

/** Renders queued alerts (state/dialogs.js showAlert) one at a time. */
export function DialogHost() {
  const current = alertQueue.value[0];
  if (!current) return null;
  return (
    <Dialog
      key={current.id}
      title={current.title}
      icon={current.icon || (current.tone === "danger" ? "error" : current.tone === "warning" ? "alert" : "info")}
      tone={current.tone || "info"}
      size="sm"
      role="alertdialog"
      onClose={() => closeAlert(current.id)}
      footer={
        <button type="button" class="nfd-btn nfd-btn--primary" onClick={() => closeAlert(current.id)}>
          OK
        </button>
      }
    >
      {current.message && <p class="nfd-text">{current.message}</p>}
      {current.detail && <pre class="nfd-detail">{current.detail}</pre>}
    </Dialog>
  );
}
