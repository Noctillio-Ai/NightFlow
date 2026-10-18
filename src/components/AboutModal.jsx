import { openUrl } from "@tauri-apps/plugin-opener";
import { currentVersion } from "../state/update.js";
import { platform } from "../state/dashboard.js";
import { useEscape } from "../hooks/useEscape.js";

const closeIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

export function AboutModal({ open, onClose }) {
  useEscape(open, onClose);
  if (!open) return null;

  return (
    <div class="modal-overlay" onClick={onClose}>
      <div
        class="modal-dialog about-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button class="about-modal-close" onClick={onClose} aria-label="Close">
          <span dangerouslySetInnerHTML={{ __html: closeIcon }} />
        </button>

        <div class="about-hero">
          <div class="about-hero-glow" />
          <img
            src="/assets/image.png"
            alt="NightFlow"
            class="about-logo"
          />
          <div class="about-hero-text">
            <span class="about-app-name">NightFlow</span>
            <span class="about-version-badge">
              v{currentVersion.value || "0.1.0"}
            </span>
          </div>
          <p class="about-tagline">
            Train, compare, and visualize deep learning
            <br />
            experiments locally. Full privacy — no cloud required.
          </p>
        </div>

        <div class="about-body">
          <div class="about-details">
            <div class="about-detail-row">
              <span class="about-detail-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <span class="about-detail-label">Author</span>
              <span class="about-detail-value">Krishnatheja Vanka</span>
            </div>
            <div class="about-detail-row">
              <span class="about-detail-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              </span>
              <span class="about-detail-label">License</span>
              <span class="about-detail-value">Apache-2.0</span>
            </div>
            <div class="about-detail-row">
              <span class="about-detail-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </span>
              <span class="about-detail-label">Platform</span>
              <span class="about-detail-value about-platform-chip">{platform.value || "unknown"}</span>
            </div>
          </div>

          <div class="about-tech">
            <span class="about-tech-label">Built with</span>
            <div class="about-tech-chips">
              <span class="about-chip">Tauri v2</span>
              <span class="about-chip">Preact</span>
              <span class="about-chip">Rust</span>
              <span class="about-chip">PyTorch Lightning</span>
            </div>
          </div>

          <div class="about-links">
            <button
              class="about-link-btn"
              onClick={() => openUrl("https://github.com/theja-vanka/NightFlow")}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
              GitHub
            </button>
            <button
              class="about-link-btn"
              onClick={() => openUrl("https://github.com/theja-vanka/NightFlow/issues")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Report Issue
            </button>
            <button
              class="about-link-btn"
              onClick={() => openUrl("https://github.com/theja-vanka/NightFlow/releases")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Releases
            </button>
          </div>

          <div class="about-footer">
            Made with care for the ML community
          </div>
        </div>
      </div>
    </div>
  );
}
