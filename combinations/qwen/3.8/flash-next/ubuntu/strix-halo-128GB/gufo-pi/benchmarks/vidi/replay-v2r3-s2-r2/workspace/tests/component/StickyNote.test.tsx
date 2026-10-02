import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { StickyHarness } from './StickyHarness';
import { createSticky, deleteObject, getStickyText } from '../../src/shared/board-model';

function harness() {
  const h = window.__harness;
  if (!h) throw new Error('harness not ready');
  return h;
}

function grid(): HTMLElement {
  const el = document.querySelector('[data-grid-layer="true"]');
  if (!(el instanceof HTMLElement)) throw new Error('grid layer missing');
  return el;
}

function notes() {
  return screen.queryAllByTestId('sticky-note');
}

function addNote(x = 300, y = 200): string {
  let id = '';
  act(() => {
    id = createSticky(harness().doc, { x, y });
  });
  return id;
}

function firstNote(): HTMLElement {
  const n = notes()[0];
  if (!n) throw new Error('no note rendered');
  return n as HTMLElement;
}

function noteLeft(el: HTMLElement): number {
  return parseFloat(el.style.left);
}
function noteTop(el: HTMLElement): number {
  return parseFloat(el.style.top);
}

function tap(el: HTMLElement, x = 100, y = 100) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}

beforeEach(() => {
  window.__harness = undefined;
});
afterEach(() => {
  cleanup();
});

describe('sticky.interaction', () => {
  it('TC-18: press and release without moving selects the note (outline + toolbar)', () => {
    render(<StickyHarness />);
    const id = addNote();
    // select via a short tap
    tap(firstNote());
    expect(firstNote().getAttribute('data-selected')).toBe('true');
    expect(screen.queryByTestId('note-toolbar')).toBeTruthy();
    expect(harness().getSelectedId()).toBe(id);
  });

  it('TC-19: moving 2px (below threshold) selects but does not move the note', () => {
    render(<StickyHarness />);
    addNote();
    const before = noteLeft(firstNote());
    const el = firstNote();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 102, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 102, clientY: 100, pointerId: 1 });
    expect(noteLeft(firstNote())).toBe(before); // moveObject never called
    expect(firstNote().getAttribute('data-selected')).toBe('true');
  });

  it('TC-20: moving 3px (at threshold) starts dragging and does not pan the board', () => {
    render(<StickyHarness />);
    addNote();
    tap(firstNote()); // select → toolbar visible
    expect(screen.queryByTestId('note-toolbar')).toBeTruthy();

    const camBefore = harness().getCamera();
    const el = firstNote();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 103, clientY: 100, pointerId: 1 });

    // Dragging hides the toolbar and the camera never moves (note stopped propagation).
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    const camAfter = harness().getCamera();
    expect(camAfter.x).toBe(camBefore.x);
    expect(camAfter.y).toBe(camBefore.y);
    expect(camAfter.zoom).toBe(camBefore.zoom);
    fireEvent.pointerUp(el, { clientX: 103, clientY: 100, pointerId: 1 });
  });

  it('TC-21: pointercancel during a drag keeps the last position and selects', () => {
    render(<StickyHarness />);
    addNote();
    const startX = noteLeft(firstNote());
    const startY = noteTop(firstNote());
    const el = firstNote();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 130, clientY: 120, pointerId: 1 });
    fireEvent.pointerCancel(el, { clientX: 130, clientY: 120, pointerId: 1 });

    expect(noteLeft(firstNote())).toBeCloseTo(startX + 30, 6);
    expect(noteTop(firstNote())).toBeCloseTo(startY + 20, 6);
    expect(firstNote().getAttribute('data-selected')).toBe('true');
  });

  it('TC-22: clicking empty board space clears the selection', () => {
    render(<StickyHarness />);
    addNote();
    tap(firstNote());
    expect(screen.queryByTestId('note-toolbar')).toBeTruthy();

    tap(grid());
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(firstNote().getAttribute('data-selected')).toBe('false');
    expect(harness().getSelectedId()).toBeNull();
  });

  it('TC-25: pressing Delete removes the selected note', () => {
    render(<StickyHarness />);
    addNote();
    tap(firstNote());
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(notes()).toHaveLength(0);
    expect(harness().getSelectedId()).toBeNull();
  });

  it('TC-25: pressing Backspace removes the selected note', () => {
    render(<StickyHarness />);
    addNote();
    tap(firstNote());
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(notes()).toHaveLength(0);
  });

  it('TC-35: double-clicking an existing note edits it and does not create a new one', () => {
    render(<StickyHarness />);
    addNote();
    fireEvent.doubleClick(firstNote());
    expect(notes()).toHaveLength(1);
    expect(screen.queryByTestId('sticky-textarea')).toBeTruthy();
  });

  it('TC-36: pressing Enter with nothing selected does nothing', () => {
    render(<StickyHarness />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
  });

  it('TC-37: note deleted via model while dragging ends silently and is not recreated', () => {
    render(<StickyHarness />);
    const id = addNote();
    const el = firstNote();
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: 130, clientY: 120, pointerId: 1 });
    act(() => {
      deleteObject(harness().doc, id);
    });
    // Continued pointer movement on a gone note must not throw or recreate it.
    fireEvent.pointerMove(el, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: 160, clientY: 140, pointerId: 1 });
    expect(notes()).toHaveLength(0);
  });

  it('TC-37: note deleted via model while editing ends silently and is not recreated', () => {
    render(<StickyHarness />);
    const id = addNote();
    const yt = getStickyText(harness().doc, id)!;
    yt.insert(0, 'doomed');
    act(() => harness().startEdit(id));
    expect(screen.queryByTestId('sticky-textarea')).toBeTruthy();
    act(() => {
      deleteObject(harness().doc, id);
    });
    expect(notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
  });
});
