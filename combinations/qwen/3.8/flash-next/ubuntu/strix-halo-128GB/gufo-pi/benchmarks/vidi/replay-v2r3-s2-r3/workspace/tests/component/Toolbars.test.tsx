import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../src/client/App';
import { getStickyText } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { flushRaf, getDoc, getNotes, noteById, textarea, hooks } from './helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function click(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerId: 3, clientX: 10, clientY: 10, button: 0, pointerType: 'mouse' });
  fireEvent.pointerUp(el, { pointerId: 3, clientX: 10, clientY: 10, pointerType: 'mouse' });
  fireEvent.click(el);
  flushRaf();
}

function setCamera(camera: { x: number; y: number; zoom: number }) {
  act(() => {
    hooks().setCamera(camera);
  });
  flushRaf();
}

function type(value: string) {
  fireEvent.change(textarea()!, { target: { value } });
  flushRaf();
}

function createViaToolbar(): string {
  click(screen.getByTestId('create-sticky'));
  const notes = getNotes();
  if (notes.length === 0) throw new Error('toolbar button created nothing');
  return notes[notes.length - 1].id;
}

describe('Board toolbar: create', () => {
  // TC-28
  it('TC-28 creates one note centred on the viewport centre and starts editing', () => {
    render(<App />);
    flushRaf();
    expect(getNotes()).toHaveLength(0);

    const button = screen.getByRole('button', { name: 'Sticky note' });
    expect(button.title).toBe('Sticky note – or double-click the board');
    click(button);

    const notes = getNotes();
    expect(notes).toHaveLength(1);
    const expected = {
      x: window.innerWidth / 2 - STICKY_SIZE_WORLD / 2,
      y: window.innerHeight / 2 - STICKY_SIZE_WORLD / 2,
    };
    expect(notes[0].x).toBeCloseTo(expected.x, 6);
    expect(notes[0].y).toBeCloseTo(expected.y, 6);
    expect(notes[0].color).toBe('yellow');

    // ... straight into Editing, ready for typing
    expect(textarea()).not.toBeNull();
    expect(document.activeElement).toBe(textarea());
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-34 (component companion) creates at the centre of the visible area when panned far away', () => {
    render(<App />);
    flushRaf();

    setCamera({ x: 4200, y: -3100, zoom: 1 });
    const id = createViaToolbar();

    const note = noteById(id)!;
    expect(note.x).toBeCloseTo(4200 + window.innerWidth / 2 - STICKY_SIZE_WORLD / 2, 6);
    expect(note.y).toBeCloseTo(-3100 + window.innerHeight / 2 - STICKY_SIZE_WORLD / 2, 6);
    expect(textarea()).not.toBeNull();
  });

  it('creates on double-click of empty board space, centred on the point', () => {
    render(<App />);
    flushRaf();

    const viewport = screen.getByTestId('board-viewport');
    fireEvent.doubleClick(viewport, { clientX: 400, clientY: 300 });
    flushRaf();

    const notes = getNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].x).toBeCloseTo(400 - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0].y).toBeCloseTo(300 - STICKY_SIZE_WORLD / 2, 6);
    expect(textarea()).not.toBeNull();
  });

  it('does not clear the selection when the board toolbar is clicked', () => {
    render(<App />);
    flushRaf();
    const id = createViaToolbar();
    fireEvent.keyDown(textarea()!, { key: 'Escape', bubbles: true, cancelable: true });
    flushRaf();
    expect(noteById(id)!.id).toBe(id);

    click(screen.getByTestId('board-toolbar'));
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });
});

describe('Note toolbar: colour and delete', () => {
  // TC-27
  it('TC-27 recolours the note and keeps it selected', () => {
    render(<App />);
    flushRaf();
    const id = createViaToolbar();
    type('Keep me');
    fireEvent.keyDown(textarea()!, { key: 'Escape', bubbles: true, cancelable: true });
    flushRaf();

    const before = noteById(id)!;
    expect(before.color).toBe('yellow');
    const swatches = screen.getAllByRole('button', { name: /colour$/ });
    expect(swatches).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Yellow colour' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute('aria-pressed', 'false');

    click(screen.getByRole('button', { name: 'Pink colour' }));

    expect(noteById(id)!.color).toBe('pink');
    expect(noteById(id)!.x).toBe(before.x);
    expect(noteById(id)!.y).toBe(before.y);
    expect(noteById(id)!.z).toBe(before.z);
    expect(getStickyText(getDoc(), id)!.toString()).toBe('Keep me');
    // still selected
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(document.querySelector(`[data-note-id="${id}"]`)!.getAttribute('data-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute('aria-pressed', 'true');
    expect(STICKY_COLORS.pink).toBe('#F48FB1');
  });

  // TC-29
  it('TC-29 deletes the note and clears the selection', () => {
    render(<App />);
    flushRaf();
    const id = createViaToolbar();
    fireEvent.keyDown(textarea()!, { key: 'Escape', bubbles: true, cancelable: true });
    flushRaf();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    click(screen.getByRole('button', { name: 'Delete note' }));

    expect(getNotes()).toHaveLength(0);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('is hidden while editing and while dragging, and shown when selected', () => {
    render(<App />);
    flushRaf();
    const id = createViaToolbar();
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // Editing

    fireEvent.keyDown(textarea()!, { key: 'Escape', bubbles: true, cancelable: true });
    flushRaf();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument(); // Selected

    const el = document.querySelector(`[data-note-id="${id}"]`)!;
    fireEvent.pointerDown(el, { pointerId: 4, clientX: 300, clientY: 300, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(el, { pointerId: 4, clientX: 330, clientY: 300, pointerType: 'mouse' });
    flushRaf();
    expect(screen.queryByTestId('note-toolbar')).toBeNull(); // Dragging
    fireEvent.pointerUp(el, { pointerId: 4, clientX: 330, clientY: 300, pointerType: 'mouse' });
    flushRaf();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument(); // Selected again
  });
});
