/**
 * Component tests for undo.controls (TC-18 to TC-21)
 *
 * Tests undo/redo shortcuts and toolbar buttons with a real App and Y.Doc.
 * Notes are pre-created on the doc BEFORE App renders so the controller
 * doesn't track them (only user-initiated mutations are tracked).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, moveObject, snapshot } from '../../src/shared/board-model';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { createUndo } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';

let doc: Y.Doc;
let renderResult: ReturnType<typeof render>;

function flush(): void {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

/** Pre-create a note before App renders so it's not tracked by the controller. */
function preCreateNote(at: { x: number; y: number } = { x: 0, y: 0 }): string {
  const id = createSticky(doc, at);
  return id;
}

function undoButton() {
  return screen.getByRole('button', { name: 'Undo' });
}

function redoButton() {
  return screen.getByRole('button', { name: 'Redo' });
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

describe('undo.controls — component', () => {
  it('TC-18: empty stacks → Undo and Redo buttons disabled', () => {
    renderResult = render(<App doc={doc} />);
    flush();

    // No LOCAL_ORIGIN transactions tracked → buttons disabled
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
  });

  it('TC-19: Ctrl+Z → undo; Ctrl+Shift+Z → redo; Ctrl+Y → redo; each preventDefault', () => {
    const id = preCreateNote({ x: 0, y: 0 });
    renderResult = render(<App doc={doc} />);
    flush();

    const startX = snapshot(doc).find((n) => n.id === id)!.x;

    // Select the note
    const el = screen.getByTestId('sticky-note');
    const at = { x: 600, y: 400 };
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: at.x, clientY: at.y });
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
    Object.defineProperty(pointerDown, 'pointerType', { value: 'mouse' });
    fireEvent(el, pointerDown);
    const pointerUp = new MouseEvent('pointerup', { bubbles: true, clientX: at.x, clientY: at.y });
    Object.defineProperty(pointerUp, 'pointerId', { value: 1 });
    Object.defineProperty(pointerUp, 'pointerType', { value: 'mouse' });
    fireEvent(el, pointerUp);
    flush();

    // Nudge right (creates an undo step via moveObjects with LOCAL_ORIGIN)
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    flush();

    const nudgedX = snapshot(doc).find((n) => n.id === id)!.x;
    expect(nudgedX).toBe(startX + 1);

    // Ctrl+Z should undo
    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, undoEvent);
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX);
    expect(undoEvent.defaultPrevented).toBe(true);

    // Ctrl+Shift+Z should redo
    const redoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, redoEvent);
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX + 1);
    expect(redoEvent.defaultPrevented).toBe(true);

    // Undo again to test Ctrl+Y
    const undoEvent2 = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, undoEvent2);
    flush();
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX);

    // Ctrl+Y should redo
    const ctrlYEvent = new KeyboardEvent('keydown', {
      key: 'y',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, ctrlYEvent);
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX + 1);
    expect(ctrlYEvent.defaultPrevented).toBe(true);
  });

  it('TC-19b: Cmd+Z → undo; Cmd+Shift+Z → redo (macOS)', () => {
    const id = preCreateNote({ x: 0, y: 0 });
    renderResult = render(<App doc={doc} />);
    flush();

    const startX = snapshot(doc).find((n) => n.id === id)!.x;

    // Select note and nudge
    const el = screen.getByTestId('sticky-note');
    const at = { x: 600, y: 400 };
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: at.x, clientY: at.y });
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
    Object.defineProperty(pointerDown, 'pointerType', { value: 'mouse' });
    fireEvent(el, pointerDown);
    const pointerUp = new MouseEvent('pointerup', { bubbles: true, clientX: at.x, clientY: at.y });
    Object.defineProperty(pointerUp, 'pointerId', { value: 1 });
    Object.defineProperty(pointerUp, 'pointerType', { value: 'mouse' });
    fireEvent(el, pointerUp);
    flush();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    flush();

    // Cmd+Z
    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, undoEvent);
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX);
    expect(undoEvent.defaultPrevented).toBe(true);

    // Cmd+Shift+Z
    const redoEvent = new KeyboardEvent('keydown', {
      key: 'Z',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(window, redoEvent);
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX + 1);
    expect(redoEvent.defaultPrevented).toBe(true);
  });

  it('TC-21: Ctrl+Z with focus in a non-board input → controller not called', () => {
    const id = preCreateNote({ x: 0, y: 0 });
    renderResult = render(<App doc={doc} />);
    flush();

    const startX = snapshot(doc).find((n) => n.id === id)!.x;

    // Create a tracked step: select note and nudge
    const el = screen.getByTestId('sticky-note');
    const at = { x: 600, y: 400 };
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: at.x, clientY: at.y });
    Object.defineProperty(pointerDown, 'pointerId', { value: 1 });
    Object.defineProperty(pointerDown, 'pointerType', { value: 'mouse' });
    fireEvent(el, pointerDown);
    const pointerUp = new MouseEvent('pointerup', { bubbles: true, clientX: at.x, clientY: at.y });
    Object.defineProperty(pointerUp, 'pointerId', { value: 1 });
    Object.defineProperty(pointerUp, 'pointerType', { value: 'mouse' });
    fireEvent(el, pointerUp);
    flush();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    flush();

    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX + 1);

    // Create a standalone input and simulate Ctrl+Z with that input as target
    const input = document.createElement('input');
    document.body.appendChild(input);

    const undoEvent = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(input, undoEvent);
    flush();

    // Note position unchanged (undo was not triggered)
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(startX + 1);

    document.body.removeChild(input);
  });
});

describe('undo.controls — edit lock (TC-20)', () => {
  it('TC-20: canEdit false → buttons disabled, undo/redo no-ops', () => {
    // Pre-create a note
    let id = '';
    doc.transact(() => { id = createSticky(doc, { x: 0, y: 0 }); }, LOCAL_ORIGIN);

    const ctrl = createUndo(doc, { captureTimeoutMs: 0 });
    ctrl.boundary();
    doc.transact(() => { moveObject(doc, id, 100, 100); }, LOCAL_ORIGIN);
    ctrl.boundary();

    // With canEdit=true, undo should be available
    const { result: resultEditable } = renderHook(() => useUndo(ctrl, true));
    expect(resultEditable.current.canUndo).toBe(true);

    // With canEdit=false (load failed), undo should be reported as unavailable
    const { result: resultReadOnly } = renderHook(() => useUndo(ctrl, false));
    expect(resultReadOnly.current.canUndo).toBe(false);
    expect(resultReadOnly.current.canRedo).toBe(false);

    // Calling undo() when canEdit is false should not actually undo
    const posBefore = snapshot(doc).find((n) => n.id === id)!.x;
    act(() => { resultReadOnly.current.undo(); });
    expect(snapshot(doc).find((n) => n.id === id)!.x).toBe(posBefore);

    ctrl.destroy();
  });
});
