import {
  deleteDialogOpen,
  deleteTarget,
  deleteConfirmText,
  deleteConfirmed,
  closeDeleteDialog,
  confirmDeleteProject,
} from "../state/projects.js";
import { useEscape } from "../hooks/useEscape.js";

export function DeleteProjectDialog() {
  useEscape(deleteDialogOpen.value, closeDeleteDialog);
  if (!deleteDialogOpen.value) return null;

  const project = deleteTarget.value;
  if (!project) return null;

  const handleDelete = async () => {
    try {
      await confirmDeleteProject();
    } catch (error) {
      console.error("Error deleting project:", error);
      // Could show an error message to user here
    }
  };

  return (
    <div
      class="wizard-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeDeleteDialog();
      }}
    >
      <div class="delete-dialog">
        <div class="delete-dialog-header">
          <h2>Delete Project</h2>
          <button class="wizard-close-btn" onClick={closeDeleteDialog} aria-label="Close">
            &times;
          </button>
        </div>
        <div class="delete-dialog-body">
          <p class="delete-dialog-warning">
            This will permanently delete <strong>{project.name}</strong> and all
            its associated data. This action cannot be undone.
          </p>
          <p class="delete-dialog-prompt">
            Type <strong>delete</strong> to confirm:
          </p>
          <input
            class="wizard-input delete-dialog-input"
            type="text"
            placeholder="Type delete to confirm"
            value={deleteConfirmText.value}
            onInput={(e) => {
              deleteConfirmText.value = e.target.value;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && deleteConfirmed.value) handleDelete();
            }}
            autoFocus
          />
        </div>
        <div class="wizard-footer">
          <button
            class="wizard-btn wizard-btn-secondary"
            onClick={closeDeleteDialog}
          >
            Cancel
          </button>
          <button
            class="wizard-btn wizard-btn-danger"
            disabled={!deleteConfirmed.value}
            onClick={handleDelete}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
