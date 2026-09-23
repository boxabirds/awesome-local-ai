"""Coding-agent client adapters for the Vidi driver.

Each client knows how to write its isolated config, build a headless command
(fresh or fork-resumed), and read its own JSON event stream into a common state:
session id, terminal error, model steps, tool calls, tokens, compactions, and a
per-tool-call key for loop detection.
"""
from __future__ import annotations

import json
from pathlib import Path

PROVIDER = "local"
# Long, silent prefills at big context are normal for a local model. The client
# must not be the thing that gives up first, or a slow server looks like a hang.
CLIENT_IDLE_TIMEOUT_MS = 60 * 60 * 1000


def empty_state() -> dict:
    return {"session": None, "error": None, "steps": 0, "tool_calls": 0, "compactions": 0,
            "tokens": {"input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0}}


class PiClient:
    """pi (pi.dev): `pi -p --mode json`, config under PI_CODING_AGENT_DIR."""

    name = "pi"

    def __init__(self, work: Path):
        self.agent_dir = work / "pi-agent"
        self.session_dir = work / "pi-sessions"

    def env(self) -> dict:
        return {"PI_CODING_AGENT_DIR": str(self.agent_dir), "PI_OFFLINE": "1"}

    def write_config(self, base_url: str, model_id: str, ctx: int, out: int) -> None:
        self.agent_dir.mkdir(parents=True, exist_ok=True)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        # Same shape as lib/clients/pi.sh _pi_provider_block: MTPLX wants "system" not
        # "developer", and applies reasoning effort itself (server-side).
        models = {"providers": {PROVIDER: {
            "baseUrl": base_url, "api": "openai-completions", "apiKey": "local",
            "models": [{"id": model_id, "name": model_id, "input": ["text"],
                        "contextWindow": ctx, "maxTokens": out, "reasoning": True,
                        "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False}}],
        }}}
        (self.agent_dir / "models.json").write_text(json.dumps(models, indent=2))
        # pi's own defaults for compaction and retries, except timeouts (see CLIENT_IDLE_TIMEOUT_MS).
        settings = {"quietStartup": True, "httpIdleTimeoutMs": CLIENT_IDLE_TIMEOUT_MS,
                    "retry": {"provider": {"timeoutMs": CLIENT_IDLE_TIMEOUT_MS}}}
        (self.agent_dir / "settings.json").write_text(json.dumps(settings, indent=2))

    def command(self, model_id: str, prompt: str, resume_from: str | None = None) -> list[str]:
        resume = ["--fork", resume_from] if resume_from else []
        return ["pi", "-p", "--mode", "json", "--model", f"{PROVIDER}/{model_id}",
                "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
                "--no-approve", "--session-dir", str(self.session_dir), *resume, "--", prompt]

    def scan(self, e: dict, st: dict) -> str | None:
        """Update state from one event; return a loop key for a tool call, else None."""
        t = e.get("type")
        if t == "session":
            st["session"] = st["session"] or e.get("id")
        elif t == "message_end":
            msg = e.get("message") or {}
            if msg.get("role") == "assistant":
                st["steps"] += 1
                u = msg.get("usage") or {}
                st["tokens"]["input"] += u.get("input", 0)
                st["tokens"]["output"] += u.get("output", 0)
                st["tokens"]["reasoning"] += u.get("reasoning", 0)
                st["tokens"]["cache_read"] += u.get("cacheRead", 0)
                st["tokens"]["cache_write"] += u.get("cacheWrite", 0)
                if msg.get("stopReason") == "error":
                    st["error"] = str(msg.get("errorMessage") or "assistant message ended in error")[:500]
                elif msg.get("stopReason") in ("stop", "toolUse", "length"):
                    st["error"] = None  # a later successful message clears a retried error
        elif t == "tool_execution_start":
            st["tool_calls"] += 1
            return json.dumps([e.get("toolName"), e.get("args")], sort_keys=True)
        elif t == "compaction_end":
            st["compactions"] += 1
        return None


class OpenCodeClient:
    """OpenCode: `opencode run --format json`, config under an isolated XDG_CONFIG_HOME."""

    name = "opencode"

    def __init__(self, work: Path):
        self.cfg_dir = work / "agent-home" / ".config" / "opencode"

    def env(self) -> dict:
        return {}

    def write_config(self, base_url: str, model_id: str, ctx: int, out: int) -> None:
        self.cfg_dir.mkdir(parents=True, exist_ok=True)
        cfg = {
            "$schema": "https://opencode.ai/config.json",
            "autoupdate": False,
            "share": "disabled",
            "permission": {"edit": "allow", "bash": "allow", "webfetch": "deny", "external_directory": "deny"},
            "provider": {PROVIDER: {
                "npm": "@ai-sdk/openai-compatible", "name": "spec-bench local",
                "options": {"baseURL": base_url, "apiKey": "local"},
                "models": {model_id: {"name": model_id, "limit": {"context": ctx, "output": out}}},
            }},
        }
        (self.cfg_dir / "opencode.json").write_text(json.dumps(cfg, indent=2))

    def command(self, model_id: str, prompt: str, resume_from: str | None = None) -> list[str]:
        # A resume forks: same history, new session id. MTPLX leaves a session id locked
        # ("already in flight") after a stream stall, so reusing the id can never succeed.
        resume = ["--session", resume_from, "--fork"] if resume_from else []
        return ["opencode", "run", "--pure", "--format", "json", "--model", f"{PROVIDER}/{model_id}", *resume, prompt]

    def scan(self, e: dict, st: dict) -> str | None:
        st["session"] = st["session"] or e.get("sessionID")
        part = e.get("part") or {}
        t = e.get("type")
        if t == "error":
            err = e.get("error") or {}
            st["error"] = f"{err.get('name')}: {(err.get('data') or {}).get('message', '')}"[:500]
        elif t == "step_finish":
            st["steps"] += 1
            tk = part.get("tokens") or {}
            st["tokens"]["input"] += tk.get("input", 0)
            st["tokens"]["output"] += tk.get("output", 0)
            st["tokens"]["reasoning"] += tk.get("reasoning", 0)
            st["tokens"]["cache_read"] += (tk.get("cache") or {}).get("read", 0)
            st["tokens"]["cache_write"] += (tk.get("cache") or {}).get("write", 0)
        elif t == "tool_use":
            st["tool_calls"] += 1
            return json.dumps([part.get("tool"), (part.get("state") or {}).get("input")], sort_keys=True)
        return None


CLIENTS = {"pi": PiClient, "opencode": OpenCodeClient}
