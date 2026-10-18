import { openDB, deleteDB } from "idb";

const DB_NAME = "nightflow-db";
const DB_VERSION = 3;

// One shared connection. Opening a new one per call let concurrent updates
// interleave across connections in no particular order.
let _dbPromise = null;

// Initialize the database
export function initDB() {
  if (!_dbPromise) {
    _dbPromise = _openDB().catch((err) => {
      _dbPromise = null; // let the next call retry
      throw err;
    });
  }
  return _dbPromise;
}

function _openDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      // v1: initial schema
      if (oldVersion < 1) {
        const projectStore = db.createObjectStore("projects", {
          keyPath: "id",
        });
        projectStore.createIndex("name", "name", { unique: false });
        projectStore.createIndex("taskType", "taskType", { unique: false });

        const runStore = db.createObjectStore("runs", { keyPath: "id" });
        runStore.createIndex("projectId", "projectId", { unique: false });
        runStore.createIndex("status", "status", { unique: false });
        runStore.createIndex("created", "created", { unique: false });
      }

      // v3: add compound index for efficient per-project queries sorted by time
      if (oldVersion < 3) {
        const runStore = transaction.objectStore("runs");
        if (!runStore.indexNames.contains("projectId_created")) {
          runStore.createIndex("projectId_created", ["projectId", "created"], { unique: false });
        }
      }
    },
    // Another tab/window upgraded the schema: drop this connection so the next
    // call reopens instead of using a closed handle.
    blocking() {
      _dbPromise?.then((db) => db.close());
      _dbPromise = null;
    },
  });
}

/**
 * Read-modify-write a record in one transaction. Readwrite transactions on a
 * store run one at a time in the order they're created, so concurrent updates
 * apply in call order and none of them writes back a stale copy.
 */
async function updateRecord(storeName, id, updates, label) {
  const db = await initDB();
  const tx = db.transaction(storeName, "readwrite");
  const current = await tx.store.get(id);
  if (!current) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error(`${label} with id ${id} not found`);
  }
  const updated = { ...current, ...updates };
  await tx.store.put(updated);
  await tx.done;
  return updated;
}

// ========================================
// Project CRUD Operations
// ========================================

export async function saveProject(project) {
  const db = await initDB();
  await db.put("projects", project);
  return project;
}

export async function getAllProjects() {
  const db = await initDB();
  return db.getAll("projects");
}

export async function getProject(id) {
  const db = await initDB();
  return db.get("projects", id);
}

export async function deleteProject(id) {
  const db = await initDB();
  const tx = db.transaction(["projects", "runs"], "readwrite");

  // Delete the project
  await tx.objectStore("projects").delete(id);

  // Delete all runs associated with this project
  const runStore = tx.objectStore("runs");
  const projectRuns = await runStore.index("projectId").getAllKeys(id);
  for (const runId of projectRuns) {
    await runStore.delete(runId);
  }

  await tx.done;
}

export async function updateProject(id, updates) {
  return updateRecord("projects", id, updates, "Project");
}

// ========================================
// Run CRUD Operations
// ========================================

export async function saveRun(run) {
  const db = await initDB();
  await db.put("runs", run);
  return run;
}

export async function getAllRuns() {
  const db = await initDB();
  return db.getAll("runs");
}

export async function getRun(id) {
  const db = await initDB();
  return db.get("runs", id);
}

export async function getRunsByProject(projectId) {
  const db = await initDB();
  return db.getAllFromIndex("runs", "projectId", projectId);
}

export async function deleteRun(id) {
  const db = await initDB();
  await db.delete("runs", id);
}

export async function updateRun(id, updates) {
  return updateRecord("runs", id, updates, "Run");
}

// ========================================
// Migrations
// ========================================

/**
 * Re-number project IDs from old `proj-<timestamp>` format to sequential
 * integers (1, 2, 3, …) matching MLflow experiment ID style.
 * Also updates the `projectId` field on all associated runs.
 */
export async function migrateProjectIds() {
  const db = await initDB();
  const projects = await db.getAll("projects");

  // Only migrate if there are projects with the old format
  const needsMigration = projects.some((p) => String(p.id).startsWith("proj-"));
  if (!needsMigration) return false;

  const tx = db.transaction(["projects", "runs"], "readwrite");
  const projectStore = tx.objectStore("projects");
  const runStore = tx.objectStore("runs");

  // Sort projects by creation order (the timestamp in the old id)
  const sorted = [...projects].sort((a, b) => {
    const tsA = String(a.id).startsWith("proj-")
      ? Number(String(a.id).slice(5))
      : 0;
    const tsB = String(b.id).startsWith("proj-")
      ? Number(String(b.id).slice(5))
      : 0;
    return tsA - tsB;
  });

  // Preserve current IDs and migrate only legacy IDs above their maximum.
  // Renumbering every entry in place can overwrite another project and its runs.
  let nextId = Math.max(0, ...projects.map((p) => Number(p.id) || 0)) + 1;
  for (const project of sorted.filter((p) => String(p.id).startsWith("proj-"))) {
    const oldId = project.id;
    const newId = String(nextId++);
    await projectStore.delete(oldId);
    await projectStore.put({ ...project, id: newId });
    const runs = await runStore.index("projectId").getAll(oldId);
    for (const run of runs) await runStore.put({ ...run, projectId: newId });
  }

  await tx.done;
  return true;
}

// ========================================
// Bulk Operations
// ========================================

export async function clearAllData() {
  const db = await initDB();
  db.close();
  _dbPromise = null; // reopen (and recreate the schema) on next use
  await deleteDB(DB_NAME);
}

export async function exportData() {
  const db = await initDB();
  const projects = await db.getAll("projects");
  const runs = await db.getAll("runs");
  return { projects, runs };
}

// ========================================
// Sync Metadata Operations
// ========================================

export async function saveSyncMetadata(projectId, metadata) {
  try {
    await updateRecord("projects", projectId, { syncMetadata: metadata }, "Project");
  } catch {
    // Project was deleted meanwhile — nothing to save.
  }
}

export async function getSyncMetadata(projectId) {
  const db = await initDB();
  const project = await db.get("projects", projectId);
  return project?.syncMetadata || null;
}

export async function importData(data) {
  const db = await initDB();
  const tx = db.transaction(["projects", "runs"], "readwrite");

  // Clear existing data
  await tx.objectStore("projects").clear();
  await tx.objectStore("runs").clear();

  // Import new data
  if (data.projects) {
    for (const project of data.projects) {
      await tx.objectStore("projects").put(project);
    }
  }

  if (data.runs) {
    for (const run of data.runs) {
      await tx.objectStore("runs").put(run);
    }
  }

  await tx.done;
}
