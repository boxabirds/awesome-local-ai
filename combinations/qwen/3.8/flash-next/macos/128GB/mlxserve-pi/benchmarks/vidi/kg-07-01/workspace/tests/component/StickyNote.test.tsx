import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { SHORT_TEXT } from '../fixtures/texts';
import {
  camera,
  countUpdates,
  key,
  nextFrame,
  note,
  noteEl,
  noteElements,
  pointer,
  press,
  renderApp,
  setCamera,
} from './helpers';

/** A doc with one note whose top-left is at world (0, 0), with some text. */
function docWithNote(text = SHORT_TEXT) {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: STICKY_SIZE_WORLD / 2, y: STICKY_SIZE_WORLD / 2 });
  getStickyText(doc, id)!.insert(0, text);
  return { doc, id };
}

function noteToolbar() {
  return screen.queryByRole('toolbar', { name: 'Note' });
}

describe('sticky note interaction (sticky.interaction)', () => {
  it('renders a note at its world position with its colour and text', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    const el = noteEl(id);
    expect(noteElements()).toHaveLength(1);
    expect(el).toHaveAttribute('aria-label', 'Sticky note');
    expect(el).toHaveAttribute('tabindex', '0');
    expect(el.style.left).toBe('0px');
    expect(el.style.top).toBe('0px');
    expect(el.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(el.style.getPropertyValue('--note-color')).toBe(STICKY_COLORS.yellow);
    expect(el).toHaveTextContent(SHORT_TEXT);
    expect(el).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('board-world')).toContainElement(el);
  });

  it('TC-18 press and release without moving selects the note, with outline and toolbar', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    expect(noteToolbar()).toBeNull();
    pointer(noteEl(id), 'down', 50, 50);
    expect(noteEl(id)).toHaveAttribute('data-state', 'pressed');
    pointer(noteEl(id), 'up', 50, 50);
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(id)).toHaveAttribute('data-state', 'idle');
    expect(noteEl(id)).toHaveClass('sticky-note--selected');
    expect(noteToolbar()).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /colour$/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
  });

  it('TC-19 moving less than DRAG_THRESHOLD_PX does not move the note and still selects it', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    const before = note(doc, id);
    const updates = countUpdates(doc, () => {
      pointer(noteEl(id), 'down', 50, 50);
      pointer(noteEl(id), 'move', 50 + DRAG_THRESHOLD_PX - 1, 50);
      expect(noteEl(id)).toHaveAttribute('data-state', 'pressed');
      nextFrame();
      pointer(noteEl(id), 'up', 50 + DRAG_THRESHOLD_PX - 1, 50);
      nextFrame();
    });
    expect(updates).toBe(0);
    expect(note(doc, id)).toEqual(before);
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
  });

  it('TC-20 moving exactly DRAG_THRESHOLD_PX starts a drag and never pans the board', () => {
    const { doc, id } = docWithNote();
    const { viewport } = renderApp(doc);
    const cam = camera();
    pointer(noteEl(id), 'down', 50, 50);
    pointer(noteEl(id), 'move', 50 + DRAG_THRESHOLD_PX, 50);
    expect(noteEl(id)).toHaveAttribute('data-state', 'dragging');
    expect(viewport).toHaveAttribute('data-state', 'idle');
    // No toolbar while dragging.
    expect(noteToolbar()).toBeNull();
    nextFrame();
    expect(note(doc, id)).toMatchObject({ x: DRAG_THRESHOLD_PX, y: 0 });
    pointer(noteEl(id), 'move', 250, 150);
    nextFrame();
    pointer(noteEl(id), 'up', 250, 150);
    expect(camera()).toBe(cam);
    expect(note(doc, id)).toMatchObject({ x: 200, y: 100 });
    expect(noteEl(id)).toHaveAttribute('data-state', 'idle');
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    expect(noteToolbar()).toBeInTheDocument();
  });

  it('drag moves are batched per animation frame and pointerup applies the final position', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    pointer(noteEl(id), 'down', 0, 0);
    const updates = countUpdates(doc, () => {
      pointer(noteEl(id), 'move', 10, 0);
      pointer(noteEl(id), 'move', 20, 0);
      pointer(noteEl(id), 'move', 30, 0);
    });
    // Only bringToFront (a no-op for the only note) could have written so far: no moves yet.
    expect(updates).toBe(0);
    expect(note(doc, id)).toMatchObject({ x: 0 });
    pointer(noteEl(id), 'up', 40, 5);
    expect(note(doc, id)).toMatchObject({ x: 40, y: 5 });
  });

  it('divides the drag distance by the zoom so the note stays under the pointer', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 2 });
    pointer(noteEl(id), 'down', 20, 20);
    pointer(noteEl(id), 'move', 120, 70);
    pointer(noteEl(id), 'up', 120, 70);
    expect(note(doc, id)).toMatchObject({ x: 50, y: 25 });
    setCamera({ x: 0, y: 0, zoom: 0.5 });
    pointer(noteEl(id), 'down', 20, 20);
    pointer(noteEl(id), 'move', 120, 70);
    pointer(noteEl(id), 'up', 120, 70);
    expect(note(doc, id)).toMatchObject({ x: 250, y: 125 });
  });

  it('dragging a lower note brings it to the front', () => {
    const { doc, id } = docWithNote();
    const top = createSticky(doc, { x: 150, y: 150 });
    renderApp(doc);
    expect(snapshot(doc).map((n) => n.id)).toEqual([id, top]);
    pointer(noteEl(id), 'down', 10, 10);
    pointer(noteEl(id), 'move', 30, 10);
    pointer(noteEl(id), 'up', 30, 10);
    expect(snapshot(doc).map((n) => n.id)).toEqual([top, id]);
    // Drawn on top via z-index; DOM order stays put so the browser keeps pointer capture during the drag.
    expect(Number(noteEl(id).style.zIndex)).toBeGreaterThan(Number(noteEl(top).style.zIndex));
  });

  it('TC-21 pointercancel mid-drag keeps the last applied position and leaves the note selected', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    pointer(noteEl(id), 'down', 0, 0);
    pointer(noteEl(id), 'move', 50, 40);
    nextFrame();
    expect(note(doc, id)).toMatchObject({ x: 50, y: 40 });
    pointer(noteEl(id), 'move', 90, 90); // not yet applied
    pointer(noteEl(id), 'cancel', 90, 90);
    nextFrame();
    expect(note(doc, id)).toMatchObject({ x: 50, y: 40 });
    expect(noteEl(id)).toHaveAttribute('data-state', 'idle');
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    pointer(noteEl(id), 'move', 300, 300);
    nextFrame();
    expect(note(doc, id)).toMatchObject({ x: 50, y: 40 });
  });

  it('TC-22 clicking empty board clears the selection and hides the toolbar', () => {
    const { doc, id } = docWithNote();
    const { viewport } = renderApp(doc);
    press(noteEl(id));
    expect(noteToolbar()).toBeInTheDocument();
    press(viewport, 600, 400);
    expect(noteEl(id)).toHaveAttribute('data-selected', 'false');
    expect(noteToolbar()).toBeNull();
  });

  it('panning the board (a drag on empty space) keeps the selection', () => {
    const { doc, id } = docWithNote();
    const { viewport } = renderApp(doc);
    press(noteEl(id));
    pointer(viewport, 'down', 600, 400);
    pointer(viewport, 'move', 700, 450);
    pointer(viewport, 'up', 700, 450);
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
  });

  it.each(['Delete', 'Backspace'])('TC-25 %s on a selected note deletes it', (k) => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    press(noteEl(id));
    expect(key(k, noteEl(id))).toBe(true);
    expect(noteElements()).toHaveLength(0);
    expect(doc.getMap('objects').size).toBe(0);
    expect(noteToolbar()).toBeNull();
  });

  it('Delete with nothing selected does nothing', () => {
    const { doc } = docWithNote();
    renderApp(doc);
    expect(key('Delete', document.body)).toBe(false);
    expect(noteElements()).toHaveLength(1);
  });

  it('TC-35 double-clicking an existing note edits it instead of creating a note', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    press(noteEl(id));
    press(noteEl(id));
    act(() => {
      fireEvent.doubleClick(noteEl(id));
    });
    expect(doc.getMap('objects').size).toBe(1);
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
    const textarea = screen.getByRole('textbox', { name: 'Note text' });
    expect(textarea).toHaveFocus();
    expect(noteToolbar()).toBeNull();
  });

  it('double-clicking empty board creates a yellow note centred there, in editing mode', () => {
    const { doc, viewport } = renderApp();
    const cam = camera();
    act(() => {
      fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    });
    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      color: 'yellow',
      x: 400 / cam.zoom + cam.x - STICKY_SIZE_WORLD / 2,
      y: 300 / cam.zoom + cam.y - STICKY_SIZE_WORLD / 2,
    });
    expect(noteEl(notes[0].id)).toHaveAttribute('data-state', 'editing');
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
  });

  it('TC-36 Enter with nothing selected does nothing', () => {
    const { doc } = docWithNote();
    renderApp(doc);
    const before = snapshot(doc);
    expect(key('Enter', document.body)).toBe(false);
    expect(snapshot(doc)).toEqual(before);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Tab focus selects a note, so the keyboard can edit it', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    act(() => noteEl(id).focus());
    expect(noteEl(id)).toHaveAttribute('data-selected', 'true');
    key('Enter', noteEl(id));
    expect(noteEl(id)).toHaveAttribute('data-state', 'editing');
  });

  it('TC-37 deleting the note while it is being dragged ends the drag without errors or re-creation', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    const el = noteEl(id);
    pointer(el, 'down', 0, 0);
    pointer(el, 'move', 30, 30);
    pointer(el, 'move', 60, 60); // pending frame
    act(() => {
      deleteObject(doc, id);
    });
    expect(noteElements()).toHaveLength(0);
    expect(() => {
      nextFrame();
      pointer(el, 'move', 90, 90);
      pointer(el, 'up', 90, 90);
      nextFrame();
    }).not.toThrow();
    expect(doc.getMap('objects').size).toBe(0);
    expect(noteToolbar()).toBeNull();
  });

  it('TC-37 deleting the note while it is being edited ends editing without errors or re-creation', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    act(() => {
      fireEvent.doubleClick(noteEl(id));
    });
    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    act(() => {
      deleteObject(doc, id);
    });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(() => {
      textarea.value = 'late typing';
      fireEvent.input(textarea);
      fireEvent.blur(textarea);
      key('Backspace', document.body);
    }).not.toThrow();
    expect(doc.getMap('objects').size).toBe(0);
    expect(snapshot(doc)).toEqual([]);
  });
});
