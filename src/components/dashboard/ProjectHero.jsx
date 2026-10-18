import { currentProject } from "../../state/projects.js";

/** Page title block: eyebrow, project name, tagline, and configuration chips. */
export function ProjectHero() {
  const project = currentProject.value;
  if (!project) return null;
  const chips = [
    project.taskType || "Classification",
    project.datasetFormat && `${project.datasetFormat} dataset`,
    project.connectionType === "remote" ? "Remote compute" : "Local compute",
  ].filter(Boolean);

  return (
    <div class="dash-hero">
      <div class="dash-hero-text">
        <span class="dash-eyebrow">Project</span>
        <h2 class="dash-hero-title">{project.name}</h2>
        <p class="dash-hero-sub">Train, monitor, and explore your computer vision experiments.</p>
      </div>
      <div class="dash-hero-chips" aria-label="Project configuration">
        {chips.map((c) => (
          <span class="dash-chip" key={c}>{c}</span>
        ))}
      </div>
    </div>
  );
}
