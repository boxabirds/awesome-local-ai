import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { UndoController } from '../../src/client/board/undo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { useUndo } from '../../src/client/board/useUndo';
import { renderApp } from './helpers';

/** A fake controller whose stack state the test sets. */
function fakeController(state = { undo: 0, redo: 0 }) {
  const listeners = new Set<() => void>();
  const controller = {
    undo: vi.fn(() => state.undo > 0),
    redo: vi.fn(() => state.redo > 0),
    boundary: vi.fn(),
    canUndo: () => state.undo > 0,
    canRedo: () => state.redo > 0,
    addScope: vi.fn(),
    nextStepOnlyIn: () => false,
    mergeNext: vi.fn(),
    topStep: () => null,
    discardFrom: () => false,
    onChange: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: vi.fn(),
  } satisfies UndoController;
  const set = (next: { undo: number; redo: number }) => {
    act(() => {
      Object.assign(state, next);
      for (const l of listeners) l();
    });
  };
  return { controller, set };
}

const NO_OBJECTS: readonly ObjectSnapshot[] = [];

function Harness({ controller, canEdit }: { controller: UndoController; canEdit: boolean }) {
  const [doc] = useState(() => new Y.Doc());
  const selection = useSelection(NO_OBJECTS);
  useBoardKeys({ doc, selection, snapshot: NO_OBJECTS, canEdit, undo: controller });
  const history = useUndo(controller, canEdit);
  return (
    <>
      <UndoButtons {...history} />
      <input aria-label="Board link" readOnly value="https://vidi6.test/b/x" />
    </>
  );
}

function press(init: KeyboardEventInit, target: EventTarget = document.body) {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

const undoBtn = () => screen.getByRole('button', { name: 'Undo' });
const redoBtn = () => screen.getByRole('button', { name: 'Redo' });

describe('undo.controls', () => {
  it('TC-18 with empty history both buttons are disabled (and say so)', () => {
    const { controller, set } = fakeController();
    render(<Harness controller={controller} canEdit />);
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
    expect(undoBtn()).toHaveAttribute('aria-disabled', 'true');
    expect(redoBtn()).toHaveAttribute('aria-disabled', 'true');
    expect(undoBtn()).toHaveAttribute('title', 'Undo (Ctrl/Cmd+Z)');
    expect(redoBtn()).toHaveAttribute('title', 'Redo (Ctrl/Cmd+Shift+Z)');

    set({ undo: 2, redo: 0 });
    expect(undoBtn()).toBeEnabled();
    expect(redoBtn()).toBeDisabled();
    fireEvent.click(undoBtn());
    expect(controller.undo).toHaveBeenCalledTimes(1);

    set({ undo: 0, redo: 1 });
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeEnabled();
    fireEvent.click(redoBtn());
    expect(controller.redo).toHaveBeenCalledTimes(1);
  });

  it('TC-18 the board shows Undo and Redo in the tools toolbar, disabled on a fresh board', () => {
    renderApp();
    const tools = screen.getByRole('toolbar', { name: 'Tools' });
    expect(tools).toContainElement(undoBtn());
    expect(tools).toContainElement(redoBtn());
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
  });

  it('TC-19 Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; each prevents the default', () => {
    const { controller } = fakeController({ undo: 5, redo: 5 });
    render(<Harness controller={controller} canEdit />);
    const undos: KeyboardEventInit[] = [
      { key: 'z', ctrlKey: true },
      { key: 'z', metaKey: true },
    ];
    const redos: KeyboardEventInit[] = [
      { key: 'Z', ctrlKey: true, shiftKey: true },
      { key: 'Z', metaKey: true, shiftKey: true },
      { key: 'y', ctrlKey: true },
    ];
    for (const init of undos) expect(press(init).defaultPrevented).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(2);
    expect(controller.redo).not.toHaveBeenCalled();
    for (const init of redos) expect(press(init).defaultPrevented).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(3);
    expect(controller.undo).toHaveBeenCalledTimes(2);
  });

  it('TC-19 plain Z and Y do nothing', () => {
    const { controller } = fakeController({ undo: 5, redo: 5 });
    render(<Harness controller={controller} canEdit />);
    press({ key: 'z' });
    press({ key: 'y' });
    press({ key: 'y', metaKey: true });
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });

  it('TC-20 when the board failed to load, shortcuts are ignored and buttons disabled', () => {
    const { controller } = fakeController({ undo: 3, redo: 3 });
    render(<Harness controller={controller} canEdit={false} />);
    expect(undoBtn()).toBeDisabled();
    expect(redoBtn()).toBeDisabled();
    press({ key: 'z', ctrlKey: true });
    press({ key: 'z', metaKey: true, shiftKey: true });
    press({ key: 'y', ctrlKey: true });
    fireEvent.click(undoBtn());
    fireEvent.click(redoBtn());
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });

  it('TC-21 Ctrl+Z in the share link field is left to the browser', () => {
    const { controller } = fakeController({ undo: 3, redo: 3 });
    render(<Harness controller={controller} canEdit />);
    const field = screen.getByRole('textbox', { name: 'Board link' });
    field.focus();
    const ev = press({ key: 'z', ctrlKey: true }, field);
    const redo = press({ key: 'y', ctrlKey: true }, field);
    expect(ev.defaultPrevented).toBe(false);
    expect(redo.defaultPrevented).toBe(false);
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });
});
