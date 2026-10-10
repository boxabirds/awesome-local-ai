//! Keeps the gallery's checkout level with origin, so what it shows is never older than what the
//! benchmark machines have pushed.

use std::path::Path;

/// Fast-forwards the checkout to origin's tip. Never resets, cleans or discards: a local change that
/// stands in the way makes git refuse, and the checkout stays as it was.
pub fn sync_repo(repo: &Path) -> anyhow::Result<()> {
    let out = std::process::Command::new("git")
        .arg("-C").arg(repo).args(["pull", "--ff-only", "--quiet"])
        .stdin(std::process::Stdio::null())
        .output()?;
    anyhow::ensure!(out.status.success(), "git pull --ff-only: {}", String::from_utf8_lossy(&out.stderr).trim());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    const NAME: &str = "test";
    const MAIL: &str = "test@example.com";

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .arg("-C").arg(dir).args(["-c", &format!("user.name={NAME}"), "-c", &format!("user.email={MAIL}")])
            .args(args).output().expect("git runs");
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn scratch(tag: &str) -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("vidi-gallery-sync-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An origin with one commit, a clone of it (the gallery's checkout), and a second clone that
    /// plays the benchmark machine: push a new record from it with `push_from_bench`.
    struct World { gallery: PathBuf, bench: PathBuf }

    fn world(tag: &str) -> World {
        let root = scratch(tag);
        let origin = root.join("origin.git");
        std::fs::create_dir_all(&origin).unwrap();
        git(&origin, &["init", "-q", "--bare", "-b", "main"]);
        git(&root, &["clone", "-q", origin.to_str().unwrap(), "seed"]);
        let seed = root.join("seed");
        std::fs::write(seed.join("notes.txt"), "one\n").unwrap();
        std::fs::write(seed.join("ignore.txt"), "x\n").unwrap();
        git(&seed, &["add", "."]);
        git(&seed, &["commit", "-q", "-m", "first"]);
        git(&seed, &["push", "-q", "origin", "HEAD:main"]);
        git(&root, &["clone", "-q", origin.to_str().unwrap(), "gallery"]);
        git(&root, &["clone", "-q", origin.to_str().unwrap(), "bench"]);
        World { gallery: root.join("gallery"), bench: root.join("bench") }
    }

    fn push_from_bench(w: &World, file: &str, text: &str) {
        std::fs::write(w.bench.join(file), text).unwrap();
        git(&w.bench, &["add", "."]);
        git(&w.bench, &["commit", "-q", "-m", "run finished"]);
        git(&w.bench, &["push", "-q", "origin", "HEAD:main"]);
    }

    #[test]
    fn a_run_pushed_after_the_checkout_was_made_is_in_the_checkout_after_a_sync() {
        let w = world("behind");
        push_from_bench(&w, "finished.json", "done\n");
        assert!(!w.gallery.join("finished.json").exists(), "precondition: the checkout is behind");
        sync_repo(&w.gallery).expect("sync");
        assert_eq!(std::fs::read_to_string(w.gallery.join("finished.json")).unwrap(), "done\n");
    }

    #[test]
    fn a_local_edit_to_another_file_neither_blocks_the_sync_nor_is_lost() {
        let w = world("dirty");
        std::fs::write(w.gallery.join("ignore.txt"), "mine\n").unwrap();
        push_from_bench(&w, "finished.json", "done\n");
        sync_repo(&w.gallery).expect("sync");
        assert!(w.gallery.join("finished.json").exists());
        assert_eq!(std::fs::read_to_string(w.gallery.join("ignore.txt")).unwrap(), "mine\n");
    }

    #[test]
    fn a_local_edit_that_conflicts_makes_the_sync_fail_and_leaves_the_edit_alone() {
        let w = world("conflict");
        std::fs::write(w.gallery.join("notes.txt"), "mine\n").unwrap();
        push_from_bench(&w, "notes.txt", "theirs\n");
        assert!(sync_repo(&w.gallery).is_err());
        assert_eq!(std::fs::read_to_string(w.gallery.join("notes.txt")).unwrap(), "mine\n");
    }
}
