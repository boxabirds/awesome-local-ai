/**
 * What makes one burst of typing one undo step
 * (`tests/unit/undo-boundaries.test.ts`, PRD `undo.typing`, TC-12 and TC-13).
 *
 * A drag, a delete and a colour are separated from each other by the boundaries
 * the caller draws. Typing is not: between the start and the end of an edit the
 * note's editor calls no boundary at all, and what decides where one step stops
 * and the next begins is the pause between keystrokes - `UNDO_CAPTURE_TIMEOUT_MS`,
 * a named product setting, half a second, "typing that continues without a pause
 * of half a second or more" (PRD `undo.typing`).
 *
 * Which is why this file cannot use the real clock. A test that waited a real half
 * second to prove a boundary would take half a second per boundary value, would be
 * late rather than wrong on a loaded machine, and could not test one millisecond
 * either side of the setting at all. `Y.UndoManager` asks the clock for the time of
 * every change through `lib0/time`'s `getUnixTime`, so that is the one function
 * replaced here - with the rest of the module left as it is, and `yjs` inlined into
 * the test graph (see `vitest.config.ts`) so that the replacement is the one `yjs`
 * itself sees.
 */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { createUndo } from '../../src/client/board/undo.js';
import {
  createSticky,
  getStickyText,
  initDoc,
  LOCAL_ORIGIN,
  moveObject,
  setStickyColor,
  snapshot,
} from '../../src/shared/board-model.js';
import { UNDO_CAPTURE_TIMEOUT_MS, UNDO_MAX_STEPS } from '../../src/shared/config.js';

/** The board's clock, which the test turns by hand. */
const clock = vi.hoisted(() => ({ now: 1_700_000_000_000 }));

vi.mock('lib0/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lib0/time')>();
  return { ...actual, getUnixTime: () => clock.now };
});

/* ------------------------------------------------------------- local helpers */

/** Move the board's clock on by `ms` (a pause between keystrokes). */
const wait = (ms: number): void => {
  clock.now += ms;
};

/** An empty board, at a known time. */
const newBoard = (): Y.Doc => {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
};

/** Make a note, and hand back its shared text. */
const noteWithText = (doc: Y.Doc): Y.Text => {
  const id = createSticky(doc, { x: 0, y: 0 }, 'yellow');
  if (typeof id !== 'string') throw new Error('the model refused to make a note');
  const ytext = getStickyText(doc, id);
  if (!ytext) throw new Error('the note has no text');
  return ytext;
};

/**
 * One character, exactly as the note's editor writes it: into the shared text, in
 * its own transaction, with this tab's origin.
 */
const keystroke = (doc: Y.Doc, ytext: Y.Text, char: string): void => {
  doc.transact(() => {
    ytext.insert(ytext.length, char);
  }, LOCAL_ORIGIN);
};

/** Type a whole word, `pause` milliseconds between the keystrokes. */
const burst = (doc: Y.Doc, ytext: Y.Text, word: string, pause: number): void => {
  for (const char of word) {
    keystroke(doc, ytext, char);
    wait(pause);
  }
};

/* ------------------------------------- TC-12: a run of typing is one thing I did */

describe('a burst of typing (TC-12)', () => {
  it('is one undo step when the keystrokes keep coming', () => {
    const doc = newBoard();
    const ytext = noteWithText(doc);
    wait(10);
    const undo = createUndo(doc);

    // The note's editor opens: that closes the window the drag was in.
    undo.boundary();
    // Ten keystrokes, a tenth of a second apart. Nine seconds of board time pass
    // in all, which is more than the setting: what matters is that the *pause*
    // between any two of them is shorter than it, which is what "typing that
    // continues" means.
    burst(doc, ytext, 'retro board', 100);
    // The editor closes (Escape, or a click away): the typing is one step.
    undo.boundary();

    expect(ytext.toString()).toBe('retro board');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    // The whole burst went back at once. Ten separate steps would have taken back
    // one character and left a note reading 'retro boar'.
    expect(ytext.toString()).toBe('');
    // Nothing else of mine to undo: the note itself is still on the board, and it
    // arrived before this history started.
    expect(undo.canUndo()).toBe(false);
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('is one step for the undo and one for the redo', () => {
    const doc = newBoard();
    const ytext = noteWithText(doc);
    const undo = createUndo(doc);

    undo.boundary();
    burst(doc, ytext, 'hello', 50);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(undo.redo()).toBe(true);
    // Re-applied as the whole word it was, not one character of it.
    expect(ytext.toString()).toBe('hello');
    expect(undo.canRedo()).toBe(false);
  });

  it('does not swallow the step that came before it', () => {
    const doc = newBoard();
    const ytext = noteWithText(doc);
    const id = snapshot(doc)[0]!.id;
    const undo = createUndo(doc);

    // I move the note, then immediately start typing in it - less than the
    // setting later, so a history that ran on the clock alone would make the move
    // and the typing the same thing I did.
    undo.boundary();
    moveObject(doc, id, 300, 300);
    undo.boundary(); // the gesture's last frame closes the window
    burst(doc, ytext, 'typed', 60);
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(snapshot(doc)[0]!.x).toBe(300);
    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]!.x).not.toBe(300);
  });

  it('is still one step when it is the only thing on the board', () => {
    const doc = newBoard();
    const ytext = noteWithText(doc);
    const undo = createUndo(doc);
    // `boundary()` with nothing behind it and nothing in front of it: no window to
    // close, no step to end, nothing thrown. The editor calls it on mount and on
    // unmount of every note it opens, including this one.
    expect(() => {
      undo.boundary();
      burst(doc, ytext, 'a', 100);
      undo.boundary();
    }).not.toThrow();
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });
});

/* ------------------------------- TC-13: the pause that ends a burst, to the ms */

describe('the pause that ends a burst (TC-13)', () => {
  /** Type `ab` with a pause of `pause`, and report how many steps that was. */
  const stepsOfTypeingAThenB = (pause: number): string[] => {
    const doc = newBoard();
    const ytext = noteWithText(doc);
    const undo = createUndo(doc);
    undo.boundary();
    keystroke(doc, ytext, 'a');
    wait(pause);
    keystroke(doc, ytext, 'b');
    undo.boundary();

    const undone: string[] = [];
    while (undo.canUndo()) {
      if (!undo.undo()) break;
      undone.push(ytext.toString());
    }
    return undone;
  };

  it('ends the step at exactly the setting', () => {
    // A pause of exactly `UNDO_CAPTURE_TIMEOUT_MS` is "a pause of half a second or
    // more" (PRD), so the two keystrokes are two things I did.
    expect(stepsOfTypeingAThenB(UNDO_CAPTURE_TIMEOUT_MS)).toEqual(['a', '']);
  });

  it('does not end it one millisecond inside the setting', () => {
    expect(stepsOfTypeingAThenB(UNDO_CAPTURE_TIMEOUT_MS - 1)).toEqual(['']);
  });

  it('ends it well outside the setting', () => {
    expect(stepsOfTypeingAThenB(UNDO_CAPTURE_TIMEOUT_MS + 1)).toEqual(['a', '']);
  });

  it('ends it for a colour chosen after a burst of typing too', () => {
    // The same timeout decides a different pair of actions, and the note's editor
    // is what keeps them apart: typing, then a pause, then a click on a swatch
    // would otherwise be one step that undoes both.
    const doc = newBoard();
    const ytext = noteWithText(doc);
    const id = snapshot(doc)[0]!.id;
    const undo = createUndo(doc);

    undo.boundary();
    burst(doc, ytext, 'write', 80);
    wait(UNDO_CAPTURE_TIMEOUT_MS + 20);
    // The toolbar's colour is its own step because the toolbar says so, whatever
    // the clock would have decided.
    undo.boundary();
    setStickyColor(doc, id, 'blue');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(snapshot(doc)[0]!.color).toBe('yellow');
    expect(ytext.toString()).toBe('write');
    expect(undo.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });
});

/* --------------------------------------- the two settings the story names */

describe('the named settings', () => {
  it('are the ones the PRD gives', () => {
    expect(UNDO_CAPTURE_TIMEOUT_MS).toBe(500);
    expect(UNDO_MAX_STEPS).toBe(200);
  });

  it('are what the controller uses when it is not told otherwise', () => {
    // A controller built with no options behaves exactly like one built with the
    // settings spelled out: `createUndo(doc)` is what the board calls.
    const defaults = newBoard();
    const explicit = newBoard();
    const a = noteWithText(defaults);
    const b = noteWithText(explicit);

    /** The same three things, on either board, at the same made-up times. */
    const play = (doc: Y.Doc, ytext: Y.Text, undo: ReturnType<typeof createUndo>): string[] => {
      const log: string[] = [];
      undo.boundary();
      keystroke(doc, ytext, 'a');
      wait(UNDO_CAPTURE_TIMEOUT_MS); // exactly the setting: a new step
      keystroke(doc, ytext, 'b');
      wait(1);
      keystroke(doc, ytext, 'c');
      undo.boundary();
      while (undo.canUndo() && undo.undo()) log.push(ytext.toString());
      return log;
    };

    const implicit = play(defaults, a, createUndo(defaults));
    const spelledOut = play(
      explicit,
      b,
      createUndo(explicit, { captureTimeoutMs: UNDO_CAPTURE_TIMEOUT_MS, maxSteps: UNDO_MAX_STEPS }),
    );
    expect(implicit).toEqual(['a', '']);
    expect(spelledOut).toEqual(implicit);
  });
});
