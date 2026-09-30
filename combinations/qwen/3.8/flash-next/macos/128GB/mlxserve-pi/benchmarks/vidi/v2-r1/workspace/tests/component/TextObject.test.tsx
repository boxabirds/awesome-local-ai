// A piece of free text on the board (`text.editor`, `text.sizes`, `text.width`,
// `text.delete`, `text.undo`) — the object side of story 9.
//
// Everything here runs the real `<Board>`: an object is placed the way a person places
// it (T, click), typed into the box that appears, and the *document* is read back after
// each step. The three things that are easy to get wrong and easy to forget are the
// ones this file is strictest about: the box around the words (only the client that
// typed measures it — see TextBoxSync.test.tsx), the empty object that must not survive
// (a placeholder is not an object), and one Ctrl+Z putting back both at once.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { makeNote, noteElement } from './helpers/board-ui';
import {
  advance,
  boxOf,
  boxSize,
  clickEmpty,
  clickTextToolbar,
  countBoxWrites,
  doc,
  dragHandle,
  objectMap,
  endEditWithEscape,
  FakeWebsocketProvider,
  flush,
  handleNames,
  objectsOf,
  open,
  pressKey,
  pressUndo,
  remoteChange,
  selectObject,
  textEditor,
  textElement,
  textIds,
  textIsBeingEdited,
  textObject,
  textToolbarSize,
  typeText,
} from './helpers/text-ui';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { objectBounds, snapshotObjects } from '../../src/shared/board-model';
import type { Rect } from '../../src/shared/geometry';
import { dispatchPointer } from './helpers/events';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'text-object-under-test';

/** Where a click placed at that world point puts the object's top-left, in world units. */
const placeAt = (world: { x: number; y: number }): string => {
  const before = textIds();
  pressKey({ key: 't' });
  clickEmpty(world);
  const created = textIds().find((id) => !before.includes(id));
  if (!created) throw new Error('the text tool placed nothing');
  advance(16); // the frame the caret is placed in
  return created;
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('text.editor', () => {
  // TC-19
  it('TC-19 puts the caret at the end, leaves Enter to the browser, keeps it selected on Escape', () => {
    const id = placeAt({ x: 60, y: 20 });

    // A brand new object is empty: the caret is at the only place it can be.
    expect(textEditor().value).toBe('');
    expect(textEditor().selectionStart).toBe(0);

    typeText('Hello there');
    endEditWithEscape();
    expect(textObject(id).text).toBe('Hello there');

    // Open it again the way the keyboard does: it is the selection, so Enter.
    pressKey({ key: 'Enter' });
    advance(16);
    expect(textIsBeingEdited()).toBe(true);
    expect(textEditor().value).toBe('Hello there');
    // The caret is after the last character, not before the first one.
    expect(textEditor().selectionStart).toBe('Hello there'.length);
    expect(textEditor().selectionEnd).toBe('Hello there'.length);

    // Enter *inside* the editor is a newline the browser puts in. It is not a commit:
    // the keystroke is left alone, and the box stays open.
    expect(fireEvent.keyDown(textEditor(), { key: 'Enter' })).toBe(true);
    flush();
    expect(textIsBeingEdited()).toBe(true);
    expect(textObject(id).text).toBe('Hello there');

    // Escape ends the edit and the object stays, still the selection.
    endEditWithEscape();
    expect(textIsBeingEdited()).toBe(false);
    expect(textIds()).toEqual([id]);
    expect(textElement(id).dataset.selected).toBe('true');
    expect(textObject(id).text).toBe('Hello there');
  });

  // TC-20
  it('TC-20 throws away an empty text on Escape and clears the selection', () => {
    const id = placeAt({ x: 60, y: 20 });
    expect(textIds()).toEqual([id]);

    // Nothing was typed. Escape is "no, forget it".
    endEditWithEscape();

    // The placeholder is not an object: it never should have stayed.
    expect(textIds()).toHaveLength(0);
    expect(screen.queryByTestId('text-object')).toBeNull();
    // And the selection went with it — no dangling selection frame on an empty board.
    expect(screen.queryByTestId('selection-outline')).toBeNull();
  });

  it('TC-20b blurring an empty text throws it away too, and one undo brings it back', () => {
    const id = placeAt({ x: 60, y: 20 });
    // Focus goes elsewhere, exactly as it does when a hand moves to the rail.
    act(() => {
      textEditor().blur();
    });
    flush();
    expect(textIds()).toHaveLength(0);

    // The object was created, then deleted, in one capture window: one undo restores it.
    pressUndo();
    expect(textIds()).toEqual([id]);
  });

  // TC-21
  it('TC-21 offers S M L XL with M on, and a size change keeps the object in place', () => {
    const id = placeAt({ x: 60, y: 20 });
    typeText('abc');
    endEditWithEscape();

    // The toolbar for one text object: four sizes and nothing else.
    expect(screen.getByTestId('text-toolbar')).toBeTruthy();
    for (const size of ['S', 'M', 'L', 'XL']) {
      expect(screen.queryByTestId(`text-size-${size}`)).toBeTruthy();
    }
    expect(textToolbarSize()).toBe('M');

    const before = { box: boxOf(id), at: { x: textObject(id).x, y: textObject(id).y } };
    clickTextToolbar('text-size-XL');

    expect(textObject(id).size).toBe('XL');
    // The corner it stands on does not move: a bigger size grows down and right.
    expect(textObject(id).x).toBe(before.at.x);
    expect(textObject(id).y).toBe(before.at.y);
    // And the box was re-measured in the same step (see TC-13), so it is bigger.
    expect(boxOf(id).height).toBeGreaterThan(before.box.height);
    expect(textToolbarSize()).toBe('XL');
  });

  it('TC-21b the remote copy gets the same size, and nobody re-measures it there', () => {
    const id = placeAt({ x: 60, y: 20 });
    typeText('abc');
    endEditWithEscape();
    clickTextToolbar('text-size-L');

    // What a second client sees is what the document says — no measurement of its own.
    const writes = countBoxWrites(id, () => {
      remoteChange(() => {
        /* a change from elsewhere: the document object is the same, nothing local */
        objectMap(id).set('z', 42);
      });
    });
    expect(textObject(id).size).toBe('L');
    expect(writes).toBe(0);
  });
});

describe('text.width', () => {
  // TC-22
  it('TC-22 gives one text object two side handles and no corner ones', () => {
    const id = placeAt({ x: 60, y: 20 });
    typeText('Wrap me');
    endEditWithEscape();

    expect(handleNames().sort()).toEqual(['e', 'w']);
    expect(textObject(id).widthMode).toBe('auto');
  });

  it('TC-22b a side handle fixes the width and rewraps the lines under it', () => {
    const id = placeAt({ x: 60, y: 20 });
    // Long enough that the box is at the auto maximum and the text is wrapped.
    const long = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    typeText(long);
    endEditWithEscape();
    const before = boxOf(id);
    expect(before.width).toBeGreaterThan(200);

    // Pull the west handle inwards: the box gets narrower, taller, and fixed.
    dragHandle('w', { x: textObject(id).x + 120, y: 0 });

    const after = boxOf(id);
    expect(textObject(id).widthMode).toBe('fixed');
    expect(after.width).toBeLessThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    // The font is not part of a resize, ever.
    expect(textObject(id).size).toBe('M');
    // Its right edge stayed where it was: the box grew from the edge that was dragged.
    expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);
  });

  // TC-23
  it('TC-23 keeps all eight handles for a mixed selection and leaves the font alone', () => {
    const id = placeAt({ x: -300, y: -200 });
    typeText('ab');
    endEditWithEscape();
    const note = makeNote(300, 300);

    // Add the note to the selection: eight handles again, because the selection is no
    // longer made of one thing that could take a side handle.
    selectObject(id);
    shiftClick(note);
    expect(handleNames().sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);

    const textBefore = boxOf(id);
    const noteBefore = noteBox(note);
    dragHandle('se', { x: 200, y: 200 });

    // Everything in the selection scaled about the corner that was held: the note,
    // which is away from that corner, moved; the text, which sits on it, grew.
    expect(noteBox(note).x).not.toBe(noteBefore.x);
    expect(boxOf(id).width).toBeGreaterThan(textBefore.width);
    // The size is a choice a person made, never something a scale decides.
    expect(textObject(id).size).toBe('M');
  });
});

describe('text.delete', () => {
  // TC-24
  it('TC-24 closes the editor when somebody else deletes the text, and does not bring it back', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const id = placeAt({ x: 60, y: 20 });
    typeText('Doomed');
    expect(textIsBeingEdited()).toBe(true);

    // A delete arrives from elsewhere while the caret is in the box.
    remoteChange((other) => {
      objectsOf(other).delete(id);
    });
    flush();

    // The editor is gone, the object is gone, nothing was rebuilt behind it.
    expect(textIsBeingEdited()).toBe(false);
    expect(textIds()).toHaveLength(0);
    expect(screen.queryByTestId('text-object')).toBeNull();
    expect(errors).not.toHaveBeenCalled();

    // And the empty-object sweep does not resurrect or double-delete anything.
    advance(UNDO_CAPTURE_TIMEOUT_MS + 1);
    expect(textIds()).toHaveLength(0);
    errors.mockRestore();
  });

  it('TC-24b the toolbar deletes a text that is being kept', () => {
    const id = placeAt({ x: 60, y: 20 });
    typeText('Keep me');
    endEditWithEscape();
    clickTextToolbar('delete-selection');
    expect(textIds()).not.toContain(id);
    expect(screen.queryByTestId('text-toolbar')).toBeNull();
    expect(screen.queryByTestId('selection-outline')).toBeNull();
  });
});

describe('text.undo', () => {
  // TC-25
  it('TC-25 puts the characters and the box back in one undo', () => {
    const id = placeAt({ x: 60, y: 20 });
    const empty = boxSize(id);

    typeText('Hello');
    const typed = boxSize(id);
    // The box followed the text: wider than an empty one, and taller is not required.
    expect(typed.width).toBeGreaterThan(empty.width);
    expect(textObject(id).text).toBe('Hello');

    // Leave the box (the board's own undo is not reachable with the caret in a box:
    // story 8 gave that keystroke to the editor), and let the undo step close.
    endEditWithEscape();
    advance(UNDO_CAPTURE_TIMEOUT_MS + 1);
    pressUndo();

    // One step: the characters are gone and the box is back to the one it had before
    // them. The object itself is still there — it was not what was undone.
    expect(textObject(id).text).toBe('');
    expect(boxSize(id)).toEqual(empty);
  });

  it('TC-25b undoing a size change takes its box with it', () => {
    const id = placeAt({ x: 60, y: 20 });
    typeText('Ship it');
    endEditWithEscape();
    const before = boxSize(id);
    clickTextToolbar('text-size-L');
    expect(boxSize(id).height).toBeGreaterThan(before.height);

    advance(UNDO_CAPTURE_TIMEOUT_MS + 1);
    pressUndo();
    // The size and the box were written together, so they come back together.
    expect(textObject(id).size).toBe('M');
    expect(boxSize(id)).toEqual(before);
  });

  it('TC-25c an accidental delete comes back, and Ctrl+Shift+Z takes it away again', () => {
    const id = placeAt({ x: 60, y: 20 });
    typeText('Ship it');
    endEditWithEscape();
    advance(UNDO_CAPTURE_TIMEOUT_MS + 1);

    // Delete it with the keyboard, then undo: the object is back with its words.
    pressKey({ key: 'Delete' });
    expect(textIds()).toHaveLength(0);
    pressUndo();
    expect(textIds()).toEqual([id]);
    expect(textObject(id).text).toBe('Ship it');

    // And redo does what undo undid, no more and no less.
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    flush();
    expect(textIds()).toHaveLength(0);
  });
});

// --- helpers local to this file ---------------------------------------------

/** A note's box, from the document. */
function noteBox(id: string): Rect {
  const object = snapshotObjects(doc()).find((candidate) => candidate.id === id);
  if (!object) throw new Error(`note "${id}" is gone`);
  return objectBounds(object);
}

/** Add an object to the selection, the way Shift-click does. */
function shiftClick(id: string): void {
  const note = noteElement(id);
  const box = note.getBoundingClientRect();
  const spot = { x: box.left + 1, y: box.top + 1 };
  dispatchPointer(note, 'pointerdown', spot.x, spot.y, { shiftKey: true });
  dispatchPointer(note, 'pointerup', spot.x, spot.y, { shiftKey: true });
  flush();
}
