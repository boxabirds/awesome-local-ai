//! `dbench label` over HTTP: the page, the state it serves (a blind item's label withheld until decided), decisions
//! appended to a file and read back, and what a malformed set of files is refused for.

use dbench::label::{router, Session};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dbench-label-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn files(dir: &Path) -> (PathBuf, PathBuf, PathBuf) {
    let items = dir.join("items.jsonl");
    let labels = dir.join("labels.json");
    std::fs::write(
        &items,
        [
            json!({"id": "a", "text": "Let me look at the spec.", "label": "plan", "reason": "states what to read next", "blind": true}),
            json!({"id": "b", "text": "Wait, that is wrong; let me check again.", "label": "doubt", "reason": "a self-correction"}),
            json!({"id": "c", "text": "Run the tests again.", "label": "verify", "blind": false, "context": "after a green run"}),
        ]
        .iter()
        .map(|v| v.to_string() + "\n")
        .collect::<String>(),
    )
    .unwrap();
    std::fs::write(
        &labels,
        json!([{"id": "plan", "name": "Planning", "definition": "decides what to do"}, {"id": "doubt", "name": "Doubt", "definition": "second-guesses"}, {"id": "verify", "name": "Re-verifying", "definition": "checks again"}]).to_string(),
    )
    .unwrap();
    (items, labels, dir.join("decisions.jsonl"))
}

async fn serve(session: Session) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router(Arc::new(Mutex::new(session)))).await.unwrap() });
    format!("http://{addr}")
}

#[tokio::test]
async fn the_page_and_state_are_served_and_a_blind_label_is_withheld() {
    let dir = scratch("state");
    let (i, l, d) = files(&dir);
    let base = serve(Session::open(&i, &l, &d).unwrap()).await;
    let page = reqwest::get(&base).await.unwrap();
    assert!(page.headers()["content-type"].to_str().unwrap().starts_with("text/html"));
    assert!(page.text().await.unwrap().contains("Label check"));
    let state: Value = reqwest::get(format!("{base}/api/state")).await.unwrap().json().await.unwrap();
    assert_eq!(state["items"].as_array().unwrap().len(), 3);
    assert_eq!(state["items"][0]["label"], Value::Null); // blind, undecided
    assert_eq!(state["items"][0]["reason"], Value::Null);
    assert_eq!(state["items"][1]["label"], "doubt"); // shown
    assert_eq!(state["summary"]["decided"], 0);
    assert!(!state.to_string().contains("states what to read next"), "the blind item's reason must not be in the state at all");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[tokio::test]
async fn a_decision_is_appended_reveals_the_blind_label_and_is_read_back() {
    let dir = scratch("decide");
    let (i, l, d) = files(&dir);
    let base = serve(Session::open(&i, &l, &d).unwrap()).await;
    let client = reqwest::Client::new();
    let post = |body: Value| client.post(format!("{base}/api/decision")).json(&body).send();
    let state: Value = post(json!({"id": "a", "label": "doubt", "note": "it is planning, but hesitant"})).await.unwrap().json().await.unwrap();
    assert_eq!(state["items"][0]["label"], "plan"); // revealed now it is decided
    assert_eq!(state["summary"]["blind"]["decided"], 1);
    assert_eq!(state["summary"]["blind"]["agreement"], 0.0);
    assert_eq!(state["summary"]["confusion"]["plan"]["doubt"], 1);
    post(json!({"id": "b", "label": "doubt"})).await.unwrap();
    post(json!({"id": "a", "label": "plan"})).await.unwrap(); // changed his mind: the last wins
    let lines: Vec<Value> = std::fs::read_to_string(&d).unwrap().lines().map(|x| serde_json::from_str(x).unwrap()).collect();
    assert_eq!(lines.len(), 3); // appended, nothing rewritten
    assert_eq!(lines[0]["note"], "it is planning, but hesitant");
    // A new session on the same files starts where this one ended.
    let again = Session::open(&i, &l, &d).unwrap();
    assert_eq!(again.decisions.len(), 2);
    assert_eq!(again.decisions["a"].label, "plan");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[tokio::test]
async fn an_unknown_item_or_label_is_refused_and_nothing_is_written() {
    let dir = scratch("refuse");
    let (i, l, d) = files(&dir);
    let base = serve(Session::open(&i, &l, &d).unwrap()).await;
    let client = reqwest::Client::new();
    for body in [json!({"id": "zzz", "label": "plan"}), json!({"id": "a", "label": "nonsense"})] {
        let res = client.post(format!("{base}/api/decision")).json(&body).send().await.unwrap();
        assert_eq!(res.status(), 400);
        assert!(res.json::<Value>().await.unwrap()["error"].as_str().unwrap().contains("no "));
    }
    assert!(!d.exists());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn files_that_disagree_are_refused_at_start() {
    let dir = scratch("bad");
    let (i, l, d) = files(&dir);
    // An item with a label that is not in the set.
    std::fs::write(&i, json!({"id": "a", "text": "t", "label": "ghost"}).to_string() + "\n").unwrap();
    let err = Session::open(&i, &l, &d).err().unwrap().to_string();
    assert!(err.contains("ghost") && err.contains("not in the label set"), "{err}");
    // Two items with one id.
    std::fs::write(&i, format!("{0}\n{0}\n", json!({"id": "a", "text": "t", "label": "plan"}))).unwrap();
    assert!(Session::open(&i, &l, &d).err().unwrap().to_string().contains("duplicate item ids"));
    // A line that is not JSON names its line.
    std::fs::write(&i, "{not json}\n").unwrap();
    assert!(Session::open(&i, &l, &d).err().unwrap().to_string().contains("line 1"));
    std::fs::remove_dir_all(&dir).unwrap();
}
