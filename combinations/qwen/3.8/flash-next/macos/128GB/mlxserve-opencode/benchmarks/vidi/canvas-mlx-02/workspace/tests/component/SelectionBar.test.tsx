// Story 7, sel.interaction — the selection bar and what happens to a selection
// when objects disappear (TC-16 to TC-19).
import { describe, it, expect } from 'vitest';
import {
  renderBoard7,
  seedSticky,
  seedBox,
  act,
  fireEvent,
  settle,
  screen,
} from './story7TestUtils.tsx';
import { deleteObjects, objectsSnapshot } from '../../src/shared/board-model.ts';

// Select the first `n` sticky notes: one plain press, then Shift+press each.
function selectNotes(h: ReturnType<typeof renderBoard7>, n: number): void {
  h.press(h.note(0), 300, 300);
  h.release(h.note(0), 300, 300);
  for (let i = 1; i < n; i++) {
    h.press(h.note(i), 300, 300, { shiftKey: true, pointerId: i + 1 });
    h.release(h.note(i), 300, 300, { shiftKey: true, pointerId: i + 1 });
  }
}

describe('selection bar (sel.interaction)', () => {
  // TC-16: everyone else deletes every object this client had selected. The
  // selection drops to empty and the bar goes with it (no stale "2 selected").
  it('TC-16 hides the bar when every selected object is deleted remotely', async () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 100, y: 100 });
    const b = seedSticky(h.doc(), { x: 400, y: 100 });
    selectNotes(h, 2);
    expect(h.selectionCount()).toBe('2 selected');

    act(() => {
      deleteObjects(h.doc(), [a, b]);
    });
    await settle();

    expect(h.selected()).toHaveLength(0);
    expect(h.view.queryByTestId('selection-bar')).toBeNull();
    expect(h.noteToolbar()).toBeNull();
    expect(objectsSnapshot(h.doc())).toHaveLength(0);
  });

  // TC-17: several objects selected — the count, the Delete button, and the
  // polite live region that speaks the count when it changes.
  it('TC-17 shows "2 selected" and a Delete button in a polite live region', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 100, y: 100 });
    seedSticky(h.doc(), { x: 400, y: 100 });
    selectNotes(h, 2);

    expect(h.view.queryByTestId('selection-bar')).not.toBeNull();
    expect(h.selectionCount()).toBe('2 selected');
    const count = h.view.getByTestId('selection-count');
    expect(count.getAttribute('aria-live')).toBe('polite');

    const button = h.barDeleteButton();
    expect(button).not.toBeNull();
    // It deletes the selection, all of it, in one go.
    fireEvent.click(button!);
    expect(h.selected()).toHaveLength(0);
    expect(objectsSnapshot(h.doc())).toHaveLength(0);
  });

  // TC-18: one sticky selected — the note's own story 2 toolbar takes the slot,
  // not the multi-selection bar.
  it('TC-18 shows the note toolbar instead of the bar for one sticky', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 100, y: 100 });
    h.press(h.note(0), 300, 300);
    h.release(h.note(0), 300, 300);

    expect(h.noteToolbar()).not.toBeNull();
    expect(h.view.queryByTestId('selection-bar')).toBeNull();
    expect(h.selectionCount()).toBeNull();
    expect(h.selected()).toHaveLength(1);
  });

  // TC-19: a click on empty space with no drag clears the selection; a drag on
  // empty space is a pan and leaves it alone.
  it('TC-19 clears the selection on an empty-space click without drag', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 100, y: 100 });
    h.press(h.note(0), 300, 300);
    h.release(h.note(0), 300, 300);
    expect(h.selected()).toHaveLength(1);

    h.press(h.viewport(), 20, 20, { pointerId: 9 });
    h.release(h.viewport(), 20, 20, { pointerId: 9 });
    expect(h.selected()).toHaveLength(0);

    // And the negative: panning away does not clear a selection.
    h.press(h.note(0), 300, 300);
    h.release(h.note(0), 300, 300);
    h.dragEmpty({ x: 20, y: 20 }, { x: 120, y: 60 }, { pointerId: 10 });
    expect(h.selected()).toHaveLength(1);
  });

  // Boundary: the bar counts whatever is selected, including a selection that
  // mixes a sticky with a type this story invented for the test.
  it('TC-18 boundary: one non-sticky object selected shows the bar, not the note toolbar', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 100, y: 100 });
    const box = seedBox(h.doc(), { x: 400, y: 100, width: 120, height: 80 });
    h.press(h.box(0), 450, 130);
    h.release(h.box(0), 450, 130);

    expect(h.selectedIds()).toEqual([box]);
    expect(h.selectionCount()).toBe('1 selected');
    expect(h.noteToolbar()).toBeNull();
    expect(h.barDeleteButton()).not.toBeNull();
  });

  // Story 2's rule, kept through the generic path: nothing of the selection's
  // floats over a note you are typing into. The outline stays, the bar does not.
  it('TC-16 boundary: the bar is out of the way while a selected note is edited', async () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 100, y: 100 });
    selectNotes(h, 1);
    expect(h.noteToolbar()).not.toBeNull();

    h.key('Enter'); // the board's own "open the text of the one selected note"
    await settle();

    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument();
    expect(h.noteToolbar()).toBeNull();
    expect(h.view.queryByTestId('selection-bar')).toBeNull();
    expect(h.selected()).toHaveLength(1);
  });
});
