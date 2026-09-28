/**
 * Component tests for undo.controls (TC-18 to TC-21).
 * Tests undo/redo shortcuts, buttons, and edit lock behavior.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { UseUndoResult } from '../../src/client/board/useUndo';
import { useSelection } from '../../src/client/board/useSelection';
import type { UndoController } from '../../src/client/board/undo';
import type { ObjectSnapshot } from '../../src/shared/board-model';

afterEach(cleanup);

function makeFakeUndoResult(overrides: Partial<UseUndoResult> = {}): UseUndoResult {
  return {
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  };
}

// ─── TC-18: empty stacks → buttons disabled ──────────────────────────────────
describe('TC-18: empty history shows disabled buttons', () => {
  it('Undo and Redo buttons are disabled with aria-disabled when stacks are empty', () => {
    const undoResult = makeFakeUndoResult({ canUndo: false, canRedo: false });
    render(<UndoButtons {...undoResult} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');

    expect(undoBtn).toBeDisabled();
    expect(undoBtn).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn).toBeDisabled();
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('Undo button is enabled when canUndo is true', () => {
    const undoResult = makeFakeUndoResult({ canUndo: true, canRedo: false });
    render(<UndoButtons {...undoResult} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');

    expect(undoBtn).not.toBeDisabled();
    expect(undoBtn).toHaveAttribute('aria-disabled', 'false');
    expect(redoBtn).toBeDisabled();
    expect(redoBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('Both buttons are enabled when both stacks have items', () => {
    const undoResult = makeFakeUndoResult({ canUndo: true, canRedo: true });
    render(<UndoButtons {...undoResult} />);

    expect(screen.getByLabelText('Undo')).not.toBeDisabled();
    expect(screen.getByLabelText('Redo')).not.toBeDisabled();
  });
});

// ─── TC-19: keyboard shortcuts call controller with preventDefault ────────────
describe('TC-19: keyboard shortcuts trigger undo/redo', () => {
  // Helper component that wires useBoardKeys
  function TestKeyHandler({ undoController, canEdit = true }: {
    undoController: UndoController;
    canEdit?: boolean;
  }) {
    const doc = (undoController as any).__doc as Y.Doc | undefined;
    const actualDoc = doc ?? new Y.Doc();
    const notes: ObjectSnapshot[] = [];
    const selection = useSelection(notes);

    useBoardKeys({
      doc: actualDoc,
      selection,
      snapshot: notes,
      canEdit,
      undoController,
    });

    return <div data-testid="handler">test</div>;
  }

  it('Ctrl+Z calls undo with preventDefault', () => {
    const undoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: undoFn,
      redo: vi.fn().mockReturnValue(true),
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    render(<TestKeyHandler undoController={controller} />);

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(undoFn).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Cmd+Z calls undo with preventDefault', () => {
    const undoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: undoFn,
      redo: vi.fn().mockReturnValue(true),
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    render(<TestKeyHandler undoController={controller} />);

    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(undoFn).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+Shift+Z calls redo with preventDefault', () => {
    const redoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: vi.fn().mockReturnValue(true),
      redo: redoFn,
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    render(<TestKeyHandler undoController={controller} />);

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(redoFn).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Cmd+Shift+Z calls redo with preventDefault', () => {
    const redoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: vi.fn().mockReturnValue(true),
      redo: redoFn,
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    render(<TestKeyHandler undoController={controller} />);

    const event = new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(redoFn).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+Y calls redo with preventDefault', () => {
    const redoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: vi.fn().mockReturnValue(true),
      redo: redoFn,
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    render(<TestKeyHandler undoController={controller} />);

    const event = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(redoFn).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
});

// ─── TC-20: canEdit false → shortcuts ignored, buttons disabled ──────────────
describe('TC-20: load failed → undo disabled', () => {
  it('Ctrl+Z is ignored when canEdit is false', () => {
    const undoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: undoFn,
      redo: vi.fn().mockReturnValue(true),
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    function TestComponent() {
      const doc = new Y.Doc();
      const notes: ObjectSnapshot[] = [];
      const selection = useSelection(notes);
      useBoardKeys({ doc, selection, snapshot: notes, canEdit: false, undoController: controller });
      return <div>test</div>;
    }

    render(<TestComponent />);

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(undoFn).not.toHaveBeenCalled();
  });

  it('Undo/Redo buttons are disabled when canUndo/canRedo are false (locked state)', () => {
    const undoResult = makeFakeUndoResult({ canUndo: false, canRedo: false });
    render(<UndoButtons {...undoResult} />);

    expect(screen.getByLabelText('Undo')).toBeDisabled();
    expect(screen.getByLabelText('Redo')).toBeDisabled();
  });
});

// ─── TC-21: Ctrl+Z with focus in non-board input → controller not called ─────
describe('TC-21: Ctrl+Z in non-board input does not trigger undo', () => {
  it('Ctrl+Z focused in an input element does not call controller', () => {
    const undoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: undoFn,
      redo: vi.fn().mockReturnValue(true),
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    function TestComponent() {
      const doc = new Y.Doc();
      const notes: ObjectSnapshot[] = [];
      const selection = useSelection(notes);
      useBoardKeys({ doc, selection, snapshot: notes, canEdit: true, undoController: controller });
      return (
        <div>
          <input data-testid="share-input" defaultValue="https://example.com" />
        </div>
      );
    }

    render(<TestComponent />);

    const input = screen.getByTestId('share-input');
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    // Dispatch from the input element (event.target will be the input)
    input.dispatchEvent(event);

    expect(undoFn).not.toHaveBeenCalled();
  });

  it('Ctrl+Z focused in a textarea does not call controller', () => {
    const undoFn = vi.fn().mockReturnValue(true);
    const controller: UndoController = {
      undo: undoFn,
      redo: vi.fn().mockReturnValue(true),
      boundary: vi.fn(),
      canUndo: vi.fn().mockReturnValue(true),
      canRedo: vi.fn().mockReturnValue(true),
      addScope: vi.fn(),
      onChange: vi.fn().mockReturnValue(() => {}),
      destroy: vi.fn(),
    };

    function TestComponent() {
      const doc = new Y.Doc();
      const notes: ObjectSnapshot[] = [];
      const selection = useSelection(notes);
      useBoardKeys({ doc, selection, snapshot: notes, canEdit: true, undoController: controller });
      return (
        <div>
          <textarea data-testid="other-textarea" defaultValue="hello" />
        </div>
      );
    }

    render(<TestComponent />);

    const textarea = screen.getByTestId('other-textarea');
    textarea.focus();

    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    textarea.dispatchEvent(event);

    expect(undoFn).not.toHaveBeenCalled();
  });
});
