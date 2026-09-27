/**
 * Component tests for sticky-note interaction (TC-18 to TC-22, TC-25, TC-35 to
 * TC-37) using the real Y.Doc through the harness.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Harness, type HarnessResult } from './harness';
import { snapshot, createSticky } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let harness: HarnessResult | null = null;

const setup = () => {
  harness = null;
  render(<Harness onReady={(result) => (harness = result)} />);
  if (!harness) throw new Error('harness did not report ready');
  return harness;
};

beforeEach(() => {
  cleanup();
});

const grid = () => screen.getByTestId('board-grid');
const notes = () => screen.getAllByTestId('sticky-note');
const noteAt = (index = 0): HTMLElement => notes()[index] as HTMLElement;

const pointer = (
  el: Element | Document,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  x: number,
  y: number,
): void => {
  fireEvent(el, new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: x, clientY: y, button: 0 }));
};

const press = (el: Element, x: number, y: number): void => pointer(el, 'pointerdown', x, y);
const move = (el: Element, x: number, y: number): void => pointer(el, 'pointermove', x, y);
const release = (el: Element, x: number, y: number): void => pointer(el, 'pointerup', x, y);

describe('select and deselect (TC-18, TC-22)', () => {
  it('TC-18: pressing and releasing a note without moving selects it and shows the toolbar', () => {
    setup();
    act(() => { createSticky(harness!.doc, { x: 0, y: 0 }); });
    const note = noteAt(0);
    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();

    press(note, 120, 120);
    release(note, 120, 120);

    expect(note.dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('TC-22: clicking empty board space clears the selection and the toolbar', () => {
    setup();
    act(() => { createSticky(harness!.doc, { x: 0, y: 0 }); });
    const note = noteAt(0);
    press(note, 10, 10);
    release(note, 10, 10);
    expect(note.dataset.selected).toBe('true');

    press(grid(), 600, 500);
    release(grid(), 600, 500);

    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });
});

describe('drag to move (TC-19, TC-20, TC-21)', () => {
  it('TC-25: Delete and Backspace each remove the selected note (separate runs)', () => {
    for (const key of ['Delete', 'Backspace']) {
      cleanup();
      setup();
      act(() => { createSticky(harness!.doc, { x: 0, y: 0 }); });
      const note = noteAt(0);
      press(note, 10, 10);
      release(note, 10, 10);
      fireEvent.keyDown(document.body, { key });
      expect(snapshot(harness!.doc)).toHaveLength(0);
      expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    }
  });

  it('TC-19: a 2px move stays below the drag threshold and does not move the note', () => {
    setup();
    let id = '';
    act(() => { id = createSticky(harness!.doc, { x: 0, y: 0 }); });
    const before = snapshot(harness!.doc)[0];
    const note = noteAt(0);
    press(note, 100, 100);
    move(note, 102, 100); // 2px: below DRAG_THRESHOLD_PX
    release(note, 102, 100);

    const after = snapshot(harness!.doc)[0];
    expect(after.id).toBe(id);
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // The short press still selected the note.
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-20: a 3px move starts a drag; the camera never pans', () => {
    setup();
    act(() => { createSticky(harness!.doc, { x: 0, y: 0 }); });
    const before = snapshot(harness!.doc)[0];
    const cameraBefore = harness!.getCamera();

    const note = noteAt(0);
    press(note, 100, 100);
    move(note, 103, 100); // exactly at the threshold
    // While dragging the note toolbar is hidden.
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    release(note, 103, 100);

    const after = snapshot(harness!.doc)[0];
    expect(after.x).toBeCloseTo(before.x + 3, 6);
    const cameraAfter = harness!.getCamera();
    expect(cameraAfter.x).toBe(cameraBefore.x);
    expect(cameraAfter.y).toBe(cameraBefore.y);
    expect(cameraAfter.zoom).toBe(cameraBefore.zoom);
    // Dragging brings the note to the front and leaves it selected.
    expect(note.dataset.selected).toBe('true');
  });

  it('TC-21: a pointercancel during a drag ends the drag at the last position', () => {
    setup();
    act(() => { createSticky(harness!.doc, { x: 0, y: 0 }); });
    const note = noteAt(0);
    press(note, 100, 100);
    move(note, 110, 105);
    pointer(note, 'pointercancel', 110, 105);
    // Further moves are ignored.
    move(note, 300, 300);
    release(note, 300, 300);

    // The note was centred on (0,0), so its top-left starts at -100,-100 and
    // the drag adds the pointer delta divided by the (1.0) zoom.
    const after = snapshot(harness!.doc)[0];
    expect(after.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2 + 10, 6);
    expect(after.y).toBeCloseTo(-STICKY_SIZE_WORLD / 2 + 5, 6);
    expect(note.dataset.selected).toBe('true');
  });
});

describe('editing entry and stale notes (TC-35, TC-36, TC-37)', () => {
  it('TC-35: double-clicking an existing note edits it and never creates a second note', () => {
    setup();
    act(() => { createSticky(harness!.doc, { x: 0, y: 0 }); });
    const note = noteAt(0);
    fireEvent.doubleClick(note);

    expect(snapshot(harness!.doc)).toHaveLength(1);
    expect(screen.getByLabelText('Sticky note text')).toBeInTheDocument();
  });

  it('TC-36: pressing Enter with nothing selected creates nothing', () => {
    setup();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(snapshot(harness!.doc)).toHaveLength(0);
  });

  it('TC-37: a note deleted by the model mid-drag ends the drag without an exception', () => {
    setup();
    let id = '';
    act(() => { id = createSticky(harness!.doc, { x: 0, y: 0 }); });
    const note = noteAt(0);
    press(note, 100, 100);
    move(note, 120, 100);
    // Deleted underneath the drag (e.g. by another user in story 3).
    act(() => {
      harness!.doc.transact(() => {
        harness!.doc.getMap('objects').delete(id);
      });
    });
    move(note, 140, 120);
    release(note, 140, 120);

    expect(snapshot(harness!.doc)).toHaveLength(0);
  });

  it('TC-37: a note deleted while editing ends editing without re-creating it', () => {
    setup();
    let id = '';
    act(() => { id = createSticky(harness!.doc, { x: 0, y: 0 }); });
    const note = noteAt(0);
    fireEvent.doubleClick(note);
    expect(screen.getByLabelText('Sticky note text')).toBeInTheDocument();

    act(() => {
      harness!.doc.transact(() => {
        harness!.doc.getMap('objects').delete(id);
      });
    });

    expect(screen.queryByLabelText('Sticky note text')).not.toBeInTheDocument();
    expect(snapshot(harness!.doc)).toHaveLength(0);
  });
});

describe('note geometry and accessible defaults', () => {
  it('renders a square note with the accessible name "Sticky note"', () => {
    setup();
    act(() => { createSticky(harness!.doc, { x: 100, y: 100 }); });
    const note = noteAt(0);
    expect(note).toHaveAccessibleName('Sticky note');
    expect(note.style.width).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note.style.height).toBe(`${STICKY_SIZE_WORLD}px`);
    expect(note.tabIndex).toBe(0);
  });
});

describe('painting order', () => {
  it('applies the model z as z-index and keeps the DOM order stable across a drag', () => {
    setup();
    let firstId = '';
    let secondId = '';
    act(() => {
      firstId = createSticky(harness!.doc, { x: 0, y: 0 });
      secondId = createSticky(harness!.doc, { x: 300, y: 0 });
    });
    const noteFor = (id: string): HTMLElement =>
      document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
    const domOrder = () =>
      [...document.querySelectorAll('[data-testid="sticky-note"]')]
        .map((n) => (n as HTMLElement).dataset.noteId)
        .join(',');

    const before = domOrder();
    expect(noteFor(firstId).style.zIndex).toBe('1');

    // Drag the bottom note; bringToFront raises its z without re-ordering the DOM
    // (a re-render that moved the node would drop pointer capture mid-drag).
    press(noteFor(firstId), 400, 300);
    move(noteFor(firstId), 420, 320);
    release(noteFor(firstId), 420, 320);

    expect(domOrder()).toBe(before);
    expect(snapshot(harness!.doc).find((n) => n.id === firstId)!.z).toBe(3);
    expect(noteFor(firstId).style.zIndex).toBe('3');
    expect(noteFor(secondId).style.zIndex).toBe('2');
  });
});
