// Component tests (jsdom): sticky note interaction — select, drag, move at
// zoom, double-click to edit, toolbar colour/delete, board keyboard, stale
// selection. Uses a real Y.Doc seeded directly, so it asserts the document and
// the DOM together. Covers TC-18 to TC-22, TC-25, TC-35 to TC-37 (behaviour).
//
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { Doc } from 'yjs';

import { createSticky, snapshot, deleteObject, type StickySnapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { renderStickyBoard, type HarnessHandle } from './stickyHarness';

let doc: Doc;
let view: ReturnType<typeof renderStickyBoard>['view'];
let handle: HarnessHandle;

function mount() {
  const r = renderStickyBoard(doc);
  view = r.view;
  handle = r.handle;
}

function noteById(id: string): HTMLElement {
  return view.getAllByTestId('sticky-note').find((el) => el.getAttribute('data-id') === id) as HTMLElement;
}

function seed(world = { x: 200, y: 200 }): StickySnapshot {
  const id = createSticky(doc, world);
  return snapshot(doc).find((n) => n.id === id) as StickySnapshot;
}

beforeEach(() => {
  doc = new Doc();
});

describe('selecting a note', () => {
  it('press and release without moving selects the note and shows its toolbar', () => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });
    expect(handle.selectedId).toBe(note.id);
    expect(noteById(note.id).getAttribute('data-selected')).toBe('true');
    expect(view.queryByTestId('note-toolbar')).not.toBeNull();
  });

  it('a move under the threshold does not move the note', () => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    const before = note.x;
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 302, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 302, clientY: 300 });
    const after = snapshot(doc).find((n) => n.id === note.id) as StickySnapshot;
    expect(after.x).toBe(before);
    expect(handle.selectedId).toBe(note.id);
  });
});

describe('dragging a note', () => {
  it('moves the note by the on-screen delta divided by zoom, and never pans the board', () => {
    const note = seed({ x: 200, y: 200 }); // world top-left (100, 100)
    mount();
    const cameraBefore = { ...handle.camera };
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 460, clientY: 430 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 460, clientY: 430 });

    const after = snapshot(doc).find((n) => n.id === note.id) as StickySnapshot;
    expect(after.x).toBeCloseTo(100 + 60, 5);
    expect(after.y).toBeCloseTo(100 + 30, 5);
    // The board camera is untouched: the note stopped the pointer events.
    expect(handle.camera).toEqual(cameraBefore);
    expect(view.getByTestId('board').getAttribute('data-panning')).toBe('false');
  });

  it('scales the drag by the inverse of zoom', () => {
    const note = seed({ x: 200, y: 200 });
    mount();
    // Publish zoom 0.5 through the camera's per-frame coalescing.
    vi.useFakeTimers();
    act(() => {
      handle.setCamera({ zoom: 0.5 });
      vi.advanceTimersByTime(100);
    });
    vi.useRealTimers();
    expect(handle.camera.zoom).toBeCloseTo(0.5, 5);

    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 120, clientY: 0 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 120, clientY: 0 });

    const after = snapshot(doc).find((n) => n.id === note.id) as StickySnapshot;
    // 120 screen px at zoom 0.5 is 240 world units.
    expect(after.x).toBeCloseTo(100 + 240, 5);
  });

  it('brings the note to the front when the drag starts', () => {
    const a = seed({ x: 200, y: 200 });
    const b = seed({ x: 400, y: 400 });
    mount();
    // b is on top (z 2). Drag a; it must end above b.
    const el = noteById(a.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 260, clientY: 200 });
    const ordered = snapshot(doc);
    const zA = ordered.find((n) => n.id === a.id)!.z;
    const zB = ordered.find((n) => n.id === b.id)!.z;
    expect(zA).toBeGreaterThan(zB);
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 260, clientY: 200 });
  });
});

describe('double-click', () => {
  it('double-clicking empty board creates a note centred on the point and edits it', () => {
    mount();
    const board = view.getByTestId('board');
    fireEvent.doubleClick(board);
    expect(snapshot(doc)).toHaveLength(1);
    expect(handle.editingId).not.toBeNull();
    const created = snapshot(doc)[0];
    // The click is at board-local (0, 0), which maps to the camera's top-left
    // world point; the note is centred there.
    expect(created.x).toBeCloseTo(handle.camera.x - STICKY_SIZE_WORLD / 2, 5);
    expect(created.y).toBeCloseTo(handle.camera.y - STICKY_SIZE_WORLD / 2, 5);
    expect(view.getByRole('textbox')).not.toBeNull();
  });

  it('double-clicking an existing note edits it and does not create another', () => {
    const note = seed();
    const countBefore = snapshot(doc).length;
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });
    fireEvent.doubleClick(el);
    expect(handle.editingId).toBe(note.id);
    expect(view.getAllByTestId('sticky-note')).toHaveLength(countBefore);
    expect(view.getByRole('textbox')).not.toBeNull();
  });
});

describe('note toolbar', () => {
  beforeEach(() => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });
  });

  it('changes the colour from the swatch', () => {
    fireEvent.click(view.getByRole('button', { name: 'Pink colour' }));
    const note = snapshot(doc)[0];
    expect(note.color).toBe('pink');
  });

  it('deletes the note from the bin button', () => {
    fireEvent.click(view.getByRole('button', { name: 'Delete note' }));
    expect(snapshot(doc)).toHaveLength(0);
    expect(view.queryByTestId('sticky-note')).toBeNull();
    expect(handle.selectedId).toBeNull();
  });
});

describe('board keyboard', () => {
  it('Enter starts editing the selected note and focuses the textarea at the end', () => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handle.editingId).toBe(note.id);
    const input = view.getByRole('textbox') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(input);
  });

  it('Delete removes the selected note', () => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });

    fireEvent.keyDown(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(view.queryByTestId('sticky-note')).toBeNull();
    expect(handle.selectedId).toBeNull();
  });

  it('Backspace removes the selected note', () => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });

    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('Enter while nothing is selected does nothing', () => {
    seed();
    mount();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handle.editingId).toBeNull();
    expect(handle.selectedId).toBeNull();
  });
});

describe('clicking empty board', () => {
  it('clears the selection', () => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });
    expect(handle.selectedId).toBe(note.id);

    const board = view.getByTestId('board');
    fireEvent.pointerDown(board, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 5, clientY: 5 });
    fireEvent.pointerUp(board, { pointerId: 2, clientX: 5, clientY: 5 });
    expect(handle.selectedId).toBeNull();
  });
});

describe('note removed while interacting', () => {
  it('ends interaction and is never recreated when deleted through the model', () => {
    const note = seed();
    mount();
    const el = noteById(note.id);
    fireEvent.pointerDown(el, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 300, clientY: 300 });
    // Start editing, then delete the object out from under the editor.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(handle.editingId).toBe(note.id);

    act(() => {
      deleteObject(doc, note.id);
    });
    expect(snapshot(doc)).toHaveLength(0);
    expect(view.queryByTestId('sticky-note')).toBeNull();
    expect(handle.selectedId).toBeNull();
    expect(handle.editingId).toBeNull();
  });
});
