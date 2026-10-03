//! `dbench label`: a small local tool for validating pre-labels. Items (a text and the label a model gave it) are shown
//! one at a time; the person accepts or corrects each, and the decisions are appended to a file. Items marked blind
//! hide the model's label until the person has decided, so agreement on them is not anchored. The summary is
//! agreement and Cohen's kappa, overall and for blind and shown items apart, with the table of what was changed to what.

use anyhow::{Context, Result};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const PAGE: &str = include_str!("label.html");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Label {
    pub id: String,
    pub name: String,
    pub definition: String,
}

/// One text to label, with the label a model gave it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Item {
    pub id: String,
    pub text: String,
    /// What came before the text, for the person to read it in place.
    #[serde(default)]
    pub context: Option<String>,
    /// The model's label (a label id) and why.
    pub label: String,
    #[serde(default)]
    pub reason: Option<String>,
    /// Hide the model's label until the person has decided.
    #[serde(default)]
    pub blind: bool,
    /// Anything else worth showing (where it came from).
    #[serde(default)]
    pub meta: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Decision {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub note: Option<String>,
    pub at: f64,
}

/// Agreement of the person with the model over some decided items.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Group {
    pub decided: usize,
    pub agree: usize,
    pub agreement: Option<f64>,
    /// Cohen's kappa between the model's labels and the person's; None with fewer than two decided or no spread.
    pub kappa: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Summary {
    pub total: usize,
    pub decided: usize,
    pub all: Group,
    pub blind: Group,
    pub shown: Group,
    /// model label -> person's label -> how many.
    pub confusion: BTreeMap<String, BTreeMap<String, usize>>,
}

fn group(pairs: &[(&str, &str)]) -> Group {
    let n = pairs.len();
    let agree = pairs.iter().filter(|(m, p)| m == p).count();
    let kappa = (n >= 2).then(|| {
        let po = agree as f64 / n as f64;
        let mut mine: HashMap<&str, f64> = HashMap::new();
        let mut yours: HashMap<&str, f64> = HashMap::new();
        for (m, p) in pairs {
            *mine.entry(m).or_default() += 1.0 / n as f64;
            *yours.entry(p).or_default() += 1.0 / n as f64;
        }
        let pe: f64 = mine.iter().map(|(k, v)| v * yours.get(k).copied().unwrap_or(0.0)).sum();
        (pe < 1.0).then(|| (po - pe) / (1.0 - pe))
    });
    Group { decided: n, agree, agreement: (n > 0).then(|| agree as f64 / n as f64), kappa: kappa.flatten() }
}

pub fn summarise(items: &[Item], decisions: &HashMap<String, Decision>) -> Summary {
    let decided: Vec<(&Item, &Decision)> = items.iter().filter_map(|i| decisions.get(&i.id).map(|d| (i, d))).collect();
    let pairs = |keep: &dyn Fn(&Item) -> bool| -> Vec<(&str, &str)> {
        decided.iter().filter(|(i, _)| keep(i)).map(|(i, d)| (i.label.as_str(), d.label.as_str())).collect()
    };
    let mut confusion: BTreeMap<String, BTreeMap<String, usize>> = BTreeMap::new();
    for (i, d) in &decided {
        *confusion.entry(i.label.clone()).or_default().entry(d.label.clone()).or_default() += 1;
    }
    Summary {
        total: items.len(),
        decided: decided.len(),
        all: group(&pairs(&|_| true)),
        blind: group(&pairs(&|i| i.blind)),
        shown: group(&pairs(&|i| !i.blind)),
        confusion,
    }
}

/// What the page is given for an item: the model's label and reason are withheld for a blind item nobody has decided.
pub fn reveal(item: &Item, decided: bool) -> Value {
    let hide = item.blind && !decided;
    json!({
        "id": item.id, "text": item.text, "context": item.context, "blind": item.blind, "meta": item.meta,
        "label": (!hide).then_some(&item.label), "reason": if hide { None } else { item.reason.as_ref() },
    })
}

fn read_lines<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Vec<T>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    text.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(n, l)| serde_json::from_str(l).with_context(|| format!("{} line {}", path.display(), n + 1)))
        .collect()
}

/// Decisions file: the last decision for an id wins; a file that does not exist yet is no decisions.
pub fn load_decisions(path: &Path) -> Result<HashMap<String, Decision>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }
    Ok(read_lines::<Decision>(path)?.into_iter().map(|d| (d.id.clone(), d)).collect())
}

pub struct Session {
    pub items: Vec<Item>,
    pub labels: Vec<Label>,
    pub decisions: HashMap<String, Decision>,
    pub decisions_path: PathBuf,
}

impl Session {
    pub fn open(items: &Path, labels: &Path, decisions: &Path) -> Result<Session> {
        let items: Vec<Item> = read_lines(items)?;
        let labels: Vec<Label> = serde_json::from_str(&std::fs::read_to_string(labels).with_context(|| format!("read {}", labels.display()))?)
            .with_context(|| format!("{} is not a JSON array of labels", labels.display()))?;
        let ids: std::collections::HashSet<&str> = labels.iter().map(|l| l.id.as_str()).collect();
        anyhow::ensure!(ids.len() == labels.len(), "duplicate label ids");
        for i in &items {
            anyhow::ensure!(ids.contains(i.label.as_str()), "item {} has label {:?}, which is not in the label set", i.id, i.label);
        }
        let unique: std::collections::HashSet<&str> = items.iter().map(|i| i.id.as_str()).collect();
        anyhow::ensure!(unique.len() == items.len(), "duplicate item ids");
        Ok(Session { decisions: load_decisions(decisions)?, items, labels, decisions_path: decisions.to_path_buf() })
    }

    pub fn state(&self) -> Value {
        json!({
            "labels": self.labels,
            "items": self.items.iter().map(|i| reveal(i, self.decisions.contains_key(&i.id))).collect::<Vec<_>>(),
            "decisions": self.decisions,
            "summary": summarise(&self.items, &self.decisions),
        })
    }

    /// Record a decision: appended to the file, so nothing is rewritten, and the last for an id wins.
    pub fn decide(&mut self, id: &str, label: &str, note: Option<String>, at: f64) -> std::result::Result<Decision, String> {
        if !self.items.iter().any(|i| i.id == id) {
            return Err(format!("no item {id:?}"));
        }
        if !self.labels.iter().any(|l| l.id == label) {
            return Err(format!("no label {label:?}"));
        }
        let d = Decision { id: id.to_string(), label: label.to_string(), note: note.filter(|n| !n.trim().is_empty()), at };
        let line = serde_json::to_string(&d).map_err(|e| e.to_string())?;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&self.decisions_path).map_err(|e| e.to_string())?;
        writeln!(f, "{line}").map_err(|e| e.to_string())?;
        self.decisions.insert(d.id.clone(), d.clone());
        Ok(d)
    }
}

type Shared = Arc<Mutex<Session>>;

#[derive(Deserialize)]
struct DecisionBody {
    id: String,
    label: String,
    note: Option<String>,
}

fn no_store(r: impl IntoResponse) -> Response {
    let mut r = r.into_response();
    r.headers_mut().insert(axum::http::header::CACHE_CONTROL, axum::http::HeaderValue::from_static("no-store"));
    r
}

pub fn router(session: Shared) -> Router {
    Router::new()
        .route("/", get(|| async { no_store(Html(PAGE)) }))
        .route("/api/state", get(|State(s): State<Shared>| async move { no_store(Json(s.lock().expect("session").state())) }))
        .route(
            "/api/decision",
            post(|State(s): State<Shared>, Json(b): Json<DecisionBody>| async move {
                let at = crate::timefmt::now_secs() as f64;
                let mut s = s.lock().expect("session");
                match s.decide(&b.id, &b.label, b.note, at) {
                    Ok(_) => no_store(Json(s.state())),
                    Err(e) => no_store((StatusCode::BAD_REQUEST, Json(json!({ "error": e })))),
                }
            }),
        )
        .with_state(session)
}

pub async fn cmd_label(args: &crate::cli::LabelArgs) -> Result<()> {
    let session = Session::open(&args.items, &args.labels, &args.decisions)?;
    let listener = tokio::net::TcpListener::bind(&args.bind).await?;
    eprintln!(
        "dbench label: {} items, {} decided; http://{} (decisions in {})",
        session.items.len(),
        session.decisions.len(),
        listener.local_addr()?,
        args.decisions.display()
    );
    axum::serve(listener, router(Arc::new(Mutex::new(session)))).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, label: &str, blind: bool) -> Item {
        Item { id: id.into(), text: format!("text {id}"), context: None, label: label.into(), reason: Some("because".into()), blind, meta: Value::Null }
    }
    fn dec(id: &str, label: &str) -> (String, Decision) {
        (id.into(), Decision { id: id.into(), label: label.into(), note: None, at: 1.0 })
    }

    #[test]
    fn agreement_and_kappa_over_decided_items_only() {
        let items = vec![item("a", "x", false), item("b", "x", false), item("c", "y", false), item("d", "y", false), item("e", "x", false)];
        let d: HashMap<_, _> = [dec("a", "x"), dec("b", "y"), dec("c", "y"), dec("d", "y")].into();
        let s = summarise(&items, &d);
        assert_eq!((s.total, s.decided, s.all.agree), (5, 4, 3));
        assert_eq!(s.all.agreement, Some(0.75));
        // mine: x 2, y 2; yours: x 1, y 3 over 4 items; po = 0.75, pe = 0.5*0.25 + 0.5*0.75 = 0.5; kappa = 0.5.
        assert_eq!(s.all.kappa, Some(0.5));
        assert_eq!(s.confusion["x"]["y"], 1);
        assert_eq!(s.confusion["y"]["y"], 2);
    }

    #[test]
    fn kappa_has_no_value_with_one_decision_or_no_spread() {
        let items = vec![item("a", "x", false), item("b", "x", false)];
        assert_eq!(summarise(&items, &[dec("a", "x")].into()).all.kappa, None);
        assert_eq!(summarise(&items, &[dec("a", "x"), dec("b", "x")].into()).all.kappa, None);
        assert_eq!(summarise(&items, &HashMap::new()).all, Group::default());
    }

    #[test]
    fn blind_and_shown_agreement_are_kept_apart() {
        let items = vec![item("a", "x", true), item("b", "x", true), item("c", "x", false), item("d", "x", false)];
        let d: HashMap<_, _> = [dec("a", "x"), dec("b", "y"), dec("c", "x"), dec("d", "x")].into();
        let s = summarise(&items, &d);
        assert_eq!((s.blind.agreement, s.shown.agreement, s.all.agreement), (Some(0.5), Some(1.0), Some(0.75)));
    }

    #[test]
    fn a_blind_item_hides_the_models_label_until_it_is_decided() {
        let b = item("a", "x", true);
        let hidden = reveal(&b, false);
        assert!(hidden["label"].is_null() && hidden["reason"].is_null(), "{hidden}");
        assert_eq!(reveal(&b, true)["label"], "x");
        let shown = reveal(&item("b", "x", false), false);
        assert_eq!((shown["label"].as_str(), shown["reason"].as_str()), (Some("x"), Some("because")));
        assert!(!hidden.to_string().contains("because"));
    }
}
