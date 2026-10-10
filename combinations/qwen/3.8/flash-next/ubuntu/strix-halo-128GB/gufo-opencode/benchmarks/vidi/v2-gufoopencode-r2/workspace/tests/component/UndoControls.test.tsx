// TC-18 to TC-21: undo.controls with a fake controller — empty-stack button
// states, the five shortcuts routed with preventDefault, the load-failed
// lock, and focus in a non-board input keeping the controller untouched.

import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { useUndo } from '../../src/client/board/useUndo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { UndoController } from '../../src/client/board/undo';
import type { Selection } from '../../src/client/board/useSelection';
import { keyWith } from './selectionHelpers';

interface FakeController extends UndoController {
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
}

function fakeController(): FakeController {
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };
  const can = { undo: false, redo: false };
  return {
    // Each applied step flips availability, mirroring real stack semantics.
    undo: vi.fn(() => {
      can.undo = false;
      can.redo = true;
      notify();
      return true;
    }),
    redo: vi.fn(() => {
      can.undo = true;
      can.redo = false;
      notify();
      return true;
    }),
    boundary: vi.fn(),
    canUndo: () => can.undo,
    canRedo: () => can.redo,
    addScope: vi.fn(),
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => {
      listeners.clear();
    },
  };
}

const fakeSelection: Selection = {
  ids: new Set(),
  editingId: null,
  click: vi.fn(),
  toggle: vi.fn(),
  setMany: vi.fn(),
  clear: vi.fn(),
  startEdit: vi.fn(),
  endEdit: vi.fn(),
};

function Harness({
  controller,
  canEdit,
}: {
  controller: UndoController;
  canEdit: boolean;
}): React.JSX.Element {
  const undoState = useUndo(controller, canEdit);
  useBoardKeys({
    doc: new Y.Doc(),
    selection: fakeSelection,
    snapshot: [],
    canEdit,
    undoShortcuts: { undo: undoState.undo, redo: undoState.redo },
  });
  return (
    <div>
      <UndoButtons {...undoState} />
      <input data-testid="foreign-input" />
    </div>
  );
}

const undoButton = () => screen.getByRole('button', { name: 'Undo' });
const redoButton = () => screen.getByRole('button', { name: 'Redo' });

describe('undo controls', () => {
  it('TC-18: with empty stacks both buttons are disabled (aria-disabled)', () => {
    render(<Harness controller={fakeController()} canEdit />);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(undoButton()).toHaveAttribute('aria-disabled', 'true');
    expect(redoButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('TC-19: the five shortcuts route to the controller, each preventDefault', () => {
    const controller = fakeController();
    render(<Harness controller={controller} canEdit />);

    expect(keyWith('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(keyWith('z', { metaKey: true }).defaultPrevented).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(2); // Ctrl+Z and Cmd+Z

    expect(keyWith('Z', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(keyWith('Z', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(keyWith('y', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(3); // Ctrl/Cmd+Shift+Z, Ctrl+Y
  });

  it('TC-20: with the edit lock on, shortcuts are ignored and buttons disabled', () => {
    const controller = fakeController();
    render(<Harness controller={controller} canEdit={false} />);
    keyWith('z', { ctrlKey: true });
    keyWith('Z', { ctrlKey: true, shiftKey: true });
    keyWith('y', { ctrlKey: true });
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
  });

  it('TC-21: Ctrl+Z focused in a non-board input never reaches the controller', () => {
    const controller = fakeController();
    render(<Harness controller={controller} canEdit />);
    const input = screen.getByTestId('foreign-input');
    const ev = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(controller.undo).not.toHaveBeenCalled();
  });

  it('buttons enable and apply steps in both directions', () => {
    const controller = fakeController();
    render(<Harness controller={controller} canEdit />);
    expect(undoButton()).toBeDisabled();

    keyWith('z', { ctrlKey: true }); // routed; the fake flips the flags
    expect(controller.undo).toHaveBeenCalledTimes(1);
    expect(redoButton()).toBeEnabled();
    expect(undoButton()).toBeDisabled();

    act(() => {
      redoButton().click();
    });
    expect(controller.redo).toHaveBeenCalledTimes(1);
    expect(undoButton()).toBeEnabled(); // a step again, in both directions
  });
});
