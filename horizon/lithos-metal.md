# Lithos Metal: something for Macs, not yet identified

**Status:** candidate (16 Oct 2026). Added at the owner's request. **Nothing about it has been checked**: not run, not
installed, and no page of its own has been read.
**Kind:** unknown until its page is found. If it is an inference engine for Apple silicon it would be a new engine on
the Mac, and comparable with the other Mac stacks on the same model.
**Where it could run:** the M5 Max (the only Mac we own).

## What it is

The owner added it with the words "Lithos Metal ... something for Macs I think". That is all that is known.

On 16 Oct 2026 two web searches ("Lithos Metal Mac LLM inference" and a second naming Apple silicon and GitHub) found **no
project of that name**. They found other Metal-based engines for Macs, which are listed here only so nobody mistakes them
for it; none is claimed to be the same thing:

- [BaseRT](https://github.com/basecompute/baseRT), a Metal-native runtime ([paper](https://arxiv.org/pdf/2607.00501)).
- Perplexity's Lily, a Metal-kernel local runtime for Apple silicon.
- [Tessery](https://pypi.org/project/tessery/), an Apache-2.0 engine with its own Objective-C++ Metal runtime.

The name may be spelled differently, be very new, or not be indexed yet.

## Checks before anything else

1. **Find its page.** A link from the owner, or the exact repository name. Until then the rest of this note cannot be
   written: its licence, what it runs, which models and quantisations, whether it serves an API.
2. Then the checks every engine gets: it installs and serves on the M5 Max at 131,072 tokens of context; a tool call with
   arguments that carry raw newlines, with `tools/engine-probe/basic-capability.py`; prompt reuse on a long conversation
   (a second request must report a cached prefix); a version pin.
3. Then the ten-minute smoke rule, a queued series, and watch story 1.

## Confounds

Cannot be listed before it is identified.

**Last checked:** 16 Oct 2026, by two searches that found nothing of that name.
**Recheck when:** the owner gives a link or the exact name.
