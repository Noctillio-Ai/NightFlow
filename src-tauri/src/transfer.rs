//! Project export / import files.
//!
//! The frontend (utils/transfer.js) builds the JSON manifest. This module only
//! does what needs the file system or SSH:
//!
//! - reading and writing `.json` exports,
//! - listing a project's run files and choosing checkpoints for a Full export,
//! - packing a Full export: a gzip'd tar named `.nightflow` holding
//!   `nightflow.json` (always the first entry) and `files/logs/<run>/…`.
//!   Remote projects are streamed from the server with `tar` over ssh,
//! - unpacking a Full export into a project folder, renaming each
//!   `logs/<old run id>/` to the run's new id.
//!
//! A Full export can also carry the dataset: each dataset path (a folder, or a
//! CSV/JSONL file) is a "source" stored under `files/dataset/<key>/`, and
//! lands in `<project>/dataset/<key>/` on import (the frontend rewrites the
//! project's dataset paths to match).

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Emitter, command};

use crate::expand_tilde;

const MANIFEST_NAME: &str = "nightflow.json";
const FILES_PREFIX: &str = "files/";
/// Plain JSON exports larger than this are refused (a Standard export is MBs).
const MAX_JSON_BYTES: u64 = 512 * 1024 * 1024;

// ── Cancellation ─────────────────────────────────────────────────────────────

static CANCELLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn is_cancelled(op: &str) -> bool {
    CANCELLED.lock().map(|g| g.as_ref().is_some_and(|s| s.contains(op))).unwrap_or(false)
}

fn clear_cancel(op: &str) {
    if let Ok(mut g) = CANCELLED.lock()
        && let Some(s) = g.as_mut()
    {
        s.remove(op);
    }
}

#[command]
pub fn cancel_transfer(op_id: String) {
    if let Ok(mut g) = CANCELLED.lock() {
        g.get_or_insert_with(HashSet::new).insert(op_id);
    }
}

const CANCELLED_MSG: &str = "Cancelled";

// ── Progress ─────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
struct Progress {
    op_id: String,
    phase: &'static str,
    done: u64,
    total: u64,
    file: String,
}

/// Emits `transfer-progress` at most every 150 ms (plus a final one).
struct Reporter {
    app: Option<tauri::AppHandle>,
    op: String,
    phase: &'static str,
    total: u64,
    done: u64,
    last: Instant,
}

impl Reporter {
    fn new(app: Option<tauri::AppHandle>, op: &str, phase: &'static str, total: u64) -> Self {
        Self { app, op: op.to_string(), phase, total, done: 0, last: Instant::now() - Duration::from_secs(1) }
    }
    fn add(&mut self, n: u64, file: &str) {
        self.done += n;
        if self.last.elapsed() >= Duration::from_millis(150) {
            self.emit(file);
        }
    }
    fn emit(&mut self, file: &str) {
        self.last = Instant::now();
        let Some(app) = &self.app else { return };
        let _ = app.emit(
            "transfer-progress",
            Progress { op_id: self.op.clone(), phase: self.phase, done: self.done, total: self.total, file: file.to_string() },
        );
    }
}

/// Reader that reports bytes and stops when the operation is cancelled.
struct Counted<'a, R: Read> {
    inner: R,
    rep: &'a mut Reporter,
    file: String,
}

impl<R: Read> Read for Counted<'_, R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if is_cancelled(&self.rep.op) {
            return Err(std::io::Error::other(CANCELLED_MSG));
        }
        let n = self.inner.read(buf)?;
        self.rep.add(n as u64, &self.file);
        Ok(n)
    }
}

// ── Run files and checkpoint selection ───────────────────────────────────────

#[derive(Clone, Debug)]
struct RunFile {
    /// Path relative to the project folder, '/'-separated: `logs/<run>/…`.
    rel: String,
    size: u64,
    mtime: u64,
}

fn is_ckpt(rel: &str) -> bool {
    rel.ends_with(".ckpt")
}

/// `logs/<run>/checkpoints/<name>.ckpt` → Some(run)
fn ckpt_dir_run(rel: &str) -> Option<&str> {
    let mut parts = rel.split('/');
    let (logs, run, dir, name) = (parts.next()?, parts.next()?, parts.next()?, parts.next()?);
    (logs == "logs" && dir == "checkpoints" && parts.next().is_none() && name.ends_with(".ckpt")).then_some(run)
}

/// Applies a checkpoint policy:
/// - "all": everything,
/// - "none": no `.ckpt` files,
/// - "best_last": per run, `checkpoints/last.ckpt` plus the newest other
///   checkpoint in `checkpoints/` (the one Deploy exports as "best").
fn select_files(files: &[RunFile], policy: &str) -> Vec<RunFile> {
    match policy {
        "all" => files.to_vec(),
        "none" => files.iter().filter(|f| !is_ckpt(&f.rel)).cloned().collect(),
        _ => {
            let mut best: HashMap<&str, &RunFile> = HashMap::new();
            for f in files {
                if let Some(run) = ckpt_dir_run(&f.rel)
                    && !f.rel.ends_with("/last.ckpt")
                {
                    let keep = best.get(run).is_none_or(|b| f.mtime > b.mtime);
                    if keep {
                        best.insert(run, f);
                    }
                }
            }
            let best_rels: HashSet<&str> = best.values().map(|f| f.rel.as_str()).collect();
            files
                .iter()
                .filter(|f| {
                    !is_ckpt(&f.rel)
                        || best_rels.contains(f.rel.as_str())
                        || (ckpt_dir_run(&f.rel).is_some() && f.rel.ends_with("/last.ckpt"))
                })
                .cloned()
                .collect()
        }
    }
}

fn valid_run_id(id: &str) -> bool {
    !id.is_empty() && !id.contains(['/', '\\']) && !id.contains("..") && !id.starts_with('.')
}

fn mtime_of(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Every regular file under `dir`, as `<rel_prefix>/<path>`. Symlinked
/// folders are never followed (no loops, no escaping the folder);
/// symlinked files are included only when `follow_file_links` (datasets
/// often link images in).
fn walk_dir(dir: &Path, rel_prefix: &str, follow_file_links: bool, out: &mut Vec<RunFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(lmeta) = std::fs::symlink_metadata(e.path()) else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" {
            continue;
        }
        let child_rel = if rel_prefix.is_empty() { name } else { format!("{rel_prefix}/{name}") };
        if lmeta.is_dir() {
            walk_dir(&e.path(), &child_rel, follow_file_links, out);
        } else if lmeta.is_file() {
            out.push(RunFile { rel: child_rel, size: lmeta.len(), mtime: mtime_of(&lmeta) });
        } else if lmeta.file_type().is_symlink() && follow_file_links
            && let Ok(meta) = std::fs::metadata(e.path())
            && meta.is_file()
        {
            out.push(RunFile { rel: child_rel, size: meta.len(), mtime: mtime_of(&meta) });
        }
    }
}

fn list_local(project_dir: &Path, run_ids: &[String]) -> Vec<RunFile> {
    let mut out = Vec::new();
    for id in run_ids.iter().filter(|id| valid_run_id(id)) {
        walk_dir(&project_dir.join("logs").join(id), &format!("logs/{id}"), false, &mut out);
    }
    out
}

/// `~/x` → `$HOME/x` so the remote shell expands it inside double quotes.
fn remote_dir(project_path: &str) -> String {
    let pp = project_path.trim_end_matches('/');
    if pp == "~" {
        "$HOME".into()
    } else if let Some(rest) = pp.strip_prefix("~/") {
        format!("$HOME/{rest}")
    } else {
        pp.into()
    }
}

fn ssh_parts(ssh_command: &str) -> Result<Vec<String>, String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.len() < 2 {
        return Err("Invalid SSH command".into());
    }
    Ok(parts)
}

fn ssh_cmd(parts: &[String]) -> std::process::Command {
    let mut cmd = std::process::Command::new(&parts[0]);
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
    cmd.args(&parts[1..]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn list_remote(project_path: &str, ssh_command: &str, run_ids: &[String]) -> Result<Vec<RunFile>, String> {
    let parts = ssh_parts(ssh_command)?;
    let dirs: Vec<String> = run_ids.iter().filter(|id| valid_run_id(id)).map(|id| format!("\"logs/{id}\"")).collect();
    if dirs.is_empty() {
        return Ok(Vec::new());
    }
    // GNU stat first, BSD stat as a fallback: "<size> <mtime> <path>".
    let script = format!(
        r#"cd "{dir}" 2>/dev/null || exit 3; for d in {dirs}; do [ -d "$d" ] || continue; find "$d" -type f -exec stat -c '%s %Y %n' {{}} + 2>/dev/null || find "$d" -type f -exec stat -f '%z %m %N' {{}} +; done"#,
        dir = remote_dir(project_path),
        dirs = dirs.join(" ")
    );
    let out = ssh_cmd(&parts).arg(script).stdin(std::process::Stdio::null()).output().map_err(|e| e.to_string())?;
    if out.status.code() == Some(3) {
        return Err(format!("Project folder not found on the server: {project_path}"));
    }
    if !out.status.success() && out.stdout.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { "Couldn't list files on the server".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, ' ');
            let size = it.next()?.parse().ok()?;
            let mtime = it.next()?.parse().ok()?;
            let rel = it.next()?.trim_start_matches("./").to_string();
            rel.starts_with("logs/").then_some(RunFile { rel, size, mtime })
        })
        .collect())
}

/// Parses "<size> <mtime> <path>" lines from GNU/BSD `stat`.
fn parse_stat_lines(out: &str) -> Vec<RunFile> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, ' ');
            let size = it.next()?.parse().ok()?;
            let mtime = it.next()?.parse().ok()?;
            let rel = it.next()?.trim_start_matches("./").to_string();
            (!rel.is_empty()).then_some(RunFile { rel, size, mtime })
        })
        .collect()
}

fn list_files(project_path: &str, ssh_command: Option<&str>, run_ids: &[String]) -> Result<Vec<RunFile>, String> {
    match ssh_command {
        Some(cmd) => list_remote(project_path, cmd, run_ids),
        None => Ok(list_local(&PathBuf::from(expand_tilde(project_path)), run_ids)),
    }
}

// ── Sources (what goes into an archive) ─────────────────────────────────────

/// A dataset path to bundle, from the project's settings.
#[derive(serde::Deserialize, Clone, Debug)]
pub struct DatasetSource {
    /// "folder", "train", "val", "test", "images" (becomes `dataset/<key>/`).
    key: String,
    path: String,
    /// "dir" or "file".
    kind: String,
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 32 && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Files to pack from one folder: `items` are (path relative to `base`,
/// name in the archive, size, mtime).
struct Source {
    base: String,
    items: Vec<(String, String, u64, u64)>,
}

impl Source {
    fn bytes(&self) -> u64 {
        self.items.iter().map(|i| i.2).sum()
    }
}

/// Parent folder and file name of a '/' or '\\' separated path.
fn split_parent(path: &str) -> (String, String) {
    let p = path.trim_end_matches(['/', '\\']);
    match p.rfind(['/', '\\']) {
        Some(i) => (p[..i.max(1)].to_string(), p[i + 1..].to_string()),
        None => (".".to_string(), p.to_string()),
    }
}

/// The files of one dataset path, or None when it doesn't exist.
fn dataset_source(src: &DatasetSource, ssh_command: Option<&str>) -> Result<Option<Source>, String> {
    if !valid_key(&src.key) || src.path.trim().is_empty() {
        return Ok(None);
    }
    let arch = |rel: &str| format!("{FILES_PREFIX}dataset/{}/{rel}", src.key);
    let is_dir = src.kind == "dir";
    let to_items = |files: Vec<RunFile>| files.into_iter().map(|f| (f.rel.clone(), arch(&f.rel), f.size, f.mtime)).collect();
    match ssh_command {
        None => {
            let p = PathBuf::from(expand_tilde(src.path.trim()));
            if is_dir {
                if !p.is_dir() {
                    return Ok(None);
                }
                let mut files = Vec::new();
                walk_dir(&p, "", true, &mut files);
                Ok(Some(Source { base: p.to_string_lossy().to_string(), items: to_items(files) }))
            } else {
                let Ok(meta) = std::fs::metadata(&p) else { return Ok(None) };
                if !meta.is_file() {
                    return Ok(None);
                }
                let (base, name) = split_parent(&p.to_string_lossy());
                Ok(Some(Source { base, items: vec![(name.clone(), arch(&name), meta.len(), mtime_of(&meta))] }))
            }
        }
        Some(cmd) => {
            let parts = ssh_parts(cmd)?;
            let (base, script) = if is_dir {
                let d = remote_dir(src.path.trim());
                (d.clone(), format!(r#"cd "{d}" 2>/dev/null || exit 3; find . -type f -exec stat -c '%s %Y %n' {{}} + 2>/dev/null || find . -type f -exec stat -f '%z %m %N' {{}} +"#))
            } else {
                let (b, name) = split_parent(&remote_dir(src.path.trim()));
                (b.clone(), format!(r#"cd "{b}" 2>/dev/null && [ -f "{name}" ] || exit 3; stat -c '%s %Y %n' "{name}" 2>/dev/null || stat -f '%z %m %N' "{name}""#))
            };
            let out = ssh_cmd(&parts).arg(script).stdin(std::process::Stdio::null()).output().map_err(|e| e.to_string())?;
            if out.status.code() == Some(3) {
                return Ok(None);
            }
            Ok(Some(Source { base, items: to_items(parse_stat_lines(&String::from_utf8_lossy(&out.stdout))) }))
        }
    }
}

/// The run files (by checkpoint policy) as a source rooted at the project.
fn runs_source(project_path: &str, ssh_command: Option<&str>, run_ids: &[String], policy: &str) -> Result<Source, String> {
    let files = select_files(&list_files(project_path, ssh_command, run_ids)?, policy);
    let base = match ssh_command {
        Some(_) => remote_dir(project_path),
        None => expand_tilde(project_path),
    };
    Ok(Source { base, items: files.into_iter().map(|f| (f.rel.clone(), format!("{FILES_PREFIX}{}", f.rel), f.size, f.mtime)).collect() })
}

/// What a Full export contains, for the manifest and the done screen.
#[derive(serde::Serialize, Debug, Default, Clone)]
pub struct ArchiveSummary {
    /// Runs with at least one file.
    runs: usize,
    /// Exported models (`model.pt`, `model.onnx`, `model.engine`, …).
    models: usize,
    checkpoints: usize,
    dataset_files: usize,
    dataset_bytes: u64,
}

fn summarize(runs: &Source, dataset: &[Source]) -> ArchiveSummary {
    let names = || runs.items.iter().map(|i| i.0.as_str());
    let mut run_ids: Vec<&str> = names().filter_map(|r| r.split('/').nth(1)).collect();
    run_ids.sort_unstable();
    run_ids.dedup();
    ArchiveSummary {
        runs: run_ids.len(),
        models: names().filter(|r| r.rsplit('/').next().is_some_and(|f| f.starts_with("model."))).count(),
        checkpoints: names().filter(|r| is_ckpt(r)).count(),
        dataset_files: dataset.iter().map(|d| d.items.len()).sum(),
        dataset_bytes: dataset.iter().map(Source::bytes).sum(),
    }
}

#[derive(serde::Serialize, Debug)]
pub struct DatasetPlan {
    key: String,
    found: bool,
    files: usize,
    bytes: u64,
}

#[derive(serde::Serialize, Debug)]
pub struct PolicySize {
    files: usize,
    bytes: u64,
}

#[derive(serde::Serialize, Debug)]
pub struct FullExportPlan {
    /// Runs (by id) that have files on disk.
    runs_with_files: Vec<String>,
    best_last: PolicySize,
    all: PolicySize,
    none: PolicySize,
    /// Exported models and checkpoints found (with all checkpoints).
    models: usize,
    checkpoints: usize,
    dataset: Vec<DatasetPlan>,
}

/// Sizes of a Full export under each checkpoint policy.
#[command]
pub async fn full_export_plan(
    project_path: String,
    ssh_command: Option<String>,
    run_ids: Vec<String>,
    dataset: Option<Vec<DatasetSource>>,
) -> Result<FullExportPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let files = list_files(&project_path, ssh_command.as_deref(), &run_ids)?;
        let mut dataset_plan = Vec::new();
        for src in dataset.unwrap_or_default() {
            let found = dataset_source(&src, ssh_command.as_deref())?;
            dataset_plan.push(DatasetPlan {
                key: src.key.clone(),
                found: found.is_some(),
                files: found.as_ref().map_or(0, |s| s.items.len()),
                bytes: found.as_ref().map_or(0, Source::bytes),
            });
        }
        let size = |policy: &str| {
            let sel = select_files(&files, policy);
            PolicySize { files: sel.len(), bytes: sel.iter().map(|f| f.size).sum() }
        };
        let mut runs: Vec<String> = files.iter().filter_map(|f| f.rel.split('/').nth(1).map(String::from)).collect();
        runs.sort();
        runs.dedup();
        let models = files.iter().filter(|f| f.rel.rsplit('/').next().is_some_and(|n| n.starts_with("model."))).count();
        let checkpoints = files.iter().filter(|f| is_ckpt(&f.rel)).count();
        Ok(FullExportPlan {
            runs_with_files: runs,
            best_last: size("best_last"),
            all: size("all"),
            none: size("none"),
            models,
            checkpoints,
            dataset: dataset_plan,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Writing ──────────────────────────────────────────────────────────────────

fn check_ext(path: &str, exts: &[&str]) -> Result<(), String> {
    let lower = path.to_lowercase();
    if exts.iter().any(|e| lower.ends_with(e)) {
        Ok(())
    } else {
        Err(format!("Choose a file ending in {}", exts.join(" or ")))
    }
}

/// Writes a Lite/Standard export (or workspace backup).
#[command]
pub fn write_transfer_json(path: String, contents: String) -> Result<(), String> {
    check_ext(&path, &[".json"])?;
    let tmp = format!("{path}.partial");
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

fn tar_header(size: u64, mtime: u64) -> tar::Header {
    let mut h = tar::Header::new_gnu();
    h.set_size(size);
    h.set_mode(0o644);
    h.set_mtime(mtime);
    h.set_entry_type(tar::EntryType::Regular);
    h
}

#[derive(serde::Serialize, Debug)]
pub struct FullExportResult {
    files: usize,
    bytes: u64,
    archive_bytes: u64,
    summary: ArchiveSummary,
}

/// Packs a Full export to `dest` (`.nightflow`). `manifest` is the Standard
/// export JSON; an `archive` summary is added to it before packing.
#[command]
#[allow(clippy::too_many_arguments)]
pub async fn full_export(
    app: tauri::AppHandle,
    op_id: String,
    dest: String,
    manifest: String,
    project_path: String,
    ssh_command: Option<String>,
    run_ids: Vec<String>,
    checkpoints: String,
    dataset: Option<Vec<DatasetSource>>,
) -> Result<FullExportResult, String> {
    check_ext(&dest, &[".nightflow"])?;
    clear_cancel(&op_id);
    let op = op_id.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        pack(Some(app), &op, &dest, &manifest, &project_path, ssh_command.as_deref(), &run_ids, &checkpoints, &dataset.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?;
    clear_cancel(&op_id);
    res
}

#[allow(clippy::too_many_arguments)]
fn pack(
    app: Option<tauri::AppHandle>,
    op: &str,
    dest: &str,
    manifest: &str,
    project_path: &str,
    ssh_command: Option<&str>,
    run_ids: &[String],
    checkpoints: &str,
    dataset: &[DatasetSource],
) -> Result<FullExportResult, String> {
    let runs = runs_source(project_path, ssh_command, run_ids, checkpoints)?;
    let mut datasets = Vec::new();
    for src in dataset {
        if let Some(found) = dataset_source(src, ssh_command)? {
            datasets.push(found);
        }
    }
    let summary = summarize(&runs, &datasets);
    let sources: Vec<&Source> = std::iter::once(&runs).chain(datasets.iter()).collect();
    let files: usize = sources.iter().map(|s| s.items.len()).sum();
    let total: u64 = sources.iter().map(|s| s.bytes()).sum();

    let mut man: serde_json::Value = serde_json::from_str(manifest).map_err(|e| format!("Bad manifest: {e}"))?;
    man["archive"] = serde_json::json!({
        "files": files,
        "bytes": total,
        "checkpoints": checkpoints,
        "summary": &summary,
        "dataset": dataset.iter().filter(|d| datasets.iter().any(|s| s.items.iter().any(|i| i.1.starts_with(&format!("{FILES_PREFIX}dataset/{}/", d.key))))).map(|d| serde_json::json!({ "key": d.key, "kind": d.kind, "path": d.path })).collect::<Vec<_>>(),
    });
    let man_bytes = serde_json::to_vec_pretty(&man).map_err(|e| e.to_string())?;

    let tmp = format!("{dest}.partial");
    let result = (|| -> Result<(), String> {
        let out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        // Checkpoints barely compress; favour speed.
        let gz = flate2::write::GzEncoder::new(std::io::BufWriter::new(out), flate2::Compression::fast());
        let mut tar = tar::Builder::new(gz);
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut h = tar_header(man_bytes.len() as u64, now);
        tar.append_data(&mut h, MANIFEST_NAME, man_bytes.as_slice()).map_err(|e| e.to_string())?;

        let mut rep = Reporter::new(app.clone(), op, "packing", total);
        for src in &sources {
            if src.items.is_empty() {
                continue;
            }
            match ssh_command {
                None => {
                    let base = PathBuf::from(&src.base);
                    for (rel, name, size, mtime) in &src.items {
                        let file = std::fs::File::open(base.join(rel)).map_err(|e| format!("{rel}: {e}"))?;
                        let len = file.metadata().map(|m| m.len()).unwrap_or(*size);
                        let mut h = tar_header(len, *mtime);
                        let reader = Counted { inner: file.take(len), rep: &mut rep, file: rel.clone() };
                        tar.append_data(&mut h, name, reader).map_err(map_cancel)?;
                    }
                }
                Some(cmd) => stream_remote(cmd, src, &mut tar, &mut rep)?,
            }
        }
        rep.emit("");
        let gz = tar.into_inner().map_err(|e| e.to_string())?;
        gz.finish().map_err(|e| e.to_string())?.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
            let archive_bytes = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
            Ok(FullExportResult { files, bytes: total, archive_bytes, summary })
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Streams one source's files from the server (`tar` over ssh) into `tar`.
fn stream_remote<W: Write>(cmd: &str, src: &Source, tar: &mut tar::Builder<W>, rep: &mut Reporter) -> Result<(), String> {
    let parts = ssh_parts(cmd)?;
    // COPYFILE_DISABLE: macOS tar would add AppleDouble `._*` entries.
    let script = format!(r#"cd "{}" && COPYFILE_DISABLE=1 tar cf - -T -"#, src.base);
    let mut child = ssh_cmd(&parts)
        .arg(script)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    {
        let mut stdin = child.stdin.take().ok_or("ssh stdin unavailable")?;
        let list: String = src.items.iter().map(|i| format!("{}\n", i.0)).collect();
        stdin.write_all(list.as_bytes()).map_err(|e| e.to_string())?;
    }
    let stdout = child.stdout.take().ok_or("ssh stdout unavailable")?;
    // Copy only what was asked for, whatever extra entries the server's tar adds.
    let wanted: HashMap<&str, &str> = src.items.iter().map(|i| (i.0.as_str(), i.1.as_str())).collect();
    let mut remote = tar::Archive::new(stdout);
    let copy = (|| -> Result<(), String> {
        for entry in remote.entries().map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.header().entry_type() != tar::EntryType::Regular {
                continue;
            }
            let rel = entry.path().map_err(|e| e.to_string())?.to_string_lossy().trim_start_matches("./").to_string();
            let Some(name) = wanted.get(rel.as_str()) else { continue };
            if !safe_rel(&rel) {
                continue;
            }
            let mut h = tar_header(entry.header().size().unwrap_or(0), entry.header().mtime().unwrap_or(0));
            let reader = Counted { inner: entry, rep: &mut *rep, file: rel.clone() };
            tar.append_data(&mut h, name, reader).map_err(map_cancel)?;
        }
        Ok(())
    })();
    if copy.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    copy?;
    if !status.success() {
        let mut err = String::new();
        if let Some(mut e) = child.stderr.take() {
            let _ = e.read_to_string(&mut err);
        }
        // tar exits 1 when a file changed while being read; the copy is still usable.
        if status.code() != Some(1) {
            return Err(format!("Copying from the server failed: {}", err.trim()));
        }
    }
    Ok(())
}

fn map_cancel(e: std::io::Error) -> String {
    if e.to_string().contains(CANCELLED_MSG) { CANCELLED_MSG.into() } else { e.to_string() }
}

// ── Reading ──────────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Debug)]
pub struct TransferFile {
    /// "json" or "archive"
    kind: &'static str,
    manifest: String,
    bytes: u64,
}

/// Reads an export: a `.json` file, or the manifest of a `.nightflow` archive.
#[command]
pub async fn read_transfer_file(path: String) -> Result<TransferFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn't open the file: {e}"))?;
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut magic = [0u8; 2];
        let n = file.read(&mut magic).map_err(|e| e.to_string())?;
        if n == 2 && magic == [0x1f, 0x8b] {
            let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            let mut ar = tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file)));
            let mut entries = ar.entries().map_err(|_| "This isn't a NightFlow export.".to_string())?;
            let mut first = entries
                .next()
                .ok_or("The archive is empty.")?
                .map_err(|_| "This isn't a NightFlow export.".to_string())?;
            let name = first.path().map_err(|e| e.to_string())?.to_string_lossy().to_string();
            if name != MANIFEST_NAME {
                return Err("This archive wasn't made by NightFlow (no nightflow.json).".into());
            }
            let mut manifest = String::new();
            first.read_to_string(&mut manifest).map_err(|e| e.to_string())?;
            Ok(TransferFile { kind: "archive", manifest, bytes: meta.len() })
        } else {
            if meta.len() > MAX_JSON_BYTES {
                return Err("The file is too large to be a NightFlow export.".into());
            }
            let manifest = std::fs::read_to_string(&path).map_err(|_| "The file isn't readable text (JSON).".to_string())?;
            Ok(TransferFile { kind: "json", manifest, bytes: meta.len() })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Which of `paths` exist on this machine (`~` expanded), for the import
/// dialog's dataset check.
#[command]
pub fn local_paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| !p.trim().is_empty() && Path::new(&expand_tilde(p.trim())).exists()).collect()
}

// ── Unpacking ────────────────────────────────────────────────────────────────

/// A relative, '/'-separated path with no `..`, root or drive components.
fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.contains('\\')
        && Path::new(rel).components().all(|c| matches!(c, Component::Normal(_)))
}

/// Maps `files/logs/<old>/rest` to `logs/<new>/rest'`, where a top-level
/// `<old>.<ext>` file (the run's event log) becomes `<new>.<ext>`.
/// None for anything outside `files/logs/<known run>/`.
fn remap_entry(name: &str, ids: &HashMap<String, String>) -> Option<String> {
    let rel = name.strip_prefix(FILES_PREFIX)?;
    if !safe_rel(rel) {
        return None;
    }
    // Bundled dataset: files/dataset/<key>/… → dataset/<key>/…
    if let Some(rest) = rel.strip_prefix("dataset/") {
        let (key, inner) = rest.split_once('/')?;
        return (valid_key(key) && !inner.is_empty()).then(|| rel.to_string());
    }
    let mut parts: Vec<&str> = rel.split('/').collect();
    if parts.len() < 3 || parts[0] != "logs" {
        return None;
    }
    let old = parts[1];
    let new = ids.get(old)?;
    let renamed_file;
    if parts.len() == 3
        && let Some(rest) = parts[2].strip_prefix(old)
        && rest.starts_with('.')
    {
        renamed_file = format!("{new}{rest}");
        parts[2] = &renamed_file;
        parts[1] = new;
        return Some(parts.join("/"));
    }
    parts[1] = new;
    Some(parts.join("/"))
}

#[derive(serde::Serialize, Debug)]
pub struct UnpackResult {
    files: usize,
    bytes: u64,
    skipped: usize,
}

/// Unpacks a Full export's files into `dest_project_path`, renaming run
/// folders by `run_id_map` (old id → new id). Existing files are overwritten;
/// nothing is deleted. Links and unsafe paths are skipped.
#[command]
pub async fn import_archive_files(
    app: tauri::AppHandle,
    op_id: String,
    path: String,
    dest_project_path: String,
    run_id_map: HashMap<String, String>,
    total_bytes: Option<u64>,
) -> Result<UnpackResult, String> {
    clear_cancel(&op_id);
    let op = op_id.clone();
    let res = tauri::async_runtime::spawn_blocking(move || unpack(Some(app), &op, &path, &dest_project_path, &run_id_map, total_bytes.unwrap_or(0)))
        .await
        .map_err(|e| e.to_string())?;
    clear_cancel(&op_id);
    res
}

fn unpack(
    app: Option<tauri::AppHandle>,
    op: &str,
    path: &str,
    dest_project_path: &str,
    ids: &HashMap<String, String>,
    total: u64,
) -> Result<UnpackResult, String> {
    if ids.values().any(|v| !valid_run_id(v)) {
        return Err("Invalid run id".into());
    }
    let dest = PathBuf::from(expand_tilde(dest_project_path.trim()));
    if dest.as_os_str().is_empty() {
        return Err("Choose a project folder".into());
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("Couldn't create {}: {e}", dest.display()))?;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut ar = tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file)));
    let mut rep = Reporter::new(app, op, "unpacking", total);
    let (mut files, mut bytes, mut skipped) = (0usize, 0u64, 0usize);
    for entry in ar.entries().map_err(|e| e.to_string())? {
        if is_cancelled(op) {
            return Err(CANCELLED_MSG.into());
        }
        let mut entry = entry.map_err(|e| e.to_string())?;
        let name = entry.path().map_err(|e| e.to_string())?.to_string_lossy().to_string();
        if name == MANIFEST_NAME {
            continue;
        }
        let kind = entry.header().entry_type();
        let target = match (kind, remap_entry(&name, ids)) {
            (tar::EntryType::Regular, Some(rel)) => dest.join(rel),
            _ => {
                skipped += 1;
                continue;
            }
        };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = std::fs::File::create(&target).map_err(|e| format!("{}: {e}", target.display()))?;
        let mut reader = Counted { inner: &mut entry, rep: &mut rep, file: name.clone() };
        let n = std::io::copy(&mut reader, &mut out).map_err(map_cancel)?;
        files += 1;
        bytes += n;
    }
    rep.emit("");
    Ok(UnpackResult { files, bytes, skipped })
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn f(rel: &str, size: u64, mtime: u64) -> RunFile {
        RunFile { rel: rel.into(), size, mtime }
    }

    #[test]
    fn checkpoint_policies() {
        let files = vec![
            f("logs/a/a.jsonl", 10, 1),
            f("logs/a/checkpoints/epoch=1.ckpt", 100, 1),
            f("logs/a/checkpoints/epoch=5.ckpt", 100, 5),
            f("logs/a/checkpoints/last.ckpt", 100, 6),
            f("logs/a/model.onnx", 50, 6),
            f("logs/b/checkpoints/epoch=2.ckpt", 70, 2),
            f("logs/b/other/stray.ckpt", 5, 9),
        ];
        let rels = |p: &str| {
            let mut v: Vec<String> = select_files(&files, p).into_iter().map(|f| f.rel).collect();
            v.sort();
            v
        };
        assert_eq!(rels("all").len(), 7);
        assert_eq!(rels("none"), vec!["logs/a/a.jsonl", "logs/a/model.onnx"]);
        assert_eq!(
            rels("best_last"),
            vec![
                "logs/a/a.jsonl",
                "logs/a/checkpoints/epoch=5.ckpt",
                "logs/a/checkpoints/last.ckpt",
                "logs/a/model.onnx",
                "logs/b/checkpoints/epoch=2.ckpt",
            ]
        );
    }

    #[test]
    fn remaps_run_folders_and_event_logs() {
        let ids: HashMap<String, String> = [("old1".to_string(), "new1".to_string())].into();
        assert_eq!(remap_entry("files/logs/old1/old1.jsonl", &ids).as_deref(), Some("logs/new1/new1.jsonl"));
        assert_eq!(remap_entry("files/logs/old1/checkpoints/last.ckpt", &ids).as_deref(), Some("logs/new1/checkpoints/last.ckpt"));
        assert_eq!(remap_entry("files/logs/old1/old1x.txt", &ids).as_deref(), Some("logs/new1/old1x.txt"));
        // Unknown runs, other folders and escapes are refused.
        assert_eq!(remap_entry("files/logs/other/x", &ids), None);
        assert_eq!(remap_entry("files/secrets.txt", &ids), None);
        assert_eq!(remap_entry("files/logs/old1/../../etc/passwd", &ids), None);
        assert_eq!(remap_entry("/files/logs/old1/x", &ids), None);
        assert_eq!(remap_entry("files//logs/old1/x", &ids), None);
        // Bundled dataset files keep their place; bad keys and escapes don't.
        assert_eq!(remap_entry("files/dataset/folder/cats/1.jpg", &ids).as_deref(), Some("dataset/folder/cats/1.jpg"));
        assert_eq!(remap_entry("files/dataset/../x", &ids), None);
        assert_eq!(remap_entry("files/dataset/bad key/x", &ids), None);
        assert_eq!(remap_entry("files/dataset/folder", &ids), None);
    }

    #[test]
    fn safe_paths() {
        assert!(safe_rel("logs/a/b.txt"));
        for bad in ["", "../x", "logs/../../x", "/abs", "logs\\x"] {
            assert!(!safe_rel(bad), "{bad}");
        }
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("nf-transfer-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Full export of a local project and import under new run ids, through
    /// the real `pack` / `read_transfer_file` / `unpack`.
    #[test]
    fn local_round_trip() {
        let root = tmp("rt");
        let proj = root.join("proj");
        for (rel, body) in [
            ("logs/r1/r1.jsonl", "{\"epoch\":1}\n"),
            ("logs/r1/checkpoints/last.ckpt", "LAST"),
            ("logs/r1/checkpoints/epoch=3.ckpt", "BEST"),
            ("logs/r1/checkpoints/epoch=1.ckpt", "OLD"),
            ("logs/r1/hparams.yaml", "lr: 0.1\n"),
            ("logs/r2/r2.jsonl", "{}\n"),
            ("logs/not-exported/x.txt", "no"),
        ] {
            let p = proj.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        // Make epoch=1 clearly older than epoch=3.
        let old = std::fs::File::options().write(true).open(proj.join("logs/r1/checkpoints/epoch=1.ckpt")).unwrap();
        old.set_modified(std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1000)).unwrap();

        let archive = root.join("out.nightflow");
        let runs = vec!["r1".to_string(), "r2".to_string()];
        // A dataset folder (with a nested file), a CSV, and a path that doesn't exist.
        let data = root.join("my data");
        std::fs::create_dir_all(data.join("cats")).unwrap();
        std::fs::write(data.join("cats/1.jpg"), "IMG").unwrap();
        std::fs::write(root.join("train.csv"), "image,label\n").unwrap();
        let dataset = vec![
            DatasetSource { key: "folder".into(), path: data.to_string_lossy().into(), kind: "dir".into() },
            DatasetSource { key: "train".into(), path: root.join("train.csv").to_string_lossy().into(), kind: "file".into() },
            DatasetSource { key: "test".into(), path: root.join("missing.csv").to_string_lossy().into(), kind: "file".into() },
        ];
        std::fs::write(proj.join("logs/r1/model.pt"), "MODEL").unwrap();
        let res = pack(None, "t1", archive.to_str().unwrap(), r#"{"format":"nightflow","version":2}"#, proj.to_str().unwrap(), None, &runs, "best_last", &dataset).unwrap();
        // 2 jsonl, hparams, model, last + best (not epoch=1), + 2 dataset files
        assert_eq!(res.files, 8);
        assert_eq!((res.summary.runs, res.summary.models, res.summary.checkpoints), (2, 1, 2));
        assert_eq!((res.summary.dataset_files, res.summary.dataset_bytes), (2, 3 + 12));

        let read = tauri::async_runtime::block_on(read_transfer_file(archive.to_string_lossy().into())).unwrap();
        assert_eq!(read.kind, "archive");
        let man: serde_json::Value = serde_json::from_str(&read.manifest).unwrap();
        assert_eq!(man["archive"]["files"], 8);
        assert_eq!(man["archive"]["checkpoints"], "best_last");
        assert_eq!(man["archive"]["summary"]["models"], 1);
        // Only sources that were found are listed.
        let keys: Vec<&str> = man["archive"]["dataset"].as_array().unwrap().iter().map(|d| d["key"].as_str().unwrap()).collect();
        assert_eq!(keys, vec!["folder", "train"]);

        let dest = root.join("imported");
        let ids: HashMap<String, String> = [("r1".into(), "n1".into()), ("r2".into(), "n2".into())].into();
        let out = unpack(None, "t2", archive.to_str().unwrap(), dest.to_str().unwrap(), &ids, 0).unwrap();
        assert_eq!(out.files, 8);
        assert_eq!(std::fs::read_to_string(dest.join("dataset/folder/cats/1.jpg")).unwrap(), "IMG");
        assert!(dest.join("dataset/train/train.csv").exists());
        assert_eq!(std::fs::read_to_string(dest.join("logs/n1/model.pt")).unwrap(), "MODEL");
        assert_eq!(std::fs::read_to_string(dest.join("logs/n1/n1.jsonl")).unwrap(), "{\"epoch\":1}\n");
        assert_eq!(std::fs::read_to_string(dest.join("logs/n1/checkpoints/epoch=3.ckpt")).unwrap(), "BEST");
        assert!(dest.join("logs/n1/checkpoints/last.ckpt").exists());
        assert!(!dest.join("logs/n1/checkpoints/epoch=1.ckpt").exists());
        assert!(dest.join("logs/n2/n2.jsonl").exists());
        assert!(!dest.join("logs/r1").exists() && !dest.join("logs/not-exported").exists());

        // A cancelled export leaves no file behind.
        cancel_transfer("t3".into());
        let err = pack(None, "t3", root.join("c.nightflow").to_str().unwrap(), "{}", proj.to_str().unwrap(), None, &runs, "all", &[]).unwrap_err();
        assert_eq!(err, CANCELLED_MSG);
        assert!(!root.join("c.nightflow").exists() && !root.join("c.nightflow.partial").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The remote branch (listing over ssh, streaming `tar` back) with a fake
    /// `ssh` that runs the remote command in a local shell.
    #[cfg(unix)]
    #[test]
    fn remote_branch_with_fake_ssh() {
        use std::os::unix::fs::PermissionsExt;
        let root = tmp("remote");
        let fake = root.join("fake-ssh");
        // Drop "-o X" pairs and the host; run the last argument as the remote script.
        std::fs::write(&fake, "#!/bin/sh\nfor a; do last=\"$a\"; done\nexec /bin/sh -c \"$last\"\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let ssh = format!("{} user@host", fake.display());

        let proj = root.join("remote proj"); // a space, to check quoting
        for (rel, body) in [
            ("logs/r1/r1.jsonl", "line\n"),
            ("logs/r1/checkpoints/last.ckpt", "L"),
            ("logs/r1/checkpoints/epoch=2.ckpt", "B"),
            ("logs/r1/exports/model.onnx", "M"),
        ] {
            let p = proj.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let runs = vec!["r1".to_string(), "missing".to_string()];
        let mut listed: Vec<String> = list_remote(proj.to_str().unwrap(), &ssh, &runs).unwrap().into_iter().map(|f| f.rel).collect();
        listed.sort();
        assert_eq!(listed, vec!["logs/r1/checkpoints/epoch=2.ckpt", "logs/r1/checkpoints/last.ckpt", "logs/r1/exports/model.onnx", "logs/r1/r1.jsonl"]);
        assert!(list_remote(root.join("nope").to_str().unwrap(), &ssh, &runs).unwrap_err().contains("not found"));

        let archive = root.join("remote.nightflow");
        let remote_data = root.join("server data");
        std::fs::create_dir_all(remote_data.join("a")).unwrap();
        std::fs::write(remote_data.join("a/x.png"), "PNG").unwrap();
        std::fs::write(root.join("val.csv"), "v\n").unwrap();
        let dataset = vec![
            DatasetSource { key: "folder".into(), path: remote_data.to_string_lossy().into(), kind: "dir".into() },
            DatasetSource { key: "val".into(), path: root.join("val.csv").to_string_lossy().into(), kind: "file".into() },
            DatasetSource { key: "test".into(), path: root.join("nope").to_string_lossy().into(), kind: "dir".into() },
        ];
        let res = pack(None, "r", archive.to_str().unwrap(), "{}", proj.to_str().unwrap(), Some(&ssh), &runs, "none", &dataset).unwrap();
        assert_eq!(res.files, 4);
        assert_eq!((res.summary.models, res.summary.dataset_files), (1, 2));
        let dest = root.join("dest");
        let ids: HashMap<String, String> = [("r1".into(), "z1".into())].into();
        let out = unpack(None, "u", archive.to_str().unwrap(), dest.to_str().unwrap(), &ids, 0).unwrap();
        assert_eq!(out.files, 4);
        assert_eq!(std::fs::read_to_string(dest.join("dataset/folder/a/x.png")).unwrap(), "PNG");
        assert!(dest.join("dataset/val/val.csv").exists());
        assert_eq!(std::fs::read_to_string(dest.join("logs/z1/exports/model.onnx")).unwrap(), "M");
        assert!(dest.join("logs/z1/z1.jsonl").exists());
        assert!(!dest.join("logs/z1/checkpoints").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A hand-made archive with an escaping path and a symlink: neither is written.
    #[test]
    fn unpack_refuses_escapes_and_links() {
        let root = tmp("evil");
        let archive = root.join("evil.nightflow");
        {
            let gz = flate2::write::GzEncoder::new(std::fs::File::create(&archive).unwrap(), flate2::Compression::fast());
            let mut tar = tar::Builder::new(gz);
            tar.append_data(&mut tar_header(2, 0), MANIFEST_NAME, &b"{}"[..]).unwrap();
            let mut h = tar_header(1, 0);
            h.as_mut_bytes()[..100].fill(0);
            h.as_mut_bytes()[..24].copy_from_slice(b"files/logs/r1/../../../x");
            h.set_cksum();
            tar.append(&h, &b"x"[..]).unwrap();
            let mut l = tar::Header::new_gnu();
            l.set_entry_type(tar::EntryType::Symlink);
            l.set_size(0);
            l.set_link_name("/etc/passwd").unwrap();
            tar.append_data(&mut l, "files/logs/r1/link", &b""[..]).unwrap();
            tar.append_data(&mut tar_header(2, 0), "files/logs/r1/ok.txt", &b"ok"[..]).unwrap();
            tar.into_inner().unwrap().finish().unwrap();
        }
        let dest = root.join("dest");
        let ids: HashMap<String, String> = [("r1".into(), "n1".into())].into();
        let out = unpack(None, "t4", archive.to_str().unwrap(), dest.to_str().unwrap(), &ids, 0).unwrap();
        assert_eq!((out.files, out.skipped), (1, 2));
        assert!(dest.join("logs/n1/ok.txt").exists());
        assert!(!root.join("x").exists() && !dest.join("x").exists());
        assert!(std::fs::symlink_metadata(dest.join("logs/n1/link")).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_non_exports() {
        let root = tmp("bad");
        let gz = root.join("other.tar.gz");
        {
            let enc = flate2::write::GzEncoder::new(std::fs::File::create(&gz).unwrap(), flate2::Compression::fast());
            let mut tar = tar::Builder::new(enc);
            tar.append_data(&mut tar_header(2, 0), "readme.txt", &b"hi"[..]).unwrap();
            tar.into_inner().unwrap().finish().unwrap();
        }
        let err = tauri::async_runtime::block_on(read_transfer_file(gz.to_string_lossy().into())).unwrap_err();
        assert!(err.contains("nightflow.json"));
        assert!(write_transfer_json(root.join("x.txt").to_string_lossy().into(), "{}".into()).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
