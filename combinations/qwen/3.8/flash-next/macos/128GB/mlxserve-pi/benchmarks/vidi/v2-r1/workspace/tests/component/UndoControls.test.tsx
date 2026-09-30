// Undo/redo shortcuts, toolbar buttons and the edit lock (`undo.shortcuts`,
// `undo.button`, TC-18 to TC-21).
//
// TC-18 and TC-20 render the real widgets and read `disabled`/`aria-disabled`;
// TC-19 and TC-20 drive the keyboard against `useBoardKeys` with a fake
// `UndoController` so the five shortcut spellings and the canEdit lock are checked
// without a document to distract from the call that should, or should not, happen.
// TC-21 puts the caret in the share-link field (a plain non-board input) to prove the
// shortcut is left to it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import type { UndoController } from '../../src/client/board/undo';
import type { UseUndoResult } from '../../src/client/board/useUndo';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

import { ResizeObserverStub } from './setup';
import {
  doc,
  makeNote,
  noteElements,
  open,
} from './helpers/board-ui';

/** A controller whose methods are all spies; undo/redo report they did something. */
function fakeController(): UndoController & {
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
  boundary: ReturnType<typeof vi.fn>;
} {
  return {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    boundary: vi.fn(),
    canUndo: () => true,
    canRedo: () => true,
    addScope: () => {},
    onChange: () => () => {},
    destroy: () => {},
  };
}

const undoResult = (over: Partial<UseUndoResult> = {}): UseUndoResult => ({
  canUndo: true,
  canRedo: true,
  undo: vi.fn(),
  redo: vi.fn(),
  ...over,
});

/** Run the real shortcuts against a fake controller. */
function keys(canEdit: boolean, controller: UndoController): void {
  const doc0 = new Y.Doc();
  renderHook(() => {
    const selection = useSelection([]);
    return useBoardKeys({
      doc: doc0,
      selection,
      snapshot: [],
      canEdit,
      undo: controller,
    });
  });
}

const key = (init: Record<string, unknown>): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  } as KeyboardEventInit);
  document.body.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  vi.useFakeTimers();
  ResizeObserverStub.size = { width: 1280, height: 800 };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('undo/redo toolbar buttons (undo.button)', () => {
  // TC-18: empty stacks — both buttons disabled and say so.
  it('TC-18 renders both buttons disabled when there is nothing to undo or redo', () => {
    render(<UndoButtons canUndo={false} canRedo={false} onUndo={vi.fn()} onRedo={vi.fn()} />);
    const undoButton = screen.getByTestId('undo-button');
    const redoButton = screen.getByTestId('redo-button');
    expect((undoButton as HTMLButtonElement).disabled).toBe(true);
    expect((redoButton as HTMLButtonElement).disabled).toBe(true);
    expect(undoButton.getAttribute('aria-disabled')).toBe('true');
    expect(redoButton.getAttribute('aria-disabled')).toBe('true');
  });

  // TC-20 (buttons half): the edit lock greys the buttons even with non-empty stacks.
  it('TC-20 keeps the buttons disabled while the board cannot be edited', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        disabled
        undo={undoResult({ canUndo: true, canRedo: true })}
      />,
    );
    const undoButton = screen.getByTestId('undo-button');
    const redoButton = screen.getByTestId('redo-button');
    expect((undoButton as HTMLButtonElement).disabled).toBe(true);
    expect((redoButton as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('undo/redo shortcuts (undo.shortcuts)', () => {
  // TC-19: each spelling of Ctrl/Cmd+Z and its redo partner reaches the controller.
  it('TC-19 routes every shortcut spelling to undo or redo, and prevents the default', () => {
    const controller = fakeController();
    keys(true, controller);

    controller.undo.mockClear();
    controller.redo.mockClear();

    expect(key({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key({ key: 'z', metaKey: true }).defaultPrevented).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(2);

    expect(key({ key: 'z', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(key({ key: 'z', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(key({ key: 'y', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(3);
    // And none of the redo keys were mistaken for undo.
    expect(controller.undo).toHaveBeenCalledTimes(2);
  });

  // TC-20 (keyboard half): with the board read-only the shortcuts are left alone.
  it('TC-20 ignores the shortcuts when the board cannot be edited', () => {
    const controller = fakeController();
    keys(false, controller);

    controller.undo.mockClear();
    controller.redo.mockClear();
    expect(key({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key({ key: 'z', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });

  // TC-21: the caret in a plain input (the share-link field) keeps the shortcut there.
  it('TC-21 does not undo while focus is in the share-link field', () => {
    open();
    const a = makeNote(0, 0);
    // Open the share panel and put the caret in its link field.
    fireEvent.click(screen.getByTestId('share-button'));
    const field = screen.getByTestId('share-link-field') as HTMLInputElement;
    act(() => {
      field.focus();
    });
    // Ctrl+Z inside the field: the controller must not undo the earlier note.
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    expect(noteElements()).toHaveLength(1);
    expect(screen.queryByTestId('sticky-note')).toBeTruthy();
    // The note is still in the document.
    expect(doc()).toBeTruthy();
    void a;
  });
});
