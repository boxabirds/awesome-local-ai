import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { resetCamera, screenToWorld } from '../../src/client/canvas/camera';
import { flushFrame, readCamera } from './helpers';
import {
  click,
  countUpdates,
  editor,
  model,
  noteEl,
  notes,
  pointer,
  renderBoard,
  viewportEl,
} from './boardHelpers';

const HALF = STICKY_SIZE_WORLD / 2;
const START = { x: 300, y: 200 };

function boardWithNote(at = { x: 0, y: 0 }) {
  const doc = new Y.Doc();
  const id = createSticky(doc, at);
  getStickyText(doc, id)?.insert(0, 'Faster onboarding');
  return { ...renderBoard(doc), id };
}

function toolbar() {
  return screen.queryByRole('toolbar', { name: 'Note' });
}

describe('sticky.interaction (StickyNote in the board)', () => {
  it('renders a note at its world position with its colour, size and text', () => {
    const { id } = boardWithNote({ x: 50, y: 60 });
    const el = noteEl(id);
    expect(el.style.left).toBe(`${50 - HALF}px`);
    expect(el.style.top).toBe(`${60 - HALF}px`);
    expect(el.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.style.backgroundColor).toBe('rgb(255, 245, 157)'); // #FFF59D
    expect(el).toHaveTextContent('Faster onboarding');
    expect(el).toHaveAttribute('data-selected', 'false');
    expect(el.parentElement).toBe(screen.getByTestId('world-layer'));
  });

  it('TC-18 press and release without moving selects: outline and note toolbar', () => {
    const { id } = boardWithNote();
    expect(toolbar()).toBeNull();
    click(noteEl(id), START);
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(id)).toHaveAttribute('data-state', 'selected');
    expect(toolbar()).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
  });

  it('TC-19 moving less than DRAG_THRESHOLD_PX selects without moving the note', () => {
    const { doc, id } = boardWithNote();
    const updates = countUpdates(doc);
    const el = noteEl(id);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + DRAG_THRESHOLD_PX - 1, y: START.y });
    flushFrame();
    pointer(el, 'pointerUp', { x: START.x + DRAG_THRESHOLD_PX - 1, y: START.y });
    flushFrame();
    expect(updates.count).toBe(0);
    expect(model(doc, id)).toMatchObject({ x: -HALF, y: -HALF });
    expect(noteEl(id)).toHaveAttribute('data-state', 'selected');
  });

  it('TC-20 moving exactly DRAG_THRESHOLD_PX starts a drag and never pans the board', () => {
    const { doc, id } = boardWithNote();
    click(noteEl(id), START);
    const camera = readCamera();
    const el = noteEl(id);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + DRAG_THRESHOLD_PX, y: START.y });
    flushFrame();
    expect(noteEl(id)).toHaveAttribute('data-state', 'dragging');
    expect(toolbar()).toBeNull(); // hidden while dragging
    expect(model(doc, id)?.x).toBe(-HALF + DRAG_THRESHOLD_PX);
    expect(viewportEl()).toHaveAttribute('data-state', 'idle');
    expect(readCamera()).toEqual(camera);
    pointer(el, 'pointerUp', { x: START.x + DRAG_THRESHOLD_PX, y: START.y });
    flushFrame();
    expect(readCamera()).toEqual(camera);
    expect(noteEl(id)).toHaveAttribute('data-state', 'selected');
    expect(toolbar()).toBeInTheDocument();
  });

  it('drag converts screen pixels to world units with the zoom and brings the note to front', () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 50, y: 50 });
    renderBoard(doc);
    // Zoom in one step so screen pixels and world units differ.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    flushFrame();
    const zoom = readCamera().zoom;
    const el = noteEl(a);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + 50, y: START.y + 25 });
    pointer(el, 'pointerMove', { x: START.x + 100, y: START.y + 50 });
    flushFrame();
    pointer(el, 'pointerUp', { x: START.x + 100, y: START.y + 50 });
    expect(model(doc, a)?.x).toBeCloseTo(-HALF + 100 / zoom, 9);
    expect(model(doc, a)?.y).toBeCloseTo(-HALF + 50 / zoom, 9);
    expect(model(doc, a)!.z).toBeGreaterThan(model(doc, b)!.z);
    // Drawn above: higher z-index; the DOM order is unchanged (keeps pointer capture).
    expect(Number(noteEl(a).style.zIndex)).toBeGreaterThan(Number(noteEl(b).style.zIndex));
    expect(notes().map((n) => n.dataset.id)).toEqual([a, b].sort());
  });

  it('several moves within one frame produce one document update (rAF throttled)', () => {
    const { doc, id } = boardWithNote();
    const el = noteEl(id);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + 10, y: START.y });
    const updates = countUpdates(doc);
    for (let i = 11; i < 20; i += 1) pointer(el, 'pointerMove', { x: START.x + i, y: START.y });
    expect(updates.count).toBe(0);
    flushFrame();
    expect(updates.count).toBe(1);
    expect(model(doc, id)?.x).toBe(-HALF + 19);
    pointer(el, 'pointerUp', { x: START.x + 19, y: START.y });
  });

  it('TC-21 pointercancel during a drag keeps the last applied position and selects', () => {
    const { doc, id } = boardWithNote();
    const el = noteEl(id);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + 40, y: START.y + 20 });
    flushFrame();
    const shown = model(doc, id);
    pointer(el, 'pointerMove', { x: START.x + 80, y: START.y + 60 }); // not yet shown
    pointer(el, 'pointerCancel', { x: START.x + 80, y: START.y + 60 });
    flushFrame();
    expect(model(doc, id)).toMatchObject({ x: shown?.x, y: shown?.y });
    expect(noteEl(id)).toHaveAttribute('data-state', 'selected');
    // Later moves are ignored.
    pointer(el, 'pointerMove', { x: START.x + 200, y: START.y + 200 });
    flushFrame();
    expect(model(doc, id)).toMatchObject({ x: shown?.x, y: shown?.y });
  });

  it('lostpointercapture also ends a drag', () => {
    const { doc, id } = boardWithNote();
    const el = noteEl(id);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + 40, y: START.y });
    flushFrame();
    fireEvent.lostPointerCapture(el, { pointerId: 1 });
    pointer(el, 'pointerMove', { x: START.x + 90, y: START.y });
    flushFrame();
    expect(model(doc, id)?.x).toBe(-HALF + 40);
    expect(noteEl(id)).toHaveAttribute('data-state', 'selected');
  });

  it('TC-22 clicking empty board space clears the selection', () => {
    const { id } = boardWithNote();
    click(noteEl(id), START);
    expect(toolbar()).toBeInTheDocument();
    click(viewportEl(), { x: 20, y: 20 });
    expect(noteEl(id)).toHaveAttribute('data-selected', 'false');
    expect(toolbar()).toBeNull();
  });

  it('panning the board (a drag on empty space) keeps the selection', () => {
    const { id } = boardWithNote();
    click(noteEl(id), START);
    pointer(viewportEl(), 'pointerDown', { x: 20, y: 20 });
    pointer(viewportEl(), 'pointerMove', { x: 120, y: 20 });
    pointer(viewportEl(), 'pointerUp', { x: 120, y: 20 });
    flushFrame();
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s on a selected note deletes it', (key) => {
    const { doc, id } = boardWithNote();
    click(noteEl(id), START);
    fireEvent.keyDown(noteEl(id), { key });
    expect(notes()).toHaveLength(0);
    expect(model(doc, id)).toBeUndefined();
    expect(toolbar()).toBeNull();
  });

  it('Delete with nothing selected does nothing', () => {
    const { doc } = boardWithNote();
    const updates = countUpdates(doc);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(notes()).toHaveLength(1);
    expect(updates.count).toBe(0);
  });

  it('double-click on empty board creates a note centred on that point, editing', () => {
    const { doc } = renderBoard();
    const at = { x: 400, y: 300 };
    fireEvent.doubleClick(viewportEl(), { clientX: at.x, clientY: at.y });
    const [el] = notes();
    expect(el).toBeDefined();
    const world = screenToWorld(resetCamera({ width: window.innerWidth, height: window.innerHeight }), at);
    const created = model(doc, el!.dataset.id!);
    expect(created).toMatchObject({ x: world.x - HALF, y: world.y - HALF, color: 'yellow' });
    expect(editor()).toHaveFocus();
  });

  it('TC-35 double-click on an existing note edits it and creates nothing', () => {
    const { doc, id } = boardWithNote();
    const updates = countUpdates(doc);
    click(noteEl(id), START);
    click(noteEl(id), START);
    fireEvent.doubleClick(noteEl(id), { clientX: START.x, clientY: START.y });
    expect(notes()).toHaveLength(1);
    expect(updates.count).toBe(0);
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
    expect(editor()).toHaveFocus();
    expect(editor()?.value).toBe('Faster onboarding');
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    const { doc } = boardWithNote();
    const updates = countUpdates(doc);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(notes()).toHaveLength(1);
    expect(editor()).toBeNull();
    expect(updates.count).toBe(0);
  });

  it('TC-37 note deleted while Dragging: the drag ends silently and the note is not re-created', () => {
    const { doc, id } = boardWithNote();
    const el = noteEl(id);
    pointer(el, 'pointerDown', START);
    pointer(el, 'pointerMove', { x: START.x + 30, y: START.y });
    act(() => {
      deleteObject(doc, id);
    });
    expect(() => {
      pointer(el, 'pointerMove', { x: START.x + 60, y: START.y });
      flushFrame();
      pointer(el, 'pointerUp', { x: START.x + 60, y: START.y });
      flushFrame();
    }).not.toThrow();
    expect(notes()).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(0);
    expect(toolbar()).toBeNull();
  });

  it('TC-37 note deleted while Editing: editing ends silently and the note is not re-created', async () => {
    const { doc, id, user } = boardWithNote();
    fireEvent.doubleClick(noteEl(id));
    await user.keyboard(' now');
    expect(getStickyText(doc, id)?.toString()).toBe('Faster onboarding now');
    const textarea = editor()!;
    act(() => {
      deleteObject(doc, id);
    });
    expect(editor()).toBeNull();
    expect(() => fireEvent.blur(textarea)).not.toThrow();
    await user.keyboard('more');
    expect(doc.getMap('objects').size).toBe(0);
    expect(notes()).toHaveLength(0);
  });

  it('a stale id selected by the parent is cleared when the note disappears', () => {
    const { doc, id } = boardWithNote();
    click(noteEl(id), START);
    act(() => {
      deleteObject(doc, id);
    });
    // Enter / Delete must not act on the removed note.
    const updates = countUpdates(doc);
    fireEvent.keyDown(window, { key: 'Delete' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(updates.count).toBe(0);
  });

  it('notes are reachable with Tab; focusing one selects it', async () => {
    const { id, user } = boardWithNote();
    await user.tab();
    expect(noteEl(id)).toHaveFocus();
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    await user.keyboard('{Enter}');
    expect(editor()).toHaveFocus();
  });

  it('notes of unknown future types are not rendered', () => {
    const doc = new Y.Doc();
    const shape = new Y.Map<unknown>();
    doc.getMap('objects').set('shape-1', shape);
    shape.set('type', 'shape');
    renderBoard(doc);
    expect(notes()).toHaveLength(0);
  });
});
