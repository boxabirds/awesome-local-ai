import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/client/App';
import { STICKY_FONT_MAX_PX, STICKY_FONT_MIN_PX, DRAG_THRESHOLD_PX } from '../../src/shared/config';
import { fitFontSize, fitTextFontSize, STICKY_TEXT_BOX_WORLD } from '../../src/client/objects/StickyText';
import { proseOfLength } from '../fixtures/texts';
import { dispatchKey, dispatchPointer, flushFrame, getCamera } from './util';
import {
  clickCreateSticky,
  clickElement,
  clickEmptyBoard,
  clickWithPointer,
  createUnselectedNote,
  dispatchDblClick,
  dragWithPointer,
  getSelection,
  getSnapshot,
  modelDelete,
  noteEl,
  noteEls,
  press,
  typeText,
  viewportEl,
} from './stickyUtil';

const AT = { x: 300, y: 200 };

/** Two notes, both unselected, holding the given text (in creation order). */
async function twoUnselectedNotes(a: string, b: string): Promise<void> {
  await createUnselectedNote(a);
  await clickCreateSticky();
  await typeText(b);
  await press('{Escape}');
  clickEmptyBoard();
  expect(getSnapshot()).toHaveLength(2);
}

describe('StickyNote (sticky.interaction)', () => {
  // TC-18: press + release without movement selects the note.
  it('TC-18 selects a note on press and release, showing outline and toolbar', async () => {
    render(<App />);
    const note = await createUnselectedNote();
    expect(getSelection().selectedId).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    clickWithPointer(noteEl(), AT);

    expect(getSelection().selectedId).toBe(note.id);
    const el = noteEl();
    expect(el.dataset.selected).toBe('true');
    // accessible name, not only a colour or position
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBe(el);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    expect(screen.getByTestId('delete-note').getAttribute('aria-label')).toBe('Delete note');
  });

  // TC-19: movement below DRAG_THRESHOLD_PX selects but never moves (boundary 2px).
  it('TC-19 keeps a sub-threshold press as a selection and never moves the note', async () => {
    render(<App />);
    const note = await createUnselectedNote();
    const el = noteEl();

    dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: AT.x, clientY: AT.y });
    dispatchPointer(el, 'pointermove', {
      pointerId: 1,
      clientX: AT.x + DRAG_THRESHOLD_PX - 1,
      clientY: AT.y,
    });
    dispatchPointer(el, 'pointerup', {
      pointerId: 1,
      clientX: AT.x + DRAG_THRESHOLD_PX - 1,
      clientY: AT.y,
    });
    await flushFrame();

    expect(el.dataset.dragging).toBe('false');
    expect(getSelection().selectedId).toBe(note.id);
    const after = getSnapshot()[0]!;
    expect(after.x).toBe(note.x);
    expect(after.y).toBe(note.y);
    expect(after.z).toBe(note.z); // bringToFront only runs for a real drag
  });

  // TC-20: movement at the threshold drags, and the board camera never moves.
  it('TC-20 drags at exactly DRAG_THRESHOLD_PX without panning the board', async () => {
    render(<App />);
    const note = await createUnselectedNote();
    const cameraBefore = getCamera();
    const el = noteEl();

    dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: AT.x, clientY: AT.y });
    dispatchPointer(el, 'pointermove', {
      pointerId: 1,
      clientX: AT.x + DRAG_THRESHOLD_PX,
      clientY: AT.y,
    });
    expect(noteEl().dataset.dragging).toBe('true');
    await flushFrame(); // the rAF-throttled move lands
    dispatchPointer(el, 'pointerup', {
      pointerId: 1,
      clientX: AT.x + DRAG_THRESHOLD_PX,
      clientY: AT.y,
    });

    const after = getSnapshot()[0]!;
    const zoom = getCamera().zoom; // 100% in jsdom
    expect(after.x).toBeCloseTo(note.x + DRAG_THRESHOLD_PX / zoom, 6);
    expect(after.y).toBe(note.y);
    // the board did not pan: identical camera, and the note stayed selected
    expect(getCamera().x).toBe(cameraBefore.x);
    expect(getCamera().y).toBe(cameraBefore.y);
    expect(getCamera().zoom).toBe(cameraBefore.zoom);
    expect(getSelection().selectedId).toBe(note.id);
  });

  // TC-21: a cancelled drag keeps the last applied position and stays selected.
  it('TC-21 keeps the last applied position when the drag is cancelled', async () => {
    render(<App />);
    const note = await createUnselectedNote();
    const el = noteEl();

    dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: AT.x, clientY: AT.y });
    dispatchPointer(el, 'pointermove', { pointerId: 1, clientX: AT.x + 4, clientY: AT.y });
    await flushFrame();
    const applied = getSnapshot()[0]!;

    // pending move that must NOT be applied by the cancellation
    dispatchPointer(el, 'pointermove', { pointerId: 1, clientX: AT.x + 90, clientY: AT.y + 40 });
    dispatchPointer(el, 'pointercancel', { pointerId: 1, clientX: AT.x + 90, clientY: AT.y + 40 });
    await flushFrame();

    const after = getSnapshot()[0]!;
    expect(after.x).toBeCloseTo(applied.x, 6);
    expect(after.y).toBeCloseTo(applied.y, 6);
    expect(noteEl().dataset.dragging).toBe('false');
    expect(getSelection().selectedId).toBe(note.id);
  });

  // TC-22: clicking empty board space clears the selection and the toolbar.
  it('TC-22 clears the selection when empty board space is clicked', async () => {
    render(<App />);
    await createUnselectedNote();
    clickWithPointer(noteEl(), AT);
    expect(getSelection().selectedId).not.toBeNull();
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    clickEmptyBoard({ x: 700, y: 60 });

    expect(getSelection().selectedId).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(noteEl().dataset.selected).toBe('false');
  });

  // TC-25 (Delete): only the selected note is removed by the keyboard.
  it('TC-25 deletes the selected note with Delete', async () => {
    render(<App />);
    await twoUnselectedNotes('first', 'second');

    clickWithPointer(noteEls()[1]!, AT); // the later note
    dispatchKey({ key: 'Delete' });

    expect(getSnapshot()).toHaveLength(1);
    expect(getSnapshot()[0]!.text).toBe('first'); // the other note survives
    expect(getSelection().selectedId).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // TC-25 (Backspace): same behaviour, separate run.
  it('TC-25 deletes the selected note with Backspace', async () => {
    render(<App />);
    await twoUnselectedNotes('first', 'second');

    clickWithPointer(noteEls()[0]!, AT); // the earlier note
    dispatchKey({ key: 'Backspace' });

    expect(getSnapshot()).toHaveLength(1);
    expect(getSnapshot()[0]!.text).toBe('second');
    expect(getSelection().selectedId).toBeNull();
  });

  // TC-35 (negative): a double-click on a note edits it, never creates another.
  it('TC-35 double-clicking a note edits it instead of creating a new note', async () => {
    render(<App />);
    const note = await createUnselectedNote();
    expect(getSnapshot()).toHaveLength(1);

    dispatchDblClick(noteEl(), AT);

    expect(getSnapshot()).toHaveLength(1); // no extra note
    expect(getSelection()).toEqual({ selectedId: note.id, editingId: note.id });
    expect(screen.getByTestId('sticky-note-input')).not.toBeNull();
  });

  // TC-36 (negative): Enter without a selection creates and edits nothing.
  it('TC-36 ignores Enter when nothing is selected', async () => {
    render(<App />);
    dispatchKey({ key: 'Enter' });
    expect(getSnapshot()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note-input')).toBeNull();

    await createUnselectedNote(); // a note exists but is not selected
    dispatchKey({ key: 'Enter' });
    expect(getSnapshot()).toHaveLength(1);
    expect(getSelection().editingId).toBeNull();
    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
  });

  // TC-37 (error path): the note vanishes mid-drag / mid-edit.
  it('TC-37 ends a drag silently when the note is deleted underneath it', async () => {
    render(<App />);
    const note = await createUnselectedNote();
    const el = noteEl();

    dispatchPointer(el, 'pointerdown', { pointerId: 1, clientX: AT.x, clientY: AT.y });
    dispatchPointer(el, 'pointermove', { pointerId: 1, clientX: AT.x + 30, clientY: AT.y });
    await flushFrame();

    modelDelete(note.id); // another client wins

    expect(() =>
      dispatchPointer(el, 'pointermove', { pointerId: 1, clientX: AT.x + 60, clientY: AT.y }),
    ).not.toThrow();
    await flushFrame();
    dispatchPointer(el, 'pointerup', { pointerId: 1, clientX: AT.x + 60, clientY: AT.y });
    await flushFrame();

    expect(getSnapshot()).toHaveLength(0); // gone, and never re-created
    expect(getSelection().selectedId).toBeNull();
  });

  it('TC-37 ends editing silently when the note is deleted underneath it', async () => {
    render(<App />);
    await clickCreateSticky();
    await typeText('abc');
    const id = getSnapshot()[0]!.id;

    modelDelete(id);

    expect(screen.queryByTestId('sticky-note-input')).toBeNull();
    await press('d'); // typing afterwards must not bring the note back
    expect(getSnapshot()).toHaveLength(0);
    expect(getSelection().editingId).toBeNull();
  });

  // The board's own double-click creates a note; a toolbar click keeps focus sane.
  it('creates a note on double-click of empty board space and starts editing', async () => {
    render(<App />);
    dispatchDblClick(viewportEl(), { x: 400, y: 300 });

    const created = getSnapshot();
    expect(created).toHaveLength(1);
    // viewport centre in jsdom is (512, 384) at zoom 1, so world (0,0) is the
    // camera centre; the note is centred on the point instead.
    expect(created[0]!.x).toBeCloseTo(400 - 512 - 100, 6);
    expect(created[0]!.y).toBeCloseTo(300 - 384 - 100, 6);
    expect(getSelection()).toEqual({ selectedId: created[0]!.id, editingId: created[0]!.id });

    await typeText('Hello');
    expect(getSnapshot()[0]!.text).toBe('Hello');
  });

  // The font fit runs against the note that is in the document. jsdom has no
  // layout at all, so the note's height is stubbed with a deterministic fake
  // wrap; the browser (TC-33) covers real font metrics.
  it('fits the text by measuring the note in the document', async () => {
    render(<App />);
    await clickCreateSticky();
    const inner = screen.getByTestId('sticky-text-inner');
    // an empty note keeps the maximum size
    expect(inner.style.fontSize).toBe(`${STICKY_FONT_MAX_PX}px`);

    const fakeHeight = (text: string, fontPx: number): number => {
      const charsPerLine = Math.max(1, Math.floor(STICKY_TEXT_BOX_WORLD / (fontPx / 2)));
      return Math.ceil(text.length / charsPerLine) * fontPx * 1.35;
    };
    Object.defineProperty(inner, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return fakeHeight(this.textContent ?? '', parseFloat(this.style.fontSize) || 24);
      },
    });

    const text = proseOfLength(200);
    await typeText(text);

    const expected = fitTextFontSize(text, (fontPx) => fakeHeight(text, fontPx));
    expect(expected.fontPx).toBeLessThan(STICKY_FONT_MAX_PX);
    expect(expected.fontPx).toBeGreaterThanOrEqual(STICKY_FONT_MIN_PX);
    expect(screen.getByTestId('sticky-text-inner').style.fontSize).toBe(
      `${expected.fontPx}px`,
    );
    // fitFontSize measures through the element and applies what it returns
    const el = screen.getByTestId('sticky-text-inner');
    expect(fitFontSize(el).fontPx).toBe(expected.fontPx);
    expect(el.style.fontSize).toBe(`${expected.fontPx}px`);
  });

  it('drags the bottom note of an overlapping pair and raises it above the other', async () => {
    render(<App />);
    const bottom = await createUnselectedNote('First');
    const top = await createUnselectedNote('Second');
    // both were created at the view centre, so they overlap exactly
    expect(getSnapshot().map((n) => n.id)).toEqual([bottom.id, top.id]);

    // The bottom note is the first in paint order, i.e. the first in the DOM.
    dragWithPointer(noteEl(0), AT, { x: AT.x + 40, y: AT.y + 20 });

    const all = getSnapshot();
    const was = all.find((n) => n.id === bottom.id)!;
    expect(was.x).toBeCloseTo(bottom.x + 40, 6);
    expect(was.y).toBeCloseTo(bottom.y + 20, 6);
    // it is drawn above the note it overlaps, and stays there after the release
    expect(all.map((n) => n.id)).toEqual([top.id, bottom.id]);
    expect(getSelection()).toEqual({ selectedId: bottom.id, editingId: null });
  });

  it('keeps the selection when a toolbar button is clicked', async () => {
    render(<App />);
    const note = await createUnselectedNote();
    clickWithPointer(noteEl(), AT);

    await clickElement(screen.getByTestId('color-green'));

    expect(getSnapshot()[0]!.color).toBe('green');
    expect(getSelection().selectedId).toBe(note.id); // toolbar clicks never deselect
  });
});
