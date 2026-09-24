// Embeds the git commit into the version ("0.1.0+1b385d0", "+dirty" if the tree has changes), so
// /v1/health and `dbench --version` show which build a node is running.
use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn main() {
    let commit = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain", "--", "."]).is_some_and(|s| !s.is_empty());
    let suffix = if dirty { "-dirty" } else { "" };
    println!(
        "cargo:rustc-env=DBENCH_VERSION={}+{commit}{suffix}",
        env!("CARGO_PKG_VERSION")
    );
    println!("cargo:rerun-if-changed=src");
    if let Some(dir) = git(&["rev-parse", "--git-dir"]) {
        println!("cargo:rerun-if-changed={dir}/HEAD");
        println!("cargo:rerun-if-changed={dir}/index");
    }
}
