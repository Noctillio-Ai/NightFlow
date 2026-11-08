//! Model exports kept alongside each run.
//!
//! Exports live in the run's log folder on the training machine (local or
//! remote), one file per format:
//!
//!   logs/<run_id>/model.pt      TorchScript
//!   logs/<run_id>/model.onnx    ONNX
//!   logs/<run_id>/model.engine  TensorRT (built from model.onnx)
//!
//! They are built once, listed, saved to ~/Downloads on demand, and deleted on
//! request. `export_model` emits `export-progress` events so the UI can show
//! which stage is running.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{command, AppHandle, Emitter};

use crate::env::python_cmd;
use crate::{expand_tilde, home_dir, TokioCommandNoWindow};

/// (format id, file name inside the run folder, file extension when saved)
const FORMATS: [(&str, &str, &str); 3] = [
    ("torchscript", "model.pt", ".pt"),
    ("onnx", "model.onnx", ".onnx"),
    ("tensorrt", "model.engine", ".engine"),
];

fn format_entry(format: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    FORMATS
        .iter()
        .copied()
        .find(|(id, _, _)| *id == format)
        .ok_or_else(|| format!("Unknown export format: {format}"))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportInfo {
    pub format: String,
    pub path: String,
    pub size_bytes: u64,
    /// Last-modified time, milliseconds since the Unix epoch.
    pub modified_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportProgress<'a> {
    run_id: &'a str,
    format: &'a str,
    /// locate | convert | engine | done
    stage: &'a str,
}

/// Where a run's files live and how to reach them.
struct RunLocation {
    /// Run folder. For remote runs a leading `~` becomes `$HOME` so the remote
    /// shell expands it inside double quotes.
    run_dir: String,
    /// Project folder, same convention as `run_dir`.
    project_dir: String,
    /// SSH argv (`ssh`, flags…, host) for remote projects.
    ssh: Option<Vec<String>>,
}

impl RunLocation {
    fn new(project_path: &str, run_id: &str, ssh_command: Option<String>) -> Result<Self, String> {
        if run_id.is_empty() || run_id.contains(['/', '\\']) || run_id.contains("..") {
            return Err("Invalid run id".to_string());
        }
        let pp = project_path.trim_end_matches(['/', '\\']);
        match ssh_command {
            Some(cmd) => {
                let parts: Vec<String> = cmd.split_whitespace().map(String::from).collect();
                if parts.len() < 2 {
                    return Err("Invalid SSH command".to_string());
                }
                let project_dir = if pp == "~" {
                    "$HOME".to_string()
                } else if let Some(rest) = pp.strip_prefix("~/") {
                    format!("$HOME/{rest}")
                } else {
                    pp.to_string()
                };
                Ok(Self {
                    run_dir: format!("{project_dir}/logs/{run_id}"),
                    project_dir,
                    ssh: Some(parts),
                })
            }
            None => {
                let project = PathBuf::from(expand_tilde(pp));
                Ok(Self {
                    run_dir: project.join("logs").join(run_id).to_string_lossy().to_string(),
                    project_dir: project.to_string_lossy().to_string(),
                    ssh: None,
                })
            }
        }
    }

    fn file(&self, name: &str) -> String {
        if self.ssh.is_some() {
            format!("{}/{}", self.run_dir, name)
        } else {
            Path::new(&self.run_dir).join(name).to_string_lossy().to_string()
        }
    }
}

async fn ssh_run(parts: &[String], script: &str) -> Result<std::process::Output, String> {
    tokio::process::Command::new(&parts[0])
        .no_window()
        .args(&parts[1..])
        .arg(script)
        .output()
        .await
        .map_err(|e| format!("SSH failed: {e}"))
}

fn stderr_of(out: &std::process::Output) -> String {
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if err.is_empty() {
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    } else {
        err
    }
}

fn local_info(format: &str, path: &str) -> Option<ExportInfo> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(ExportInfo {
        format: format.to_string(),
        path: path.to_string(),
        size_bytes: meta.len(),
        modified_ms,
    })
}

/// Remote listing: one `format|size|mtime_secs|abs_path` line per export found.
fn remote_list_script(run_dir: &str) -> String {
    let pairs = FORMATS
        .iter()
        .map(|(id, file, _)| format!("{id}:{file}"))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        r#"cd "{run_dir}" 2>/dev/null || exit 0; for p in {pairs}; do n="${{p#*:}}"; if [ -f "$n" ]; then s=$(wc -c < "$n" | tr -d ' '); m=$(stat -c %Y "$n" 2>/dev/null || stat -f %m "$n" 2>/dev/null || echo 0); echo "${{p%%:*}}|$s|$m|$PWD/$n"; fi; done"#
    )
}

fn parse_remote_list(stdout: &str) -> Vec<ExportInfo> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut it = line.trim().splitn(4, '|');
            let format = it.next()?.to_string();
            let size_bytes = it.next()?.parse().ok()?;
            let secs: u64 = it.next()?.parse().unwrap_or(0);
            let path = it.next()?.to_string();
            format_entry(&format).ok()?;
            Some(ExportInfo { format, path, size_bytes, modified_ms: secs * 1000 })
        })
        .collect()
}

async fn info_for(loc: &RunLocation, format: &str) -> Result<Option<ExportInfo>, String> {
    let (_, file, _) = format_entry(format)?;
    match &loc.ssh {
        None => Ok(local_info(format, &loc.file(file))),
        Some(parts) => {
            let out = ssh_run(parts, &remote_list_script(&loc.run_dir)).await?;
            Ok(parse_remote_list(&String::from_utf8_lossy(&out.stdout))
                .into_iter()
                .find(|e| e.format == format))
        }
    }
}

/// List the exports that exist for a run.
#[command]
pub async fn list_exports(
    project_path: String,
    run_id: String,
    ssh_command: Option<String>,
) -> Result<Vec<ExportInfo>, String> {
    let loc = RunLocation::new(&project_path, &run_id, ssh_command)?;
    match &loc.ssh {
        None => Ok(FORMATS
            .iter()
            .filter_map(|(id, file, _)| local_info(id, &loc.file(file)))
            .collect()),
        Some(parts) => {
            let out = ssh_run(parts, &remote_list_script(&loc.run_dir)).await?;
            if !out.status.success() {
                return Err(format!("Could not list exports: {}", stderr_of(&out)));
            }
            Ok(parse_remote_list(&String::from_utf8_lossy(&out.stdout)))
        }
    }
}

/// Pick the checkpoint to export: newest non-`last.ckpt`, else newest of any.
fn pick_local_checkpoint(ckpt_dir: &Path) -> Option<PathBuf> {
    let mut ckpts: Vec<(PathBuf, std::time::SystemTime)> = std::fs::read_dir(ckpt_dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("ckpt"))
        .map(|p| {
            let t = std::fs::metadata(&p).and_then(|m| m.modified()).unwrap_or(UNIX_EPOCH);
            (p, t)
        })
        .collect();
    ckpts.sort_by_key(|c| std::cmp::Reverse(c.1));
    let is_last = |p: &Path| p.file_name().and_then(|n| n.to_str()) == Some("last.ckpt");
    ckpts
        .iter()
        .find(|(p, _)| !is_last(p))
        .or_else(|| ckpts.first())
        .map(|(p, _)| p.clone())
}

fn hparams_local(run_dir: &Path) -> Option<PathBuf> {
    [run_dir.join("hparams.yaml"), run_dir.join("version_0").join("hparams.yaml")]
        .into_iter()
        .find(|p| p.exists())
}

/// Build an export for a run, reusing the existing file unless `force` is set.
/// TensorRT reuses (or first builds) the ONNX export, then builds the engine.
#[command]
pub async fn export_model(
    app: AppHandle,
    project_path: String,
    run_id: String,
    task_class: Option<String>,
    ssh_command: Option<String>,
    format: String,
    force: Option<bool>,
) -> Result<ExportInfo, String> {
    let (_, target_file, _) = format_entry(&format)?;
    let loc = RunLocation::new(&project_path, &run_id, ssh_command)?;
    let force = force.unwrap_or(false);
    let tc = task_class.unwrap_or_else(|| "ImageClassifier".to_string());
    let stage = |s: &str| {
        let _ = app.emit("export-progress", ExportProgress { run_id: &run_id, format: &format, stage: s });
    };

    stage("locate");
    if !force && let Some(info) = info_for(&loc, &format).await? {
        stage("done");
        return Ok(info);
    }

    let target = loc.file(target_file);
    let onnx = loc.file("model.onnx");
    // The file the Python exporter writes: TensorRT goes through ONNX.
    let (base_path, base_module, base_label) = match format.as_str() {
        "torchscript" => (loc.file("model.pt"), "autotimm.export.export_jit", "TorchScript"),
        _ => (onnx.clone(), "autotimm.export.export_onnx", "ONNX"),
    };
    // `force` removes only the target file, so rebuilding a TensorRT engine
    // keeps an existing ONNX export.

    match &loc.ssh {
        None => {
            let run_dir = PathBuf::from(&loc.run_dir);
            if force {
                let _ = std::fs::remove_file(&target);
            }
            let venv = crate::env::venv_python(&Path::new(&loc.project_dir).join(".venv"));
            let python = if venv.exists() { venv.to_string_lossy().to_string() } else { python_cmd().to_string() };

            if !Path::new(&base_path).exists() {
                let ckpt = pick_local_checkpoint(&run_dir.join("checkpoints"))
                    .ok_or("No checkpoint found for this run. Training may not have saved a model.")?;
                stage("convert");
                let mut args = vec![
                    "-m".to_string(), base_module.to_string(),
                    "--checkpoint".to_string(), ckpt.to_string_lossy().to_string(),
                    "--output".to_string(), base_path.clone(),
                    "--task-class".to_string(), tc.clone(),
                ];
                if let Some(h) = hparams_local(&run_dir) {
                    args.push("--hparams-yaml".to_string());
                    args.push(h.to_string_lossy().to_string());
                }
                let out = tokio::process::Command::new(&python)
                    .no_window()
                    .args(&args)
                    .current_dir(&run_dir)
                    .output()
                    .await
                    .map_err(|e| format!("{base_label} export failed to start: {e}"))?;
                if !out.status.success() {
                    let _ = std::fs::remove_file(&base_path);
                    return Err(format!("{base_label} export failed: {}", stderr_of(&out)));
                }
            }

            if format == "tensorrt" {
                stage("engine");
                let out = tokio::process::Command::new(&python)
                    .no_window()
                    .args(["-m", "autotimm.flow.tensorrt_convert", "--onnx", &onnx, "--output", &target])
                    .current_dir(&run_dir)
                    .output()
                    .await
                    .map_err(|e| format!("TensorRT build failed to start: {e}"))?;
                if !out.status.success() {
                    let _ = std::fs::remove_file(&target);
                    return Err(format!(
                        "TensorRT build failed: {}. Make sure TensorRT is installed (pip install tensorrt).",
                        stderr_of(&out)
                    ));
                }
            }
        }
        Some(parts) => {
            let run_dir = &loc.run_dir;
            if force {
                ssh_run(parts, &format!(r#"rm -f "{target}""#)).await?;
            }
            let venv = format!("{}/.venv/bin/python", loc.project_dir);
            let python = format!(r#"$( [ -x "{venv}" ] && echo "{venv}" || echo python3 )"#);

            let base_exists = ssh_run(parts, &format!(r#"test -f "{base_path}" && echo yes || echo no"#)).await?;
            if String::from_utf8_lossy(&base_exists.stdout).trim() != "yes" {
                let find = format!(
                    r#"cd "{run_dir}/checkpoints" 2>/dev/null && {{ ls -t *.ckpt 2>/dev/null | grep -vx 'last.ckpt' | head -1; ls -t *.ckpt 2>/dev/null | head -1; }} | head -1"#
                );
                let out = ssh_run(parts, &find).await?;
                let ckpt = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if ckpt.is_empty() {
                    return Err("No checkpoint found for this run. Training may not have saved a model.".to_string());
                }
                stage("convert");
                let cmd = format!(
                    r#"cd "{run_dir}" && H=""; for h in hparams.yaml version_0/hparams.yaml; do [ -f "$h" ] && H="$h" && break; done; {python} -m {base_module} --checkpoint "checkpoints/{ckpt}" --output "{base_path}" --task-class "{tc}" ${{H:+--hparams-yaml "$H"}}"#
                );
                let out = ssh_run(parts, &cmd).await?;
                if !out.status.success() {
                    let _ = ssh_run(parts, &format!(r#"rm -f "{base_path}""#)).await;
                    return Err(format!("{base_label} export failed: {}", stderr_of(&out)));
                }
            }

            if format == "tensorrt" {
                stage("engine");
                let cmd = format!(
                    r#"cd "{run_dir}" && {python} -m autotimm.flow.tensorrt_convert --onnx "{onnx}" --output "{target}""#
                );
                let out = ssh_run(parts, &cmd).await?;
                if !out.status.success() {
                    let _ = ssh_run(parts, &format!(r#"rm -f "{target}""#)).await;
                    return Err(format!(
                        "TensorRT build failed: {}. Make sure TensorRT is installed on the remote machine.",
                        stderr_of(&out)
                    ));
                }
            }
        }
    }

    let info = info_for(&loc, &format)
        .await?
        .ok_or_else(|| format!("Export finished but {target_file} was not created."))?;
    stage("done");
    Ok(info)
}

/// Turn an SSH argv into scp flags + host (`-p` becomes `-P`).
fn scp_args_from_ssh(parts: &[String]) -> (Vec<String>, String) {
    let mut args = Vec::new();
    let mut host = String::new();
    let mut i = 1;
    while i < parts.len() {
        let p = parts[i].as_str();
        if matches!(p, "-p" | "-i" | "-o") && i + 1 < parts.len() {
            args.push(if p == "-p" { "-P".to_string() } else { p.to_string() });
            args.push(parts[i + 1].clone());
            i += 2;
        } else {
            host = parts[i].clone();
            i += 1;
        }
    }
    (args, host)
}

fn safe_file_stem(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() { "model".to_string() } else { s }
}

/// Copy an existing export to ~/Downloads as `<run_name><ext>`. Returns the saved path.
#[command]
pub async fn save_export(
    project_path: String,
    run_id: String,
    run_name: String,
    ssh_command: Option<String>,
    format: String,
) -> Result<String, String> {
    let (_, file, ext) = format_entry(&format)?;
    let loc = RunLocation::new(&project_path, &run_id, ssh_command)?;

    let home = home_dir().ok_or("Could not find your home folder")?;
    let downloads = PathBuf::from(home).join("Downloads");
    std::fs::create_dir_all(&downloads).map_err(|e| format!("Could not create Downloads folder: {e}"))?;
    let dest = downloads.join(format!("{}{ext}", safe_file_stem(&run_name)));
    let dest_str = dest.to_string_lossy().to_string();

    match &loc.ssh {
        None => {
            let src = loc.file(file);
            if !Path::new(&src).exists() {
                return Err("This export no longer exists. Export it again.".to_string());
            }
            std::fs::copy(&src, &dest).map_err(|e| format!("Copy failed: {e}"))?;
        }
        Some(parts) => {
            let (mut args, host) = scp_args_from_ssh(parts);
            // scp does not expand $HOME; paths relative to the login dir work instead.
            let remote = loc.file(file);
            let remote = remote.strip_prefix("$HOME/").unwrap_or(&remote).to_string();
            args.push(format!("{host}:{remote}"));
            args.push(dest_str.clone());
            let scp = if cfg!(windows) { "scp.exe" } else { "scp" };
            let out = tokio::process::Command::new(scp)
                .no_window()
                .args(&args)
                .output()
                .await
                .map_err(|e| format!("scp failed to start: {e}"))?;
            if !out.status.success() {
                return Err(format!("Download failed: {}", stderr_of(&out)));
            }
        }
    }
    Ok(dest_str)
}

/// Delete one export from the run folder.
#[command]
pub async fn delete_export(
    project_path: String,
    run_id: String,
    ssh_command: Option<String>,
    format: String,
) -> Result<(), String> {
    let (_, file, _) = format_entry(&format)?;
    let loc = RunLocation::new(&project_path, &run_id, ssh_command)?;
    let path = loc.file(file);
    match &loc.ssh {
        None => match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Could not delete {file}: {e}")),
        },
        Some(parts) => {
            let out = ssh_run(parts, &format!(r#"rm -f "{path}""#)).await?;
            if out.status.success() { Ok(()) } else { Err(format!("Could not delete {file}: {}", stderr_of(&out))) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_remote_listing() {
        let out = "torchscript|1024|1700000000|/home/u/p/logs/r1/model.pt\nbogus|1|1|/x\nonnx|2048|0|/home/u/p/logs/r1/model.onnx\n";
        let list = parse_remote_list(out);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].format, "torchscript");
        assert_eq!(list[0].size_bytes, 1024);
        assert_eq!(list[0].modified_ms, 1_700_000_000_000);
        assert_eq!(list[1].path, "/home/u/p/logs/r1/model.onnx");
    }

    #[test]
    fn remote_paths_expand_home() {
        let loc = RunLocation::new("~/proj/", "r1", Some("ssh -p 2222 me@box".into())).unwrap();
        assert_eq!(loc.run_dir, "$HOME/proj/logs/r1");
        assert_eq!(loc.file("model.pt"), "$HOME/proj/logs/r1/model.pt");
    }

    #[test]
    fn rejects_path_like_run_ids() {
        assert!(RunLocation::new("/p", "../etc", None).is_err());
        assert!(RunLocation::new("/p", "a/b", None).is_err());
    }

    #[test]
    fn scp_args_convert_port_flag() {
        let parts: Vec<String> = "ssh -p 2222 -i key me@box".split(' ').map(String::from).collect();
        let (args, host) = scp_args_from_ssh(&parts);
        assert_eq!(args, vec!["-P", "2222", "-i", "key"]);
        assert_eq!(host, "me@box");
    }

    #[test]
    fn sanitizes_file_names() {
        assert_eq!(safe_file_stem("run/1:a"), "run_1_a");
        assert_eq!(safe_file_stem("  "), "model");
    }
}
