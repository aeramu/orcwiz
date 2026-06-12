use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-env-changed=SKIP_WEB_BUILD");

    if env::var_os("SKIP_WEB_BUILD").is_some() {
        println!("cargo:warning=SKIP_WEB_BUILD is set; skipping web build");
        ensure_out_dir();
        return;
    }

    let web_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("web");
    let dist_dir = web_dir.join("dist");

    println!("cargo:rerun-if-changed={}", web_dir.join("package.json").display());
    println!("cargo:rerun-if-changed={}", web_dir.join("vite.config.ts").display());
    println!("cargo:rerun-if-changed={}", web_dir.join("index.html").display());
    println!("cargo:rerun-if-changed={}", web_dir.join("src").display());
    println!("cargo:rerun-if-changed={}", web_dir.join("public").display());
    println!("cargo:rerun-if-changed={}", web_dir.join("tsconfig.json").display());
    println!("cargo:rerun-if-changed={}", web_dir.join("tsconfig.app.json").display());
    println!("cargo:rerun-if-changed={}", web_dir.join("tsconfig.node.json").display());

    if !web_dir.exists() {
        panic!("web directory not found at {}; cannot build frontend", web_dir.display());
    }

    let bun = find_bun().unwrap_or_else(|| {
        panic!(
            "`bun` was not found in PATH or common install locations. \
             Install Bun (https://bun.sh) or set SKIP_WEB_BUILD=1 to skip the web build."
        )
    });

    println!("cargo:info=Installing web dependencies with bun at {}", bun.display());
    let status = Command::new(&bun)
        .arg("install")
        .arg("--frozen-lockfile")
        .current_dir(&web_dir)
        .status()
        .expect("failed to invoke bun install");
    if !status.success() {
        panic!("bun install failed with status {}", status);
    }

    println!("cargo:info=Building web frontend with bun");
    let status = Command::new(&bun)
        .arg("run")
        .arg("build")
        .current_dir(&web_dir)
        .status()
        .expect("failed to invoke bun run build");
    if !status.success() {
        panic!("bun run build failed with status {}", status);
    }

    if !dist_dir.exists() {
        panic!(
            "web build did not produce expected output at {}",
            dist_dir.display()
        );
    }

    ensure_out_dir();
}

fn ensure_out_dir() {
    let out_dir = env::var_os("OUT_DIR").expect("OUT_DIR is not set");
    let _ = std::fs::create_dir_all(&out_dir);
}

fn find_bun() -> Option<PathBuf> {
    // 1) Honor PATH (works when Cargo's inherited PATH is sufficient).
    if let Ok(path) = which::which("bun") {
        return Some(path);
    }

    // 2) Cargo runs build scripts with a minimal PATH, so fall back to common
    //    install locations on each platform.
    let home = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE"))?;
    let home = PathBuf::from(home);

    #[cfg(unix)]
    let candidates: Vec<PathBuf> = vec![
        home.join(".bun/bin/bun"),
        home.join(".local/bin/bun"),
        home.join("bin/bun"),
        PathBuf::from("/usr/local/bin/bun"),
        PathBuf::from("/opt/homebrew/bin/bun"),
    ];

    #[cfg(windows)]
    let candidates: Vec<PathBuf> = vec![
        home.join(".bun/bin/bun.exe"),
        home.join("AppData/Local/bun/bin/bun.exe"),
    ];

    candidates.into_iter().find(|p| p.is_file())
}
