// Self-update for macOS. NightFlow is ad-hoc signed (not notarized), so updates
// are delivered as GitHub-release DMGs and installed by scripts/nightflow-update.sh,
// which also clears the Gatekeeper quarantine flag on the freshly installed bundle.
//
// Flow when the user clicks "Update":
//   1. check_for_update()  -> ask GitHub for the latest version.
//   2. install_update()    -> write the embedded installer to a temp file, spawn it
//      detached with our own pid so it waits for us to quit, then exit the app.
//      The detached script replaces /Applications/NightFlow.app and relaunches it.

use std::io::Write;
use std::process::Command;

// The installer scripts are compiled into the binary; no runtime download needed.
#[cfg(target_os = "macos")]
const INSTALLER: &str = include_str!("../../scripts/nightflow-update.sh");
#[cfg(target_os = "windows")]
const INSTALLER_PS1: &str = include_str!("../../scripts/nightflow-update.ps1");
#[cfg(target_os = "linux")]
const INSTALLER_LINUX: &str = include_str!("../../scripts/nightflow-update.sh");

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
}

/// Ask GitHub for the latest release tag and compare with the running version.
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let repo = option_env!("NIGHTFLOW_REPO").unwrap_or("Noctillio-Ai/NightFlow");
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");

    // Use the system curl so we don't pull in an HTTP crate.
    let out = Command::new("curl")
        .args(["-fsSL", "-H", "User-Agent: NightFlow", &url])
        .output()
        .map_err(|e| format!("failed to run curl: {e}"))?;
    if !out.status.success() {
        return Err("could not reach GitHub".into());
    }
    let body = String::from_utf8_lossy(&out.stdout);
    // Minimal extraction of "tag_name": "vX.Y.Z" without a JSON dependency.
    let latest = body
        .split("\"tag_name\"")
        .nth(1)
        .and_then(|s| s.split('"').nth(1))
        .map(|t| t.trim_start_matches('v').to_string())
        .ok_or("no release found")?;

    let available = latest != current;
    Ok(UpdateInfo { current, latest, available })
}

/// Write the embedded installer to a temp file, launch it detached (it waits for
/// this process to quit), then exit so the app bundle can be replaced.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, version: Option<String>) -> Result<(), String> {
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (app, version);
        return Err("in-app update is not supported on this platform".into());
    }

    #[cfg(target_os = "macos")]
    {
        let dir = std::env::temp_dir();
        let script = dir.join("nightflow-update.sh");
        {
            let mut f = std::fs::File::create(&script)
                .map_err(|e| format!("cannot write installer: {e}"))?;
            f.write_all(INSTALLER.as_bytes())
                .map_err(|e| format!("cannot write installer: {e}"))?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("cannot chmod installer: {e}"))?;
        }

        let pid = std::process::id().to_string();
        let mut args: Vec<String> = vec![
            script.to_string_lossy().into_owned(),
            "--yes".into(),
            "--relaunch".into(),
            "--wait-pid".into(),
            pid,
        ];
        if let Some(v) = version {
            args.push("--version".into());
            args.push(v);
        }

        // Detach: new session, stdio to the log, so it outlives the quitting app.
        let log = std::fs::File::create(dir.join("nightflow-update.log")).ok();
        let mut cmd = Command::new("/bin/bash");
        cmd.args(&args);
        if let Some(l) = log {
            let l2 = l.try_clone().ok();
            cmd.stdout(std::process::Stdio::from(l));
            if let Some(l2) = l2 {
                cmd.stderr(std::process::Stdio::from(l2));
            }
        }
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // detach into its own group so it survives app exit
        cmd.spawn().map_err(|e| format!("could not start installer: {e}"))?;

        // Give the installer a moment to start waiting, then quit so it can proceed.
        std::thread::sleep(std::time::Duration::from_millis(300));
        app.exit(0);
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
        let dir = std::env::temp_dir();
        let script = dir.join("nightflow-update.ps1");
        std::fs::write(&script, INSTALLER_PS1)
            .map_err(|e| format!("cannot write installer: {e}"))?;

        let pid = std::process::id().to_string();
        let mut args: Vec<String> = vec![
            "-NoProfile".into(),
            "-ExecutionPolicy".into(),
            "Bypass".into(),
            "-File".into(),
            script.to_string_lossy().into_owned(),
            "-WaitPid".into(),
            pid,
            "-Relaunch".into(),
            "-Yes".into(),
        ];
        if let Some(v) = version {
            args.push("-Version".into());
            args.push(v);
        }

        // Detach so the updater outlives the quitting app:
        //   CREATE_NO_WINDOW (0x08000000) | CREATE_NEW_PROCESS_GROUP (0x00000200)
        use std::os::windows::process::CommandExt;
        Command::new("powershell.exe")
            .args(&args)
            .creation_flags(0x0800_0000 | 0x0000_0200)
            .spawn()
            .map_err(|e| format!("could not start installer: {e}"))?;

        // Give the installer a moment to start waiting, then quit so it can proceed.
        std::thread::sleep(std::time::Duration::from_millis(300));
        app.exit(0);
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let dir = std::env::temp_dir();
        let script = dir.join("nightflow-update.sh");
        {
            let mut f = std::fs::File::create(&script)
                .map_err(|e| format!("cannot write installer: {e}"))?;
            f.write_all(INSTALLER_LINUX.as_bytes())
                .map_err(|e| format!("cannot write installer: {e}"))?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("cannot chmod installer: {e}"))?;
        }

        let pid = std::process::id().to_string();
        let mut args: Vec<String> = vec![
            script.to_string_lossy().into_owned(),
            "--yes".into(),
            "--relaunch".into(),
            "--wait-pid".into(),
            pid,
        ];
        if let Some(v) = version {
            args.push("--version".into());
            args.push(v);
        }

        // Detach: own process group, stdio to a log, so it outlives the app exit.
        let log = std::fs::File::create(dir.join("nightflow-update.log")).ok();
        let mut cmd = Command::new("/bin/bash");
        cmd.args(&args);
        if let Some(l) = log {
            let l2 = l.try_clone().ok();
            cmd.stdout(std::process::Stdio::from(l));
            if let Some(l2) = l2 {
                cmd.stderr(std::process::Stdio::from(l2));
            }
        }
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
        cmd.spawn().map_err(|e| format!("could not start installer: {e}"))?;

        // Give the installer a moment to start, then quit so it can relaunch us.
        std::thread::sleep(std::time::Duration::from_millis(300));
        app.exit(0);
        Ok(())
    }
}
