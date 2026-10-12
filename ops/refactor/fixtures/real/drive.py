# Unchanged excerpt of benchmarks/spec-bench/harness/drive.py, pinned to commit f76e6a167. Refresh deliberately, with the pin.

def record_story(repo_root: Path, run: Path, message: str, git: list[str] | None = None,
                 private: Path | None = None) -> dict:
    """Commit exactly this run's directory and push, so every story leaves a durable record.

    Only the run dir is staged: anything else uncommitted in the repo is left alone. A credential in a staged file
    is replaced by a marker naming it before the commit, and counted (credentials_redacted). Held-out detail never is
    (publicise.py): each result gets its public summary, the run's private files are git-ignored (and untracked
    if an older harness committed them) and copied to the private repo (record_private), and every staged file
    is checked for held-out test titles first; if one has any, nothing is committed (refuse).
    Nothing at all is done, and the reason returned, when the run doesn't belong in this checkout (record_refusal).
    A failed push is reported, never fatal: the benchmark carries on. When the remote has
    changed this run's own files (a rename of its combination, say), the pull-and-rebase
    conflicts: it is aborted, the story stays committed locally and is reported `unpushed`,
    and the next story's push carries the backlog once the remote no longer conflicts."""
    git = git or ["git"]
    out: dict = {"committed": False, "pushed": False}
    refused = record_refusal(repo_root, run, git)
    if refused:
        return {**out, "error": f"not recorded: {refused}"}
    if _rebase_in_progress(repo_root, git):
        # Left by a harness killed mid-rebase: committing into it would bury the story.
        subprocess.run([*git, "rebase", "--abort"], cwd=repo_root, capture_output=True, text=True)
        out["recovered"] = "aborted a rebase left in progress by an earlier run"
    (run / ".gitignore").write_text(RUN_GITIGNORE)
    heldout.make_public(run)
    too_big = make_publishable(run)
    rel = str(run.resolve().relative_to(repo_root.resolve()))
    out["over_size_limit"] = [f for f in too_big if not publicise.is_private(
        str(Path(f).resolve().relative_to(repo_root.resolve())))]
    private = heldout.private_repo() if private is None else private
    # The detail first: whatever happens to the public commit, the private repo has it.
    out["private"] = record_private(repo_root, run, message, private, git)
    # The commit is built in an index of its own, from HEAD plus this run: exactly what is checked is what is
    # committed, a private file an older harness committed can be dropped from it (a `commit -- <run>` would take
    # it back from the working tree), and nothing else staged in the checkout goes in with it.
    with tempfile.TemporaryDirectory(prefix="record-index-") as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        if subprocess.run([*git, "rev-parse", "-q", "--verify", "HEAD"], cwd=repo_root, capture_output=True).returncode == 0:
            subprocess.run([*git, "read-tree", "HEAD"], cwd=repo_root, env=env, capture_output=True)
        untracked = untrack_private(repo_root, rel, git, env)
        if untracked:
            out["untracked_private"] = len(untracked)
        add = subprocess.run([*git, "add", "--", rel], cwd=repo_root, capture_output=True, text=True, env=env)
        if add.returncode != 0:
            return {**out, "error": add.stderr[-500:]}
        # The credential scan (credentials.py), on exactly what is staged: nothing reaches the commit round it.
        redacted, unscanned = heldout.redact_staged(repo_root, rel, git, env)
        if redacted:
            out["credentials_redacted"] = {"count": len(redacted), "names": sorted(set(redacted))}
            print(f"record: {len(redacted)} credential(s) redacted from what is published: "
                  f"{', '.join(out['credentials_redacted']['names'])}", flush=True)
        names, problems = heldout.local_names()
        problems += unscanned
        problems += heldout.staged_problems(repo_root, rel, git, heldout.fingerprints(private), env, names)
        problems += heldout.message_problems(message, names, COMMIT_MESSAGE)
        if problems:
            return {**out, **refuse(run, problems, names)}
        (run / publicise.PUBLISH_REFUSED).unlink(missing_ok=True)
        commit = subprocess.run([*git, "commit", "-q", "-m", message + COMMIT_TRAILER], cwd=repo_root,
                                capture_output=True, text=True, env=env)
        if commit.returncode != 0:
            return {**out, "error": (commit.stdout + commit.stderr)[-500:]}
    # The checkout's own index catches up with the commit for this run; the rest of it is left as it was.
    subprocess.run([*git, "reset", "-q", "--", rel], cwd=repo_root, capture_output=True)
    out["committed"] = True
    out["commit"] = subprocess.run([*git, "rev-parse", "--short", "HEAD"], cwd=repo_root,
                                   capture_output=True, text=True).stdout.strip()
    return {**out, **push_with_rebase(repo_root, git)}


def setup_workspace(ws: Path) -> None:
    """Fresh repo containing only README.md (as story 1's design assumes) plus the read-only spec."""
    if (ws / ".git").exists():
        return
    ws.mkdir(parents=True)
    (ws / "README.md").write_text("# vidi6\n\nA shared board for thinking together.\n")
    shutil.copytree(SPEC, ws / SPEC_DIR)
    spec_files_read_only(ws)
    sh(["git", "init", "-q", "-b", "main"], ws)
    sh(["git", "add", "-A"], ws)
    sh(["git", "commit", "-qm", "harness: empty repository with spec"], ws, GIT_IDENTITY)
