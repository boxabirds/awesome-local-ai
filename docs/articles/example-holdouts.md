# Three held-out tests, and the requirements behind them

**These examples are invented.** They are not from the benchmark's held-out suite, which is private and stays
private: no requirement it tests, no wording it asserts and no threshold it uses appears here. They are written in
the form the real ones take, in a domain the benchmark does not use, so the shape is honest even though the content
is made up.

## What a held-out test is

A held-out test is written against **a requirement the agent already has**. It adds nothing to the spec. The agent
is given the whole spec and builds from it; the suite then scores the build. What is held back is only *which*
requirements are checked and *how* they are checked — never what the app is supposed to do.

In the benchmark's own vidi pack the proportions are: the spec declares 287 requirements, and the held-out suite
tests 77 of them. The agent cannot know which 77.

Each test names its requirement in its title, as `@ref prd:<anchor>`, where the anchor is the one the spec itself
prints beside the requirement. A failing test therefore points at a line of the spec rather than at a test.

The examples below are from an invented expense-claims app.

## The file they live in

Tests for one story live in one file, built on shared fixtures. `requires(n)` skips the file unless the agent
reached story *n*, so a suite run against a half-built app reports "not attempted" rather than a wall of failures.
Thresholds are named constants, never bare numbers in an assertion.

```ts
// Story 4 — Submit an expense claim.
import { test, expect, requires, openClaim, submitClaim, notes, shot } from './fixtures';

const NOTE_LIMIT = 240;
const PASTED_LENGTH = 300;
const REFERENCE_LENGTH = 16;
const UNKNOWN_REFERENCE = 'ZZZZZZZZZZZZZZZZ';

test.describe('story 4 @s04', () => {
  test.beforeEach(() => requires(4));
```

## 1. A cap enforced as you type

**The requirement**, anchor `claim.note_limit`:

> IF typing or pasting would make a receipt note longer than 240 characters THEN THE SYSTEM SHALL NOT add the
> characters beyond 240.
>
> Verification: paste 300 characters into an empty note; the note holds exactly the first 240 and the counter shows
> 240/240.

```ts
  test('pasting over the limit keeps exactly 240 characters @ref prd:claim.note_limit', async ({ page }) => {
    await openClaim(page);
    const long = 'x'.repeat(PASTED_LENGTH);
    await page.evaluate((t) => navigator.clipboard.writeText(t), long);
    await page.getByRole('textbox', { name: 'Receipt note' }).click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
    await expect(page.getByText(`${NOTE_LIMIT}/${NOTE_LIMIT}`)).toBeVisible();
    await page.keyboard.press('Escape');
    const text = await notes(page).first().innerText();
    expect(text.replace(/[^x]/g, '').length).toBe(NOTE_LIMIT);
  });
```

**What it tests.** A numeric boundary enforced at the point of entry rather than on save, together with the counter
the requirement names. It checks both halves: what is shown, and — after the field loses focus — what was actually
kept. An app that truncates silently fails it, and so does one that shows `240/240` while storing all 300
characters.

## 2. A property the test can only approach sideways

**The requirement**, anchor `claim.reference_unguessable`:

> THE SYSTEM SHALL give every claim a reference containing at least 96 bits of randomness, and THE SYSTEM SHALL NOT
> derive a reference from submission order, time, or the claimant.

```ts
  test(`distinct ${REFERENCE_LENGTH}-character references @ref prd:claim.reference_unguessable`, async ({ page }) => {
    const seen = new Set<string>();
    const CLAIMS = 4;
    for (let i = 0; i < CLAIMS; i++) {
      const reference = await submitClaim(page);
      expect(reference).toHaveLength(REFERENCE_LENGTH);
      seen.add(reference);
    }
    expect(seen.size).toBe(CLAIMS);
  });
```

**What it tests.** Deliberately less than the requirement asks. Entropy is not observable through a browser, so the
test checks the consequences that are: a fixed length, and no repeats across four submissions. It catches
sequential references, or a hardcoded one. It would not catch a weak random source.

This is worth stating plainly, because it is true of every suite of this kind: a held-out test is the strongest
*observable* shadow of a requirement, not the requirement itself. Where the two differ, the spec is the contract and
the test is the evidence that can be gathered through a browser.

## 3. A negative requirement, in fixed words

**The requirement**, anchor `claim.unknown_reference`:

> WHEN a person opens a claim reference that does not exist, or is malformed, THE SYSTEM SHALL show the Claim not
> found page with a Start a claim button, and THE SYSTEM SHALL NOT create a claim at that reference.

```ts
  test('unknown or malformed reference shows Claim not found and creates nothing @ref prd:claim.unknown_reference',
    async ({ page }) => {
      for (const bad of [`/c/${UNKNOWN_REFERENCE}`, '/c/nope']) {
        await page.goto(bad);
        await expect(page.getByRole('heading', { name: 'Claim not found' })).toBeVisible();
        await expect(page.getByText('Check the reference, or ask whoever sent it to send it again.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Start a claim' })).toBeVisible();
      }
      await shot(page, 's04-not-found');
      await page.goto(`/c/${UNKNOWN_REFERENCE}`);
      await expect(page.getByRole('heading', { name: 'Claim not found' })).toBeVisible();
    });
});
```

**What it tests.** Two classes of input through one rule, the wording the requirement fixes, and a negative
requirement. The second visit is the whole point of the last two lines: it is what proves the first visit did not
quietly create a claim at that reference. A negative cannot be tested by looking once.

## What these three have in common

- **Each names its requirement.** A test that cannot say which line of the spec it comes from cannot tell you
  whether a failure is the build's fault or the suite's.
- **They find things the way a person would.** Assertions go through roles and visible text — a heading, a button's
  name, a sentence — not through class names or test ids, which the spec does not fix and the agent is free to
  choose.
- **The exact wording is part of the contract.** Where a spec fixes a button's label or a sentence of help text, the
  test asserts it verbatim. That makes the suite brittle in exactly the way the spec is precise, and it means a
  change to the spec's wording is a change to the suite.
- **Thresholds are named, not inlined.** `NOTE_LIMIT`, not `240`, so the number appears once and the assertion reads
  as the rule.
- **Some requirements can only be approximated.** Saying so in the test's own terms is better than pretending the
  test proves more than it does.
