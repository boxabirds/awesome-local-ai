//! Layer 0: where a call sits in its story run and what came before it. Pure: rows in, rows out.

/// One model call, as the warehouse holds it.
#[derive(Debug, Clone, Default)]
pub struct CallIn {
    pub idx: i64,
    /// When the call ended, epoch seconds; none for a story ingested from a log with no stamps.
    pub rx: Option<f64>,
    /// When it was sent, where the log says.
    pub sent: Option<f64>,
    pub attempt: Option<i64>,
    pub in_tok: Option<i64>,
    pub cache_tok: Option<i64>,
    pub out_tok: Option<i64>,
    pub n_tools: Option<i64>,
    pub stop: Option<String>,
    pub think_full: Option<String>,
}

/// One tool call, as the warehouse holds it.
#[derive(Debug, Clone, Default)]
pub struct ToolIn {
    pub call_idx: i64,
    pub kind: Option<String>,
    pub name: Option<String>,
    pub arg: Option<String>,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub error: Option<i64>,
    pub res_chars: Option<i64>,
    pub passed: Option<i64>,
    pub failed: Option<i64>,
    pub res_full: Option<String>,
}

/// The layer-0 row of one call.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ContextRow {
    pub idx: i64,
    pub attempt: Option<i64>,
    pub frac: f64,
    pub t_s: Option<f64>,
    pub gap_s: Option<f64>,
    pub dur_s: Option<f64>,
    pub in_tok: Option<i64>,
    pub cache_tok: Option<i64>,
    pub out_tok: Option<i64>,
    pub context_tok: Option<i64>,
    pub n_tools: Option<i64>,
    pub stop: Option<String>,
    pub compactions_before: Option<i64>,
    pub since_compaction: Option<i64>,
    pub after_compaction: Option<i64>,
    pub prev_tool_kinds: String,
    pub prev_tool_errors: i64,
    pub prev_tests_passed: i64,
    pub prev_tests_failed: i64,
    pub prev_res_chars: i64,
    pub commits_before: i64,
    pub since_commit_s: Option<f64>,
}

/// A bash command that commits.
const COMMIT_COMMAND: &str = "git commit";
const COMMIT_TOOL: &str = "bash";

/// When a call happened for the purpose of "before" and "after": when it was sent, else when it ended; none with no stamps.
fn at(c: &CallIn) -> Option<f64> {
    c.sent.or(c.rx)
}

fn is_commit(t: &ToolIn) -> bool {
    t.name.as_deref().is_some_and(|n| n.eq_ignore_ascii_case(COMMIT_TOOL)) && t.arg.as_deref().is_some_and(|a| a.contains(COMMIT_COMMAND))
}

/// The layer-0 rows of a story run's calls (in idx order), given its tools and the end times of its compactions.
pub fn context_rows(calls: &[CallIn], tools: &[ToolIn], compaction_ends: &[f64]) -> Vec<ContextRow> {
    let first = calls.iter().find_map(|c| c.rx);
    let last_idx = calls.len().saturating_sub(1).max(1) as f64;
    // The calls (by idx) whose tools committed, and when each such tool finished.
    let commit_tools: Vec<(i64, Option<f64>)> = tools.iter().filter(|t| is_commit(t)).map(|t| (t.call_idx, t.end.or(t.start))).collect();
    calls
        .iter()
        .enumerate()
        .map(|(n, c)| {
            let now = at(c);
            let prev = n.checked_sub(1).map(|p| &calls[p]);
            let gap_s = prev.and_then(|p| Some(c.sent? - p.rx?));
            let dur_s = c.rx.zip(c.sent).map(|(r, s)| r - s);
            // The last compaction that ended before this call, and how many calls have been sent since: needs times.
            let ended: Option<Vec<f64>> = now.map(|now| compaction_ends.iter().copied().filter(|e| *e <= now).collect());
            let since = ended.as_ref().and_then(|v| v.iter().copied().max_by(f64::total_cmp)).map(|e| calls[..n].iter().filter(|p| at(p).is_some_and(|t| t >= e)).count() as i64);
            let before = prev.map_or(&[][..], |p| std::slice::from_ref(p));
            let prev_tools: Vec<&ToolIn> = before.iter().flat_map(|p| tools.iter().filter(move |t| t.call_idx == p.idx)).collect();
            let mut kinds: Vec<String> = prev_tools.iter().filter_map(|t| t.kind.clone().or_else(|| t.name.clone())).collect();
            kinds.sort();
            kinds.dedup();
            // A commit by an earlier call's tool is over before this call is sent: counted by position, not by time.
            let earlier: Vec<&(i64, Option<f64>)> = commit_tools.iter().filter(|(i, _)| *i < c.idx).collect();
            let last_commit = earlier.iter().filter_map(|(_, e)| *e).max_by(f64::total_cmp);
            ContextRow {
                idx: c.idx,
                attempt: c.attempt,
                frac: if calls.len() <= 1 { 0.0 } else { n as f64 / last_idx },
                t_s: first.zip(c.rx).map(|(f, r)| r - f),
                gap_s,
                dur_s,
                in_tok: c.in_tok,
                cache_tok: c.cache_tok,
                out_tok: c.out_tok,
                context_tok: match (c.in_tok, c.cache_tok) {
                    (None, None) => None,
                    (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
                },
                n_tools: c.n_tools,
                stop: c.stop.clone(),
                compactions_before: ended.as_ref().map(|v| v.len() as i64),
                since_compaction: since,
                after_compaction: ended.as_ref().map(|_| i64::from(since == Some(0))),
                prev_tool_kinds: kinds.join(","),
                prev_tool_errors: prev_tools.iter().filter(|t| t.error.unwrap_or(0) != 0).count() as i64,
                prev_tests_passed: prev_tools.iter().filter_map(|t| t.passed).sum(),
                prev_tests_failed: prev_tools.iter().filter_map(|t| t.failed).sum(),
                prev_res_chars: prev_tools.iter().filter_map(|t| t.res_chars).sum(),
                commits_before: earlier.len() as i64,
                since_commit_s: now.zip(last_commit).map(|(n, e)| n - e),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(idx: i64, sent: f64, rx: f64) -> CallIn {
        CallIn { idx, sent: Some(sent), rx: Some(rx), in_tok: Some(100), cache_tok: Some(900), out_tok: Some(50), n_tools: Some(1), stop: Some("toolUse".into()), ..Default::default() }
    }
    fn tool(call_idx: i64, name: &str, kind: &str, arg: &str, end: f64) -> ToolIn {
        ToolIn { call_idx, name: Some(name.into()), kind: Some(kind.into()), arg: Some(arg.into()), start: Some(end - 1.0), end: Some(end), ..Default::default() }
    }

    #[test]
    fn position_time_gap_duration_and_context() {
        let rows = context_rows(&[call(0, 100.0, 110.0), call(1, 115.0, 130.0), call(2, 132.0, 140.0)], &[], &[]);
        assert_eq!(rows.iter().map(|r| r.frac).collect::<Vec<_>>(), vec![0.0, 0.5, 1.0]);
        assert_eq!(rows.iter().map(|r| r.t_s).collect::<Vec<_>>(), vec![Some(0.0), Some(20.0), Some(30.0)]);
        assert_eq!(rows.iter().map(|r| r.gap_s).collect::<Vec<_>>(), vec![None, Some(5.0), Some(2.0)]);
        assert_eq!(rows.iter().map(|r| r.dur_s).collect::<Vec<_>>(), vec![Some(10.0), Some(15.0), Some(8.0)]);
        assert!(rows.iter().all(|r| r.context_tok == Some(1000)));
    }

    #[test]
    fn a_one_call_story_is_at_position_zero() {
        assert_eq!(context_rows(&[call(0, 1.0, 2.0)], &[], &[])[0].frac, 0.0);
        assert!(context_rows(&[], &[], &[]).is_empty());
    }

    #[test]
    fn compaction_position_before_during_and_after() {
        let calls: Vec<CallIn> = (0..5).map(|i| call(i, 100.0 + 10.0 * i as f64, 105.0 + 10.0 * i as f64)).collect();
        // A compaction ends at 125: calls 0, 1, 2 were sent at 100, 110, 120 (before it); call 3 (130) is the first after.
        let rows = context_rows(&calls, &[], &[125.0]);
        assert_eq!(rows.iter().map(|r| r.compactions_before).collect::<Vec<_>>(), vec![Some(0), Some(0), Some(0), Some(1), Some(1)]);
        assert_eq!(rows.iter().map(|r| r.since_compaction).collect::<Vec<_>>(), vec![None, None, None, Some(0), Some(1)]);
        assert_eq!(rows.iter().map(|r| r.after_compaction).collect::<Vec<_>>(), vec![Some(0), Some(0), Some(0), Some(1), Some(0)]);
    }

    #[test]
    fn the_previous_calls_tools_describe_what_came_before() {
        let tools = vec![
            ToolIn { passed: Some(3), failed: Some(2), res_chars: Some(500), error: Some(0), ..tool(0, "bash", "unit", "npm test", 110.0) },
            ToolIn { error: Some(1), res_chars: Some(40), ..tool(0, "read", "read", "x.ts", 111.0) },
            tool(1, "edit", "edit", "y.ts", 125.0),
        ];
        let rows = context_rows(&[call(0, 100.0, 110.0), call(1, 115.0, 120.0), call(2, 121.0, 130.0)], &tools, &[]);
        assert_eq!((rows[0].prev_tool_kinds.as_str(), rows[0].prev_tool_errors), ("", 0));
        assert_eq!(rows[1].prev_tool_kinds, "read,unit");
        assert_eq!((rows[1].prev_tool_errors, rows[1].prev_tests_passed, rows[1].prev_tests_failed, rows[1].prev_res_chars), (1, 3, 2, 540));
        assert_eq!(rows[2].prev_tool_kinds, "edit");
    }

    #[test]
    fn a_tool_with_no_kind_is_named_by_its_name() {
        let t = ToolIn { call_idx: 0, name: Some("grep".into()), ..Default::default() };
        let rows = context_rows(&[call(0, 1.0, 2.0), call(1, 3.0, 4.0)], &[t], &[]);
        assert_eq!(rows[1].prev_tool_kinds, "grep");
    }

    #[test]
    fn commits_are_bash_commands_containing_git_commit_that_finished_before_the_call() {
        let tools = vec![
            tool(0, "bash", "bash", "git add -A && git commit -m x", 112.0),
            tool(1, "bash", "bash", "npm test", 118.0),
            tool(1, "read", "read", "git commit notes.md", 119.0), // not bash: not a commit
            tool(2, "bash", "bash", "git commit --amend", 160.0),
        ];
        let rows = context_rows(&[call(0, 100.0, 111.0), call(1, 115.0, 125.0), call(2, 130.0, 150.0), call(3, 170.0, 180.0)], &tools, &[]);
        assert_eq!(rows.iter().map(|r| r.commits_before).collect::<Vec<_>>(), vec![0, 1, 1, 2]);
        assert_eq!(rows.iter().map(|r| r.since_commit_s).collect::<Vec<_>>(), vec![None, Some(3.0), Some(18.0), Some(10.0)]);
    }

    #[test]
    fn missing_times_and_tokens_give_nulls_not_zeros() {
        let c = CallIn { idx: 0, rx: Some(5.0), ..Default::default() };
        let d = CallIn { idx: 1, rx: Some(9.0), ..Default::default() };
        let rows = context_rows(&[c, d], &[], &[]);
        assert_eq!((rows[1].gap_s, rows[1].dur_s, rows[1].context_tok, rows[1].since_compaction), (None, None, None, None));
    }

    #[test]
    fn a_story_with_no_stamps_has_its_positions_and_counts_but_no_times() {
        // Older compact logs carry no times: 20% of the pi calls in the warehouse. Everything by position still works.
        let calls: Vec<CallIn> = (0..4).map(|i| CallIn { idx: i, in_tok: Some(10), cache_tok: Some(90), ..Default::default() }).collect();
        let tools = vec![
            ToolIn { call_idx: 1, name: Some("bash".into()), kind: Some("bash".into()), arg: Some("git commit -m x".into()), ..Default::default() },
            ToolIn { call_idx: 2, name: Some("bash".into()), kind: Some("unit".into()), passed: Some(4), failed: Some(1), ..Default::default() },
        ];
        let rows = context_rows(&calls, &tools, &[50.0]);
        assert_eq!(rows.iter().map(|r| r.frac).collect::<Vec<_>>(), vec![0.0, 1.0 / 3.0, 2.0 / 3.0, 1.0]);
        assert!(rows.iter().all(|r| r.t_s.is_none() && r.gap_s.is_none() && r.dur_s.is_none() && r.since_commit_s.is_none()));
        assert!(rows.iter().all(|r| r.compactions_before.is_none() && r.since_compaction.is_none() && r.after_compaction.is_none()));
        assert_eq!(rows.iter().map(|r| r.commits_before).collect::<Vec<_>>(), vec![0, 0, 1, 1]);
        assert_eq!((rows[3].prev_tests_passed, rows[3].prev_tests_failed, rows[3].prev_tool_kinds.as_str()), (4, 1, "unit"));
        assert_eq!(rows[0].context_tok, Some(100));
    }
}
