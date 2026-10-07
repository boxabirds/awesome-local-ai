// Story 8 component tests (TC-18 to TC-21): undo.controls with a fake
// UndoController (see harness-undo.tsx). The real useUndo hook, UndoButtons,
// Toolbar and useBoardKeys are under test; the fake records every call.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { act } from 'react';
import { UndoHarness, createFakeUndo } from './harness-undo';

const undoButton = () => screen.getByRole('button', { name: 'Undo' });
const redoButton = () => screen.getByRole('button', { name: 'Redo' });

/** fireEvent returns the negation of defaultPrevented. */
function keydown(el: Element | Window, init: KeyboardEventInit): boolean {
  return fireEvent.keyDown(el, init);
}

afterEach(() => {
  cleanup();
});

describe('undo.controls (component, fake controller)', () => {
  it('TC-18: empty stacks disable both buttons; a non-empty stack enables the matching one (boundary)', () => {
    const fake = createFakeUndo();
    render(<UndoHarness fake={fake} canEdit />);

    const setSteps = (u: number, r: number): void => act(() => fake.setSteps(u, r));

    // Both stacks empty: both disabled.
    setSteps(0, 0);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();

    // Undo history only: Undo enabled, Redo disabled.
    setSteps(2, 0);
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();

    // Redo stack only: the reverse.
    setSteps(0, 1);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeEnabled();

    // Both non-empty: both enabled. Clicking a button calls the controller
    // exactly once per press.
    setSteps(1, 1);
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeEnabled();
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(fake.calls.undo).toBe(1);
    expect(fake.calls.redo).toBe(1);
  });

  it('TC-19: Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo; each preventDefault', () => {
    const fake = createFakeUndo();
    render(<UndoHarness fake={fake} canEdit />);
    act(() => fake.setSteps(3, 3));

    expect(keydown(window, { key: 'z', ctrlKey: true })).toBe(false); // prevented
    expect(keydown(window, { key: 'z', metaKey: true })).toBe(false); // Cmd+Z
    expect(keydown(window, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(keydown(window, { key: 'z', metaKey: true, shiftKey: true })).toBe(false);
    expect(keydown(window, { key: 'y', ctrlKey: true })).toBe(false);

    expect(fake.calls.undo).toBe(2);
    expect(fake.calls.redo).toBe(3);
    // Undo: 3 − 2 (undone) + 3 (re-undone by the redos) = 4.
    // Redo: 3 − 3 (redone) + 2 (from the undos) = 2.
    expect(fake.depths.undo).toBe(4);
    expect(fake.depths.redo).toBe(2);

    // A plain Z (no modifier) is not an undo shortcut.
    expect(keydown(window, { key: 'z' })).toBe(true); // not prevented
    expect(fake.calls.undo).toBe(2);
  });

  it('TC-20: canEdit false (load failed) → shortcuts ignored and buttons disabled (negative)', () => {
    const fake = createFakeUndo();
    render(<UndoHarness fake={fake} canEdit={false} />);
    act(() => fake.setSteps(3, 3));

    // Buttons stay disabled even with non-empty stacks.
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();

    // Shortcuts are ignored entirely: no controller call, no preventDefault.
    expect(keydown(window, { key: 'z', ctrlKey: true })).toBe(true);
    expect(keydown(window, { key: 'z', metaKey: true, shiftKey: true })).toBe(true);
    expect(keydown(window, { key: 'y', ctrlKey: true })).toBe(true);
    expect(fake.calls.undo).toBe(0);
    expect(fake.calls.redo).toBe(0);

    // Clicking a disabled button does nothing either.
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(fake.calls.undo).toBe(0);
    expect(fake.calls.redo).toBe(0);
  });

  it('TC-21: Ctrl+Z with focus in the share-link input does not reach the controller (negative)', () => {
    const fake = createFakeUndo();
    render(<UndoHarness fake={fake} canEdit />);
    act(() => fake.setSteps(2, 0));

    // Open the share panel and focus its link input (as the app does).
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const input = document.querySelector('.share-link-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.focus();

    // Ctrl+Z while the input is focused: the board handler must not run.
    expect(keydown(input, { key: 'z', ctrlKey: true })).toBe(true); // not prevented
    expect(fake.calls.undo).toBe(0);

    // … but the same key with focus back on the window does undo.
    (document.activeElement as HTMLElement).blur();
    expect(keydown(window, { key: 'z', ctrlKey: true })).toBe(false);
    expect(fake.calls.undo).toBe(1);
  });
});
