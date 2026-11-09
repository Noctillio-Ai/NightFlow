fn main() {
    // Decide by the *target* (CARGO_CFG_*), not the machine running the build.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_os == "windows" && target_env == "msvc" {
        // Embed the app manifest with the linker so every binary gets it,
        // including `cargo test` executables. tauri-build would embed it into
        // the app binary only, and test binaries without it (no Common
        // Controls v6) fail to start with STATUS_ENTRYPOINT_NOT_FOUND.
        let manifest = std::env::current_dir()
            .expect("build dir")
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());

        // Icon and version info still come from tauri-build; the manifest
        // above replaces its own.
        let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("failed to run tauri build");
    } else {
        tauri_build::build();
    }
}
