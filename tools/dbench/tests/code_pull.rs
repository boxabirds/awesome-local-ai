//! A run's code from the node to the lake (story 23, code.lake_repo): `GET /v1/runs/code` on the real node router, and
//! the collector's pull (`lake_code::pull_code`, `apply_code`) into a real `code.git`. Real git throughout; the run
//! repositories are the real mlx-serve v2-r4 and gufo-fork v2-q36fork-b-r2 histories (tests/fixtures/code_lake), cut
//! at a story as the run stood then.
//!
//! Cases (design test strategy): TC-10 first pull, TC-11 incremental pull, TC-12 nothing new, TC-13 interrupted
//! transfer, TC-13b corrupted transfer, TC-14 tag moved by a restart, TC-15 shared objects, TC-16 unknown run, TC-18 a
//! have the node lacks, TC-19 a run without a repository, TC-B2 (the classification half) a node without the route.

use dbench::cli::ServerConfig;
use dbench::client::{Api, NodeEntry};
use dbench::lake_code::{self, apply_code, pull_code, Pulled};
use dbench::server::{router, Inner, Shared};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TOKEN: &str = "test-token";
const NODE: &str = "n1";
const RUN: &str = "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/v2-r4";
const OTHER: &str = "combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2";
const POLL: Duration = Duration::from_millis(50);
const MAX_RESTARTS: u32 = 2;
const HTTP_OK: u16 = 200;
const HTTP_NO_CONTENT: u16 = 204;
const HTTP_NOT_FOUND: u16 = 404;
/// Commits after story 2 up to story 3 in the real mlx-serve history: the harness's PROGRESS.md commit and the story's.
const COMMITS_STORY_2_TO_3: usize = 2;

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn fixture_run(run: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/code_lake/collected/gruntus")
        .join(run)
}

fn story_commits(run: &str) -> BTreeMap<u32, String> {
    let m: serde_json::Value = serde_json::from_slice(&std::fs::read(fixture_run(run).join("metrics.json")).unwrap()).unwrap();
    m["stories"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.parse().unwrap(), v["commit"].as_str().unwrap().to_string()))
        .collect()
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(
        out.status.success(),
        "git {args:?} in {}: {}",
        dir.display(),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn refs(repo: &Path, prefix: &str) -> BTreeMap<String, String> {
    git(repo, &["for-each-ref", "--format=%(refname) %(objectname)", prefix])
        .lines()
        .map(|l| {
            let (r, c) = l.split_once(' ').unwrap();
            (r.to_string(), c.to_string())
        })
        .collect()
}

fn object_count(repo: &Path) -> u64 {
    let out = git(repo, &["count-objects", "-v"]);
    let field = |k: &str| out.lines().find_map(|l| l.strip_prefix(k)).unwrap().trim().parse::<u64>().unwrap();
    field("count:") + field("in-pack:")
}

struct Node {
    root: PathBuf,
    shared: Arc<Shared>,
    base: String,
    http: reqwest::Client,
}

impl Drop for Node {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl Node {
    async fn start() -> Node {
        let root = std::env::temp_dir().join(format!(
            "dbench-code-pull-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&root);
        let (repo, home, share) = (root.join("repo"), root.join("home"), root.join("share"));
        std::fs::create_dir_all(repo.join("combinations")).unwrap();
        std::fs::create_dir_all(home.join("jobs")).unwrap();
        std::fs::create_dir_all(&share).unwrap();
        let cfg = ServerConfig {
            bind: "127.0.0.1:0".into(),
            repo: repo.canonicalize().unwrap(),
            jobs_dir: home.join("jobs"),
            releases_dir: home.join("releases"),
            home,
            share_dir: share,
            bench_home: root.join("bench-home"),
            path_prepend: vec![],
            max_restarts: MAX_RESTARTS,
            pull: false,
            allow_unreleased: true,
            restart_backoff: POLL,
            unfit_backoff: POLL,
            cancel_grace: POLL,
            tree_poll: POLL,
        };
        let shared = Arc::new(Shared {
            cfg,
            token: TOKEN.into(),
            boot_time: None,
            inner: Mutex::new(Inner {
                jobs: HashMap::new(),
                queue: VecDeque::new(),
                current: None,
                hold: None,
            }),
            wake: tokio::sync::Notify::new(),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = router(shared.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Node {
            root,
            shared,
            base: format!("http://{addr}"),
            http: reqwest::Client::new(),
        }
    }

    fn api(&self) -> Api {
        Api::new(&NodeEntry {
            url: self.base.clone(),
            token: Some(TOKEN.into()),
        })
        .unwrap()
    }

    fn run_dir(&self, run: &str) -> PathBuf {
        self.shared.cfg.repo.join(run)
    }

    /// A run folder with its marker; with `work`, its work_dir.txt naming a work folder outside the checkout.
    fn make_run(&self, run: &str, work: bool) -> PathBuf {
        let dir = self.run_dir(run);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("run.json"), b"{}").unwrap();
        let ws = self.root.join("w").join(run.replace('/', "__")).join("workspace");
        if work {
            std::fs::create_dir_all(&ws).unwrap();
            std::fs::write(dir.join("work_dir.txt"), format!("{}\n", ws.parent().unwrap().display())).unwrap();
        }
        ws
    }

    /// The run's own repository as it stood at the end of `upto`: the real history to that story's commit on main, and
    /// a story-NN tag on each story's commit.
    fn run_repo_at(&self, run: &str, upto: u32) -> PathBuf {
        let ws = self.make_run(run, true);
        if !ws.join(".git").exists() {
            git(&ws, &["init", "-q", "-b", "main"]);
            let bundle = fixture_run(run).join("workspace.bundle");
            git(&ws, &["fetch", "-q", bundle.to_str().unwrap(), "+refs/heads/*:refs/source/*"]);
        }
        let stories = story_commits(run);
        git(&ws, &["update-ref", "refs/heads/main", &stories[&upto]]);
        for (n, c) in stories.range(..=upto) {
            git(&ws, &["tag", "-f", &format!("story-{n:02}"), c]);
        }
        ws
    }

    async fn get(&self, query: &[(&str, &str)]) -> (u16, Vec<u8>) {
        let resp = self
            .http
            .get(format!("{}/v1/runs/code", self.base))
            .query(query)
            .bearer_auth(TOKEN)
            .send()
            .await
            .unwrap();
        (resp.status().as_u16(), resp.bytes().await.unwrap().to_vec())
    }
}

fn lake(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("dbench-code-pull-lake-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.join(lake_code::CODE_REPO)
}

fn write_bundle(bytes: &[u8], tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("dbench-code-pull-{tag}-{}.bundle", std::process::id()));
    std::fs::write(&p, bytes).unwrap();
    p
}

/// The commits a bundle says it needs (its header's `-` lines).
fn prerequisites(bundle: &[u8]) -> Vec<String> {
    let end = bundle.windows(2).position(|w| w == b"\n\n").unwrap();
    String::from_utf8_lossy(&bundle[..end])
        .lines()
        .filter_map(|l| l.strip_prefix('-'))
        .map(|l| l.split(' ').next().unwrap().to_string())
        .collect()
}

fn heads_of_bundle(bundle: &Path) -> BTreeMap<String, String> {
    let out = Command::new("git").args(["bundle", "list-heads"]).arg(bundle).output().unwrap();
    String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .map(|l| {
            let (c, r) = l.split_once(' ').unwrap();
            (r.to_string(), c.to_string())
        })
        .collect()
}

// ---- the node's route ----

#[tokio::test]
async fn the_node_gives_the_runs_branches_and_story_tags_as_one_bundle() {
    // TC-10, the node's half
    let n = Node::start().await;
    let ws = n.run_repo_at(RUN, 2);
    let (status, body) = n.get(&[("run", RUN)]).await;
    assert_eq!(status, HTTP_OK, "{}", String::from_utf8_lossy(&body));
    let file = write_bundle(&body, "first");
    let heads = heads_of_bundle(&file);
    let want: BTreeMap<String, String> = refs(&ws, "refs/heads").into_iter().chain(refs(&ws, "refs/tags")).collect();
    assert_eq!(heads, want, "main and story-01, story-02, nothing else");
    assert!(prerequisites(&body).is_empty(), "a first pull is complete in itself");
    std::fs::remove_file(file).unwrap();
}

#[tokio::test]
async fn nothing_new_is_204_and_haves_the_node_lacks_or_that_are_not_commits_are_ignored() {
    // TC-12 (node half) and TC-18
    let n = Node::start().await;
    let ws = n.run_repo_at(RUN, 2);
    let tips: Vec<String> = refs(&ws, "refs/heads")
        .into_values()
        .chain(refs(&ws, "refs/tags").into_values())
        .collect();
    let (status, body) = n.get(&[("run", RUN), ("have", &tips.join(","))]).await;
    assert_eq!((status, body.len()), (HTTP_NO_CONTENT, 0));

    let unknown = "0123456789abcdef0123456789abcdef01234567";
    let (status, body) = n
        .get(&[("run", RUN), ("have", &format!("{unknown},not-a-commit,,{}", "f".repeat(40)))])
        .await;
    assert_eq!(status, HTTP_OK);
    assert!(prerequisites(&body).is_empty(), "nothing excluded: the whole history is sent");
}

#[tokio::test]
async fn an_unknown_run_a_run_without_a_work_folder_and_one_without_a_repository_are_404() {
    // TC-16 and TC-19, the node's half
    let n = Node::start().await;
    let (status, _) = n.get(&[("run", RUN)]).await;
    assert_eq!(status, HTTP_NOT_FOUND, "not on this node");
    n.make_run(RUN, false);
    let (status, body) = n.get(&[("run", RUN)]).await;
    // No work_dir.txt: a run git carried here, which this node did not run, so it is not this node's to offer at
    // all (story 23, node.own_runs) and the answer is the unknown run's.
    assert_eq!(status, HTTP_NOT_FOUND, "no work_dir.txt");
    assert!(String::from_utf8_lossy(&body).contains(&format!("no run {RUN} on this node")), "{}", String::from_utf8_lossy(&body));
    n.make_run(RUN, true);
    let (status, body) = n.get(&[("run", RUN)]).await;
    assert_eq!(status, HTTP_NOT_FOUND, "a work folder with no .git");
    assert!(String::from_utf8_lossy(&body).contains(dbench::scopes::code::E_CODE_NO_REPO));
}

// ---- the collector's pull ----

#[tokio::test]
async fn a_first_pull_puts_the_runs_heads_and_story_refs_in_the_lake() {
    // TC-10
    let n = Node::start().await;
    let ws = n.run_repo_at(RUN, 2);
    let code = lake("first");
    assert!(!code.exists());
    let pulled = pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    assert!(matches!(pulled, Pulled::Applied { refs_moved: 3 }), "{pulled:?}");
    let prefix = lake_code::run_prefix(NODE, RUN);
    let held = refs(&code, &format!("{prefix}/"));
    let node_side = refs(&ws, "refs/heads").into_iter().chain(refs(&ws, "refs/tags"));
    let want: BTreeMap<String, String> = node_side
        .map(|(r, c)| match r.strip_prefix("refs/tags/story-") {
            Some(n) => (format!("{prefix}/story/{n}"), c),
            None => (format!("{prefix}/heads/{}", r.strip_prefix("refs/heads/").unwrap()), c),
        })
        .collect();
    assert_eq!(held, want);
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn an_incremental_pull_sends_only_what_follows_the_lakes_tips_and_a_current_lake_gets_204() {
    // TC-11 and TC-12
    let n = Node::start().await;
    n.run_repo_at(RUN, 2);
    let code = lake("incremental");
    pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    let stories = story_commits(RUN);
    let ws = n.run_repo_at(RUN, 3);

    // What the node sends for the lake's tips: only commits after story 2.
    let tips: Vec<String> = refs(&code, &format!("{}/", lake_code::run_prefix(NODE, RUN))).into_values().collect();
    let (_, body) = n.get(&[("run", RUN), ("have", &tips.join(","))]).await;
    assert_eq!(
        prerequisites(&body),
        vec![stories[&2].clone()],
        "the transfer starts after story 2's commit"
    );
    assert_eq!(
        git(&ws, &["rev-list", "--count", &format!("{}..{}", stories[&2], stories[&3])]).trim(),
        COMMITS_STORY_2_TO_3.to_string()
    );
    let alone = lake("incremental-alone");
    let file = write_bundle(&body, "incremental");
    assert!(
        apply_code(&alone, NODE, RUN, &file).is_err(),
        "it cannot stand alone: it needs story 2's commit"
    );

    let commits = |repo: &Path| git(repo, &["rev-list", "--all"]).lines().count();
    let (objects_before, commits_before) = (object_count(&code), commits(&code));
    let pulled = pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    assert!(matches!(pulled, Pulled::Applied { refs_moved: 2 }), "main and story/03: {pulled:?}");
    // The transfer held story 3's two commits and none before them, and far fewer objects than the history.
    assert_eq!(commits(&code) - commits_before, COMMITS_STORY_2_TO_3);
    let history = git(&ws, &["rev-list", "--objects", &stories[&3]]).lines().count() as u64;
    let added = object_count(&code) - objects_before;
    assert!(added > 0 && added * 2 < history, "{added} objects added of a history of {history}");
    assert_eq!(refs(&code, &lake_code::story_ref(NODE, RUN, 3)).values().next(), Some(&stories[&3]));

    let before = refs(&code, "refs/");
    let entries = std::fs::read_dir(&code).unwrap().count();
    assert_eq!(pull_code(&n.api(), &code, NODE, RUN).await.unwrap(), Pulled::NothingNew);
    assert_eq!(refs(&code, "refs/"), before);
    assert_eq!(std::fs::read_dir(&code).unwrap().count(), entries, "no file left behind");
    std::fs::remove_file(file).unwrap();
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
    std::fs::remove_dir_all(alone.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn a_cut_or_corrupted_transfer_changes_nothing_and_the_next_pull_completes() {
    // TC-13 and TC-13b
    let n = Node::start().await;
    n.run_repo_at(RUN, 2);
    let code = lake("cut");
    pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    n.run_repo_at(RUN, 3);
    let tips: Vec<String> = refs(&code, &format!("{}/", lake_code::run_prefix(NODE, RUN))).into_values().collect();
    let (_, body) = n.get(&[("run", RUN), ("have", &tips.join(","))]).await;
    let (refs_before, objects_before) = (refs(&code, "refs/"), object_count(&code));

    let cut = write_bundle(&body[..body.len() / 2], "cut");
    assert!(apply_code(&code, NODE, RUN, &cut).is_err(), "half a bundle");
    let mut flipped = body.clone();
    let last = flipped.len() - 1;
    flipped[last] ^= 0xff;
    let corrupt = write_bundle(&flipped, "corrupt");
    assert!(apply_code(&code, NODE, RUN, &corrupt).is_err(), "a corrupted bundle");
    assert_eq!(refs(&code, "refs/"), refs_before);
    assert_eq!(object_count(&code), objects_before, "no object of a failed transfer kept");

    assert!(matches!(pull_code(&n.api(), &code, NODE, RUN).await.unwrap(), Pulled::Applied { .. }));
    assert!(refs(&code, &lake_code::story_ref(NODE, RUN, 3)).len() == 1);
    for f in [cut, corrupt] {
        std::fs::remove_file(f).unwrap();
    }
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn a_connection_cut_half_way_through_the_transfer_changes_nothing_and_the_next_pull_completes() {
    // TC-13, through the pull: a node that promises the whole bundle, sends half, and closes the connection.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let n = Node::start().await;
    n.run_repo_at(RUN, 2);
    let code = lake("cutconn");
    pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    n.run_repo_at(RUN, 3);
    let tips: Vec<String> = refs(&code, &format!("{}/", lake_code::run_prefix(NODE, RUN))).into_values().collect();
    let (_, body) = n.get(&[("run", RUN), ("have", &tips.join(","))]).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut request = [0u8; 4096];
        let _ = sock.read(&mut request).await.unwrap();
        let head = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/x-git-bundle\r\ncontent-length: {}\r\n\r\n",
            body.len()
        );
        sock.write_all(head.as_bytes()).await.unwrap();
        sock.write_all(&body[..body.len() / 2]).await.unwrap();
        // dropped here: the connection closes half way
    });
    let cutting = Api::new(&NodeEntry {
        url: format!("http://{addr}"),
        token: Some(TOKEN.into()),
    })
    .unwrap();
    let (refs_before, objects_before) = (refs(&code, "refs/"), object_count(&code));
    let entries = std::fs::read_dir(&code).unwrap().count();
    assert!(pull_code(&cutting, &code, NODE, RUN).await.is_err());
    assert_eq!(refs(&code, "refs/"), refs_before);
    assert_eq!(object_count(&code), objects_before);
    assert_eq!(std::fs::read_dir(&code).unwrap().count(), entries, "no partial file left behind");
    assert!(matches!(
        pull_code(&n.api(), &code, NODE, RUN).await.unwrap(),
        Pulled::Applied { refs_moved: 2 }
    ));
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn a_finished_run_whose_work_dir_was_given_back_is_still_served_from_its_repository() {
    // TC-17: finalize's release_work leaves workspace/.git and nothing else.
    let n = Node::start().await;
    let ws = n.run_repo_at(RUN, 3);
    git(&ws, &["checkout", "-q", "main"]);
    for e in std::fs::read_dir(&ws).unwrap() {
        let p = e.unwrap().path();
        if p.file_name().unwrap() != ".git" {
            if p.is_dir() {
                std::fs::remove_dir_all(&p).unwrap()
            } else {
                std::fs::remove_file(&p).unwrap()
            }
        }
    }
    for e in std::fs::read_dir(ws.parent().unwrap()).unwrap() {
        let p = e.unwrap().path();
        assert_eq!(p, ws, "only the workspace is left of the work dir");
    }
    let code = lake("released");
    assert!(
        matches!(pull_code(&n.api(), &code, NODE, RUN).await.unwrap(), Pulled::Applied { refs_moved: 4 }),
        "main and three stories"
    );
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn a_story_tag_moved_by_a_restart_moves_the_lakes_story_ref() {
    // TC-14
    let n = Node::start().await;
    let ws = n.run_repo_at(RUN, 3);
    let code = lake("moved");
    pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    // The story is run again: a new commit on top, and the tag moves to it.
    std::fs::write(ws.join("restart.txt"), "story 3 again\n").unwrap();
    git(&ws, &["add", "restart.txt"]);
    git(&ws, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "story 3: again"]);
    git(&ws, &["tag", "-f", "story-03"]);
    let new = git(&ws, &["rev-parse", "HEAD"]).trim().to_string();
    pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    assert_eq!(refs(&code, &lake_code::story_ref(NODE, RUN, 3)).values().next(), Some(&new));
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn two_runs_that_share_files_store_them_once() {
    // TC-15
    let n = Node::start().await;
    n.run_repo_at(RUN, 3);
    n.run_repo_at(OTHER, 3);
    let (one, other, both) = (lake("one"), lake("other"), lake("both"));
    pull_code(&n.api(), &one, NODE, RUN).await.unwrap();
    pull_code(&n.api(), &other, NODE, OTHER).await.unwrap();
    pull_code(&n.api(), &both, NODE, RUN).await.unwrap();
    pull_code(&n.api(), &both, NODE, OTHER).await.unwrap();
    git(&both, &["repack", "-adq"]);
    for c in [&one, &other] {
        git(c, &["repack", "-adq"]);
    }
    assert!(
        object_count(&both) < object_count(&one) + object_count(&other),
        "the spec both runs start from is stored once"
    );
    for c in [one, other, both] {
        std::fs::remove_dir_all(c.parent().unwrap()).unwrap();
    }
}

#[tokio::test]
async fn an_unknown_run_or_one_without_a_repository_leaves_the_lake_unchanged() {
    // TC-16 and TC-19
    let n = Node::start().await;
    n.run_repo_at(RUN, 1);
    let code = lake("absent");
    pull_code(&n.api(), &code, NODE, RUN).await.unwrap();
    let before = refs(&code, "refs/");
    assert!(
        matches!(pull_code(&n.api(), &code, NODE, OTHER).await.unwrap(), Pulled::NoCode(_)),
        "not on the node"
    );
    n.make_run(OTHER, false);
    assert!(
        matches!(pull_code(&n.api(), &code, NODE, OTHER).await.unwrap(), Pulled::NoCode(_)),
        "no repository"
    );
    assert_eq!(refs(&code, "refs/"), before);
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn a_node_without_the_code_route_is_told_apart_from_a_run_without_code() {
    // TC-B2, the classification: an old node's 404 has no body; the route's own 404 names the problem.
    let app = axum::Router::new();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let api = Api::new(&NodeEntry {
        url: format!("http://{addr}"),
        token: Some(TOKEN.into()),
    })
    .unwrap();
    let code = lake("old");
    assert_eq!(pull_code(&api, &code, NODE, RUN).await.unwrap(), Pulled::EndpointMissing);
    assert!(refs(&code, "refs/").is_empty());
    std::fs::remove_dir_all(code.parent().unwrap()).unwrap();
}

// ---- the collector's pass ----

/// The combination folder of RUN: the node lists the runs of a folder under combinations/ that has config.sh.
const RUN_COMBINATION: &str = "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi";

fn ctx_for(url: String) -> dbench::client::Ctx {
    dbench::client::Ctx {
        nodes: BTreeMap::from([(
            NODE.to_string(),
            NodeEntry {
                url,
                token: Some(TOKEN.into()),
            },
        )]),
        collect: Default::default(),
        json: false,
    }
}

fn cadence() -> dbench::collector::Cadence {
    dbench::collector::Cadence {
        running_poll: Duration::ZERO,
        finished_recheck: Duration::ZERO,
        settle_grace: Duration::ZERO,
    }
}

#[tokio::test]
async fn a_collector_pass_pulls_a_runs_files_then_its_code_into_the_lake_beside_them() {
    // TC-10 through the pass: the code step follows the file pull, into <state>/code.git beside <state>/collected.
    let n = Node::start().await;
    let ws = n.run_repo_at(RUN, 2);
    std::fs::write(n.shared.cfg.repo.join(RUN_COMBINATION).join("config.sh"), "").unwrap();
    let state = lake("pass").parent().unwrap().to_path_buf();
    let store = state.join("collected");
    let l = dbench::collector::Lake {
        store: &store,
        reference: &state.join("reference"),
    };
    let out = dbench::collector::collect_node_with(&ctx_for(n.base.clone()), NODE, l, &[], &Default::default(), &cadence(), 1, true).await;
    assert!(out.problems.is_empty(), "{:?}", out.problems);
    assert!(
        dbench::collector::store_dir(&store, NODE, RUN).unwrap().join("run.json").is_file(),
        "the files first"
    );
    let main = refs(&ws, "refs/heads/main").into_values().next().unwrap();
    let code = state.join(lake_code::CODE_REPO);
    assert_eq!(refs(&code, &lake_code::head_ref(NODE, RUN, "main")).into_values().next(), Some(main));
    assert_eq!(refs(&code, &format!("{}/story/", lake_code::run_prefix(NODE, RUN))).len(), 2);
    std::fs::remove_dir_all(state).unwrap();
}

#[tokio::test]
async fn a_node_without_the_code_route_still_has_its_files_pulled_and_the_missing_route_is_logged() {
    // TC-B2
    use axum::routing::get;
    use axum::Json;
    const OLD_RUN: &str = "combinations/f/v/x/os/m/eng-pi/benchmarks/p/r1";
    let listing = serde_json::json!({"run": OLD_RUN, "job": null, "run_state": "finished", "job_state": null, "final": true,
        "files": [{"name": "run.json", "size": 2, "mtime": 1.0, "final": true}], "streams": [], "stories": []});
    let app = axum::Router::new()
        .route(
            "/v1/runs",
            get(|| async { Json(serde_json::json!([{"run": OLD_RUN, "job": null, "run_status": null, "job_state": null}])) }),
        )
        .route("/v1/runs/scopes", get(move || std::future::ready(Json(listing.clone()))))
        .route(
            "/v1/runs/scope-file",
            get(|| async {
                (
                    [
                        ("x-dbench-from", "0"),
                        ("x-dbench-size", "2"),
                        ("x-dbench-mtime", "1.0"),
                        ("x-dbench-eof", "1"),
                        ("x-dbench-final", "1"),
                    ],
                    "{}",
                )
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let state = lake("oldpass").parent().unwrap().to_path_buf();
    let store = state.join("collected");
    let l = dbench::collector::Lake {
        store: &store,
        reference: &state.join("reference"),
    };
    let out = dbench::collector::collect_node_with(&ctx_for(format!("http://{addr}")), NODE, l, &[], &Default::default(), &cadence(), 1, true).await;
    assert_eq!(
        std::fs::read(dbench::collector::store_dir(&store, NODE, OLD_RUN).unwrap().join("run.json")).unwrap(),
        b"{}",
        "files pulled"
    );
    assert_eq!(out.runs.len(), 1);
    assert!(
        out.problems
            .iter()
            .any(|p| p.starts_with(lake_code::E_CODE_ENDPOINT_MISSING) && p.contains(OLD_RUN)),
        "{:?}",
        out.problems
    );
    assert!(
        refs(&state.join(lake_code::CODE_REPO), "refs/").is_empty(),
        "the lake's code refs unchanged"
    );
    // The code is still owed: once the node has the new dbench, a pass asks for it though the run is complete.
    assert!(lake_code::is_pending(&state.join(lake_code::CODE_REPO), NODE, OLD_RUN));
    std::fs::remove_dir_all(state).unwrap();
}

#[tokio::test]
async fn a_code_pull_that_fails_with_a_server_error_is_tried_again_on_the_next_pass_though_the_run_is_complete() {
    // 23.28: a 5xx (the node's git failed, a restart mid-answer) is retried on the next pass. A run's code is pulled on
    // the passes that look at it (files changed, or not yet complete), the last being the one where it becomes complete;
    // if that pull fails, the run is complete and unchanged from then on, and its code must still reach the lake.
    use axum::http::StatusCode;
    use axum::routing::get;
    use axum::Json;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    const DONE_RUN: &str = "combinations/f/v/x/os/m/eng-pi/benchmarks/p/r2";
    // The run's code as the node would serve it: one branch and its story tag, as a bundle.
    let work = lake("server-error-src").parent().unwrap().join("work");
    std::fs::create_dir_all(&work).unwrap();
    git(&work, &["init", "-q", "-b", "main"]);
    std::fs::write(work.join("a.ts"), "1").unwrap();
    git(&work, &["add", "-A"]);
    git(&work, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "story 1"]);
    git(&work, &["tag", "story-01"]);
    let bundle_file = work.join("code.bundle");
    git(&work, &["bundle", "create", bundle_file.to_str().unwrap(), "--branches", "--tags"]);
    let bundle = std::fs::read(&bundle_file).unwrap();
    let tip = git(&work, &["rev-parse", "HEAD"]).trim().to_string();
    let code_calls = Arc::new(AtomicU32::new(0));
    let failing = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let calls = code_calls.clone();
    let fails = failing.clone();
    let listing = serde_json::json!({"run": DONE_RUN, "job": null, "run_state": "finished", "job_state": null, "final": true,
        "files": [{"name": "run.json", "size": 2, "mtime": 1.0, "final": true}], "streams": [], "stories": []});
    let app = axum::Router::new()
        .route(
            "/v1/runs",
            get(|| async { Json(serde_json::json!([{"run": DONE_RUN, "job": null, "run_status": null, "job_state": null}])) }),
        )
        .route("/v1/runs/scopes", get(move || std::future::ready(Json(listing.clone()))))
        .route(
            "/v1/runs/scope-file",
            get(|| async {
                (
                    [
                        ("x-dbench-from", "0"),
                        ("x-dbench-size", "2"),
                        ("x-dbench-mtime", "1.0"),
                        ("x-dbench-eof", "1"),
                        ("x-dbench-final", "1"),
                    ],
                    "{}",
                )
            }),
        )
        .route(
            "/v1/runs/code",
            get(move || {
                calls.fetch_add(1, Ordering::SeqCst);
                let fail = fails.load(Ordering::SeqCst);
                let bundle = bundle.clone();
                async move {
                    if fail {
                        (StatusCode::SERVICE_UNAVAILABLE, b"git upload-pack failed".to_vec())
                    } else {
                        (StatusCode::OK, bundle)
                    }
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let state = lake("server-error").parent().unwrap().to_path_buf();
    let store = state.join("collected");
    let l = dbench::collector::Lake {
        store: &store,
        reference: &state.join("reference"),
    };
    let ctx = ctx_for(format!("http://{addr}"));
    let code = state.join(lake_code::CODE_REPO);
    // Passes while every code pull fails, up to the one where the run becomes complete.
    let mut pass = 0u64;
    loop {
        pass += 1;
        assert!(pass < 10, "the run never became complete");
        let out = dbench::collector::collect_node_with(&ctx, NODE, l, &[], &Default::default(), &cadence(), pass, true).await;
        assert!(out.problems.iter().any(|p| p.contains(DONE_RUN) && p.contains("503")), "pass {pass}: {:?}", out.problems);
        if out.runs.iter().all(|r| r.complete) {
            break;
        }
    }
    assert!(refs(&code, "refs/").is_empty(), "nothing taken from a failed pull");
    let asked = code_calls.load(Ordering::SeqCst);
    // The node is well again. The run is complete and its files unchanged: its code is still owed to the lake.
    failing.store(false, Ordering::SeqCst);
    let next = dbench::collector::collect_node_with(&ctx, NODE, l, &[], &Default::default(), &cadence(), pass + 1, true).await;
    assert!(next.problems.is_empty(), "{:?}", next.problems);
    assert_eq!(code_calls.load(Ordering::SeqCst), asked + 1, "the code was asked for again on the next pass");
    assert_eq!(refs(&code, &lake_code::head_ref(NODE, DONE_RUN, "main")).into_values().next(), Some(tip.clone()));
    // Pulled now: a further pass of the complete, unchanged run does not ask again.
    let after = dbench::collector::collect_node_with(&ctx, NODE, l, &[], &Default::default(), &cadence(), pass + 2, true).await;
    assert!(after.problems.is_empty(), "{:?}", after.problems);
    assert_eq!(code_calls.load(Ordering::SeqCst), asked + 1);
    std::fs::remove_dir_all(state).unwrap();
    let _ = std::fs::remove_dir_all(work.parent().unwrap());
}
