import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSticky, deleteObject, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import {
  flushFrame,
  keyDown,
  model,
  noteEl,
  noteElements,
  noteToolbar,
  press,
  readCamera,
  renderApp,
  useFakeFrames,
} from './helpers';

const HALF = STICKY_SIZE_WORLD / 2;

/** Renders the app with one note whose top-left is (0, 0). */
function setup() {
  const utils = renderApp();
  const id = model((doc) => createSticky(doc, { x: HALF, y: HALF }));
  return { ...utils, id, el: noteEl(id) };
}

function position(id: string) {
  const n = snapshot(window.__vidi6!.doc).find((s) => s.id === id);
  return n ? { x: n.x, y: n.y } : undefined;
}

describe('StickyNote (sticky.interaction)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('renders a labelled, focusable note at its world position', () => {
    const { el } = setup();
    expect(el).toHaveAttribute('tabindex', '0');
    expect(el.style.left).toBe('0px');
    expect(el.style.top).toBe('0px');
    expect(el.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();
  });

  it('TC-18 press and release without moving selects: outline and note toolbar', () => {
    const { el } = setup();
    press(el);
    expect(el.dataset.selected).toBe('true');
    expect(el.className).toContain('is-selected');
    expect(noteToolbar()).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
  });

  it('TC-19 moving 2px (below DRAG_THRESHOLD_PX) selects without moving', () => {
    const { el, id } = setup();
    let updates = 0;
    window.__vidi6!.doc.on('update', () => updates++);
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 102, clientY: 100 });
    expect(el.dataset.state).toBe('pressed');
    flushFrame();
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 102, clientY: 100 });
    flushFrame();
    expect(el.dataset.selected).toBe('true');
    expect(position(id)).toEqual({ x: 0, y: 0 });
    expect(updates).toBe(0); // no moveObject (nor bringToFront) was applied
  });

  it('TC-20 moving exactly DRAG_THRESHOLD_PX starts a drag and never pans the board', () => {
    const { el, id, viewport } = setup();
    const cam0 = readCamera(viewport);
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    expect(viewport.dataset.state).toBe('idle');
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 });
    expect(el.dataset.state).toBe('dragging');
    expect(noteToolbar()).toBeNull(); // hidden while dragging
    flushFrame();
    expect(position(id)).toEqual({ x: DRAG_THRESHOLD_PX, y: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 180, clientY: 150 });
    flushFrame();
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 180, clientY: 150 });
    flushFrame();
    expect(position(id)).toEqual({ x: 80, y: 50 });
    expect(viewport.dataset.state).toBe('idle');
    expect(readCamera(viewport)).toEqual(cam0);
    expect(el.dataset.state).toBe('idle');
    expect(el.dataset.selected).toBe('true');
    expect(noteToolbar()).toBeInTheDocument();
  });

  it('drag divides the screen delta by the zoom and brings the note to front', () => {
    const { el, id, viewport } = setup();
    const other = model((doc) => createSticky(doc, { x: HALF + 50, y: HALF }));
    expect(Number(noteEl(other).style.zIndex)).toBeGreaterThan(Number(el.style.zIndex));
    fireEvent.keyDown(window, { key: '=', ctrlKey: true });
    flushFrame();
    const zoom = readCamera(viewport).zoom;
    expect(zoom).toBeGreaterThan(1);
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 110, clientY: 60 });
    flushFrame();
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 110, clientY: 60 });
    const p = position(id)!;
    expect(p.x).toBeCloseTo(100 / zoom, 9);
    expect(p.y).toBeCloseTo(50 / zoom, 9);
    expect(Number(el.style.zIndex)).toBeGreaterThan(Number(noteEl(other).style.zIndex));
  });

  it('TC-21 pointercancel during a drag keeps the last applied position and selects', () => {
    const { el, id } = setup();
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 150, clientY: 120 });
    flushFrame();
    expect(position(id)).toEqual({ x: 50, y: 20 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 300, clientY: 300 }); // not yet applied
    fireEvent.pointerCancel(el, { pointerId: 1 });
    flushFrame();
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 400, clientY: 400 });
    flushFrame();
    expect(position(id)).toEqual({ x: 50, y: 20 });
    expect(el.dataset.state).toBe('idle');
    expect(el.dataset.selected).toBe('true');
  });

  it('lostpointercapture also ends the drag at the last applied position', () => {
    const { el, id } = setup();
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 30, clientY: 0 });
    flushFrame();
    fireEvent.lostPointerCapture(el, { pointerId: 1 });
    expect(el.dataset.state).toBe('idle');
    expect(position(id)).toEqual({ x: 30, y: 0 });
  });

  it('TC-22 clicking empty board clears the selection and hides the toolbar', () => {
    const { el, viewport } = setup();
    press(el);
    expect(noteToolbar()).toBeInTheDocument();
    press(viewport, { clientX: 700, clientY: 600 });
    expect(el.dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();
  });

  it('panning the board keeps the selection', () => {
    const { el, viewport } = setup();
    press(el);
    fireEvent.pointerDown(viewport, { pointerId: 2, button: 0, clientX: 700, clientY: 600 });
    fireEvent.pointerMove(viewport, { pointerId: 2, clientX: 750, clientY: 600 });
    fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 750, clientY: 600 });
    expect(el.dataset.selected).toBe('true');
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s on a selected note deletes it', (key) => {
    const { el } = setup();
    model((doc) => createSticky(doc, { x: 500, y: 500 }));
    press(el);
    const ev = keyDown(document.body, key);
    expect(ev.defaultPrevented).toBe(true);
    expect(noteElements()).toHaveLength(1);
    expect(el).not.toBeInTheDocument();
    expect(noteToolbar()).toBeNull();
  });

  it('Delete with nothing selected deletes nothing', () => {
    setup();
    keyDown(document.body, 'Delete');
    expect(noteElements()).toHaveLength(1);
  });

  it('TC-35 double-click on an existing note edits it instead of creating a note', () => {
    const { el, viewport } = setup();
    press(el);
    press(el);
    fireEvent.doubleClick(el, { clientX: 100, clientY: 100 });
    expect(noteElements()).toHaveLength(1);
    expect(snapshot(window.__vidi6!.doc)).toHaveLength(1);
    expect(el.dataset.editing).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
    expect(viewport.dataset.state).toBe('idle');
  });

  it('double-click on empty board creates a yellow note centred there, in edit mode', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    const notes = snapshot(window.__vidi6!.doc);
    expect(notes).toHaveLength(1);
    expect(notes[0].color).toBe('yellow');
    expect(notes[0].x + HALF).toBeCloseTo(400 / cam.zoom + cam.x, 9);
    expect(notes[0].y + HALF).toBeCloseTo(300 / cam.zoom + cam.y, 9);
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
  });

  it('TC-36 Enter with nothing selected neither creates nor edits a note', () => {
    setup();
    keyDown(document.body, 'Enter');
    expect(noteElements()).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 note deleted while dragging: drag ends silently, note not re-created', () => {
    const { el, id } = setup();
    fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 60, clientY: 0 }); // pending frame
    expect(model((doc) => deleteObject(doc, id))).toBe(true);
    expect(() => flushFrame()).not.toThrow();
    expect(el).not.toBeInTheDocument();
    expect(snapshot(window.__vidi6!.doc)).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
  });

  it('TC-37 note deleted while editing: editor closes silently, note not re-created', () => {
    const { el, id } = setup();
    fireEvent.doubleClick(el);
    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    model((doc) => deleteObject(doc, id));
    expect(textarea).not.toBeInTheDocument();
    expect(() => {
      fireEvent.input(textarea, { target: { value: 'late' } });
      fireEvent.blur(textarea);
    }).not.toThrow();
    expect(snapshot(window.__vidi6!.doc)).toHaveLength(0);
    // Keys no longer target the deleted note.
    keyDown(document.body, 'Enter');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
