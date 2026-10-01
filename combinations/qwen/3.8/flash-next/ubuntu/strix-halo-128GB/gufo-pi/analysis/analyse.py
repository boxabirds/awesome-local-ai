"""analyse.py [data.json.gz] — every table in README.md, from the file extract.py builds. Writes story-runs.csv."""
import collections
import csv
import gzip
import json
import statistics as st
import sys
from pathlib import Path

HERE = Path(__file__).parent
D = json.load(gzip.open(sys.argv[1] if len(sys.argv) > 1 else HERE / 'data.json.gz', 'rt'))
RUNS = ['v2-r1', 'v2-r2', 'v2-r3', 'v2-r4']        # the four finished runs; v2-r5 was still running
STORIES = [1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]
TEST_KINDS = ('e2e tests', 'integration tests', 'unit/component tests')
LONG_THOUGHT = 300        # characters: the terse mode's thoughts are around 100
THOUGHT_BINS = [(0, 300), (300, 1000), (1000, 3000), (3000, 10000), (10000, None)]
CAPS = (2000, 8000)       # characters of thinking per call, for the what-if
PROMPT_BINS = [(0, 20000), (20000, 40000), (40000, 60000), (60000, 80000), (80000, 100000), (100000, 140000)]
MIN_SPEED_TOKENS = 50     # shorter replies are dominated by start-up
MIN_TOKENS = 200          # a call long enough for its decode speed to mean something
MOSTLY = 0.8              # a call is "thinking" or "code" when this share of its characters is


def cv(xs):
    return st.pstdev(xs) / st.mean(xs) if st.mean(xs) else 0.0


def tok_per_s(reqs):
    reqs = [q for q in reqs if q['generated_tokens'] and q['decode_tps']]
    return sum(q['generated_tokens'] for q in reqs) / sum(q['generated_tokens'] / q['decode_tps'] for q in reqs)


def acceptance(reqs):
    return sum(q['draft_accepted'] or 0 for q in reqs) / max(1, sum(q['draft_proposed'] or 0 for q in reqs))


def done_at(v):
    """When the agent first said the story was done and the harness nudged it on; None if it never happened."""
    said = [c['rx'] for c in v['calls'] if c['declared_done']]
    return said[0] if said and (v['nudges'] or 0) > 0 and said[0] < v['calls'][-1]['rx'] else None


def parts(v, until=None):
    """Seconds of the story by what they were spent on, up to `until`."""
    end = until or v['t1']
    calls = [c for c in v['calls'] if c['rx'] <= end]
    reqs = [q for q in v['reqs'] if q['end'] <= end + 1]
    # a compaction's own request is compaction time, not the agent's generating
    in_comp = lambda q: any(a <= q['end'] <= b + 1 for a, b in v['comps'])
    decode = sum(q['generated_tokens'] / q['decode_tps'] for q in reqs if q['generated_tokens'] and q['decode_tps'] and not in_comp(q))
    chars = lambda k: sum(c[k] for c in calls)
    total = chars('think') + chars('text') + chars('args') or 1
    tools = sum(min(t['end'], end) - t['start'] for t in v['tools'] if t['start'] < end)
    comp = sum(min(b, end) - a for a, b in v['comps'] if a < end)
    wall = end - v['t0']
    return dict(wall=wall, thinking=decode * chars('think') / total, code=decode * (chars('text') + chars('args')) / total,
                tools=tools, compaction=comp, rest=wall - decode - tools - comp,
                think_chars=chars('think'), written=sum(c['written'] for c in calls), calls=len(calls),
                tests=sum(1 for t in v['tools'] if t['start'] < end and t['kind'] in TEST_KINDS),
                gen=sum(q['generated_tokens'] or 0 for q in reqs))


def table(title, head, rows):
    print(f'\n### {title}\n')
    print('| ' + ' | '.join(head) + ' |')
    print('|' + '|'.join('---' for _ in head) + '|')
    for r in rows:
        print('| ' + ' | '.join(str(x) for x in r) + ' |')


K = lambda r, s: D[f'{r}/{s}']
mins = lambda s: f'{s / 60:.0f}'
RAW = {(r, s): parts(K(r, s)) for r in RUNS for s in STORIES}
ADJ = {(r, s): parts(K(r, s), done_at(K(r, s))) for r in RUNS for s in STORIES}

# 1. the engine
rows = []
for r in RUNS:
    reqs = [q for s in STORIES for q in K(r, s)['reqs']]
    cond = [K(r, s)['conditions'] or {} for s in STORIES]
    rows.append((r, len(reqs), f'{tok_per_s(reqs):.1f}', f'{acceptance(reqs):.0%}',
                 f"{sum(q['cache'] != 'miss' for q in reqs) / len(reqs):.1%}",
                 f"{sum(q['prefill_tokens'] or 0 for q in reqs) / sum(q['prompt_tokens'] or 0 for q in reqs):.1%}",
                 sum(q['finish'] != 'stop' for q in reqs),
                 f"{max((c.get('gpu') or {}).get('temp_max_c') or 0 for c in cond):.0f}",
                 sum((c.get('gpu') or {}).get('throttled_samples') or 0 for c in cond)))
table('1. The engine, per run', ['run', 'requests', 'decode tok/s', 'drafts accepted', 'prompt cache hits', 'prompt tokens re-read',
                               'requests not ended by the model', 'GPU max °C', 'throttled samples'], rows)
think, code = [], []
for r in RUNS:
    for s in STORIES:
        by_out = collections.defaultdict(list)
        for q in K(r, s)['reqs']:
            by_out[int(q['generated_tokens'] or -1)].append(q)
        for c in K(r, s)['calls']:
            total = c['think'] + c['text'] + c['args']
            if (c['out'] or 0) >= MIN_TOKENS and total and by_out.get(c['out']):
                q = by_out[c['out']].pop(0)
                (think if c['think'] / total >= MOSTLY else code if c['think'] / total <= 1 - MOSTLY else []).append(q)
table('1b. Decode speed by what is being generated', ['calls that are', 'calls', 'decode tok/s', 'drafts accepted'],
      [('thinking (80%+ of the call)', len(think), f'{tok_per_s(think):.1f}', f'{acceptance(think):.0%}'),
       ('code and text (80%+ of the call)', len(code), f'{tok_per_s(code):.1f}', f'{acceptance(code):.0%}')])

rows = []
for lo, hi in PROMPT_BINS:
    x = [q for r in RUNS for s in STORIES for q in K(r, s)['reqs'] if lo <= (q['prompt_tokens'] or 0) < hi and (q['generated_tokens'] or 0) >= MIN_SPEED_TOKENS]
    rows.append((f'{lo // 1000}–{hi // 1000}k', len(x), f'{tok_per_s(x):.1f}', f'{acceptance(x):.0%}'))
table('1c. Decode speed by how full the context is', ['prompt tokens', 'requests', 'decode tok/s', 'drafts accepted'], rows)
whole = collections.Counter()
for k in RAW:
    for f in ('wall', 'thinking', 'code', 'tools', 'compaction', 'rest'):
        whole[f] += RAW[k][f]
table(f"1d. Where the {whole['wall'] / 3600:.0f} hours of the four runs went", ['spent on', 'hours', 'share'],
      [(n, f'{whole[f] / 3600:.1f}', f"{whole[f] / whole['wall']:.0%}") for f, n in
       [('code', 'generating code and text'), ('thinking', 'generating thinking'), ('tools', 'tools (tests, builds, servers)'),
        ('rest', 'reading prompts, and the rest'), ('compaction', 'compaction')]])

# 2. per story
rows = []
for s in STORIES:
    w = [RAW[(r, s)]['wall'] for r in RUNS]
    a = [ADJ[(r, s)]['wall'] for r in RUNS]
    rows.append((s, *[mins(x) for x in w], f'{max(w) / min(w):.1f}x', f'{cv(w):.0%}', f'{max(a) / min(a):.1f}x', f'{cv(a):.0%}'))
table('2. Minutes per story', ['story', *RUNS, 'slowest / fastest', 'CV', 'same, to first "done"', 'CV'], rows)
tot_raw = [sum(RAW[(r, s)]['wall'] for s in STORIES) / 3600 for r in RUNS]
tot_adj = [sum(ADJ[(r, s)]['wall'] for s in STORIES) / 3600 for r in RUNS]
table('2b. Hours per run', ['', *RUNS, 'CV'], [('as recorded', *[f'{x:.1f}' for x in tot_raw], f'{cv(tot_raw):.0%}'),
                                              ('to the first "done" of each story', *[f'{x:.1f}' for x in tot_adj], f'{cv(tot_adj):.0%}')])
table('2c. Stories where the agent said "done" and was nudged on', ['run', 'story', 'said done at (min)', 'went on for (min)', 'calls after', 'ended'],
      [(r, s, mins(done_at(K(r, s)) - K(r, s)['t0']), mins(K(r, s)['t1'] - done_at(K(r, s))),
        sum(c['rx'] > done_at(K(r, s)) for c in K(r, s)['calls']), K(r, s)['ended_by'])
       for r in RUNS for s in STORIES if done_at(K(r, s))])

# 3. where the gap between the slowest and fastest run of each story comes from
gap = collections.Counter()
for s in STORIES:
    hi = max(RUNS, key=lambda r: RAW[(r, s)]['wall'])
    lo = min(RUNS, key=lambda r: RAW[(r, s)]['wall'])
    after = RAW[(hi, s)]['wall'] - ADJ[(hi, s)]['wall']
    gap['after the agent said done'] += after
    for k in ('thinking', 'code', 'tools', 'compaction', 'rest'):
        gap[k] += ADJ[(hi, s)][k] - RAW[(lo, s)][k]
    gap['total'] += RAW[(hi, s)]['wall'] - RAW[(lo, s)]['wall']
names = {'thinking': 'thinking', 'code': 'writing code and text', 'tools': 'tools (tests, builds, servers)', 'compaction': 'compaction',
         'rest': 'reading prompts and the rest', 'after the agent said done': 'after the agent said done (nudged on)'}
table('3. The gap between the slowest and the fastest run of each story, summed over the 11 stories', ['spent on', 'hours', 'share of the gap'],
      [(names[k], f'{v / 3600:.1f}', f"{v / gap['total']:.0%}") for k, v in gap.most_common() if k != 'total'] + [('total', f"{gap['total'] / 3600:.1f}", '100%')])

# 4. thinking
calls = [c for r in RUNS for s in STORIES for c in K(r, s)['calls']]
total_think = sum(c['think'] for c in calls)
table('4. Thinking by the size of the thought', ['characters in the thought', 'calls', 'share of calls', 'share of all thinking'],
      [(f'{lo:,}–{hi:,}' if hi else f'{lo:,}+', n := sum(1 for c in calls if lo <= c['think'] < (hi or 10**9)), f'{n / len(calls):.0%}',
        f"{sum(c['think'] for c in calls if lo <= c['think'] < (hi or 10**9)) / total_think:.0%}") for lo, hi in THOUGHT_BINS])
rows = []
for s in STORIES:
    row = [s]
    for r in RUNS:
        c = K(r, s)['calls']
        row.append(f"{sum(x['think'] >= LONG_THOUGHT for x in c) / len(c):.0%} · {RAW[(r, s)]['think_chars'] / 1000:.0f}k · {max(x['think'] for x in c) / 1000:.0f}k")
    rows.append(row)
table('4b. Thinking per story run: share of calls with a thought of 300+ characters · all thinking · the largest thought (characters)', ['story', *RUNS], rows)
think_speed = tok_per_s(think)
rows = []
for cap in CAPS:
    saved = {}
    for r in RUNS:
        for s in STORIES:
            sec = 0.0
            for c in K(r, s)['calls']:
                total = c['think'] + c['text'] + c['args']
                if c['think'] > cap and total and c['out']:
                    sec += c['out'] * (c['think'] - cap) / total / think_speed
            saved[(r, s)] = sec
    walls = {k: ADJ[k]['wall'] - min(saved[k], ADJ[k]['thinking']) for k in ADJ}
    cvs = [cv([walls[(r, s)] for r in RUNS]) for s in STORIES]
    tot = [sum(walls[(r, s)] for s in STORIES) / 3600 for r in RUNS]
    rows.append((f'{cap:,}', f'{sum(saved.values()) / 3600:.1f}', f'{st.median(cvs):.0%}', ' '.join(f'{x:.1f}' for x in tot), f'{cv(tot):.0%}'))
base_cvs = [cv([ADJ[(r, s)]['wall'] for r in RUNS]) for s in STORIES]
table('4c. What if no thought could exceed a cap (arithmetic on the recorded runs, not a measurement)',
      ['cap, characters per call', 'hours removed (of %.1f)' % sum(tot_adj), 'median per-story CV (now %.0f%%)' % (100 * st.median(base_cvs)), 'hours per run', 'CV of run totals'], rows)

# 5. tools
kinds, counts = collections.Counter(), collections.Counter()
for r in RUNS:
    for s in STORIES:
        for t in K(r, s)['tools']:
            kinds[t['kind']] += t['end'] - t['start']
            counts[t['kind']] += 1
table('5. Tool time by kind, all four runs', ['kind', 'hours', 'calls', 'seconds each'],
      [(k, f'{v / 3600:.2f}', counts[k], f'{v / counts[k]:.1f}') for k, v in kinds.most_common(7)])
table('5b. Test runs the agent made per story, and minutes of end-to-end tests', ['story', *[f'{r} runs' for r in RUNS], *[f'{r} e2e min' for r in RUNS]],
      [(s, *[RAW[(r, s)]['tests'] for r in RUNS], *[mins(sum(t['end'] - t['start'] for t in K(r, s)['tools'] if t['kind'] == 'e2e tests')) for r in RUNS]) for s in STORIES])

# 6. how much each measure varies
measures = [('minutes, as recorded', lambda k: RAW[k]['wall']), ('minutes, to the first "done"', lambda k: ADJ[k]['wall']),
            ('thinking, characters', lambda k: ADJ[k]['think_chars']), ('code written, characters', lambda k: ADJ[k]['written']),
            ('model calls', lambda k: ADJ[k]['calls']), ('test runs', lambda k: ADJ[k]['tests']), ('tool minutes', lambda k: ADJ[k]['tools']),
            ('tokens generated', lambda k: ADJ[k]['gen'])]
rows = []
for name, f in measures:
    cvs = [cv([f((r, s)) for r in RUNS]) for s in STORIES]
    ratios = [max(f((r, s)) for r in RUNS) / max(1e-9, min(f((r, s)) for r in RUNS)) for s in STORIES]
    rows.append((name, f'{st.median(cvs):.0%}', f'{st.median(ratios):.1f}x', f'{max(ratios):.1f}x'))
table('6. Run-to-run variation per story, by measure (stories 11 and 12 of v2-r1 were largely built inside its story 10)',
      ['measure', 'median CV across stories', 'median slowest / fastest', 'worst'], rows)

with open(HERE / 'story-runs.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['run', 'story', 'status', 'wall_s', 'wall_to_first_done_s', 'thinking_s', 'code_s', 'tools_s', 'compaction_s', 'thinking_chars',
                'largest_thought_chars', 'calls', 'calls_with_long_thought', 'code_written_chars', 'test_runs', 'e2e_s', 'tokens_generated',
                'decode_tok_s', 'drafts_accepted', 'compactions', 'nudges', 'toolcall_text_resumes', 'held_out_passed', 'held_out_total'])
    for r in RUNS + ['v2-r5']:
        for s in STORIES:
            if f'{r}/{s}' not in D:
                continue
            v, p = K(r, s), parts(K(r, s))
            w.writerow([r, s, v['status'], round(p['wall']), round(parts(v, done_at(v))['wall']), round(p['thinking']), round(p['code']), round(p['tools']),
                        round(p['compaction']), p['think_chars'], max(c['think'] for c in v['calls']), p['calls'],
                        sum(c['think'] >= LONG_THOUGHT for c in v['calls']), p['written'], p['tests'],
                        round(sum(t['end'] - t['start'] for t in v['tools'] if t['kind'] == 'e2e tests')), p['gen'], round(tok_per_s(v['reqs']), 1),
                        round(acceptance(v['reqs']), 3), len(v['comps']), v['nudges'], v['toolcall_text_resumes'], *v['held_out']])
