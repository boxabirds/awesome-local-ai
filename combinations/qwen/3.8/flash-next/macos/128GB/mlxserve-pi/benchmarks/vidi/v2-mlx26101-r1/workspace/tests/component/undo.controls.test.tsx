// undo.controls — the undo / redo buttons and keyboard shortcuts (ui-component).
//
// A fake `UndoController` is wired into the real `Toolbar` (which renders the real
// `UndoButtons`) and the real `useBoardKeys`, so these exercise the actual wiring:
// buttons disable from the controller's canUndo/canRedo and from a locked board,
// every undo/redo chord reaches the controller (and suppresses the browser's own
// undo), and a field that owns the keyboard — the share-link input — is never
// turned into a board command. undo.buttons, undo.shortcuts, undo.readonly.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import type { UndoController } from '../../src/client/board/undo';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { UndoControllerContext } from '../../src/client/board/useUndo';
import type { ObjectSnapshot } from '../../src/shared/board-model';

/** A controller made of spies; defaults to "nothing to undo or redo". */
function fakeUndo(overrides: Partial<UndoController> = {}): UndoController {
  return {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    boundary: vi.fn(),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    addScope: vi.fn(),
    onChange: vi.fn(() => () => {}),
    destroy: vi.fn(),
    ...overrides,
  };
}

const EMPTY_DOC = {} as Y.Doc;

/**
 * Mount the undo surface exactly as the board does: `useBoardKeys` gets the
 * controller for the shortcuts, the `Toolbar` (and its `UndoButtons`) read the same
 * controller from context, and a share-like input stands in for a non-board field.
 */
function Harness({
  controller,
  canEdit = true,
}: {
  controller: UndoController;
  canEdit?: boolean;
}) {
  const selection = useSelection([] as readonly ObjectSnapshot[]);
  useBoardKeys({
    doc: EMPTY_DOC,
    selection,
    snapshot: [] as readonly ObjectSnapshot[],
    canEdit,
    undo: controller,
  });
  return (
    <UndoControllerContext.Provider value={controller}>
      <Toolbar onCreateSticky={() => {}} disabled={!canEdit} />
      <input data-testid="share-input" defaultValue="https://board/link" />
    </UndoControllerContext.Provider>
  );
}

const undoButton = () => screen.getByTestId('undo-button');
const redoButton = () => screen.getByTestId('redo-button');
/** A button's DOM disabled state (this project asserts the property, not jest-dom). */
const disabled = (el: HTMLElement): boolean => (el as HTMLButtonElement).disabled;

/** Dispatch a cancellable keydown on a target and return the event. */
function key(
  target: EventTarget,
  k: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    shiftKey: mods.shiftKey ?? false,
  });
  act(() => {
    (target as Element | Window).dispatchEvent(ev);
  });
  return ev;
}
const windowKey = (k: string, mods?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) =>
  key(window, k, mods);

describe('undo.controls (ui-component)', () => {
  // TC-18: with empty stacks both buttons are disabled (and aria-disabled).
  it('TC-18 renders both buttons disabled when there is nothing to undo or redo', () => {
    render(<Harness controller={fakeUndo()} />);
    expect(disabled(undoButton())).toBe(true);
    expect(disabled(redoButton())).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');
  });

  // TC-18 (positive side): a non-empty stack enables the matching button.
  it('TC-18 enables undo / redo buttons when the stack has steps', () => {
    render(<Harness controller={fakeUndo({ canUndo: () => true, canRedo: () => true })} />);
    expect(disabled(undoButton())).toBe(false);
    expect(disabled(redoButton())).toBe(false);
    expect(undoButton().getAttribute('aria-disabled')).toBe('false');
  });

  // TC-18: clicking the buttons drives the controller.
  it('TC-18 clicking the buttons calls undo / redo', () => {
    const c = fakeUndo({ canUndo: () => true, canRedo: () => true });
    render(<Harness controller={c} />);
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(c.undo).toHaveBeenCalledTimes(1);
    expect(c.redo).toHaveBeenCalledTimes(1);
  });

  // TC-19: each chord reaches the controller and prevents the browser default.
  it('TC-19 routes every undo / redo chord to the controller with preventDefault', () => {
    const c = fakeUndo({ canUndo: () => true, canRedo: () => true });
    render(<Harness controller={c} />);

    expect(windowKey('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(windowKey('z', { metaKey: true }).defaultPrevented).toBe(true);
    expect(c.undo).toHaveBeenCalledTimes(2); // Ctrl+Z and Cmd+Z

    expect(windowKey('z', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(windowKey('z', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(windowKey('y', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.redo).toHaveBeenCalledTimes(3); // the two Shift+Z chords and Ctrl+Y

    expect(c.undo).toHaveBeenCalledTimes(2); // undo count unchanged by the redo chords
  });

  // TC-19 error path: nothing to undo → the chord is a harmless no-op.
  it('TC-19 an empty-stack undo does not throw', () => {
    const c = fakeUndo({ undo: vi.fn(() => false), canUndo: () => false });
    render(<Harness controller={c} />);
    expect(() => windowKey('z', { ctrlKey: true })).not.toThrow();
    // The chord is still taken over (no browser undo), but there was nothing to do.
    expect(c.undo).toHaveBeenCalledTimes(1);
    expect(disabled(undoButton())).toBe(true);
  });

  // TC-20: a locked board ignores Ctrl+Z and disables the buttons.
  it('TC-20 ignores Ctrl+Z and disables the buttons when editing is locked', () => {
    const c = fakeUndo({ canUndo: () => true }); // history exists, board is locked
    render(<Harness controller={c} canEdit={false} />);

    const ev = windowKey('z', { ctrlKey: true });
    expect(c.undo).not.toHaveBeenCalled(); // not even taken over: read-only board
    expect(ev.defaultPrevented).toBe(false);
    expect(disabled(undoButton())).toBe(true);
    expect(disabled(redoButton())).toBe(true);
  });

  // TC-21: focus in the share-link field owns the keyboard — Ctrl+Z is not forwarded.
  it('TC-21 does not undo while a non-board input has focus', () => {
    const c = fakeUndo({ canUndo: () => true, canRedo: () => true });
    render(<Harness controller={c} />);

    const input = screen.getByTestId('share-input');
    input.focus();
    // A keydown whose target is the input (bubbles to the window listener).
    const ev = key(input, 'z', { ctrlKey: true });
    expect(c.undo).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);

    // Sanity: with focus back on the board the same chord does reach the controller.
    input.blur();
    expect(windowKey('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.undo).toHaveBeenCalledTimes(1);
  });
});
