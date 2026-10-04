/**
 * Story 8 — component tests: undo shortcuts, buttons and edit lock
 * (TC-18 to TC-21).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, screen, act } from '@testing-library/react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  moveObject,
} from '../../src/shared/board-model';
import { useSelection } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useUndo } from '../../src/client/board/useUndo';
import { Toolbar } from '../../src/client/board/Toolbar';
import { createUndo, type UndoController } from '../../src/client/board/undo';

/** A doc with one seeded sticky note (non-local origin → no undo step). */
function seededDoc(): { doc: Y.Doc; id: string } {
  const doc = new Y.Doc();
  initDoc(doc);
  const seed = new Y.Doc();
  initDoc(seed);
  const id = createSticky(seed, { x: 100, y: 100 });
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), Symbol('seed'));
  seed.destroy();
  return { doc, id };
}

function key(opts: Record<string, unknown>): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, ...opts });
}

/** Seed two undo steps (two moves) on the controller. */
function seedTwoSteps(doc: Y.Doc, id: string, undo: UndoController): { x: number; y: number } {
  const start = snapshot(doc)[0];
  act(() => {
    undo.boundary();
    moveObject(doc, id, start.x + 10, start.y);
    undo.boundary();
    moveObject(doc, id, start.x + 20, start.y);
    undo.boundary();
  });
  return { x: start.x, y: start.y };
}

// ─── TC-18: empty stacks → both buttons disabled ───────────────────────────
describe('TC-18: empty stacks disable both buttons', () => {
  it('Undo and Redo buttons are disabled with an empty history', () => {
    const { doc } = seededDoc();
    const undo = createUndo(doc);
    const { result: binding } = renderHook(() => useUndo(undo, true));
    expect(binding.current.canUndo).toBe(false);
    expect(binding.current.canRedo).toBe(false);

    render(<Toolbar onCreateSticky={() => {}} undo={binding.current} />);
    const undoBtn = screen.getByTestId('undo-btn');
    const redoBtn = screen.getByTestId('redo-btn');
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
    expect(undoBtn).toHaveAttribute('aria-label', 'Undo');
    expect(redoBtn).toHaveAttribute('aria-label', 'Redo');
    undo.destroy();
  });
});

// ─── TC-19: all shortcut variants call the controller, with preventDefault ─
describe('TC-19: shortcut variants', () => {
  it('Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo; each preventDefault', () => {
    const { doc, id } = seededDoc();
    const undo = createUndo(doc);
    const notes = snapshot(doc);
    const { result: sel } = renderHook(() => useSelection(notes));
    const start = seedTwoSteps(doc, id, undo);

    renderHook(() =>
      useBoardKeys({
        doc,
        selection: sel.current,
        snapshot: notes,
        canEdit: true,
        boundary: () => undo.boundary(),
        undo,
      }),
    );

    const press = (opts: Record<string, unknown>): void => {
      const event = key(opts);
      const spy = vi.spyOn(event, 'preventDefault');
      act(() => {
        window.dispatchEvent(event);
      });
      expect(spy).toHaveBeenCalled();
    };

    // Ctrl+Z → undo step 2.
    press({ key: 'z', ctrlKey: true });
    expect(snapshot(doc)[0].x).toBe(start.x + 10);

    // Cmd+Z → undo step 1.
    press({ key: 'z', metaKey: true });
    expect(snapshot(doc)[0].x).toBe(start.x);

    // Ctrl+Shift+Z → redo step 1.
    press({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(snapshot(doc)[0].x).toBe(start.x + 10);

    // Cmd+Shift+Z → redo step 2.
    press({ key: 'z', metaKey: true, shiftKey: true });
    expect(snapshot(doc)[0].x).toBe(start.x + 20);

    // Ctrl+Z → undo one more.
    press({ key: 'z', ctrlKey: true });
    expect(snapshot(doc)[0].x).toBe(start.x + 10);

    // Ctrl+Y → redo.
    press({ key: 'y', ctrlKey: true });
    expect(snapshot(doc)[0].x).toBe(start.x + 20);
    undo.destroy();
  });
});

// ─── TC-20: load failed → shortcuts ignored, buttons disabled ──────────────
describe('TC-20: canEdit false (load failed)', () => {
  it('shortcuts are ignored and both buttons are disabled', () => {
    const { doc, id } = seededDoc();
    const undo = createUndo(doc);
    const notes = snapshot(doc);
    const { result: sel } = renderHook(() => useSelection(notes));
    const start = seedTwoSteps(doc, id, undo);

    renderHook(() =>
      useBoardKeys({
        doc,
        selection: sel.current,
        snapshot: notes,
        canEdit: false,
        boundary: () => undo.boundary(),
        undo,
      }),
    );

    act(() => {
      window.dispatchEvent(key({ key: 'z', ctrlKey: true }));
      window.dispatchEvent(key({ key: 'z', ctrlKey: true, shiftKey: true }));
      window.dispatchEvent(key({ key: 'y', ctrlKey: true }));
    });
    // Nothing was undone: the controller was never called.
    expect(snapshot(doc)[0].x).toBe(start.x + 20);

    const { result: binding } = renderHook(() => useUndo(undo, false));
    expect(binding.current.canUndo).toBe(false);
    expect(binding.current.canRedo).toBe(false);
    render(<Toolbar onCreateSticky={() => {}} undo={binding.current} />);
    expect(screen.getByTestId('undo-btn')).toBeDisabled();
    expect(screen.getByTestId('redo-btn')).toBeDisabled();
    undo.destroy();
  });
});

// ─── TC-21: focus in a non-board input → controller not called ─────────────
describe('TC-21: non-board input focus', () => {
  it('Ctrl+Z with focus in the share-link input does not call the controller', () => {
    const { doc, id } = seededDoc();
    const undo = createUndo(doc);
    const notes = snapshot(doc);
    const { result: sel } = renderHook(() => useSelection(notes));
    const start = seedTwoSteps(doc, id, undo);

    renderHook(() =>
      useBoardKeys({
        doc,
        selection: sel.current,
        snapshot: notes,
        canEdit: true,
        boundary: () => undo.boundary(),
        undo,
      }),
    );

    const input = document.createElement('input');
    input.setAttribute('data-testid', 'share-link-input');
    document.body.appendChild(input);
    input.focus();

    // Keydown originates from the focused input and bubbles to window.
    act(() => {
      input.dispatchEvent(key({ key: 'z', ctrlKey: true }));
    });
    expect(snapshot(doc)[0].x).toBe(start.x + 20);
    input.remove();
    undo.destroy();
  });
});
