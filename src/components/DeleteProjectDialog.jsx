import { useEffect, useState } from "preact/hooks";
import {
  deleteDialogOpen,
  deleteTarget,
  deleteConfirmText,
  deleteConfirmed,
  closeDeleteDialog,
  confirmDeleteProject,
} from "../state/projects.js";
import { allRuns } from "../state/experiments.js";
import { ExportDialog } from "./ProjectTransfer.jsx";
import { Dialog, ConfirmPhrase } from "./Dialog.jsx";

const fileName = (p) => String(p || "").split(/[\\/]/).pop();
const PHRASE = "delete";

export function DeleteProjectDialog() {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(null); // { path, level } once a copy is saved
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const project = deleteTarget.value;
  // Each delete starts fresh: a copy saved for another project doesn't count.
  useEffect(() => {
    setExporting(false);
    setExported(null);
    setBusy(false);
    setError("");
  }, [project?.id, deleteDialogOpen.value]);

  if (!deleteDialogOpen.value || !project) return null;

  const runCount = allRuns.value.filter((r) => r.projectId === project.id).length;

  const handleDelete = async () => {
    if (!deleteConfirmed.value || busy) return;
    setBusy(true);
    setError("");
    try {
      await confirmDeleteProject();
    } catch (err) {
      setError(`Couldn't delete the project: ${err?.message || err}`);
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog
        title={`Delete “${project.name}”?`}
        sub="This can't be undone."
        icon="trash"
        tone="danger"
        role="alertdialog"
        busy={busy}
        onClose={closeDeleteDialog}
        footer={
          <>
            <button type="button" class="nfd-btn" onClick={closeDeleteDialog} disabled={busy}>
              Cancel
            </button>
            <button type="button" class="nfd-btn nfd-btn--danger" disabled={!deleteConfirmed.value || busy} onClick={handleDelete}>
              {busy ? <><span class="nfd-spinner" /> Deleting…</> : "Delete project"}
            </button>
          </>
        }
      >
        <ul class="nfd-facts">
          <li><span class="nfd-fact-dot" />Project settings<span class="nfd-fact-value">removed</span></li>
          <li><span class="nfd-fact-dot" />Runs, metrics and notes<span class="nfd-fact-value">{runCount} removed</span></li>
          <li><span class="nfd-fact-dot is-kept" />Files in the project folder<span class="nfd-fact-value">kept</span></li>
        </ul>

        {exported ? (
          <div class="delete-export delete-export--done" role="status">
            <span class="delete-export-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <span class="delete-export-text">
              <strong>Exported a copy</strong>
              <span class="delete-export-file" title={exported.path}>{fileName(exported.path)}</span>
            </span>
          </div>
        ) : (
          <div class="delete-export">
            <span class="delete-export-icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v15" /></svg>
            </span>
            <span class="delete-export-text">
              <strong>Keep a copy?</strong>
              <span>Export it first so you can import it again later.</span>
            </span>
            <button type="button" class="nfd-btn delete-export-btn" onClick={() => setExporting(true)} disabled={busy}>
              Export first…
            </button>
          </div>
        )}

        <ConfirmPhrase
          phrase={PHRASE}
          value={deleteConfirmText.value}
          onInput={(v) => (deleteConfirmText.value = v)}
          onSubmit={handleDelete}
          disabled={busy}
        />
        {error && <p class="nfd-error" role="alert">{error}</p>}
      </Dialog>

      {exporting && (
        <ExportDialog
          project={project}
          onClose={() => setExporting(false)}
          onExported={(res) => setExported(res)}
        />
      )}
    </>
  );
}
