// Where new projects live by default: a hidden folder in the home directory.
// Existing projects keep the folder saved with them; only new projects (the
// wizard, imports, an emptied folder field in Settings) use this.
//
// The path style follows where the files live, not the machine running the
// app: a remote project's folder is on the (Linux/macOS) server, so it always
// uses "~/…", even when NightFlow runs on Windows. The backend only expands a
// remote "~" written as "~/".

/**
 * Platform whose path style a project's folder uses: "remote" for remote
 * projects (always POSIX), otherwise this machine's platform.
 */
export function pathPlatform(connectionType, platform) {
  return connectionType === "remote" ? "remote" : platform;
}

const sepFor = (platform) => (platform === "windows" ? "\\" : "/");

/** "~/.nightflow/projects/" (or "~\\.nightflow\\projects\\" for local Windows). */
export function projectsBase(platform) {
  return platform === "windows" ? "~\\.nightflow\\projects\\" : "~/.nightflow/projects/";
}

/** Folder-safe form of a project name: "Retail Shelf!" → "retail-shelf". */
export function projectSlug(name) {
  return String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Default folder for a project named `name`, with a trailing separator. */
export function defaultProjectPath(name, platform) {
  return `${projectsBase(platform)}${projectSlug(name) || "project"}${sepFor(platform)}`;
}

/** True when `path` is one of the defaults for `name` in either path style. */
export function isDefaultProjectPath(path, name) {
  const p = String(path || "").trim().replace(/[\\/]+$/, "");
  if (!p) return true;
  return ["windows", "remote"].some((plat) => {
    const base = projectsBase(plat).replace(/[\\/]+$/, "");
    return p === base || p === defaultProjectPath(name, plat).replace(/[\\/]+$/, "");
  });
}

/**
 * The folder with exactly one trailing separator of the right style. A
 * remote folder also has any "\\" turned into "/" (a Windows-style remote
 * path can't work on the server).
 */
export function normalizeProjectPath(path, platform) {
  let p = String(path || "").trim();
  if (!p) return p;
  if (platform === "remote") p = p.replace(/\\/g, "/");
  return p.replace(/[\\/]+$/, "") + sepFor(platform);
}
