// Per-project navigation memory.
//
// Each project remembers the last view the user chose there, so switching to
// another project and back returns to it. A view the project can't reach right
// now (not connected / not synced) shows the dashboard instead, but that
// redirect never overwrites the remembered view: once the project is reachable
// again, the user lands back where they were.
//
// Pure logic (no signals) so it can be unit-tested; app.jsx feeds it the
// current project/page/params from an effect.

/**
 * @param {object} opts
 * @param {(page: string) => boolean} opts.isAvailable  can the active project show this page now?
 * @param {(page: string, params: object) => void} opts.navigate
 * @param {Set<string>} opts.runScoped  pages whose params belong to one project
 * @param {string} [opts.fallback]  page shown when the wanted one isn't available
 * @param {Array<[any, {page: string, params: object}]>} [opts.initial]  remembered routes from a previous session
 * @param {(entries: Array<[any, {page: string, params: object}]>) => void} [opts.onChange]  called when a remembered route changes
 */
export function createRouteMemory({ isAvailable, navigate, runScoped, fallback = "dashboard", initial = [], onChange }) {
  const remembered = new Map(); // projectId -> { page, params } the user chose
  for (const [id, route] of initial) {
    if (route && typeof route.page === "string") remembered.set(id, { page: route.page, params: route.params || {} });
  }
  const bumped = new Set(); // projectIds currently showing `fallback` because their view was unavailable
  let lastProjectId;

  function remember(id, route) {
    const prev = remembered.get(id);
    remembered.set(id, route);
    if (onChange && (!prev || prev.page !== route.page || JSON.stringify(prev.params) !== JSON.stringify(route.params))) {
      onChange([...remembered]);
    }
  }

  /** Drop a project's memory (e.g. when the project is deleted). */
  function forget(id) {
    bumped.delete(id);
    if (remembered.delete(id)) onChange?.([...remembered]);
  }

  /** Call whenever the project, page or params change. */
  function update(projectId, page, params) {
    if (projectId !== lastProjectId) {
      const hadProject = lastProjectId != null;
      lastProjectId = projectId;
      const saved = remembered.get(projectId);
      if (saved) {
        if (saved.page !== page || saved.params !== params) {
          navigate(saved.page, saved.params);
          return;
        }
      } else if (hadProject && runScoped.has(page)) {
        // First visit: keep the current view, unless it shows the previous project's runs.
        navigate("experiments", {});
        return;
      }
    }

    if (projectId == null) {
      if (!isAvailable(page)) navigate(fallback, {});
      return;
    }

    if (!isAvailable(page)) {
      // Remember what they wanted (if not already) and show the fallback for now.
      if (!bumped.has(projectId)) remember(projectId, { page, params });
      bumped.add(projectId);
      navigate(fallback, {});
      return;
    }

    if (bumped.has(projectId)) {
      const wanted = remembered.get(projectId);
      if (page === fallback && wanted && wanted.page !== fallback) {
        if (isAvailable(wanted.page)) {
          bumped.delete(projectId);
          navigate(wanted.page, wanted.params);
        }
        // Still unreachable: stay on the fallback and keep the wanted view.
        return;
      }
      // The user went somewhere else on purpose; that's the new choice.
      bumped.delete(projectId);
    }

    remember(projectId, { page, params });
  }

  return { update, forget, remembered };
}
