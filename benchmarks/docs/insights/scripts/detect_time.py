"""detect_time.py <database>: where the story time goes, as markdown. Standard library only; the database is opened read-only.

Run on conv_full.db. Seconds are epoch seconds from calls.rx and tools.start/end.

Per call i: model time = rx_i - end of the previous call's last tool (or the previous rx when it had no tools);
tool time = max(end) - rx_i over the call's tools. Model time is charged to the class of the call it produced.
Compaction time (compactions.start..end) is taken out of the model time and reported on its own.
Stories used: every call has rx > 0 (a timestamped story). All time is clipped to the story's recorded start and finish, because a
log can hold an earlier session or a pause that the recorded wall time leaves out (one MTPLX story's log began 5.4 hours early)."""
import sqlite3, re, sys, collections, statistics

DB = sys.argv[1]
con = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)

EXPLORE_RX = re.compile(r'^\s*(cd [^&;|]+(&&|;)\s*)?(cat|ls|head|tail|sed -n|grep|rg|find|wc|tree|pwd|file|stat|git (status|log|show|diff|rev-parse|ls-files)|echo|which|test -[a-z]|\[)\b')
TEST_RX = re.compile(r'\b(vitest|playwright|jest|tsc|npm (run )?(test|build|lint|typecheck)|npx (vitest|playwright|tsc|eslint)|pnpm|yarn (test|build)|eslint|next build|vite build|node --test|pytest|cargo (test|build)|make)\b')
GIT_RX = re.compile(r'\bgit (add|commit|stash|checkout|worktree|reset|restore|apply)\b')

def cls(name, arg):
    if name == 'read': return 'read'
    if name == 'edit': return 'edit'
    if name == 'write': return 'write'
    if name in ('bash', 'Bash'):
        a = arg or ''
        if TEST_RX.search(a): return 'shell: test/build run'
        if GIT_RX.search(a): return 'shell: git write'
        if EXPLORE_RX.search(a): return 'shell: look (cat/ls/grep/git read)'
        return 'shell: other'
    return 'other tool'

def group(variant, engine):
    return f'{variant}/{engine}'

stories = con.execute('select sk, variant, engine, story, started, finished from stories').fetchall()
comp = collections.defaultdict(list)
for sk, s, e in con.execute('select sk, start, end from compactions where start is not null and end is not null'):
    comp[sk].append((s, e))

per_group = collections.defaultdict(lambda: collections.defaultdict(float))
counts = collections.defaultdict(lambda: collections.Counter())
story_n = collections.Counter(); story_skip = collections.Counter()
share_rows = []   # per story shares for medians
RETRY = collections.defaultdict(float)

for sk, variant, engine, n_story, started, finished in stories:
    g = group(variant, engine)
    calls = con.execute('select idx, rx, n_tools from calls where sk=? order by idx', (sk,)).fetchall()
    if not calls or any((c[1] or 0) <= 0 for c in calls):
        story_skip[g] += 1; continue
    tools = collections.defaultdict(list)
    for call_idx, name, arg, start, end, err in con.execute('select call_idx, name, arg, start, end, error from tools where sk=? order by call_idx, idx', (sk,)):
        tools[call_idx].append((name, arg, start, end, err))
    story_n[g] += 1
    lo_w = started if started else -1e18; hi_w = finished if finished else 1e18
    def clip(a, b): return max(0.0, min(b, hi_w) - max(a, lo_w))
    prev_end = started if started else calls[0][1]
    first_write_seen = False
    acc = collections.defaultdict(float)
    prev = None   # (cls, err, total) of previous call for retry accounting
    story_total = 0.0
    for idx, rx, n_tools in calls:
        ts = tools.get(idx, [])
        c = cls(ts[0][0], ts[0][1]) if ts else 'no tool (stop/reply)'
        gap = clip(prev_end, rx)
        cmp_s = 0.0
        for cs, ce in comp[sk]:
            cmp_s += clip(max(cs, prev_end), min(ce, rx)) if min(ce, rx) > max(cs, prev_end) else 0.0
        model_s = gap - cmp_s
        ends = [t[3] for t in ts if t[3]]
        tool_s = clip(rx, max(ends)) if ends else 0.0
        phase = 'before first write/edit' if not first_write_seen else 'after first write/edit'
        if ts and any(t[0] in ('edit', 'write') for t in ts): first_write_seen = True
        acc['compaction'] += cmp_s
        acc[f'model:{c}'] += model_s; acc[f'tool:{c}'] += tool_s
        acc[f'phase:{phase}'] += model_s + tool_s
        if c in ('read','shell: look (cat/ls/grep/git read)'): acc[f'looking:{phase}'] += model_s + tool_s
        counts[g][f'calls:{c}'] += 1
        # edit misses: failed edit's own time, and the call right after it
        failed_edit = bool(ts) and ts[0][0] == 'edit' and any(t[4] for t in ts)
        if failed_edit:
            acc['edit-miss: the failed call (model+tool)'] += model_s + tool_s
            counts[g]['edit-miss calls'] += 1
        if prev and prev[0]:
            acc['edit-miss: the call after it (model+tool)'] += model_s + tool_s
            acc[f'edit-miss: next call was {c}'] += model_s + tool_s
        prev = (failed_edit,)
        story_total += model_s + tool_s + cmp_s
        prev_end = max(ends) if ends else rx
    acc['total attributed'] = story_total
    if started and finished: acc['recorded wall'] = finished - started
    for k, v in acc.items(): per_group[g][k] += v
    share_rows.append((g, sk, acc))

out = []
def hms(x): return f'{x/3600:.1f} h'
groups = sorted(per_group)
out.append('stories used (timestamped) / skipped (no timestamps): ' + '; '.join(f'{g} {story_n[g]}/{story_skip[g]}' for g in groups))
out.append('')
out.append('| where the time goes | ' + ' | '.join(groups) + ' |')
out.append('|---|' + '---:|' * len(groups))
def row(label, key):
    cells = []
    for g in groups:
        tot = per_group[g]['total attributed']
        v = per_group[g][key]
        cells.append(f'{v/3600:.1f} h ({100*v/tot:.0f}%)' if tot else '-')
    out.append(f'| {label} | ' + ' | '.join(cells) + ' |')
cl = ['read', 'edit', 'write', 'shell: look (cat/ls/grep/git read)', 'shell: test/build run', 'shell: git write', 'shell: other', 'other tool', 'no tool (stop/reply)']
for c in cl:
    row(f'model time producing a `{c}` call', f'model:{c}')
for c in cl:
    row(f'tool time running a `{c}` call', f'tool:{c}')
row('compaction', 'compaction')
out.append('| **total attributed** | ' + ' | '.join(f"{per_group[g]['total attributed']/3600:.1f} h" for g in groups) + ' |')
out.append('| recorded wall (stories with start+finish) | ' + ' | '.join(f"{per_group[g]['recorded wall']/3600:.1f} h" for g in groups) + ' |')
out.append('')
out.append('| phase | ' + ' | '.join(groups) + ' |'); out.append('|---|' + '---:|' * len(groups))
for p in ('before first write/edit', 'after first write/edit'):
    row(p, f'phase:{p}')
out.append('')
out.append('| edit misses | ' + ' | '.join(groups) + ' |'); out.append('|---|' + '---:|' * len(groups))
row('failed edit call itself (model+tool)', 'edit-miss: the failed call (model+tool)')
row('the call right after a failed edit (model+tool)', 'edit-miss: the call after it (model+tool)')
out.append('| failed edit calls | ' + ' | '.join(str(counts[g]['edit-miss calls']) for g in groups) + ' |')
out.append('| model calls (timed) | ' + ' | '.join(str(sum(v for k, v in counts[g].items() if k.startswith('calls:'))) for g in groups) + ' |')
print('\n'.join(out))

print()
def tot(g, keys): return sum(per_group[g][k] for k in keys)
buckets = {
 'looking: read tool + shell cat/ls/grep (model + tool)': ['model:read','tool:read','model:shell: look (cat/ls/grep/git read)','tool:shell: look (cat/ls/grep/git read)'],
 'writing code: edit + write calls (model + tool)': ['model:edit','tool:edit','model:write','tool:write'],
 'running tests/builds (model + tool)': ['model:shell: test/build run','tool:shell: test/build run'],
 'other shell, git, other tools, replies, compaction': ['model:shell: other','tool:shell: other','model:shell: git write','tool:shell: git write','model:other tool','tool:other tool','model:no tool (stop/reply)','compaction'],
}
print('| bucket | ' + ' | '.join(groups) + ' |'); print('|---|' + '---:|' * len(groups))
for lab, keys in buckets.items():
    print(f'| {lab} | ' + ' | '.join(f"{tot(g,keys)/3600:.1f} h ({100*tot(g,keys)/per_group[g]['total attributed']:.0f}%)" for g in groups) + ' |')
print('| of which: model time (generating + reading the previous result) in looking | ' + ' | '.join(f"{100*tot(g,['model:read','model:shell: look (cat/ls/grep/git read)'])/tot(g,buckets[list(buckets)[0]]):.0f}% of looking" for g in groups) + ' |')

print()
print('| looking time by phase (Qwen groups; phase = before/after the first edit or write tool call) | ' + ' | '.join(groups[:5]) + ' |'); print('|---|' + '---:|'*5)
for p in ('before first write/edit','after first write/edit'):
    print(f'| {p} | ' + ' | '.join(f"{per_group[g]['looking:'+p]/3600:.1f} h" for g in groups[:5]) + ' |')
