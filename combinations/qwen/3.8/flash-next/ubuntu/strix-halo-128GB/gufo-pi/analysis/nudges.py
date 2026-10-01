"""nudges.py — what every "continue" nudge produced, on every local stack, from the conversation logs in the repo.

The harness nudges an agent that stops without a commit. For each nudge this finds what the agent had just said
and what it did next (until it stopped again): committed, worked without committing, or only talked. The sorting
of replies is by wording, so the small rows are approximate. One story (the largest loop) is counted apart.
"""
import collections
import glob
import gzip
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[8]
NUDGE = 'Continue with the task'
TAIL = 400      # characters of a reply's end that show how it stopped
KINDS = [       # what the agent had said, first match wins
    ('sent an empty reply', lambda t, tail: not t),
    ('written a tool call as text', lambda t, tail: re.search(r'</?tool_call>|<parameter=|"arguments"\s*:', tail)),
    ('asked a question or offered more', lambda t, tail: re.search(r'\?\s*$', tail) or re.search(r'would you like|shall I|do you want|let me know (if|how|which|what)', tail, re.I)),
    ('said it would go on, and stopped', lambda t, tail: re.search(r"\b(let me|I'll|I will|now I|next,? I|going to)\b[^.!]{0,160}[.:]?\s*$", tail, re.I)),
    ('said the story was done', lambda t, tail: re.search(r'complete|all (checks|tests|suites) pass|fully implemented|nothing left|is done|summary|implemented|✅', t, re.I)),
]


def text_of(m):
    c = m.get('content')
    return c if isinstance(c, str) else ''.join(b.get('text') or '' for b in (c or []) if isinstance(b, dict) and b.get('type') == 'text')


def kind(reply):
    t = reply.strip()
    return next((name for name, test in KINDS if test(t, t[-TAIL:])), 'other')


rows = []
for f in sorted(glob.glob(str(REPO / 'combinations/**/benchmarks/vidi/*/stories/*/agent-events.compact.jsonl.gz'), recursive=True)):
    seq = []
    for line in gzip.open(f, 'rt', errors='replace'):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        m = e.get('message') or {}
        if e.get('type') != 'message_end' or m.get('role') not in ('user', 'assistant'):
            continue
        content = m.get('content') if isinstance(m.get('content'), list) else []
        commands = [str((b.get('arguments') or {}).get('command') or '') for b in content if b.get('type') == 'toolCall']
        seq.append((m['role'], text_of(m), commands))
    for i, (role, text, _) in enumerate(seq):
        if role != 'user' or not text.startswith(NUDGE) or not any(r == 'assistant' for r, _, _ in seq[:i]):
            continue
        before = next(t for r, t, _ in reversed(seq[:i]) if r == 'assistant')
        after = []
        for r, t, commands in seq[i + 1:]:
            if r == 'user':
                break
            after.append(commands)
        outcome = ('committed' if any('git commit' in c for cs in after for c in cs)
                   else 'only talked' if not any(after) else 'worked, no commit')
        rows.append((f.rsplit('/stories/', 1)[0] + '/' + f.split('/')[-2], kind(before), outcome))

per_story = collections.Counter(r[0] for r in rows)
loop, loop_n = per_story.most_common(1)[0]
rest = [r for r in rows if r[0] != loop]
print(f'{len(rest)} nudges in {len(per_story) - 1} story runs, and {loop_n} more in one story that looped\n')
print('| before the nudge the agent had… | nudges | then committed | worked on, no commit | only talked |')
print('|---|---|---|---|---|')
table = collections.Counter((k, o) for _, k, o in rest)
for name in [k for k, _ in KINDS] + ['other']:
    n = sum(v for (k, _), v in table.items() if k == name)
    print(f"| {name} | {n} | {table[(name, 'committed')]} | {table[(name, 'worked, no commit')]} | {table[(name, 'only talked')]} |")
committed = sum(v for (_, o), v in table.items() if o == 'committed')
print(f'| all | {len(rest)} | {committed} ({committed / len(rest):.0%}) | | |')
