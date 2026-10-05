import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Doc, Map as YMap } from 'yjs';
import type { UndoController } from '../../src/client/board/undo';
import type { Peer } from '../peerDoc';

/**
 * Story 8, `undo.boundaries`: typing bursts.
 *
 * A burst is one undo step because transactions that follow each other within
 * `UNDO_CAPTURE_TIMEOUT_MS` merge, and the pause is a named product setting, so
 * the test has to land exactly on it: `− 1 ms` merges, exactly does not. That
 * needs a clock the test controls.
 *
 * yjs reads the time once, at load (`lib0/time`: `export const getUnixTime =
 * Date.now`), so the fake clock is started *before* yjs, the model and the
 * controller are imported — hence the dynamic imports below. Nothing in this
 * story schedules a timer, so the fake clock can stay switched on for the file.
 */
const CAPTURE = 500;

let Y: typeof import('yjs');
let createUndo: (doc: Doc) => UndoController;
let LOCAL_ORIGIN: typeof import('../../src/shared/board-model').LOCAL_ORIGIN;
let withPeer: () => Peer;
let getStickyText: typeof import('../../src/shared/board-model').getStickyText;
let UNDO_CAPTURE_TIMEOUT_MS: number;
let UNDO_MAX_STEPS: number;

beforeAll(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2024-03-01T00:00:00.000Z'));
  Y = await import('yjs');
  ({ createUndo } = await import('../../src/client/board/undo'));
  ({ LOCAL_ORIGIN, getStickyText } = await import('../../src/shared/board-model'));
  ({ withPeer } = await import('../peerDoc'));
  ({ UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } = await import('../../src/shared/config'));
});

/** The clock only ever moves forward, one deliberate pause at a time. */
function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

/** A board holding one note, plus the history that watches it. */
function typing() {
  const peer = withPeer();
  const doc = peer.doc;
  const id = createStickyAt(doc, { x: 0, y: 0 });
  const undo = createUndo(doc);
  const text = getStickyText(doc, id)!;
  /** One keystroke, exactly as the text editor writes it: a LOCAL_ORIGIN transaction. */
  const keystroke = (character: string) => {
    doc.transact(() => text.insert(text.toString().length, character), LOCAL_ORIGIN);
  };
  return { doc, id, undo, text, keystroke };
}

function createStickyAt(doc: Doc, at: { x: number; y: number }): string {
  const objects = doc.getMap<YMap<unknown>>('objects');
  const id = 'note-1';
  doc.transact(() => {
    const note = new Y.Map<unknown>();
    note.set('type', 'sticky');
    note.set('x', at.x);
    note.set('y', at.y);
    note.set('color', 'yellow');
    note.set('text', new Y.Text());
    note.set('z', 1);
    note.set('createdAt', 0);
    objects.set(id, note);
  }, LOCAL_ORIGIN);
  return id;
}

describe('typing bursts are one undo step (undo.typing)', () => {
  it('exposes the named settings the story promises', () => {
    expect(UNDO_CAPTURE_TIMEOUT_MS).toBe(CAPTURE);
    expect(UNDO_MAX_STEPS).toBe(200);
  });

  it('TC-12 keystrokes 100 ms apart are one step, undone together', () => {
    const { undo, text, keystroke } = typing();
    expect(undo.canUndo()).toBe(false);

    // Edit start: the editor closes the capture window.
    undo.boundary();
    for (const character of 'hello') {
      keystroke(character);
      advance(100);
    }
    // Edit end: and it closes it again.
    undo.boundary();

    expect(text.toString()).toBe('hello');
    expect(undo.canUndo()).toBe(true);

    // One undo removes the whole burst, not just the last letter.
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 a pause of exactly the timeout starts a second step', () => {
    const { undo, text, keystroke } = typing();
    undo.boundary();
    for (const character of 'ab') {
      keystroke(character);
      advance(CAPTURE);
    }
    undo.boundary();

    expect(text.toString()).toBe('ab');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('a');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('TC-13 one millisecond under the timeout is still the same step', () => {
    const { undo, text, keystroke } = typing();
    undo.boundary();
    for (const character of 'ab') {
      keystroke(character);
      advance(CAPTURE - 1);
    }
    undo.boundary();

    expect(text.toString()).toBe('ab');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('a boundary inside a burst splits it even with no pause at all', () => {
    const { undo, text, keystroke } = typing();
    undo.boundary();
    keystroke('a');
    undo.boundary();
    keystroke('b');

    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('a');
  });

  it('undoing inside an open burst does not merge with the typing that follows', () => {
    const { undo, text, keystroke } = typing();
    undo.boundary();
    keystroke('a');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');

    // Still inside the original capture window, but a new step.
    keystroke('b');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.redo()).toBe(true);
    expect(text.toString()).toBe('b');
  });

  it('the history stops at the configured maximum', () => {
    const { undo, text, keystroke } = typing();
    for (let i = 0; i < UNDO_MAX_STEPS + 10; i++) {
      undo.boundary();
      keystroke('x');
    }
    let steps = 0;
    while (undo.undo()) {
      steps++;
      if (steps > UNDO_MAX_STEPS + 1) throw new Error('the undo stack never emptied');
    }
    expect(steps).toBe(UNDO_MAX_STEPS);
    expect(text.toString().length).toBe(10);
  });
});
