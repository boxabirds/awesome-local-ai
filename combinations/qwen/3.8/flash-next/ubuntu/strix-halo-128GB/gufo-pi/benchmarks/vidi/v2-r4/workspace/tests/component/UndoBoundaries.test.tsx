/**
 * Component tests for undo.boundaries (TC-14 to TC-17)
 *
 * Uses the full App component with a real Y.Doc and real UndoController (created
 * internally by App). Verifies boundaries through the Undo button/shortcut.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, stickySnapshot as snapshot, getStickyText } from '../../src/shared/board-model';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';

let doc: Y.Doc;
let renderResult: ReturnType<typeof render>;

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

function addNote(at: { x: number; y: number } = { x: 0, y: 0 }): string {
  let id = '';
  act(() => {
    id = createSticky(doc, at);
  });
  flush();
  return id;
}

function cameraOf(): { x: number; y: number; zoom: number } {
  const el = screen.getByTestId('board-viewport');
  return {
    x: Number(el.dataset.cameraX),
    y: Number(el.dataset.cameraY),
    zoom: Number(el.dataset.zoom),
  };
}

function centreOf(noteX: number, noteY: number): { x: number; y: number } {
  const camera = cameraOf();
  return {
    x: (noteX - camera.x) * camera.zoom + STICKY_SIZE_WORLD / 2,
    y: (noteY - camera.y) * camera.zoom + STICKY_SIZE_WORLD / 2,
  };
}

function pointerEvent(type: string, x: number, y: number, target: Element | Window): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(target, event);
}

function undoButton() {
  return screen.getByRole('button', { name: 'Undo' });
}

beforeEach(() => {
  vi.useFakeTimers();
  doc = new Y.Doc();
});

afterEach(() => {
  cleanup();
  renderResult?.unmount?.();
  vi.useRealTimers();
  doc?.destroy();
});

describe('undo.boundaries — component', () => {
  it('TC-14: 30-frame drag → one undo restores start positions', () => {
    renderResult = render(<App doc={doc} />);
    flush();

    const id = addNote({ x: 0, y: 0 });
    const startX = snapshot(doc).find((n) => n.id === id)!.x;
    const startY = snapshot(doc).find((n) => n.id === id)!.y;

    // Select the note
    const at = centreOf(startX, startY);
    const noteEl = screen.getByTestId('sticky-note');
    pointerEvent('pointerdown', at.x, at.y, noteEl);
    pointerEvent('pointerup', at.x, at.y, noteEl);
    flush();

    // Undo button should be disabled (note creation was done via addNote on doc directly)
    // After gesture: start dragging
    pointerEvent('pointerdown', at.x, at.y, noteEl);
    for (let i = 1; i <= 30; i++) {
      const moveEvent = new MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: at.x + i * 10,
        clientY: at.y + i * 5,
      });
      fireEvent(window, moveEvent);
      act(() => { vi.advanceTimersByTime(16); });
    }
    pointerEvent('pointerup', at.x + 300, at.y + 150, noteEl);
    flush();

    // Position should have moved
    const movedX = snapshot(doc).find((n) => n.id === id)!.x;
    expect(movedX).not.toBe(startX);

    // Undo button should be enabled
    expect(undoButton()).toBeEnabled();

    // One undo click restores start position (all 30 drag frames merged into one step)
    fireEvent.click(undoButton());
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX);
    expect(snapshot(doc).find((n) => n.id === id)!.y).toBe(startY);

    // The next undo is the create step (from addNote), not more drag frames.
    // Verify by undoing once more: the note disappears.
    fireEvent.click(undoButton());
    flush();
    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();
  });

  it('TC-15: drag then colour change → two separate steps', () => {
    renderResult = render(<App doc={doc} />);
    flush();

    const id = addNote({ x: 0, y: 0 });
    const startX = snapshot(doc).find((n) => n.id === id)!.x;

    // Select and drag the note
    const at = centreOf(startX, 0);
    const noteEl = screen.getByTestId('sticky-note');
    pointerEvent('pointerdown', at.x, at.y, noteEl);
    pointerEvent('pointerup', at.x, at.y, noteEl);
    flush();

    // Drag
    pointerEvent('pointerdown', at.x, at.y, noteEl);
    for (let i = 1; i <= 5; i++) {
      const moveEvent = new MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: at.x + i * 20,
        clientY: at.y,
      });
      fireEvent(window, moveEvent);
      act(() => { vi.advanceTimersByTime(16); });
    }
    pointerEvent('pointerup', at.x + 100, at.y, noteEl);
    flush();

    const movedX = snapshot(doc).find((n) => n.id === id)!.x;
    expect(movedX).not.toBe(startX);

    // Now change colour via the toolbar
    const pinkBtn = screen.getByRole('button', { name: 'Pink colour' });
    fireEvent.click(pinkBtn);
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.color).toBe('pink');

    // Two separate steps: undo colour
    fireEvent.click(undoButton());
    flush();
    expect(snapshot(doc).find((n) => n.id === id)!.color).not.toBe('pink');

    // Undo move
    fireEvent.click(undoButton());
    flush();
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX);
  });

  it('TC-16: type in editor then Ctrl+Z inside editor → typing undone; earlier move stays', () => {
    renderResult = render(<App doc={doc} />);
    flush();

    const id = addNote({ x: 0, y: 0 });
    const startX = snapshot(doc).find((n) => n.id === id)!.x;

    // Move the note (step 1) via drag
    const at = centreOf(startX, 0);
    const noteEl = screen.getByTestId('sticky-note');
    pointerEvent('pointerdown', at.x, at.y, noteEl);
    pointerEvent('pointerup', at.x, at.y, noteEl);
    flush();

    pointerEvent('pointerdown', at.x, at.y, noteEl);
    for (let i = 1; i <= 3; i++) {
      const moveEvent = new MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: at.x + i * 20,
        clientY: at.y,
      });
      fireEvent(window, moveEvent);
      act(() => { vi.advanceTimersByTime(16); });
    }
    pointerEvent('pointerup', at.x + 60, at.y, noteEl);
    flush();

    const movedX = snapshot(doc).find((n) => n.id === id)!.x;
    expect(movedX).not.toBe(startX);

    // Start editing: double-click the note
    fireEvent.doubleClick(noteEl);
    flush();

    // Type into the editor
    const textarea = screen.getByTestId('sticky-textarea');
    // Write text via ytext to simulate typing
    const ytext = getStickyText(doc, id)!;
    act(() => {
      doc.transact(() => { ytext.insert(0, 'hello'); }, LOCAL_ORIGIN);
    });
    flush();

    // Now press Ctrl+Z inside the textarea (editor handles it)
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    flush();

    // Typing undone but not the move
    expect(ytext.toString()).toBe('');
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(movedX);
  });

  it('TC-17: pointercancel mid-drag → one step restoring start position', () => {
    renderResult = render(<App doc={doc} />);
    flush();

    const id = addNote({ x: 0, y: 0 });
    const startX = snapshot(doc).find((n) => n.id === id)!.x;

    // Select the note
    const at = centreOf(startX, 0);
    const noteEl = screen.getByTestId('sticky-note');
    pointerEvent('pointerdown', at.x, at.y, noteEl);
    pointerEvent('pointerup', at.x, at.y, noteEl);
    flush();

    // Start dragging
    pointerEvent('pointerdown', at.x, at.y, noteEl);
    for (let i = 1; i <= 5; i++) {
      const moveEvent = new MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: at.x + i * 20,
        clientY: at.y,
      });
      fireEvent(window, moveEvent);
      act(() => { vi.advanceTimersByTime(16); });
    }

    // Pointercancel
    const cancelEvent = new MouseEvent('pointercancel', {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, cancelEvent);
    flush();

    // One undo click restores start position
    fireEvent.click(undoButton());
    flush();
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX);
  });
});
