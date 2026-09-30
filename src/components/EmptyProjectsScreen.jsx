import { invoke } from "@tauri-apps/api/core";
import { openWizard } from "../state/projects.js";
import { platform } from "../state/dashboard.js";

const minimizeIcon = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor"/></svg>`;
const maximizeIcon = `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`;
const closeIcon = `<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

export function EmptyProjectsScreen() {
  const isWindows = platform.value === "windows";

  return (
    <div class="empty-projects-screen" data-tauri-drag-region>
      {isWindows && (
        <div class="win-controls win-controls--floating">
          <button
            class="win-control-btn"
            onClick={() => invoke("window_minimize")}
            aria-label="Minimize"
          >
            <span dangerouslySetInnerHTML={{ __html: minimizeIcon }} />
          </button>
          <button
            class="win-control-btn"
            onClick={() => invoke("window_maximize")}
            aria-label="Maximize"
          >
            <span dangerouslySetInnerHTML={{ __html: maximizeIcon }} />
          </button>
          <button
            class="win-control-btn win-control-btn--close"
            onClick={() => invoke("window_close")}
            aria-label="Close"
          >
            <span dangerouslySetInnerHTML={{ __html: closeIcon }} />
          </button>
        </div>
      )}
      <div class="empty-projects-content">
        <div class="empty-projects-logo">
          <img src="/assets/image.png" alt="NightFlow" width="140" />
        </div>
        <span class="page-eyebrow">YOUR COMPUTER VISION WORKSPACE</span>
        <h1 class="empty-projects-title">From first dataset.<br />To your best model.</h1>
        <p class="empty-projects-desc">
          Bring your datasets, training runs, and model insights together.
          Build your next computer vision experiment with NightFlow.
        </p>
        <button class="empty-projects-btn" onClick={openWizard}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create your first project
        </button>
        <p class="empty-projects-note">Local or remote compute. One focused workspace.</p>
        <div class="empty-projects-features">
          <div class="empty-projects-feature">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <div class="empty-projects-feature-text">
              <strong>Track Experiments</strong>
              <span>Monitor training metrics in real-time</span>
            </div>
          </div>
          <div class="empty-projects-feature">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <div class="empty-projects-feature-text">
              <strong>Visualize Results</strong>
              <span>Beautiful charts for loss and accuracy</span>
            </div>
          </div>
          <div class="empty-projects-feature">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            <div class="empty-projects-feature-text">
              <strong>Manage Models</strong>
              <span>Compare architectures and configurations</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
