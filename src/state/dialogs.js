import { signal } from "@preact/signals";

// In-app alerts, replacing window.alert(). Rendered by <DialogHost /> in
// app.jsx, one at a time in the order they were raised.

let _id = 0;
const _resolvers = new Map();

/** [{ id, title, message, detail?, tone?, icon? }] */
export const alertQueue = signal([]);

/**
 * Shows an alert dialog. tone: "info" | "warning" | "danger" | "success".
 * Resolves when the user dismisses it.
 */
export function showAlert({ title, message = "", detail = "", tone = "info", icon } = {}) {
  const id = ++_id;
  alertQueue.value = [...alertQueue.value, { id, title: title || "Notice", message, detail, tone, icon }];
  return new Promise((resolve) => _resolvers.set(id, resolve));
}

/** Shows a failed action: a short sentence plus the raw error underneath. */
export function showError(title, error, message = "") {
  const detail = typeof error === "string" ? error : error?.message || String(error ?? "");
  return showAlert({ title, message, detail, tone: "danger" });
}

export function closeAlert(id) {
  alertQueue.value = alertQueue.value.filter((a) => a.id !== id);
  _resolvers.get(id)?.();
  _resolvers.delete(id);
}
