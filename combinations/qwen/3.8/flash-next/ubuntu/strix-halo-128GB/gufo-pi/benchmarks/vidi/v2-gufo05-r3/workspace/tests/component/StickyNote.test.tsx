import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  boardSurface,
  clickNote,
  clickSurface,
  noteEl,
  renderBoard,
  seedSticky,
  stubViewportSize,
  textarea,
  worldLayer,
} from './boardHarness';

stubViewportSize();

function setup(count = 1) {
  const doc = new Y.Doc();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(seedSticky(doc, { x: 300 + i * 40, y: 200 + i * 40 }));
  }
  const utils = renderBoard(doc);
  return { doc, ids, ...utils };
}

describe('sticky.interaction: select, drag, deselect', () => {
  it('TC-18 press and release without moving selects the note, with outline and toolbar', () => {
    const { container, ids } = setup();
    const note = noteEl(container, ids[0]);
    expect(note.getAttribute('data-selected')).toBe('false');

    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    // Pressed but not yet Selected.
    expect(note.getAttribute('data-selected')).toBe('false');
    fireEvent.pointerUp(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });

    expect(note.getAttribute('data-selected')).toBe('true');
    const toolbar = screen.getByRole('toolbar', { name: 'Sticky note options' });
    expect(toolbar).toBeInTheDocument();
    // Accessible names, not colour alone.
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(screen.getByRole('button', { name: `${name} colour` })).toBeInTheDocument();
    }
  });

  it('TC-19 moving 2px (below DRAG_THRESHOLD_PX) selects without moving the note', () => {
    const { container, doc, ids } = setup();
    const before = snapshot(doc)[0];
    const note = noteEl(container, ids[0]);

    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 22, clientY: 20, button: 0, pointerId: 1 });
    expect(note.getAttribute('data-dragging')).toBe('false');
    fireEvent.pointerUp(note, { clientX: 22, clientY: 20, button: 0, pointerId: 1 });

    expect(note.getAttribute('data-selected')).toBe('true');
    const after = snapshot(doc)[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
  });

  it('TC-20 moving exactly DRAG_THRESHOLD_PX drags the note and never pans the board', () => {
    const { container, doc, ids } = setup();
    const layer = worldLayer(container);
    const cameraBefore = layer.style.transform;
    const before = snapshot(doc)[0];
    const note = noteEl(container, ids[0]);

    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, {
      clientX: 20 + DRAG_THRESHOLD_PX,
      clientY: 20,
      button: 0,
      pointerId: 1,
    });
    expect(note.getAttribute('data-dragging')).toBe('true');
    // The board camera has not moved at all (sticky.no_pan).
    expect(layer.style.transform).toBe(cameraBefore);

    fireEvent.pointerUp(note, {
      clientX: 20 + DRAG_THRESHOLD_PX,
      clientY: 20,
      button: 0,
      pointerId: 1,
    });

    // zoom is 1, so 3 screen pixels are 3 board units.
    const after = snapshot(doc)[0];
    expect(after.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(layer.style.transform).toBe(cameraBefore);
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('data-dragging')).toBe('false');
  });

  it('TC-20b dragging a note raises it above the other note', () => {
    const { container, doc, ids } = setup(2);
    const [bottom, top] = ids;
    expect(snapshot(doc).map((n) => n.id)).toEqual([bottom, top]);
    const note = noteEl(container, bottom);

    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 40, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 40, clientY: 20, button: 0, pointerId: 1 });

    expect(snapshot(doc).map((n) => n.id)).toEqual([top, bottom]);
  });

  it('TC-21 pointercancel during a drag keeps the last shown position', () => {
    const { container, doc, ids } = setup();
    const before = snapshot(doc)[0];
    const note = noteEl(container, ids[0]);

    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 60, clientY: 35, button: 0, pointerId: 1 });
    expect(note.getAttribute('data-dragging')).toBe('true');
    fireEvent.pointerCancel(note, { clientX: 60, clientY: 35, button: 0, pointerId: 1 });

    const after = snapshot(doc)[0];
    expect(after.x).toBeCloseTo(before.x + 40, 6);
    expect(after.y).toBeCloseTo(before.y + 15, 6);
    expect(note.getAttribute('data-selected')).toBe('true');

    // The interaction is over: further movement changes nothing.
    fireEvent.pointerMove(note, { clientX: 900, clientY: 900, button: 0, pointerId: 1 });
    expect(snapshot(doc)[0].x).toBeCloseTo(before.x + 40, 6);
  });

  it('TC-22 clicking empty board space clears the selection and hides the toolbar', () => {
    const { container, ids } = setup();
    const note = noteEl(container, ids[0]);
    clickNote(note);
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).not.toBeNull();

    clickSurface(boardSurface(container));

    expect(note.getAttribute('data-selected')).toBe('false');
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();
  });

  it.each(['Delete', 'Backspace'])(
    'TC-25 %s on a selected note deletes it (separate runs)',
    (key) => {
      const { container, doc, ids } = setup();
      clickNote(noteEl(container, ids[0]));
      expect(snapshot(doc)).toHaveLength(1);

      fireEvent.keyDown(window, { key });

      expect(snapshot(doc)).toHaveLength(0);
      expect(container.querySelector('[data-sticky-note]')).toBeNull();
      expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();
    },
  );

  it('TC-35 double-clicking a note edits it instead of creating a new one', () => {
    const { container, doc, ids } = setup();
    const note = noteEl(container, ids[0]);

    fireEvent.doubleClick(note, { clientX: 20, clientY: 20 });

    expect(snapshot(doc)).toHaveLength(1);
    expect(textarea(container)).not.toBeNull();
    expect(document.activeElement).toBe(textarea(container));
  });

  it('TC-36 Enter with nothing selected neither creates nor edits a note', () => {
    const { container, doc } = setup(0);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(snapshot(doc)).toHaveLength(0);
    expect(textarea(container)).toBeNull();
  });

  it('TC-37 a note deleted while dragging ends the interaction silently', () => {
    const { container, doc, ids } = setup();
    const id = ids[0];
    const note = noteEl(container, id);

    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 60, clientY: 20, button: 0, pointerId: 1 });

    act(() => {
      deleteObject(doc, id);
    });
    expect(snapshot(doc)).toHaveLength(0);

    // Traffic on the vanished note must neither throw nor re-create it.
    expect(() => {
      fireEvent.pointerMove(note, { clientX: 90, clientY: 60, button: 0, pointerId: 1 });
      fireEvent.pointerUp(note, { clientX: 90, clientY: 60, button: 0, pointerId: 1 });
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
    expect(container.querySelector(`[data-note-id="${id}"]`)).toBeNull();
  });

  it('TC-37b a note deleted while editing closes the editor and writes nothing', () => {
    const { container, doc, ids } = setup();
    const id = ids[0];
    clickNote(noteEl(container, id));
    fireEvent.keyDown(window, { key: 'Enter' });
    const editor = textarea(container);
    expect(editor).not.toBeNull();
    fireEvent.change(editor!, { target: { value: 'draft' } });

    act(() => {
      deleteObject(doc, id);
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(textarea(container)).toBeNull();
    expect(() => act(() => undefined)).not.toThrow();
  });

  it('a note drag is measured in board units: zoomed out, the same gesture moves the note further', () => {
    const { container, doc, ids } = setup();
    const before = snapshot(doc)[0];
    const note = noteEl(container, ids[0]);

    // One step out (zoom 0.8), then drag 40 screen px.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    const zoom = 1 / ZOOM_STEP_FACTOR;
    expect(container.querySelector('.zoom-label')!.textContent).toBe(
      `${Math.round(zoom * 100)}%`,
    );

    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 60, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 60, clientY: 20, button: 0, pointerId: 1 });

    const after = snapshot(doc)[0];
    expect(after.x - before.x).toBeCloseTo(40 / zoom, 6);
  });
});

describe('sticky.stack: painting order', () => {
  const paintedOrder = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-note-id]')].map((el) => el.getAttribute('data-note-id'));

  it('notes are stacked by their model z, and raising one keeps the DOM order stable', () => {
    const { container, doc, ids } = setup(2);
    const orderBefore = paintedOrder(container);
    // Stacking is CSS z-index from the model, whatever the (stable) DOM order is.
    const zs = ids.map((id) => Number(noteEl(container, id).style.zIndex));
    expect([...zs].sort((a, b) => a - b)).toEqual([1, 2]);

    // Drag the lower note to the front. Its z rises, but the elements must not be
    // re-ordered: moving the element that holds the pointer capture would cancel the
    // drag in a real browser.
    const lower = snapshot(doc).reduce((a, b) => (a.z <= b.z ? a : b)).id;
    const note = noteEl(container, lower);
    fireEvent.pointerDown(note, { clientX: 20, clientY: 20, button: 0, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 60, clientY: 60, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note, { clientX: 60, clientY: 60, button: 0, pointerId: 1 });

    const raised = snapshot(doc).find((n) => n.id === lower);
    expect(raised?.z).toBe(3);
    expect(paintedOrder(container)).toEqual(orderBefore);
    expect(Number(noteEl(container, lower).style.zIndex)).toBe(3);
  });
});
