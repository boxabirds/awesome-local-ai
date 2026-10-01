"""detect_performance.py <database>: every table of the performance findings, as markdown, deterministically.

Run on conv_full.db (complete text). Standard library only. `--samples [detector]` prints 25 hits per detector, chosen
with a fixed seed, for reading (precision); `--only N,N` runs only those sections."""
import collections, json, os, random, re, sqlite3, sys

# Machine names never appear in examples: give them as INSIGHTS_MACHINE_NAMES="name,name" (they are not kept in the repo).
_NAMES = [n for n in os.environ.get('INSIGHTS_MACHINE_NAMES', '').split(',') if n]
MACHINE_RX = re.compile('|'.join(map(re.escape, _NAMES))) if _NAMES else None

GROUPS = ['Flash/gufo', 'Flash/mlx-serve', 'Flash/MTPLX', 'Flash/llama.cpp', '27B/llama.cpp', 'Swift 27B', 'Swift 1.5 27B', 'Opus 5.5', 'Sonnet 5.5']
QWEN = GROUPS[:7]


def group_of(family, variant, engine):
    if family == 'claude': return 'Opus 5.5' if variant.startswith('opus') else 'Sonnet 5.5'
    if family == 'qwen 3.8-swift': return 'Swift 27B'
    if family == 'qwen 3.8-swift-1.5': return 'Swift 1.5 27B'
    if variant == '27b': return '27B/llama.cpp'
    return {'gufo': 'Flash/gufo', 'mlxserve': 'Flash/mlx-serve', 'mtplx': 'Flash/MTPLX', 'llamacpp': 'Flash/llama.cpp'}[engine]


class Tool:
    __slots__ = ('sk', 'call', 'idx', 'name', 'arg', 'arg_full', 'arg_chars', 'start', 'end', 'error', 'res_chars',
                 'n_edits', 'old_chars', 'new_chars', 'passed', 'failed', 'kind', 'segs', 'path', 'cdlen', 'cdform', 'aj', 'res', '_args')

    def args(self):
        """The complete arguments of the call (a dict), from args_json."""
        if self._args is None:
            try: self._args = json.loads(self.aj) if self.aj else {}
            except ValueError: self._args = {}
            if not isinstance(self._args, dict): self._args = {}
        return self._args


class Call:
    __slots__ = ('sk', 'idx', 'rx', 'think', 'text', 'n_tools', 'out_tok', 'in_tok', 'cache_tok', 'stop', 'text_full', 'think_full', 'tools')


class Story:
    __slots__ = ('sk', 'group', 'run', 'story', 'client', 'wall', 'tools', 'calls', 'msgs', 'comps', 'ws', 'timed', 'runkey', 'invalid', 'cut', '_replay', 'source')


WS_RX = re.compile(r'~/\.vidi-bench/work/[^/\s"\']+(?:/[^/\s"\']+)?/workspace')
# ---------------------------------------------------------------- bash command classification
HEREDOC = re.compile(r'<<-?\s*[\'"]?([A-Za-z_]\w*)[\'"]?')


def blank_quotes(b):
    """Replace the content of every quoted string by Q, so separators inside quotes do not split the command."""
    out = []; i = 0; n = len(b)
    while i < n:
        ch = b[i]
        if ch == '\\' and i + 1 < n: out.append('  ' if b[i + 1] == '\n' else ch + b[i + 1]); i += 2; continue
        if ch == "'":
            j = b.find("'", i + 1); j = n - 1 if j < 0 else j
            out.append("'Q'"); i = j + 1; continue
        if ch == '"':
            j = i + 1
            while j < n and b[j] != '"': j += 2 if b[j] == '\\' else 1
            out.append('"Q"'); i = j + 1; continue
        out.append(ch); i += 1
    return ''.join(out)

FDRED = re.compile(r'\d?>&\d|&>\s*/dev/null|\d?>\s*/dev/null')
SPLIT = re.compile(r'(&&|\|\||;|\||\n|&)')
ENVASSIGN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*=\S*$')
WRAPPERS = {'time', 'nohup', 'setsid', 'exec', 'sudo', 'env', 'command', 'do', 'then', 'else', 'if', 'while', 'until', '!', '{', 'stdbuf'}
REDIR = re.compile(r'(?<![0-9&>])>>?\s*(?!&)[\w./~$Q"\'-]')
LEAD_CD = re.compile(r'^\s*cd\s+("[^"]*"|\'[^\']*\'|[^\s;&|]+)\s*(?:&&|;|\n)\s*')
PY_WRITES = re.compile(r'\.write\(|write_text|open\([^)]*[\'"][wa]\+?[\'"]|writeFileSync|fileinput|\.writelines\(')
NONE_HEADS = {'echo', 'printf', 'cd', 'export', 'true', 'false', 'done', 'fi', 'pwd', 'set', 'for', 'esac', 'case', 'in', 'test', '[', '[[', 'read', 'local', 'unset', 'wait', 'exit', 'return', ':', 'source', '.', 'date', '}', ')', 'trap', 'shopt', 'break', 'continue', '#'}
READ_HEADS = {'cat', 'sed', 'head', 'tail', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'ls', 'wc', 'awk', 'diff', 'file', 'stat', 'tree', 'jq', 'sort', 'uniq', 'cut', 'which', 'strings', 'less', 'more', 'nl', 'du', 'df', 'tr', 'xxd', 'od', 'cmp', 'basename', 'dirname', 'realpath', 'readlink', 'type', 'whoami', 'uname', 'hostname', 'id', 'md5sum', 'sha256sum', 'shasum', 'column', 'fold', 'tac', 'rev', 'comm', 'paste', 'xargs', 'hexdump', 'printenv', 'nproc', 'free', 'uptime', 'identify'}
FILEOP_HEADS = {'rm', 'mkdir', 'mv', 'cp', 'touch', 'chmod', 'ln', 'tee', 'rmdir', 'truncate', 'patch', 'tar', 'unzip', 'zip', 'gzip', 'gunzip', 'dd', 'install', 'rsync', 'convert', 'magick'}
SERVER_HEADS = {'curl', 'wget', 'sleep'}
PROC_HEADS = {'pkill', 'kill', 'killall', 'fuser', 'lsof', 'ss', 'ps', 'pgrep', 'netstat', 'nc', 'top', 'jobs', 'disown', 'fg', 'bg'}
PRIORITY = ['test_e2e', 'test_unit', 'test_component', 'test_integration', 'test_other', 'install', 'server', 'build', 'git', 'write', 'script', 'proc', 'dep_lookup', 'read', 'other', 'none']
TEST_KINDS = ('test_e2e', 'test_unit', 'test_component', 'test_integration', 'test_other')


def strip_heredocs(cmd):
    """Return (command without heredoc bodies, list of heredoc bodies)."""
    out, bodies, pos = [], [], 0
    while True:
        m = HEREDOC.search(cmd, pos)
        if not m: out.append(cmd[pos:]); break
        nl = cmd.find('\n', m.end())
        if nl < 0: out.append(cmd[pos:]); break
        out.append(cmd[pos:m.start()] + ' <<HEREDOC ' + cmd[m.end():nl])
        term = re.compile(r'^\s*' + re.escape(m.group(1)) + r'\s*$', re.M)
        t = term.search(cmd, nl)
        if not t: bodies.append(cmd[nl:]); break
        bodies.append(cmd[nl:t.start()]); pos = t.end()
    return ''.join(out), bodies


def seg_kind(tokens, seg, raw_quoted):
    """Kind of one pipeline segment. tokens: words with wrappers removed. seg: the segment (quotes blanked)."""
    if not tokens: return 'none', ''
    h = tokens[0].lstrip('({').rsplit('/', 1)[-1]
    rest = tokens[1:]
    if h in ('npx', 'bunx', 'pnpx') or (h in ('npm', 'pnpm') and rest[:1] == ['exec']):
        r = [t for t in (rest[1:] if rest[:1] == ['exec'] else rest) if not t.startswith('-')]
        if not r: return 'other', h
        h = r[0].rsplit('/', 1)[-1]; rest = r[1:]
    if h == 'node' and rest and re.search(r'(vitest|playwright|tsc|vite|wrangler)[^/]*$|/(vitest|playwright|typescript|vite|wrangler)/', rest[0]):
        mm = re.search(r'(vitest|playwright|tsc|typescript|vite|wrangler)', rest[0].rsplit('node_modules/', 1)[-1]); h = mm.group(1).replace('typescript', 'tsc'); rest = rest[1:]
    s = ' '.join(rest)
    if h == 'playwright':
        if 'test' in rest: return 'test_e2e', 'playwright test'
        if 'install' in rest or 'install-deps' in rest: return 'install', 'playwright install'
        return 'other', 'playwright'
    if h == 'vitest':
        if re.search(r'--project[= ]unit|tests?/unit|\bunit\b', s): return 'test_unit', 'vitest'
        if re.search(r'--project[= ]component|component', s): return 'test_component', 'vitest'
        if re.search(r'--project[= ]integration|integration|workers', s): return 'test_integration', 'vitest'
        return 'test_other', 'vitest'
    if h in ('npm', 'bun', 'pnpm', 'yarn'):
        rest = [x for x in rest if x not in ('-s', '--silent', '--no-env-file')]
        sub = rest[0] if rest else ''
        if sub in ('run', 'run-script') and len(rest) > 1: sub = rest[1]; scripted = True
        else: scripted = False
        if sub.startswith('test:e2e') or sub in ('e2e', 'test:nightly'): return 'test_e2e', 'npm run ' + sub
        if sub.startswith('test:unit'): return 'test_unit', 'npm run ' + sub
        if sub.startswith('test:component'): return 'test_component', 'npm run ' + sub
        if sub.startswith('test:integration') or sub.startswith('test:worker'): return 'test_integration', 'npm run ' + sub
        if sub == 'test' or sub.startswith('test'): return 'test_other', 'npm ' + sub
        if re.match(r'(typecheck|build|lint|check|tsc|format)', sub): return 'build', 'npm run ' + sub
        if sub in ('dev', 'start', 'preview', 'serve') or sub.startswith('dev'): return 'server', 'npm run ' + sub
        if not scripted and sub in ('install', 'i', 'ci', 'add', 'uninstall', 'remove', 'update', 'rebuild', 'dedupe', 'link', 'init', 'create'): return 'install', 'npm install'
        if not scripted and sub in ('view', 'info', 'ls', 'list', 'outdated', 'pack', 'cache', 'show', 'search', 'config', 'root', 'bin', 'prefix', 'explain', 'why', 'pm', '-v', '--version', 'version', 'audit', 'fund', 'doctor', 'ping', 'pkg'): return 'dep_lookup', 'npm ' + sub
        return 'other', 'npm ' + sub
    if h in ('tsc', 'eslint', 'esbuild', 'prettier', 'tsup', 'rollup', 'biome'): return 'build', h
    if h == 'vite': return ('build', 'vite build') if 'build' in rest else ('server', 'vite')
    if h == 'wrangler': return ('server', 'wrangler dev') if ('dev' in rest or 'preview' in rest) else ('build', 'wrangler')
    if h in ('cmake', 'make', 'gcc', 'cc', 'g++', 'clang', 'ninja', 'cargo', 'meson', 'configure'): return 'build', h
    if h in ('apt', 'apt-get', 'dpkg', 'pip', 'pip3', 'brew', 'uv', 'dpkg-deb'): return 'install', h
    if h in SERVER_HEADS: return 'server', h
    if h in PROC_HEADS: return 'proc', h
    if h == 'git': return 'git', 'git ' + (rest[0] if rest else '')
    if h in ('sed', 'perl') and re.search(r'(^|\s)-[a-zA-Z]*i', s): return 'write', h + ' -i'
    if h in FILEOP_HEADS: return 'write', h
    if h in ('python3', 'python', 'node', 'tsx', 'ts-node', 'deno', 'ruby', 'bash', 'sh', 'zsh', 'perl'):
        if PY_WRITES.search(raw_quoted): return 'write', h + ' (writes file)'
        return 'script', h
    if REDIR.search(seg) and h in ('cat', 'echo', 'printf'): return 'write', h + ' >'
    if h in NONE_HEADS: return 'none', h
    if h in READ_HEADS: return 'read', h
    return 'other', h


def classify(cmd):
    """Return (kind, segments, leading-cd length, leading-cd target). segments: list of (kind, head, piped, text)."""
    raw = cmd or ''
    m = LEAD_CD.match(raw); cdlen = m.end() if m else 0; cdt = m.group(1) if m else None
    body, heredocs = strip_heredocs(raw[cdlen:])
    quoted = raw
    b = FDRED.sub(' ', blank_quotes(body))
    parts = SPLIT.split(b); segs = []; piped = False
    for i in range(0, len(parts), 2):
        seg = parts[i].strip(); sep_before = parts[i - 1] if i else ''
        piped = (sep_before == '|')
        if not seg: continue
        toks = seg.split()
        while toks:
            t = toks[0].lstrip('({')
            if not t: toks = toks[1:]; continue
            ma = re.match(r'^[A-Za-z_]\w*=["]?\$\((.+)$', t)
            if ma: toks[0] = ma.group(1); continue
            if t.startswith('$(') and len(t) > 2: toks[0] = t[2:]; continue
            if ENVASSIGN.match(t): toks = toks[1:]; continue
            if t == 'timeout':
                toks = toks[1:]
                while toks and (toks[0].startswith('-') or re.match(r'^\d+(\.\d+)?[smhd]?$', toks[0])):
                    if toks[0] in ('-k', '-s', '--signal', '--kill-after') and len(toks) > 1: toks = toks[2:]
                    else: toks = toks[1:]
                continue
            if t.rsplit('/', 1)[-1] in WRAPPERS:
                toks = toks[1:]
                while toks and toks[0].startswith('-') and t.rsplit('/', 1)[-1] in ('time', 'env', 'sudo', 'stdbuf'): toks = toks[1:]
                continue
            toks[0] = t; break
        k, h = seg_kind(toks, seg, quoted)
        segs.append((k, h, piped, seg))
    kinds = [s[0] for s in segs if not s[2]] or [s[0] for s in segs]
    kind = min(kinds, key=PRIORITY.index) if kinds else 'none'
    if kind == 'none': kind = 'read'      # bare echo / pwd / cd: inspection
    return kind, segs, cdlen, cdt


def norm_path(p, ws_rx=WS_RX):
    p = (p or '').strip().strip('"\'')
    p = ws_rx.sub('', p, count=1) if p.startswith('~/.vidi-bench') else p
    p = p.lstrip('/') if not (p.startswith('/tmp') or p.startswith('/usr') or p.startswith('/etc') or p.startswith('/var') or p.startswith('/opt') or p.startswith('/dev') or p.startswith('/proc')) else p
    while p.startswith('./'): p = p[2:]
    return p


FULL_TEXT = True     # set by load(): False when the database holds only heads and tails (conv.db)


def load(dbpath):
    """Read the whole database. Uses the complete text columns of conv_full.db; falls back to heads and tails on conv.db."""
    global FULL_TEXT
    db = sqlite3.connect('file:%s?mode=ro' % dbpath, uri=True)
    cols = lambda tb: set(r[1] for r in db.execute('pragma table_info(%s)' % tb))
    FULL_TEXT = 'res_full' in cols('tools')
    S = {}
    for r in db.execute('select sk,family,variant,engine,client,run,story,wall,invalid,truncated_strings,stack,source from stories order by sk'):
        s = Story(); s.sk = r[0]; s.group = group_of(r[1], r[2], r[3]); s.client = r[4]; s.run = r[5]; s.story = r[6]; s.wall = r[7]; s.invalid = r[8]; s.cut = r[9]
        s.runkey = (r[10], r[5]); s.source = r[11]; s._replay = None; s.tools = []; s.calls = []; s.msgs = []; s.comps = []; S[s.sk] = s
    tx = 'text_full,think_full' if FULL_TEXT else "coalesce(text_head,'')||coalesce(text_tail,''),coalesce(think_head,'')||coalesce(think_tail,'')"
    for r in db.execute('select sk,idx,rx,think,text,n_tools,out_tok,in_tok,cache_tok,stop,%s from calls order by sk,idx' % tx):
        c = Call(); (c.sk, c.idx, c.rx, c.think, c.text, c.n_tools, c.out_tok, c.in_tok, c.cache_tok, c.stop, c.text_full, c.think_full) = r; c.tools = []
        c.text_full = c.text_full or ''; c.think_full = c.think_full or ''; S[c.sk].calls.append(c)
    tx = 'args_json,res_full' if FULL_TEXT else "null,coalesce(res_head,'')||case when res_chars>400 then coalesce(res_tail,'') else '' end"
    for r in db.execute('select sk,call_idx,idx,name,arg,arg_full,arg_chars,start,end,error,res_chars,n_edits,old_chars,new_chars,passed,failed,%s from tools order by sk,idx' % tx):
        t = Tool(); (t.sk, t.call, t.idx, t.name, t.arg, t.arg_full, t.arg_chars, t.start, t.end, t.error, t.res_chars, t.n_edits, t.old_chars, t.new_chars, t.passed, t.failed, t.aj, t.res) = r
        t.name = (t.name or '').lower(); t.arg = t.arg or ''; t.res = t.res or ''; t.res_chars = t.res_chars or 0; t.arg_full = t.arg_full or len(t.arg); t._args = None
        t.kind = None; t.segs = []; t.path = None; t.cdlen = 0; t.cdform = None
        s = S[t.sk]; s.tools.append(t)
        if 0 <= t.call < len(s.calls): s.calls[t.call].tools.append(t)
    tx = 'text_full' if FULL_TEXT else 'text_head'
    for r in db.execute('select sk,idx,rx,%s,chars from msgs order by sk,idx' % tx): S[r[0]].msgs.append(r[1:])
    tx = 'summary' if FULL_TEXT else "''"
    for r in db.execute('select sk,start,end,reason,summary_chars,%s from compactions order by sk,start' % tx): S[r[0]].comps.append(r[1:])
    for s in S.values():
        cnt = collections.Counter()
        for t in s.tools:
            for m in WS_RX.finditer(t.arg[:400]): cnt[m.group(0)] += 1
        s.ws = cnt.most_common(1)[0][0] if cnt else None
        s.timed = bool(s.tools) and all(t.start is not None for t in s.tools) and all(c.rx is not None for c in s.calls)
        for t in s.tools:
            if t.name == 'bash':
                t.kind, t.segs, t.cdlen, cdt = classify(t.arg)
                if cdt is not None:
                    c = cdt.strip('"\'')
                    if WS_RX.fullmatch(c) or c.rstrip('/') == (s.ws or '\0'): t.cdform = 'absolute workspace path'
                    elif c in ('$(pwd)', '$PWD', '.', '${PWD}', '`pwd`'): t.cdform = 'cd to where it already is ($(pwd), $PWD, .)'
                    elif c in ('$(git rev-parse --show-toplevel)',): t.cdform = 'git top level'
                    else: t.cdform = 'elsewhere'
            elif t.name in ('read', 'edit', 'write'):
                t.kind = 'tool_' + t.name; t.path = norm_path(t.arg)
            else: t.kind = 'other_tool'
    return S


def md_table(headers, rows, out=sys.stdout):
    out.write('| ' + ' | '.join(str(h) for h in headers) + ' |\n')
    out.write('|' + '|'.join('---' for _ in headers) + '|\n')
    for r in rows: out.write('| ' + ' | '.join(fmt(x) for x in r) + ' |\n')
    out.write('\n')


def fmt(x):
    if isinstance(x, float): return f'{x:,.1f}' if abs(x) < 100 else f'{x:,.0f}'
    if isinstance(x, int): return f'{x:,}'
    return str(x)


def pct(a, b): return f'{100.0 * a / b:.1f}%' if b else 'n/a'


def quantile(sorted_vals, q):
    if not sorted_vals: return 0
    i = min(len(sorted_vals) - 1, int(q * len(sorted_vals)))
    return sorted_vals[i]

HITS = collections.defaultdict(list)     # detector name -> list of (story, text) for precision reading (--samples)
SLOW_S = 600                             # "tool calls of 600 s or more"
BIG_RESULT = 20000                       # characters: a "large" tool result
LONG_THINK = 10000                       # characters of thinking in one model call
AFTER_COMPACTION_WINDOW = 10             # tool calls looked at after each compaction
SAMPLE_N = 25

BUDGET = collections.OrderedDict([
    ('test_e2e', 'tests: browser (e2e)'), ('test_unit', 'tests: unit'), ('test_component', 'tests: component'), ('test_integration', 'tests: integration'),
    ('test_other', 'tests: vitest unspecified / npm test'), ('build', 'build / typecheck'), ('install', 'dependencies: install'), ('dep_lookup', 'dependencies: lookup'),
    ('server', 'servers and waiting (wrangler dev, curl, sleep)'), ('proc', 'process inspection / cleanup'), ('read', 'reading with bash'), ('tool_read', 'reading with the read tool'),
    ('write', 'writing with bash'), ('tool_edit', 'writing with the edit tool'), ('tool_write', 'writing with the write tool'), ('git', 'git'), ('script', 'throwaway scripts (node -e, python)'),
    ('other', 'other'), ('other_tool', 'other')])
BUDGET_ROWS = list(collections.OrderedDict.fromkeys(BUDGET.values()))


def groups(S):
    G = collections.OrderedDict((g, []) for g in GROUPS)
    for s in S.values(): G[s.group].append(s)
    return G


def aff(stories, hit_sks):
    """'stories affected a/N; runs affected b/M' for a set of story keys."""
    st = [s for s in stories if s.sk in hit_sks]
    return f'{len(st)}/{len(stories)}', f'{len(set(s.runkey for s in st))}/{len(set(s.runkey for s in stories))}'


def where(s): return f'{s.group}, {s.run}, story {s.story}'


def scrub(x, n=190):
    x = WS_RX.sub('<ws>', x or '').replace('\n', '⏎')
    if MACHINE_RX:
        x = MACHINE_RX.sub('<machine>', x)
    return x[:n]


def hit(name, s, text): HITS[name].append((s.sk, where(s), scrub(text, 400)))


def h(title): print('\n## ' + title + '\n')


def note(t): print(t + '\n')


# ---------------------------------------------------------------- timeline: where the seconds of a story go
def timeline(s):
    """Partition a timed story's span into model generation (per call), tool time (per tool), compaction and idle seconds."""
    gen = {}; tool_s = {}; comp = 0.0; idle = 0.0; gap = 0.0
    msgs = [m for m in s.msgs if m[1] is not None]
    cursor = msgs[0][1] if msgs else (s.calls[0].rx if s.calls else None)
    if cursor is None: return gen, tool_s, comp, idle, gap, 0.0
    t0 = cursor; mi = 1 if msgs else 0; ci = 0; comps = [c for c in s.comps if c[0] is not None and c[1] is not None]
    prev_no_tools = False
    for c in s.calls:
        while mi < len(msgs) and msgs[mi][1] <= c.rx:
            if msgs[mi][1] > cursor: idle += msgs[mi][1] - cursor; cursor = msgs[mi][1]
            mi += 1
        while ci < len(comps) and comps[ci][1] <= c.rx:
            a, b = comps[ci][0], comps[ci][1]
            if a > cursor: gap += a - cursor; cursor = a
            if b > cursor: comp += b - cursor; cursor = b
            ci += 1
        if s.client != 'pi' and prev_no_tools and c.rx > cursor: idle += c.rx - cursor; cursor = c.rx   # Claude Code: the harness's next prompt is not in the log
        gen[c.idx] = max(0.0, c.rx - cursor); cursor = max(cursor, c.rx); prev_no_tools = not c.tools
        done = [t for t in c.tools if t.end is not None and t.start is not None]
        if done:
            last = max(t.end for t in done); wall = max(0.0, last - cursor); tot = sum(max(0.0, t.end - t.start) for t in done)
            for t in done: tool_s[t.idx] = wall * (max(0.0, t.end - t.start) / tot) if tot > 0 else wall / len(done)
            cursor = max(cursor, last)
    return gen, tool_s, comp, idle, gap, cursor - t0


def call_class(c):
    if not c.tools: return 'reply with text, no tool call' if (c.text or 0) > 0 else 'reply with neither text nor tool call'
    return BUDGET[c.tools[0].kind]


# ---------------------------------------------------------------- 0. census
def sec0(S, G):
    h('0. Census: what is in the data')
    rows = []
    for g, st in G.items():
        tl = [t for s in st for t in s.tools]; cl = [c for s in st for c in s.calls]
        rows.append([g, len(st), len(set(s.runkey for s in st)), len(cl), len(tl), sum(1 for t in tl if t.name == 'bash'), sum(1 for t in tl if t.name == 'read'), sum(1 for t in tl if t.name == 'edit'), sum(1 for t in tl if t.name == 'write'),
                     sum(1 for t in tl if t.name not in ('bash', 'read', 'edit', 'write')), sum(1 for s in st if s.timed), sum(1 for s in st if s.invalid), sum(1 for s in st if 'not published' in (s.source or ''))])
    rows.append(['all'] + [sum(r[i] for r in rows) for i in range(1, 13)])
    md_table(['group', 'stories', 'runs', 'model calls', 'tool calls', 'bash', 'read', 'edit', 'write', 'other tools', 'stories with tool timings', 'stories in runs marked invalid', 'stories not published (still running or abandoned when fetched)'], rows)
    note('"Stories with tool timings": every tool call has a start time and every model call a receive time. All seconds below come from these stories only; all counts and characters come from every story.')
    # bash command kinds: a partition of every bash command
    rows = []; tot = collections.Counter(); kc = collections.Counter()
    for g, st in G.items():
        for s in st:
            for t in s.tools:
                if t.name == 'bash': kc[(g, t.kind)] += 1; tot[g] += 1
    kinds = [k for k in PRIORITY if k != 'none']
    for k in kinds: rows.append([BUDGET[k]] + [pct(kc[(g, k)], tot[g]) for g in G] + [sum(kc[(g, k)] for g in G)])
    rows.append(['total bash commands'] + [tot[g] for g in G] + [sum(tot.values())])
    md_table(['kind of bash command (highest-ranking part of a compound command)'] + list(G) + ['all, count'], rows)
    # distinct heads census
    heads = collections.Counter(); hk = {}
    for s in S.values():
        for t in s.tools:
            if t.name == 'bash':
                for sg in t.segs:
                    if sg[0] != 'none': heads[(sg[0], sg[1])] += 1
    note(f'Distinct (kind, command head) pairs at command position, over all segments of all bash commands: {len(heads)}. The 40 most frequent:')
    md_table(['kind', 'head', 'segments'], [[k, hd, n] for (k, hd), n in sorted(heads.items(), key=lambda x: (-x[1], x[0]))[:40]])
    oth = [(hd, n) for (k, hd), n in sorted(heads.items(), key=lambda x: (-x[1], x[0])) if k == 'other']
    note(f'Heads the classifier does not know ("other"): {len(oth)} distinct, {sum(n for _, n in oth)} segments. Most frequent: ' + ', '.join(f'`{hd}` {n}' for hd, n in oth[:25]))
    # tool names
    names = collections.Counter((s.client, t.name) for s in S.values() for t in s.tools)
    note('Tool names by client: ' + '; '.join(f'{c} `{n}` {v:,}' for (c, n), v in sorted(names.items(), key=lambda x: (x[0][0], -x[1]))))


# ---------------------------------------------------------------- 1. budget of time
def sec1(S, G):
    h('1. Where the time goes (stories with tool timings only)')
    tot = {}; toolk = collections.Counter(); genk = collections.Counter(); callk = collections.Counter(); outk = collections.Counter(); allcalls = collections.Counter()
    for g, st in G.items():
        a = dict(n=0, span=0.0, wall=0.0, tool=0.0, gen=0.0, comp=0.0, idle=0.0, gap=0.0, noend=0)
        for s in st:
            for c in s.calls: callk[(g, call_class(c))] += 1; allcalls[g] += 1; outk[(g, call_class(c))] += c.out_tok or 0
            if not s.timed: continue
            gen, tool_s, comp, idle, gap, span = timeline(s)
            a['n'] += 1; a['span'] += span; a['wall'] += s.wall or 0; a['comp'] += comp; a['idle'] += idle; a['gap'] += gap
            a['gen'] += sum(gen.values()); a['tool'] += sum(tool_s.values()); a['noend'] += sum(1 for t in s.tools if t.end is None)
            for t in s.tools:
                if t.idx in tool_s: toolk[(g, BUDGET[t.kind])] += tool_s[t.idx]
            for c in s.calls: genk[(g, call_class(c))] += gen.get(c.idx, 0.0)
        tot[g] = a
    rows = []
    for g, a in tot.items():
        sp = a['span']; other = sp - a['tool'] - a['gen'] - a['comp'] - a['idle']
        rows.append([g, f"{a['n']}/{len(G[g])}", sp / 3600, pct(a['gen'], sp), pct(a['tool'], sp), pct(a['comp'], sp), pct(a['idle'], sp), pct(other, sp), a['noend']])
    md_table(['group', 'timed stories', 'hours covered', 'model generating', 'tools running', 'compaction', 'waiting for the harness between turns', 'other gaps', 'tool calls that never returned'], rows)
    note('The five shares sum to 100% per group. "Model generating" is the time from the previous event (tool result, message, compaction end) to the arrival of the model\'s complete reply: it includes reading the prompt, thinking and writing.')
    rows = []
    for k in BUDGET_ROWS:
        rows.append([k] + [pct(toolk[(g, k)], tot[g]['tool']) for g in G] + [sum(toolk[(g, k)] for g in G) / 3600])
    rows.append(['total tool hours'] + [tot[g]['tool'] / 3600 for g in G] + [sum(a['tool'] for a in tot.values()) / 3600])
    md_table(['tool time by kind of work (% of the group\'s tool time)'] + list(G) + ['all, hours'], rows)
    classes = BUDGET_ROWS + ['reply with text, no tool call', 'reply with neither text nor tool call']
    rows = [[k] + [pct(genk[(g, k)], tot[g]['gen']) for g in G] + [sum(genk[(g, k)] for g in G) / 3600] for k in classes]
    rows.append(['total generating hours'] + [tot[g]['gen'] / 3600 for g in G] + [sum(a['gen'] for a in tot.values()) / 3600])
    md_table(['model generating time by what the call then did (first tool call of the reply; % of group)'] + list(G) + ['all, hours'], rows)
    rows = [[k] + [pct(callk[(g, k)], allcalls[g]) for g in G] + [sum(callk[(g, k)] for g in G)] for k in classes]
    rows.append(['total model calls'] + [allcalls[g] for g in G] + [sum(allcalls.values())])
    md_table(['model calls by what they did (all stories; % of group)'] + list(G) + ['all, calls'], rows)
    rows = [[k] + [pct(outk[(g, k)], sum(outk[(g, kk)] for kk in classes)) for g in QWEN] + [sum(outk[(g, k)] for g in QWEN)] for k in classes]
    rows.append(['total output tokens'] + [sum(outk[(g, kk)] for kk in classes) for g in QWEN] + [sum(outk[(g, kk)] for g in QWEN for kk in classes)])
    md_table(['output tokens by what the call did (Qwen groups; Claude\'s recorded output tokens are partial counts and are left out)'] + QWEN + ['all Qwen, tokens'], rows)


# ---------------------------------------------------------------- 2. redundant navigation
def sec2(S, G):
    h('2. Redundant navigation: `cd` into the directory the shell is already in, and absolute paths')
    rows = []; shares = collections.defaultdict(list)
    for g, st in G.items():
        n = cdabs = cdpwd = cdgit = chars = allchars = 0; hs = set(); other_abs = other_abs_chars = 0; fabs = fabs_chars = ftools = 0
        for s in st:
            sn = sc = 0
            for t in s.tools:
                if t.name == 'bash':
                    n += 1; sn += 1; allchars += t.arg_full or 0
                    if t.cdform == 'absolute workspace path': cdabs += 1
                    elif t.cdform and t.cdform.startswith('cd to where'): cdpwd += 1
                    elif t.cdform == 'git top level': cdgit += 1
                    if t.cdform and t.cdform != 'elsewhere':
                        chars += t.cdlen; hs.add(s.sk); sc += 1; hit('redundant_cd', s, t.arg)
                    rest = t.arg[t.cdlen:]
                    for m in WS_RX.finditer(rest): other_abs += 1; other_abs_chars += len(m.group(0))
                elif t.name in ('read', 'edit', 'write'):
                    ftools += 1
                    m = WS_RX.match(t.arg)
                    if m: fabs += 1; fabs_chars += len(m.group(0)) + 1
            if sn: shares[g].append(sc / sn)
        a = aff(st, hs)
        rows.append([g, n, cdabs, cdpwd, cdgit, pct(cdabs + cdpwd + cdgit, n), chars, pct(chars, allchars), a[0], a[1], other_abs, other_abs_chars, f'{fabs}/{ftools}', fabs_chars])
    md_table(['group', 'bash commands', 'begin `cd <absolute workspace path>`', 'begin `cd "$(pwd)"` / `$PWD` / `.`', 'begin `cd "$(git rev-parse --show-toplevel)"`', 'share of commands', 'characters spent on the prefix',
              'share of all bash command characters', 'stories affected', 'runs affected', 'further absolute workspace paths inside commands', 'their characters', 'read/edit/write calls with an absolute workspace path', 'their prefix characters'], rows)
    rows = []
    for g in G:
        v = sorted(shares[g])
        rows.append([g, len(v), pct(sum(1 for x in v if x >= 0.9), len(v)), pct(sum(1 for x in v if 0.1 < x < 0.9), len(v)), pct(sum(1 for x in v if x <= 0.1), len(v))])
    md_table(['group', 'stories with bash commands', 'stories where 90%+ of commands carry the prefix', 'in between', 'stories where 10% or fewer do'], rows)


# ---------------------------------------------------------------- replaying what each story did to files (complete arguments)
CONSOLE = re.compile(r'console\.(?:log|error|warn|debug|info)\(')
EDIT_NOT_FOUND = re.compile(r'Could not find|String to replace not found|must be unique|matches multiple|Found \d+ (?:matches|occurrences)')
TEST_PATH = re.compile(r'(^|/)(tests?|e2e|__tests__)/|\.(spec|test)\.')
GIT_REWRITES = re.compile(r'git (stash|checkout|restore|reset|apply|revert|merge|pull|clean|worktree)')
FAIL_CLASSES = ['an earlier tool call in the same reply had already changed the file', 'old text differs from the file only in whitespace', 'old text starts like the file, then diverges', 'old text is nowhere in the file',
                'old text is in the file (ambiguous match or other)', 'the file had not been read, edited or written in the story', 'file content not known here (changed through bash, or read in part)']


def ws_norm(x): return re.sub(r'\s+', ' ', x).strip()


def edits_of(t):
    a = t.args(); eds = a.get('edits')
    if isinstance(eds, list): return [(str(e.get('oldText') or e.get('old_string') or ''), str(e.get('newText') or e.get('new_string') or '')) for e in eds if isinstance(e, dict)]
    return [(str(a.get('oldText') or a.get('old_string') or ''), str(a.get('newText') or a.get('new_string') or ''))]


def whole_read_text(s, t):
    """The file content a read-tool call returned, or None when it returned only part of the file."""
    a = t.args()
    try: off = int(a.get('offset') or 0)
    except (TypeError, ValueError): off = 0
    if off > 1: return None
    r = t.res
    if s.client == 'pi': return None if re.search(r'\[Showing lines \d+-\d+ of \d+|\[\d+ more lines in file', r[-300:]) or '[Read image file' in r[:60] else r
    if a.get('limit'): return None
    if '<persisted-output>' in r[:200] or 'exceeds maximum allowed' in r[:300]: return None
    r = re.sub(r'<system-reminder>.*?</system-reminder>', '', r, flags=re.S)
    return re.sub(r'(?m)^ *\d+\t', '', r)


def unchanged_chars(new, old):
    """Characters of `new` that sit on lines already present in `old` (line multiset overlap)."""
    have = collections.Counter(old.split('\n')); n = 0
    for line in new.split('\n'):
        if have[line] > 0: have[line] -= 1; n += len(line) + 1
    return min(n, len(new))


def file_replay(s):
    """Walk a story's tool calls keeping the last known content of each file. Returns per-tool records:
    writes: idx -> (class, chars, unchanged chars or None, identical);  fails: idx -> cause;  console: list of (path, added, removed)."""
    if getattr(s, '_replay', None) is not None: return s._replay
    vfs = {}; touched = set(); writes = {}; fails = {}; console = []; changed_in_call = {}
    for t in s.tools:
        if t.name == 'read':
            if not t.error:
                txt = whole_read_text(s, t) if FULL_TEXT else None
                if txt is not None: vfs[t.path] = txt
                elif t.path not in vfs: vfs[t.path] = None
                touched.add(t.path)
        elif t.name == 'write':
            if t.error: continue
            content = t.args().get('content'); content = content if isinstance(content, str) else None
            prev = vfs.get(t.path)
            if t.path not in touched: writes[t.idx] = ('new', t.new_chars or 0, None, False)
            elif isinstance(prev, str) and content is not None: writes[t.idx] = ('rewrite', len(content), unchanged_chars(content, prev), content == prev)
            else: writes[t.idx] = ('rewrite', t.new_chars or 0, None, False)
            if content is not None:
                before = len(CONSOLE.findall(prev)) if isinstance(prev, str) else (0 if t.path not in touched else None)
                if before is not None:
                    d = len(CONSOLE.findall(content)) - before
                    if d: console.append((t.path, max(d, 0), max(-d, 0)))
            vfs[t.path] = content; touched.add(t.path); changed_in_call[t.path] = t.call
        elif t.name == 'edit':
            eds = edits_of(t) if FULL_TEXT else []
            cur = vfs.get(t.path)
            if not t.error:
                add = sum(len(CONSOLE.findall(n)) for o, n in eds); rem = sum(len(CONSOLE.findall(o)) for o, n in eds)
                if add != rem: console.append((t.path, max(add - rem, 0), max(rem - add, 0)))
                if isinstance(cur, str):
                    for o, n in eds:
                        if o and o in cur: cur = cur.replace(o, n, 1)
                        else: cur = None; break
                    vfs[t.path] = cur
                touched.add(t.path); changed_in_call[t.path] = t.call
            elif EDIT_NOT_FOUND.search(t.res):
                m = re.search(r'edits\[(\d+)\]', t.res); bad = [eds[int(m.group(1))][0]] if m and int(m.group(1)) < len(eds) else [o for o, n in eds]
                if changed_in_call.get(t.path) == t.call: fails[t.idx] = FAIL_CLASSES[0]
                elif t.path not in touched: fails[t.idx] = FAIL_CLASSES[5]
                elif not isinstance(cur, str) or not bad: fails[t.idx] = FAIL_CLASSES[6]
                else:
                    o = next((x for x in bad if x not in cur), None)
                    if o is None: fails[t.idx] = FAIL_CLASSES[4]
                    elif ws_norm(o) in ws_norm(cur): fails[t.idx] = FAIL_CLASSES[1]
                    else:
                        first = next((ln.strip() for ln in o.split('\n') if len(ln.strip()) >= 8), '')
                        fails[t.idx] = FAIL_CLASSES[2] if first and first in cur else FAIL_CLASSES[3]
                touched.add(t.path)
        elif t.name == 'bash':
            for p in bash_read_files(t): touched.add(p)
            risky = [hd for k, hd, _, _ in t.segs if k in ('write', 'script') or (k == 'git' and GIT_REWRITES.search(hd))]
            if risky:
                if any(GIT_REWRITES.search(hd) for hd in risky) or re.search(r'\brm\s+-[a-z]*r', t.arg): vfs = {p: None for p in vfs}
                else:
                    for p in list(vfs):
                        if p.rsplit('/', 1)[-1] in t.arg: vfs[p] = None
    s._replay = (writes, fails, console)
    return s._replay


# ---------------------------------------------------------------- 3. reading
FILE_TOK = re.compile(r'^[\w./@*~+\[\]-]*[A-Za-z][\w./@*~+\[\]-]*$')


def bash_read_files(t):
    """Files named by unpiped cat / sed -n / head / tail segments of a bash command."""
    out = []
    for k, hd, piped, seg in t.segs:
        if piped or k != 'read' or hd not in ('cat', 'sed', 'head', 'tail'): continue
        toks = seg.split()
        try: i = next(j for j, x in enumerate(toks) if x.rsplit('/', 1)[-1] == hd)
        except StopIteration: continue
        for x in toks[i + 1:]:
            if x.startswith('-') or x in ('<<HEREDOC',) or '=' in x: continue
            if x.startswith('>'): break
            if FILE_TOK.match(x) and ('.' in x or '/' in x) and not re.match(r'^[\d,]+p?$', x): out.append(norm_path(x))
    return out


def sec3(S, G):
    h('3. Reading: the same file again, reading through bash, the spec, and after a compaction')
    rows = []; worst = []; rows_b = []; rows_spec = []
    for g, st in G.items():
        reads = distinct = rereads = rechars = ident = identchars = allchars = partial = 0; hs = set(); hsi = set()
        bread = bread_chars = 0; bkind = collections.Counter(); specr = spec_re = spec_rechars = 0; hss = set(); b_reread = 0
        for s in st:
            seen = {}; texts = collections.defaultdict(set); allseen = collections.Counter(); specseen = collections.Counter()
            for i, t in enumerate(s.tools):
                if t.name == 'read' and not t.error:
                    reads += 1; allchars += t.res_chars; p = t.path
                    a = t.args()
                    if whole_read_text(s, t) is None: partial += 1
                    if p in seen:
                        rereads += 1; rechars += t.res_chars; hs.add(s.sk)
                        if t.res in texts[p]: ident += 1; identchars += t.res_chars; hsi.add(s.sk); hit('identical_reread', s, f'{p} ({t.res_chars:,} chars), tool call {i}: {t.res[:120]}')
                    else: distinct += 1
                    seen[p] = seen.get(p, 0) + 1; texts[p].add(t.res); allseen[p] += 1
                    if p.startswith('spec/'):
                        specr += 1; specseen[p] += 1
                        if specseen[p] > 1: spec_re += 1; spec_rechars += t.res_chars; hss.add(s.sk); hit('spec_reread', s, f'read tool {p} ({t.res_chars:,} chars)')
                elif t.name == 'bash':
                    fl = bash_read_files(t)
                    if fl and t.kind == 'read':
                        bread += 1; bread_chars += t.res_chars
                        for k, hd, piped, seg in t.segs:
                            if not piped and hd in ('cat', 'sed', 'head', 'tail'): bkind[hd] += 1
                        hit('bash_file_read', s, t.arg)
                    for p in fl:
                        if allseen[p]: b_reread += 1
                        allseen[p] += 1
                        if p.startswith('spec/'):
                            specr += 1; specseen[p] += 1
                            if specseen[p] > 1:
                                spec_re += 1; hss.add(s.sk); hit('spec_reread', s, t.arg)
                                if len(fl) == 1: spec_rechars += t.res_chars
            for p, n in seen.items():
                if n >= 6: worst.append((n, where(s), p))
        a = aff(st, hs); ai = aff(st, hsi)
        rows.append([g, reads, pct(partial, reads), distinct, rereads, pct(rereads, reads), rechars, pct(rechars, allchars), a[0], a[1], ident, identchars, pct(identchars, allchars), ai[0], ai[1]])
        rows_b.append([g, reads, allchars, bread, bread_chars, pct(bread, bread + reads), bkind['cat'], bkind['sed'], bkind['head'], bkind['tail'], b_reread])
        asx = aff(st, hss)
        rows_spec.append([g, specr, spec_re, spec_rechars, asx[0], asx[1]])
    md_table(['group', 'read-tool calls', 'that returned only part of the file (offset, limit or size cap)', 'distinct files (per story)', 'repeat reads of a file already read in the story', 'share', 'characters returned by repeat reads', 'share of all read-tool characters',
              'stories affected', 'runs affected', 'of which the result is character-for-character one already returned for that file in the story', 'their characters', 'share of all read-tool characters', 'stories affected (identical)', 'runs affected (identical)'], rows)
    note('Worst cases (one file read 6 or more times by the read tool in one story), top 12: ' + '; '.join(f'{n}x `{p}` ({w})' for n, w, p in sorted(worst, key=lambda x: (-x[0], x[1], x[2]))[:12]) + f'. Files read 6+ times in a story: {len(worst)}.')
    md_table(['group', 'read-tool calls', 'characters', 'bash commands that only read files (cat, sed -n, head, tail)', 'characters', 'bash share of file-reading calls', 'cat segments', 'sed segments', 'head segments', 'tail segments',
              'files read by bash that were already read in the story'], rows_b)
    md_table(['group', 'reads of files under spec/ (read tool + bash cat/sed/head/tail)', 'repeat reads of a spec file in the same story', 'characters (read tool, and bash commands naming one file)', 'stories affected', 'runs affected'], rows_spec)
    rows = []
    for g, st in G.items():
        ncomp = win = win_read = re_n = re_chars = 0; base_read = base_all = 0; hs = set()
        for s in st:
            for t in s.tools:
                base_all += 1; base_read += t.kind in ('tool_read', 'read')
            for comp in s.comps:
                cen = comp[1]
                if cen is None: continue
                before = set(t.path for t in s.tools if t.name == 'read' and t.start is not None and t.start < cen)
                after = [t for t in s.tools if t.start is not None and t.start >= cen][:AFTER_COMPACTION_WINDOW]
                ncomp += 1
                for t in after:
                    win += 1
                    if t.kind in ('tool_read', 'read'): win_read += 1
                    if t.name == 'read' and t.path in before: re_n += 1; re_chars += t.res_chars; hs.add(s.sk); hit('reread_after_compaction', s, f'{t.path} ({t.res_chars:,} chars)')
        a = aff(st, hs)
        rows.append([g, ncomp, win, pct(win_read, win), pct(base_read, base_all), re_n, (re_n / ncomp) if ncomp else 0.0, re_chars, (re_chars / ncomp) if ncomp else 0.0, a[0], a[1]])
    md_table(['group', 'compactions (with times)', f'tool calls in the {AFTER_COMPACTION_WINDOW} after each', 'of which reading', 'reading share of all tool calls (baseline)', 'read-tool calls on a file already read before the compaction',
              'per compaction', 'characters re-read', 'characters per compaction', 'stories affected', 'runs affected'], rows)


# ---------------------------------------------------------------- 4. writing
def bash_edit_types(t):
    out = []
    for k, hd, piped, seg in t.segs:
        if k != 'write': continue
        if hd.startswith('python'): out.append('python3 script')
        elif hd.startswith('node') or hd.startswith('perl (') or hd.startswith('bash') or hd.startswith('sh ') or hd.startswith('ruby') or hd.startswith('tsx'): out.append('node / other script')
        elif hd == 'sed -i': out.append('sed -i')
        elif hd == 'perl -i': out.append('perl -i')
        elif hd in ('cat >', 'tee'): out.append('cat > file (heredoc)')
        elif hd in ('echo >', 'printf >'): out.append('echo / printf > file')
        else: out.append('file operation (rm, cp, mv, mkdir...)')
    return out


EDIT_TYPES = ['python3 script', 'node / other script', 'sed -i', 'perl -i', 'cat > file (heredoc)', 'echo / printf > file']


def sec4(S, G):
    h('4. Writing: whole-file rewrites against edits, and edits made through bash')
    rows = []; rows2 = []; rows3 = []; worst = []
    for g, st in G.items():
        w = wnew = wre = wre_chars = wnew_chars = e = e_chars = 0; hs = set(); multi_files = multi_writes = multi_chars = 0; known = known_chars = unch = identical = identical_chars = 0; small = 0
        bt = collections.Counter(); bchars = collections.Counter(); hb = set(); bcmds = 0
        for s in st:
            writes, _, _ = file_replay(s); wc = collections.Counter(); wch = collections.Counter()
            for t in s.tools:
                if t.name == 'edit' and not t.error: e += 1; e_chars += t.new_chars or 0
                elif t.name == 'write' and t.idx in writes:
                    cls, chars, un, same = writes[t.idx]; w += 1; wc[t.path] += 1; wch[t.path] += chars
                    if cls == 'new': wnew += 1; wnew_chars += chars
                    else:
                        wre += 1; wre_chars += chars; hs.add(s.sk)
                        if un is not None:
                            known += 1; known_chars += chars; unch += un
                            if same: identical += 1; identical_chars += chars
                            if chars and un / chars >= 0.9: small += 1
                            hit('rewrite_existing', s, f'{t.path}: wrote {chars:,} chars, {un:,} on lines already in the file ({pct(un, chars)})')
                elif t.name == 'bash':
                    ty = [x for x in bash_edit_types(t) if x in EDIT_TYPES]
                    if ty:
                        bcmds += 1; hb.add(s.sk)
                        for x in set(ty): bt[x] += 1; bchars[x] += (t.arg_full or 0) // len(set(ty))
                        hit('bash_edit', s, t.arg)
            for p, n in wc.items():
                if n >= 3: multi_files += 1; multi_writes += n; multi_chars += wch[p]; worst.append((n, wch[p], where(s), p))
        a = aff(st, hs); ab = aff(st, hb)
        rows.append([g, e, e_chars, w, wnew, wnew_chars, wre, wre_chars, pct(wre, w), pct(wre_chars, wre_chars + wnew_chars + e_chars), a[0], a[1], multi_files, multi_writes, multi_chars])
        rows3.append([g, wre, known, known_chars, unch, pct(unch, known_chars), small, pct(small, known), identical, identical_chars])
        rows2.append([g, bcmds] + [bt[x] for x in EDIT_TYPES] + [sum(bchars.values()), ab[0], ab[1]])
    md_table(['group', 'successful edits', 'characters of new text in edits', 'successful whole-file writes', 'of a file not seen before in the story', 'characters', 'of a file already read, edited or written in the story (rewrite)', 'characters emitted',
              'rewrites as share of writes', 'rewrite characters as share of all characters written by edit+write', 'stories affected', 'runs affected', 'files written 3+ times in a story', 'those writes', 'their characters'], rows)
    md_table(['group', 'rewrites', 'rewrites where the file\'s previous content is known (from an earlier write, edit or whole read)', 'characters emitted in those', 'of which on lines already in the file, unchanged', 'unchanged share',
              'rewrites that were 90%+ unchanged', 'share of known rewrites', 'rewrites identical to what was already there', 'their characters'], rows3)
    note('Worst cases (same file written whole, top 10 by count): ' + '; '.join(f'{n}x `{p}` {c:,} chars ({w})' for n, c, w, p in sorted(worst, key=lambda x: (-x[0], -x[1], x[2], x[3]))[:10]))
    md_table(['group', 'bash commands that create or change file content'] + EDIT_TYPES + ['characters of those commands', 'stories affected', 'runs affected'], rows2)
    note('A command with two kinds of write is counted under each kind; its characters are split between them. rm, cp, mv and mkdir are not counted here.')


# ---------------------------------------------------------------- 5. failed edits
def sec5(S, G):
    h('5. Failed edits: the old text was not found')
    rows = []; rows2 = []; rows3 = []
    NXT = ['edit of the same file, succeeds', 'edit of the same file, fails again', 'read tool on the same file', 'bash that names the file (cat, grep, sed, python...)', 'write tool: whole file rewritten', 'the file is not touched again in the story']
    for g, st in G.items():
        e = mm = oth = 0; hs = set(); mm_chars = 0; single = single_f = multi = multi_f = 0; nxt = collections.Counter(); only_calls = only_tok = 0; chains = collections.Counter(); abs_e = abs_f = rel_e = rel_f = 0; cause = collections.Counter()
        othk = collections.Counter(); follow_calls = 0; follow_chars = 0
        for s in st:
            run_len = collections.Counter(); _, fails, _ = file_replay(s)
            for i, t in enumerate(s.tools):
                if t.name != 'edit': continue
                e += 1; failed = bool(t.error) and bool(EDIT_NOT_FOUND.search(t.res))
                if t.error and not failed:
                    oth += 1; othk['edits overlap' if 'overlap' in t.res else 'replacement identical to the old text' if 'No changes made' in t.res else 'no permission (spec is read-only)' if re.search(r'EACCES|EPERM', t.res) else 'no such file' if 'ENOENT' in t.res else 'other'] += 1
                if (t.n_edits or 1) > 1: multi += 1; multi_f += failed
                else: single += 1; single_f += failed
                if t.arg.startswith('~') or t.arg.startswith('/'): abs_e += 1; abs_f += failed
                else: rel_e += 1; rel_f += failed
                if not failed:
                    if not t.error and run_len[t.path]: chains[min(run_len[t.path], 5)] += 1; run_len[t.path] = 0
                    continue
                mm += 1; mm_chars += t.arg_chars or 0; hs.add(s.sk); run_len[t.path] += 1; cause[fails.get(t.idx, FAIL_CLASSES[6])] += 1
                hit('edit_mismatch', s, f'[{fails.get(t.idx)}] {t.res[:160]} || old: {edits_of(t)[0][0][:160] if FULL_TEXT else ""}')
                base = t.path.rsplit('/', 1)[-1]; cls = NXT[5]
                for u in s.tools[i + 1:]:
                    if u.name == 'edit' and u.path == t.path: cls = NXT[1] if u.error else NXT[0]; break
                    if u.name == 'read' and u.path == t.path: cls = NXT[2]; follow_calls += 1; follow_chars += u.res_chars; break
                    if u.name == 'write' and u.path == t.path: cls = NXT[4]; follow_calls += 1; break
                    if u.name == 'bash' and base in u.arg: cls = NXT[3]; follow_calls += 1; follow_chars += u.res_chars; break
                nxt[cls] += 1
            for p, n in run_len.items():
                if n: chains['never succeeded'] += 1
            for c in s.calls:
                if c.tools and all(t.name == 'edit' and t.error and EDIT_NOT_FOUND.search(t.res) for t in c.tools): only_calls += 1; only_tok += c.out_tok or 0
        a = aff(st, hs)
        rows.append([g, e, mm, pct(mm, e), a[0], a[1], mm_chars, only_calls, only_tok, follow_calls, follow_chars, pct(single_f, single), pct(multi_f, multi), pct(rel_f, rel_e), pct(abs_f, abs_e), oth,
                     ', '.join(f'{k} {v}' for k, v in sorted(othk.items(), key=lambda x: (-x[1], x[0]))) or '-'])
        rows2.append([g, mm] + [pct(nxt[x], mm) for x in NXT] + [chains[1], chains[2], chains[3], chains[4], chains[5], chains['never succeeded']])
        rows3.append([g, mm] + [pct(cause[x], mm) for x in FAIL_CLASSES])
    md_table(['group', 'edit calls', 'failed: old text not found', 'rate', 'stories affected', 'runs affected', 'characters of arguments in the failed calls', 'model calls whose only tool calls were failed edits', 'their output tokens',
              'failures followed by a look at the file (read, bash) or a whole rewrite before the next edit', 'characters those looks returned', 'failure rate, one replacement per call', 'failure rate, several replacements per call',
              'failure rate, relative path', 'failure rate, absolute path', 'failed for another reason', 'those reasons'], rows)
    md_table(['group', 'failed edits'] + ['why: ' + FAIL_CLASSES[0]] + FAIL_CLASSES[1:], rows3)
    md_table(['group', 'failed edits', 'next touch of the file: ' + NXT[0]] + NXT[1:] + ['chains: 1 failure then success', '2 failures', '3', '4', '5+', 'failures on a file with no later successful edit'], rows2)


# ---------------------------------------------------------------- 6. the test loop
TESTS_FAILED = re.compile(r'\b[1-9]\d* failed\b|✘|FAIL ')
TEST_TIMEOUT = re.compile(r'Test timeout of \d+ms exceeded|Timeout \d+ms exceeded|Timed out \d+ms waiting|Test timed out in \d+ms|Timeout of \d+ms exceeded|Command timed out after \d+ seconds|Hook timed out in \d+ms')
ADDR_IN_USE = re.compile(r'(?:failed: |bind\(\)[^\n]{0,40}|addrlen\): )[Aa]ddress already in use|listen EADDRINUSE')
NPM_ERROR = re.compile(r'npm ERR!|npm error')
FILTER_HEADS = {'tail', 'head', 'grep', 'egrep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'tr', 'tee'}
TARGET = re.compile(r'\.(?:spec|test)\.|(?:^|\s)(?:tests?|e2e|src|apps)/[\w./*-]+|\s-g\s|--grep|\s-t\s|--testNamePattern|:\d+(?:\s|$)|\s--\s+\S')


def test_parts(t):
    """(kinds of test in the command, key of the whole command, key without output filters, filter type, targeted?)"""
    kinds = []; base = []; full = []; filt = []; targeted = True; last_test = False
    for k, hd, piped, seg in t.segs:
        full.append(('|' if piped else ';') + ' '.join(seg.split()))
        if piped:
            if last_test and hd in FILTER_HEADS: filt.append(hd)
            continue
        base.append(' '.join(seg.split())); last_test = k in TEST_KINDS
        if last_test:
            kinds.append(k)
            rest = re.sub(r'--project[= ]\S+|--config[= ]\S+|-c \S+|--reporter[= ]\S+', ' ', seg)
            rest = re.sub(r'^.*?(?:playwright test|vitest(?: run)?|npm (?:run )?\S+|bun (?:run )?\S+)', ' ', rest, count=1)
            if not TARGET.search(' ' + rest + ' ') and not re.search(r'[A-Za-z]', re.sub(r'(^|\s)--?[\w-]+(=\S+)?', ' ', rest).replace('"Q"', 'x').replace("'Q'", 'x')): targeted = False
    f = 'none' if not filt else ('grep' if 'grep' in filt or 'egrep' in filt else ('tail' if 'tail' in filt else ('head' if 'head' in filt else 'other filter')))
    return kinds, ''.join(full), ' ; '.join(base), f, targeted


def changes_files(t):
    if t.name in ('edit', 'write'): return not t.error
    if t.name != 'bash': return False
    return any(k in ('write', 'install') or (k == 'git' and re.search(r'git (stash|checkout|restore|reset|apply|revert|merge|pull|clean|worktree)', hd)) for k, hd, _, _ in t.segs)


def sec6(S, G):
    h('6. The test loop')
    rows = []; rows2 = []; rows3 = []; rows4 = []
    KN = ['test_e2e', 'test_unit', 'test_component', 'test_integration', 'test_other']
    for g, st in G.items():
        per_story = []; kn = collections.Counter(); ksec = collections.Counter(); kdur = collections.defaultdict(list)
        ident = ident_s = ident_fail = ident_pass = 0; refilt = refilt_s = 0; hs = set(); hr = set(); nt = 0; fl = collections.Counter(); tgt = collections.Counter(); tgt_s = collections.Counter()
        tout = 0; failed_runs = 0; chars = 0; pilog = 0; timed_n = 0; ident_chars = 0
        for s in st:
            dirty = 0; seen_full = {}; seen_base = {}; n_here = 0
            _, tool_s, _, _, _, _ = timeline(s) if s.timed else ({}, {}, 0, 0, 0, 0)
            for t in s.tools:
                if t.name == 'bash' and re.search(r'pi-bash-[0-9a-f]+\.log', t.arg): pilog += 1
                if t.name == 'bash' and t.kind in TEST_KINDS:
                    kinds, kfull, kbase, f, targeted = test_parts(t)
                    if any(k in ('write', 'install') or (k == 'git' and re.search(r'stash|checkout|restore|reset|apply|revert|merge|pull|clean|worktree', hd)) for k, hd, _, _ in t.segs): dirty += 1
                    nt += 1; n_here += 1; kn[t.kind] += 1; fl[f] += 1; chars += t.res_chars
                    sec = tool_s.get(t.idx)
                    if sec is not None: ksec[t.kind] += sec; kdur[t.kind].append(sec); timed_n += 1; tgt_s[targeted] += sec
                    tgt[targeted] += 1
                    bad = bool(t.error) or bool(TESTS_FAILED.search(t.res))
                    failed_runs += bad
                    mto = TEST_TIMEOUT.search(t.res)
                    if mto: tout += 1; hit('test_timed_out', s, t.res[max(0, mto.start() - 120):mto.end() + 80])
                    prev = seen_full.get(kfull)
                    if prev is not None and prev[0] == dirty:
                        ident += 1; ident_s += sec or 0; hs.add(s.sk); ident_chars += t.res_chars
                        if prev[1]: ident_fail += 1
                        else: ident_pass += 1
                        hit('identical_test_rerun', s, t.arg)
                    else:
                        pb = seen_base.get(kbase)
                        if pb is not None and pb[0] == dirty and pb[1] != kfull:
                            refilt += 1; refilt_s += sec or 0; hr.add(s.sk); hit('rerun_other_filter', s, f'{scrub(pb[2], 180)}  ==>  {scrub(t.arg, 180)}')
                    seen_full[kfull] = (dirty, bad); seen_base[kbase] = (dirty, kfull, t.arg)
                elif changes_files(t): dirty += 1
            per_story.append(n_here)
        ps = sorted(per_story); a = aff(st, hs); ar = aff(st, hr)
        rows.append([g, nt, quantile(ps, 0.5), quantile(ps, 0.9), ps[-1] if ps else 0] + [kn[k] for k in KN] + [pct(failed_runs, nt), tout, chars])
        rows2.append([g, nt, ident, pct(ident, nt), ident_fail, ident_pass, ident_s, ident_chars, a[0], a[1], refilt, pct(refilt, nt), refilt_s, ar[0], ar[1]])
        rows3.append([g, nt] + [pct(fl[x], nt) for x in ('tail', 'head', 'grep', 'other filter', 'none')] + [pilog, tgt[True], tgt[False], pct(tgt[False], nt), tgt_s[True] / 3600, tgt_s[False] / 3600])
        rows4.append([g] + [f'{quantile(sorted(kdur[k]), 0.5):.0f} / {quantile(sorted(kdur[k]), 0.9):.0f} / {ksec[k] / 3600:.1f} h' if kdur[k] else 'n/a' for k in KN])
    md_table(['group', 'bash commands that run tests', 'per story: median', 'p90', 'max'] + [BUDGET[k] for k in KN] + ['share that reported a failure', 'results that mention a timeout', 'characters of test output returned'], rows)
    md_table(['group'] + [BUDGET[k] + ': median s / p90 s / total hours (timed stories)' for k in KN], rows4)
    md_table(['group', 'test commands', 'identical command run again with no file changed in between', 'share', 'previous run had failed', 'previous run had passed', 'seconds (timed stories)', 'characters returned', 'stories affected', 'runs affected',
              'same test command, different output filter, no file changed in between', 'share', 'seconds (timed stories)', 'stories affected', 'runs affected'], rows2)
    md_table(['group', 'test commands', 'output cut by: tail', 'head', 'grep (with or without head/tail)', 'another filter', 'not cut', 'later commands that open pi\'s saved full-output log', 'targeted (a file, a name pattern)', 'whole suite of its kind',
              'whole-suite share', 'targeted hours (timed)', 'whole-suite hours (timed)'], rows3)


# ---------------------------------------------------------------- 7. waiting and stuck time
SLEEP = re.compile(r'(?:^|[;&|(\n]|\bdo\b|\bthen\b)\s*sleep\s+(\d+(?:\.\d+)?)([smh]?)')
TIMEOUT_W = re.compile(r'(?:^|[;&|(\n]|\bdo\b|\bthen\b|=\$\()\s*(?:[A-Z_]+=\S+\s+)*timeout\s+(?:-\S+\s+)*(\d+)')
KILLERS = re.compile(r'\b(?:pkill|killall|fuser\s+-k|kill\s+-?\d*\s*\$\(|xargs\s+(?:-r\s+)?kill|kill\s+-9|kill\s+\$|kill\s+"\$)')
PI_TIMEOUT = re.compile(r'Command timed out after (\d+) seconds')


def sec7(S, G):
    h('7. Waiting and stuck time')
    rows = []; rows2 = []; slow = []
    for g, st in G.items():
        sl_cmds = 0; sl_decl = 0.0; sl_only = 0; sl_only_s = 0.0; hs = set(); tw = 0; twv = collections.Counter(); tw_hit = 0; ht = set(); pit = 0; pit_s = 0; slow_n = 0; slow_s = 0.0; never = 0; aiu = 0; ha = set()
        kill_before = 0; kill_cmds = 0; tests = 0; hk = set(); bg = 0; server_s = 0.0; nbash = 0; big_sleep = 0
        for s in st:
            _, tool_s, _, _, _, _ = timeline(s) if s.timed else ({}, {}, 0, 0, 0, 0)
            prev = None
            for t in s.tools:
                mai = ADDR_IN_USE.search(t.res) if (t.name == 'bash' and t.kind != 'read') else None
                if mai: aiu += 1; ha.add(s.sk); hit('addr_in_use', s, t.res[max(0, mai.start() - 150):mai.end() + 100])
                if t.name != 'bash': prev = t; continue
                nbash += 1
                cmd = strip_heredocs(t.arg)[0]; cmdq = blank_quotes(cmd)
                sm = SLEEP.findall(cmdq)
                if sm:
                    sl_cmds += 1; hs.add(s.sk); d = sum(float(n) * {'': 1, 's': 1, 'm': 60, 'h': 3600}[u] for n, u in sm); sl_decl += d; hit('sleep', s, t.arg)
                    if d >= 30: big_sleep += 1
                mt = TIMEOUT_W.findall(cmdq)
                if mt:
                    tw += 1; ht.add(s.sk); v = max(int(x) for x in mt); twv['<=30' if v <= 30 else '31-120' if v <= 120 else '121-300' if v <= 300 else '301-600' if v <= 600 else '>600'] += 1; hit('timeout_wrapper', s, t.arg)
                    if t.start is not None and t.end is not None and len(mt) == 1 and t.end - t.start >= v - 0.5: tw_hit += 1
                pm = PI_TIMEOUT.search(t.res[-200:])
                if pm: pit += 1; pit_s += int(pm.group(1)); hit('tool_timeout', s, t.arg)
                if t.start is not None and t.end is not None and t.end - t.start >= SLOW_S: slow_n += 1; slow_s += t.end - t.start; slow.append((t.end - t.start, where(s), t.kind, scrub(t.arg[t.cdlen:], 150)))
                if s.timed and t.end is None: never += 1; slow.append((float('inf'), where(s), t.kind, scrub(t.arg[t.cdlen:], 150)))
                if re.search(r'(?<![&>])&(?![&>])\s*(?:$|\n|\)|;|\w)', cmdq) or re.search(r'\bnohup\b|\bsetsid\b', cmdq): bg += 1
                if t.kind in ('server', 'proc') and t.idx in tool_s: server_s += tool_s[t.idx]
                k = KILLERS.search(cmdq)
                if k: kill_cmds += 1
                if t.kind in TEST_KINDS:
                    tests += 1
                    first_test = min((m.start() for m in re.finditer(r'playwright test|vitest|npm (?:run )?test', cmdq)), default=len(cmdq))
                    if (k and k.start() < first_test) or (prev is not None and prev.name == 'bash' and prev.kind == 'proc' and KILLERS.search(prev.arg)):
                        kill_before += 1; hk.add(s.sk)
                        hit('kill_before_test', s, (f'KILL IN SAME COMMAND: {cmdq[max(0, k.start() - 30):k.end() + 60]}' if (k and k.start() < first_test) else f'PREVIOUS COMMAND: {prev.arg[prev.cdlen:][:150]}') + f'  ==> TEST: {cmdq[first_test:first_test + 100]}')
                prev = t
        a = aff(st, hs); at = aff(st, ht); aa = aff(st, ha); ak = aff(st, hk)
        rows.append([g, sl_cmds, pct(sl_cmds, nbash), sl_decl, big_sleep, a[0], a[1], server_s / 3600, bg, tw, pct(tw, nbash), twv['<=30'], twv['31-120'], twv['121-300'], twv['301-600'], twv['>600'], tw_hit, at[0], at[1]])
        rows2.append([g, pit, pit_s, slow_n, slow_s / 3600, never, aiu, aa[0], aa[1], kill_cmds, kill_before, pct(kill_before, tests), ak[0], ak[1]])
    md_table(['group', 'commands containing `sleep N`', 'share of bash commands', 'seconds of sleep written (each `sleep` counted once; loops run more)', 'commands sleeping 30 s or more', 'stories affected', 'runs affected',
              'measured hours in server / wait / process commands (timed stories)', 'commands starting a background process (`&`, nohup, setsid)', 'commands wrapped in `timeout N`', 'share of bash commands', 'N <= 30 s', '31-120', '121-300', '301-600', '> 600',
              'ran to the limit (timed stories, one wrapper in the command)', 'stories affected', 'runs affected'], rows)
    md_table(['group', 'commands the client cut off ("Command timed out after N seconds")', 'seconds of those limits', f'tool calls of {SLOW_S} s or more', 'their hours', 'tool calls that never returned (timed stories)',
              'bash results with address-in-use', 'stories affected', 'runs affected', 'commands that kill processes', 'test commands preceded by a kill (same command or the one before)', 'share of test commands', 'stories affected', 'runs affected'], rows2)
    note(f'Tool calls of {SLOW_S} s or more, or that never returned ({len(slow)}), by kind: ' + ', '.join(f'{BUDGET[k]} {n}' for k, n in collections.Counter(x[2] for x in slow).most_common()))
    md_table(['seconds', 'where', 'kind', 'command (after any leading cd)'], [[('never returned' if x[0] == float('inf') else f'{x[0]:.0f}'), x[1], x[2], '`' + x[3].replace('|', '\\|') + '`'] for x in sorted(slow, key=lambda x: (-x[0], x[1]))[:15]])


# ---------------------------------------------------------------- 8. generation
REPEAT_MIN_LINE = 30     # characters: shortest line counted when measuring repetition inside one piece of thinking


def repeated_chars(text):
    """Characters of a piece of thinking that sit on lines already written earlier in the same piece (lines of 30+ characters)."""
    seen = set(); n = 0
    for line in text.split('\n'):
        k = line.strip()
        if len(k) < REPEAT_MIN_LINE: continue
        if k in seen: n += len(line) + 1
        else: seen.add(k)
    return n


EMPTY_KINDS = ['engine error, nothing generated', 'stopped at the length limit after under 100 output tokens', 'thinking ran to the length limit', 'ended normally with thinking only']


def empty_kind(c):
    if c.stop == 'error' or c.stop == 'aborted': return EMPTY_KINDS[0]
    if c.stop == 'length': return EMPTY_KINDS[1] if (c.out_tok or 0) < 100 else EMPTY_KINDS[2]
    return EMPTY_KINDS[3]


def sec8(S, G):
    h('8. Generation: thinking, empty replies, tool calls per reply, narration')
    rows = []; rows2 = []; rows3 = []; rows4 = []; rows5 = []
    for g, st in G.items():
        calls = [c for s in st for c in s.calls]; n = len(calls)
        th = sorted(c.think or 0 for c in calls); ot = sorted(c.out_tok or 0 for c in calls); tot_th = sum(th)
        longn = sum(1 for x in th if x >= LONG_THINK); longc = sum(x for x in th if x >= LONG_THINK)
        hs = set(s.sk for s in st if any((c.think or 0) >= LONG_THINK for c in s.calls)); a = aff(st, hs)
        long_s = 0.0; gen_s = 0.0; long_tok = 0; rep = 0; rep_calls = 0; after_first = 0; first = 0
        for s in st:
            gen = timeline(s)[0] if s.timed else {}
            for c in s.calls:
                gen_s += gen.get(c.idx, 0)
                if (c.think or 0) >= LONG_THINK:
                    long_s += gen.get(c.idx, 0); long_tok += c.out_tok or 0
                    if c.idx <= 25: first += 1
                    r = repeated_chars(c.think_full) if FULL_TEXT else 0; rep += r
                    if r >= 0.2 * c.think: rep_calls += 1; hit('long_thinking_repeats', s, f'{c.think:,} chars of thinking, {r:,} on repeated lines; begins: {c.think_full[:200]}')
                    hit('long_thinking', s, f'call {c.idx}, {c.think:,} chars, {c.out_tok} output tokens, then {call_class(c)}; begins: {c.think_full[:220]}')
        rows.append([g, n, quantile(th, 0.5), quantile(th, 0.9), quantile(th, 0.99), th[-1] if th else 0, longn, pct(longn, n), pct(longc, tot_th), long_tok, pct(long_tok, sum(ot)), pct(long_s, gen_s), a[0], a[1], rep, pct(rep, longc), rep_calls])
        text = sum(c.text or 0 for c in calls); args = sum(t.arg_chars or 0 for s in st for t in s.tools); tot = tot_th + text + args
        rows2.append([g, sum(ot), quantile(ot, 0.5), quantile(ot, 0.9), quantile(ot, 0.99), ot[-1] if ot else 0, tot, pct(tot_th, tot), pct(text, tot), pct(args, tot)])
        n0 = sum(1 for c in calls if not c.n_tools); n1 = sum(1 for c in calls if c.n_tools == 1); n2 = sum(1 for c in calls if (c.n_tools or 0) > 1); ntools = sum(c.n_tools or 0 for c in calls)
        empty = [c for c in calls if not c.n_tools and not (c.text or 0)]; he = set(c.sk for c in empty); ae = aff(st, he); ek = collections.Counter(empty_kind(c) for c in empty); etok = collections.Counter()
        for c in empty: etok[empty_kind(c)] += c.out_tok or 0
        narr = [c for c in calls if c.n_tools and (c.text or 0) > 0]; narr_chars = sum(c.text for c in narr); nq = sorted(c.text for c in narr)
        for s in st:
            for c in s.calls:
                if not c.n_tools and not (c.text or 0): hit('empty_reply', s, f'[{empty_kind(c)}] stop={c.stop} think={c.think} out_tok={c.out_tok} :: {c.think_full[-200:]}')
                if c.n_tools and (c.text or 0) > 0: hit('narration', s, c.text_full)
        stops = collections.Counter(c.stop for c in calls)
        cont = sum(1 for s in st for m in s.msgs if (m[2] or '').startswith('Continue with the task')); hc = set(s.sk for s in st if any((m[2] or '').startswith('Continue with the task') for m in s.msgs)); ac = aff(st, hc)
        per = sorted((sum(1 for m in s.msgs if (m[2] or '').startswith('Continue with the task')) for s in st), reverse=True)
        astext = sum(1 for s in st for m in s.msgs if (m[2] or '').startswith('Your last reply contained a tool call written out as text'))
        rows3.append([g, n, pct(n0, n), pct(n1, n), pct(n2, n), (ntools / (n1 + n2)) if (n1 + n2) else 0.0, len(narr), pct(len(narr), n1 + n2), quantile(nq, 0.5), narr_chars, pct(narr_chars, tot)])
        rows4.append([g, len(empty), pct(len(empty), n), ae[0], ae[1]] + [f'{ek[k]} ({etok[k]:,} tok)' for k in EMPTY_KINDS] + [stops.get('length', 0), stops.get('error', 0)])
        rows5.append([g, cont, ac[0], ac[1], per[0] if per else 0, per[1] if len(per) > 1 else 0, astext])
    md_table(['group', 'model calls', 'thinking characters per call: median', 'p90', 'p99', 'max', f'calls with {LONG_THINK:,}+ characters of thinking', 'share of calls', 'their share of all thinking characters', 'their output tokens', 'share of all output tokens',
              'their share of generating time (timed stories)', 'stories affected', 'runs affected', 'characters in them on lines that repeat an earlier line of the same thinking', 'share of their characters', 'calls where 20%+ of the thinking is repeated lines'], rows)
    note('Claude\'s thinking text is withheld, so its thinking columns are 0 and not comparable.')
    md_table(['group', 'output tokens recorded', 'per call: median', 'p90', 'p99', 'max', 'characters the model produced (thinking + visible text + tool arguments)', 'thinking', 'visible text', 'tool arguments'], rows2)
    note('Claude\'s recorded output tokens are partial counts from the start of each reply (far fewer tokens than characters written), so use the character columns for Claude.')
    md_table(['group', 'model calls', 'no tool call', 'one tool call', 'several tool calls', 'tool calls per tool-calling reply', 'replies with visible text before the tool call (narration)', 'share of tool-calling replies', 'median characters', 'characters of narration', 'share of all characters produced'], rows3)
    md_table(['group', 'replies with neither text nor tool call', 'share of calls', 'stories affected', 'runs affected'] + EMPTY_KINDS + ['all replies stopped at the length limit', 'all replies ending in an engine error'], rows4)
    md_table(['group', '"Continue with the task" messages from the harness', 'stories affected', 'runs affected', 'most in one story', 'second most', '"tool call written out as text" messages'], rows5)


# ---------------------------------------------------------------- 9. compaction
def sec9(S, G):
    h('9. Compaction (the client summarising the conversation to free context)')
    rows = []; rows2 = []
    first_classes = BUDGET_ROWS
    for g, st in G.items():
        per = sorted(len(s.comps) for s in st); n = sum(per); hs = set(s.sk for s in st if s.comps); a = aff(st, hs)
        reasons = collections.Counter(c[2] for s in st for c in s.comps); sz = sorted(c[3] or 0 for s in st for c in s.comps); du = sorted(c[1] - c[0] for s in st for c in s.comps if c[0] is not None and c[1] is not None)
        before = []; after = []; firstk = collections.Counter(); nfirst = 0; span = 0.0
        for s in st:
            if s.timed: span += timeline(s)[5]
            for comp in s.comps:
                cst, cen = comp[0], comp[1]
                if cen is None or cst is None: continue
                b = [c for c in s.calls if c.rx is not None and c.rx <= cst]; af = [c for c in s.calls if c.rx is not None and c.rx > cen]
                if b and af:
                    before.append((b[-1].in_tok or 0) + (b[-1].cache_tok or 0)); after.append((af[0].in_tok or 0) + (af[0].cache_tok or 0))
                tl = [t for t in s.tools if t.start is not None and t.start >= cen]
                if tl: firstk[BUDGET[tl[0].kind]] += 1; nfirst += 1
        before.sort(); after.sort()
        rows.append([g, n, a[0], a[1], quantile(per, 0.5), quantile(per, 0.9), per[-1] if per else 0, reasons.get('threshold', 0), reasons.get('overflow', 0), sum(1 for x in sz if x == 0), quantile(sz, 0.5), sz[-1] if sz else 0, sum(sz),
                     quantile(du, 0.5), quantile(du, 0.9), sum(du) / 3600, quantile(before, 0.5), quantile(after, 0.5)])
        rows2.append([g, nfirst] + [pct(firstk[k], nfirst) for k in first_classes])
    md_table(['group', 'compactions', 'stories affected', 'runs affected', 'per story: median', 'p90', 'max', 'reason: threshold', 'reason: overflow', 'compactions that produced no summary', 'summary characters: median', 'max', 'total', 'seconds each: median', 'p90', 'total hours',
              'prompt tokens in the last call before (median)', 'prompt tokens in the first call after (median)'], rows)
    md_table(['group', 'compactions followed by a tool call'] + ['first tool call after: ' + first_classes[0]] + first_classes[1:], rows2)


REREAD_MIN = 1000     # tokens of the previous prompt not served from cache, for a call to count as a cache miss


def sec9b(S, G):
    h('9b. The prompt cache: how much of each prompt the engine had to read again')
    rows = []; byrun = collections.Counter(); cachevals = collections.defaultdict(collections.Counter)
    for g, st in G.items():
        calls = unc = cached = 0; miss = miss_tok = 0; miss_s = 0.0; gen_s = 0.0; hs = set(); after_comp = after_comp_tok = 0; prompts = []; bins = collections.Counter(); usable = 0; ucalls = 0
        for s in st:
            for c in s.calls: calls += 1; unc += c.in_tok or 0; cached += c.cache_tok or 0; prompts.append((c.in_tok or 0) + (c.cache_tok or 0))
            if not s.timed or any(c[0] is None or c[1] is None for c in s.comps): continue
            usable += 1; gen = timeline(s)[0]; comp_ends = sorted(c[1] for c in s.comps); prev = None; prev_rx = None
            for c in s.calls:
                ucalls += 1; i_, k_ = c.in_tok or 0, c.cache_tok or 0; gen_s += gen.get(c.idx, 0)
                if prev is not None:
                    if any(prev_rx <= e <= c.rx for e in comp_ends): after_comp += 1; after_comp_tok += i_
                    elif prev - k_ >= REREAD_MIN:
                        r = prev - k_; miss += 1; miss_tok += r; miss_s += gen.get(c.idx, 0); hs.add(s.sk); byrun[(g, s.run)] += 1; cachevals[(g, s.run)][k_] += 1; bins['1,000-4,999' if r < 5000 else '5,000-19,999' if r < 20000 else '20,000+'] += 1
                        hit('cache_miss', s, f'call {c.idx}: previous prompt {prev:,} tokens; this call got {k_:,} from cache and read {i_:,} afresh ({r:,} of the old prompt again); stop={c.stop}')
                prev = i_ + k_; prev_rx = c.rx
        prompts.sort(); a = aff(st, hs)
        rows.append([g, calls, quantile(prompts, 0.5), prompts[-1] if prompts else 0, unc, pct(unc, unc + cached), f'{usable}/{len(st)}', ucalls, after_comp, after_comp_tok, miss, pct(miss, ucalls), bins['1,000-4,999'], bins['5,000-19,999'], bins['20,000+'], miss_tok,
                     miss_s / 3600, pct(miss_s, gen_s), a[0], a[1]])
    md_table(['group', 'model calls', 'prompt tokens per call: median', 'max', 'prompt tokens read afresh (not from cache), total', 'share of all prompt tokens', 'stories with times for every call and compaction', 'their model calls',
              'first calls after a compaction (cache loss expected)', 'tokens read afresh in them', f'other calls where {REREAD_MIN:,}+ tokens of the previous prompt were not served from cache', 'share of calls', 'missing 1,000-4,999 tokens', '5,000-19,999', '20,000+',
              'tokens of old prompt read again', 'generating hours of those calls', 'share of generating time', 'stories affected', 'runs affected'], rows)
    note('Cache misses by run (runs with 3 or more), with the most common number of tokens served from cache in them: ' + '; '.join(
        f'{g} {r}: {n} misses, most often {cachevals[(g, r)].most_common(1)[0][0]:,} tokens from cache ({cachevals[(g, r)].most_common(1)[0][1]} times)' for (g, r), n in sorted(byrun.items(), key=lambda x: (-x[1], x[0])) if n >= 3))
    note('Claude Code\'s cache accounting differs (cache creation is reported separately and is not in this data), so its rows are not comparable.')


# ---------------------------------------------------------------- 10. dependencies
NPX_DL = re.compile(r'npm warn exec The following package|Need to install the following packages')


def sec10(S, G):
    h('10. Dependencies fetched or looked up while working')
    rows = []
    for g, st in G.items():
        c = collections.Counter(); sec = collections.Counter(); hs = set(); later = collections.Counter(); npxdl = 0; errs = 0
        for s in st:
            _, tool_s, _, _, _, _ = timeline(s) if s.timed else ({}, {}, 0, 0, 0, 0)
            for t in s.tools:
                if t.name != 'bash': continue
                if NPX_DL.search(t.res): npxdl += 1; hit('npx_download', s, t.arg)
                heads = set(hd for k, hd, _, _ in t.segs if k in ('install', 'dep_lookup'))
                if not heads: continue
                for hd in heads:
                    key = 'npm install' if hd == 'npm install' else 'playwright install' if hd == 'playwright install' else 'npm view / info' if hd in ('npm view', 'npm info', 'npm show') else 'npm ls and other lookups' if hd.startswith('npm ') else 'system packages (apt, dpkg, pip, brew)'
                    c[key] += 1; hs.add(s.sk)
                    if s.story > 1: later[key] += 1
                    if t.kind in ('install', 'dep_lookup') and t.idx in tool_s: sec[key] += tool_s[t.idx] / len(heads)
                    hit('dep_' + key.split()[0] + '_' + key.split()[1], s, t.arg)
                if NPM_ERROR.search(t.res): errs += 1
        a = aff(st, hs); K = ['npm install', 'playwright install', 'npm view / info', 'npm ls and other lookups', 'system packages (apt, dpkg, pip, brew)']
        rows.append([g] + [x for k in K for x in (c[k], later[k], sec[k])] + [npxdl, errs, a[0], a[1]])
    hdr = ['group']
    for k in ['npm install', 'playwright install', 'npm view / info', 'npm ls and other lookups', 'system packages (apt, dpkg, pip, brew)']: hdr += [k + ': commands', 'of which after story 1', 'seconds (timed stories, commands of this kind only)']
    md_table(hdr + ['results showing npx downloading a package', 'dependency commands whose result has an npm error', 'stories affected', 'runs affected'], rows)


# ---------------------------------------------------------------- 11. debugging style
SCRATCH = re.compile(r'(?:^|/)(?:[\w.-]*(?:debug|dbg|probe|scratch|repro|diag|spike|tmp|temp|zz-|experiment|smoke|trial|sandbox)[\w.-]*)\.(?:[cm]?[jt]sx?|mts|py|sh|html|json)$', re.I)
CAT_TO = re.compile(r'(?:cat|tee)\s*>{1,2}\s*([\w./~$"\'{}-]+)\s*<<|>\s*([\w./~-]+\.(?:[cm]?[jt]sx?|py|sh))\s*<<')
INLINE = re.compile(r'(?:node|python3?|tsx)\s+(?:--[\w=-]+\s+)*(?:-e|-c|-p|-)\s|(?:node|python3?)\s+(?:--[\w=-]+\s+)*<<')


def rm_patterns(cmd):
    """Glob patterns named by rm commands (and whether the command wipes untracked files wholesale)."""
    pats = []; wipe = bool(re.search(r'git clean\b|git stash (?:push )?(?:-u|--include-untracked)|git stash -u', cmd))
    for m in re.finditer(r'(?:^|[;&|(\n]|\bdo\b|\bthen\b)\s*rm\s+([^;&|\n)]*)', cmd):
        for x in m.group(1).split():
            if not x.startswith('-') and not x.startswith('2>'): pats.append(x.strip('"\''))
    return pats, wipe


def glob_rx(pat): return re.compile('^' + re.escape(pat).replace(r'\*', '.*').replace(r'\?', '.').replace(r'\{', '(?:').replace(r'\}', ')').replace(',', '|') + '$')


def removed_by(p, pats):
    base = p.rsplit('/', 1)[-1]
    for x in pats:
        x = norm_path(x); x = x.rstrip('/')
        if not x: continue
        try: rx = glob_rx(x)
        except re.error: continue
        if rx.match(p) or rx.match(base) or p.startswith(x + '/') or rx.match(p.rsplit('/', 1)[0]): return True
    return False


def sec11(S, G):
    h('11. Debugging style: throwaway scripts, scratch files, console.log')
    rows = []; rows2 = []
    for g, st in G.items():
        inline = inline_chars = 0; hi = set(); created = collections.Counter(); deleted = collections.Counter(); left = collections.Counter(); hsx = set(); hleft = set(); cl_bash = cl_bash_n = cl_grep = 0
        src_add = src_rem = test_add = test_rem = 0; hc = set(); net_story = 0
        for s in st:
            files = {}
            for i, t in enumerate(s.tools):
                if t.name == 'bash':
                    if any(k == 'script' and hd in ('node', 'python3', 'python', 'tsx') and INLINE.search(' '.join(seg.split()) + ' ') for k, hd, _, seg in t.segs):
                        inline += 1; inline_chars += t.arg_full or 0; hi.add(s.sk); hit('inline_script', s, t.arg)
                    cmd = strip_heredocs(t.arg)[0]
                    for m in CAT_TO.finditer(t.arg):
                        p = norm_path((m.group(1) or m.group(2)).strip('"\''))
                        if p.startswith('/tmp') or SCRATCH.search(p):
                            if files.get(p) is None: files[p] = i; created['/tmp' if p.startswith('/tmp') else 'workspace'] += 1; hsx.add(s.sk); hit('scratch_file', s, p)
                    pats, wipe = rm_patterns(cmd)
                    for p in list(files):
                        if files[p] is not None and (wipe and not p.startswith('/tmp') or removed_by(p, pats)): deleted['/tmp' if p.startswith('/tmp') else 'workspace'] += 1; files[p] = None
                    if any(k == 'write' for k, _, _, _ in t.segs):
                        n = len(CONSOLE.findall(t.arg))
                        if n: cl_bash += 1; cl_bash_n += n
                    if re.search(r'(?:grep|rg)\b[^|;&]*console\\?\.', cmd): cl_grep += 1
                elif t.name == 'write' and not t.error:
                    if t.path.startswith('/tmp') or SCRATCH.search(t.path):
                        if files.get(t.path) is None: files[t.path] = i; created['/tmp' if t.path.startswith('/tmp') else 'workspace'] += 1; hsx.add(s.sk); hit('scratch_file', s, t.path)
            for p, v in files.items():
                if v is not None:
                    loc = '/tmp' if p.startswith('/tmp') else 'workspace'; left[loc] += 1
                    if loc == 'workspace': hleft.add(s.sk); hit('scratch_left_in_workspace', s, p)
            net = 0
            for p, add, rem in file_replay(s)[2]:
                if p.startswith('/tmp') or SCRATCH.search(p): continue
                if TEST_PATH.search(p): test_add += add; test_rem += rem
                else:
                    src_add += add; src_rem += rem; net += add - rem
                    if add: hit('console_added_src', s, f'{p}: +{add}')
            if net > 0: hc.add(s.sk); net_story += net
        a = aff(st, hi); ax = aff(st, hsx); al = aff(st, hleft); ac = aff(st, hc)
        rows.append([g, inline, inline_chars, a[0], a[1], created['workspace'], deleted['workspace'], left['workspace'], al[0], al[1], created['/tmp'], deleted['/tmp'], left['/tmp'], ax[0], ax[1]])
        rows2.append([g, src_add, src_rem, src_add - src_rem, ac[0], ac[1], test_add, test_rem, cl_bash, cl_bash_n, cl_grep])
    md_table(['group', 'commands running an inline script (node -e, python3 -c, heredoc to an interpreter)', 'characters of those commands', 'stories affected', 'runs affected', 'scratch files created in the workspace (name says debug, probe, tmp, scratch...)',
              'later removed in the same story (rm, git clean, git stash -u)', 'not removed in the story', 'stories affected (not removed)', 'runs affected (not removed)', 'files created under /tmp', 'later removed', 'not removed', 'stories affected (any scratch file)', 'runs affected'], rows)
    md_table(['group', 'console.log/error/warn/debug/info statements added to non-test files by edit and write calls', 'removed by edit and write calls', 'net left', 'stories with a net addition', 'runs affected',
              'added to test files', 'removed from test files', 'bash commands that write files and contain console statements', 'statements in them', 'bash greps for "console."'], rows2)
    note('Additions and removals are counted from the complete old and new text of each edit and from each whole-file write against the file\'s last known content. Statements written or removed through bash (python, sed, heredocs) are counted as commands only, so the net figure does not see removals made through bash; a console.error that is part of the product (error reporting in the worker) also counts as an addition.')


# ---------------------------------------------------------------- 12. large results
CLIENT_CUT = re.compile(r'\[Showing lines [\d-]+ of \d+|\(\d+(?:\.\d+)?KB limit\)|Output too large|<persisted-output>|\[truncated \d+ chars\]|exceeds maximum allowed tokens|\[\d+ more lines in file|characters truncated')
DUP_MIN = 500      # characters: smallest result counted as a duplicate of an earlier one


def sec12(S, G):
    h('12. What fills the context: tool results by kind, the largest results, truncation, and results returned twice')
    res = collections.Counter(); tot = collections.Counter(); big = collections.Counter(); bigc = collections.Counter(); n = collections.Counter(); cap = collections.Counter(); capk = collections.Counter(); top = []
    dup = collections.Counter(); dupc = collections.Counter(); dupk = collections.Counter(); hb = collections.defaultdict(set); hd_ = collections.defaultdict(set)
    for g, st in G.items():
        for s in st:
            seen = {}
            for t in s.tools:
                k = BUDGET[t.kind]; res[(g, k)] += t.res_chars; tot[g] += t.res_chars; n[g] += 1
                what = t.arg[t.cdlen:] if t.name == 'bash' else (t.path or t.arg)
                if t.res_chars >= BIG_RESULT: big[g] += 1; bigc[g] += t.res_chars; hb[g].add(s.sk); top.append((t.res_chars, where(s), k, scrub(what, 120))); hit('big_result', s, what)
                m = CLIENT_CUT.search(t.res[:300]) or CLIENT_CUT.search(t.res[-400:])
                if m: cap[g] += 1; capk[(g, t.name)] += 1; hit('client_cut_result', s, f'{scrub(what, 120)} => {t.res[-200:] if s.client == "pi" else t.res[:200]}')
                if FULL_TEXT and t.res_chars >= DUP_MIN and not t.error:
                    key = hash(t.res)
                    if key in seen: dup[g] += 1; dupc[g] += t.res_chars; dupk[(g, k)] += t.res_chars; hd_[g].add(s.sk); hit('duplicate_result', s, f'{scrub(what, 150)} ({t.res_chars:,} chars; first returned by tool call {seen[key]}, again by {t.idx})')
                    else: seen[key] = t.idx
    rows = [[k] + [pct(res[(g, k)], tot[g]) for g in G] + [sum(res[(g, k)] for g in G)] for k in BUDGET_ROWS]
    rows.append(['total characters returned by tools'] + [tot[g] for g in G] + [sum(tot.values())])
    md_table(['characters returned by tools, by kind (% of group)'] + list(G) + ['all, characters'], rows)
    rows = []
    for g, st in G.items():
        a = aff(st, hb[g]); ad = aff(st, hd_[g])
        rows.append([g, n[g], big[g], pct(big[g], n[g]), bigc[g], pct(bigc[g], tot[g]), a[0], a[1], cap[g], capk[(g, 'bash')], capk[(g, 'read')], dup[g], dupc[g], pct(dupc[g], tot[g]), ad[0], ad[1]])
    md_table(['group', 'tool results', f'results of {BIG_RESULT:,}+ characters', 'share of results', 'their characters', 'share of all result characters', 'stories affected', 'runs affected',
              'results cut short (client size or line limit, a limit the model set on a read, or output saved to a file)', 'of which bash', 'of which read', f'results of {DUP_MIN}+ characters identical to an earlier result in the same story', 'their characters', 'share of all result characters', 'stories affected', 'runs affected'], rows)
    note('Duplicate results by kind (characters, all groups): ' + ', '.join(f'{k} {sum(dupk[(g, k)] for g in G):,}' for k in sorted(BUDGET_ROWS, key=lambda k: -sum(dupk[(g, k)] for g in G)) if sum(dupk[(g, k)] for g in G)))
    kinds = collections.Counter(x[2] for x in top)
    note(f'What produced the {len(top):,} results of {BIG_RESULT:,}+ characters: ' + ', '.join(f'{k} {v}' for k, v in sorted(kinds.items(), key=lambda x: (-x[1], x[0]))))
    md_table(['characters', 'where', 'kind', 'what'], [[x[0], x[1], x[2], '`' + x[3].replace('|', '\\|') + '`'] for x in sorted(top, key=lambda x: (-x[0], x[1], x[3]))[:15]])
    paths = collections.Counter(); pchars = collections.Counter()
    for s in S.values():
        if s.client != 'pi': continue
        for t in s.tools:
            if t.name == 'read' and t.res_chars >= BIG_RESULT: paths[re.sub(r'\d{3}-[\w-]+', '<story>', t.path)] += 1; pchars[re.sub(r'\d{3}-[\w-]+', '<story>', t.path)] += t.res_chars
    md_table([f'Qwen: files whose read-tool result was {BIG_RESULT:,}+ characters', 'reads', 'characters'], [[f'`{p}`', c, pchars[p]] for p, c in sorted(paths.items(), key=lambda x: (-x[1], x[0]))[:12]])


SECTIONS = [sec0, sec1, sec2, sec3, sec4, sec5, sec6, sec7, sec8, sec9, sec10, sec11, sec12, sec9b]


def main():
    if len(sys.argv) < 2: sys.exit('usage: python3 detect_performance.py conv.db [--samples [detector]] [--only N,N]')
    S = load(sys.argv[1]); G = groups(S)
    only = None
    if '--only' in sys.argv: only = set(int(x) for x in sys.argv[sys.argv.index('--only') + 1].split(','))
    samples = '--samples' in sys.argv
    if samples: real, sys.stdout = sys.stdout, open('/dev/null', 'w')
    else: print(f'# Performance detectors: every table, over every story conversation in {sys.argv[1]}' + ('' if FULL_TEXT else ' (heads and tails only: text detectors are approximate here)'))
    for i, f in enumerate(SECTIONS):
        if only is None or i in only: f(S, G)
    if samples:
        sys.stdout = real; want = sys.argv[sys.argv.index('--samples') + 1] if len(sys.argv) > sys.argv.index('--samples') + 1 and not sys.argv[sys.argv.index('--samples') + 1].startswith('--') else None
        for name in sorted(HITS):
            if want and want != name: continue
            rnd = random.Random(20261001); hits = HITS[name]
            print(f'\n=== {name}: {len(hits)} hits; {min(SAMPLE_N, len(hits))} chosen at random (fixed seed)')
            for sk, w, text in rnd.sample(hits, min(SAMPLE_N, len(hits))): print(f'  [{w}] {text}')


if __name__ == '__main__': main()
