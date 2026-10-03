# Caveman (a terse-output prompt skill)

**Status:** on the horizon (3 Oct 2026), not run. Assessed from search results only: I have not read the repository's
rules or its benchmark, and none of the numbers below is ours.
**Kind:** not a stack and not an engine: a prompt, loaded as a skill or put in the system prompt, that tells the model to
write tersely. Anything we ran it on would be a new axis on an existing combination (a prompt variant), never a change
to a baseline.
**Sources:** the project, `JuliusBrussee/caveman` on GitHub ("why use many token when few token do trick"), and several
write-ups of it found 3 Oct 2026 (Better Stack, Mantel Group, a 6-line rewrite benchmarked against it). Unverified.

## What it is, as reported

A prompt that rewrites how a model structures its replies: drop articles, pleasantries and hedging, prefer short words,
keep code, paths, API names and error strings exact; arrows for causality. Reported levels: lite (filler and hedging
dropped, full sentences), full (fragments), ultra (maximum compression). Reported savings: up to 75% of output tokens
claimed, about 45% against a plain baseline and 39% against "be terse" in one write-up. For coding agents the same
write-ups say the saving is high single digits, because most output tokens are code and tool calls the skill does not
touch, and quality stayed flat. A proxy by the same author is said to shrink what the agent *reads*, which is where an
agent's tokens mostly go.

## Why it might matter here, and why it may not

- **Our spread is in thinking, not in replies.** Thinking is 42% to 70% of the characters a Qwen model produces, and the
  run-to-run spread is in thinking (docs/research/20261003-thinking-spread.md). Caveman is reported for the *reply*. Whether
  an instruction to be terse reaches a model's thinking is not known from what I read, and for a Qwen model whose
  thinking is a separate stream it may not. This is the first thing to find out.
- **The biggest theme is the one it targets, in spirit.** The largest theme of thinking is weighing and correcting
  itself ("but", "wait", "hmm"), 20% to 24% of all thinking characters; the other large ones are reasoning over the
  design and code drafted in thought. A terse-style instruction could shorten those, or could do nothing to reasoning.
- **A prompt change is a change in what is measured.** It would be a separate series against the baseline, with the same
  n and the same harness release, and the held-out result as the yardstick; shorter thinking that costs held-out tests is
  not a saving. Of the stories' best-result runs, about half already think less than the median, so there is room to
  look for before any prompt is added.

## What would bring it up the list

A cheap first test needs no bench series: take recorded story prompts, add the instruction, and see whether the thinking
text a Qwen model writes changes in length and in theme on a few turns. If it moves the thinking, queue a 5-run series
on one stack (Swift 1.5 on the 4090 is the one with the largest spread) after the baseline, and compare held-out result,
thinking per story and spread. If it does not touch thinking, park it.
