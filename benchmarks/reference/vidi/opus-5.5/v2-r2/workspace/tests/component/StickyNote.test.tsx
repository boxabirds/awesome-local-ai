import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { SHORT_PHRASE } from '../fixtures/texts';
import { flushFrame, noteToolbar, pointer, renderApp, renderedCamera, stickyNotes } from './helpers';

// jsdom has no layout: the viewport is the window and the camera starts centred on world (0, 0).
const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

/** A doc with one note centred on world (0, 0), i.e. on the screen centre. */
function docWithNote(text = SHORT_PHRASE) {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (id === false) throw new Error('create rejected');
  getStickyText(doc, id)?.insert(0, text);
  return { doc, id };
}

function countUpdates(doc: Y.Doc) {
  const counter = { count: 0 };
  doc.on('update', () => counter.count++);
  return counter;
}

function position(doc: Y.Doc, id: string) {
  const n = snapshot(doc).find((s) => s.id === id);
  return n ? { x: n.x, y: n.y, z: n.z } : null;
}

function setup(text?: string) {
  const { doc, id } = docWithNote(text);
  const utils = renderApp(doc);
  const note = () => {
    const [el] = stickyNotes();
    if (!el) throw new Error('no note rendered');
    return el;
  };
  return { ...utils, doc, id, note };
}

function click(el: HTMLElement, x = CENTRE.x, y = CENTRE.y) {
  pointer(el, 'down', x, y);
  pointer(el, 'up', x, y);
  flushFrame();
}

describe('sticky.interaction', () => {
  it('renders a note at its world position with the note colour', () => {
    const { note } = setup();
    expect(note().style.left).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(note().style.top).toBe(`${-STICKY_SIZE_WORLD / 2}px`);
    expect(note().style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note().dataset.color).toBe('yellow');
    expect(note().textContent).toContain(SHORT_PHRASE);
    expect(note().tabIndex).toBe(0);
  });

  it('TC-18 press and release without moving selects the note with outline and toolbar', () => {
    const { note } = setup();
    expect(note().dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();
    click(note());
    expect(note().dataset.selected).toBe('true');
    expect(note().className).toContain('is-selected');
    const toolbar = noteToolbar();
    expect(toolbar).not.toBeNull();
    for (const name of ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet']) {
      expect(screen.getByRole('button', { name: `${name} colour` })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('TC-19 moving 2px (below the threshold) selects without moving the note', () => {
    const { note, doc, id } = setup();
    const before = position(doc, id);
    const updates = countUpdates(doc);
    pointer(note(), 'down', CENTRE.x, CENTRE.y);
    pointer(note(), 'move', CENTRE.x + DRAG_THRESHOLD_PX - 1, CENTRE.y);
    flushFrame();
    expect(note().dataset.state).toBe('idle');
    pointer(note(), 'up', CENTRE.x + DRAG_THRESHOLD_PX - 1, CENTRE.y);
    flushFrame();
    expect(updates.count).toBe(0);
    expect(position(doc, id)).toEqual(before);
    expect(note().dataset.selected).toBe('true');
  });

  it('TC-20 moving exactly 3px starts a drag and the board does not pan', () => {
    const { note, doc, id, world, viewport } = setup();
    const camera = renderedCamera(world());
    const before = position(doc, id);
    pointer(note(), 'down', CENTRE.x, CENTRE.y);
    pointer(note(), 'move', CENTRE.x + DRAG_THRESHOLD_PX, CENTRE.y);
    flushFrame();
    expect(note().dataset.state).toBe('dragging');
    expect(noteToolbar()).toBeNull();
    expect(position(doc, id)).toEqual({ ...before, x: (before?.x ?? 0) + DRAG_THRESHOLD_PX });
    pointer(note(), 'move', CENTRE.x + 120, CENTRE.y + 40);
    flushFrame();
    pointer(note(), 'up', CENTRE.x + 120, CENTRE.y + 40);
    flushFrame();
    expect(renderedCamera(world())).toEqual(camera);
    expect(viewport().dataset.state).toBe('idle');
    expect(position(doc, id)).toMatchObject({ x: (before?.x ?? 0) + 120, y: (before?.y ?? 0) + 40 });
    expect(note().dataset.state).toBe('idle');
    expect(note().dataset.selected).toBe('true');
    expect(noteToolbar()).not.toBeNull();
  });

  it('dragging brings the note to the front', () => {
    const { doc, id } = docWithNote();
    const other = createSticky(doc, { x: 300, y: 0 });
    renderApp(doc);
    const bottom = stickyNotes().find((el) => el.dataset.id === id);
    if (!bottom || other === false) throw new Error('setup failed');
    expect(position(doc, id)?.z).toBe(1);
    pointer(bottom, 'down', CENTRE.x, CENTRE.y);
    pointer(bottom, 'move', CENTRE.x + 50, CENTRE.y);
    flushFrame();
    pointer(bottom, 'up', CENTRE.x + 50, CENTRE.y);
    flushFrame();
    expect(position(doc, id)?.z).toBe(3);
    expect(bottom.style.zIndex).toBe('3');
    // DOM order stays stable (by id) so the dragged element is never detached.
    expect(stickyNotes().map((el) => el.dataset.id)).toEqual([id, other].sort());
  });

  it('dragging at 200% zoom moves by the screen delta divided by the zoom', () => {
    const { note, doc, id } = setup();
    act(() => window.__vidi6?.setCamera({ x: -256, y: -192, zoom: 2 }));
    flushFrame();
    const before = position(doc, id);
    pointer(note(), 'down', CENTRE.x, CENTRE.y);
    pointer(note(), 'move', CENTRE.x + 100, CENTRE.y + 50);
    pointer(note(), 'up', CENTRE.x + 100, CENTRE.y + 50);
    flushFrame();
    expect(position(doc, id)).toMatchObject({ x: (before?.x ?? 0) + 50, y: (before?.y ?? 0) + 25 });
  });

  it('TC-21 pointercancel during a drag keeps the last applied position and selects', () => {
    const { note, doc, id } = setup();
    const before = position(doc, id);
    pointer(note(), 'down', CENTRE.x, CENTRE.y);
    pointer(note(), 'move', CENTRE.x + 50, CENTRE.y + 10);
    flushFrame();
    const applied = { x: (before?.x ?? 0) + 50, y: (before?.y ?? 0) + 10 };
    expect(position(doc, id)).toMatchObject(applied);
    pointer(note(), 'move', CENTRE.x + 90, CENTRE.y + 30);
    pointer(note(), 'cancel', CENTRE.x + 90, CENTRE.y + 30);
    flushFrame();
    expect(position(doc, id)).toMatchObject(applied);
    expect(note().dataset.state).toBe('idle');
    expect(note().dataset.selected).toBe('true');
    // Later moves do nothing.
    pointer(note(), 'move', CENTRE.x + 200, CENTRE.y + 200);
    flushFrame();
    expect(position(doc, id)).toMatchObject(applied);
  });

  it('TC-22 clicking empty board clears the selection', () => {
    const { note, viewport } = setup();
    click(note());
    expect(noteToolbar()).not.toBeNull();
    click(viewport(), 20, 20);
    expect(note().dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();
  });

  it('panning the board does not clear the selection', () => {
    const { note, viewport } = setup();
    click(note());
    pointer(viewport(), 'down', 20, 20);
    pointer(viewport(), 'move', 120, 60);
    pointer(viewport(), 'up', 120, 60);
    flushFrame();
    expect(note().dataset.selected).toBe('true');
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s deletes the selected note', (key) => {
    const { note, doc } = setup();
    click(note());
    const notPrevented = fireEvent.keyDown(document.body, { key });
    expect(notPrevented).toBe(false);
    expect(stickyNotes()).toHaveLength(0);
    expect(snapshot(doc)).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
  });

  it('Delete with nothing selected does nothing', () => {
    const { doc } = setup();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('double-click on empty board creates a yellow note centred there, editing', () => {
    const doc = new Y.Doc();
    const { viewport } = renderApp(doc);
    fireEvent.doubleClick(viewport(), { clientX: CENTRE.x + 100, clientY: CENTRE.y + 50 });
    flushFrame();
    const [created] = snapshot(doc);
    expect(created).toMatchObject({
      color: 'yellow',
      x: 100 - STICKY_SIZE_WORLD / 2,
      y: 50 - STICKY_SIZE_WORLD / 2,
    });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Sticky note text' }));
  });

  it('TC-35 double-click on an existing note edits it instead of creating a note', () => {
    const { note, doc } = setup();
    fireEvent.doubleClick(note(), { clientX: CENTRE.x, clientY: CENTRE.y });
    flushFrame();
    expect(snapshot(doc)).toHaveLength(1);
    expect(note().dataset.editing).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Sticky note text' })).toBe(document.activeElement);
  });

  it('TC-36 Enter with nothing selected neither creates nor edits a note', () => {
    const { doc } = setup();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    flushFrame();
    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('TC-37 a note deleted while being dragged ends the drag silently', () => {
    const { note, doc, id } = setup();
    const el = note();
    pointer(el, 'down', CENTRE.x, CENTRE.y);
    pointer(el, 'move', CENTRE.x + 40, CENTRE.y);
    flushFrame();
    pointer(el, 'move', CENTRE.x + 60, CENTRE.y);
    act(() => {
      deleteObject(doc, id);
    });
    expect(() => {
      flushFrame();
      pointer(el, 'move', CENTRE.x + 80, CENTRE.y);
      pointer(el, 'up', CENTRE.x + 80, CENTRE.y);
      flushFrame();
    }).not.toThrow();
    expect(doc.getMap('objects').size).toBe(0);
    expect(stickyNotes()).toHaveLength(0);
    expect(noteToolbar()).toBeNull();
  });

  it('TC-37 a note deleted while being edited ends editing without writing', () => {
    const { note, doc, id } = setup();
    fireEvent.doubleClick(note());
    const textarea = screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;
    const updates = countUpdates(doc);
    act(() => {
      deleteObject(doc, id);
    });
    expect(updates.count).toBe(1);
    expect(() => {
      fireEvent.input(textarea, { target: { value: 'late text' } });
      fireEvent.blur(textarea);
      flushFrame();
    }).not.toThrow();
    expect(updates.count).toBe(1);
    expect(doc.getMap('objects').size).toBe(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    // Keys after the deletion do nothing.
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(doc.getMap('objects').size).toBe(0);
  });
});
