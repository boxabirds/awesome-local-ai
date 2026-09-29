// Story 7, sel.keyboard — select all, nudge, delete (TC-27 to TC-31). The keys
// are listened for on window; every one of them that the board consumes must
// call preventDefault so the page itself does not also scroll, select its own
// text, or navigate back.
import { describe, it, expect } from 'vitest';
import {
  renderBoard7,
  seedSticky,
  seedBox,
  act,
  fireEvent,
  screen,
  settle,
} from './story7TestUtils.tsx';
import { objectsSnapshot, createSticky } from '../../src/shared/board-model.ts';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config.ts';

// The board's own key handler listens on window; a key event that it consumes
// comes back defaultPrevented, which is what fireEvent reports as false.
function press(h: ReturnType<typeof renderBoard7>, key: string, mods: { shift?: boolean; ctrl?: boolean; meta?: boolean } = {}): boolean {
  void h;
  return fireEvent.keyDown(window, {
    key,
    shiftKey: mods.shift === true,
    ctrlKey: mods.ctrl === true,
    metaKey: mods.meta === true,
    bubbles: true,
    cancelable: true,
  });
}

describe('board keyboard (sel.keyboard)', () => {
  // TC-27: Ctrl/Cmd+A selects every object on the board and stops the browser's
  // "select all" from reaching the page.
  it('TC-27 Ctrl+A selects all and is prevented', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 400, y: 0 });
    const box = seedBox(h.doc(), { x: 800, y: 0, width: 60, height: 60 });

    expect(press(h, 'a', { ctrl: true })).toBe(false);
    expect(h.selectedIds()).toEqual([a, b, box].sort());
    expect(h.selectionCount()).toBe('3 selected');
  });

  it('TC-27 Cmd+A does the same on a Mac keyboard', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 400, y: 0 });

    expect(press(h, 'a', { meta: true })).toBe(false);
    expect(h.selectedIds()).toEqual([a, b].sort());
  });

  // TC-28 (boundary): select all on a board with nothing on it is a no-op that
  // still does not throw, still does not select, and shows nothing.
  it('TC-28 Ctrl+A on an empty board selects nothing and errors nothing', () => {
    const h = renderBoard7();

    expect(() => press(h, 'a', { ctrl: true })).not.toThrow();
    expect(h.selectedIds()).toEqual([]);
    expect(h.view.queryByTestId('selection-bar')).toBeNull();
    expect(h.handles()).toHaveLength(0);

    // And it stays harmless after the board fills up and empties again.
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    press(h, 'a', { ctrl: true });
    expect(h.selectedIds()).toEqual([a]);
    act(() => {
      objectsSnapshot(h.doc());
    });
  });

  // TC-29: the arrows nudge the whole selection; Shift is the large step. Every
  // one is prevented so the page never scrolls, and the board never pans.
  it('TC-29 nudges the selection by one step and by the large step', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const b = seedSticky(h.doc(), { x: 400, y: 0 });
    press(h, 'a', { ctrl: true });
    const cam = h.cam();

    expect(press(h, 'ArrowRight')).toBe(false);
    expect(h.pos(h.object(a)!)).toEqual({ x: NUDGE_STEP_WORLD, y: 0 });
    expect(h.pos(h.object(b)!)).toEqual({ x: 400 + NUDGE_STEP_WORLD, y: 0 });

    expect(press(h, 'ArrowUp', { shift: true })).toBe(false);
    expect(h.pos(h.object(a)!).y).toBe(-NUDGE_LARGE_STEP_WORLD);
    expect(h.pos(h.object(b)!).y).toBe(-NUDGE_LARGE_STEP_WORLD);

    for (const key of ['ArrowLeft', 'ArrowDown']) {
      expect(press(h, key)).toBe(false);
    }
    expect(h.pos(h.object(a)!)).toEqual({ x: NUDGE_STEP_WORLD - 1, y: -NUDGE_LARGE_STEP_WORLD + 1 });

    // Nudging is a model write, not a camera move: nothing panned.
    expect(h.cam()).toEqual(cam);
  });

  // Shift+Arrow is the large step; holding Ctrl/Cmd as well does not make it
  // larger still - only Shift changes the step.
  it('TC-29 Ctrl/Cmd+Arrow keeps the normal step', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    h.press(h.object(a), 100, 100);
    h.release(h.object(a), 100, 100);

    press(h, 'ArrowRight', { ctrl: true });
    expect(h.pos(h.object(a)!).x).toBe(NUDGE_STEP_WORLD);
    press(h, 'ArrowDown', { ctrl: true, shift: true });
    expect(h.pos(h.object(a)!).y).toBe(NUDGE_LARGE_STEP_WORLD);
  });

  // Nothing selected: the arrows are not the board's business at all.
  it('TC-29 arrows with nothing selected write nothing and scroll the page instead', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    const before = objectsSnapshot(h.doc()).map((o) => [o.x, o.y]);

    // fireEvent returns true: the board left the key alone.
    expect(press(h, 'ArrowRight')).toBe(true);
    expect(press(h, 'ArrowUp', { shift: true })).toBe(true);
    expect(objectsSnapshot(h.doc()).map((o) => [o.x, o.y])).toEqual(before);
    expect(h.selectedIds()).toEqual([]);
    expect(h.object(a)).not.toBeNull(); // the note is untouched, just unselected
  });

  // TC-30 (negative): while a text editor has the focus, Backspace is text
  // editing, not a delete. The object and its text survive.
  it('TC-30 Backspace while editing edits text and keeps the object', async () => {
    const h = renderBoard7();
    fireEvent.click(screen.getByTestId('sticky-create'));
    await settle();
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: 'a' });
    editor.value = 'ab';
    fireEvent.input(editor, { target: { value: 'ab' } });
    await settle();

    // Backspace goes to the editor: the caret does the work, the note stays.
    expect(press(h, 'Backspace')).toBe(true);
    await settle();
    expect(h.notes()).toHaveLength(1);
    expect(screen.getByTestId('sticky-editor')).toBeInTheDocument();

    // The same for the whole selection: the objects are still there afterwards.
    const doc = h.doc();
    expect(objectsSnapshot(doc)).toHaveLength(1);
    // Escape leaves the edit with the text kept, and only then do keys belong
    // to the board again.
    h.escapeEditor();
    await settle();
    expect(press(h, 'Backspace')).toBe(false);
    expect(objectsSnapshot(doc)).toHaveLength(0);
  });

  // TC-31: Delete removes every selected object in one go and leaves no
  // selection behind.
  it('TC-31 Delete removes the whole selection', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });
    seedSticky(h.doc(), { x: 400, y: 0 });
    keepOne(h);
    press(h, 'a', { ctrl: true });
    expect(h.selectedIds()).toHaveLength(3);

    expect(press(h, 'Delete')).toBe(false);
    expect(objectsSnapshot(h.doc())).toHaveLength(0);
    expect(h.selectedIds()).toEqual([]);
    expect(h.view.queryByTestId('selection-bar')).toBeNull();
    expect(h.handles()).toHaveLength(0);
  });

  it('TC-31 Backspace deletes the selection when no text is being edited', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });
    seedSticky(h.doc(), { x: 400, y: 0 });
    press(h, 'a', { ctrl: true });

    expect(press(h, 'Backspace')).toBe(false);
    expect(objectsSnapshot(h.doc())).toHaveLength(0);
    expect(h.selectedIds()).toEqual([]);
  });

  // Escape gives up the selection without deleting anything.
  it('Escape clears the selection and deletes nothing', () => {
    const h = renderBoard7();
    seedSticky(h.doc(), { x: 0, y: 0 });
    press(h, 'a', { ctrl: true });
    expect(h.selectedIds()).toHaveLength(1);

    expect(press(h, 'Escape')).toBe(false);
    expect(h.selectedIds()).toEqual([]);
    expect(objectsSnapshot(h.doc())).toHaveLength(1);
  });

  // A key press inside a form field on the board (the share panel's link input)
  // is not the board's business either.
  it('keys typed in an input are left to the input', () => {
    const h = renderBoard7();
    const a = seedSticky(h.doc(), { x: 0, y: 0 });
    press(h, 'a', { ctrl: true });
    const input = document.createElement('input');
    document.body.appendChild(input);

    const prevented = fireEvent.keyDown(input, {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    expect(prevented).toBe(true);
    expect(objectsSnapshot(h.doc())).toHaveLength(1);
    expect(a).toBeTruthy();
    input.remove();
  });
});

// A third object created straight in the model, so the test does not have to
// drive the toolbar three times.
function keepOne(h: ReturnType<typeof renderBoard7>): void {
  act(() => {
    createSticky(h.doc(), { x: 0, y: 800 });
  });
}

// Regression: creating a second note the normal way - double-click empty space -
// has to open its editor too. The first create works and the second one used to
// leave the note merely selected, which only a sequence of real creations shows.
describe('creating notes one after another', () => {
  it('each new note gets its own editor and can be typed into', async () => {
    const h = renderBoard7();
    await settle();

    const spots = [
      { x: 400, y: 300 },
      { x: 800, y: 300 },
      { x: 400, y: 620 },
    ];
    const created: string[] = [];
    for (const spot of spots) {
      if (screen.queryByTestId('sticky-editor')) h.escapeEditor(); // leave the previous one
      // The product's own way in: double-click the empty board at that point.
      fireEvent.doubleClick(h.viewport(), { clientX: spot.x, clientY: spot.y });
      await settle();
      const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
      expect(editor).toBeInTheDocument();
      editor.value = `${created.length} words here`;
      fireEvent.input(editor);
      await settle();
      fireEvent.keyDown(editor, { key: 'Escape' }); // commit and leave
      await settle();
      created.push(h.idsOfNotes()[created.length]);
    }

    expect(h.idsOfNotes()).toHaveLength(3);
    // The note's own text layer, not the note element, which also houses the
    // hidden font-measuring mirror.
    const texts = h.notes().map((el) => el.querySelector('.sticky-text')?.textContent ?? '');
    expect(texts).toContain('0 words here');
    expect(texts).toContain('1 words here');
    expect(texts).toContain('2 words here');
    // The last note is left selected (committing text does not deselect), and no
    // editor is open.
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(h.selectedIds()).toEqual([created[2]]);
  });
});
