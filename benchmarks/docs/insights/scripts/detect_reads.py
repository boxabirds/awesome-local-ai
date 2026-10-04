"""detect_reads.py <database>: how many look calls (read tool, or shell cat/ls/grep/...) could a bulk read have merged? Read-only on conv_full.db, Qwen only.

look call      = a call with exactly one tool, that tool being `read`, or a shell command that only looks (EXPLORE_RX).
run            = consecutive look calls. A run of n could have been 1 call: n-1 round trips are the upper bound on what bulk reading
                 removes (later reads may depend on earlier results, so this is a ceiling, not an estimate).
re-read        = `read` of a path read earlier in the same story, with no edit/write of that path and no mutating shell command
                 between, and no compaction between (after a compaction the agent has lost the file, so reading again is needed).
Seconds        = the model time (wait before the reply) of the removable calls, in stories with timestamps."""
import sqlite3, re, sys, collections, statistics

con = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
EXPLORE_RX = re.compile(r'^\s*(cd [^&;|]+(&&|;)\s*)?(cat|ls|head|tail|sed -n|grep|rg|find|wc|tree|pwd|file|stat|git (status|log|show|diff|rev-parse|ls-files)|which|test -[a-z]|\[)\b')
MUTATE_RX = re.compile(r'(\bsed -i|>>?\s*\S|\btee\b|\bmv\b|\bcp\b|\brm\b|\bgit (checkout|stash|reset|restore|apply|merge|pull|clean|worktree)\b|\bnpm (install|i|ci)\b|\bpatch\b|\bperl -pi|\btouch\b|\bmkdir\b)')
def norm(p): return re.sub(r'^\./', '', (p or '').strip())

G = collections.defaultdict(lambda: collections.Counter())
SEC = collections.defaultdict(lambda: collections.Counter())
RUNLEN = collections.defaultdict(list)
stories = con.execute("select sk, variant||'/'||engine, started, finished from stories where family like 'qwen%'").fetchall()
for sk, g, a, b in stories:
    calls = con.execute('select idx, rx from calls where sk=? order by idx', (sk,)).fetchall()
    timed = bool(calls) and all((c[1] or 0) > 0 for c in calls) and a and b
    comps = [c[0] for c in con.execute('select start from compactions where sk=? and start is not null', (sk,))]
    tl = collections.defaultdict(list)
    for ci, name, arg in con.execute('select call_idx, name, arg from tools where sk=? order by call_idx, idx', (sk,)):
        tl[ci].append((name, arg or ''))
    G[g]['stories'] += 1
    if timed: G[g]['timed stories'] += 1
    untimed_comp = (not timed) and bool(con.execute('select 1 from compactions where sk=? limit 1', (sk,)).fetchone())
    G[g]['untimed stories with a compaction'] += untimed_comp
    seen = {}            # path -> True while still valid
    first_write = False
    run = []             # list of (idx, phase, is_read_tool, model_s)
    prev_end = a if a else (calls[0][1] if calls else 0)
    lo_w = a if a else -1e18; hi_w = b if b else 1e18
    ci_comp = 0
    def flush():
        global run
        if len(run) >= 2:
            ph = run[0][1]
            G[g][f'runs>=2 ({ph})'] += 1
            G[g][f'round trips removable ({ph})'] += len(run) - 1
            G[g]['round trips removable'] += len(run) - 1
            if all(r[2] for r in run): G[g]['round trips removable, all `read` tool'] += len(run) - 1
            for r in run[1:]:
                if r[3] is not None: SEC[g]['removable model seconds'] += r[3]
            RUNLEN[g].append(len(run))
        run = []
    for idx, rx in calls:
        ts = tl.get(idx, [])
        model_s = None
        if timed:
            model_s = max(0.0, min(rx, hi_w) - max(prev_end, lo_w))
            ends = [t for t in con.execute('select end from tools where sk=? and call_idx=? and end>0', (sk, idx))]
            prev_end = max([e[0] for e in ends], default=rx)
            SEC[g]['all model seconds'] += model_s
        # compaction boundary: forget what was read
        if timed and any(c <= rx for c in comps[ci_comp:]):
            while ci_comp < len(comps) and comps[ci_comp] <= rx: ci_comp += 1
            seen.clear(); flush()
        phase = 'after first write' if first_write else 'before first write'
        is_look = len(ts) == 1 and (ts[0][0] == 'read' or (ts[0][0] in ('bash', 'Bash') and EXPLORE_RX.search(ts[0][1]) and not MUTATE_RX.search(ts[0][1])))
        if is_look:
            G[g]['look calls'] += 1; G[g][f'look calls ({phase})'] += 1
            run.append((idx, phase, ts[0][0] == 'read', model_s))
            if ts[0][0] == 'read':
                p = norm(ts[0][1])
                if p in seen:
                    if timed or not untimed_comp:
                        G[g]['re-reads (no change to the file since, no compaction)'] += 1
                        if model_s is not None: SEC[g]['re-read model seconds'] += model_s
                seen[p] = True
        else:
            flush()
            for name, arg in ts:
                if name in ('edit', 'write'):
                    seen.pop(norm(arg), None); first_write = True
                elif name in ('bash', 'Bash') and MUTATE_RX.search(arg):
                    seen.clear()
        G[g]['calls'] += 1
    flush()

groups = sorted(G)
print('| measure | ' + ' | '.join(groups) + ' |'); print('|---|' + '---:|' * len(groups))
def row(label, key, src=G, fmt=lambda v: f'{v:,}'):
    print(f'| {label} | ' + ' | '.join(fmt(src[g][key]) for g in groups) + ' |')
row('stories', 'stories'); row('timed stories', 'timed stories'); row('untimed stories that had a compaction (re-reads not counted there)', 'untimed stories with a compaction')
row('model calls', 'calls'); row('look calls', 'look calls')
row('  before first write', 'look calls (before first write)'); row('  after first write', 'look calls (after first write)')
print('| runs of 2+ look calls: before / after first write | ' + ' | '.join(f"{G[g]['runs>=2 (before first write)']} / {G[g]['runs>=2 (after first write)']}" for g in groups) + ' |')
print('| median run length (runs of 2+) | ' + ' | '.join(str(statistics.median(RUNLEN[g])) if RUNLEN[g] else '-' for g in groups) + ' |')
row('round trips a bulk read could remove (ceiling)', 'round trips removable')
print('| ... as % of all model calls | ' + ' | '.join(f"{100*G[g]['round trips removable']/G[g]['calls']:.0f}%" for g in groups) + ' |')
row('... of which in runs made only of `read` calls', 'round trips removable, all `read` tool')
row('re-reads of an unchanged file, no compaction between', 're-reads (no change to the file since, no compaction)')
print('| model time of the removable round trips (timed stories) | ' + ' | '.join(f"{SEC[g]['removable model seconds']/3600:.1f} h ({100*SEC[g]['removable model seconds']/SEC[g]['all model seconds']:.0f}% of model time)" for g in groups) + ' |')
print('| model time of the re-reads (timed stories) | ' + ' | '.join(f"{SEC[g]['re-read model seconds']/3600:.1f} h ({100*SEC[g]['re-read model seconds']/SEC[g]['all model seconds']:.0f}%)" for g in groups) + ' |')
