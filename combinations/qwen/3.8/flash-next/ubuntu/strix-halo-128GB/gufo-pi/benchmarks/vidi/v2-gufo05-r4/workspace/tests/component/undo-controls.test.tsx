/**
 * Story 8 component tests: undo/redo controls (`undo.controls`) — TC-18 to TC-21.
 *
 * These drive the real `useUndo` binding and the real `useBoardKeys` shortcuts through a
 * tiny host, but hand them a *fake* {@link UndoController}. That is deliberate: what is
 * under test is the wiring — which key does what, when a press is the board's to answer,
 * how the buttons' enabled state tracks the two stacks and the edit lock — not the CRDT
 * history itself, which the unit tests already cover against real documents. The fake
 * records the calls so a shortcut can be shown to reach exactly the right method, and to
 * be left alone when the press belongs to something else.
 */

import { cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useUndo } from '../../src/client/board/useUndo';
import type { UndoController } from '../../src/client/board/undo';
import type { SelectionControls } from '../../src/client/board/useSelection';
import { clickElement, fireKey, stubResizeObserver, stubViewportGeometry } from './harness';

beforeEach(() => {
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A controller whose methods are spies, with settable stack state and a broadcast hook. */
function fakeController(overrides: Partial<UndoController> = {}): UndoController & {
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
  boundary: ReturnType<typeof vi.fn>;
} {
  return {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    boundary: vi.fn(),
    canUndo: () => false,
    canRedo: () => false,
    addScope: () => {},
    onChange: () => () => {},
    destroy: () => {},
    ...overrides
  } as UndoController & {
    undo: ReturnType<typeof vi.fn>;
    redo: ReturnType<typeof vi.fn>;
    boundary: ReturnType<typeof vi.fn>;
  };
}

/** A selection that never interferes: nothing selected, nothing being edited. */
const IDLE_SELECTION: SelectionControls = {
  ids: new Set<string>(),
  selectedId: null,
  editingId: null,
  click: () => {},
  toggle: () => {},
  setMany: () => {},
  clear: () => {},
  select: () => {},
  startEdit: () => {},
  endEdit: () => {}
};

interface ControlsFixture {
  container: HTMLElement;
  controller: UndoController & { undo: ReturnType<typeof vi.fn>; redo: ReturnType<typeof vi.fn> };
}

function renderControls(canEdit: boolean): ControlsFixture {
  const controller = fakeController();
  const Host = () => {
    const doc = new Y.Doc();
    useBoardKeys({ doc, selection: IDLE_SELECTION, snapshot: [], canEdit, undo: controller });
    const undo = useUndo(controller, canEdit);
    return <Toolbar onCreateSticky={() => {}} disabled={!canEdit} undo={undo} />;
  };
  const { container } = render(<Host />);
  return { container, controller };
}

function undoButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Undo"]');
  if (!button) throw new Error('no Undo button rendered');
  return button;
}

function redoButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('button[aria-label="Redo"]');
  if (!button) throw new Error('no Redo button rendered');
  return button;
}

describe('undo and redo controls (undo.controls)', () => {
  it('TC-18: with empty stacks both buttons are disabled', () => {
    const { container } = renderControls(true);
    expect(undoButton(container).disabled).toBe(true);
    expect(redoButton(container).disabled).toBe(true);
  });

  it('TC-18b: with a step to undo the Undo button is enabled', () => {
    const controller = fakeController({ canUndo: () => true, canRedo: () => false });
    const { container } = render(<Toolbar onCreateSticky={() => {}} undo={useUndoFor(controller, true)} />);
    expect(undoButton(container).disabled).toBe(false);
    expect(redoButton(container).disabled).toBe(true);
  });

  it('TC-19: each shortcut reaches the matching controller method and is swallowed', () => {
    const { controller } = renderControls(true);

    // Undo: Ctrl+Z and Cmd+Z.
    expect(fireKey('z', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(1);
    expect(fireKey('z', { metaKey: true }).defaultPrevented).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(2);

    // Redo: Ctrl+Shift+Z, Cmd+Shift+Z and the Windows Ctrl+Y.
    expect(fireKey('z', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(1);
    expect(fireKey('z', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(2);
    expect(fireKey('y', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(3);
    expect(controller.undo).toHaveBeenCalledTimes(2); // redo never called undo
  });

  it('TC-20: on a board that cannot be written to the shortcuts are ignored and buttons stay disabled', () => {
    const { container, controller } = renderControls(false);
    expect(undoButton(container).disabled).toBe(true);
    expect(redoButton(container).disabled).toBe(true);

    fireKey('z', { ctrlKey: true });
    fireKey('z', { ctrlKey: true, shiftKey: true });
    fireKey('y', { ctrlKey: true });
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });

  it('TC-21: Ctrl+Z with the caret in another field does not reach the controller', () => {
    const { controller } = renderControls(true);
    const input = document.createElement('input');
    document.body.appendChild(input);
    try {
      const event = fireKey('z', { ctrlKey: true, target: input });
      // The board leaves the press to the field: no preventDefault, no undo.
      expect(event.defaultPrevented).toBe(false);
      expect(controller.undo).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it('clicking the Undo button runs only the controller undo', () => {
    const controller = fakeController({ canUndo: () => true });
    const { container } = render(<Toolbar onCreateSticky={() => {}} undo={useUndoFor(controller, true)} />);
    clickElement(undoButton(container));
    expect(controller.undo).toHaveBeenCalledTimes(1);
    expect(controller.redo).not.toHaveBeenCalled();
  });
});

/**
 * `useUndo` outside a component is not possible, so the button-only cases build the
 * actions by hand from a controller — the same shape `useUndo` returns — keeping the test
 * honest about the enabled/disabled contract the Toolbar renders.
 */
function useUndoFor(controller: UndoController, canEdit: boolean) {
  return {
    canUndo: canEdit && controller.canUndo(),
    canRedo: canEdit && controller.canRedo(),
    undo: () => controller.undo(),
    redo: () => controller.redo()
  };
}
