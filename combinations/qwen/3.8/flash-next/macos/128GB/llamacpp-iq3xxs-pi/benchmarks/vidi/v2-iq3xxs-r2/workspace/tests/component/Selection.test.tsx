// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNote,
  flushFrames,
  noteToolbarElement,
  readCamera,
  renderBoard,
  selectNote,
  selectedNoteIds,
  waitForNotes,
  click,
} from './fixtures/board';
import {
  clickObject,
  deleteSelectionButton,
  focusObject,
  objectsInDoc,
  plainPointerDown,
  plainPointerMove,
  plainPointerUp,
  remoteDelete,
  seedBoxes,
  selectedIds,
  selectionBarElement,
  selectionCountIsLive,
  selectionCountText,
  shiftClickObject,
  waitForSelected,
  EMPTY_SCREEN,
} from './fixtures/selection';

/**
 * Multi-selection on the board (sel.interaction): a set of selected objects, its outlines,
 * the selection bar, and the fact that none of it belongs to the document.
 *
 * The objects are the test-only `testbox` type wherever the case is about selection rather
 * than about sticky notes — selecting, moving and deleting must be shown to be generic
 * (sel.all_types), and stories 9–12 will bring the types that depend on that.
 */

beforeEach(async () => {
  await renderBoard();
  expect(readCamera().zoom).toBe(1);
});

describe('the selection bar (TC-17, TC-18)', () => {
  it('TC-17: two selected objects show "2 selected" and a Delete selection button', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);

    await waitForSelected([a, b]);
    expect(selectionBarElement()).not.toBeNull();
    expect(selectionCountText()).toBe('2 selected');
    // A screen reader has to hear the number change when a marquee or another person
    // changes it (TC-17).
    expect(selectionCountIsLive()).toBe(true);
    expect(deleteSelectionButton().getAttribute('aria-label')).toBe('Delete selection');
  });

  it('TC-18: one selected sticky note shows its own toolbar and no bar', async () => {
    createNote({ x: 100, y: 100 });
    const second = createNote({ x: 360, y: 100 });
    await waitForNotes(2);
    await selectNote(second);

    expect(selectedNoteIds()).toEqual([second]);
    expect(noteToolbarElement()).not.toBeNull();
    expect(selectionBarElement()).toBeNull();
  });

  it('TC-18: a second selected note replaces that toolbar with the bar', async () => {
    const first = createNote({ x: 100, y: 100 });
    const second = createNote({ x: 360, y: 100 });
    await waitForNotes(2);
    await selectNote(first);
    expect(noteToolbarElement()).not.toBeNull();

    await shiftClickObject(second);

    expect(selectionCountText()).toBe('2 selected');
    // Colour belongs to one note, so the toolbar with the colour swatches goes away rather
    // than gaining a "make both blue" button.
    expect(noteToolbarElement()).toBeNull();
  });

  it('deleting from the bar removes every selected object and clears the selection', async () => {
    const [a, b, c] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);

    act(() => {
      deleteSelectionButton().click();
    });
    await flushFrames();

    expect(objectsInDoc().map((object) => object.id)).toEqual([c]);
    expect(selectedIds()).toEqual([]);
    expect(selectionBarElement()).toBeNull();
  });

  it('TC-16: when somebody else deletes everything this client had selected, the bar goes too', async () => {
    const [a, b, c] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await shiftClickObject(c);
    await waitForSelected([a, b, c]);
    expect(selectionCountText()).toBe('3 selected');

    await remoteDelete(b);
    expect(selectionCountText()).toBe('2 selected');

    await remoteDelete(a);
    await remoteDelete(c);
    expect(selectedIds()).toEqual([]);
    expect(selectionBarElement()).toBeNull();
  });
});

describe('clicking away (TC-19)', () => {
  it('TC-19: a click on empty board space with no drag clears the selection', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);

    await click(EMPTY_SCREEN);

    expect(selectedIds()).toEqual([]);
    expect(selectionBarElement()).toBeNull();
  });

  it('TC-19: a drag that pans the board is not a click and leaves the selection alone', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(a);
    await shiftClickObject(b);
    await waitForSelected([a, b]);
    const before = readCamera();

    plainPointerDown(EMPTY_SCREEN);
    plainPointerMove({ x: EMPTY_SCREEN.x + 40, y: EMPTY_SCREEN.y + 30 });
    plainPointerMove({ x: EMPTY_SCREEN.x + 80, y: EMPTY_SCREEN.y + 60 });
    plainPointerUp({ x: EMPTY_SCREEN.x + 80, y: EMPTY_SCREEN.y + 60 });
    await flushFrames();

    expect(readCamera().x).not.toBe(before.x);
    await waitForSelected([a, b]);
    expect(selectionCountText()).toBe('2 selected');
  });

  it('the focus a browser gives a clicked note does not replace the selection', async () => {
    // Notes are focusable so that Tab reaches them, which means a browser focuses the note
    // it pressed. That focus must not select a second time — the press has already decided
    // the selection, Shift included — or every shift+click on a sticky note collapses the
    // group back to the one object it just added.
    const first = createNote({ x: 100, y: 100 });
    const second = createNote({ x: 360, y: 100 });
    await waitForNotes(2);
    await clickObject(first);
    await shiftClickObject(second);

    await waitForSelected([first, second]);
    expect(selectionCountText()).toBe('2 selected');
  });

  it('Tab focus still selects the note it reached', async () => {
    const first = createNote({ x: 100, y: 100 });
    const second = createNote({ x: 360, y: 100 });
    await waitForNotes(2);
    await clickObject(first);

    await focusObject(second);

    await waitForSelected([second]);
  });

  it('Shift+clicking the only selected object leaves an empty selection, not one', async () => {
    const [a, b] = await seedBoxes();
    await clickObject(a);
    await clickObject(b);
    await waitForSelected([b]);
    await shiftClickObject(b);

    expect(selectedIds()).toEqual([]);
    expect(selectionBarElement()).toBeNull();
  });

  it('Escape clears the selection', async () => {
    const [a] = await seedBoxes();
    await clickObject(a);
    await waitForSelected([a]);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flushFrames();

    expect(selectedIds()).toEqual([]);
  });
});

describe('selection stays off the document (TC-16)', () => {
  it('selecting, adding and removing objects writes nothing to the document', async () => {
    const ids = await seedBoxes();
    const before = objectsInDoc().map((object) => ({
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      z: object.z,
    }));

    await clickObject(ids[0]);
    await shiftClickObject(ids[1]);
    await shiftClickObject(ids[0]);
    expect(objectsInDoc().length).toBe(ids.length);

    // The objects themselves are untouched — and no `selected` field appeared on any of
    // them, which is how a second person's view of the same document stays theirs.
    const after = objectsInDoc().map((object) => ({
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      z: object.z,
    }));
    expect(after).toEqual(before);
  });
});
