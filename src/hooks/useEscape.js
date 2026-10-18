import { useEffect } from "preact/hooks";

/** Call `onClose` when Escape is pressed while `active` is true. */
export function useEscape(active, onClose) {
  useEffect(() => {
    if (!active) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
