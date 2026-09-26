//! The controller CLI: talks to the servers listed in `~/.config/dbench/nodes.toml`.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::events::Event;
use crate::job::{JobSpec, JobState};
use crate::node::NodeInfo;
use crate::progress::{StoryProgress, TaskProgress};
use crate::server::JobView;
use crate::timefmt::{fmt_duration, now_secs};

pub const CONFIG_REL: &str = ".config/dbench/nodes.toml";
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Whole-request limit for everything except a followed log.
/// `/v1/node` runs tool probes, so this is above the server's probe timeout.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Reconnects when a followed log drops before the job ends.
pub const FOLLOW_RECONNECTS: u32 = 5;
pub const FOLLOW_RECONNECT_BACKOFF: Duration = Duration::from_secs(2);
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
const MIB_PER_GIB: f64 = 1024.0;

#[derive(Deserialize, Debug, Clone)]
pub struct NodeEntry {
    pub url: String,
    pub token: Option<String>,
}

#[derive(Deserialize, Debug)]
struct NodesFile {
    #[serde(default)]
    nodes: BTreeMap<String, NodeEntry>,
}

pub fn default_config_path() -> Result<PathBuf> {
    Ok(PathBuf::from(std::env::var_os("HOME").context("HOME is not set")?).join(CONFIG_REL))
}

pub fn load_nodes(path: &Path) -> Result<BTreeMap<String, NodeEntry>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let f: NodesFile =
        toml::from_str(&text).with_context(|| format!("parse {}", path.display()))?;
    Ok(f.nodes)
}

#[derive(Clone)]
pub struct Api {
    http: reqwest::Client,
    base: String,
    token: Option<String>,
}

impl Api {
    pub fn new(entry: &NodeEntry) -> Result<Api> {
        let http = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .build()?;
        Ok(Api {
            http,
            base: entry.url.trim_end_matches('/').to_string(),
            token: entry.token.clone(),
        })
    }

    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let r = self.http.request(method, format!("{}{path}", self.base));
        match &self.token {
            Some(t) => r.bearer_auth(t),
            None => r,
        }
    }

    async fn send(
        &self,
        rb: reqwest::RequestBuilder,
    ) -> Result<(reqwest::StatusCode, serde_json::Value)> {
        let resp = rb.timeout(REQUEST_TIMEOUT).send().await?;
        let status = resp.status();
        let body = resp.text().await?;
        let v = serde_json::from_str(&body).unwrap_or(serde_json::Value::String(body));
        Ok((status, v))
    }

    async fn get_ok<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let (status, v) = self.send(self.req(reqwest::Method::GET, path)).await?;
        if !status.is_success() {
            bail!("{status}: {}", error_text(&v));
        }
        Ok(serde_json::from_value(v)?)
    }

    pub async fn node(&self) -> Result<NodeInfo> {
        self.get_ok("/v1/node").await
    }

    pub async fn jobs(&self) -> Result<Vec<JobView>> {
        self.get_ok("/v1/jobs").await
    }

    pub async fn job(&self, id: &str) -> Result<JobView> {
        self.get_ok(&format!("/v1/jobs/{id}")).await
    }

    pub async fn events(&self, id: &str) -> Result<Vec<Event>> {
        #[derive(Deserialize)]
        struct E {
            events: Vec<Event>,
        }
        Ok(self
            .get_ok::<E>(&format!("/v1/jobs/{id}/events"))
            .await?
            .events)
    }

    pub async fn submit(
        &self,
        id: &str,
        spec: &JobSpec,
    ) -> Result<(reqwest::StatusCode, serde_json::Value)> {
        self.send(
            self.req(reqwest::Method::PUT, &format!("/v1/jobs/{id}"))
                .json(spec),
        )
        .await
    }

    pub async fn cancel(&self, id: &str) -> Result<(reqwest::StatusCode, serde_json::Value)> {
        self.send(self.req(reqwest::Method::POST, &format!("/v1/jobs/{id}/cancel")))
            .await
    }

    pub async fn skip_story(
        &self,
        id: &str,
        story: u32,
        reason: &str,
    ) -> Result<(reqwest::StatusCode, serde_json::Value)> {
        self.send(
            self.req(reqwest::Method::POST, &format!("/v1/jobs/{id}/skip-story"))
                .json(&crate::control::SkipStoryRequest {
                    story,
                    reason: reason.to_string(),
                }),
        )
        .await
    }

    /// Stream the log to `out` from `from`; returns the offset reached.
    pub async fn stream_log(
        &self,
        id: &str,
        from: u64,
        follow: bool,
        out: &mut impl Write,
    ) -> Result<u64> {
        let path = format!(
            "/v1/jobs/{id}/log?from={from}&follow={}",
            if follow { 1 } else { 0 }
        );
        let mut rb = self.req(reqwest::Method::GET, &path);
        if !follow {
            rb = rb.timeout(REQUEST_TIMEOUT);
        }
        let mut resp = rb.send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            bail!("{status}: {text}");
        }
        let mut offset = from;
        while let Some(chunk) = resp.chunk().await? {
            out.write_all(&chunk)?;
            out.flush()?;
            offset += chunk.len() as u64;
        }
        Ok(offset)
    }
}

fn error_text(v: &serde_json::Value) -> String {
    v.get("error")
        .and_then(|e| e.as_str())
        .map(String::from)
        .unwrap_or_else(|| v.to_string())
}

pub struct Ctx {
    pub nodes: BTreeMap<String, NodeEntry>,
    pub json: bool,
}

impl Ctx {
    pub fn load(config: Option<PathBuf>, json: bool) -> Result<Ctx> {
        let path = match config {
            Some(p) => p,
            None => default_config_path()?,
        };
        Ok(Ctx {
            nodes: load_nodes(&path)?,
            json,
        })
    }

    fn api(&self, node: &str) -> Result<Api> {
        let entry = self.nodes.get(node).with_context(|| {
            format!(
                "no node {node:?} in the config (have: {})",
                self.nodes.keys().cloned().collect::<Vec<_>>().join(", ")
            )
        })?;
        Api::new(entry)
    }
}

fn print_json(v: &impl serde::Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(v)?);
    Ok(())
}

fn gib(bytes: Option<u64>) -> String {
    bytes
        .map(|b| format!("{:.0} GiB", b as f64 / GIB))
        .unwrap_or_else(|| "?".into())
}

pub fn state_text(state: &JobState) -> String {
    let now = now_secs();
    match state {
        JobState::Queued => "queued".into(),
        JobState::Running {
            pid,
            attempt,
            started_at,
            ..
        } => {
            format!(
                "running (attempt {attempt}, pid {pid}, {})",
                fmt_duration(now.saturating_sub(*started_at))
            )
        }
        JobState::Done { exit_code } => format!("done (exit {exit_code})"),
        JobState::Failed { reason, .. } => format!("failed: {reason}"),
        JobState::Cancelled => "cancelled".into(),
    }
}

fn last_score(v: &JobView) -> String {
    v.progress
        .stories
        .iter()
        .rev()
        .find(|s| s.passed.is_some() || s.total.is_some())
        .map(|s| {
            format!(
                "story {} {}/{}",
                s.id,
                s.passed.map_or("?".into(), |p| p.to_string()),
                s.total.map_or("?".into(), |t| t.to_string())
            )
        })
        .unwrap_or_else(|| "-".into())
}

pub async fn cmd_nodes(ctx: &Ctx) -> Result<()> {
    let futs = ctx.nodes.iter().map(|(name, entry)| async move {
        let res = match Api::new(entry) {
            Ok(api) => api.node().await,
            Err(e) => Err(e),
        };
        (name.clone(), entry.url.clone(), res)
    });
    let results = futures_util::future::join_all(futs).await;
    if ctx.json {
        let v: BTreeMap<String, serde_json::Value> = results
            .into_iter()
            .map(|(n, url, r)| {
                let val = match r {
                    Ok(info) => serde_json::json!({"url": url, "status": "ok", "node": info}),
                    Err(e) => serde_json::json!({"url": url, "status": "unreachable", "error": format!("{e:#}")}),
                };
                (n, val)
            })
            .collect();
        return print_json(&v);
    }
    println!(
        "{:<12} {:<12} {:<16} {:<14} {:<8} {:<34} JOB",
        "NODE", "STATUS", "HOST", "OS/ARCH", "RAM", "GPU"
    );
    for (name, _url, r) in results {
        match r {
            Ok(n) => {
                let gpu = n
                    .gpus
                    .iter()
                    .map(|g| match (g.unified, g.memory_mib) {
                        (false, Some(m)) => format!("{} {:.0}G", g.name, m as f64 / MIB_PER_GIB),
                        _ => g.name.clone(),
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                println!(
                    "{:<12} {:<12} {:<16} {:<14} {:<8} {:<34} {}",
                    name,
                    "ok",
                    n.hostname,
                    format!("{}/{}", n.os, n.arch),
                    gib(n.total_ram_bytes),
                    if gpu.is_empty() { "-".into() } else { gpu },
                    n.current_job.unwrap_or_else(|| "-".into())
                );
                let combos: Vec<String> = n
                    .combinations
                    .iter()
                    .filter_map(|c| c.install_id.clone())
                    .collect();
                let missing: Vec<&String> = n
                    .tools
                    .iter()
                    .filter(|(_, v)| v.is_none())
                    .map(|(k, _)| k)
                    .collect();
                println!(
                    "{:<12} installs: {}; missing tools: {}; repo {}",
                    "",
                    if combos.is_empty() {
                        "none".into()
                    } else {
                        combos.join(", ")
                    },
                    if missing.is_empty() {
                        "none".into()
                    } else {
                        missing
                            .iter()
                            .map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    },
                    n.repo_head
                        .as_deref()
                        .map(|h| &h[..h.len().min(SHORT_SHA)])
                        .unwrap_or("?")
                );
            }
            Err(e) => println!("{:<12} {:<12} {e:#}", name, "unreachable"),
        }
    }
    Ok(())
}

const SHORT_SHA: usize = 7;

pub async fn cmd_submit(ctx: &Ctx, node: &str, id: &str, spec: JobSpec) -> Result<()> {
    let (status, v) = ctx.api(node)?.submit(id, &spec).await?;
    if ctx.json {
        print_json(&v)?;
    }
    match status.as_u16() {
        201 => eprintln!("{node}: job {id} queued"),
        200 => eprintln!("{node}: job {id} already exists with this spec (no change)"),
        409 => bail!("{node}: job {id} already exists with a different spec"),
        _ => bail!("{node}: {status}: {}", error_text(&v)),
    }
    if !ctx.json {
        let view: JobView = serde_json::from_value(v)?;
        println!("{}  {}", view.job.id, state_text(&view.job.state));
    }
    Ok(())
}

/// Longest story title in a story line, and task title in the task table.
const TITLE_CHARS: usize = 44;
/// Longest recent-activity line shown.
const ACTIVITY_CHARS: usize = 110;
/// How many of the harness's recent-activity lines to show.
const ACTIVITY_LINES: usize = 5;
/// Task statuses in the order a task moves through them (see the harness's progress.py).
const TASK_STATUSES: [&str; 4] = ["verified", "committed", "written", "not-started"];

/// `572`, `164k`, `1.2M`.
fn fmt_count(n: u64) -> String {
    match n {
        0..=9_999 => n.to_string(),
        10_000..=999_999 => format!("{}k", (n + 500) / 1000),
        _ => format!("{:.1}M", n as f64 / 1e6),
    }
}

/// How long ago a Unix time (from the harness, fractional) was, for humans.
fn ago(now: u64, at: f64) -> String {
    fmt_duration(now.saturating_sub(at.max(0.0) as u64))
}

fn agent_time(minutes: f64) -> String {
    fmt_duration((minutes.max(0.0) * 60.0).round() as u64)
}

/// At most `n` characters, with `…` when cut.
fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

fn opt_u64(v: Option<u64>) -> String {
    v.map_or("?".into(), |n| n.to_string())
}

/// `tasks: 7 committed, 2 written`, most advanced first.
pub fn task_summary(tasks: &[TaskProgress]) -> Option<String> {
    if tasks.is_empty() {
        return None;
    }
    let mut counts: Vec<(String, usize)> =
        TASK_STATUSES.iter().map(|s| (s.to_string(), 0)).collect();
    for t in tasks {
        let status = t.status.as_deref().unwrap_or("unknown");
        match counts.iter_mut().find(|(s, _)| s == status) {
            Some((_, n)) => *n += 1,
            None => counts.push((status.to_string(), 1)),
        }
    }
    let parts: Vec<String> = counts
        .into_iter()
        .filter(|(_, n)| *n > 0)
        .map(|(s, n)| format!("{n} {s}"))
        .collect();
    Some(format!("tasks: {}", parts.join(", ")))
}

/// One line per story: id, status, title, then whatever the harness reported.
pub fn story_line(s: &StoryProgress, now: u64) -> String {
    let status = s.status.as_deref().unwrap_or("-");
    let running = status == "running";
    let mut parts: Vec<String> = Vec::new();
    if let Some(m) = s.agent_minutes {
        parts.push(format!("agent {}", agent_time(m)));
    }
    if let Some(c) = s.calls {
        parts.push(format!("{} calls", fmt_count(c)));
    }
    if let Some(t) = s.output_tokens {
        parts.push(format!("{} tokens", fmt_count(t)));
    }
    if let Some(c) = s.compactions.filter(|c| *c > 0) {
        parts.push(format!("{c} compactions"));
    }
    if s.passed.is_some() || s.total.is_some() {
        parts.push(format!("accept {}/{}", opt_u64(s.passed), opt_u64(s.total)));
    }
    match s.last_commit_at {
        Some(at) => parts.push(format!("last commit {} ago", ago(now, at))),
        None if running => parts.push("no commit yet".into()),
        None => {}
    }
    parts.extend(task_summary(&s.tasks));
    if status == "PARTIAL" {
        parts.push(format!("verdict {}", s.verdict.as_deref().unwrap_or("?")));
    }
    let head = format!(
        "{:>3}  {:<8} {:<w$}",
        if s.id.is_empty() { "?" } else { &s.id },
        status,
        clip(s.title.as_deref().unwrap_or(""), TITLE_CHARS),
        w = TITLE_CHARS
    );
    if parts.is_empty() {
        head.trim_end().to_string()
    } else {
        format!("{head}  {}", parts.join("  "))
    }
}

fn story_ref(v: &serde_json::Value) -> String {
    v.as_str().map_or_else(|| v.to_string(), String::from)
}

/// Why a PARTIAL story ended and what it was built on, if known.
fn story_note(s: &StoryProgress) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(r) = &s.reason {
        parts.push(format!(
            "ended by {}: {r}",
            s.ended_by.as_deref().unwrap_or("?")
        ));
    }
    if !s.partial_base.is_empty() {
        let base: Vec<String> = s.partial_base.iter().map(story_ref).collect();
        parts.push(format!("built on PARTIAL {}", base.join(", ")));
    }
    (!parts.is_empty()).then(|| parts.join("; "))
}

/// The story to show in detail: the running one, else the current one, else
/// the last one the harness started.
fn focus_story<'a>(
    stories: &'a [StoryProgress],
    current: Option<&str>,
) -> Option<&'a StoryProgress> {
    stories
        .iter()
        .find(|s| s.status.as_deref() == Some("running"))
        .or_else(|| current.and_then(|c| stories.iter().find(|s| s.id == c && s.status.is_some())))
        .or_else(|| {
            stories
                .iter()
                .rev()
                .find(|s| s.started_at.is_some() || !s.tasks.is_empty())
        })
}

/// A story's task table, baselines and latest activity.
pub fn story_detail(s: &StoryProgress, now: u64) -> Vec<String> {
    let mut out = Vec::new();
    let status = s.status.as_deref().unwrap_or("-");
    let mut head = format!("story {} {status}", s.id);
    if let Some(start) = s.started_at {
        match s.ended_at {
            Some(end) => head.push_str(&format!(
                ", took {}",
                fmt_duration((end - start).max(0.0) as u64)
            )),
            None => head.push_str(&format!(", started {} ago", ago(now, start))),
        }
    }
    if let Some(at) = s.last_task_change_at {
        head.push_str(&format!(", last task change {} ago", ago(now, at)));
    }
    out.push(head);
    if !s.tasks.is_empty() {
        out.push(format!(
            "  {:>3}  {:<11} {:<14} {:<7} TITLE",
            "N", "STATUS", "TYPE", "TCS"
        ));
        for t in &s.tasks {
            let tcs = match (t.found, t.total) {
                (None, None) => "-".to_string(),
                (f, tot) => format!("{}/{}", opt_u64(f), opt_u64(tot)),
            };
            out.push(format!(
                "  {:>3}  {:<11} {:<14} {:<7} {}",
                t.n.map_or("?".into(), |n| n.to_string()),
                t.status.as_deref().unwrap_or("?"),
                clip(t.kind.as_deref().unwrap_or("-"), 14),
                tcs,
                clip(t.title.as_deref().unwrap_or(""), TITLE_CHARS + 20)
            ));
        }
    }
    if !s.baselines.is_empty() {
        out.push("  baselines".into());
        for b in &s.baselines {
            let mut parts = vec![format!("{:<7}", b.status.as_deref().unwrap_or("?"))];
            if let Some(m) = b.agent_minutes {
                parts.push(format!("agent {:<6}", agent_time(m)));
            }
            if let Some(c) = b.calls {
                parts.push(format!("{:>5} calls", fmt_count(c)));
            }
            if let Some(t) = b.output_tokens {
                parts.push(format!("{:>5} tokens", fmt_count(t)));
            }
            parts.push(b.source.clone().unwrap_or_default());
            out.push(format!("    {}", parts.join("  ").trim_end()));
        }
    }
    if !s.recent_activity.is_empty() {
        out.push("  recent activity".into());
        let skip = s.recent_activity.len().saturating_sub(ACTIVITY_LINES);
        for a in &s.recent_activity[skip..] {
            out.push(format!("    {}", clip(a.trim(), ACTIVITY_CHARS)));
        }
    }
    out
}

fn print_job_line(node: &str, v: &JobView) {
    println!(
        "{:<12} {:<24} {:<24} {:<8} {:<16} {}",
        node,
        v.job.id,
        v.job.spec.run_id,
        v.progress.current_story.as_deref().unwrap_or("-"),
        last_score(v),
        state_text(&v.job.state)
    );
    if let Some(s) = v
        .progress
        .stories
        .iter()
        .find(|s| s.status.as_deref() == Some("running"))
    {
        println!("{:<12} {}", "", story_line(s, now_secs()));
    }
}

fn print_job_detail(node: &str, v: &JobView) {
    let j = &v.job;
    println!("job       {} on {node}", j.id);
    println!("state     {}", state_text(&j.state));
    println!(
        "spec      install {} pack {} run {} client {} record {}{}{}",
        j.spec.install_id,
        j.spec.pack,
        j.spec.run_id,
        j.spec.client.as_str(),
        j.spec.record,
        j.spec
            .scope
            .as_deref()
            .map(|s| format!(" scope {s}"))
            .unwrap_or_default(),
        j.spec
            .stories
            .as_ref()
            .map(|s| format!(" stories {s:?}"))
            .unwrap_or_default()
    );
    if !j.spec.server_env.is_empty() {
        let env: Vec<String> = j
            .spec
            .server_env
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        println!("env       {}", env.join(" "));
    }
    println!("attempts  {}", j.attempt);
    if let Some(p) = &j.last_pull {
        println!(
            "git pull  {}",
            if p.ok {
                "ok".to_string()
            } else {
                format!("FAILED: {}", p.detail)
            }
        );
    }
    if let Some(d) = &v.progress.run_dir {
        println!("run dir   {d}");
    }
    if let Some(e) = &v.progress.error {
        println!("progress  {e}");
    }
    println!(
        "current   story {}",
        v.progress.current_story.as_deref().unwrap_or("-")
    );
    let now = now_secs();
    let stories = &v.progress.stories;
    if !stories.is_empty() {
        match v.progress.stories_updated_at {
            Some(at) => println!("stories   (harness progress updated {} ago)", ago(now, at)),
            None => println!("stories   (finished only: the harness writes no progress.json)"),
        }
    }
    for s in stories {
        println!("  {}", story_line(s, now));
        if let Some(note) = story_note(s) {
            println!("  {:>3}  {:<8} {note}", "", "");
        }
    }
    if let Some(s) = focus_story(stories, v.progress.current_story.as_deref()) {
        for l in story_detail(s, now) {
            println!("  {l}");
        }
    }
    if !j.history.is_empty() {
        println!("history");
        for n in &j.history {
            println!("  {}  {}", crate::timefmt::fmt_utc(n.at), n.text);
        }
    }
    println!("log (last {} lines)", v.progress.log_tail.len());
    for l in &v.progress.log_tail {
        println!("  {l}");
    }
}

pub async fn cmd_status(ctx: &Ctx, node: Option<&str>, id: Option<&str>) -> Result<()> {
    if let (Some(node), Some(id)) = (node, id) {
        let v = ctx.api(node)?.job(id).await?;
        return if ctx.json {
            print_json(&v)
        } else {
            print_job_detail(node, &v);
            Ok(())
        };
    }
    let names: Vec<String> = match node {
        Some(n) => {
            ctx.api(n)?;
            vec![n.to_string()]
        }
        None => ctx.nodes.keys().cloned().collect(),
    };
    let futs = names.iter().map(|n| async move {
        let r = match ctx.api(n) {
            Ok(api) => api.jobs().await,
            Err(e) => Err(e),
        };
        (n.clone(), r)
    });
    let results = futures_util::future::join_all(futs).await;
    if ctx.json {
        let v: BTreeMap<String, serde_json::Value> = results
            .into_iter()
            .map(|(n, r)| {
                (
                    n,
                    r.map_or_else(
                        |e| serde_json::json!({"error": format!("{e:#}")}),
                        |j| serde_json::json!(j),
                    ),
                )
            })
            .collect();
        return print_json(&v);
    }
    println!(
        "{:<12} {:<24} {:<24} {:<8} {:<16} STATE",
        "NODE", "JOB", "RUN", "STORY", "LAST ACCEPT"
    );
    for (n, r) in results {
        match r {
            Ok(jobs) if jobs.is_empty() => println!("{n:<12} (no jobs)"),
            Ok(jobs) => jobs.iter().for_each(|j| print_job_line(&n, j)),
            Err(e) => println!("{n:<12} unreachable: {e:#}"),
        }
    }
    Ok(())
}

pub async fn cmd_logs(ctx: &Ctx, node: &str, id: &str, follow: bool, from: u64) -> Result<()> {
    let api = ctx.api(node)?;
    let mut out = std::io::stdout().lock();
    let mut offset = from;
    let mut failures = 0;
    loop {
        match api.stream_log(id, offset, follow, &mut out).await {
            Ok(o) => offset = o,
            Err(e) => {
                if !follow || failures >= FOLLOW_RECONNECTS {
                    return Err(e);
                }
                failures += 1;
                eprintln!("dbench: log stream dropped ({e:#}); reconnecting from byte {offset}");
                tokio::time::sleep(FOLLOW_RECONNECT_BACKOFF).await;
                continue;
            }
        }
        if !follow {
            return Ok(());
        }
        // The server ends a followed stream when the job finishes. Make sure it did.
        match api.job(id).await {
            Ok(v) if v.job.state.is_terminal() => {
                eprintln!("dbench: job {id} {}", state_text(&v.job.state));
                return Ok(());
            }
            _ => tokio::time::sleep(FOLLOW_RECONNECT_BACKOFF).await,
        }
    }
}

pub async fn cmd_events(ctx: &Ctx, node: &str, id: &str) -> Result<()> {
    let events = ctx.api(node)?.events(id).await?;
    if ctx.json {
        return print_json(&events);
    }
    for e in events {
        let mut v = serde_json::to_value(&e)?;
        let obj = v.as_object_mut().expect("object");
        let kind = obj
            .remove("kind")
            .and_then(|k| k.as_str().map(String::from))
            .unwrap_or_default();
        obj.remove("line");
        obj.remove("story");
        let rest: Vec<String> = obj.iter().map(|(k, v)| format!("{k}={v}")).collect();
        println!(
            "{:>6}  story {:<4} {:<16} {}",
            e.line,
            e.story.map_or("-".into(), |s| s.to_string()),
            kind,
            rest.join(" ")
        );
    }
    Ok(())
}

pub async fn cmd_cancel(ctx: &Ctx, node: &str, id: &str) -> Result<()> {
    let (status, v) = ctx.api(node)?.cancel(id).await?;
    if ctx.json {
        print_json(&v)?;
    }
    match status.as_u16() {
        200 => eprintln!("{node}: job {id} cancelled"),
        202 => eprintln!("{node}: job {id} is being stopped (SIGTERM to its process group, SIGKILL after the grace period)"),
        _ => bail!("{node}: {status}: {}", error_text(&v)),
    }
    Ok(())
}

pub async fn cmd_skip_story(
    ctx: &Ctx,
    node: &str,
    id: &str,
    story: u32,
    reason: &str,
) -> Result<()> {
    let (status, v) = ctx.api(node)?.skip_story(id, story, reason).await?;
    if ctx.json {
        print_json(&v)?;
    }
    match status.as_u16() {
        202 => eprintln!("{node}: job {id}: story {story} will be ended as PARTIAL within a few seconds; the run continues with the next story"),
        _ => bail!("{node}: {status}: {}", error_text(&v)),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nodes_toml() {
        let f: NodesFile = toml::from_str(
            "[nodes.gruntus]\nurl = \"http://gruntus:7717\"\ntoken = \"abc\"\n[nodes.quintus]\nurl = \"http://quintus:7717/\"\n",
        )
        .unwrap();
        assert_eq!(f.nodes["gruntus"].token.as_deref(), Some("abc"));
        assert_eq!(
            Api::new(&f.nodes["quintus"]).unwrap().base,
            "http://quintus:7717"
        );
    }

    fn story(json: serde_json::Value) -> StoryProgress {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn story_lines() {
        let now = 1_790_302_800;
        let running = story(serde_json::json!({
            "id": 3, "title": "See other people's edits appear live on the same board",
            "status": "running", "started_at": 1_790_291_590.0, "agent_minutes": 187.4,
            "calls": 572, "output_tokens": 526_585, "compactions": 8,
            "last_commit_at": (now - 107 * 60) as f64, "passed": 5, "total": 7,
            "tasks": [{"n": 1, "status": "committed"}, {"n": 2, "status": "written"},
                      {"n": 3, "status": "committed"}, {"n": 4}],
            "recent_activity": ["a", "b", "c", "d", "e", "f"]
        }));
        let line = story_line(&running, now);
        assert!(
            line.starts_with("  3  running  See other people's edits appear live on the…  "),
            "{line}"
        );
        assert!(
            line.ends_with("agent 3h07m  572 calls  527k tokens  8 compactions  accept 5/7  last commit 1h47m ago  tasks: 2 committed, 1 written, 1 unknown"),
            "{line}"
        );
        let partial = story(serde_json::json!({
            "id": 2, "title": "Draw", "status": "PARTIAL", "verdict": "amber",
            "ended_by": "operator", "reason": "stuck", "partial_base": [1]
        }));
        assert!(story_line(&partial, now).ends_with("verdict amber"));
        assert_eq!(
            story_note(&partial).as_deref(),
            Some("ended by operator: stuck; built on PARTIAL 1")
        );
        // A pending story, or one from metrics.json, is short.
        assert_eq!(
            story_line(
                &story(serde_json::json!({"id": 4, "title": "Undo", "status": "pending"})),
                now
            ),
            "  4  pending  Undo"
        );
        assert_eq!(
            story_line(
                &story(serde_json::json!({"id": "1", "title": "One", "passed": 3, "total": 4})),
                now
            ),
            format!("  1  -        {:<44}  accept 3/4", "One")
        );

        let stories = [partial, running.clone()];
        assert_eq!(focus_story(&stories, None), Some(&running));
        let detail = story_detail(&running, now);
        assert!(
            detail[0].starts_with("story 3 running, started 3h"),
            "{detail:?}"
        );
        assert!(detail.iter().any(|l| l.contains("N  STATUS")));
        // The last few activity lines only.
        let activity = detail
            .iter()
            .position(|l| l == "  recent activity")
            .unwrap();
        assert_eq!(detail.len() - activity - 1, ACTIVITY_LINES);
        assert_eq!(detail.last().unwrap(), "    f");
    }

    #[test]
    fn counts() {
        assert_eq!(fmt_count(572), "572");
        assert_eq!(fmt_count(163_933), "164k");
        assert_eq!(fmt_count(1_234_567), "1.2M");
    }
}
