// Story 8 (undo.controls) component tests: TC-18 to TC-21.
// UndoButtons + useUndo against real controllers, and useBoardKeys
// shortcuts against a fake controller (so each binding is asserted in
// isolation). jsdom only — the multi-user behaviour is covered by the e2e
// tests.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, objectsSnapshot } from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { SelectionApi } from '../../src/client/board/useSelection';

/** A fake SelectionApi: everything unselected, nothing editing. */
function fakeSelection(): SelectionApi {
  return {
    ids: new Set<string>(),
    editingId: null,
    click() {},
    toggle() {},
    setMany() {},
    clear() {},
    startEdit() {},
    endEdit() {},
    selectCreated() {},
  };
}

/** A fake UndoController recording undo/redo calls. */
function fakeController(): UndoController {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    boundary: vi.fn(),
    canUndo: () => true,
    canRedo: () => true,
    addScope() {},
    onChange: () => () => {},
    destroy() {},
  } as unknown as UndoController;
}

function key(type: string, props: Record<string, unknown> = {}): Event {
  const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props });
  return e;
}

/** Dispatches a keydown on `window`; returns defaultPrevented. */
function windowKey(e: Event): boolean {
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** A note-bearing controller (one local step on the stack). */
function controllerWithStep(): { doc: Y.Doc; ctl: UndoController } {
  const doc = new Y.Doc();
  const ctl = createUndo(doc);
  createSticky(doc, { x: 0, y: 0 });
  ctl.boundary();
  return { doc, ctl };
}

function ButtonsHarness({ controller, canEdit = true }: { controller: UndoController; canEdit?: boolean }) {
  const api = useUndo(controller, canEdit);
  return <UndoButtons {...api} />;
}

function KeysHarness({ controller, canEdit = true }: { controller: UndoController; canEdit?: boolean }) {
  const doc = new Y.Doc();
  useBoardKeys({
    doc,
    selection: fakeSelection(),
    snapshot: objectsSnapshot(doc),
    canEdit,
    undo: controller,
    onCreateStickyCenter: () => {},
  });
  return null;
}

describe('undo.controls (TC-18 to TC-21)', () => {
  it('TC-18: empty stacks → both buttons disabled; with a step the buttons work', () => {
    // Empty stack: disabled.
    const empty = new Y.Doc();
    const emptyCtl = createUndo(empty);
    render(<ButtonsHarness controller={emptyCtl} />);
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();
    emptyCtl.destroy();
    empty.destroy();
    cleanup();

    // One step: undo enabled, redo disabled; clicking undoes the step.
    const { doc, ctl } = controllerWithStep();
    render(<ButtonsHarness controller={ctl} />);
    const undo2 = screen.getByRole('button', { name: 'Undo' });
    const redo2 = screen.getByRole('button', { name: 'Redo' });
    expect(undo2).toBeEnabled();
    expect(redo2).toBeDisabled();

    // The seeded note is a local step: undoing removes it.
    const id = objectsSnapshot(doc)[0].id;
    fireEvent.click(undo2);
    expect(objectsSnapshot(doc).some((o) => o.id === id)).toBe(false);
    ctl.destroy();
    doc.destroy();
  });

  it('TC-19: Ctrl+Z, Cmd+Z, Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y call the controller with preventDefault', () => {
    const ctl = fakeController();
    render(<KeysHarness controller={ctl} />);
    const { undo, redo } = ctl as unknown as { undo: ReturnType<typeof vi.fn>; redo: ReturnType<typeof vi.fn> };

    // Ctrl+Z → undo.
    expect(windowKey(key('keydown', { key: 'z', ctrlKey: true }))).toBe(true);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();

    // Cmd+Z (metaKey) → undo.
    expect(windowKey(key('keydown', { key: 'z', metaKey: true }))).toBe(true);
    expect(undo).toHaveBeenCalledTimes(2);

    // Ctrl+Shift+Z → redo.
    expect(windowKey(key('keydown', { key: 'z', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(redo).toHaveBeenCalledTimes(1);

    // Cmd+Shift+Z → redo.
    expect(windowKey(key('keydown', { key: 'z', metaKey: true, shiftKey: true }))).toBe(true);
    expect(redo).toHaveBeenCalledTimes(2);

    // Ctrl+Y → redo.
    expect(windowKey(key('keydown', { key: 'y', ctrlKey: true }))).toBe(true);
    expect(redo).toHaveBeenCalledTimes(3);
    expect(undo).toHaveBeenCalledTimes(2);
  });

  it('TC-20: load-failed (non-editable) board: shortcuts ignored, buttons disabled', () => {
    // Shortcuts are ignored (and not preventDefaulted) while locked.
    const ctl = fakeController();
    render(<KeysHarness controller={ctl} canEdit={false} />);
    const { undo, redo } = ctl as unknown as { undo: ReturnType<typeof vi.fn>; redo: ReturnType<typeof vi.fn> };
    expect(windowKey(key('keydown', { key: 'z', ctrlKey: true }))).toBe(false);
    expect(windowKey(key('keydown', { key: 'y', ctrlKey: true }))).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();

    // Buttons are disabled even with steps on the stack.
    const { doc, ctl: real } = controllerWithStep();
    render(<ButtonsHarness controller={real} canEdit={false} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    real.destroy();
    doc.destroy();
  });

  it('TC-21: Ctrl+Z with focus in a non-board input does not call the controller', () => {
    const ctl = fakeController();
    render(
      <div>
        <input data-testid="share-input" aria-label="Share link" />
        <KeysHarness controller={ctl} />
      </div>,
    );
    const { undo } = ctl as unknown as { undo: ReturnType<typeof vi.fn> };
    const input = screen.getByTestId('share-input') as HTMLInputElement;

    // Focus the input and press Ctrl+Z there: the board must not hijack it.
    input.focus();
    const e = key('keydown', { key: 'z', ctrlKey: true });
    input.dispatchEvent(e);
    expect(undo).not.toHaveBeenCalled();
    // No preventDefault: the browser/input default (native undo) stays active.
    expect(e.defaultPrevented).toBe(false);
  });
});
