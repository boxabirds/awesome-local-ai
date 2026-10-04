/**
 * Story 8 unit tests — the typing capture window.
 *
 * Yjs decides whether to merge a change into the current undo step by comparing
 * its own clock against the last captured change. That clock is
 * `getUnixTime` from `lib0/time`; the tests replace it with a counter they can
 * move on purpose, so the merge boundary is tested at exact milliseconds rather
 * than against wall-clock sleeps. (The unit Vitest project inlines `lib0`/`yjs`
 * so this mock reaches the copy Yjs actually imports.)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

const clock = vi.hoisted(() => ({ now: 10_000 }));
vi.mock('lib0/time', () => ({ getUnixTime: () => clock.now }));

const { createUndo } = await import('../../src/client/board/undo');
const { createSticky, getStickyText, snapshot, LOCAL_ORIGIN } = await import('../../src/shared/board-model');
const { UNDO_CAPTURE_TIMEOUT_MS } = await import('../../src/shared/config');

/** A sticky with an empty text; returns the doc and the note's id. */
function freshNote(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 0, y: 0 });
  return { doc, id };
}

function typeString(doc: Y.Doc, id: string, text: string): void {
  doc.transact(() => getStickyText(doc, id)?.insert(0, text), LOCAL_ORIGIN);
}

function currentText(doc: Y.Doc, id: string): string {
  return (snapshot(doc) as readonly { id: string; text: string }[]).find((n) => n.id === id)?.text ?? '';
}

beforeEach(() => {
  clock.now = 10_000;
});

describe('undo typing capture window (undo.typing)', () => {
  it('TC-12: a burst of inserts inside the window is one step, undone whole', () => {
    const { doc, id } = freshNote();
    const undo = createUndo(doc);
    undo.boundary();

    typeString(doc, id, 'a');
    clock.now += 100;
    typeString(doc, id, 'b');
    clock.now += 100;
    typeString(doc, id, 'c');
    clock.now += 100;

    undo.boundary(); // editing session ends
    expect(currentText(doc, id)).toBe('cba');

    expect(undo.undo()).toBe(true); // the whole burst, in one step
    expect(currentText(doc, id)).toBe('');
    undo.destroy();
  });

  it('TC-13: a pause of exactly the timeout makes a new step; one ms less merges', () => {
    // Exactly UNDO_CAPTURE_TIMEOUT_MS apart -> two separate steps.
    {
      const { doc, id } = freshNote();
      const undo = createUndo(doc);
      undo.boundary();
      typeString(doc, id, 'a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS;
      typeString(doc, id, 'b');
      undo.boundary();

      expect(undo.undo()).toBe(true);
      expect(currentText(doc, id)).toBe('a'); // only the second burst undone
      undo.destroy();
    }
    // One ms short of the timeout -> one merged step.
    {
      const { doc, id } = freshNote();
      const undo = createUndo(doc);
      undo.boundary();
      typeString(doc, id, 'a');
      clock.now += UNDO_CAPTURE_TIMEOUT_MS - 1;
      typeString(doc, id, 'b');
      undo.boundary();

      expect(undo.undo()).toBe(true);
      expect(currentText(doc, id)).toBe(''); // both undone together
      undo.destroy();
    }
  });

  it('boundary() on an empty history is a no-op and does not throw', () => {
    const { doc } = freshNote();
    const undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    undo.destroy();
  });
});
