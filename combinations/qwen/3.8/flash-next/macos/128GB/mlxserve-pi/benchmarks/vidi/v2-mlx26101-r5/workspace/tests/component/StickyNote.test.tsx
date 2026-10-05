/**
 * Component tests for sticky note interaction (design capability
 * `sticky.interaction`): the per-note state machine Unselected -> Pressed ->
 * Selected / Dragging -> Editing, deletion from the keyboard, and the rule that
 * a note owns its own pointer events so the board never pans.
 *
 * jsdom has no layout, so positions are asserted through the note's
 * `data-x` / `data-y` attributes (world coordinates straight from the document);
 * pixel-accurate dragging under real layout is covered e2e.
 */

import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { deleteObject, moveObject } from '../../src/shared/board-model';
import {
  board,
  click,
  doubleClick,
  pointer,
  renderBoard,
  renderedCamera,
  settle,
  type BoardFixture,
} from './harness';

const PRESS = { x: 300, y: 200 };
/** Half a note: the point a note created "at 0,0" has as its top-left. */
const HALF = STICKY_SIZE_WORLD / 2;

/** Presses and releases a note without moving: a click. */
async function pressNote(fx: BoardFixture, id: string, point = PRESS): Promise<void> {
  const el = fx.noteEl(id);
  if (!el) throw new Error('note is not rendered');
  await click(el, point);
}

/** Presses a note and moves it `dx` pixels, then returns the note element. */
async function moveNote(fx: BoardFixture, id: string, dx: number, pointerId = 1): Promise<void> {
  const el = fx.noteEl(id);
  if (!el) throw new Error('note is not rendered');
  pointer('pointerDown', el, { ...PRESS, pointerId });
  pointer('pointerMove', el, { x: PRESS.x + dx, y: PRESS.y, pointerId });
  await settle();
}

describe('selecting a sticky note', () => {
  it('TC-18 selects on press and release without movement, with outline and toolbar', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');

    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-label')).toBe('Sticky note');
    expect(el.tabIndex).toBe(0); // reachable with Tab
    expect(el.dataset['selected']).toBeUndefined();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    await pressNote(fx, id);

    expect(fx.selection().selectedId).toBe(id);
    expect(fx.noteBox(id).selected).toBe(true);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    expect(el.dataset['interaction']).toBe('selected');
  });

  it('TC-19 keeps a 2 px press a selection, not a drag', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const before = fx.noteBox(id);
    expect(DRAG_THRESHOLD_PX).toBe(3);
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');

    pointer('pointerDown', el, { ...PRESS, pointerId: 1 });
    pointer('pointerMove', el, { x: PRESS.x + 2, y: PRESS.y, pointerId: 1 });
    await settle();
    // Below the threshold: no moveObject, so the position is untouched.
    expect(fx.noteBox(id).x).toBe(before.x);
    expect(fx.noteBox(id).y).toBe(before.y);
    expect(el.dataset['interaction']).toBe('pressed');

    pointer('pointerUp', el, { x: PRESS.x + 2, y: PRESS.y, pointerId: 1 });
    await settle();
    expect(fx.noteBox(id).x).toBe(before.x);
    expect(fx.selection().selectedId).toBe(id);
  });

  it('TC-20 turns a movement of exactly DRAG_THRESHOLD_PX into a drag and leaves the camera alone', async () => {
    const fx = renderBoard();
    const lower = await fx.create(0, 0);
    const upper = await fx.create(400, 0);
    const before = fx.noteBox(lower);
    expect(before.z).toBeLessThan(fx.noteBox(upper).z);
    const camera = renderedCamera();
    const el = fx.noteEl(lower);
    if (!el) throw new Error('note is not rendered');

    pointer('pointerDown', el, { ...PRESS, pointerId: 1 });
    expect(board().dataset['panning']).toBe('false');
    pointer('pointerMove', el, { x: PRESS.x + DRAG_THRESHOLD_PX, y: PRESS.y, pointerId: 1 });
    await settle();

    expect(el.dataset['interaction']).toBe('dragging');
    expect(fx.noteBox(lower).x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX / camera.zoom, 6);
    // bringToFront ran once, at the start of the drag: the note is above the other.
    expect(fx.noteBox(lower).z).toBeGreaterThan(fx.noteBox(upper).z);
    // Dragging a note never pans the board.
    expect(board().dataset['panning']).toBe('false');
    expect(renderedCamera()).toEqual(camera);

    pointer('pointerUp', el, { x: PRESS.x + DRAG_THRESHOLD_PX, y: PRESS.y, pointerId: 1 });
    await settle();
    expect(renderedCamera()).toEqual(camera);
    expect(fx.selection().selectedId).toBe(lower);
    expect(fx.selection().editingId).toBeNull();
  });

  it('TC-21 keeps the last applied position when a drag is cancelled', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const before = fx.noteBox(id);
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');

    pointer('pointerDown', el, { ...PRESS, pointerId: 1 });
    pointer('pointerMove', el, { x: PRESS.x + 20, y: PRESS.y + 6, pointerId: 1 });
    await settle();
    const shown = fx.noteBox(id);
    expect(shown.x).toBeCloseTo(before.x + 20, 6);

    pointer('pointerCancel', el, { x: PRESS.x + 20, y: PRESS.y + 6, pointerId: 1 });
    await settle();
    expect(fx.noteBox(id).x).toBe(shown.x);
    expect(fx.noteBox(id).y).toBe(shown.y);
    expect(fx.selection().selectedId).toBe(id);
    expect(fx.noteEl(id)?.dataset['interaction']).toBe('selected');
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });

  it('TC-22 clears the selection and hides the toolbar when empty board space is clicked', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await pressNote(fx, id);
    expect(fx.selection().selectedId).toBe(id);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    await click(board(), { x: 60, y: 620 });
    expect(fx.selection().selectedId).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(fx.noteBox(id).selected).toBe(false);
  });

  it("leaves the camera exactly where it was, because the note owns the pointer events", async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const camera = renderedCamera();
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');

    // Three pointer devices: dragging the note with one while another pans the
    // board must not interfere (design: per-pointerId state).
    pointer('pointerDown', el, { ...PRESS, pointerId: 1 });
    pointer('pointerMove', el, { x: PRESS.x + 8, y: PRESS.y, pointerId: 2 });
    await settle();
    expect(renderedCamera()).toEqual(camera);
    expect(fx.noteBox(id).x).toBe(-HALF); // a pointerId we never pressed with is ignored
    pointer('pointerUp', el, { x: PRESS.x + 8, y: PRESS.y, pointerId: 1 });
    await settle();
    expect(renderedCamera()).toEqual(camera);
  });
});

describe('deleting a sticky note from the keyboard', () => {
  it('TC-25 removes the selected note on Delete', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await pressNote(fx, id);

    fireEvent.keyDown(window, { key: 'Delete' });
    await settle();
    expect(fx.notes()).toHaveLength(0);
    expect(fx.noteEl(id)).toBeNull();
    expect(fx.selection().selectedId).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25 removes the selected note on Backspace', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await pressNote(fx, id);

    fireEvent.keyDown(window, { key: 'Backspace' });
    await settle();
    expect(fx.notes()).toHaveLength(0);
    expect(fx.selection().selectedId).toBeNull();
  });

  it('leaves the note alone when nothing is selected', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    fireEvent.keyDown(window, { key: 'Delete' });
    await settle();
    expect(fx.notes()).toHaveLength(1);
    expect(fx.noteEl(id)).not.toBeNull();
  });
});

describe('editing from a note', () => {
  it('TC-35 edits the note under a double-click instead of creating a new one', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await fx.setText(id, 'Faster onboarding');
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');

    doubleClick(el);
    await settle();

    expect(fx.notes()).toHaveLength(1); // no second note was created
    expect(fx.selection().selectedId).toBe(id);
    expect(fx.selection().editingId).toBe(id);
    expect(screen.getByTestId('sticky-editor')).not.toBeNull();
  });

  it('TC-36 does nothing on Enter while nothing is selected', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);

    fireEvent.keyDown(window, { key: 'Enter' });
    await settle();
    expect(fx.notes()).toHaveLength(1);
    expect(fx.selection().editingId).toBeNull();
    expect(fx.selection().selectedId).toBeNull();
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(fx.noteEl(id)).not.toBeNull();
  });

  it('TC-37 ends a drag silently when the note is deleted by somebody else', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await moveNote(fx, id, 10);
    expect(fx.noteEl(id)?.dataset['interaction']).toBe('dragging');

    await fx.delete(id);
    expect(fx.noteEl(id)).toBeNull();

    // The interrupted interaction must not throw and must not resurrect the note.
    const surface = board();
    expect(() => {
      pointer('pointerMove', surface, { x: PRESS.x + 30, y: PRESS.y, pointerId: 1 });
      pointer('pointerUp', surface, { x: PRESS.x + 30, y: PRESS.y, pointerId: 1 });
    }).not.toThrow();
    await settle();
    expect(fx.notes()).toHaveLength(0);
    expect(fx.noteEl(id)).toBeNull();
  });

  it('TC-37 ends editing silently when the note is deleted by somebody else', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');
    doubleClick(el);
    await settle();
    expect(screen.getByTestId('sticky-editor')).not.toBeNull();

    await fx.delete(id);
    await settle();
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(fx.notes()).toHaveLength(0);
    expect(() => {
      pointer('pointerUp', board(), { ...PRESS, pointerId: 1 });
    }).not.toThrow();
    await settle();
    expect(fx.notes()).toHaveLength(0);
  });

  it('ignores a move of a note the model refuses to move', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await fx.setText(id, 'kept');
    const before = fx.noteBox(id);
    // A move applied straight to the document, as another client would send it.
    expect(moveObject(fx.doc(), 'not-an-id', 999, 999)).toBe(false);
    await settle();
    expect(fx.noteBox(id)).toEqual(before);
    expect(deleteObject(fx.doc(), 'not-an-id')).toBe(false);
    await settle();
    expect(fx.notes()).toHaveLength(1);
  });

  it('hides the note toolbar while dragging and while editing', async () => {
    const fx = renderBoard();
    const id = await fx.create(0, 0);
    await pressNote(fx, id);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    await moveNote(fx, id, 12);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    const up = fx.noteEl(id);
    if (!up) throw new Error('note is not rendered');
    pointer('pointerUp', up, { x: PRESS.x + 12, y: PRESS.y, pointerId: 1 });
    await settle();
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    const el = fx.noteEl(id);
    if (!el) throw new Error('note is not rendered');
    doubleClick(el);
    await settle();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('stacks notes by z, so the last created one is rendered last', async () => {
    const fx = renderBoard();
    const first = await fx.create(-100, 0);
    const second = await fx.create(100, 0);
    const elements = [...document.querySelectorAll<HTMLElement>('[data-note-id]')];
    expect(elements.map((el) => el.dataset['noteId'])).toEqual([first, second]);
    expect(fx.noteBox(first).z).toBe(1);
    expect(fx.noteBox(second).z).toBe(2);
  });
});
