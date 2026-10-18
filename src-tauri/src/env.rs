use std::collections::HashMap;
use tauri::command;

use crate::expand_tilde;
use crate::{default_shell, home_dir};
use crate::{StdCommandNoWindow, TokioCommandNoWindow};

/// Returns the correct Python path inside a venv (Scripts/python.exe on Windows,
/// bin/python on Unix).
pub fn venv_python(venv_path: &std::path::Path) -> std::path::PathBuf {
    if cfg!(windows) {
        venv_path.join("Scripts").join("python.exe")
    } else {
        venv_path.join("bin").join("python")
    }
}

/// Returns `"python"` on Windows, `"python3"` on Unix.
pub fn python_cmd() -> &'static str {
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct EnvSetupResult {
    status: String,
    message: String,
    python_version: Option<String>,
    autotimm_version: Option<String>,
    env_type: Option<String>,
    /// Set when sync kept going but something needs the user's attention,
    /// e.g. AutoTimm couldn't be reinstalled and the previous version is in use.
    #[serde(default)]
    warning: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct UvStatus {
    installed: bool,
    version: Option<String>,
    message: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CondaStatus {
    installed: bool,
    version: Option<String>,
    message: String,
}

/// Find the `conda` binary, checking CONDA_EXE env var, PATH, common install
/// locations, and finally asking a login shell (handles GUI-launched apps that
/// don't inherit shell env vars).
pub fn find_conda() -> Option<String> {
    if let Ok(conda_exe) = std::env::var("CONDA_EXE")
        && !conda_exe.is_empty()
        && let Ok(output) = std::process::Command::new(&conda_exe)
            .no_window()
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
        && output.success()
    {
        return Some(conda_exe);
    }

    let home = home_dir().unwrap_or_default();
    let mut candidates = vec![
        "conda".to_string(),
        format!("{}/miniconda3/condabin/conda", home),
        format!("{}/miniconda3/bin/conda", home),
        format!("{}/anaconda3/condabin/conda", home),
        format!("{}/anaconda3/bin/conda", home),
        format!("{}/miniforge3/condabin/conda", home),
        format!("{}/miniforge3/bin/conda", home),
        format!("{}/mambaforge/condabin/conda", home),
        format!("{}/mambaforge/bin/conda", home),
        "/opt/homebrew/bin/conda".to_string(),
        "/opt/homebrew/Caskroom/miniconda/base/bin/conda".to_string(),
        "/opt/homebrew/Caskroom/miniconda/base/condabin/conda".to_string(),
        "/usr/local/bin/conda".to_string(),
    ];
    if cfg!(windows) {
        candidates.extend([
            format!(r"{}\miniconda3\Scripts\conda.exe", home),
            format!(r"{}\anaconda3\Scripts\conda.exe", home),
            r"C:\ProgramData\miniconda3\Scripts\conda.exe".to_string(),
        ]);
    }
    let candidates = candidates;

    for path in &candidates {
        if let Ok(output) = std::process::Command::new(path)
            .no_window()
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            && output.success()
        {
            return Some(path.clone());
        }
    }

    // Last resort: ask a login shell for CONDA_EXE (not applicable on Windows)
    if !cfg!(windows) {
        let shell = default_shell();
        if let Ok(output) = std::process::Command::new(&shell)
            .no_window()
            .args(["-l", "-c", "echo $CONDA_EXE"])
            .output()
            && output.status.success()
        {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty()
                && let Ok(check) = std::process::Command::new(&path)
                    .no_window()
                    .arg("--version")
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                && check.success()
            {
                return Some(path);
            }
        }
    }

    None
}

/// Find the `uv` binary, checking PATH and common install locations.
pub fn find_uv() -> Option<String> {
    let candidates = ["uv".to_string()];
    let home = home_dir().unwrap_or_default();
    let extra = if cfg!(windows) {
        // Where uv lands on Windows. The app's own PATH isn't refreshed after an
        // install, so probe the usual locations directly:
        // - a custom UV_INSTALL_DIR / XDG_BIN_HOME
        // - the standalone installer (%USERPROFILE%\.local\bin, older: .cargo\bin)
        // - winget's links folder and Scoop's shims
        let env_dir = |var: &str| std::env::var(var).ok().filter(|v| !v.is_empty());
        let mut paths = Vec::new();
        for dir in [env_dir("UV_INSTALL_DIR"), env_dir("XDG_BIN_HOME")].into_iter().flatten() {
            paths.push(format!(r"{}\uv.exe", dir));
        }
        paths.push(format!(r"{}\.local\bin\uv.exe", home));
        paths.push(format!(r"{}\.cargo\bin\uv.exe", home));
        if let Some(local) = env_dir("LOCALAPPDATA") {
            paths.push(format!(r"{}\Microsoft\WinGet\Links\uv.exe", local));
        }
        paths.push(format!(r"{}\scoop\shims\uv.exe", home));
        paths
    } else {
        vec![
            format!("{}/.local/bin/uv", home),
            format!("{}/.cargo/bin/uv", home),
        ]
    };

    for path in candidates.iter().chain(extra.iter()) {
        if let Ok(output) = std::process::Command::new(path)
            .no_window()
            .arg("--version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            && output.success()
        {
            return Some(path.clone());
        }
    }
    None
}

/// Ensure `uv` is installed locally; if missing, install via the official script.
/// Returns the path to the `uv` binary.
async fn ensure_uv_available() -> Result<String, String> {
    if let Some(path) = find_uv() {
        return Ok(path);
    }

    let install = if cfg!(windows) {
        // Astral's official installer (per-user, no admin). Force TLS 1.2 for
        // older Windows PowerShell defaults and hide the progress bar, which
        // otherwise slows Invoke-RestMethod down badly. Give up after 5 minutes
        // rather than leaving sync stuck.
        let script = "[Net.ServicePointManager]::SecurityProtocol = \
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; \
            $ProgressPreference = 'SilentlyContinue'; \
            irm https://astral.sh/uv/install.ps1 | iex";
        let run = tokio::process::Command::new("powershell")
            .no_window()
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "ByPass", "-Command", script])
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output();
        match tokio::time::timeout(std::time::Duration::from_secs(300), run).await {
            Ok(result) => result.map_err(|e| format!("Failed to run uv installer: {}", e))?,
            Err(_) => return Err("uv installation timed out after 5 minutes".to_string()),
        }
    } else {
        tokio::process::Command::new("sh")
            .no_window()
            .args(["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"])
            .output()
            .await
            .map_err(|e| format!("Failed to run uv installer: {}", e))?
    };

    if !install.status.success() {
        let stderr = String::from_utf8_lossy(&install.stderr).to_string();
        return Err(format!("uv installation failed: {}", stderr));
    }

    // find_uv() re-checks PATH and known locations. On Windows the installer
    // places uv in %USERPROFILE%\.local\bin which find_uv() probes directly,
    // so it works even though the current process PATH hasn't been updated.
    find_uv().ok_or_else(|| "uv was installed but could not be found on PATH".to_string())
}

#[command]
pub async fn ensure_uv() -> Result<UvStatus, String> {
    let uv_bin = match ensure_uv_available().await {
        Ok(path) => path,
        Err(e) => {
            return Ok(UvStatus {
                installed: false,
                version: None,
                message: e,
            });
        }
    };

    let version = tokio::process::Command::new(&uv_bin)
        .no_window()
        .arg("--version")
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    Ok(UvStatus {
        installed: true,
        version,
        message: "uv is available".to_string(),
    })
}

#[command]
pub async fn ssh_ensure_uv(ssh_command: String) -> Result<UvStatus, String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty SSH command".to_string());
    }

    let script = r#"export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"; \
if command -v uv >/dev/null 2>&1; then \
  VER=$(uv --version 2>/dev/null); \
  echo "{\"installed\":true,\"version\":\"$VER\",\"message\":\"uv is available\"}"; \
else \
  INSTALL_ERR=$(curl -LsSf https://astral.sh/uv/install.sh | sh 2>&1); \
  if [ $? -ne 0 ]; then \
    echo "{\"installed\":false,\"version\":null,\"message\":\"uv installation failed\"}"; \
    exit 0; \
  fi; \
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"; \
  VER=$(uv --version 2>/dev/null); \
  echo "{\"installed\":true,\"version\":\"$VER\",\"message\":\"uv was installed\"}"; \
fi"#;

    let mut cmd = tokio::process::Command::new(&parts[0]);
    cmd.no_window();
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
    for arg in &parts[1..] {
        cmd.arg(arg);
    }
    cmd.arg(script);
    cmd.kill_on_drop(true);

    match tokio::time::timeout(std::time::Duration::from_secs(60), cmd.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() || !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Ok(UvStatus {
                    installed: false,
                    version: None,
                    message: format!("SSH uv check failed: {}", stderr),
                });
            }
            serde_json::from_str::<UvStatus>(&stdout)
                .map_err(|e| format!("Failed to parse uv status: {} (raw: {})", e, stdout))
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Ok(UvStatus {
            installed: false,
            version: None,
            message: "SSH uv check timed out".to_string(),
        }),
    }
}

/// Get the full environment from a login shell.
/// On Windows, there is no login shell concept — return the current process env.
pub async fn get_shell_env() -> HashMap<String, String> {
    if cfg!(windows) {
        return std::env::vars().collect();
    }

    let shell = default_shell();
    let output = tokio::process::Command::new(&shell)
        .no_window()
        .args(["-l", "-i", "-c", "env"])
        .stderr(std::process::Stdio::null())
        .output()
        .await;

    let mut env_map = HashMap::new();
    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            if let Some((key, val)) = line.split_once('=') {
                env_map.insert(key.to_string(), val.to_string());
            }
        }
    }
    env_map
}

/// Resolve conda path asynchronously — tries find_conda() first, then falls
/// back to asking a login shell (handles GUI-launched apps).
/// On Windows, the login shell fallback is skipped.
pub async fn resolve_conda_path() -> Option<String> {
    if let Some(path) = find_conda() {
        return Some(path);
    }

    if !cfg!(windows) {
        let shell = default_shell();
        if let Ok(output) = tokio::process::Command::new(&shell)
            .no_window()
            .args(["-l", "-i", "-c", "echo $CONDA_EXE"])
            .output()
            .await
            && output.status.success()
        {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    None
}

#[command]
pub async fn check_conda() -> Result<CondaStatus, String> {
    let conda_bin = match resolve_conda_path().await {
        Some(path) => path,
        None => {
            return Ok(CondaStatus {
                installed: false,
                version: None,
                message: "conda not found".to_string(),
            });
        }
    };

    let version = tokio::process::Command::new(&conda_bin)
        .no_window()
        .arg("--version")
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    Ok(CondaStatus {
        installed: true,
        version,
        message: "conda is available".to_string(),
    })
}

#[command]
pub async fn ssh_check_conda(ssh_command: String) -> Result<CondaStatus, String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty SSH command".to_string());
    }

    let script = r#"find_conda() {
  # 1. Check CONDA_EXE if already set
  if [ -n "$CONDA_EXE" ] && [ -x "$CONDA_EXE" ]; then echo "$CONDA_EXE"; return 0; fi
  # 2. Source shell profile to pick up conda init
  for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc"; do
    if [ -f "$rc" ]; then . "$rc" >/dev/null 2>&1; fi
  done
  if [ -n "$CONDA_EXE" ] && [ -x "$CONDA_EXE" ]; then echo "$CONDA_EXE"; return 0; fi
  # 3. Check common install paths
  for p in \
    "$HOME/miniconda3/bin/conda" "$HOME/miniconda3/condabin/conda" \
    "$HOME/anaconda3/bin/conda" "$HOME/anaconda3/condabin/conda" \
    "$HOME/miniforge3/bin/conda" "$HOME/miniforge3/condabin/conda" \
    "$HOME/mambaforge/bin/conda" "$HOME/mambaforge/condabin/conda" \
    "/opt/conda/bin/conda" "/usr/local/bin/conda"; do
    if [ -x "$p" ]; then echo "$p"; return 0; fi
  done
  return 1
}
CONDA_BIN=$(find_conda)
if [ -n "$CONDA_BIN" ]; then
  VER=$("$CONDA_BIN" --version 2>/dev/null)
  echo "{\"installed\":true,\"version\":\"$VER\",\"message\":\"conda is available\"}"
else
  echo "{\"installed\":false,\"version\":null,\"message\":\"conda not found\"}"
fi"#;

    let mut cmd = tokio::process::Command::new(&parts[0]);
    cmd.no_window();
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
    for arg in &parts[1..] {
        cmd.arg(arg);
    }
    cmd.arg(script);
    cmd.kill_on_drop(true);

    match tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() || !output.status.success() {
                return Ok(CondaStatus {
                    installed: false,
                    version: None,
                    message: "SSH conda check failed".to_string(),
                });
            }
            serde_json::from_str::<CondaStatus>(&stdout)
                .map_err(|e| format!("Failed to parse conda status: {} (raw: {})", e, stdout))
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Ok(CondaStatus {
            installed: false,
            version: None,
            message: "SSH conda check timed out".to_string(),
        }),
    }
}

/// Query Python and autotimm versions from an existing venv.
async fn get_venv_versions(venv_path: &std::path::Path) -> (Option<String>, Option<String>) {
    let python = venv_python(venv_path);

    let py_ver = tokio::process::Command::new(&python)
        .no_window()
        .args(["--version"])
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .trim_start_matches("Python ")
                .to_string()
        });

    let at_ver = tokio::process::Command::new(&python)
        .no_window()
        .args(["-c", "import autotimm; print(autotimm.__version__)"])
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

    (py_ver, at_ver)
}

/// Reinstall the latest AutoTimm into an existing environment. Only AutoTimm
/// is forced; its dependencies (PyTorch etc.) are upgraded only if the new
/// version needs them, so a resync doesn't re-download gigabytes.
async fn reinstall_autotimm(project_dir: &str, venv_path: &std::path::Path) -> Result<(), String> {
    let venv_py = venv_python(venv_path).to_string_lossy().to_string();
    let uv_bin = ensure_uv_available().await?;

    // Refresh the index so a just-published release is seen, then upgrade and
    // reinstall only the autotimm package.
    let out = tokio::process::Command::new(&uv_bin)
        .no_window()
        .args([
            "pip", "install", "autotimm[all]",
            "--upgrade-package", "autotimm",
            "--reinstall-package", "autotimm",
            "--refresh-package", "autotimm",
            "--python", &venv_py,
        ])
        .current_dir(project_dir)
        .output()
        .await
        .map_err(|e| format!("could not run uv: {}", e))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[command]
pub async fn setup_python_env(project_path: String) -> Result<EnvSetupResult, String> {
    let expanded = expand_tilde(&project_path);
    let venv_path = std::path::PathBuf::from(&expanded).join(".venv");

    // Older NightFlow builds made conda environments. Rebuild those with uv so
    // every project uses the same, faster setup.
    let replacing_conda = venv_path.join("conda-meta").is_dir();
    if replacing_conda {
        let _ = std::fs::remove_dir_all(&venv_path);
    }

    // 1. A project-local .venv exists: keep the environment, but reinstall the
    //    latest AutoTimm on every sync so a resync never reuses an old version.
    if venv_path.exists() {
        let detected_env_type = "uv";

        let (_, previous) = get_venv_versions(&venv_path).await;
        let install = reinstall_autotimm(&expanded, &venv_path).await;
        let (python_version, autotimm_version) = get_venv_versions(&venv_path).await;

        return Ok(match (install, autotimm_version) {
            (Ok(()), Some(current)) => EnvSetupResult {
                status: "exists".to_string(),
                message: match previous {
                    Some(prev) if prev != current => format!("Reinstalled autotimm {} (was {})", current, prev),
                    _ => format!("Reinstalled autotimm {}", current),
                },
                python_version,
                autotimm_version: Some(current),
                env_type: Some(detected_env_type.to_string()),
                warning: None,
            },
            // Install failed but an earlier AutoTimm still imports: keep going, say so.
            (Err(err), Some(current)) => EnvSetupResult {
                status: "exists".to_string(),
                message: format!("Using existing autotimm {}", current),
                python_version,
                autotimm_version: Some(current.clone()),
                env_type: Some(detected_env_type.to_string()),
                warning: Some(format!("Could not reinstall autotimm, so the existing {} is still in use: {}", current, err)),
            },
            (result, None) => EnvSetupResult {
                status: "error".to_string(),
                message: match result {
                    Err(err) => format!("Failed to install autotimm: {}", err),
                    Ok(()) => "autotimm installed but could not be imported".to_string(),
                },
                python_version,
                autotimm_version: None,
                env_type: Some(detected_env_type.to_string()),
                warning: None,
            },
        });
    }

    // 2. No project env yet: always create one with uv, even if the system
    //    Python already has AutoTimm or conda is installed. uv fetches its own
    //    Python 3.12 and installs packages far faster than conda + pip.
    if venv_path.exists() {
        let _ = std::fs::remove_dir_all(&venv_path);
    }

    // Install uv first if it's missing (sync normally already did).
    let uv_bin = match ensure_uv_available().await {
        Ok(path) => path,
        Err(err) => {
            return Ok(EnvSetupResult {
                status: "error".to_string(),
                message: format!("uv is required to create the Python environment: {}", err),
                python_version: None,
                autotimm_version: None,
                env_type: None,
                warning: None,
            });
        }
    };

    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        tokio::process::Command::new(&uv_bin)
            .no_window()
            .args(["python", "install", "3.12"])
            .output(),
    )
    .await;

    let uv_args = vec![
        "venv".to_string(),
        ".venv".to_string(),
        "--python".to_string(),
        "3.12".to_string(),
    ];

    let venv_output = tokio::process::Command::new(&uv_bin)
        .no_window()
        .args(&uv_args)
        .current_dir(&expanded)
        .output()
        .await
        .map_err(|e| format!("Failed to run uv venv: {}", e))?;

    if !venv_output.status.success() {
        let stderr = String::from_utf8_lossy(&venv_output.stderr).to_string();
        let _ = std::fs::remove_dir_all(&venv_path);
        return Ok(EnvSetupResult {
            status: "error".to_string(),
            message: format!("Failed to create venv: {}", stderr),
            python_version: None,
            autotimm_version: None,
            env_type: None,
            warning: None,
        });
    }

    let final_venv_py = venv_python(&venv_path);
    let final_venv_py_str = final_venv_py.to_string_lossy().to_string();
    let install_output = tokio::process::Command::new(&uv_bin)
        .no_window()
        .args(["pip", "install", "--upgrade", "--refresh-package", "autotimm", "autotimm[all]", "--python", &final_venv_py_str])
        .current_dir(&expanded)
        .output()
        .await
        .map_err(|e| format!("Failed to run pip install: {}", e))?;

    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr).to_string();
        return Ok(EnvSetupResult {
            status: "error".to_string(),
            message: format!("Failed to install dependencies: {}", stderr),
            python_version: None,
            autotimm_version: None,
            env_type: None,
            warning: None,
        });
    }

    let (python_version, autotimm_version) = get_venv_versions(&venv_path).await;
    Ok(EnvSetupResult {
        status: "created".to_string(),
        message: if replacing_conda {
            "Replaced the old conda environment with a uv one and installed dependencies".to_string()
        } else {
            "Virtual environment created with uv and dependencies installed".to_string()
        },
        python_version,
        autotimm_version,
        env_type: Some("uv".to_string()),
        warning: None,
    })
}

#[command]
pub async fn ssh_setup_python_env(
    ssh_command: String,
    project_path: String,
) -> Result<EnvSetupResult, String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty SSH command".to_string());
    }

    let remote_path = if let Some(stripped) = project_path.strip_prefix("~/") {
        format!("$HOME/{}", stripped)
    } else if project_path == "~" {
        "$HOME".to_string()
    } else {
        project_path.clone()
    };

    let script = format!(
        r#"export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
cd "{path}" || exit 1
ej() {{ printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g' | tr '\n' ' '; }}
jout() {{
  local s="$1" m="$2" pv="$3" av="$4" w="$5"
  m=$(ej "$m")
  [ -n "$pv" ] && pv="\"$pv\"" || pv=null
  [ -n "$av" ] && av="\"$av\"" || av=null
  [ -n "$w" ] && w="\"$(ej "$w")\"" || w=null
  printf '{{"status":"%s","message":"%s","python_version":%s,"autotimm_version":%s,"warning":%s}}\n' "$s" "$m" "$pv" "$av" "$w"
}}
# Older NightFlow builds made conda environments; rebuild those with uv.
REPLACED_CONDA=""
if [ -d .venv/conda-meta ]; then rm -rf .venv; REPLACED_CONDA=1; fi
if [ -d .venv ]; then
  # Keep the environment, but reinstall the latest AutoTimm on every sync.
  # Only AutoTimm is forced; dependencies upgrade only if it needs them.
  PV=$(.venv/bin/python --version 2>/dev/null | sed 's/Python //')
  OLD_AV=$(.venv/bin/python -c "import autotimm; print(autotimm.__version__)" 2>/dev/null)
  if command -v uv >/dev/null 2>&1; then
    INSTALL_ERR=$(uv pip install 'autotimm[all]' --upgrade-package autotimm --reinstall-package autotimm --refresh-package autotimm --python .venv/bin/python 2>&1)
    RC=$?
  else
    INSTALL_ERR="uv not found"; RC=1
  fi
  AV=$(.venv/bin/python -c "import autotimm; print(autotimm.__version__)" 2>/dev/null)
  if [ -z "$AV" ]; then
    jout error "Failed to install autotimm: $INSTALL_ERR" "$PV" ""
  elif [ $RC -ne 0 ]; then
    jout exists "Using existing autotimm $AV" "$PV" "$AV" "Could not reinstall autotimm, so the existing $AV is still in use: $INSTALL_ERR"
  elif [ -n "$OLD_AV" ] && [ "$OLD_AV" != "$AV" ]; then
    jout exists "Reinstalled autotimm $AV (was $OLD_AV)" "$PV" "$AV"
  else
    jout exists "Reinstalled autotimm $AV" "$PV" "$AV"
  fi
else
  # No project env yet: always create one with uv, even if the system Python
  # has AutoTimm or conda is installed. uv fetches its own Python 3.12.
  rm -rf .venv 2>/dev/null
  if ! command -v uv >/dev/null 2>&1; then
    jout error "uv is required to create the Python environment but was not found on the remote machine" "" ""
    exit 0
  fi
  VENV_ERR=$(uv venv .venv --python 3.12 2>&1)
  if [ $? -ne 0 ]; then
    rm -rf .venv 2>/dev/null
    jout error "Failed to create venv: $VENV_ERR" "" ""
    exit 0
  fi
  PIP_ERR=$(uv pip install --upgrade --refresh-package autotimm 'autotimm[all]' --python .venv/bin/python 2>&1)
  if [ $? -ne 0 ]; then
    jout error "Failed to install dependencies: $PIP_ERR" "" ""
    exit 0
  fi
  PV=$(.venv/bin/python --version 2>/dev/null | sed 's/Python //')
  AV=$(.venv/bin/python -c "import autotimm; print(autotimm.__version__)" 2>/dev/null)
  if [ -n "$REPLACED_CONDA" ]; then
    jout created "Replaced the old conda environment with a uv one and installed dependencies" "$PV" "$AV"
  else
    jout created "Virtual environment created with uv and dependencies installed" "$PV" "$AV"
  fi
fi"#,
        path = remote_path.replace('"', "\\\"")
    );

    let mut cmd = tokio::process::Command::new(&parts[0]);
    cmd.no_window();
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
    for arg in &parts[1..] {
        cmd.arg(arg);
    }
    cmd.arg(script);
    cmd.kill_on_drop(true);

    match tokio::time::timeout(std::time::Duration::from_secs(1200), cmd.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() || !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Ok(EnvSetupResult {
                    status: "error".to_string(),
                    message: format!("SSH env setup failed: {}", stderr),
                    python_version: None,
                    autotimm_version: None,
                    env_type: None,
                    warning: None,
                });
            }
            serde_json::from_str::<EnvSetupResult>(&stdout)
                .map_err(|e| format!("Failed to parse env setup output: {} (raw: {})", e, stdout))
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Ok(EnvSetupResult {
            status: "error".to_string(),
            message: "SSH env setup timed out (1200s)".to_string(),
            python_version: None,
            autotimm_version: None,
            env_type: None,
            warning: None,
        }),
    }
}
