# Three held-out tests, and the requirements behind them

**These examples are invented.** They are not from the benchmark's held-out suite, which is private and stays
private: no requirement it tests, no wording it asserts and no threshold it uses appears here. They are written to
show the *shape* of a held-out test — what it checks, and what it can only approach sideways — in a domain the
benchmark does not use.

A held-out test is written against one requirement of a spec and never shown to the agent building from that spec.
The agent sees the spec; the suite scores the build. Each test names the requirement it is written against, so a
failure points at a line of the spec rather than at a test.

The examples below are from an invented expense-claims app.

## 1. A cap enforced as you type

**The requirement**, anchor `claim.note_limit`:

> IF typing or pasting would make a receipt note longer than 240 characters THEN THE SYSTEM SHALL NOT add the
> characters beyond 240.
>
> Verification: paste 300 characters into an empty note; the note holds exactly the first 240 and the counter shows
> 240/240.

**The test**, *"pasting over the limit keeps exactly 240 characters"*: open a claim, write 300 characters to the
clipboard, paste, assert the counter reads `240/240`, move focus away, then count the characters actually stored.

**What it tests.** A numeric boundary enforced at the point of entry rather than on save, together with the
indicator the requirement names. It checks both halves: what is kept and what is shown. An app that truncates
silently fails it, and so does one that shows the right counter while storing all 300 characters.

## 2. A property the test can only approach sideways

**The requirement**, anchor `claim.reference_unguessable`:

> THE SYSTEM SHALL give every claim a reference containing at least 96 bits of randomness, and THE SYSTEM SHALL NOT
> derive a reference from submission order, time, or the claimant.

**The test**, *"distinct 16-character references"*: submit four claims; assert the four references differ and each
is 16 characters.

**What it tests.** Deliberately less than the requirement asks. Entropy is not observable through a browser, so the
test checks the consequences that are: a fixed length, and no repeats. It catches sequential references or a
hardcoded one. It would not catch a weak random source.

This is worth stating plainly, because it is true of every suite of this kind: a held-out test is the strongest
*observable* shadow of a requirement, not the requirement itself. Where the two differ, the spec is the contract and
the test is the evidence that can be gathered.

## 3. A negative requirement, in fixed words

**The requirement**, anchor `claim.unknown_reference`:

> WHEN a person opens a claim reference that does not exist, or is malformed, THE SYSTEM SHALL show the Claim not
> found page with a Start a claim button, and THE SYSTEM SHALL NOT create a claim at that reference.

**The test**, *"unknown or malformed reference shows Claim not found and creates nothing"*: visit a
well-formed-but-unknown reference and a malformed one; assert the heading, the exact sentence "Check the reference,
or ask whoever sent it to send it again.", and a **Start a claim** button; then visit the first reference again and
assert it still says Claim not found.

**What it tests.** Two classes of input through one rule, the wording the requirement fixes, and a negative
requirement. The revisit is the whole point of the second half: it is what proves the first visit did not quietly
create a claim. A negative cannot be tested by looking once.

## What these three have in common

- **Each names its requirement.** A test that cannot say which line of the spec it comes from cannot tell you
  whether a failure is the build's fault or the suite's.
- **The exact wording is part of the contract.** Where a spec fixes a button's label or a sentence of help text, the
  test asserts it verbatim. That makes the suite brittle in exactly the way the spec is precise — and it means a
  change to the spec's wording is a change to the suite.
- **Some requirements can only be approximated.** Saying so in the test's own terms is better than pretending the
  test proves more than it does.
