// Story 8 `undo.history` capture-window cases (TC-12, TC-13), plus what a boundary
// does inside that window.
//
// The capture window is the one part of undo that is about *time*, so this is the
// one place in the story's tests where the clock is put under control. lib0 — the
// module yjs reads the time from — takes `Date.now` as its `getUnixTime` when it is
// loaded, which is why `vi.useFakeTimers()`/`vi.setSystemTime()` never reach the
// manager: it holds a reference to the function, not a call through an object. So
// `lib0/time` is mocked to a variable these tests advance by hand, and
// `vitest.workspace.ts` inlines yjs for the unit project so that the module yjs
// imports is the one being mocked. Everything else — the manager, the stacks, the
// inverse operations — is untouched.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

let fakeNow = 1_000_000;

vi.mock('lib0/time', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getUnixTime: () => fakeNow };
});

import { createUndo } from '../../src/client/board/undo.ts';
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
  initDoc,
  setStickyColor,
  snapshot,
  type StickySnapshot,
} from '../../src/shared/board-model.ts';
import { applyTextDiff } from '../../src/client/objects/StickyText.ts';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config.ts';
import { addSticky, connectPeer, type Peer } from './helpers/peer.ts';

const KEYSTROKE_MS = 100;

let doc: Y.Doc;
let peer: Peer | null;

beforeEach(() => {
  fakeNow = 1_000_000;
  doc = new Y.Doc();
  initDoc(doc);
  peer = null;
});

afterEach(() => {
  peer?.stop();
  doc.destroy();
});

/**
 * A note that is already on the board, and its text. The note is created before the
 * controller exists, so the only steps in the controller are the keystrokes the test
 * types.
 */
function noteOnTheBoard(): { id: string; text: Y.Text } {
  const id = createSticky(doc, { x: 200, y: 200 });
  const text = getStickyText(doc, id)!;
  return { id, text };
}

/** Type `chars`, one keystroke at a time, `KEYSTROKE_MS` apart on the fake clock. */
function type(text: Y.Text, chars: string): void {
  for (const ch of chars) {
    fakeNow += KEYSTROKE_MS;
    applyTextDiff(text, text.toString() + ch, LOCAL_ORIGIN);
  }
}

const note = (id: string): StickySnapshot => snapshot(doc).find((n) => n.id === id)!;

describe('undo.history capture window', () => {
  it('TC-12 a burst of typing is one step: five characters, one undo takes all five', () => {
    const { text } = noteOnTheBoard();
    const controller = createUndo(doc);

    type(text, 'hello');

    expect(text.toString()).toBe('hello');
    expect(controller.canUndo()).toBe(true);
    expect(controller.canRedo()).toBe(false);

    expect(controller.undo()).toBe(true);
    expect(text.toString()).toBe(''); // all five gone at once
    expect(controller.canUndo()).toBe(false); // there was never a second step
    expect(controller.redo()).toBe(true);
    expect(text.toString()).toBe('hello'); // and redo puts the whole word back
    controller.destroy();
  });

  it('TC-13 a pause past UNDO_CAPTURE_TIMEOUT_MS starts a second step', () => {
    const { text } = noteOnTheBoard();
    const controller = createUndo(doc);

    type(text, 'foo');
    fakeNow += UNDO_CAPTURE_TIMEOUT_MS + 1; // the pause a person takes to re-read
    type(text, 'bar');

    expect(text.toString()).toBe('foobar');

    expect(controller.undo()).toBe(true);
    expect(text.toString()).toBe('foo'); // the second burst only
    expect(controller.undo()).toBe(true);
    expect(text.toString()).toBe(''); // the first one too
    expect(controller.canUndo()).toBe(false);
    expect(controller.canRedo()).toBe(true);
    controller.destroy();
  });

  it('a keystroke one millisecond short of the timeout is still the same step', () => {
    const { text } = noteOnTheBoard();
    const controller = createUndo(doc);

    type(text, 'foo');
    // The clock also moves by the spacing between keystrokes before the next one
    // lands, so this puts that keystroke 1ms *inside* the window.
    fakeNow += UNDO_CAPTURE_TIMEOUT_MS - 1 - KEYSTROKE_MS;
    type(text, 'bar');

    expect(controller.undo()).toBe(true);
    expect(text.toString()).toBe(''); // one step, not two
    expect(controller.canUndo()).toBe(false);
    controller.destroy();
  });

  it('boundary() splits two actions inside the window, and joins nothing after it', () => {
    const { id, text } = noteOnTheBoard();
    const controller = createUndo(doc);

    type(text, 'quick note');
    controller.boundary(); // what the board does when the note's editor closes
    setStickyColor(doc, id, 'green');

    expect(note(id).color).toBe('green');

    expect(controller.undo()).toBe(true);
    expect(note(id).color).toBe('yellow'); // the colour undid on its own...
    expect(text.toString()).toBe('quick note'); // ...and the typing is untouched
    expect(controller.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(controller.canUndo()).toBe(false);
    controller.destroy();
  });

  it('a colleague typing on the same board neither splits my burst nor becomes a step', () => {
    const { text } = noteOnTheBoard();
    peer = connectPeer(doc);
    const controller = createUndo(doc);

    type(text, 'he');
    // Halfway through my word, a colleague adds a note of their own.
    addSticky(peer.doc, { text: 'someone else\u2019s note', x: 800, y: 800 });
    type(text, 'llo');

    expect(text.toString()).toBe('hello');

    expect(controller.undo()).toBe(true);
    expect(text.toString()).toBe(''); // one step: the interruption did not split it
    expect(controller.canUndo()).toBe(false);
    // The colleague's note was never mine to undo; mine is still on the board,
    // emptied of the word.
    expect(snapshot(doc).map((n) => n.text).sort()).toEqual(['', 'someone else\u2019s note']);
    controller.destroy();
  });
});
