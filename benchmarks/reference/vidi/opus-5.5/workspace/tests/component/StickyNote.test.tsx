import { act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetCamera } from '../../src/client/canvas/camera';
import { deleteObject } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { TEST_VIEWPORT } from './setup';
import {
  board,
  camera,
  click,
  clickEmptyBoard,
  createSelectedNote,
  doc,
  doubleClickBoard,
  editor,
  flushFrame,
  move,
  noteEls,
  noteToolbar,
  notes,
  onlyNoteEl,
  press,
  release,
  renderBoard,
} from './stickyHelpers';

const HALF = 2;
const AT = { x: 400, y: 300 } as const;
const INITIAL_CAMERA = resetCamera(TEST_VIEWPORT);
const BELOW_THRESHOLD_PX = DRAG_THRESHOLD_PX - 1;
const FIRST_MOVE_PX = 10;
const SECOND_MOVE_PX = 20;

function only() {
  const all = notes();
  expect(all).toHaveLength(1);
  return all[0]!;
}

function isSelected(el: HTMLElement): boolean {
  return el.dataset.selected === 'true';
}

describe('sticky.interaction', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('double-click on empty board creates a note centred on the point, in edit mode', () => {
    expect(noteEls()).toHaveLength(0);
    doubleClickBoard(AT.x, AT.y);
    const note = only();
    const world = { x: AT.x / INITIAL_CAMERA.zoom + INITIAL_CAMERA.x, y: AT.y / INITIAL_CAMERA.zoom + INITIAL_CAMERA.y };
    expect(note.x).toBe(world.x - STICKY_SIZE_WORLD / HALF);
    expect(note.y).toBe(world.y - STICKY_SIZE_WORLD / HALF);
    expect(note.color).toBe('yellow');
    expect(document.activeElement).toBe(editor());
  });

  it('TC-18 press and release without moving selects: outline and note toolbar shown', () => {
    const el = createSelectedNote();
    clickEmptyBoard();
    expect(isSelected(el)).toBe(false);
    expect(noteToolbar()).toBeNull();

    click(el, AT.x, AT.y);
    expect(isSelected(el)).toBe(true);
    expect(el.className).toContain('sticky-note--selected');
    expect(noteToolbar()).not.toBeNull();
  });

  it('TC-19 moving 2px (below DRAG_THRESHOLD_PX) selects without moving the note', () => {
    const el = createSelectedNote();
    clickEmptyBoard();
    const before = only();
    press(el, AT.x, AT.y);
    move(el, AT.x + BELOW_THRESHOLD_PX, AT.y);
    flushFrame();
    release(el, AT.x + BELOW_THRESHOLD_PX, AT.y);
    flushFrame();
    expect(only()).toEqual(before);
    expect(isSelected(el)).toBe(true);
  });

  it('TC-20 moving exactly 3px starts a drag; the board camera does not change', () => {
    const el = createSelectedNote();
    const before = only();
    const cameraBefore = camera();
    press(el, AT.x, AT.y);
    move(el, AT.x + DRAG_THRESHOLD_PX, AT.y);
    flushFrame();
    expect(el.className).toContain('sticky-note--dragging');
    expect(noteToolbar()).toBeNull(); // hidden while dragging
    expect(only().x).toBe(before.x + DRAG_THRESHOLD_PX);
    expect(camera()).toEqual(cameraBefore);
    expect(board().dataset.mode).toBe('idle');
    release(el, AT.x + DRAG_THRESHOLD_PX, AT.y);
    flushFrame();
    expect(camera()).toEqual(cameraBefore);
    expect(isSelected(el)).toBe(true);
    expect(noteToolbar()).not.toBeNull();
  });

  it('drag delta is divided by zoom so the grabbed point stays under the pointer', () => {
    const el = createSelectedNote();
    const zoom = 2;
    act(() => window.__vidi6?.setCamera({ x: 0, y: 0, zoom }));
    flushFrame();
    const before = only();
    press(el, AT.x, AT.y);
    move(el, AT.x + FIRST_MOVE_PX, AT.y + SECOND_MOVE_PX);
    release(el, AT.x + FIRST_MOVE_PX, AT.y + SECOND_MOVE_PX);
    flushFrame();
    expect(only().x).toBe(before.x + FIRST_MOVE_PX / zoom);
    expect(only().y).toBe(before.y + SECOND_MOVE_PX / zoom);
  });

  it('dragging brings the note to the front', () => {
    const first = createSelectedNote(AT.x, AT.y);
    createSelectedNote(AT.x + STICKY_SIZE_WORLD, AT.y);
    const firstId = first.dataset.id;
    expect(notes().at(-1)?.id).not.toBe(firstId);
    press(first, AT.x, AT.y);
    move(first, AT.x + FIRST_MOVE_PX, AT.y);
    release(first, AT.x + FIRST_MOVE_PX, AT.y);
    flushFrame();
    expect(notes().at(-1)?.id).toBe(firstId);
    expect(Number(first.style.zIndex)).toBeGreaterThan(Number(noteEls().find((e) => e !== first)?.style.zIndex));
  });

  it('TC-21 pointercancel during a drag keeps the last applied position, note Selected', () => {
    const el = createSelectedNote();
    const before = only();
    press(el, AT.x, AT.y);
    move(el, AT.x + FIRST_MOVE_PX, AT.y);
    flushFrame();
    expect(only().x).toBe(before.x + FIRST_MOVE_PX);
    move(el, AT.x + SECOND_MOVE_PX, AT.y); // not yet applied (next frame)
    fireEvent.pointerCancel(el, { pointerId: 1 });
    flushFrame();
    expect(only().x).toBe(before.x + FIRST_MOVE_PX);
    expect(el.className).not.toContain('sticky-note--dragging');
    expect(isSelected(el)).toBe(true);
  });

  it('TC-22 clicking empty board clears the selection and removes the toolbar', () => {
    const el = createSelectedNote();
    expect(isSelected(el)).toBe(true);
    expect(noteToolbar()).not.toBeNull();
    clickEmptyBoard();
    expect(isSelected(el)).toBe(false);
    expect(noteToolbar()).toBeNull();
  });

  it('panning the board (press + move on empty space) does not clear the selection', () => {
    const el = createSelectedNote();
    const start = { x: 1000, y: 700 };
    press(board(), start.x, start.y);
    move(board(), start.x + FIRST_MOVE_PX, start.y);
    release(board(), start.x + FIRST_MOVE_PX, start.y);
    expect(isSelected(el)).toBe(true);
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s on a selected note removes it', (key) => {
    createSelectedNote();
    expect(noteEls()).toHaveLength(1);
    fireEvent.keyDown(onlyNoteEl(), { key });
    expect(noteEls()).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
  });

  it('Delete with no selection does nothing', () => {
    createSelectedNote();
    clickEmptyBoard();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(notes()).toHaveLength(1);
  });

  it('TC-35 double-click on an existing note edits it and creates no new note', () => {
    const el = createSelectedNote();
    clickEmptyBoard();
    click(el, AT.x, AT.y);
    click(el, AT.x, AT.y);
    fireEvent.doubleClick(el, { clientX: AT.x, clientY: AT.y });
    expect(notes()).toHaveLength(1);
    expect(el.dataset.editing).toBe('true');
    expect(document.activeElement).toBe(editor());
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(notes()).toHaveLength(0);
    expect(editor()).toBeNull();
    createSelectedNote();
    clickEmptyBoard();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(editor()).toBeNull();
  });

  it('Tab focus selects a note so Enter and Delete work from the keyboard', () => {
    const el = createSelectedNote();
    clickEmptyBoard();
    expect(el.tabIndex).toBe(0);
    act(() => el.focus());
    expect(isSelected(el)).toBe(true);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(editor()).not.toBeNull();
  });

  it('TC-37 note deleted by the model while dragging: drag ends, no error, not re-created', () => {
    const el = createSelectedNote();
    const id = only().id;
    press(el, AT.x, AT.y);
    move(el, AT.x + FIRST_MOVE_PX, AT.y);
    flushFrame();
    move(el, AT.x + SECOND_MOVE_PX, AT.y); // pending frame
    act(() => {
      deleteObject(doc(), id);
    });
    expect(() => flushFrame()).not.toThrow();
    expect(noteEls()).toHaveLength(0);
    expect(notes()).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
    // Nothing is re-created by later interaction either.
    clickEmptyBoard();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(notes()).toHaveLength(0);
  });

  it('TC-37 note deleted by the model while editing: editing ends, no error, not re-created', () => {
    doubleClickBoard(AT.x, AT.y);
    const id = only().id;
    const textarea = editor();
    expect(textarea).not.toBeNull();
    act(() => {
      deleteObject(doc(), id);
    });
    expect(editor()).toBeNull();
    expect(notes()).toHaveLength(0);
    // A stale textarea event must not write the note back.
    fireEvent.change(textarea!, { target: { value: 'late' } });
    fireEvent.blur(textarea!);
    flushFrame();
    expect(notes()).toHaveLength(0);
    expect(doc().getMap('objects').size).toBe(0);
  });
});
