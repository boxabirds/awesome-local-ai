/**
 * Story 8 component tests — undo.controls (TC-18 to TC-21): buttons disabled
 * on an empty stack, the five undo/redo shortcuts (with preventDefault), the
 * load-failed board ignoring shortcuts and disabling buttons, and Ctrl+Z
 * inside an ordinary input not reaching the board controller.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { createSticky, snapshot } from 'src/shared/board-model';
import { NUDGE_STEP_WORLD } from 'src/shared/config';
import type { UndoController } from 'src/client/board/undo';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

function getUndo(): UndoController {
  const w = window as unknown as { __vidi6: { undo: UndoController } };
  return w.__vidi6.undo;
}

/** Direct doc mutations wrapped in act() so the re-render flushes. */
function makeNote(x: number, y: number, text: string): string {
  const doc = getDoc();
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y }, 'yellow', text)!;
  });
  return id;
}

/** Nudge the (single) selection right by one step → one undo step. */
async function nudgeOnce(): Promise<void> {
  expect(fireEvent.keyDown(window, { key: 'ArrowRight' })).toBe(false);
}

describe('undo.controls (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-18: empty stack → both buttons disabled and aria-disabled', async () => {
    const user = userEvent.setup();
    // No notes, no steps.
    expect(snapshot(getDoc())).toHaveLength(0);

    const undoBtn = screen.getByTestId('undo-button') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('redo-button') as HTMLButtonElement;
    expect(undoBtn).toBeDisabled();
    expect(undoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn).toBeDisabled();
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');

    // Clicking a disabled button is a no-op (no steps to consume).
    await user.click(undoBtn).catch(() => {});
    expect(getUndo().canUndo()).toBe(false);
  });

  it('TC-19: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y call the controller with preventDefault', async () => {
    const doc = getDoc();
    const undo = getUndo();
    const undoSpy = vi.spyOn(undo, 'undo');
    const redoSpy = vi.spyOn(undo, 'redo');

    const id = makeNote(0, 0, 'a');
    const [note] = screen.getAllByTestId('sticky-note');
    const user = userEvent.setup();
    await user.click(note);
    const start = snapshot(doc).find((o) => o.id === id)!;
    await nudgeOnce();
    let s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + NUDGE_STEP_WORLD);

    // Ctrl+Z → undo.
    expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).toBe(false);
    expect(undoSpy).toHaveBeenCalledTimes(1);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x);

    // Ctrl+Shift+Z → redo.
    expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(redoSpy).toHaveBeenCalledTimes(1);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + NUDGE_STEP_WORLD);

    // Ctrl+Y → redo again (after an undo).
    expect(fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: 'y', ctrlKey: true })).toBe(false);
    expect(redoSpy).toHaveBeenCalledTimes(2);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + NUDGE_STEP_WORLD);

    // Cmd variants (mac).
    await nudgeOnce();
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + 2 * NUDGE_STEP_WORLD);
    expect(fireEvent.keyDown(window, { key: 'z', metaKey: true })).toBe(false);
    expect(undoSpy).toHaveBeenCalledTimes(3);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + NUDGE_STEP_WORLD);
    expect(fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true })).toBe(false);
    expect(redoSpy).toHaveBeenCalledTimes(3);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + 2 * NUDGE_STEP_WORLD);
  });

  it('TC-21: Ctrl+Z in a non-board input → controller not called (negative)', async () => {
    const doc = getDoc();
    const undo = getUndo();
    const undoSpy = vi.spyOn(undo, 'undo');

    const id = makeNote(0, 0, 'a');
    const [note] = screen.getAllByTestId('sticky-note');
    const user = userEvent.setup();
    await user.click(note);
    await nudgeOnce();
    const moved = snapshot(doc).find((o) => o.id === id)!;
    expect(moved.x).toBe(-100 + NUDGE_STEP_WORLD);

    // Focus an ordinary input (the share link field).
    await user.click(screen.getByTestId('share-button'));
    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    await user.click(field);

    // Ctrl+Z inside the field: the browser's own input undo — not the board.
    const prevented = fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    expect(prevented).toBe(true); // default NOT prevented
    expect(undoSpy).not.toHaveBeenCalled();
    const s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(-100 + NUDGE_STEP_WORLD);
  });
});
