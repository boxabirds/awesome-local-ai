/**
 * Story 8 — undo/redo controls (jsdom, PRD undo.controls, undo.shortcuts,
 * undo.empty, undo.read_only).
 *
 * Uses a FAKE `UndoController` so the tests pin the control contract without
 * a Y.Doc: the window shortcuts (useBoardKeys) call the controller, the
 * buttons (Toolbar ← useUndo) reflect canUndo/canRedo, typing targets are
 * never intercepted, and a read-only board exposes neither.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useUndo } from '../../src/client/board/useUndo';
import { Toolbar } from '../../src/client/board/Toolbar';
import type { UndoController } from '../../src/client/board/undo';
import type { SelectionApi } from '../../src/client/board/useSelection';

installComponentMocks();

interface FakeState {
  canUndo: boolean;
  canRedo: boolean;
}

/** A controllable fake of the UndoController contract. */
function makeFake(initial: FakeState = { canUndo: true, canRedo: true }): UndoController & {
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
  boundary: ReturnType<typeof vi.fn>;
  state: FakeState;
  listeners: Set<() => void>;
} {
  const state: FakeState = { ...initial };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const fake = {
    state,
    listeners,
    undo: vi.fn(() => {
      state.canUndo = false;
      state.canRedo = true;
      notify();
      return true;
    }),
    redo: vi.fn(() => {
      state.canRedo = false;
      state.canUndo = true;
      notify();
      return true;
    }),
    boundary: vi.fn(),
    canUndo: vi.fn(() => state.canUndo),
    canRedo: vi.fn(() => state.canRedo),
    addScope: vi.fn(),
    onChange: vi.fn((cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    destroy: vi.fn(),
  };
  return fake as UndoController & typeof fake;
}

const emptySelection: SelectionApi = {
  ids: new Set<string>(),
  editingId: null,
  click: () => undefined,
  toggle: () => undefined,
  setMany: () => undefined,
  clear: () => undefined,
  startEdit: () => undefined,
  endEdit: () => undefined,
};

// One shared, inert doc for the keyboard wiring (no object is ever touched).
const DOC = new Y.Doc();

function Harness({
  controller,
  canEdit,
  children,
}: {
  controller: UndoController;
  canEdit: boolean;
  children?: React.ReactNode;
}) {
  const controls = useUndo(controller, canEdit);
  useBoardKeys({
    doc: DOC,
    selection: emptySelection,
    snapshot: [],
    canEdit,
    undo: controller,
  });
  return (
    <div>
      <Toolbar onCreateSticky={() => undefined} disabled={!canEdit} undo={controls} />
      {children}
    </div>
  );
}

function keyDown(target: EventTarget, init: KeyboardEventInit): boolean {
  let prevented = false;
  act(() => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    prevented = target.dispatchEvent(e);
  });
  return !prevented; // dispatchEvent returns false when preventDefault was called
}

describe('story 8: undo/redo controls (component)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('TC-18: empty histories disable both buttons (aria-disabled)', () => {
    const controller = makeFake({ canUndo: false, canRedo: false });
    render(<Harness controller={controller} canEdit />);

    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    expect(redo.getAttribute('aria-disabled')).toBe('true');

    // Clicking a disabled button is a no-op.
    undo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    redo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });

  it('TC-19: the shortcut matrix — Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo, all preventDefault', () => {
    const controller = makeFake();
    render(<Harness controller={controller} canEdit />);

    expect(keyDown(window, { key: 'z', ctrlKey: true })).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(1);
    expect(controller.redo).not.toHaveBeenCalled();

    expect(keyDown(window, { key: 'z', metaKey: true })).toBe(true);
    expect(controller.undo).toHaveBeenCalledTimes(2);

    expect(keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(1);

    expect(keyDown(window, { key: 'Z', metaKey: true, shiftKey: true })).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(2);

    expect(keyDown(window, { key: 'y', ctrlKey: true })).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(3);

    expect(keyDown(window, { key: 'Y', metaKey: true })).toBe(true);
    expect(controller.redo).toHaveBeenCalledTimes(4);
    expect(controller.undo).toHaveBeenCalledTimes(2);
  });

  it('TC-20: read-only board — shortcuts are ignored and the buttons are disabled', () => {
    const controller = makeFake();
    render(<Harness controller={controller} canEdit={false} />);

    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();

    keyDown(window, { key: 'z', ctrlKey: true });
    keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    keyDown(window, { key: 'y', ctrlKey: true });
    keyDown(window, { key: 'z', metaKey: true });
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });

  it('TC-21: Ctrl+Z while typing in an input does NOT reach the controller', () => {
    const controller = makeFake();
    render(
      <Harness controller={controller} canEdit>
        <input data-testid="share-input" aria-label="Share link" />
      </Harness>,
    );

    const input = screen.getByTestId('share-input');
    input.focus();
    expect(keyDown(input, { key: 'z', ctrlKey: true })).toBe(false); // not claimed by the board
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
  });

  it('the buttons act on the controller and track history changes', () => {
    const controller = makeFake({ canUndo: false, canRedo: false });
    render(<Harness controller={controller} canEdit />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    // A new step appears → Undo enables, Redo stays disabled.
    act(() => {
      controller.state.canUndo = true;
      controller.listeners.forEach((l) => l());
    });
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();

    // Clicking Undo consumes the step → Undo disables, Redo enables.
    act(() => {
      undo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(controller.undo).toHaveBeenCalledTimes(1);
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
  });
});
