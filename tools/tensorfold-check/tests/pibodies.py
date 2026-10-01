"""Synthetic request bodies with the shape pi sends (see capture_pi_requests.mjs for the real ones)."""

PI_TOOLS = [
    {"type": "function", "function": {
        "name": "read", "description": "Read the contents of a file.",
        "parameters": {"type": "object", "required": ["path", "offset", "limit"], "properties": {
            "path": {"type": "string"},
            "offset": {"anyOf": [{"type": "number"}, {"type": "null"}]},
            "limit": {"anyOf": [{"type": "number"}, {"type": "null"}]}}, "additionalProperties": False},
        "strict": True}},
    {"type": "function", "function": {
        "name": "bash", "description": "Execute a bash command.",
        "parameters": {"type": "object", "required": ["command", "timeout"], "properties": {
            "command": {"type": "string"},
            "timeout": {"anyOf": [{"type": "number"}, {"type": "null"}]}}, "additionalProperties": False},
        "strict": True}},
]


def conversation_bodies(turns: int, result_chars: int, model: str = "recorded-model") -> list[dict]:
    """turns+1 bodies: the first has system + user; each later one adds an assistant tool call and its result."""
    messages = [{"role": "system", "content": "You are an expert coding assistant operating inside pi."},
                {"role": "user", "content": "Implement story 1. " + "Spec text. " * 200}]
    bodies = []
    for i in range(turns + 1):
        bodies.append({"model": model, "messages": [dict(m) for m in messages], "stream": True,
                       "stream_options": {"include_usage": True}, "store": False,
                       "max_completion_tokens": 32768, "tools": PI_TOOLS})
        messages.append({"role": "assistant", "content": None, "reasoning_content": f"step {i}",
                         "tool_calls": [{"id": f"call_{i}", "type": "function",
                                         "function": {"name": "bash", "arguments": '{"command":"cat f%d"}' % i}}]})
        messages.append({"role": "tool", "tool_call_id": f"call_{i}", "content": f"[{i}] " + "x" * result_chars})
    return bodies
