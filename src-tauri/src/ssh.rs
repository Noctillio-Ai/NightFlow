use tauri::command;

use crate::{expand_tilde, home_dir};
use crate::TokioCommandNoWindow;

// ── SSH keys ─────────────────────────────────────────────────────────────────
//
// NightFlow only uses the keys the user adds (frontend: state/sshKeys.js). A
// project that picks a key gets `-i <path> -o IdentitiesOnly=yes` in its SSH
// command, so every ssh/scp call offers exactly that key.
//
// Only the first line of a private key is read, to recognise its format. Key
// material never leaves the file; fingerprints come from ssh-keygen and are
// taken from the .pub (or the unencrypted public half of an OpenSSH key), so
// no passphrase is ever asked for.

#[derive(serde::Serialize, Debug)]
pub struct SshKeyInfo {
    /// Absolute path of the private key.
    pub path: String,
    /// File name, e.g. "id_ed25519".
    pub name: String,
    /// "ED25519", "RSA", … (from ssh-keygen), or the PEM label as a fallback.
    pub key_type: String,
    /// "SHA256:…" when it could be computed without a passphrase.
    pub fingerprint: Option<String>,
    pub bits: Option<u32>,
    pub comment: Option<String>,
    pub has_public: bool,
    /// Something that will stop ssh from using the key, e.g. loose permissions.
    pub warning: Option<String>,
}

/// PEM label of a private key ("OPENSSH", "RSA", "EC", …), or None if the file
/// doesn't start like one. Reads at most the first 256 bytes.
fn private_key_label(path: &std::path::Path) -> Option<String> {
    use std::io::Read;
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > 64 * 1024 {
        return None;
    }
    let mut head = [0u8; 256];
    let n = std::fs::File::open(path).ok()?.read(&mut head).ok()?;
    let text = std::str::from_utf8(&head[..n]).ok()?;
    let line = text.lines().next()?.trim();
    let label = line
        .strip_prefix("-----BEGIN ")?
        .strip_suffix("PRIVATE KEY-----")?
        .trim();
    Some(if label.is_empty() { "PKCS8".to_string() } else { label.to_string() })
}

#[cfg(unix)]
fn permission_warning(path: &std::path::Path) -> Option<String> {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(path).ok()?.permissions().mode();
    if mode & 0o077 != 0 {
        Some(format!(
            "Permissions {:o} are too open; ssh will refuse this key. Run: chmod 600 {}",
            mode & 0o777,
            path.display()
        ))
    } else {
        None
    }
}
#[cfg(not(unix))]
fn permission_warning(_path: &std::path::Path) -> Option<String> {
    None
}

/// `ssh-keygen -l -f <file>` → (bits, "SHA256:…", comment, "ED25519").
async fn keygen_fingerprint(file: &std::path::Path) -> Option<(u32, String, String, String)> {
    let mut cmd = tokio::process::Command::new("ssh-keygen");
    cmd.no_window();
    cmd.arg("-l").arg("-f").arg(file);
    cmd.stdin(std::process::Stdio::null());
    cmd.kill_on_drop(true);
    let out = tokio::time::timeout(std::time::Duration::from_secs(5), cmd.output())
        .await
        .ok()?
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // "256 SHA256:abc… user@host (ED25519)"
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (bits, rest) = line.split_once(' ')?;
    let (fp, rest) = rest.split_once(' ').unwrap_or((rest, ""));
    let (comment, kind) = match rest.rfind(" (") {
        Some(i) => (&rest[..i], rest[i + 2..].trim_end_matches(')')),
        None => (rest, ""),
    };
    Some((bits.parse().ok()?, fp.to_string(), comment.to_string(), kind.to_string()))
}

async fn describe_key(path: &std::path::Path, label: String) -> SshKeyInfo {
    let pub_path = std::path::PathBuf::from(format!("{}.pub", path.display()));
    let has_public = pub_path.is_file();
    // Never hand ssh-keygen an encrypted legacy PEM key: it would ask for the
    // passphrase. The .pub, or an OpenSSH-format key's public half, is safe.
    let source = if has_public {
        Some(pub_path.as_path())
    } else if label == "OPENSSH" {
        Some(path)
    } else {
        None
    };
    let fp = match source {
        Some(f) => keygen_fingerprint(f).await,
        None => None,
    };
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mut warning = permission_warning(path);
    if warning.is_none() && path.to_string_lossy().chars().any(char::is_whitespace) {
        warning = Some("The path contains spaces, which SSH commands here can't pass. Move or symlink the key.".into());
    }
    SshKeyInfo {
        path: path.to_string_lossy().to_string(),
        name,
        key_type: fp
            .as_ref()
            .map(|f| f.3.clone())
            .filter(|k| !k.is_empty())
            .unwrap_or(label),
        fingerprint: fp.as_ref().map(|f| f.1.clone()),
        bits: fp.as_ref().map(|f| f.0),
        comment: fp.as_ref().map(|f| f.2.clone()).filter(|c| !c.is_empty() && c != "no comment"),
        has_public,
        warning,
    }
}

/// Private keys found directly in ~/.ssh, for the "Add keys" picker.
#[command]
pub async fn scan_ssh_keys() -> Result<Vec<SshKeyInfo>, String> {
    let home = home_dir().ok_or("Could not determine home directory")?;
    let ssh_dir = std::path::PathBuf::from(&home).join(".ssh");
    if !ssh_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    for entry in std::fs::read_dir(&ssh_dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.ends_with(".pub")
            || name.starts_with('.')
            || matches!(name, "config" | "known_hosts" | "known_hosts.old" | "authorized_keys" | "environment")
        {
            continue;
        }
        if let Some(label) = private_key_label(&path) {
            found.push((path, label));
        }
    }
    let mut keys = Vec::with_capacity(found.len());
    for (path, label) in found {
        keys.push(describe_key(&path, label).await);
    }
    keys.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(keys)
}

/// Validate a key the user points at (anywhere on disk) and describe it.
#[command]
pub async fn inspect_ssh_key(path: String) -> Result<SshKeyInfo, String> {
    let expanded = expand_tilde(path.trim());
    if expanded.is_empty() {
        return Err("Enter the path to a private key".into());
    }
    let mut p = std::path::PathBuf::from(&expanded);
    // Pointed at the public half: use the private key next to it.
    if expanded.ends_with(".pub") {
        let private = std::path::PathBuf::from(expanded.trim_end_matches(".pub"));
        if private.is_file() {
            p = private;
        } else {
            return Err("That's a public key (.pub). Choose the private key file next to it.".into());
        }
    }
    if !p.is_file() {
        return Err(format!("No file at {}", p.display()));
    }
    let p = std::fs::canonicalize(&p).unwrap_or(p);
    let label = private_key_label(&p)
        .ok_or_else(|| "This file isn't an SSH private key.".to_string())?;
    Ok(describe_key(&p, label).await)
}

// ── Creating keys ────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Debug)]
pub struct GeneratedSshKey {
    pub key: SshKeyInfo,
    /// Contents of the new .pub file, to paste into authorized_keys.
    pub public_key: String,
}

/// A file name for ~/.ssh: letters, digits, '.', '_' and '-', no leading dot.
fn valid_key_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('.')
        && !name.ends_with(".pub")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Run ssh-keygen with the passphrase typed at its prompts through a PTY, so
/// the passphrase never appears in a process's argv (visible in `ps`).
fn keygen_with_passphrase(args: &[String], passphrase: &str) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{Read, Write};

    let pair = native_pty_system()
        .openpty(PtySize { rows: 24, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new("ssh-keygen");
    for a in args {
        cmd.arg(a);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Read on a thread; answer each "passphrase" prompt as it appears.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || tx.send(String::from_utf8_lossy(&buf[..n]).to_string()).is_err() {
                break;
            }
        }
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
    let mut seen = String::new();
    let mut answered = 0;
    while answered < 2 {
        let left = deadline.saturating_duration_since(std::time::Instant::now());
        match rx.recv_timeout(left) {
            Ok(chunk) => {
                seen.push_str(&chunk.to_lowercase());
                // Prompts: "Enter passphrase (empty for no passphrase): " and
                // "Enter same passphrase again: ". Count them by "enter " (the
                // first one says "passphrase" twice) and answer only once the
                // prompt is complete: ssh-keygen flushes pending input as it
                // turns echo off, so an early answer would be thrown away.
                let prompts = seen.matches("enter ").count();
                if prompts > answered && seen.trim_end().ends_with(':') {
                    writer.write_all(format!("{}\n", passphrase).as_bytes()).map_err(|e| e.to_string())?;
                    writer.flush().map_err(|e| e.to_string())?;
                    answered += 1;
                }
            }
            Err(_) => {
                let _ = child.kill();
                return Err("ssh-keygen didn't ask for the passphrase as expected".into());
            }
        }
    }
    drop(writer);
    // Never block forever on the child.
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(_) => return Err("ssh-keygen failed while setting the passphrase".into()),
            None if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                return Err("ssh-keygen timed out".into());
            }
            None => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    }
}

/// Create a new key pair in ~/.ssh. `key_type` is "ed25519" or "rsa" (4096
/// bits). With a passphrase, NightFlow's own connections need the key loaded
/// in ssh-agent, since they run without a terminal to ask for it.
#[command]
pub async fn generate_ssh_key(
    name: String,
    key_type: String,
    comment: String,
    passphrase: Option<String>,
) -> Result<GeneratedSshKey, String> {
    let home = home_dir().ok_or("Could not determine home directory")?;
    let ssh_dir = std::path::PathBuf::from(&home).join(".ssh");
    generate_key_in(&ssh_dir, name, key_type, comment, passphrase).await
}

async fn generate_key_in(
    ssh_dir: &std::path::Path,
    name: String,
    key_type: String,
    comment: String,
    passphrase: Option<String>,
) -> Result<GeneratedSshKey, String> {
    let name = name.trim().to_string();
    if !valid_key_name(&name) {
        return Err("Use letters, numbers, '.', '_' or '-' for the name (no leading dot, no .pub).".into());
    }
    if !ssh_dir.is_dir() {
        std::fs::create_dir_all(ssh_dir).map_err(|e| format!("Couldn't create ~/.ssh: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(ssh_dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    let path = ssh_dir.join(&name);
    let pub_path = ssh_dir.join(format!("{}.pub", name));
    if path.exists() || pub_path.exists() {
        return Err(format!("~/.ssh/{} already exists. Choose another name.", name));
    }

    let mut args: Vec<String> = vec!["-q".into(), "-f".into(), path.to_string_lossy().into()];
    match key_type.as_str() {
        "ed25519" => args.extend(["-t".into(), "ed25519".into()]),
        "rsa" => args.extend(["-t".into(), "rsa".into(), "-b".into(), "4096".into()]),
        other => return Err(format!("Unsupported key type: {}", other)),
    }
    let comment = comment.trim();
    if !comment.is_empty() {
        args.extend(["-C".into(), comment.to_string()]);
    }

    let passphrase = passphrase.filter(|p| !p.is_empty());
    match passphrase {
        Some(pass) => {
            let a = args.clone();
            tauri::async_runtime::spawn_blocking(move || keygen_with_passphrase(&a, &pass))
                .await
                .map_err(|e| e.to_string())??;
        }
        None => {
            args.extend(["-N".into(), String::new()]);
            let mut cmd = tokio::process::Command::new("ssh-keygen");
            cmd.no_window();
            cmd.args(&args);
            cmd.stdin(std::process::Stdio::null());
            cmd.kill_on_drop(true);
            let out = tokio::time::timeout(std::time::Duration::from_secs(20), cmd.output())
                .await
                .map_err(|_| "ssh-keygen timed out".to_string())?
                .map_err(|e| format!("Couldn't run ssh-keygen: {}", e))?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                return Err(if err.is_empty() { "ssh-keygen failed".into() } else { err });
            }
        }
    }

    if !path.is_file() {
        return Err("ssh-keygen finished but the key file wasn't created".into());
    }
    let public_key = std::fs::read_to_string(&pub_path).map_err(|e| e.to_string())?.trim().to_string();
    let label = private_key_label(&path).unwrap_or_else(|| "OPENSSH".into());
    Ok(GeneratedSshKey { key: describe_key(&path, label).await, public_key })
}

#[command]
pub async fn test_ssh(ssh_command: String) -> Result<String, String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty SSH command".to_string());
    }
    let mut cmd = tokio::process::Command::new(&parts[0]);
    cmd.no_window();
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]);
    for arg in &parts[1..] {
        cmd.arg(arg);
    }
    cmd.arg("exit");
    cmd.kill_on_drop(true);

    match tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output()).await {
        Ok(Ok(output)) => {
            if output.status.success() {
                Ok("Connected successfully".to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Err(if stderr.is_empty() {
                    "Connection failed".to_string()
                } else {
                    stderr
                })
            }
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("Connection timed out".to_string()),
    }
}

#[command]
pub async fn ssh_mkdir(ssh_command: String, path: String) -> Result<String, String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty SSH command".to_string());
    }
    let mut cmd = tokio::process::Command::new(&parts[0]);
    cmd.no_window();
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]);
    for arg in &parts[1..] {
        cmd.arg(arg);
    }
    let remote_path = if let Some(stripped) = path.strip_prefix("~/") {
        format!("$HOME/{}", stripped)
    } else if path == "~" {
        "$HOME".to_string()
    } else {
        path.clone()
    };
    cmd.arg(format!("mkdir -p \"{}\"", remote_path.replace('"', "\\\"")));
    cmd.kill_on_drop(true);

    match tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output()).await {
        Ok(Ok(output)) => {
            if output.status.success() {
                Ok("Directory ensured on remote".to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Err(if stderr.is_empty() {
                    "Failed to create remote directory".to_string()
                } else {
                    stderr
                })
            }
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("SSH mkdir timed out".to_string()),
    }
}

#[command]
pub async fn ssh_check_path(ssh_command: String, path: String) -> Result<bool, String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty SSH command".to_string());
    }
    let remote_path = if let Some(stripped) = path.strip_prefix("~/") {
        format!("$HOME/{}", stripped)
    } else if path == "~" {
        "$HOME".to_string()
    } else {
        path.clone()
    };
    let mut cmd = tokio::process::Command::new(&parts[0]);
    cmd.no_window();
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"]);
    for arg in &parts[1..] {
        cmd.arg(arg);
    }
    cmd.arg(format!("test -e \"{}\"", remote_path.replace('"', "\\\"")));
    cmd.kill_on_drop(true);

    match tokio::time::timeout(std::time::Duration::from_secs(10), cmd.output()).await {
        Ok(Ok(output)) => Ok(output.status.success()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("SSH check path timed out".to_string()),
    }
}

#[command]
pub async fn ssh_write_file(ssh_command: String, path: String, contents: String) -> Result<(), String> {
    let parts: Vec<String> = ssh_command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty SSH command".to_string());
    }
    let remote_path = if let Some(stripped) = path.strip_prefix("~/") {
        format!("$HOME/{}", stripped)
    } else if path == "~" {
        "$HOME".to_string()
    } else {
        path.clone()
    };
    let mut cmd = tokio::process::Command::new(&parts[0]);
    cmd.no_window();
    cmd.args(["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]);
    for arg in &parts[1..] {
        cmd.arg(arg);
    }
    cmd.arg(format!("cat > \"{}\"", remote_path.replace('"', "\\\"")));
    cmd.stdin(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin
            .write_all(contents.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        drop(stdin);
    }

    match tokio::time::timeout(std::time::Duration::from_secs(15), child.wait()).await {
        Ok(Ok(status)) => {
            if status.success() {
                Ok(())
            } else {
                Err("Failed to write file on remote".to_string())
            }
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("SSH write_file timed out".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn keygen(dir: &std::path::Path, name: &str, extra: &[&str]) -> std::path::PathBuf {
        let path = dir.join(name);
        let ok = Command::new("ssh-keygen")
            .args(["-q", "-C", "test@nightflow", "-f"])
            .arg(&path)
            .args(extra)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(ok, "ssh-keygen failed for {name}");
        path
    }

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("nf-ssh-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn inspects_openssh_key_and_its_pub_path() {
        let dir = tmpdir("openssh");
        let key = keygen(&dir, "id_ed25519", &["-t", "ed25519", "-N", ""]);
        let info = tauri::async_runtime::block_on(inspect_ssh_key(key.to_string_lossy().into())).unwrap();
        assert_eq!(info.key_type, "ED25519");
        assert!(info.fingerprint.as_deref().unwrap().starts_with("SHA256:"));
        assert_eq!(info.comment.as_deref(), Some("test@nightflow"));
        assert!(info.has_public);
        assert!(info.warning.is_none(), "{:?}", info.warning);

        // Pointing at the .pub resolves to the private key.
        let via_pub = tauri::async_runtime::block_on(inspect_ssh_key(format!("{}.pub", key.display()))).unwrap();
        assert_eq!(via_pub.path, info.path);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn encrypted_pem_without_pub_never_prompts() {
        let dir = tmpdir("pem");
        let key = keygen(&dir, "legacy_rsa", &["-t", "rsa", "-b", "2048", "-m", "PEM", "-N", "secret"]);
        std::fs::remove_file(format!("{}.pub", key.display())).unwrap();
        let info = tauri::async_runtime::block_on(inspect_ssh_key(key.to_string_lossy().into())).unwrap();
        assert_eq!(info.key_type, "RSA");
        assert!(info.fingerprint.is_none());
        assert!(!info.has_public);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn warns_about_loose_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmpdir("perm");
        let key = keygen(&dir, "id_loose", &["-t", "ed25519", "-N", ""]);
        std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o644)).unwrap();
        let info = tauri::async_runtime::block_on(inspect_ssh_key(key.to_string_lossy().into())).unwrap();
        assert!(info.warning.unwrap().contains("chmod 600"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Cipher named in an OpenSSH private key ("none" if unencrypted).
    /// Only the Unix-only generation test uses it.
    #[cfg(unix)]
    fn openssh_cipher(path: &std::path::Path) -> String {
        let text = std::fs::read_to_string(path).unwrap();
        let b64: String = text.lines().filter(|l| !l.starts_with("-----")).collect();
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut bytes = Vec::new();
        let (mut acc, mut bits) = (0u32, 0);
        for c in b64.bytes().filter(|c| *c != b'=') {
            acc = (acc << 6) | T.iter().position(|t| *t == c).unwrap() as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                bytes.push((acc >> bits) as u8);
            }
        }
        // "openssh-key-v1\0" then a u32 length and the cipher name.
        let rest = &bytes[15..];
        let n = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
        String::from_utf8(rest[4..4 + n].to_vec()).unwrap()
    }

    #[test]
    fn key_names_are_validated() {
        assert!(valid_key_name("nightflow_ed25519"));
        assert!(valid_key_name("work-gpu.key"));
        for bad in ["", ".hidden", "id.pub", "a/b", "../x", "with space"] {
            assert!(!valid_key_name(bad), "{bad}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn generates_keys_with_and_without_passphrase() {
        let home = tmpdir("gen-home");
        let ssh_dir = home.join(".ssh"); // doesn't exist yet: gets created 0700
        let run = |name: &str, kind: &str, pass: Option<&str>| {
            tauri::async_runtime::block_on(generate_key_in(
                &ssh_dir,
                name.into(),
                kind.into(),
                "nf@test".into(),
                pass.map(String::from),
            ))
        };

        let plain = run("nf_plain", "ed25519", None).unwrap();
        assert_eq!(plain.key.key_type, "ED25519");
        assert!(plain.public_key.starts_with("ssh-ed25519 ") && plain.public_key.ends_with("nf@test"));
        assert!(plain.key.warning.is_none(), "{:?}", plain.key.warning);

        let locked = run("nf_locked", "ed25519", Some("correct horse")).unwrap();
        // The passphrase really protects it: the OpenSSH key body names its
        // cipher ("none" when unencrypted), and the right passphrase opens it.
        assert_eq!(openssh_cipher(&ssh_dir.join("nf_plain")), "none");
        assert_eq!(openssh_cipher(&ssh_dir.join("nf_locked")), "aes256-ctr");
        let opens = Command::new("ssh-keygen")
            .args(["-y", "-P", "correct horse", "-f"])
            .arg(ssh_dir.join("nf_locked"))
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert!(opens.status.success());
        assert!(locked.key.fingerprint.is_some());

        let rsa = run("nf_rsa", "rsa", None).unwrap();
        assert_eq!(rsa.key.bits, Some(4096));

        assert!(run("nf_plain", "ed25519", None).unwrap_err().contains("already exists"));
        assert!(run("bad name", "ed25519", None).is_err());
        assert!(run("nf_dsa", "dsa", None).unwrap_err().contains("Unsupported"));

        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&ssh_dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rejects_files_that_are_not_private_keys() {
        let dir = tmpdir("bad");
        let f = dir.join("notes.txt");
        std::fs::write(&f, "hello").unwrap();
        let err = tauri::async_runtime::block_on(inspect_ssh_key(f.to_string_lossy().into())).unwrap_err();
        assert!(err.contains("isn't an SSH private key"));
        let missing = tauri::async_runtime::block_on(inspect_ssh_key(dir.join("nope").to_string_lossy().into())).unwrap_err();
        assert!(missing.starts_with("No file at"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
