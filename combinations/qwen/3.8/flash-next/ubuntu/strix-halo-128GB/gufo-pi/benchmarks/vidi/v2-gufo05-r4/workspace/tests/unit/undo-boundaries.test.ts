/**
 * Story 8 unit tests for the typing-burst capture window (`undo.boundaries`): TC-12
 * and TC-13 — the boundary values of the typing pause setting. Keystrokes closer
 * together than `UNDO_CAPTURE_TIMEOUT_MS` collapse into one undo step; a pause of
 * exactly that length opens a new one.
 *
 * `Y.UndoManager` measures the capture window against `lib0/time`'s `getUnixTime()`
 * (which is just `Date.now`, captured once at import). A normal fake-timer patch
 * replaces `Date.now` too late for that captured reference, so these tests install a
 * controllable `lib0/time` and move it by exact milliseconds — the only way to prove
 * the boundary is the boundary, not a rounding artefact. Vite runs `yjs` through the
 * module graph for the `unit` project (see `vitest.config.ts`) so the mock reaches the
 * library's own import.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A virtual clock for the library's capture window, hung off `globalThis`: the value
// must exist before the module graph finishes loading, because `lib0/logging` reads
// the time during import — earlier than any test body or `beforeEach` could run. The
// mock seeds it lazily so the first read (during import) already sees a number.
interface UndoClock {
  now: number;
}
// A function declaration is fully hoisted, so the mock factory (which runs during the
// module graph import, before any `const` here is initialised) can safely reach it.
// The clock lives on `globalThis` so both the factory and the tests read one object.
function undoClock(): UndoClock {
  const holder = globalThis as unknown as { __undoClock?: UndoClock };
  return (holder.__undoClock ??= { now: 0 });
}
vi.mock('lib0/time', () => ({
  getUnixTime: () => undoClock().now,
  getDate: () => new Date(undoClock().now),
  humanizeDuration: () => ''
}));

import * as Y from 'yjs';
import { createSticky, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

/** Type one character into a note's shared text, as this client, in its own transaction. */
function typeChar(doc: Y.Doc, text: Y.Text, char: string): void {
  doc.transact(() => text.insert(text.length, char), LOCAL_ORIGIN);
}

function boardWithNote(): { doc: Y.Doc; text: Y.Text; undo: UndoController } {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 0, y: 0 });
  const text = (doc.getMap('objects').get(id) as Y.Map<unknown>).get('text') as Y.Text;
  const undo = createUndo(doc, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS });
  return { doc, text, undo };
}

/** Drain the history, returning how many undo steps it held. */
function drainSteps(undo: UndoController): number {
  let steps = 0;
  while (undo.undo()) steps += 1;
  return steps;
}

let clock: UndoClock;
beforeEach(() => {
  clock = undoClock();
  clock.now = 1_000_000;
});

describe('typing bursts (undo.typing)', () => {
  it('TC-12: a burst typed 100 ms apart, inside one boundary, is a single step', () => {
    const { doc, text, undo } = boardWithNote();

    undo.boundary();
    for (const char of 'hello') {
      typeChar(doc, text, char);
      clock.now += 100;
    }
    undo.boundary();

    expect(drainSteps(undo)).toBe(1);
    expect(text.toString()).toBe('');
  });

  it('TC-13: a pause of exactly the timeout opens a new step; one ms less does not', () => {
    // Exactly UNDO_CAPTURE_TIMEOUT_MS apart → two separate steps.
    {
      const { doc, text, undo } = boardWithNote();
      undo.boundary();
      typeChar(doc, text, 'a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS;
      typeChar(doc, text, 'b');
      undo.boundary();

      expect(drainSteps(undo)).toBe(2);
      expect(text.toString()).toBe('');
    }

    // One millisecond under the timeout → still one merged step.
    {
      const { doc, text, undo } = boardWithNote();
      undo.boundary();
      typeChar(doc, text, 'a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS - 1;
      typeChar(doc, text, 'b');
      undo.boundary();

      expect(drainSteps(undo)).toBe(1);
      expect(text.toString()).toBe('');
    }
  });

  it('boundary on an empty history is a no-op', () => {
    const { undo } = boardWithNote();
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
  });
});
