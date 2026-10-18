// Detailed sync output: every command sync runs, and each line it prints, is
// sent to the frontend as a `sync-log` event so the Sync screen's log shows what
// is actually happening instead of only high-level steps.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::TokioCommandNoWindow;

/// Lines kept from a command's output to explain a failure.
const TAIL_LINES: usize = 30;

#[derive(Clone, serde::Serialize)]
struct SyncLogLine {
    /// Project the line belongs to, so concurrent syncs don't mix (None = current sync).
    project_path: Option<String>,
    /// "cmd" for the command being run, "out" for its output, "note" for a decision.
    kind: &'static str,
    line: String,
}

/// Emits detailed sync log lines for one project.
#[derive(Clone)]
pub struct SyncLog {
    app: Option<AppHandle>,
    project_path: Option<String>,
}

impl SyncLog {
    pub fn new(app: &AppHandle, project_path: Option<&str>) -> Self {
        Self { app: Some(app.clone()), project_path: project_path.map(str::to_string) }
    }

    fn emit(&self, kind: &'static str, line: impl Into<String>) {
        if let Some(app) = &self.app {
            let _ = app.emit(
                "sync-log",
                SyncLogLine { project_path: self.project_path.clone(), kind, line: line.into() },
            );
        }
    }

    /// A decision or fact worth showing, e.g. "Found an existing .venv".
    pub fn note(&self, line: impl Into<String>) {
        self.emit("note", line);
    }

    /// One line of command output.
    pub fn out(&self, line: impl Into<String>) {
        let line = line.into();
        if !line.trim().is_empty() {
            self.emit("out", line);
        }
    }

    /// Run a command, streaming stdout and stderr to the log line by line.
    /// Returns whether it succeeded and the last lines of its output.
    pub async fn run(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&str>,
    ) -> Result<(bool, String), String> {
        self.emit("cmd", format!("$ {} {}", program, args.join(" ")));

        let mut cmd = tokio::process::Command::new(program);
        cmd.no_window()
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        let mut child = cmd.spawn().map_err(|e| format!("could not run {}: {}", program, e))?;

        let tail: Arc<Mutex<VecDeque<String>>> = Arc::new(Mutex::new(VecDeque::new()));
        let pump = |stream: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>| {
            let log = self.clone();
            let tail = Arc::clone(&tail);
            tokio::spawn(async move {
                let Some(stream) = stream else { return };
                let mut lines = BufReader::new(stream).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log.out(line.clone());
                    if let Ok(mut t) = tail.lock() {
                        t.push_back(line);
                        if t.len() > TAIL_LINES {
                            t.pop_front();
                        }
                    }
                }
            })
        };
        let out_task = pump(child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>));
        let err_task = pump(child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>));

        let status = child.wait().await.map_err(|e| format!("{} failed: {}", program, e))?;
        let _ = out_task.await;
        let _ = err_task.await;

        let tail = tail.lock().map(|t| t.iter().cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default();
        if !status.success() {
            self.note(format!("{} exited with {}", program, status));
        }
        Ok((status.success(), tail))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn run_captures_stdout_and_stderr_and_reports_failure() {
        tauri::async_runtime::block_on(async {
            let log = SyncLog { app: None, project_path: None };
            let (ok, tail) = log.run("sh", &["-c", "echo first; echo second >&2; exit 3"], None).await.unwrap();
            assert!(!ok);
            assert!(tail.contains("first") && tail.contains("second"), "{tail}");

            let (ok, _) = log.run("sh", &["-c", "true"], None).await.unwrap();
            assert!(ok);
        });
    }
}
