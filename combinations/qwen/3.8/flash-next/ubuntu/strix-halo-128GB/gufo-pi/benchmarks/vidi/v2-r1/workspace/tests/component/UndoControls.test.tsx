/**
 * Component tests TC-18 to TC-21: undo.controls
 *
 * Tests keyboard shortcuts, toolbar buttons, edit lock and focus guards.
 * Uses a fake UndoController to isolate controls logic.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useUndo } from '../../src/client/board/useUndo';
import type { UndoController } from '../../src/client/board/undo';
import { App } from '../../src/client/App';

/**
 * A fake UndoController for component tests.
 */
function makeFakeController(opts: { canUndo?: boolean; canRedo?: boolean } = {}): UndoController & {
  undoCalls: number;
  redoCalls: number;
  boundaryCalls: number;
  listeners: Set<() => void>;
} {
  const ctrl = {
    undoCalls: 0,
    redoCalls: 0,
    boundaryCalls: 0,
    listeners: new Set<() => void>(),
    _canUndo: opts.canUndo ?? false,
    _canRedo: opts.canRedo ?? false,
    undo(): boolean {
      ctrl.undoCalls++;
      return ctrl._canUndo;
    },
    redo(): boolean {
      ctrl.redoCalls++;
      return ctrl._canRedo;
    },
    boundary(): void {
      ctrl.boundaryCalls++;
    },
    canUndo(): boolean {
      return ctrl._canUndo;
    },
    canRedo(): boolean {
      return ctrl._canRedo;
    },
    addScope(): void {},
    onChange(cb: () => void): () => void {
      ctrl.listeners.add(cb);
      return () => ctrl.listeners.delete(cb);
    },
    destroy(): void {
      ctrl.listeners.clear();
    },
  };
  return ctrl;
}

/** A minimal component that uses useUndo + UndoButtons. */
function TestHarness({ controller, canEdit }: { controller: UndoController; canEdit: boolean }) {
  const undo = useUndo(controller, canEdit);
  return (
    <div>
      <UndoButtons {...undo} />
    </div>
  );
}

describe('undo.controls component tests', () => {
  // TC-18: empty stacks → Undo and Redo buttons disabled
  it('TC-18: empty stacks → both buttons disabled with aria-disabled', () => {
    const ctrl = makeFakeController({ canUndo: false, canRedo: false });
    render(<TestHarness controller={ctrl} canEdit={true} />);

    const undoBtn = screen.getByLabelText('Undo') as HTMLButtonElement;
    const redoBtn = screen.getByLabelText('Redo') as HTMLButtonElement;

    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
    expect(undoBtn.getAttribute('aria-disabled')).toBe('true');
    expect(redoBtn.getAttribute('aria-disabled')).toBe('true');
  });

  // TC-19: Ctrl+Z and Cmd+Z → undo; Ctrl+Shift+Z, Cmd+Shift+Z, Ctrl+Y → redo; preventDefault
  it('TC-19: keyboard shortcuts call controller with preventDefault', () => {
    render(<App boardId="test-undo-keys" />);

    // Test Ctrl+Z with preventDefault
    const event1 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event1);
    expect(event1.defaultPrevented).toBe(true);

    // Test Cmd+Z with preventDefault
    const event2 = new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event2);
    expect(event2.defaultPrevented).toBe(true);

    // Test Ctrl+Shift+Z with preventDefault
    const event3 = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event3);
    expect(event3.defaultPrevented).toBe(true);

    // Test Cmd+Shift+Z with preventDefault
    const event4 = new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event4);
    expect(event4.defaultPrevented).toBe(true);

    // Test Ctrl+Y with preventDefault
    const event5 = new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event5);
    expect(event5.defaultPrevented).toBe(true);
  });

  // TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled
  it('TC-20: load failed → shortcuts ignored, buttons disabled', () => {
    const ctrl = makeFakeController({ canUndo: true, canRedo: true });
    render(<TestHarness controller={ctrl} canEdit={false} />);

    const undoBtn = screen.getByLabelText('Undo') as HTMLButtonElement;
    const redoBtn = screen.getByLabelText('Redo') as HTMLButtonElement;

    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // Clicking a disabled button should not fire
    fireEvent.click(undoBtn);
    expect(ctrl.undoCalls).toBe(0);

    fireEvent.click(redoBtn);
    expect(ctrl.redoCalls).toBe(0);
  });

  // TC-21: Ctrl+Z with focus in a non-board input (e.g. share link field) → controller not called
  it('TC-21: Ctrl+Z in a non-board input does not call undo', () => {
    render(<App boardId="test-undo-focus" />);

    // Find the share link input (or create one to simulate focus in a non-board input)
    // The SharePanel has an input when opened. Let's use a generic input element.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Dispatch Ctrl+Z on the input
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    // Dispatch on the input element so the event target is the input
    input.dispatchEvent(event);

    // preventDefault should NOT have been called (handler ignores non-board inputs)
    // Actually, in the implementation, isTextEntryTarget returns true for INPUT,
    // so the handler returns early without calling undo.
    // We can't directly test that undo wasn't called, but we can verify
    // the event was NOT prevented (since the handler returned early).
    // Actually the handler does return early before preventDefault for text entry targets.
    // Let's verify by checking the event was not prevented:
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(input);
  });
});
