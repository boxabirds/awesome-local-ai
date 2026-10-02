// Story 8, undo.boundaries: TC-12 and TC-13, the typing burst.
//
// A burst of typing is one undo step, and where the burst ends is a named product
// setting: typing that continues without a pause of UNDO_CAPTURE_TIMEOUT_MS or
// more is one step; a pause of that length or longer starts the next one.
//
// Two things about measuring that are worth knowing before reading the tests:
//
//   - The window is measured against `Date.now()` (lib0 exports it as
//     `getUnixTime = Date.now`, a reference taken when the module loads), so
//     faking the clock never reaches the undo manager. Every wait here is real.
//   - Adjacent characters typed into the ONE Y.Text are merged into a single item
//     by Yjs itself, which hides the step boundary whatever the timing. So the
//     step boundary is measured on writes Yjs cannot merge: two notes, or a move
//     and a burst. What is under test stays exactly what it says — how long a
//     pause has to be before the typing counts as a new step.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  getStickyText,
  initDoc,
  moveObjects,
  LOCAL_ORIGIN,
} from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo, type UndoController } from '../../src/client/board/undo';

let doc: Y.Doc;
let undo: UndoController;
let first: string;
let second: string;

beforeEach(() => {
  doc = new Y.Doc();
  initDoc(doc);
  // Two notes already on the board, made before this tab had a history.
  first = createSticky(doc, { x: 0, y: 0 });
  second = createSticky(doc, { x: 600, y: 0 });
  undo = createUndo(doc);
});

afterEach(() => {
  undo.destroy();
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Type a run of characters into one note, as the note editor does. */
function type(noteId: string, run: string): void {
  doc.transact(() => {
    const text = getStickyText(doc, noteId)!;
    text.insert(text.length, run);
  }, LOCAL_ORIGIN);
}

/** Type one character at a time, pausing `ms` between the keystrokes. */
async function typeKeystrokes(noteId: string, chars: string, ms: number): Promise<void> {
  for (const char of chars) {
    type(noteId, char);
    if (ms > 0) await wait(ms);
  }
}

function typed(noteId: string): string {
  return getStickyText(doc, noteId)!.toString();
}

/** How many presses of Undo the history takes to run out. */
function countUndos(): number {
  let n = 0;
  while (undo.undo()) {
    n++;
    if (n > 20) throw new Error('the undo history never ran out');
  }
  return n;
}

// --- TC-12 --------------------------------------------------------------------

describe('TC-12: typing without a pause is one undo step', () => {
  it('groups a burst of keystrokes and undoes the whole burst at once', async () => {
    await typeKeystrokes(first, 'Faster', 60);
    expect(typed(first)).toBe('Faster');

    expect(undo.undo()).toBe(true);
    expect(typed(first)).toBe('');
    // The burst was one step, and the only one: nothing of mine is left.
    expect(undo.canUndo()).toBe(false);
  });

  it('groups a burst of any length, and one press of Undo ends it', async () => {
    const run = 'x'.repeat(40);
    await typeKeystrokes(first, run, 8); // 40 keystrokes, no pause near the setting
    expect(typed(first)).toHaveLength(40);

    expect(undo.undo()).toBe(true);
    expect(typed(first)).toHaveLength(0);
    expect(undo.canUndo()).toBe(false);
  });

  it('groups keystrokes spread over more than one setting, as long as none of the pauses reaches it', async () => {
    // Six gaps of 120 ms: 720 ms of typing in all, and still one step.
    await typeKeystrokes(first, 'abcdefg', 120);
    expect(typed(first)).toBe('abcdefg');

    expect(countUndos()).toBe(1);
    expect(typed(first)).toBe('');
  });
});

// --- TC-13 --------------------------------------------------------------------

describe('TC-13: a pause of UNDO_CAPTURE_TIMEOUT_MS or more ends the burst', () => {
  it('splits two bursts a whole setting apart at the product default', async () => {
    type(first, 'abc');
    await wait(UNDO_CAPTURE_TIMEOUT_MS + 150); // comfortably past the setting
    type(second, 'xy');
    undo.boundary();

    expect(countUndos()).toBe(2);
    expect(typed(second)).toBe(''); // the later burst, and nothing else, went first
    expect(typed(first)).toBe('');
  });

  it('puts the first burst back when the second is undone', async () => {
    // Measured on a short window so the boundary can be read to the millisecond.
    undo.destroy();
    undo = createUndo(doc, { captureTimeoutMs: 200 });

    type(first, 'abc');
    await wait(240); // past the window
    type(second, 'xy');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(typed(second)).toBe('');
    expect(typed(first)).toBe('abc'); // the earlier burst stands
    expect(undo.undo()).toBe(true);
    expect(typed(first)).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  it('keeps two bursts inside the window in one step', async () => {
    undo.destroy();
    undo = createUndo(doc, { captureTimeoutMs: 200 });

    type(first, 'abc');
    await wait(40); // well inside the window
    type(second, 'xy');
    undo.boundary();

    expect(countUndos()).toBe(1);
    expect(typed(first)).toBe('');
    expect(typed(second)).toBe('');
  });

  it('leaves an earlier action of mine for the next press of Undo', async () => {
    // My move, then a burst of typing: two steps, and the typing goes first.
    const createdX = doc.getMap<Y.Map<unknown>>('objects').get(first)!.get('x');
    moveObjects(doc, new Map([[first, { x: 300, y: 0 }]]));
    undo.boundary();
    await typeKeystrokes(first, 'hello', 40);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(typed(first)).toBe('');
    expect(undo.undo()).toBe(true);
    expect(doc.getMap<Y.Map<unknown>>('objects').get(first)!.get('x')).toBe(createdX);
    expect(undo.canUndo()).toBe(false);
  });
});

// --- the error path -----------------------------------------------------------

describe('the error path of a boundary', () => {
  it('does nothing at all on an empty history', () => {
    const fresh = createUndo(new Y.Doc());
    expect(() => fresh.boundary()).not.toThrow();
    expect(fresh.canUndo()).toBe(false);
    expect(fresh.canRedo()).toBe(false);
    expect(fresh.undo()).toBe(false);
    fresh.destroy();
  });
});
