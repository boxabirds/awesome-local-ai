"""extract.py <repo root> <dir with server-r1.log … server-r5.log> <out data.json.gz> [full.jsonl.gz]

Builds the one file analyse.py reads: for every story of the gufo v2 runs, each model call (when, characters of
thinking, text and tool arguments, tokens out, whether it called a tool, whether it declared the story done), each
tool call (when, how long, what kind, whether it failed), each compaction, and each request as gufo's own log
recorded it (tokens, decode speed, draft acceptance, cache state). Numbers and categories only: no conversation
text, commands or paths.

Sources: the published conversation logs in the repo (lossless from 30 Sep 2026); for runs before that, the full
logs from the machine (slim_full_logs.py); and each run's server.log, which stays on the machine.
"""
import calendar
import gzip
import json
import re
import sys
import time
from pathlib import Path

REPO, LOGS, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
BASE = REPO / 'combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi'
RUNS = ['v2-r1', 'v2-r2', 'v2-r3', 'v2-r4', 'v2-r5']
KV = re.compile(r'(\w+)=(\S+)')
STAMP_LEN = 19            # "2026-10-01 08:21:18", UTC on this machine (its start marker agrees)
END_SLACK_S = 2           # the server stamps to the second
DONE = re.compile(r'complete|all (checks|tests|suites) pass|fully implemented|nothing left|is done', re.I)
REQ_NUM = ('duration_ms', 'prompt_tokens', 'prefill_tokens', 'generated_tokens', 'cached_tokens', 'queue_ms', 'ttft_ms',
           'prefill_tps', 'decode_tps', 'draft_accepted', 'draft_proposed', 'acceptance_pct', 'host_available_mib')
REQ_TEXT = ('finish', 'cache')
KINDS = [  # a bash command's kind, first match wins
    ('e2e tests', r'playwright|test:e2e|e2e'),
    ('integration tests', r'test:integration|integration'),
    ('unit/component tests', r'vitest|npm (run )?test|test:unit|test:component'),
    ('build/typecheck', r'npm run build|vite build|tsc|typecheck'),
    ('install', r'npm (i|install|ci)\b|npm view'),
    ('dev server/curl/sleep', r'wrangler|npm run dev|curl|sleep'),
    ('git', r'^\s*(cd [^;&]+(&&|;)\s*)?git '),
]


def tool_kind(name, command):
    if name != 'bash':
        return name
    for kind, pattern in KINDS:
        if re.search(pattern, command):
            return kind
    return 'shell (read/search/other)'


def num(d, k):
    try:
        return float(d.get(k))
    except (TypeError, ValueError):
        return None


def server_requests(path):
    out = []
    for line in open(path, errors='replace'):
        if 'event=completed' not in line or '/chat/completions' not in line:
            continue
        d = dict(KV.findall(line))
        r = {k: num(d, k) for k in REQ_NUM}
        r.update({k: d.get(k) for k in REQ_TEXT})
        r['end'] = calendar.timegm(time.strptime(line[:STAMP_LEN], '%Y-%m-%d %H:%M:%S'))
        out.append(r)
    return out


def lines_of(path):
    for line in gzip.open(path, 'rt', errors='replace'):
        try:
            yield json.loads(line)
        except ValueError:
            continue


FULL = {}
if len(sys.argv) > 4:
    for e in lines_of(sys.argv[4]):
        FULL.setdefault((e['_run'], e['_story']), []).append(e)


def conversation(events):
    calls, tools, comps, starts = [], [], [], {}
    comp_start = None
    for e in events:
        t, rx = e.get('type'), e.get('_rx')
        if t == 'message_end' and (e.get('message') or {}).get('role') == 'assistant':
            m = e['message']
            content = m.get('content') if isinstance(m.get('content'), list) else []
            tc = [b for b in content if b.get('type') == 'toolCall']
            text = ''.join(b.get('text') or '' for b in content if b.get('type') == 'text')
            writes = [(b.get('arguments') or {}).get('path') for b in tc if b.get('name') in ('write', 'edit')]
            calls.append(dict(
                rx=rx, think=sum(len(b.get('thinking') or '') for b in content if b.get('type') == 'thinking'),
                text=len(text), args=sum(len(json.dumps(b.get('arguments') or {})) for b in tc),
                out=(m.get('usage') or {}).get('output'), tools=len(tc), writes=len(writes),
                written=sum(len(json.dumps(b.get('arguments') or {})) for b in tc if b.get('name') in ('write', 'edit')),
                stopped=not tc and m.get('stopReason') == 'stop', declared_done=not tc and bool(DONE.search(text))))
        elif t == 'tool_execution_start':
            a = e.get('args') or {}
            starts[e.get('toolCallId')] = (rx, tool_kind(e.get('toolName'), str(a.get('command') or '')))
        elif t == 'tool_execution_end':
            s = starts.pop(e.get('toolCallId'), None)
            if s:
                tools.append(dict(start=s[0], end=rx, kind=s[1], error=bool(e.get('isError'))))
        elif t == 'compaction_start':
            comp_start = rx
        elif t == 'compaction_end' and comp_start is not None:
            comps.append((comp_start, rx))
            comp_start = None
    return calls, tools, comps


data = {}
for r in RUNS:
    m = json.load(open(BASE / r / 'metrics.json'))
    reqs = server_requests(LOGS / f'server-r{r[-1]}.log')
    for sid, s in m['stories'].items():
        if 'agent_finished' not in s:
            continue
        t0, t1 = s.get('first_started') or s['started'], s['agent_finished']
        log = BASE / r / 'stories' / sid.zfill(2) / 'agent-events.compact.jsonl.gz'
        calls, tools, comps = conversation(FULL.get((r, sid.zfill(2))) or (lines_of(log) if log.exists() else []))
        a = s.get('agent') or {}
        data[f'{r}/{sid}'] = dict(
            run=r, story=int(sid), t0=t0, t1=t1, status=s.get('status'), ended_by=s.get('ended_by'),
            held_out=[(s.get('accept') or {}).get('passed'), (s.get('accept') or {}).get('total')],
            nudges=a.get('nudges'), toolcall_text_resumes=a.get('toolcall_text_resumes'),
            time_split={k: v for k, v in (s.get('time_split') or {}).items() if k != 'accounting'},
            conditions=s.get('conditions'), calls=calls, tools=tools, comps=comps,
            reqs=[q for q in reqs if t0 <= q['end'] <= t1 + END_SLACK_S])
with gzip.open(OUT, 'wt') as f:
    json.dump(data, f, separators=(',', ':'))
print(len(data), 'story runs;', sum(len(v['calls']) for v in data.values()), 'calls;',
      sum(len(v['reqs']) for v in data.values()), 'requests')
