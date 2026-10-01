"""build_full.py <repo root> <dir of fetched full logs> <out.db> — every conversation, complete text.

For each story conversation published in the repo, reads the complete event log where one exists (the machine's
agent-events.jsonl, fetched under <dir>/<machine>/…, or the repo checkout's own) and otherwise the published log.
Kept: every model reply (all thinking and text), every tool call (complete arguments, complete result), every
message the harness sent, every compaction. Dropped: only the stream's partial events (message_update,
message_start, tool_execution_update, turn_end, agent_end), which repeat, in pieces or in bulk, what the complete
events hold. Home paths are replaced by ~.
"""
import glob, gzip, json, os, re, sqlite3, sys
from reduce_lib import RES_RX, ARG_RX, TEXT_RX, flags, summary, edit_sizes, TRUNC, HOME

REPO, FULL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SKIP = ('"message_update"', '"agent_end"', '"turn_end"', '"message_start"', '"tool_execution_update"', '"stream_event"')
PRE = 90
def clean(s): return HOME.sub('~', s) if isinstance(s, str) else s
def text_of(content):
    if isinstance(content, str): return content
    return ''.join((b.get('text') or '') for b in (content or []) if isinstance(b, dict) and b.get('type') == 'text')

published = sorted(os.path.dirname(p)[len(REPO) + 1:] for p in glob.glob(f'{REPO}/combinations/**/stories/*/agent-events.compact.jsonl.gz', recursive=True) + glob.glob(f'{REPO}/benchmarks/reference/**/stories/*/agent-events.compact.jsonl.gz', recursive=True) if '/rescore' not in p)
candidates = {}
for root in [REPO] + sorted(glob.glob(f'{FULL}/*')):
    for p in glob.glob(f'{root}/combinations/**/stories/*/agent-events.jsonl', recursive=True) + glob.glob(f'{root}/benchmarks/reference/**/stories/*/agent-events.jsonl', recursive=True):
        if '/rescore' in p: continue
        rel = os.path.dirname(p)[len(root) + 1:]
        if rel not in published: rel = rel.replace('-opencode/', '-pi/')     # recorded before the combinations were renamed
        candidates.setdefault(rel, []).append(p)
extras = sorted(set(candidates) - set(published)); published_set = set(published)

def parse(path):
    ntr = ctr = 0; fmt = None
    calls = []; tools = {}; order = []; msgs = []; comps = []; comp_start = None; by_mid = {}
    opener = gzip.open(path, 'rt', errors='replace') if path.endswith('.gz') else open(path, errors='replace')
    with opener as f:
        for line in f:
            if any(s in line[:PRE] for s in SKIP): continue
            for mt in TRUNC.finditer(line): ntr += 1; ctr += int(mt.group(1))
            try: e = json.loads(line)
            except ValueError: continue
            if not isinstance(e, dict): continue
            t, rx = e.get('type'), e.get('_rx')
            if t == 'message_end':
                fmt = 'pi'; msg = e.get('message') or {}; role = msg.get('role')
                if role == 'assistant':
                    c = msg.get('content') if isinstance(msg.get('content'), list) else []
                    th = clean(''.join(b.get('thinking') or '' for b in c if b.get('type') == 'thinking')); tx = clean(text_of(c))
                    tcs = [b for b in c if b.get('type') == 'toolCall']; u = msg.get('usage') or {}
                    idx = len(calls)
                    calls.append([idx, rx, len(th), len(tx), len(tcs), u.get('output'), u.get('input'), u.get('cacheRead'), msg.get('stopReason'), 0, ','.join(flags(TEXT_RX, th)), ','.join(flags(TEXT_RX, tx)), th, tx])
                    for b in tcs:
                        a = b.get('arguments') or {}; aj = clean(json.dumps(a, ensure_ascii=False))
                        arg = a.get('command') if b.get('name') == 'bash' else a.get('path')
                        arg = clean(str(arg if arg is not None else aj)); ne, oc, nc = edit_sizes(a)
                        tools[b.get('id')] = dict(call=idx, name=b.get('name'), arg=arg, aj=aj, start=None, end=None, err=None, res=None, sub=0, ne=ne, oc=oc, nc=nc); order.append(b.get('id'))
                elif role == 'user':
                    tx = clean(text_of(msg.get('content'))); msgs.append([len(msgs), rx, 'user', len(tx), tx])
            elif t == 'tool_execution_start':
                d = tools.get(e.get('toolCallId'))
                if d: d['start'] = rx
            elif t == 'tool_execution_end':
                d = tools.get(e.get('toolCallId'))
                if d: d.update(end=rx, err=int(bool(e.get('isError'))), res=clean(text_of((e.get('result') or {}).get('content'))))
            elif t == 'compaction_start': comp_start = rx
            elif t == 'compaction_end':
                r = e.get('result') or {}; comps.append([comp_start, rx, e.get('reason'), len(r.get('summary') or ''), clean(r.get('summary') or '')]); comp_start = None
            elif t == 'assistant' and isinstance(e.get('message'), dict):
                fmt = 'claude'; msg = e['message']; mid = msg.get('id'); sub = int(bool(e.get('parent_tool_use_id')))
                c = msg.get('content') if isinstance(msg.get('content'), list) else []
                if mid not in by_mid:
                    u = msg.get('usage') or {}
                    by_mid[mid] = len(calls); calls.append([len(calls), rx, 0, 0, 0, u.get('output_tokens'), u.get('input_tokens'), u.get('cache_read_input_tokens'), msg.get('stop_reason'), sub, '', '', '', ''])
                row = calls[by_mid[mid]]
                for b in c:
                    if b.get('type') == 'text':
                        tx = clean(b.get('text') or ''); row[13] += tx; row[3] = len(row[13]); row[11] = ','.join(flags(TEXT_RX, row[13]))
                    elif b.get('type') == 'tool_use':
                        row[4] += 1; a = b.get('input') if isinstance(b.get('input'), dict) else {}; aj = clean(json.dumps(a, ensure_ascii=False))
                        arg = a.get('command') if b.get('name') == 'Bash' else (a.get('file_path') or a.get('path') or a.get('pattern'))
                        arg = clean(str(arg if arg is not None else aj)); ne, oc, nc = edit_sizes(a)
                        tools[b.get('id')] = dict(call=row[0], name=b.get('name'), arg=arg, aj=aj, start=rx, end=None, err=None, res=None, sub=sub, ne=ne, oc=oc, nc=nc); order.append(b.get('id'))
            elif t == 'user' and isinstance(e.get('message'), dict):
                c = e['message'].get('content')
                if isinstance(c, str): msgs.append([len(msgs), rx, 'user', len(c), clean(c)])
                else:
                    for b in c or []:
                        if isinstance(b, dict) and b.get('type') == 'tool_result':
                            d = tools.get(b.get('tool_use_id'))
                            if d:
                                res = b.get('content'); res = res if isinstance(res, str) else text_of(res)
                                d.update(end=rx, err=int(bool(b.get('is_error'))), res=clean(res))
                        elif isinstance(b, dict) and b.get('type') == 'text' and not e.get('parent_tool_use_id'):
                            tx = clean(b.get('text') or ''); msgs.append([len(msgs), rx, 'user', len(tx), tx])
    return dict(fmt=fmt, ntr=ntr, ctr=ctr, calls=calls, tools=[dict(tools[t], tid=t) for t in order], msgs=msgs, comps=comps)

if os.path.exists(OUT): os.remove(OUT)
db = sqlite3.connect(OUT)
db.executescript('''
create table stories(sk integer primary key, pack, stack, family, variant, engine, client, machine, run, story int, rel, status, passed int, total int, wall real, fmt, source, truncated_strings int, truncated_chars int, v2 int, invalid int, nudges int, started real, finished real);
create table calls(sk int, idx int, rx real, think int, text int, n_tools int, out_tok int, in_tok int, cache_tok int, stop, sub int, think_flags, text_flags, think_full, text_full, think_head, think_tail, text_head, text_tail);
create table tools(sk int, call_idx int, idx int, tid, name, arg, arg_full int, arg_chars int, start real, end real, error int, res_chars int, sub int, arg_flags, res_flags, n_edits int, old_chars int, new_chars int, passed int, failed int, flaky int, skipped int, args_json, res_full, res_head, res_tail);
create table msgs(sk int, idx int, rx real, role, chars int, text_full, text_head);
create table compactions(sk int, start real, end real, reason, summary_chars int, summary);''')
mc = {}
def metrics(d):
    if d not in mc:
        try: m = json.load(open(f'{REPO}/{d}/metrics.json'))
        except Exception: m = {'stories': {}}
        try: m['_run'] = json.load(open(f'{REPO}/{d}/run.json'))
        except Exception: m['_run'] = {}
        mc[d] = m
    return mc[d]
H, T = 400, 700
n_full = 0
for sk, rel in enumerate(published + extras):   # extras: conversations on the machines with no published log yet (still running, or abandoned)
    best = None
    for p in candidates.get(rel, []):
        r = parse(p)
        if best is None or len(r['calls']) > len(best['calls']): best = dict(r, mode='full')
    comp = parse(f'{REPO}/{rel}/agent-events.compact.jsonl.gz') if rel in published_set else None
    r = best if best and (comp is None or len(best['calls']) >= len(comp['calls'])) else dict(comp, mode='compact')
    if rel not in published_set: r['mode'] = 'full, not published'
    n_full += r['mode'].startswith('full')
    p = rel.split('/')
    if p[0] == 'combinations':
        i = p.index('benchmarks'); stack = '/'.join(p[1:i]); pack = p[i + 1]; run = p[i + 2]
        family, variant, machine = p[1] + ' ' + p[2], p[3], p[i - 3] + '/' + p[i - 2]; engine, client = p[i - 1].rsplit('-', 1)
    else:
        pack, stack, run = p[2], 'reference/' + p[3], p[4]; family, variant, engine, client, machine = 'claude', p[3], 'anthropic', 'claude-code', 'cloud'
    story = int(p[-1]); m = metrics('/'.join(p[:-2])); rec = m['stories'].get(str(story), {}); acc = rec.get('accept') or {}
    db.execute('insert into stories values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (sk, pack, stack, family, variant, engine, client, machine, run, story, rel, rec.get('status'), acc.get('passed'), acc.get('total'), (rec.get('time_split') or {}).get('wall_s'), r['fmt'], r['mode'], r['ntr'], r['ctr'], int(run.startswith('v2-')), int(bool(m['_run'].get('invalid'))), (rec.get('agent') or {}).get('nudges'), rec.get('first_started') or rec.get('started'), rec.get('agent_finished')))
    db.executemany('insert into calls values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [[sk] + x + [x[12][:H], x[12][-T:], x[13][:H], x[13][-T:]] for x in r['calls']])
    rows = []
    for i, d in enumerate(r['tools']):
        res = d['res']; sm = summary(res) if res else {}
        rows.append((sk, d['call'], i, d['tid'], d['name'], d['arg'], len(d['arg']), len(d['aj']), d['start'], d['end'], d['err'], len(res) if res is not None else None, d['sub'], ','.join(flags(ARG_RX, d['aj'])), ','.join(flags(RES_RX, res)) if res else '', d['ne'], d['oc'], d['nc'], sm.get('passed'), sm.get('failed'), sm.get('flaky'), sm.get('skipped'), d['aj'], res, (res or '')[:H], (res or '')[-T:]))
    db.executemany('insert into tools values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', rows)
    db.executemany('insert into msgs values(?,?,?,?,?,?,?)', [[sk] + x + [x[4][:600]] for x in r['msgs']])
    db.executemany('insert into compactions values(?,?,?,?,?,?)', [[sk] + x for x in r['comps']])
    if sk % 50 == 0: db.commit()
db.executescript('create index t_sk on tools(sk); create index c_sk on calls(sk); create index t_name on tools(name); create index t_call on tools(sk,call_idx); create index m_sk on msgs(sk);'); db.commit()
print('published story conversations:', len(published), '| conversations on the machines with no published log (included):', len(extras))
for q in ['select count(*) from calls', 'select count(*) from tools', "select source, count(*), sum(truncated_strings>0) from stories group by 1",
          "select stack, run, count(*) from stories where truncated_strings>0 group by 1,2", "select sum(length(think_full))+sum(length(text_full)) from calls", "select sum(length(args_json)), sum(length(res_full)) from tools"]:
    print(q, db.execute(q).fetchall())
for e in extras: print('  not published:', e)
