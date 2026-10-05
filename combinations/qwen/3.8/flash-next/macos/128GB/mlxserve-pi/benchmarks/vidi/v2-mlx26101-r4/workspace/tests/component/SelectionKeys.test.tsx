/**
 * The keyboard half of the selection: choose everything, give it up, nudge it, delete it, type in it
 * (TC-27 to TC-31).
 *
 * A keyboard is a difficult thing to test well, because the same keystroke means different things in
 * different places, and the place it means them in is not the key but the state: Escape while typing
 * means "I have finished this note", Escape with nothing typing means "I did not mean those six". A test
 * that fires the key at the window and asserts one outcome for every state cannot tell those apart, so
 * the tests below put the board into the state first and only then press the key.
 *
 * The step sizes are in board units and the board is drawn at zoom 1, so one nudge of 1 unit is 1 pixel
 * on the screen — which is small enough that a test must read the document to see it at all.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import {
  addTestbox,
  cameraOf,
  liveText,
  noteElementById,
  objectById,
  objects,
  outlinedIds,
  placeNote,
  pressEscape,
  pressNote,
  renderBoard,
  selectAll,
  somebodyElse,
  selectionText,
  textarea,
  hasTextarea,
} from './helpers/selection';

/** Press a key where a person would press it: on the page, with nothing focused. */
function key(name: string, init: Record<string, unknown> = {}): boolean {
  return fireEvent.keyDown(window, { key: name, ...init });
}

/** The same, inside the note that is being typed in. */
function keyInField(name: string, init: Record<string, unknown> = {}): boolean {
  return fireEvent.keyDown(textarea(), { key: name, ...init });
}

describe('choosing everything, and giving it up', () => {
  it('TC-27: Ctrl/Cmd+A selects every object on the board, and does not select the page', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    const b = await placeNote({ x: 650, y: 600 });
    const boxId = addTestbox({ x: 40, y: 200, width: 300, height: 120 });
    pressEscape();
    expect(outlinedIds()).toEqual([]);

    // The keystroke is answered: the whole board is chosen, of every type, and the browser's own
    // "select the page's text" is not allowed to run as well — the false return is the proof that the
    // board called preventDefault, which is the only way it can be known from the outside.
    expect(key('a', { ctrlKey: true })).toBe(false);
    expect(outlinedIds().sort()).toEqual([a, b, boxId].sort());
    expect(selectionText()).toBe('3 selected');

    // Cmd on the machine that spells it that way.
    pressEscape();
    expect(outlinedIds()).toEqual([]);
    key('a', { metaKey: true });
    expect(outlinedIds()).toHaveLength(3);
  });

  it('TC-27b: Ctrl/Cmd+A on a board with objects of types this build cannot touch chooses what it can', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    const b = await placeNote({ x: 650, y: 250 });
    pressEscape();

    // A colleague writes something this build has never heard of. It is on the board and stays on the
    // board; what it does not do is come into a selection this build would then try to move.
    somebodyElse((there) => {
      there.transact(() => {
        const objects = there.getMap<Y.Map<unknown>>('objects');
        const unknown = new Y.Map<unknown>();
        unknown.set('type', 'unobtanium');
        unknown.set('x', 0);
        unknown.set('y', 0);
        unknown.set('z', 9);
        objects.set('unknown-1', unknown);
      }, 'test-fixture');
    });

    key('a', { ctrlKey: true });
    expect(outlinedIds().sort()).toEqual([a, b].sort());
  });

  it('TC-27c: Ctrl/Cmd+A while a note is being typed in belongs to the note', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'hello');
    const b = await placeNote({ x: 650, y: 250 }, 'there');
    pressEscape();
    // One note is chosen, and opened for typing: the state in which Ctrl+A belongs to the caret.
    pressNote(b);
    key('Enter');
    await waitFor(() => expect(hasTextarea()).toBe(true));

    // Six letters are being chosen inside the note, not the six objects on the board. If this selected
    // everything instead, the next keystroke would replace every note on the board with what was typed.
    expect(keyInField('a', { ctrlKey: true })).toBe(true);
    expect(outlinedIds()).toEqual([b]);
    expect(hasTextarea()).toBe(true);
    expect(outlinedIds()).not.toContain(a);
  });

  it('TC-28: Escape gives the whole selection up', async () => {
    renderBoard();
    await placeNote({ x: 250, y: 250 });
    await placeNote({ x: 650, y: 250 });
    await placeNote({ x: 250, y: 600 });
    selectAll();
    expect(outlinedIds()).toHaveLength(3);

    pressEscape();
    expect(outlinedIds()).toEqual([]);
    expect(selectionText()).toBeNull();
    expect(liveText()).toBeNull();

    // Escape with nothing selected is not an error and empties nothing that was not already empty: the
    // board's answer is to do nothing at all.
    expect(objects()).toHaveLength(3);
    pressEscape();
    expect(outlinedIds()).toEqual([]);
  });

  it('TC-28b: Escape while typing finishes the typing and leaves the note chosen', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'written');
    await placeNote({ x: 650, y: 250 }, 'other');
    // One note is chosen on its own and then opened for typing.
    pressNote(a);
    expect(outlinedIds()).toEqual([a]);
    key('Enter');
    expect(hasTextarea()).toBe(true);

    // The same key that gives up a selection means "I have finished this one" inside a note: the typing
    // ends, and what was chosen stays chosen — losing the selection here would mean a person who
    // pressed Escape to stop typing then had to choose the note again to move it.
    keyInField('Escape');
    await waitFor(() => expect(hasTextarea()).toBe(false));
    expect(outlinedIds()).toContain(a);
    expect(objectById(a).text).toBe('written');
  });
});

describe('nudging, deleting and typing with the keyboard', () => {
  it('TC-29: arrow keys move everything selected, a little at a time and a lot with Shift', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    const b = await placeNote({ x: 650, y: 250 });
    await placeNote({ x: 250, y: 600 });
    // Leave the third one out of the selection: a nudge must not reach it.
    pressEscape();
    pressNote(a);
    pressNote(b, { shiftKey: true });
    expect(outlinedIds().sort()).toEqual([a, b].sort());

    const before = { a: objectById(a).x, b: objectById(b).x, camera: cameraOf() };
    const third = objects().find((object) => !outlinedIds().includes(object.id))!;
    const thirdWas = { x: third.x, y: third.y };

    // One press, one unit. The step is small on purpose, and small enough that the only place to see it
    // is in the document.
    expect(key('ArrowRight')).toBe(false);
    await waitFor(() => expect(objectById(a).x).toBe(before.a + NUDGE_STEP_WORLD));
    expect(objectById(b).x).toBe(before.b + NUDGE_STEP_WORLD);
    expect({ x: third.x, y: third.y }).toEqual(thirdWas);

    // Shift is the difference between "a bit" and "a lot", and is the same word the rest of the board
    // uses for it.
    key('ArrowRight', { shiftKey: true });
    await waitFor(() => expect(objectById(a).x).toBe(before.a + NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD));
    expect(objectById(b).x).toBe(before.b + NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD);

    // The other three directions, and the page does not scroll and the board does not pan: a nudge that
    // moved the view instead of the objects would look like nothing had happened at all.
    const beforeCamera = before.camera;
    key('ArrowDown');
    key('ArrowLeft', { shiftKey: true });
    key('ArrowUp');
    await waitFor(() => expect(objectById(a).y).toBe(objectById(b).y));
    expect(cameraOf()).toEqual(beforeCamera);
    expect(objectById(a).y).toBe(objectById(b).y);
  });

  it('TC-29b: the arrows do nothing when nothing is chosen, and nothing to a board that cannot be written', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    pressEscape();
    const was = { x: objectById(a).x, y: objectById(a).y };

    // An arrow key with nothing selected is the ordinary arrow key of every other page on the internet,
    // and the board has no business swallowing it.
    expect(outlinedIds()).toEqual([]);
    key('ArrowRight');
    expect({ x: objectById(a).x, y: objectById(a).y }).toEqual(was);
  });

  it('TC-30: Delete removes every object selected, and the selection with them', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 });
    const b = await placeNote({ x: 650, y: 250 });
    const kept = await placeNote({ x: 250, y: 600 });
    pressEscape();
    pressNote(a);
    pressNote(b, { shiftKey: true });
    expect(outlinedIds().sort()).toEqual([a, b].sort());

    key('Delete');

    // Both gone from the document, and nothing left selected afterwards: a selection that outlives its
    // objects is a selection that deletes the next object anybody presses.
    await waitFor(() => expect(objects().map((object) => object.id)).toEqual([kept]));
    expect(outlinedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-bar')).toBeNull();

    // Backspace does it too, because half the keyboards in use have no Delete key where anybody can find
    // it, and a person who cannot delete a note has been told they cannot delete a note.
    pressNote(kept);
    expect(outlinedIds()).toEqual([kept]);
    key('Backspace');
    await waitFor(() => expect(objects()).toHaveLength(0));
    expect(outlinedIds()).toEqual([]);
  });

  it('TC-30b: Delete inside a note deletes a letter, not the notes', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'abc');
    await placeNote({ x: 650, y: 250 }, 'xyz');

    // One note is chosen and being typed in, so the caret is inside it and Delete belongs to the caret.
    // Were the keystroke handed to the board, the note would vanish the moment anybody deleted a letter.
    pressNote(a);
    expect(outlinedIds()).toEqual([a]);
    key('Enter');
    await waitFor(() => expect(hasTextarea()).toBe(true));

    keyInField('Delete');
    expect(objects()).toHaveLength(2);
    expect(outlinedIds()).toEqual([a]);
    expect(hasTextarea()).toBe(true);

    // Backspace is the same keystroke under a different name, and it is the one browsers answer by
    // going back a page when nobody stops them.
    keyInField('Backspace');
    expect(objects()).toHaveLength(2);
    expect(outlinedIds()).toEqual([a]);
  });

  it('TC-31: Enter starts typing in the one note that is selected', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'written');
    expect(outlinedIds()).toEqual([a]);
    expect(hasTextarea()).toBe(false);

    key('Enter');

    // The note is open for typing, with what is written in it, and it is still the thing that is selected.
    await waitFor(() => expect(hasTextarea()).toBe(true));
    expect(textarea().value).toBe('written');
    expect(outlinedIds()).toEqual([a]);
  });

  it('TC-31b: Enter with two notes selected does not guess which one to type in', async () => {
    renderBoard();
    const a = await placeNote({ x: 250, y: 250 }, 'one');
    const b = await placeNote({ x: 650, y: 250 }, 'two');
    // B is selected by having been made; shift-clicking A brings it in alongside.
    pressNote(a, { shiftKey: true });
    expect(outlinedIds().sort()).toEqual([a, b].sort());

    // There is no right answer to "which of these two should the caret go into", and the board that picks
    // one is a board that has typed into a note somebody did not mean.
    key('Enter');
    expect(hasTextarea()).toBe(false);
    expect(outlinedIds().sort()).toEqual([a, b].sort());

    // One note, chosen on its own, is the answer to the question Enter is asking.
    pressEscape();
    pressNote(a);
    expect(outlinedIds()).toEqual([a]);
    key('Enter');
    await waitFor(() => expect(hasTextarea()).toBe(true));
    expect(textarea().value).toBe('one');

    // And a type that cannot be typed into is not opened by it either: the note's own nature decides.
    pressEscape();
    const boxId = addTestbox({ x: 40, y: 200, width: 200, height: 100 });
    pressNote(boxId);
    expect(outlinedIds()).toEqual([boxId]);
    key('Enter');
    expect(hasTextarea()).toBe(false);
    expect(noteElementById(boxId).dataset.selected).toBe('true');
  });
});
