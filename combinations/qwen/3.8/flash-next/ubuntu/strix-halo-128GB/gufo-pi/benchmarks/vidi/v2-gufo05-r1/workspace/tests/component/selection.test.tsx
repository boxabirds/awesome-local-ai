/**
 * Selecting several objects at once, in the mounted app (`sel.interaction`,
 * `sel.marquee_ui`, `sel.keyboard`).
 *
 * TC-16 everything selected is deleted elsewhere
 * TC-17 the bar for two objects, and what it announces
 * TC-18 one sticky note gets story 2's toolbar instead
 * TC-19 a click on the empty board clears
 * TC-20 a shift-drag adds what it encloses, keeping the selection
 * TC-21 a plain drag pans the board and draws no rectangle (negative)
 * TC-22 a cancelled marquee changes nothing (negative)
 * TC-27 Ctrl/Cmd+A, TC-28 Ctrl+A on an empty board, TC-29 nudging,
 * TC-30 Backspace while typing (negative), TC-31 Delete
 *
 * The camera sits at (0, 0, 1), where a screen point and a world point are the same
 * numbers, so these tests can say "the note at 400,300" and mean it. `sel.click`,
 * `sel.shift_toggle` and the outline/handle rules are here too, as the DOM those
 * gestures have to leave behind.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { worldToScreen } from '../../src/client/canvas/camera';
import { advanceFrames, renderStickyApp, type StickyAppHandle } from './stickyHarness';

/**
 * Where these tests put their two notes, in world coordinates: side by side, close
 * enough to the origin that both are on screen at the opening zoom.
 */
const FIRST = { x: 0, y: 0 };
const SECOND = { x: 300, y: 0 };

/**
 * World → screen for the camera the board opens with.
 *
 * The board starts with the world origin in the middle of the window, so a test cannot
 * write a screen point by hand and mean it; every pointer position here is computed,
 * which is also what makes them survive a different window size.
 */
const at = (board: StickyAppHandle, world: { x: number; y: number }) =>
  worldToScreen(board.camera(), world);

async function boardWithTwoNotes(): Promise<StickyAppHandle> {
  const board = await renderStickyApp();
  await board.addNote(FIRST);
  await board.addNote(SECOND);
  return board;
}

/**
 * A rectangle that encloses the first note completely and touches nothing else, in
 * screen points: it is drawn a little outside the note's bounds, which are centred on
 * `FIRST` and `STICKY_SIZE_WORLD` wide.
 */
function marqueeOverFirst(board: StickyAppHandle): {
  from: { x: number; y: number };
  to: { x: number; y: number };
} {
  const box = at(board, { x: FIRST.x - 110, y: FIRST.y - 110 });
  const far = at(board, { x: FIRST.x + 110, y: FIRST.y + 110 });
  return { from: box, to: far };
}

/** Click one note, then shift-click the other: both are selected. */
async function selectBoth(board: StickyAppHandle): Promise<void> {
  const first = at(board, FIRST);
  const second = at(board, SECOND);
  await board.press(board.note(0), first.x, first.y);
  await board.release(first.x, first.y);
  await board.press(board.note(1), second.x, second.y, { shift: true });
  await board.release(second.x, second.y);
}

describe('sel.interaction: the outlines, the bar and clearing', () => {
  it('TC-16 a selection whose objects have all gone is empty, with no bar', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);
    expect(board.selectedIds()).toHaveLength(2);
    expect(board.overlayItems()).toHaveLength(2);
    expect(board.overlayBox()).not.toBeNull();

    // Somebody else deletes both, while this board is looking at them.
    await act(async () => {
      const objects = board.doc.getMap('objects');
      for (const id of [...objects.keys()]) objects.delete(id);
    });
    await advanceFrames();

    expect(board.selectedIds()).toEqual([]);
    expect(board.overlayItems()).toEqual([]);
    expect(board.overlayBox()).toBeNull();
    expect(board.selectionBar()).toBeNull();
    expect(board.countLabel()).toBeNull();
  });

  it('TC-17 two objects selected: the bar says "2 selected" and offers Delete, announced politely', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);

    expect(board.countLabel()).toBe('2 selected');
    const bar = board.selectionBar();
    expect(bar).not.toBeNull();
    // The count is what a screen reader is told about, politely: a selection changing
    // under the pointer should not interrupt whatever is being read out.
    const live = screen.getByTestId('selection-count');
    expect(live.getAttribute('aria-live')).toBe('polite');

    const deletable = bar?.querySelector<HTMLElement>('[aria-label="Delete selection"]');
    expect(deletable).not.toBeNull();
    // A single note's toolbar must not be there when two are selected.
    expect(screen.queryByLabelText('Sticky note colours')).toBeNull();

    // The button does the same thing the Delete key does.
    await act(async () => {
      deletable?.click();
    });
    await advanceFrames();
    expect(board.notes()).toHaveLength(0);
    expect(board.selectedIds()).toEqual([]);
  });

  it('TC-18 one sticky note selected: the note toolbar, not the bar', async () => {
    const board = await boardWithTwoNotes();
    const first = at(board, FIRST);
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);

    expect(screen.queryByTestId('selection-count')).toBeNull();
    expect(screen.queryByLabelText('Delete selection')).toBeNull();
    expect(screen.getByLabelText('Sticky note tools')).toBeTruthy();
    expect(board.selectionBar()?.className).toContain('selection-bar--note');
    // Story 2's toolbar behaves as it did: its delete button says "Delete note".
    expect(screen.getByLabelText('Delete note')).toBeTruthy();
  });

  it('TC-19 a click on the empty board, without dragging, clears the selection', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);
    expect(board.selectedIds()).toHaveLength(2);

    await board.clickEmpty(20, 20);
    expect(board.selectedIds()).toEqual([]);
    expect(board.overlayItems()).toEqual([]);
  });

  it('TC-19 a click on one object of a selected group narrows the selection to it', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);

    const second = at(board, SECOND);
    await board.press(board.note(1), second.x, second.y);
    await board.release(second.x, second.y);
    expect(board.selectedIds()).toEqual([board.noteIds()[1]]);
    expect(board.overlayItems()).toHaveLength(1);
    // One object still gets the note toolbar, because that is what a lone note needs.
    expect(screen.getByLabelText('Sticky note tools')).toBeTruthy();
  });

  it('TC-19 a click on the empty board that turns into a drag pans instead of clearing', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);

    const before = board.camera();
    await board.press(board.viewport(), 200, 200);
    await board.moveTo(260, 240);
    await board.release(260, 240);

    // The camera moved, so the gesture was a pan, and the selection stays where it was.
    // Dragging the board right moves the camera left: the board follows the pointer.
    expect(board.camera().x).toBeCloseTo(before.x - 60, 5);
    expect(board.camera().y).toBeCloseTo(before.y - 40, 5);
    expect(board.selectedIds()).toHaveLength(2);
  });

  it('TC-19 a click that is cancelled clears nothing', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);

    await board.press(board.viewport(), 20, 20);
    await board.cancel();

    expect(board.selectedIds()).toHaveLength(2);
  });

  it('draws one outline per selected object and eight handles on the box', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);

    expect(board.overlayItems()).toHaveLength(2);
    expect(board.handles()).toHaveLength(8);
    for (const id of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      expect(board.handle(id)).not.toBeNull();
    }
    // A handle is a control, so it is named: the accessible path is not "the square".
    expect(board.handle('se')?.getAttribute('aria-label')).toBe('Resize bottom-right');
  });

  it('nothing is drawn for a selection of none', async () => {
    const board = await boardWithTwoNotes();
    expect(board.overlayItems()).toEqual([]);
    expect(board.overlayBox()).toBeNull();
    expect(board.handles()).toEqual([]);
    expect(board.selectionBar()).toBeNull();
  });
});

describe('sel.marquee_ui: the rubber band', () => {
  it('TC-20 shift-dragging over an object adds it to the selection', async () => {
    const board = await boardWithTwoNotes();
    // Select the second note first, so the marquee has something to add to.
    const second = at(board, SECOND);
    await board.press(board.note(1), second.x, second.y);
    await board.release(second.x, second.y);
    expect(board.selectedIds()).toEqual([board.noteIds()[1]]);

    // Drag a rectangle that encloses the first note and no part of the second.
    const band = marqueeOverFirst(board);
    await board.press(board.viewport(), band.from.x, band.from.y, { shift: true });
    expect(board.marqueeElement()).not.toBeNull();
    // Halfway is worth a look: the band is being drawn, but nothing is selected until
    // the pointer comes up.
    await board.moveTo((band.from.x + band.to.x) / 2, (band.from.y + band.to.y) / 2);
    expect(board.selectedIds()).toHaveLength(1);
    await board.moveTo(band.to.x, band.to.y);
    await board.release(band.to.x, band.to.y);

    expect(board.selectedIds()).toHaveLength(2);
    // The band is gone once the pointer is up.
    expect(board.marqueeElement()).toBeNull();
  });

  it('TC-20 a marquee drawn on an empty part of the board selects nothing new', async () => {
    const board = await boardWithTwoNotes();
    await board.press(board.viewport(), 100, 600, { shift: true });
    await board.moveTo(200, 680);
    await board.release(300, 720);
    expect(board.selectedIds()).toEqual([]);
  });

  it('TC-21 a plain drag pans the board and draws no rectangle', async () => {
    const board = await boardWithTwoNotes();
    const before = board.camera();

    await board.press(board.viewport(), 250, 200);
    expect(board.marqueeElement()).toBeNull();
    await board.moveTo(400, 350);
    await board.release(560, 520);

    expect(board.marqueeElement()).toBeNull();
    expect(board.camera()).not.toEqual(before);
    expect(board.selectedIds()).toEqual([]);
  });

  it('TC-22 a marquee cancelled midway leaves the selection alone', async () => {
    const board = await boardWithTwoNotes();
    const first = at(board, FIRST);
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);
    const before = board.selectedIds();
    expect(before).toHaveLength(1);

    const band = marqueeOverFirst(board);
    await board.press(board.viewport(), band.from.x, band.from.y, { shift: true });
    await board.moveTo(band.to.x, band.to.y);
    expect(board.marqueeElement()).not.toBeNull();
    await board.cancel();

    expect(board.marqueeElement()).toBeNull();
    // The band covered the second note: it was not added, because the gesture was
    // interrupted rather than completed.
    expect(board.selectedIds()).toEqual(before);
  });

  it('Escape cancels the marquee without emptying the selection', async () => {
    const board = await boardWithTwoNotes();
    const first = at(board, FIRST);
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);
    const before = board.selectedIds();

    const band = marqueeOverFirst(board);
    await board.press(board.viewport(), band.from.x, band.from.y, { shift: true });
    await board.moveTo(band.to.x, band.to.y);
    await board.pressKey('Escape');

    expect(board.marqueeElement()).toBeNull();
    expect(board.selectedIds()).toEqual(before);
  });
});

describe('sel.keyboard', () => {
  it('TC-27 Ctrl+A selects every object and takes the key from the browser', async () => {
    const board = await boardWithTwoNotes();

    let defaultAllowed = true;
    await act(async () => {
      defaultAllowed = fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    });
    await advanceFrames();

    expect(board.selectedIds().sort()).toEqual(board.noteIds().sort());
    // false means preventDefault ran: the browser would otherwise select the page's text.
    expect(defaultAllowed).toBe(false);
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);

    // And a plain "a", with nothing pressed, is left alone — it has to keep working in
    // a text field, and typing it on the board means nothing.
    await act(async () => {
      defaultAllowed = fireEvent.keyDown(window, { key: 'a' });
    });
    expect(defaultAllowed).toBe(true);
  });

  it('Cmd+A does the same on a Mac keyboard', async () => {
    const board = await boardWithTwoNotes();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'a', metaKey: true });
    });
    expect(board.selectedIds()).toHaveLength(2);
  });

  it('TC-28 Ctrl+A on a board with nothing on it is not an error', async () => {
    const board = await renderStickyApp();
    let defaultAllowed = true;
    await act(async () => {
      defaultAllowed = fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    });
    expect(board.selectedIds()).toEqual([]);
    expect(board.overlayItems()).toEqual([]);
    expect(board.selectionBar()).toBeNull();
    // Nothing to select, but the key is still ours: the browser's "select all" would
    // highlight the chrome, which is the thing TC-27 rules out.
    expect(defaultAllowed).toBe(false);
  });

  it('TC-29 arrows nudge the selection, Shift for a larger step, and the page does not scroll', async () => {
    const board = await boardWithTwoNotes();
    const third = { x: 0, y: 300 };
    const id = await board.addNote(third);
    const point = at(board, third);
    await board.press(board.note(2), point.x, point.y);
    await board.release(point.x, point.y);
    const before = board.notes().find((note) => note.id === id)!;
    const cameraBefore = board.camera();

    let defaultAllowed = true;
    await act(async () => {
      defaultAllowed = fireEvent.keyDown(window, { key: 'ArrowRight' });
    });
    await advanceFrames();
    let after = board.notes().find((note) => note.id === id)!;
    expect(after.x).toBeCloseTo(before.x + NUDGE_STEP_WORLD, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(defaultAllowed).toBe(false);

    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowUp', shiftKey: true });
    });
    await advanceFrames();
    after = board.notes().find((note) => note.id === id)!;
    expect(after.y).toBeCloseTo(before.y - NUDGE_LARGE_STEP_WORLD, 5);
    expect(after.x).toBeCloseTo(before.x + NUDGE_STEP_WORLD, 5);

    // The board did not pan: the arrows moved the note, not the view.
    expect(board.camera()).toEqual(cameraBefore);
  });

  it('TC-29 nudging moves every selected object the same distance', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);
    const before = board.notes().map((note) => ({ x: note.x, y: note.y }));

    await board.pressKey('ArrowDown');
    await advanceFrames();

    const after = board.notes().map((note) => ({ x: note.x, y: note.y }));
    expect(after[0]).toEqual({ x: before[0]!.x, y: before[0]!.y + NUDGE_STEP_WORLD });
    expect(after[1]).toEqual({ x: before[1]!.x, y: before[1]!.y + NUDGE_STEP_WORLD });
  });

  it('TC-29 arrows with nothing selected do nothing', async () => {
    const board = await boardWithTwoNotes();
    const before = board.notes().map((note) => note.x);
    await board.pressKey('ArrowRight');
    expect(board.notes().map((note) => note.x)).toEqual(before);
  });

  it('TC-31 Delete removes every selected object and empties the selection', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);

    await board.pressKey('Delete');
    await advanceFrames();

    expect(board.notes()).toHaveLength(0);
    expect(board.selectedIds()).toEqual([]);
    expect(board.overlayItems()).toEqual([]);
    expect(board.selectionBar()).toBeNull();
  });

  it('TC-31 Backspace deletes too, when it is not being used to type', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);
    await board.pressKey('Backspace');
    expect(board.notes()).toHaveLength(0);
  });

  it('TC-30 Backspace while typing edits the text and keeps every object', async () => {
    const board = await boardWithTwoNotes();
    const id = board.noteIds()[0];
    const first = at(board, FIRST);
    await board.doubleClick(board.note(0), first.x, first.y);
    const area = board.textarea();
    await board.type('keep me');
    expect(area.value).toBe('keep me');

    // The keystroke belongs to the textarea: the board must not see it as a delete.
    let defaultAllowed = true;
    await act(async () => {
      defaultAllowed = fireEvent.keyDown(area, { key: 'Backspace' });
    });
    expect(defaultAllowed).toBe(true);
    expect(board.notes()).toHaveLength(2);
    expect(board.notes().find((note) => note.id === id)?.text).toBe('keep me');
  });

  it('Escape empties the selection and closes the editor', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);
    await board.pressKey('Escape');
    expect(board.selectedIds()).toEqual([]);

    const first = at(board, FIRST);
    await board.doubleClick(board.note(0), first.x, first.y);
    expect(screen.queryByTestId('sticky-note-textarea')).not.toBeNull();
    await board.pressKey('Escape', board.textarea());
    expect(screen.queryByTestId('sticky-note-textarea')).toBeNull();
    // Closing the editor leaves the note selected, so typing Escape does not lose the
    // object you were just working on.
    expect(board.selectedIds()).toEqual([board.noteIds()[0]]);
  });

  it('Enter starts editing the selected object', async () => {
    const board = await boardWithTwoNotes();
    const first = at(board, FIRST);
    await board.press(board.note(0), first.x, first.y);
    await board.release(first.x, first.y);
    await board.pressKey('Enter');
    expect(screen.queryByTestId('sticky-note-textarea')).not.toBeNull();
  });

  it('a key pressed while two objects are selected does not start editing either of them', async () => {
    const board = await boardWithTwoNotes();
    await selectBoth(board);
    await board.pressKey('Enter');
    expect(screen.queryByTestId('sticky-note-textarea')).toBeNull();
  });
});
