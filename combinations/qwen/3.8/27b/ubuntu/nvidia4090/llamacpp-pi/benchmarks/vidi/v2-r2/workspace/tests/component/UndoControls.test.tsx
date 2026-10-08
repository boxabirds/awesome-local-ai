/**
 * Story 8 component tests: undo/redo shortcuts and toolbar buttons
 * (TC-18 to TC-21) with a fake UndoController.
 *
 * The button state is tested through useUndo + UndoButtons; the keyboard
 * shortcuts through useBoardKeys wired with a fake selection and the fake
 * controller — no doc writes happen in these tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useUndo } from '../../src/client/board/useUndo';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import type { UndoController } from '../../src/client/board/undo';

type Selection = ReturnType<typeof useSelection>;

/** A fake controller; every method is a spy, stack state is overridable. */
function fakeController(stack?: { canUndo?: boolean; canRedo?: boolean }): UndoController {
  return {
    undo: vi.fn().mockReturnValue(true),
    redo: vi.fn().mockReturnValue(true),
    boundary: vi.fn(),
    canUndo: vi.fn().mockReturnValue(stack?.canUndo ?? true),
    canRedo: vi.fn().mockReturnValue(stack?.canRedo ?? true),
    addScope: vi.fn(),
    onChange: vi.fn(() => () => undefined),
    destroy: vi.fn(),
  };
}

function fakeSelection(editingId: string | null = null): Selection {
  return {
    ids: new Set<string>(['a']),
    editingId,
    click: vi.fn(),
    toggle: vi.fn(),
    setMany: vi.fn(),
    clear: vi.fn(),
    startEdit: vi.fn(),
    endEdit: vi.fn(),
  } as unknown as Selection;
}

function UndoHarness({ controller, canEdit }: { controller: UndoController; canEdit: boolean }) {
  const actions = useUndo(controller, canEdit);
  return <UndoButtons {...actions} />;
}

function KeysHarness({ controller, canEdit, editingId = null }: {
  controller: UndoController;
  canEdit: boolean;
  editingId?: string | null;
}) {
  const doc = new Y.Doc();
  initDoc(doc);
  useBoardKeys({ doc, selection: fakeSelection(editingId), snapshot: [], canEdit, undo: controller });
  return null;
}

/** Dispatches a keydown on `target` (bubbling to window); reports defaultPrevented. */
function pressKey(target: EventTarget & object, init: KeyboardEventInit): boolean {
  const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('undo.controls: shortcuts and buttons (TC-18 to TC-21)', () => {
  it('TC-18: empty stacks → Undo and Redo buttons are disabled (boundary)', () => {
    const controller = fakeController({ canUndo: false, canRedo: false });
    const first = render(<UndoHarness controller={controller} canEdit />);

    const undo = screen.getByLabelText('Undo');
    const redo = screen.getByLabelText('Redo');
    expect((undo as HTMLButtonElement).disabled).toBe(true);
    expect((redo as HTMLButtonElement).disabled).toBe(true);
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    expect(redo.getAttribute('aria-disabled')).toBe('true');

    // Non-empty stacks enable them, and clicking calls the controller.
    first.unmount();
    const controller2 = fakeController({ canUndo: true, canRedo: true });
    const { unmount } = render(<UndoHarness controller={controller2} canEdit />);
    const undo2 = screen.getByLabelText('Undo');
    const redo2 = screen.getByLabelText('Redo');
    expect((undo2 as HTMLButtonElement).disabled).toBe(false);
    expect((redo2 as HTMLButtonElement).disabled).toBe(false);
    undo2.click();
    redo2.click();
    expect(controller2.undo).toHaveBeenCalledTimes(1);
    expect(controller2.redo).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('TC-19: Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo; all preventDefault', () => {
    const controller = fakeController();
    render(<KeysHarness controller={controller} canEdit />);

    expect(pressKey(window, { key: 'z', ctrlKey: true })).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(1);
    expect(controller.redo).not.toHaveBeenCalled();

    expect(pressKey(window, { key: 'z', metaKey: true })).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(2);

    expect(pressKey(window, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(1);

    expect(pressKey(window, { key: 'z', metaKey: true, shiftKey: true })).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(2);

    expect(pressKey(window, { key: 'y', ctrlKey: true })).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(3);

    // Plain z (no modifier) is not an undo shortcut.
    expect(pressKey(window, { key: 'z' })).toBe(false);
    expect(controller.undo).toHaveBeenCalledTimes(2);
  });

  it('TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled (negative)', () => {
    const controller = fakeController({ canUndo: true, canRedo: true });
    render(<KeysHarness controller={controller} canEdit={false} />);

    // Shortcuts are ignored: not called, default untouched.
    expect(pressKey(window, { key: 'z', ctrlKey: true })).toBe(false);
    expect(pressKey(window, { key: 'y', ctrlKey: true })).toBe(false);
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();

    // Buttons are disabled even though the stacks are non-empty.
    const { unmount } = render(<UndoHarness controller={controller} canEdit={false} />);
    expect((screen.getByLabelText('Undo') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Redo') as HTMLButtonElement).disabled).toBe(true);
    unmount();
  });

  it('TC-21: Ctrl+Z with focus in a non-board input → controller not called (negative)', () => {
    const controller = fakeController();
    render(
      <>
        <KeysHarness controller={controller} canEdit />
        <input data-testid="share-link" aria-label="Board link" />
      </>,
    );

    const input = screen.getByTestId('share-link');
    input.focus();
    expect(document.activeElement).toBe(input);

    // The keydown bubbles to the window listener, but focus is in a text
    // input, so the board must not touch the undo stack.
    expect(pressKey(input, { key: 'z', ctrlKey: true })).toBe(false);
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();

    // ...and while a sticky is being edited the board-level handler is
    // ignored too (the editor owns Ctrl+Z there).
    render(<KeysHarness controller={controller} canEdit editingId="a" />);
    expect(pressKey(window, { key: 'z', ctrlKey: true })).toBe(false);
    expect(controller.undo).not.toHaveBeenCalled();
  });
});
