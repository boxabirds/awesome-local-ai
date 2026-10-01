"""slim_full_logs.py <benchmarks/vidi dir> <run>... > full.jsonl — on the machine that ran the runs.

Runs recorded before 30 Sep 2026 published conversation logs with long strings cut (a thought over ~2,000 characters
was shortened), so their thinking can't be measured from the repo. This prints each named run's full event logs
(stories/NN/agent-events.jsonl, kept on the machine) as one stream, without the streamed updates and with long tool
results shortened, each event tagged with its run and story. extract.py reads it as its fourth argument.
"""
import glob
import json
import sys

SKIP = ('"message_update"', '"agent_end"', '"turn_end"', '"message_start"')
HEAD = 80                 # the event type is within the first characters of a line
RESULT_KEEP = (500, 900)  # of a long tool result: its start and its end

base = sys.argv[1]
for run in sys.argv[2:]:
    for path in sorted(glob.glob(f'{base}/{run}/stories/*/agent-events.jsonl')):
        story = path.split('/')[-2]
        for line in open(path, errors='replace'):
            if any(s in line[:HEAD] for s in SKIP):
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get('type') == 'message_end' and (e.get('message') or {}).get('role') != 'assistant':
                continue
            if e.get('type') == 'tool_execution_end':
                for c in ((e.get('result') or {}).get('content') or []):
                    if isinstance(c, dict) and isinstance(c.get('text'), str) and len(c['text']) > sum(RESULT_KEEP):
                        c['text'] = c['text'][:RESULT_KEEP[0]] + ' …CUT… ' + c['text'][-RESULT_KEEP[1]:]
            e['_run'], e['_story'] = run, story
            sys.stdout.write(json.dumps(e) + '\n')
