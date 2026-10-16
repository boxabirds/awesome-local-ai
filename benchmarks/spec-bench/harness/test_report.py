"""report.py: the summary of a run, from its recorded metrics."""
import json

import report

DECODE_FAST, DECODE_SLOW = 30.0, 10.0
SERVER_REQUESTS = 4


def story(title, requests=None, conditions=None):
    return {"title": title, "status": "DONE", "gate": {"all_green": True}, "accept": {"passed": 2, "total": 4},
            "agent": {"seconds": 120, "stalled": False}, "requests": requests or {"requests": SERVER_REQUESTS},
            "conditions": conditions or {}}


def run_with(tmp_path, stories):
    run = tmp_path / "combo" / "benchmarks" / "vidi" / "run-1"
    run.mkdir(parents=True)
    (run / "run.json").write_text(json.dumps({"combination": "combo", "model_id": "m", "scope": "canvas"}))
    (run / "metrics.json").write_text(json.dumps({"stories": stories}))
    return run


def test_a_summary_with_nothing_unusual_has_no_notes_and_no_decode_table(tmp_path):
    text = report.summary(run_with(tmp_path, {"1": story("Pan")}))
    assert text.startswith("# Vidi run — combo\n")
    assert "| 1 | Pan | DONE | 2.0 | 4 |" in text
    assert "ran partly on battery" not in text and "### Decode tok/s by context" not in text
    assert "returned no `usage`" not in text


def test_a_story_that_ran_on_battery_is_named_as_not_comparable(tmp_path):
    on_battery = {"samples": 2, "bad_samples": [{"ac": False, "low_power": False, "thermal": "nominal"}]}
    text = report.summary(run_with(tmp_path, {"1": story("Pan"), "2": story("Notes", conditions=on_battery)}))
    assert "\n> Stories 2 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.\n" in text
    assert "| 2 | Notes |" in text and "DEGRADED (power) throttled 0%" in text


def test_decode_speed_by_context_is_the_request_weighted_median_of_the_stories_medians(tmp_path):
    fast = {"requests": SERVER_REQUESTS, "decode_by_context": {"0-8k": {"decode_tok_s_median": DECODE_FAST, "requests": 3},
                                                                "8-16k": {"decode_tok_s_median": None, "requests": 2}}}
    slow = {"requests": SERVER_REQUESTS, "decode_by_context": {"0-8k": {"decode_tok_s_median": DECODE_SLOW, "requests": 1}}}
    text = report.summary(run_with(tmp_path, {"1": story("Pan", fast), "2": story("Notes", slow)}))
    assert "### Decode tok/s by context (server log, all stories)" in text
    assert "| 0-8k | 4 | 30.0 |" in text      # [30, 30, 30, 10] sorted: the one at index 2 of 4
    assert "| 8-16k | 0 | — |" in text        # only unmeasured requests: no median


def test_requests_without_usage_are_said_to_make_token_totals_a_lower_bound(tmp_path):
    text = report.summary(run_with(tmp_path, {"1": story("Pan", {"requests": SERVER_REQUESTS, "usage_missing": 2}),
                                              "2": story("Notes", {"requests": SERVER_REQUESTS, "usage_missing": 1})}))
    assert "\n> 3 requests returned no `usage`; token totals are a lower bound.\n" in text


def test_a_story_ended_early_gets_its_own_section_after_the_table(tmp_path):
    partial = {**story("Pan"), "status": "PARTIAL", "skip": {"by": "owner", "reason": "stuck"}, "verdict": {"verdict": "usable"}}
    text = report.summary(run_with(tmp_path, {"1": partial}))
    assert "| 1 | Pan | PARTIAL (usable) |" in text
    assert "### Stories ended early (PARTIAL) and what was built on them\n\n- **Story 1 PARTIAL**, ended by the operator (owner): stuck. " in text
