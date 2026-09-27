// Story 8, component tests (TC-18 .. TC-21): the undo/redo buttons and
// window shortcuts with a FAKE UndoController (design: "Mock vs real
// boundaries": jsdom tests for undo.controls with a fake UndoController).
//
// The harness renders the real Toolbar (with UndoButtons) and a probe that
// installs the real useBoardKeys window listener, driven by the fake
// controller, so the shortcuts, edit-lock and focus guards are tested
// end-to-end without a live board doc.

import { act, cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { makeEvent } from './helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { UndoController } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import type { SelectionApi } from '../../src/client/board/useSelection';

// Shared, never-mutated doc for the keys probe (Delete/nudge no-op on an
// empty selection).
const DOC = new Y.Doc();

const FAKE_SELECTION: SelectionApi = {
  ids: new Set<string>(),
  editingId: null,
  click: () => {},
  toggle: () => {},
  setMany: () => {},
  clear: () => {},
  startEdit: () => {},
  endEdit: () => {},
};

type BoolFn = () => boolean;

interface FakeController {
  controller: UndoController;
  undo: ReturnType<typeof vi.fn<BoolFn>>;
  redo: ReturnType<typeof vi.fn<BoolFn>>;
  boundary: ReturnType<typeof vi.fn<() => void>>;
}

function makeFakeController(stacks: { canUndo: boolean; canRedo: boolean }): FakeController {
  const listeners = new Set<() => void>();
  const undo: FakeController['undo'] = vi.fn((): boolean => true);
  const redo: FakeController['redo'] = vi.fn((): boolean => true);
  const boundary: FakeController['boundary'] = vi.fn();
  const controller: UndoController = {
    undo,
    redo,
    boundary,
    canUndo: (): boolean => stacks.canUndo,
    canRedo: (): boolean => stacks.canRedo,
    addScope: vi.fn(),
    onChange: (cb: () => void): (() => void) => {
      listeners.add(cb);
      return (): void => {
        listeners.delete(cb);
      };
    },
    destroy: vi.fn(),
  };
  return { controller, undo, redo, boundary };
}

/** Installs the real window keydown listener with the fake controller. */
function BoardKeysProbe(props: { canEdit: boolean; controller: UndoController }): null {
  useBoardKeys({
    doc: DOC,
    selection: FAKE_SELECTION,
    snapshot: [],
    canEdit: props.canEdit,
    undo: props.controller,
  });
  return null;
}

function Harness(props: { controller: UndoController; canEdit: boolean }): JSX.Element {
  const undo = useUndo(props.controller, props.canEdit);
  return (
    <div>
      <Toolbar
        onCreateSticky={() => {}}
        canEdit={props.canEdit}
        tool="select"
        setTool={() => {}}
        {...undo}
      />
      <BoardKeysProbe canEdit={props.canEdit} controller={props.controller} />
      <input aria-label="Share link" />
    </div>
  );
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
}

/** Dispatch a keydown, spying on preventDefault. */
function pressKey(
  target: EventTarget,
  key: string,
  init: Record<string, unknown>,
): ReturnType<typeof vi.fn> {
  const event = makeEvent('keydown', { key, ...init }) as KeyboardEvent;
  const prevent = vi.fn();
  event.preventDefault = prevent;
  act(() => {
    target.dispatchEvent(event);
  });
  return prevent;
}

describe('story 8 component: undo controls (TC-18..TC-21)', () => {
  afterEach(() => {
    cleanup();
  });

  it('TC-18: the buttons are disabled on empty stacks, enabled on non-empty ones (undo.buttons)', () => {
    // Empty stacks: disabled + aria-disabled.
    let { controller } = makeFakeController({ canUndo: false, canRedo: false });
    render(<Harness controller={controller} canEdit />);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');
    cleanup();

    // Non-empty stacks: enabled, no aria-disabled.
    ({ controller } = makeFakeController({ canUndo: true, canRedo: true }));
    render(<Harness controller={controller} canEdit />);
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(false);
    expect(undoButton().hasAttribute('aria-disabled')).toBe(false);
    expect(redoButton().hasAttribute('aria-disabled')).toBe(false);
  });

  it('TC-19: Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; preventDefault (undo.shortcuts)', () => {
    const { controller, undo, redo } = makeFakeController({ canUndo: true, canRedo: true });
    render(<Harness controller={controller} canEdit />);

    // Undo: Ctrl+Z and Cmd+Z.
    expect(pressKey(window, 'z', { ctrlKey: true })).toHaveBeenCalledTimes(1);
    expect(pressKey(window, 'z', { metaKey: true })).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(2);
    expect(redo).not.toHaveBeenCalled();

    // Redo: Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y.
    expect(pressKey(window, 'Z', { ctrlKey: true, shiftKey: true })).toHaveBeenCalledTimes(1);
    expect(pressKey(window, 'z', { metaKey: true, shiftKey: true })).toHaveBeenCalledTimes(1);
    expect(pressKey(window, 'y', { ctrlKey: true })).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(3);
    expect(undo).toHaveBeenCalledTimes(2);
  });

  it('TC-20: a load-failed board ignores shortcuts and keeps the buttons disabled (undo.not_editable)', () => {
    const { controller, undo, redo } = makeFakeController({ canUndo: true, canRedo: true });
    render(<Harness controller={controller} canEdit={false} />);

    // Even with "steps" in the (fake) history, the edit lock wins: no call,
    // no preventDefault (the board is read-only).
    expect(pressKey(window, 'z', { ctrlKey: true })).not.toHaveBeenCalled();
    expect(pressKey(window, 'y', { ctrlKey: true })).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
  });

  it('TC-21: Ctrl+Z in a non-board input does not reach the controller (undo.shortcuts negative)', () => {
    const { controller, undo, redo } = makeFakeController({ canUndo: true, canRedo: true });
    render(<Harness controller={controller} canEdit />);

    const input = screen.getByRole('textbox', { name: 'Share link' });
    // The input owns its own (native) undo: the board listener must ignore
    // the keydown and leave the default alone.
    expect(pressKey(input, 'z', { ctrlKey: true })).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});
