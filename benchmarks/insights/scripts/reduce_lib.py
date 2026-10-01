"""Shared by the builders: the flag patterns and small helpers."""
import json, re
TRUNC = re.compile(r'(?:\u2026|\\u2026)\[truncated (\d+) chars\]')
HOME = re.compile(r'/(?:home|Users)/[A-Za-z0-9_.-]+')
RES_FLAGS = {  # looked for anywhere in a tool result
    'perm_denied': r'[Pp]ermission denied|EACCES|EPERM|Operation not permitted|Read-only file system|EROFS',
    'not_found_cmd': r'command not found|not recognized as an internal',
    'no_such_file': r'No such file or directory|ENOENT',
    'addr_in_use': r'EADDRINUSE|address already in use',
    'timed_out': r'[Tt]imed out|[Tt]imeout of \d+|Test timeout|exceeded.{0,20}time|ETIMEDOUT|timeout \d+ms',
    'edit_mismatch': r'Could not find|oldText|old_string|not found in file|must be unique|matches multiple|No match',
    'ts_error': r'error TS\d+',
    'syntax_error': r'SyntaxError|Unexpected token|Parse error',
    'module_missing': r'Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND|Module not found',
    'npm_error': r'npm ERR!|npm error',
    'killed': r'\bKilled\b|Terminated|SIGKILL|SIGTERM|interrupted|aborted',
    'oom': r'heap out of memory|out of memory|ENOMEM|Cannot allocate',
    'no_space': r'ENOSPC|No space left',
    'crash': r'Segmentation fault|core dumped|panicked at',
    'net_fail': r'ENOTFOUND|ECONNREFUSED|ECONNRESET|getaddrinfo|Could not resolve host|network is unreachable|403 Forbidden|407 Proxy',
    'tests_failed': r'\b\d+ failed\b|Tests? +\d+ failed|✘|✗|FAIL ',
    'tests_passed': r'\b\d+ passed\b',
    'flaky': r'\b\d+ flaky\b',
    'browser_missing': r"Executable doesn't exist|playwright install|Host system is missing dependencies|browserType.launch",
    'sandbox': r'sandbox|deny\(|Seatbelt|bwrap',
    'truncated_output': r'\[\.\.\. ?truncated|output truncated|Full output|\d+ more lines|truncated\]',
}
ARG_FLAGS = {  # looked for anywhere in a tool call's arguments (the command, or the file content written)
    'test_skip': r'\b(?:test|it|describe)\.(?:skip|fixme|todo)\b|\bx(?:it|describe)\(|\.skip\(',
    'test_only': r'\b(?:test|it|describe)\.only\b',
    'ts_suppress': r'@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|as any\b|as unknown as',
    'timeout_raise': r'setTimeout\(|timeout:\s*\d|--timeout[ =]\d|testTimeout|waitForTimeout',
    'console_log': r'console\.(?:log|error|warn|debug)\(',
    'todo_marker': r'\bTODO\b|\bFIXME\b|\bHACK\b',
    'retries': r'retries:\s*[1-9]|--retries[ =][1-9]',
    'no_verify': r'--no-verify|--force\b|-f\b.*push',
    'cjk': r'[\u4e00-\u9fff]',
}
TEXT_FLAGS = {  # in the model's thinking or visible text
    'cjk': r'[\u4e00-\u9fff]',
    'eval_aware': r'benchmark|being (?:evaluated|tested|graded)|held[- ]out|hidden tests?|the harness|the grader|evaluator|acceptance (?:suite|tests)',
    'gives_up': r"I(?: a|')m stuck|give up|cannot proceed|can't proceed|unable to (?:continue|proceed|complete)|not possible to",
    'question': r'\?\s*$',
    'claims_done': r'complete|all (?:checks|tests|suites) pass|fully implemented|nothing left|is done',
    'shortcut': r'for now|work ?around|skip (?:this|the) test|simplif|hack|stub|placeholder|temporarily|good enough|pragmatic',
    'blames_env': r'pre-?existing|flaky|environment|not related to (?:my|our|this)|unrelated|infrastructure|out of scope',
}
RES_RX = {k: re.compile(v) for k, v in RES_FLAGS.items()}; ARG_RX = {k: re.compile(v) for k, v in ARG_FLAGS.items()}; TEXT_RX = {k: re.compile(v, re.I) for k, v in TEXT_FLAGS.items()}
def flags(rx, s): return [k for k, r in rx.items() if r.search(s)] if s else []
SUMMARY = re.compile(r'(\d+) (passed|failed|flaky|skipped|did not run)')
def summary(res):
    out = {}
    for n, k in SUMMARY.findall(res[-4000:]): out[k] = int(n)
    return out
def edit_sizes(a):
    eds = a.get('edits') if isinstance(a.get('edits'), list) else None
    if eds: return len(eds), sum(len(str(x.get('oldText') or x.get('old_string') or '')) for x in eds if isinstance(x, dict)), sum(len(str(x.get('newText') or x.get('new_string') or '')) for x in eds if isinstance(x, dict))
    old_ = a.get('oldText') or a.get('old_string'); new_ = a.get('newText') or a.get('new_string') or a.get('content')
    return (1 if (old_ is not None or new_ is not None) else 0), len(str(old_ or '')), len(str(new_ or ''))
