"""detect_core.py conv.db — the backbone tables: every model call, tool call, bash command and tool result in exactly
one class, by combination. Standard library only."""
import collections
import re
import sqlite3
import statistics as st
import sys

db = sqlite3.connect(f'file:{sys.argv[1] if len(sys.argv) > 1 else "conv.db"}?mode=ro', uri=True)
GROUPS = ['FN gufo', 'FN mlx-serve', 'FN MTPLX', 'FN llama.cpp', '27B llama.cpp', 'Swift llama.cpp', 'Swift 1.5 llama.cpp', 'Opus 5.5', 'Sonnet 5.5']
QWEN = GROUPS[:7]
ENGINE = {'gufo': 'gufo', 'mlxserve': 'mlx-serve', 'mtplx': 'MTPLX', 'llamacpp': 'llama.cpp'}


def group(family, variant, engine):
    if family == 'claude':
        return 'Opus 5.5' if variant == 'opus-5.5' else 'Sonnet 5.5'
    if family == 'qwen 3.8-swift':
        return 'Swift llama.cpp'
    if family == 'qwen 3.8-swift-1.5':
        return 'Swift 1.5 llama.cpp'
    return ('FN ' if variant == 'flash-next' else '27B ') + ENGINE[engine]


G = {sk: group(f, v, e) for sk, f, v, e in db.execute('select sk, family, variant, engine from stories')}
STORIES = collections.Counter(G.values())

CD = re.compile(r'^\s*(?:cd\s+(?:"[^"]*"|\'[^\']*\'|\S+)\s*(?:&&|;)\s*)+')
ENVS = re.compile(r'^\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|\'[^\']*\'|\S*)\s+)|(?:timeout\s+(?:-\S+\s+)*\S+\s+)|(?:time\s+)|(?:nice\s+(?:-n\s*\d+\s+)?)|(?:\(\s*))+')
# A bash command's purpose: the first rule that matches wins, so every command has exactly one.
PURPOSE = [
    ('run tests: end-to-end', r'playwright\s+test|test:e2e|\be2e\b.*\b(?:test|spec)\b'),
    ('run tests: integration', r'test:integration|vitest[^|;&]*integration|--project[= ]integration'),
    ('run tests: unit and component', r'\bvitest\b|npm (?:run )?test\b|test:unit|test:component|\bjest\b|node --test'),
    ('build, typecheck, lint', r'\btsc\b|typecheck|npm run build|vite build|\beslint\b|wrangler (?:deploy|types)|npm run lint'),
    ('install or look up packages', r'npm (?:i|install|ci|view|ls|outdated|info|pack|init|uninstall|remove)\b|playwright install|pip3? install|\byarn\b|\bpnpm\b|\bbun (?:add|install)\b'),
    ('git: change history or tree', r'\bgit\s+(?:-C\s+\S+\s+)?(?:add|commit|stash|checkout|switch|reset|restore|worktree|rm|mv|merge|rebase|tag|branch|config|init|clean|revert|cherry-pick|push|pull|fetch|clone|remote|apply)\b'),
    ('git: look', r'\bgit\s+(?:-C\s+\S+\s+)?(?:status|log|diff|show|ls-files|rev-parse|blame|grep|describe|cat-file|ls-tree|shortlog|reflog)\b'),
    ('processes and ports', r'\b(?:pkill|kill|killall|fuser|lsof|pgrep|netstat)\b|\bps\s+-|\bps\s+aux|\bss\s+-'),
    ('servers, requests, waiting', r'wrangler\s+dev|npm run (?:dev|serve|start|preview)|\bvite\b(?!\s+build)|\bcurl\b|\bwget\b|\bsleep\b|\bnc\b\s|http-server|\bserve\b'),
    ('write files through the shell', r'<<\s*[\'"]?\w+|(?<![0-9&|])>{1,2}\s*[\w./~"$-]+(?<!/dev/null)|\bsed\s+(?:-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\btee\b|\b(?:cp|mv|rm|mkdir|touch|chmod|ln|rmdir|truncate|patch)\b|writeFileSync|write_text|open\([^)]*[\'"][wa]'),
    ('run code', r'\bnode\b|\bpython3?\b|\bnpx\s+(?:tsx|ts-node)|\bbun\b|\bdeno\b|\bnpx\b'),
    ('read and search files', r'\b(?:grep|rg|cat|sed|head|tail|ls|find|wc|awk|pwd|echo|printf|date|which|file|stat|du|df|tree|diff|sort|uniq|cut|jq|xxd|od|test|\[)\b|^\s*$'),
]
PURPOSE_RX = [(n, re.compile(p)) for n, p in PURPOSE]


def purpose(cmd):
    body = cmd or ''
    devnull = re.sub(r'\d?>{1,2}\s*/dev/null|2>&1', '', body)
    for name, rx in PURPOSE_RX:
        if rx.search(devnull):
            return name
    return 'other'


def table(title, head, rows):
    print(f'\n### {title}\n')
    print('| ' + ' | '.join(head) + ' |')
    print('|' + '|'.join('---' for _ in head) + '|')
    for r in rows:
        print('| ' + ' | '.join(str(x) for x in r) + ' |')


def pct(n, d):
    return f'{100 * n / d:.0f}%' if d else '–'


def spread(vals):
    return f'{min(vals):.0f}–{max(vals):.0f}'


# ---- 0. what is covered
rows = []
for g in GROUPS:
    sks = [sk for sk, x in G.items() if x == g]
    q = ','.join(map(str, sks))
    runs = db.execute(f'select count(distinct stack || run) from stories where sk in ({q})').fetchone()[0]
    calls = db.execute(f'select count(*) from calls where sk in ({q})').fetchone()[0]
    tools = db.execute(f'select count(*) from tools where sk in ({q})').fetchone()[0]
    full = db.execute(f"select count(*) from stories where sk in ({q}) and (source='full' or truncated_strings=0)").fetchone()[0]
    rows.append((g, runs, len(sks), calls, tools, full))
table('0. What is covered', ['combination', 'runs', 'story conversations', 'model calls', 'tool calls', 'conversations with full text'],
      rows + [('all', sum(r[1] for r in rows), sum(r[2] for r in rows), sum(r[3] for r in rows), sum(r[4] for r in rows), sum(r[5] for r in rows))])

# ---- A. every model call, one class
KINDS = ['tool call, no visible text', 'tool call with text', 'stops with text', 'stops with nothing']
cnt = collections.defaultdict(collections.Counter)
for sk, think, text, n in db.execute('select sk, think, text, n_tools from calls where sub=0'):
    k = (KINDS[1] if text else KINDS[0]) if n else (KINDS[2] if text else KINDS[3])
    cnt[G[sk]][k] += 1
table('A. Every model call by what it did (share of the combination\'s calls)', ['class', *GROUPS],
      [(k, *[pct(cnt[g][k], sum(cnt[g].values())) for g in GROUPS]) for k in KINDS] + [('model calls', *[sum(cnt[g].values()) for g in GROUPS])])

# ---- B. every tool call by tool
tool = collections.defaultdict(collections.Counter)
for sk, name in db.execute('select sk, lower(name) from tools where sub=0'):
    tool[G[sk]][name if name in ('bash', 'read', 'edit', 'write') else 'other tools'] += 1
names = ['bash', 'read', 'edit', 'write', 'other tools']
table('B. Every tool call by tool (share)', ['tool', *GROUPS],
      [(n, *[pct(tool[g][n], sum(tool[g].values())) for g in GROUPS]) for n in names] + [('tool calls', *[sum(tool[g].values()) for g in GROUPS])])

# ---- C. every bash command by purpose
purp = collections.defaultdict(collections.Counter)
secs = collections.defaultdict(collections.Counter)
for sk, arg, s, e in db.execute("select sk, arg, start, end from tools where lower(name)='bash' and sub=0"):
    p = purpose(arg)
    purp[G[sk]][p] += 1
    if s and e:
        secs[G[sk]][p] += e - s
order = [n for n, _ in PURPOSE] + ['other']
table('C. Every bash command by purpose (share of commands; first matching rule wins)', ['purpose', *GROUPS],
      [(n, *[pct(purp[g][n], sum(purp[g].values())) for g in GROUPS]) for n in order] + [('bash commands', *[sum(purp[g].values()) for g in GROUPS])])
table('C2. Tool time by purpose (share of bash seconds)', ['purpose', *GROUPS],
      [(n, *[pct(secs[g][n], sum(secs[g].values())) for g in GROUPS]) for n in order] + [('bash hours', *[f'{sum(secs[g].values()) / 3600:.1f}' for g in GROUPS])])

# ---- D. every tool result, one class
OUTCOMES = ['edit refused: the text to replace was not found', 'read or write refused', 'test run: reports failing tests', 'test run: no failure reported',
            'other command: exited non-zero', 'other command: exited zero', 'read, edit or write: done', 'never returned']
res = collections.defaultdict(collections.Counter)
hidden = collections.defaultdict(collections.Counter)
for sk, name, arg, err, flags, failed in db.execute('select sk, lower(name), arg, error, res_flags, failed from tools where sub=0'):
    f = set((flags or '').split(','))
    if err is None:
        k = OUTCOMES[7]
    elif name == 'edit' and err:
        k = OUTCOMES[0]
    elif name != 'bash':
        k = OUTCOMES[1] if err else OUTCOMES[6]
    elif purpose(arg).startswith('run tests'):
        failing = (failed or 0) > 0 or 'tests_failed' in f
        k = OUTCOMES[2] if failing else OUTCOMES[3]
        if failing:
            hidden[G[sk]]['exit zero' if not err else 'exit non-zero'] += 1
    else:
        k = OUTCOMES[4] if err else OUTCOMES[5]
    res[G[sk]][k] += 1
table('D. Every tool result by outcome (share)', ['outcome', *GROUPS],
      [(k, *[pct(res[g][k], sum(res[g].values())) for g in GROUPS]) for k in OUTCOMES] + [('tool calls', *[sum(res[g].values()) for g in GROUPS])])
table('D2. Test runs that report failing tests: what exit status the agent\'s tool saw', ['', *GROUPS],
      [('reported failures, tool saw success (exit zero)', *[hidden[g]['exit zero'] for g in GROUPS]),
       ('reported failures, tool saw failure', *[hidden[g]['exit non-zero'] for g in GROUPS]),
       ('share seen as success', *[pct(hidden[g]['exit zero'], sum(hidden[g].values())) for g in GROUPS])])

# ---- E. the shape of a story: medians per story, by combination
per = collections.defaultdict(lambda: collections.defaultdict(list))
for sk, calls, think, text_calls, stops in db.execute('''select sk, count(*), sum(think), sum(text>0), sum(n_tools=0) from calls where sub=0 group by sk'''):
    g = G[sk]
    per[g]['model calls'].append(calls)
    per[g]['thinking, thousand characters'].append((think or 0) / 1000)
    per[g]['stops'].append(stops)
for sk, n, reads, edits, writes, bash, errs in db.execute('''select sk, count(*), sum(lower(name)='read'), sum(lower(name)='edit'), sum(lower(name)='write'), sum(lower(name)='bash'), sum(error=1) from tools where sub=0 group by sk'''):
    g = G[sk]
    per[g]['tool calls'].append(n)
    per[g]['file reads (read tool)'].append(reads)
    per[g]['edits'].append(edits)
    per[g]['whole-file writes'].append(writes)
    per[g]['bash commands'].append(bash)
    per[g]['tool calls that failed'].append(errs)
tests = collections.Counter()
for sk, arg in db.execute("select sk, arg from tools where lower(name)='bash' and sub=0"):
    if purpose(arg).startswith('run tests'):
        tests[sk] += 1
for sk, g in G.items():
    per[g]['test runs'].append(tests[sk])
for sk, n in db.execute('select sk, count(*) from compactions group by sk'):
    per[G[sk]]['compactions (stories with any)'].append(n)
for sk, wall in db.execute('select sk, wall from stories where wall is not null'):
    per[G[sk]]['minutes'].append(wall / 60)
metrics = ['minutes', 'model calls', 'tool calls', 'bash commands', 'file reads (read tool)', 'edits', 'whole-file writes', 'test runs', 'tool calls that failed', 'stops', 'thinking, thousand characters']
table('E. A story, in medians per combination', ['per story (median)', *GROUPS, 'range across the seven Qwen combinations'],
      [(m, *[f'{st.median(per[g][m]):.0f}' if per[g][m] else '–' for g in GROUPS], spread([st.median(per[g][m]) for g in QWEN if per[g][m]])) for m in metrics])

# ---- F. ratios that do not depend on story length
ratio = collections.defaultdict(dict)
for g in GROUPS:
    q = ','.join(str(sk) for sk, x in G.items() if x == g)
    c = db.execute(f'select count(*), sum(n_tools), sum(n_tools>1), sum(think), sum(text), sum(think>0) from calls where sub=0 and sk in ({q})').fetchone()
    t = db.execute(f"select count(*), sum(error=1), sum(lower(name)='edit'), sum(lower(name)='edit' and error=1), sum(lower(name)='write'), sum(lower(name)='read'), sum(lower(name)='bash') from tools where sub=0 and sk in ({q})").fetchone()
    med_think = st.median([x[0] for x in db.execute(f'select think from calls where sub=0 and think>0 and sk in ({q})')] or [0])
    ratio[g] = {
        'tool calls per model call': f'{c[1] / c[0]:.2f}',
        'model calls making more than one tool call': pct(c[2], c[0]),
        'tool calls that fail': pct(t[1], t[0]),
        'edits refused': pct(t[3], t[2]),
        'edits per whole-file write': f'{t[2] / t[4]:.1f}' if t[4] else '–',
        'bash commands per read-tool call': f'{t[6] / t[5]:.1f}' if t[5] else '–',
        'bash commands that are test runs': pct(sum(tests[sk] for sk, x in G.items() if x == g), t[6]),
        'thinking per call that thinks, median characters': f'{med_think:.0f}',
    }
keys = list(ratio[GROUPS[0]])
table('F. Ratios, by combination', ['ratio', *GROUPS], [(k, *[ratio[g][k] for g in GROUPS]) for k in keys])
