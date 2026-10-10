import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD, UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

/**
 * Story 8, `undo.boundaries` (TC-12, TC-13): the capture window.
 *
 * Typing is grouped by time alone - `UNDO_CAPTURE_TIMEOUT_MS` of quiet ends a
 * step - so these tests measure real pauses. A timer never fires early, which
 * makes "at least the timeout" easy; "one millisecond less" is re-measured until
 * the clock agrees the pause stayed under the boundary, because a busy machine
 * can delay a timer past it (that would be a measurement problem, not a bug in
 * the capture window).
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A board holding one note, and a history watching it. */
function noteWithHistory(): { doc: Y.Doc; ytext: Y.Text; undo: UndoController } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(
    doc,
    { x: 100 + STICKY_SIZE_WORLD / 2, y: 100 + STICKY_SIZE_WORLD / 2 },
    'yellow',
  );
  const ytext = getStickyText(doc, id)!;
  return { doc, ytext, undo: createUndo(doc) };
}

/** Type `text` one character at a time, as a person editing would. */
function type(ytext: Y.Text, text: string): void {
  for (const char of text) {
    ytext.doc!.transact(() => {
      ytext.insert(ytext.length, char);
    }, LOCAL_ORIGIN);
  }
}

/** How many undo presses do something. */
function pressUntilEmpty(undo: UndoController, limit = 20): number {
  let presses = 0;
  while (presses < limit && undo.undo()) {
    presses += 1;
  }
  return presses;
}

/**
 * Type a burst, pause `ms`, type one more character, and report both the pause
 * the clock actually measured and how many undo steps the typing left behind.
 */
async function stepsAfterPause(
  pauseMs: number,
  burst = 'draft',
  after = '!',
): Promise<{ gap: number; steps: number; text: string }> {
  const { ytext, undo } = noteWithHistory();
  undo.boundary();
  type(ytext, burst);
  const started = Date.now();
  await sleep(pauseMs);
  type(ytext, after);
  const gap = Date.now() - started;
  undo.boundary();
  const text = ytext.toString();
  const steps = pressUntilEmpty(undo);
  undo.destroy();
  return { gap, steps, text };
}

describe('undo.boundaries - typing bursts (TC-12, TC-13)', () => {
  it('TC-12 typing that never pauses long is one undo step', async () => {
    const { ytext, undo } = noteWithHistory();

    undo.boundary();
    for (const char of 'Faster onboarding') {
      type(ytext, char);
      await sleep(20); // a keystroke pause, far under the timeout
    }
    undo.boundary();

    expect(ytext.toString()).toBe('Faster onboarding');
    expect(pressUntilEmpty(undo)).toBe(1);
    // The whole burst went back, not one character at a time.
    expect(ytext.toString()).toBe('');
    undo.destroy();
  });

  it('TC-13 a pause of the timeout starts a new step, a shorter one does not', async () => {
    // The sleeps are taken a little over and a little under `UNDO_CAPTURE_TIMEOUT_MS`
    // and the pause they actually produced is measured: a wall clock read to the
    // millisecond cannot be hit exactly, and both this test and Yjs read the same
    // clock, so the measured pause is what the boundary is checked against.
    const over = await stepsAfterPause(UNDO_CAPTURE_TIMEOUT_MS + 20);
    expect(over.gap).toBeGreaterThanOrEqual(UNDO_CAPTURE_TIMEOUT_MS);
    expect(over.text).toBe('draft!');
    expect(over.steps).toBe(2);

    let under = await stepsAfterPause(UNDO_CAPTURE_TIMEOUT_MS - 20);
    for (let attempt = 0; attempt < 5 && under.gap >= UNDO_CAPTURE_TIMEOUT_MS - 1; attempt += 1) {
      under = await stepsAfterPause(UNDO_CAPTURE_TIMEOUT_MS - 20);
    }
    expect(under.gap).toBeLessThan(UNDO_CAPTURE_TIMEOUT_MS);
    expect(under.text).toBe('draft!');
    expect(under.steps).toBe(1);
  });

  it('the pause is measured between writes: a burst interrupted by the timeout is two steps', async () => {
    const { ytext, undo } = noteWithHistory();

    undo.boundary();
    type(ytext, 'one');
    await sleep(UNDO_CAPTURE_TIMEOUT_MS + 50);
    type(ytext, 'two');
    undo.boundary();

    expect(ytext.toString()).toBe('onetwo');
    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('one');
    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(undo.undo()).toBe(false);
    undo.destroy();
  });

  it('closing an empty capture window does nothing and costs nothing', () => {
    const { ytext, undo } = noteWithHistory();

    expect(() => undo.boundary()).not.toThrow();
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);

    // The window still opens for the next change.
    type(ytext, 'still works');
    undo.boundary();
    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    undo.destroy();
  });

  it('a boundary cuts a burst in half, however short the pause was', () => {
    const { ytext, undo } = noteWithHistory();

    undo.boundary();
    type(ytext, 'first');
    undo.boundary();
    type(ytext, ' second');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('first');
    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(undo.undo()).toBe(false);
    undo.destroy();
  });

  it('the capture window and the step limit are settings, not constants baked in', () => {
    const { ytext, undo } = noteWithHistory();
    // A controller built with no room to merge: two keystrokes are two steps.
    const strict = createUndo(ytext.doc!, { captureTimeoutMs: 0 });
    strict.boundary();
    type(ytext, 'a');
    type(ytext, 'b');
    expect(pressUntilEmpty(strict)).toBe(2);
    strict.destroy();

    // A wide window groups everything typed inside it, however long the burst was.
    const wide = createUndo(ytext.doc!, { captureTimeoutMs: 60_000 });
    wide.boundary();
    type(ytext, 'c');
    type(ytext, 'd');
    expect(wide.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(wide.undo()).toBe(false);
    wide.destroy();
    undo.destroy();
  });
});
