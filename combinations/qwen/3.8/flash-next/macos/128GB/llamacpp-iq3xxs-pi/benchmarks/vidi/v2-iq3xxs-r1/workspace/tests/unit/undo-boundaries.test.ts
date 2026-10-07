import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import type { UndoController } from '../../src/client/board/undo';
import type { NoteSpec } from './undo-fixture';

/**
 * Story 8 — typing bursts (undo.boundaries, unit half).
 *
 * TC-12 and TC-13 move the clock by hand (design "Mock vs real boundaries": the
 * capture timeout is tested with a fake system time), because a burst is defined by
 * the *pause* between keystrokes, not by how many there were.
 *
 * The clock is stopped before yjs is loaded, and yjs is loaded afterwards on purpose:
 * lib0 takes `Date.now` by value when its module is evaluated, so a history built
 * from an `import` that ran first would keep measuring the real wall clock and every
 * burst would look like one step.
 */

const CLOCK_START = 1_000_000;

vi.useFakeTimers({ now: CLOCK_START, toFake: ['Date'] });

const { Doc } = await import('yjs');
const { getStickyText, initDoc, LOCAL_ORIGIN } = await import('../../src/shared/board-model');
const { STICKY_SIZE_WORLD, UNDO_CAPTURE_TIMEOUT_MS } = await import('../../src/shared/config');
const { createUndo } = await import('../../src/client/board/undo');
const { seed } = await import('./undo-fixture');

let doc: Y.Doc;
let ctrl: UndoController;
let text: Y.Text;

/** A note whose text starts out empty — what the editor opens on. */
const BLANK: NoteSpec = { x: 0, y: 0, color: 'yellow', width: STICKY_SIZE_WORLD, height: STICKY_SIZE_WORLD };

beforeEach(() => {
  vi.setSystemTime(CLOCK_START);
  doc = new Doc();
  initDoc(doc);
  const [id] = seed(doc, [BLANK]);
  text = getStickyText(doc, id!)!;
  expect(text.toString()).toBe('');
  ctrl = createUndo(doc);
});

afterEach(() => {
  ctrl.destroy();
  doc.destroy();
});

afterAll(() => {
  vi.useRealTimers();
});

/** One keystroke, as the editor writes it: its own transaction, this tab's origin. */
function type(ch: string): void {
  doc.transact(() => text.insert(text.length, ch), LOCAL_ORIGIN);
}

/** Wait `ms` before the next keystroke. */
function wait(ms: number): void {
  vi.advanceTimersByTime(ms);
}

describe('undo.boundaries — typing bursts', () => {
  // TC-12: keystrokes 100 ms apart inside one edit are a single step.
  it('TC-12 merges keystrokes 100 ms apart into one step', () => {
    ctrl.boundary();
    type('h');
    wait(100);
    type('e');
    wait(100);
    type('l');
    wait(100);
    type('l');
    wait(100);
    type('o');
    ctrl.boundary();

    expect(text.toString()).toBe('hello');
    expect(ctrl.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // One step, so the history is already empty.
    expect(ctrl.canUndo()).toBe(false);
  });

  // TC-13: a pause of exactly the timeout splits the burst; one millisecond less does not.
  it('TC-13 splits a burst at exactly UNDO_CAPTURE_TIMEOUT_MS of quiet', () => {
    const captureMs = UNDO_CAPTURE_TIMEOUT_MS;
    ctrl.boundary();
    type('a');
    wait(captureMs - 1);
    type('b');
    ctrl.boundary();
    expect(ctrl.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(ctrl.canUndo()).toBe(false);

    ctrl.boundary();
    type('c');
    wait(captureMs);
    type('d');
    ctrl.boundary();
    expect(text.toString()).toBe('cd');

    expect(ctrl.undo()).toBe(true);
    expect(text.toString()).toBe('c');
    expect(ctrl.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(ctrl.canUndo()).toBe(false);
  });

  // Error path: a boundary with nothing behind it changes nothing.
  it('leaves an empty history empty when a boundary is called', () => {
    expect(() => ctrl.boundary()).not.toThrow();
    expect(ctrl.canUndo()).toBe(false);
    expect(ctrl.canRedo()).toBe(false);
    expect(ctrl.undo()).toBe(false);
    expect(ctrl.redo()).toBe(false);
  });
});
