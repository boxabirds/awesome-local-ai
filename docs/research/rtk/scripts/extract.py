# Print one JSON line per completed tool call: stack, run, story, tool, command (bash only), output chars.
import json, sys, os, glob
stack, run_dir = sys.argv[1], sys.argv[2]
for f in sorted(glob.glob(os.path.join(run_dir, "stories", "*", "agent-events.jsonl"))):
    story = os.path.basename(os.path.dirname(f))
    starts = {}
    for line in open(f, errors="replace"):
        try: e = json.loads(line)
        except Exception: continue
        t = e.get("type")
        if t == "tool_execution_start":
            starts[e.get("toolCallId")] = (e.get("toolName"), (e.get("args") or {}))
        elif t == "tool_execution_end":
            name, args = starts.pop(e.get("toolCallId"), (e.get("toolName"), {}))
            r = e.get("result") or {}
            txt = "".join(c.get("text", "") for c in (r.get("content") or []) if isinstance(c, dict))
            print(json.dumps({"stack": stack, "run": os.path.basename(run_dir), "story": story, "tool": name,
                              "command": args.get("command") if name == "bash" else None, "chars": len(txt)}))
