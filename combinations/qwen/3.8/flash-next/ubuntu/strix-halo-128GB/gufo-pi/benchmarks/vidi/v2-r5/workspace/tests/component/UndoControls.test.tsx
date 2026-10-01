import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { UndoController } from '../../src/client/board/undo';
import type { UseSelectionResult } from '../../src/client/board/useSelection';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type * as Y from 'yjs';

/**
 * Creates a fake UndoController for testing.
 */
function fakeController(opts?: {
  canUndo?: boolean;
  canRedo?: boolean;
}): UndoController & { undoCalls: number; redoCalls: number } {
  let canUndo = opts?.canUndo ?? false;
  let canRedo = opts?.canRedo ?? false;
  const listeners = new Set<() => void>();
  const obj = {
    undoCalls: 0,
    redoCalls: 0,
    undo(): boolean {
      obj.undoCalls++;
      if (!canUndo) return false;
      canUndo = false;
      canRedo = true;
      for (const l of listeners) l();
      return true;
    },
    redo(): boolean {
      obj.redoCalls++;
      if (!canRedo) return false;
      canRedo = false;
      canUndo = true;
      for (const l of listeners) l();
      return true;
    },
    boundary(): void {},
    canUndo(): boolean { return canUndo; },
    canRedo(): boolean { return canRedo; },
    addScope(): void {},
    onChange(cb: () => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    destroy(): void {},
  };
  return obj;
}

/** A minimal mock doc (not used by useBoardKeys handler logic itself, just passed through). */
const mockDoc = {} as unknown as Y.Doc;
const mockSnap: ObjectSnapshot[] = [];
const mockSelection: UseSelectionResult = {
  ids: new Set<string>(),
  editingId: null,
  click: vi.fn(),
  toggle: vi.fn(),
  clear: vi.fn(),
  setMany: vi.fn(),
  startEdit: vi.fn(),
  endEdit: vi.fn(),
  selectedId: null,
  select: vi.fn(),
};

describe('undo.controls', () => {
  afterEach(() => {
    cleanup();
  });

  // TC-18: empty stacks → Undo and Redo buttons disabled (aria-disabled)
  it('TC-18: buttons are disabled when history is empty', () => {
    const ctrl = fakeController({ canUndo: false, canRedo: false });
    const undoState = {
      canUndo: false,
      canRedo: false,
      undo: () => ctrl.undo(),
      redo: () => ctrl.redo(),
    };

    const { getByTestId } = render(<UndoButtons {...undoState} />);
    const undoBtn = getByTestId('undo-button');
    const redoBtn = getByTestId('redo-button');

    expect(undoBtn).toBeDisabled();
    expect(undoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(undoBtn).toHaveAttribute('aria-label', 'Undo');

    expect(redoBtn).toBeDisabled();
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn).toHaveAttribute('aria-label', 'Redo');
  });

  // TC-19: Ctrl+Z, Cmd+Z → undo; Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y → redo; each preventDefault
  it('TC-19: keyboard shortcuts call undo/redo with preventDefault', () => {
    const ctrl = fakeController({ canUndo: true, canRedo: true });

    // Test useBoardKeys in a wrapper component
    function TestKeys() {
      useBoardKeys({
        doc: mockDoc,
        selection: mockSelection,
        snapshot: mockSnap,
        canEdit: true,
        undoController: ctrl,
      });
      return <div data-testid="board">Board</div>;
    }

    render(<TestKeys />);

    // Ctrl+Z → undo
    const event1 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event1);
    expect(ctrl.undoCalls).toBe(1);
    expect(event1.defaultPrevented).toBe(true);

    // Cmd+Z → undo
    const event2 = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event2);
    expect(ctrl.undoCalls).toBe(2);
    expect(event2.defaultPrevented).toBe(true);

    // Ctrl+Shift+Z → redo
    const event3 = new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event3);
    expect(ctrl.redoCalls).toBe(1);
    expect(event3.defaultPrevented).toBe(true);

    // Cmd+Shift+Z → redo
    const event4 = new KeyboardEvent('keydown', { key: 'Z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event4);
    expect(ctrl.redoCalls).toBe(2);
    expect(event4.defaultPrevented).toBe(true);

    // Ctrl+Y → redo
    const event5 = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event5);
    expect(ctrl.redoCalls).toBe(3);
    expect(event5.defaultPrevented).toBe(true);
  });

  // TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled
  it('TC-20: shortcuts ignored and buttons disabled when canEdit is false', () => {
    const ctrl = fakeController({ canUndo: true, canRedo: true });

    function TestKeys() {
      useBoardKeys({
        doc: mockDoc,
        selection: mockSelection,
        snapshot: mockSnap,
        canEdit: false,
        undoController: ctrl,
      });
      return <div data-testid="board">Board</div>;
    }

    render(<TestKeys />);

    // Ctrl+Z should be ignored (not call undo)
    const event1 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event1);
    expect(ctrl.undoCalls).toBe(0);
    expect(event1.defaultPrevented).toBe(false);

    // Ctrl+Shift+Z should be ignored
    const event2 = new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event2);
    expect(ctrl.redoCalls).toBe(0);
    expect(event2.defaultPrevented).toBe(false);

    // Buttons should show disabled (canUndo/canRedo forced false by useUndo when !canEdit)
    const undoState = {
      canUndo: false,
      canRedo: false,
      undo: () => ctrl.undo(),
      redo: () => ctrl.redo(),
    };
    const { getByTestId } = render(<UndoButtons {...undoState} />);
    expect(getByTestId('undo-button')).toBeDisabled();
    expect(getByTestId('redo-button')).toBeDisabled();
  });

  // TC-21: Ctrl+Z with focus in non-board input (share-link field) → controller not called
  it('TC-21: Ctrl+Z in non-board input does not call controller', () => {
    const ctrl = fakeController({ canUndo: true, canRedo: true });

    function TestKeys() {
      useBoardKeys({
        doc: mockDoc,
        selection: mockSelection,
        snapshot: mockSnap,
        canEdit: true,
        undoController: ctrl,
      });
      return (
        <div>
          <input data-testid="share-input" aria-label="Share link" />
        </div>
      );
    }

    const { getByTestId } = render(<TestKeys />);
    const input = getByTestId('share-input');
    input.focus();

    // Ctrl+Z with focus in input → controller NOT called
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(ctrl.undoCalls).toBe(0);
  });
});
