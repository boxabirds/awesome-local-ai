import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useUndo } from '../../src/client/board/useUndo';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { UndoController } from '../../src/client/board/undo';
import * as Y from 'yjs';
import { useRef } from 'react';

/**
 * TC-18 to TC-21: Component tests for undo shortcuts, buttons and edit lock.
 * Uses a fake UndoController to test the wiring.
 */

// ---- Fake UndoController -----------------------------------------------------

function createFakeController(overrides?: Partial<UndoController>): UndoController {
  const listeners = new Set<() => void>();
  let canUndoVal = overrides?.canUndo?.() ?? false;
  let canRedoVal = overrides?.canRedo?.() ?? false;

  return {
    undo: vi.fn(() => {
      canUndoVal = false;
      canRedoVal = true;
      listeners.forEach((cb) => cb());
      return true;
    }),
    redo: vi.fn(() => {
      canRedoVal = false;
      canUndoVal = true;
      listeners.forEach((cb) => cb());
      return true;
    }),
    boundary: vi.fn(),
    canUndo: () => canUndoVal,
    canRedo: () => canRedoVal,
    addScope: vi.fn(),
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: vi.fn(),
    ...overrides,
  };
}

// ---- Test harness components -------------------------------------------------

function UndoButtonHarness({ controller, canEdit }: { controller: UndoController; canEdit: boolean }) {
  const { canUndo, canRedo, undo, redo } = useUndo(controller, canEdit);

  return (
    <Toolbar
      onCreateSticky={() => {}}
      disabled={!canEdit}
      canUndo={canUndo}
      canRedo={canRedo}
      onUndo={undo}
      onRedo={redo}
    />
  );
}

function BoardKeysHarness({
  controller,
  canEdit,
  doc,
}: {
  controller: UndoController;
  canEdit: boolean;
  doc: Y.Doc;
}) {
  const selection = useRef({
    ids: new Set<string>(),
    click: () => {},
    toggle: () => {},
    setMany: () => {},
    clear: () => {},
    startEdit: () => {},
    endEdit: () => {},
    selectAndEdit: () => {},
    editingId: null as string | null,
  }).current;

  useBoardKeys({
    doc,
    selection,
    snapshot: [],
    canEdit,
    undoController: controller,
  });
  return <div data-testid="board-keys-harness" />;
}

// ---- Tests -------------------------------------------------------------------

describe('undo.controls: component tests (TC-18 to TC-21)', () => {
  // TC-18: empty stacks → Undo and Redo buttons disabled
  it('TC-18: buttons disabled when stacks are empty', () => {
    const controller = createFakeController();
    render(<UndoButtonHarness controller={controller} canEdit={true} />);

    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');

    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
  });

  // TC-19: Ctrl+Z, Cmd+Z → undo; Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y → redo
  it('TC-19: keyboard shortcuts call controller with preventDefault', () => {
    const doc = new Y.Doc();
    const controller = createFakeController();

    render(<BoardKeysHarness controller={controller} canEdit={true} doc={doc} />);

    // Ctrl+Z → undo
    const e1 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e1);
    });
    expect((controller.undo as any).mock.calls.length).toBe(1);
    expect(e1.defaultPrevented).toBe(true);

    // Cmd+Z → undo
    const e2 = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e2);
    });
    expect((controller.undo as any).mock.calls.length).toBe(2);
    expect(e2.defaultPrevented).toBe(true);

    // Ctrl+Shift+Z → redo
    const e3 = new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e3);
    });
    expect((controller.redo as any).mock.calls.length).toBe(1);
    expect(e3.defaultPrevented).toBe(true);

    // Cmd+Shift+Z → redo
    const e4 = new KeyboardEvent('keydown', { key: 'Z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e4);
    });
    expect((controller.redo as any).mock.calls.length).toBe(2);
    expect(e4.defaultPrevented).toBe(true);

    // Ctrl+Y → redo
    const e5 = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e5);
    });
    expect((controller.redo as any).mock.calls.length).toBe(3);
    expect(e5.defaultPrevented).toBe(true);

    doc.destroy();
  });

  // TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled
  it('TC-20: shortcuts ignored and buttons disabled when canEdit is false', () => {
    const doc = new Y.Doc();
    const controller = createFakeController();

    const { unmount } = render(
      <>
        <UndoButtonHarness controller={controller} canEdit={false} />
        <BoardKeysHarness controller={controller} canEdit={false} doc={doc} />
      </>
    );

    // Buttons should be disabled
    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    // Shortcuts should be ignored
    const e1 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e1);
    });
    expect((controller.undo as any).mock.calls.length).toBe(0);
    expect(e1.defaultPrevented).toBe(false);

    const e2 = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(e2);
    });
    expect((controller.redo as any).mock.calls.length).toBe(0);

    unmount();
    doc.destroy();
  });

  // TC-21: Ctrl+Z with focus in a non-board input → controller not called
  it('TC-21: shortcuts ignored when focus is in a non-board input', () => {
    const doc = new Y.Doc();
    const controller = createFakeController();

    const { unmount } = render(
      <>
        <BoardKeysHarness controller={controller} canEdit={true} doc={doc} />
        <input data-testid="share-input" aria-label="Share link" />
      </>
    );

    // Focus the input
    const input = screen.getByTestId('share-input');
    act(() => {
      input.focus();
    });

    // Ctrl+Z while focus is in the input
    const e1 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(e1);
    });

    // Controller should NOT have been called
    expect((controller.undo as any).mock.calls.length).toBe(0);

    unmount();
    doc.destroy();
  });
});
