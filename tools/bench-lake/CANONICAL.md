# Canonical output of the `bench-lake` command

This file is the contract between the Rust command `bench-lake` (tools/bench-lake) and the Python module
`lake_runs.py` (story 21). The two must print the same bytes for the same lake and question. A Python implementation can
be written from this file alone. The worked examples in it are real output over the fixture lake
`tools/bench-lake/tests/fixtures/lake` and are checked by a Rust test (`tests/canonical.rs`): an example that no longer
matches the command fails that test.

## 1. Command line

    bench-lake <STATE_DIR> <question...>
    bench-lake --roots <COLLECTED> <REFERENCE> <question...>

`STATE_DIR` means the roots `STATE_DIR/collected` and `STATE_DIR/reference`. A root that does not exist is not an error
(section 4, `missing_roots`). Questions:

| Question | Meaning |
|---|---|
| `runs` | every run in the lake, and every folder that is not a run |
| `copies <id>` | every copy of the run id (one per node folder) |
| `preferred <id>` | the copy the ranking picks |
| `record <run> <name> [args]` | one record of a run |
| `log <run> <story>` | a story's log |
| `workspace <run> <story> <dest>` | a working copy of the run's code at the story, made in `<dest>` |
| `complete <run>` | whether the run is complete |

`<id>` is a run id: for a combination run the path below its node folder
(`combinations/<family>/<version>/<variant>/<os>/<machine>/<engine>-<client>/benchmarks/<pack>/<run>`), for a reference
run `benchmarks/reference/<pack>/<stack>/<run>`. `<run>` is an id, which means the preferred copy, or `<node>@<id>`, which
means the copy under that node folder (an id never contains `@`). If `<node>@<id>` names no copy, or `<id>` names no run,
the answer is the absence `E-LAKE-NO-RUN` (the `node` field is the node that was asked for, or `null`).

Record names and the file each names (relative to the run folder). `S` is a story, written with at least two digits
(`01`, `12`, `999`); `V` is a rescore version:

| Name | Arguments | File | Kind |
|---|---|---|---|
| `run-description` | | `run.json` | json |
| `status` | | `run-status.json` | json |
| `metrics` | | `metrics.json` | json |
| `finalize` | | `finalize.json` | json |
| `progress` | | `progress.json` | json |
| `collection` | | `collection.json` | json |
| `rescore` | V | `rescore/V/rescore.json` | json |
| `rescore-accept` | V S | `rescore/V/stories/S/accept-summary.json` | json |
| `accept` | S | `stories/S/accept-summary.json` | json |
| `prompt` | S | `stories/S/prompt.md` | text |
| `base-commit` | S | `stories/S/base-commit` | text |
| `gate` | S | `stories/S/gate.json` | json |

A story argument must match `^-?[0-9]+$` (it is read as a decimal integer, leading zeros allowed, and printed back
without them). A story outside 0 to 999 is the absence `E-LAKE-BAD-NAME`. A version is 1 to 64 characters of
`[A-Za-z0-9._-]`, not only dots; anything else (including the empty string) is `E-LAKE-BAD-NAME`. A version token is
never otherwise interpreted. Names that begin with a dot are never records (a file being transferred is never returned).

Exit codes. 0 when the answer is a value or an absence. 2 when the answer is a refusal (it is still printed on standard
output), and 2 when the question itself is malformed: then nothing is printed on standard output and one line
`bench-lake: <message>` is printed on standard error. A question is malformed when: the word is unknown, the number of
arguments is wrong, a record name is unknown, a story does not match `^-?[0-9]+$`, an id is empty.

## 2. Canonical JSON

One JSON document and one line feed, on standard output. Objects have their keys sorted by the UTF-8 bytes of the key
(which equals the order of Unicode code points); there is no whitespace outside strings; the text is UTF-8 and is not
escaped except where JSON requires it. Strings: `"` and `\` are escaped as `\"` and `\\`; the control characters
U+0008, U+0009, U+000A, U+000C, U+000D as `\b \t \n \f \r`; every other character below U+0020 as `\u00xx` with
lower-case hex; U+007F and everything above is written as itself. A key that occurs twice in an input file keeps the last
value.

Numbers (they appear in parsed records). An integer token (no `.`, `e`, `E`) that fits a signed or unsigned 64-bit integer
is printed as its decimal digits (no leading zeros are possible in JSON). Any other number is read as an IEEE double and
printed with the shortest digits that read back to the same double, in this form: if 1e-5 <= |x| < 1e16 positional notation,
with `.0` appended when the value is an integer; otherwise scientific notation `d[.ddd]e<sign>N` with the exponent sign
`+` or `-` and no leading zeros in the exponent (`1e+16`, `1.5e-7`, `1.8446744073709552e+19`). The token `-0` is the
double -0.0 and is printed `-0.0`. `NaN`, `Infinity` and a number that does not fit a double are not JSON and make the
record malformed. A parsed record is read from the bytes as strict UTF-8 JSON: a byte order mark, a trailing comma, a
comment, or text after the document makes it malformed; an invalid UTF-8 byte makes it malformed.

A *payload* (a record or a log) is never printed in full. It is printed as its `length` in bytes (of the file for a record,
of the decoded stream for a log) and the lower-case hex `sha256` of those bytes. A structured record also prints its parsed
`value`; a text record prints its text (strict UTF-8, otherwise the record is malformed) as `value`.

Every answer has `"status"`: `"found"`, `"absent"` or `"refused"`.

## 3. Absence and refusal

An absence is printed as

    {"absent":{"code":C,"detail":D,"item":I,"node":N,"run":R},"status":"absent"}

and a refusal as

    {"refused":{"code":C,"detail":D,"item":I,"node":N,"run":R},"status":"refused"}

`run` is the run id and `node` the node folder name (`null` for a reference run, or when no run was found).
`item` is what was asked for:

| Item | Text |
|---|---|
| the run | `run` |
| a record | `record:<name>` followed by `:<arg>` for each argument, with a story printed as a decimal integer: `record:metrics`, `record:accept:1`, `record:rescore-accept:v1:1`, `record:accept:1000` |
| the version list of `rescore/` | `record:rescore-versions` |
| a log | `log:<story>` |
| the bundle | `bundle` |
| a working copy | `workspace:<story>` |

`code` and `detail`. The detail is a fixed text, the same in both languages. The parser's own message and the operating
system's message are not part of the canonical form.

| Code | Detail | When |
|---|---|---|
| `E-LAKE-NO-RUN` | `no run with this id` | the id (or node and id) names no run |
| `E-LAKE-NOT-COLLECTED` | `no such file` | the file is not there |
| `E-LAKE-NOT-A-FILE` | `not a regular file` | a symbolic link or a folder where a file belongs (or a link in a folder of the path) |
| `E-LAKE-UNREADABLE` | `permission denied` or `io error` | the operating system refused (`permission denied` for EACCES and EPERM, `io error` for anything else) |
| `E-LAKE-MALFORMED` | `not valid JSON`, `not valid UTF-8`, `not valid gzip`, `note is not an object`, `complete is not a boolean`, `no commit for story`, `commit is not 40 hexadecimal characters`, `commit not in bundle` | the file is there but unusable |
| `E-LAKE-BAD-NAME` | `story out of range` or `version not valid` | a story or version that cannot name a file |
| `E-LAKE-DEST-INSIDE-ROOT` | `destination is inside the lake` | refusal: the destination, links resolved, is inside the collected or reference folder |
| `E-LAKE-DEST-NOT-EMPTY` | `destination is not empty` | refusal: the destination exists and is not an empty folder |
| `E-LAKE-GIT-FAILED` | `git clone failed` or `git checkout failed` | refusal: git exited non-zero |

Checks happen in this order and the first that applies decides: bad name (before any file is touched), then the
file system. Text form of an absence (not printed by the command; used in messages): `run=<id> node=<node or -> item=<item> code=<code> detail=<detail>`.

## 4. The questions

All paths in answers are labels relative to the root, never absolute: `collected/<node>/<id>` for a combination run and
`reference/<pack>/<stack>/<run>` for a reference run.

### runs

    {"missing_roots":[...],"rejected":[{"code":C,"path":P},...],"runs":[{"dir":P,"id":ID,"kind":K,"node":N},...],"status":"found"}

`kind` is `"combination"` or `"reference"`; `node` is `null` for a reference run. `runs` is ordered by `id`, then by `node`
(bytes; `null` first). `rejected` is ordered by `path` (bytes). `missing_roots` is `"collected"` and/or `"reference"` for a
root that does not exist, in that order.

How runs are found. The collected root: each entry is a node folder. A file or a symbolic link is rejected
`E-LAKE-NOT-A-FOLDER`; a node name that breaks the part rule is `E-LAKE-BAD-PART`. Inside a node folder only the folder
`combinations` is walked; any other entry is `E-LAKE-STRAY` (a symbolic link named `combinations` is `E-LAKE-NOT-A-FOLDER`).
Below `combinations` the walk is exactly nine levels: family, version, variant, os, machine, engine-client, the literal
`benchmarks`, pack, run. The reference root is walked exactly three levels: pack, stack, run. Symbolic links are never
followed. At each level an entry that is a file or a link is `E-LAKE-NOT-A-FOLDER`; a name that breaks the part rule is
`E-LAKE-BAD-PART`; the seventh level must be the literal `benchmarks` and the sixth must contain a `-`, otherwise
`E-LAKE-BAD-PART`; an empty folder above run depth is `E-LAKE-SHALLOW` (the path is that folder); a folder that cannot be listed is
`E-LAKE-UNREADABLE`. A folder at run depth is a run if `collection.json` or `run.json` in it is a regular file, otherwise it is
rejected `E-LAKE-NO-MARKER`. A run folder is not walked into. The part rule: 1 to 64 characters of `[A-Za-z0-9._-]`, not
only dots. Rejected codes in the `runs` answer are therefore: `E-LAKE-NOT-A-FOLDER`, `E-LAKE-STRAY`, `E-LAKE-SHALLOW`,
`E-LAKE-BAD-PART`, `E-LAKE-NO-MARKER`, `E-LAKE-UNREADABLE`. (These codes appear only in `rejected`, never in an absence.)

The checks on one entry run in this order and the first that applies decides: not a folder, part rule (and the literal
or dash rule of its level), then (by level) stray / shallow / unreadable / no marker.

Example (the whole fixture lake):

```example
$ bench-lake <LAKE> runs
{"missing_roots":[],"rejected":[],"runs":[{"dir":"reference/todoodle/opus-5.5/run-1","id":"benchmarks/reference/todoodle/opus-5.5/run-1","kind":"reference","node":null},{"dir":"reference/vidi/sonnet-5.5/v2-r1","id":"benchmarks/reference/vidi/sonnet-5.5/v2-r1","kind":"reference","node":null},{"dir":"collected/gruntus/combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","id":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","kind":"combination","node":"gruntus"},{"dir":"collected/quintus/combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","id":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","kind":"combination","node":"quintus"},{"dir":"collected/tritus/combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","id":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","kind":"combination","node":"tritus"},{"dir":"collected/gruntus/combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2","id":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2","kind":"combination","node":"gruntus"},{"dir":"collected/gruntus/combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1","id":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1","kind":"combination","node":"gruntus"},{"dir":"collected/tritus/combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1","id":"combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1","kind":"combination","node":"tritus"}],"status":"found"}
```


### copies `<id>`

    {"copies":[RunRef,...],"status":"found"}

`RunRef` is `{"dir":P,"id":ID,"kind":K,"node":N}`. The copies are ordered by node (bytes). An id with no run is an empty
list, not an absence. `copies` takes an id, not `node@id`.

```example
$ bench-lake <LAKE> copies combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2
{"copies":[{"dir":"collected/gruntus/combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","id":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","kind":"combination","node":"gruntus"},{"dir":"collected/quintus/combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","id":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","kind":"combination","node":"quintus"},{"dir":"collected/tritus/combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","id":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","kind":"combination","node":"tritus"}],"status":"found"}
```



### preferred `<id>`

    {"preferred":RunRef,"status":"found"}

or the absence `E-LAKE-NO-RUN`. The ranking, in this order: a copy with a collection note ranks above one without; a copy
whose note says `complete` true above one that says false; more entries in the note's `files` object; the larger
`settled_at` (a missing or non-numeric one is lowest); the smaller node name (bytes). A note that cannot be read or parsed
counts as no note.

```example
$ bench-lake <LAKE> preferred combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2
{"preferred":{"dir":"collected/gruntus/combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","id":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","kind":"combination","node":"gruntus"},"status":"found"}
```



### record `<run> <name> [args]`

    {"length":N,"node":N,"run":ID,"sha256":HEX,"status":"found","value":V}

`value` is the parsed JSON for a json record and the text for `prompt` and `base-commit`. Absences: `E-LAKE-BAD-NAME`,
`E-LAKE-NOT-COLLECTED`, `E-LAKE-NOT-A-FILE`, `E-LAKE-UNREADABLE`, `E-LAKE-MALFORMED` (a json record that does not parse, or
a text record that is not UTF-8; the length and hash are then not printed), `E-LAKE-NO-RUN`. A folder in the path of the
record that is a symbolic link makes the record `E-LAKE-NOT-A-FILE`.

```example
$ bench-lake <LAKE> record combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1 status
{"length":164,"node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1","sha256":"9b61c0b048dca355d1cc3907e87d2026c2203c13851e70d32ceed4177a9de962","status":"found","value":{"at":"2026-10-03T06:45:06Z","host":"13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB","reason":"","state":"finished"}}
```


```example
$ bench-lake <LAKE> record combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1 accept 1
{"length":308,"node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1","sha256":"f150c3e8964dd324d32d1c4b8ff7b06cb7717ff3a8c0c4fabf7515dbdcb75b7a","status":"found","value":{"build_exit":0,"by_story":{"01":{"passed":6,"total":6}},"harness_fault":null,"on_partial":{"passed":0,"total":0},"passed":6,"runner_exit":0,"setup_fallbacks":{"by_owner":{},"tests":0},"skipped":false,"total":6}}
```


```example
$ bench-lake <LAKE> record combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1 base-commit 1
{"length":40,"node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1","sha256":"9e38c0cc8d92434d7caa330975512b0c28915d09179527b6a14d226757b5bd3b","status":"found","value":"30816ab716043c8a400ee0e43b0e7f8b3438a3ea"}
```


```example
$ bench-lake <LAKE> record benchmarks/reference/todoodle/opus-5.5/run-1 status
{"length":387,"node":null,"run":"benchmarks/reference/todoodle/opus-5.5/run-1","sha256":"aec0b21afc7d0389c21c144a29b8b14cd2020772a019f7aac1bcc5f3c73dd2b1","status":"found","value":{"at":"2026-09-27T00:15:34Z","host":"Apple M2 16GB","reason":"exit 1: return io.open(self, mode, buffering, encoding, errors, newline) ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ FileNotFoundError: [Errno 2] No such file or directory: '~/.spec-bench/awesome-local-ai/benchmarks/todoodle/spec/stories/009-cut-off-anyone-who-has-an-old-li","state":"failed"}}
```


```example
$ bench-lake <LAKE> record combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2 metrics
{"absent":{"code":"E-LAKE-NOT-COLLECTED","detail":"no such file","item":"record:metrics","node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2"},"status":"absent"}
```


```example
$ bench-lake <LAKE> record combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1 accept 1000
{"absent":{"code":"E-LAKE-BAD-NAME","detail":"story out of range","item":"record:accept:1000","node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1"},"status":"absent"}
```


```example
$ bench-lake <LAKE> record combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1 rescore ..
{"absent":{"code":"E-LAKE-BAD-NAME","detail":"version not valid","item":"record:rescore:..","node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1"},"status":"absent"}
```


```example
$ bench-lake <LAKE> preferred combinations/no/such/run
{"absent":{"code":"E-LAKE-NO-RUN","detail":"no run with this id","item":"run","node":null,"run":"combinations/no/such/run"},"status":"absent"}
```



### log `<run> <story>`

    {"form":"raw"|"compact","length":N,"lines":N,"node":N,"run":ID,"sha256":HEX,"status":"found","story":S}

The raw log `stories/S/agent-events.jsonl` is used when it is a regular file; otherwise the compacted log
`stories/S/agent-events.compact.jsonl.gz` when that is a regular file (gzip, possibly several members, decoded);
otherwise if either is a link or folder `E-LAKE-NOT-A-FILE`; otherwise `E-LAKE-NOT-COLLECTED`. `length` and `sha256` are of the
decoded bytes. `lines` is the number of lines: the bytes are split at each line feed (U+000A, nothing else), a final piece
after the last line feed is a line only if it is not empty, so an empty stream has 0 lines and `a\nb` has 2. If the stream
cannot be decoded to its end (a damaged gzip file) the answer is the absence `E-LAKE-MALFORMED` (`not valid gzip`) with
item `log:S`; if reading fails the operating system's `E-LAKE-UNREADABLE`.

```example
$ bench-lake <LAKE> log combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1 1
{"form":"raw","length":20512,"lines":20,"node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1","sha256":"09d5ed00ca140e000ce37c67431902ec1ce67e14ad668bafc8347abbb5ea2a12","status":"found","story":1}
```


```example
$ bench-lake <LAKE> log combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2 1
{"form":"compact","length":3869372,"lines":2522,"node":"gruntus","run":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","sha256":"f65e73473d0ea44f5ec38f8a1fa768347977281cb7113134fd6e87abd699f2f2","status":"found","story":1}
```


```example
$ bench-lake <LAKE> log combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1 2
{"absent":{"code":"E-LAKE-NOT-COLLECTED","detail":"no such file","item":"log:2","node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1"},"status":"absent"}
```



### workspace `<run> <story> <dest>`

    {"commit":HEX40,"node":N,"path":DEST,"run":ID,"status":"found","story":S}

`path` is `<dest>` exactly as given on the command line. The working copy is made by `git clone --no-checkout` of the
run's `workspace.bundle` and `git checkout --detach <commit>`, where the commit is `stories.<S>.commit` of the run's
`metrics.json` (S as a plain decimal key). Checks in order: story range (`E-LAKE-BAD-NAME`, item `workspace:S`); destination
inside a root or not empty (refusals, exit 2); the bundle (absence, item `bundle`: `E-LAKE-NOT-COLLECTED`, `E-LAKE-NOT-A-FILE`);
then the metrics and the commit (absences with item `workspace:S`: the metrics record missing is `E-LAKE-NOT-COLLECTED`,
unusable metrics are those of the metrics record, a story without a commit or a commit that is not 40 hexadecimal
characters or not in the bundle is `E-LAKE-MALFORMED`); then git (refusal `E-LAKE-GIT-FAILED`).

```example
$ bench-lake <LAKE> workspace combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2 1 <DEST>
{"commit":"59a592fca04af9fe2c8b667b3a784298795ccde9","node":"gruntus","path":"<DEST>","run":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2","status":"found","story":1}
```


```example
$ bench-lake <LAKE> workspace combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2 1 <NONEMPTY-DEST>
{"refused":{"code":"E-LAKE-DEST-NOT-EMPTY","detail":"destination is not empty","item":"workspace:1","node":"gruntus","run":"combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2"},"status":"refused"}
```


```example
$ bench-lake <LAKE> workspace combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1 1 <DEST>
{"absent":{"code":"E-LAKE-NOT-COLLECTED","detail":"no such file","item":"bundle","node":"tritus","run":"combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1"},"status":"absent"}
```



### complete `<run>`

    {"collected_at":T,"completeness":"complete"|"incomplete"|"no-note","node":N,"run":ID,"settled_at":T,"state":S,"status":"found"}

Only `collection.json` is read. `completeness` is `complete` when the note's `complete` is true, `incomplete` when false,
`no-note` when the note does not exist (then the other three are `null`). `state` is the note's `run_status.state` when it
is a string, otherwise `null`. `settled_at` and `collected_at` are the note's numbers (printed as in section 2), otherwise
`null`. A note that is not a JSON object is `E-LAKE-MALFORMED` (`note is not an object`), one without a boolean `complete` is
`E-LAKE-MALFORMED` (`complete is not a boolean`), invalid JSON or UTF-8 as in a record; a link or folder in its place is
`E-LAKE-NOT-A-FILE`; the item of these absences is `record:collection`.

```example
$ bench-lake <LAKE> complete combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1
{"collected_at":1792160967,"completeness":"complete","node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1","settled_at":1792116937,"state":"finished","status":"found"}
```


```example
$ bench-lake <LAKE> complete combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2
{"collected_at":1792161516,"completeness":"incomplete","node":"gruntus","run":"combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2","settled_at":null,"state":null,"status":"found"}
```


```example
$ bench-lake <LAKE> complete benchmarks/reference/todoodle/opus-5.5/run-1
{"collected_at":null,"completeness":"no-note","node":null,"run":"benchmarks/reference/todoodle/opus-5.5/run-1","settled_at":null,"state":null,"status":"found"}
```

59a592fca04af9fe2c8b667b3a784298795ccde9

