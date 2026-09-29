import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/client/App';
import type { Camera } from '../../src/client/canvas/camera';
import { ResizeObserverStub } from './setup';
import { dispatchPointer, VIEWPORT } from './helpers/events';

const flush = (): void => {
  act(() => {
    vi.advanceTimersByTime(64);
  });
};

const vp = (): HTMLElement => screen.getByTestId('board-viewport');
const notes = (): HTMLElement[] => screen.queryAllByTestId('sticky-note');
const noteAt = (i: number): HTMLElement => screen.queryAllByTestId('sticky-note')[i];
const textEl = (): HTMLElement => screen.getByTestId('sticky-note-text');
const camera = (): Camera => window.__vidi6!.getCamera();
const centreX = VIEWPORT.width / 2;
const centreY = VIEWPORT.height / 2;

const leftOf = (el: HTMLElement): number => parseFloat(el.style.left);
const topOf = (el: HTMLElement): number => parseFloat(el.style.top);
const zOf = (el: HTMLElement): number => Number(el.dataset.z);

/** A real double-click: down/up, down/up, dblclick (mirrors browser ordering). */
function doubleClick(el: Element, x: number, y: number): void {
  dispatchPointer(el, 'pointerdown', x, y);
  dispatchPointer(el, 'pointerup', x, y);
  dispatchPointer(el, 'pointerdown', x, y);
  dispatchPointer(el, 'pointerup', x, y);
  fireEvent.dblClick(el, { clientX: x, clientY: y });
  flush();
}

function createNote(x = centreX, y = centreY): HTMLElement {
  doubleClick(vp(), x, y);
  const all = notes();
  return all[all.length - 1];
}

/** End editing (Escape) so the note is selected with its toolbar showing. */
function stopEditing(): void {
  fireEvent.keyDown(textEl(), { key: 'Escape' });
  flush();
}

/** A click on empty board space (down + up without moving). */
function clickEmpty(x = 40, y = 40): void {
  dispatchPointer(vp(), 'pointerdown', x, y);
  dispatchPointer(vp(), 'pointerup', x, y);
  flush();
}

/** Type into the open editor via the native input event (React onInput). */
function typeInto(text: string): void {
  fireEvent.input(textEl(), { target: { value: text } });
  flush();
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('create (sticky.creation)', () => {
  // TC-36: double-click the board -> one note, 200 world units, edit opened.
  it('TC-36 creates a note centred on the double-click and opens its editor', () => {
    render(<App />);
    expect(notes()).toHaveLength(0);
    const note = createNote(centreX, centreY);
    expect(notes()).toHaveLength(1);
    // 200 world units square, centred on the (0,0) world point at this camera.
    expect(note.style.width).toBe('200px');
    expect(note.style.height).toBe('200px');
    expect(leftOf(note)).toBe(-100);
    expect(topOf(note)).toBe(-100);
    expect(note.dataset.color).toBe('yellow');
    // Edit opens with focus in the text box.
    expect(document.activeElement).toBe(textEl());
    expect(textEl().tagName).toBe('TEXTAREA');
  });

  // TC-36b: the toolbar "Sticky note" button also creates a note at the centre.
  it('creates a centred note from the toolbar button', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('create-sticky'));
    flush();
    const note = noteAt(0);
    expect(leftOf(note)).toBe(-100);
    expect(document.activeElement).toBe(textEl());
  });

  // TC-22: a newly created note is last in the z-order.
  it('TC-22 draws a new note above existing notes', () => {
    render(<App />);
    const a = createNote(300, 200);
    const b = createNote(500, 400);
    expect(zOf(b)).toBeGreaterThan(zOf(a));
  });
});

describe('select and drag to move (sticky.interaction)', () => {
  // TC-18: press and release without moving selects the note.
  it('TC-18 selects on press + release without moving', () => {
    render(<App />);
    const note = createNote();
    stopEditing();
    clickEmpty();
    expect(note.dataset.selected).toBe('false');
    dispatchPointer(note, 'pointerdown', centreX, centreY);
    dispatchPointer(note, 'pointerup', centreX, centreY);
    flush();
    expect(note.dataset.selected).toBe('true');
  });

  // TC-19: a 2px move stays under the threshold -> still Selected, not moved.
  it('TC-19 does not move on a 2px drag (below threshold)', () => {
    render(<App />);
    const note = createNote();
    stopEditing();
    const before = leftOf(note);
    dispatchPointer(note, 'pointerdown', centreX, centreY);
    dispatchPointer(note, 'pointermove', centreX + 2, centreY);
    flush();
    dispatchPointer(note, 'pointerup', centreX + 2, centreY);
    flush();
    expect(note.dataset.selected).toBe('true');
    expect(leftOf(note)).toBe(before);
  });

  // TC-20: drag >= threshold moves the note; the camera does not change.
  it('TC-20 drags the note exactly with the pointer and does not pan', () => {
    render(<App />);
    const note = createNote();
    stopEditing();
    const beforeLeft = leftOf(note);
    const beforeTop = topOf(note);
    const beforeCam = camera();
    dispatchPointer(note, 'pointerdown', centreX, centreY);
    dispatchPointer(note, 'pointermove', centreX + 40, centreY + 25);
    flush();
    dispatchPointer(note, 'pointerup', centreX + 40, centreY + 25);
    flush();
    expect(leftOf(note)).toBeCloseTo(beforeLeft + 40, 6);
    expect(topOf(note)).toBeCloseTo(beforeTop + 25, 6);
    expect(camera()).toEqual(beforeCam);
  });

  // TC-21: double-clicking an overlapping note brings it to the front.
  it('TC-21 raises a double-clicked note above the other', () => {
    render(<App />);
    const a = createNote(centreX, centreY);
    const b = createNote(centreX, centreY);
    expect(zOf(b)).toBeGreaterThan(zOf(a));
    doubleClick(a, centreX, centreY);
    expect(zOf(a)).toBeGreaterThan(zOf(b));
  });

  // TC-23: the delete button removes the note.
  it('TC-23 deletes the note from its toolbar', () => {
    render(<App />);
    createNote();
    stopEditing();
    fireEvent.click(screen.getByTestId('delete-note'));
    flush();
    expect(notes()).toHaveLength(0);
  });

  // TC-24 / TC-38: clicking empty space clears selection (and editing).
  it('TC-24 deselects on a click of empty space', () => {
    render(<App />);
    const note = createNote();
    stopEditing();
    expect(note.dataset.selected).toBe('true');
    clickEmpty();
    expect(note.dataset.selected).toBe('false');
  });

  it('TC-38 a click of empty space ends editing and clears selection', () => {
    render(<App />);
    const note = createNote();
    // While still editing, a pointerdown on empty space ends editing unselected.
    dispatchPointer(vp(), 'pointerdown', 40, 40);
    dispatchPointer(vp(), 'pointerup', 40, 40);
    flush();
    expect(note.dataset.selected).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  // The camera is untouched by selecting or dragging a note.
  it('does not pan the camera while interacting with a note', () => {
    render(<App />);
    const note = createNote();
    const before = camera();
    dispatchPointer(note, 'pointerdown', centreX, centreY);
    dispatchPointer(note, 'pointermove', centreX + 120, centreY - 90);
    flush();
    dispatchPointer(note, 'pointerup', centreX + 120, centreY - 90);
    flush();
    expect(camera()).toEqual(before);
  });
});

describe('selection toolbar (sticky.toolbar)', () => {
  // TC-37: six colour swatches (current one aria-pressed) + delete bin.
  it('TC-37 shows six swatches and a delete bin when a note is selected', () => {
    render(<App />);
    createNote();
    stopEditing();
    const toolbar = screen.getByTestId('note-toolbar');
    expect(toolbar).toBeTruthy();
    const swatches = screen.getAllByRole('button', { name: / colour$/ });
    expect(swatches).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Blue colour' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
  });

  it('changes the note colour from a swatch and keeps it selected', () => {
    render(<App />);
    const note = createNote();
    stopEditing();
    fireEvent.click(screen.getByTestId('swatch-blue'));
    flush();
    expect(note.dataset.color).toBe('blue');
    expect(note.dataset.selected).toBe('true');
    expect(screen.getByRole('button', { name: 'Blue colour' }).getAttribute('aria-pressed')).toBe('true');
  });

  // Selecting a note must not remount the note text (caret / scroll preserved).
  it('TC-41 selecting does not reset the note element (no remount)', () => {
    render(<App />);
    const note = createNote();
    typeInto('keep me');
    stopEditing();
    // Same DOM element after selecting / deselecting: identity is preserved.
    const display = textEl();
    expect(display.textContent).toBe('keep me');
    clickEmpty();
    dispatchPointer(note, 'pointerdown', centreX, centreY);
    dispatchPointer(note, 'pointerup', centreX, centreY);
    flush();
    expect(textEl()).toBe(display);
  });

  it('survives a viewport resize without error', () => {
    render(<App />);
    const note = createNote();
    act(() => {
      ResizeObserverStub.resize(1000, 600);
    });
    flush();
    expect(screen.getAllByTestId('sticky-note')).toHaveLength(1);
    expect(note).toBeTruthy();
  });

  // TC-41 (App level): panning/zooming does not move notes; position is world.
  it('TC-41 navigating (pan) leaves note world positions unchanged', () => {
    render(<App />);
    const note = createNote();
    stopEditing();
    const beforeLeft = leftOf(note);
    const beforeTop = topOf(note);
    const beforeCam = camera();
    // Pan by dragging empty board space.
    dispatchPointer(vp(), 'pointerdown', 600, 600);
    dispatchPointer(vp(), 'pointermove', 700, 650);
    flush();
    dispatchPointer(vp(), 'pointerup', 700, 650);
    flush();
    expect(notes()).toHaveLength(1);
    expect(leftOf(note)).toBe(beforeLeft);
    expect(topOf(note)).toBe(beforeTop);
    expect(camera()).not.toEqual(beforeCam);
  });
});
