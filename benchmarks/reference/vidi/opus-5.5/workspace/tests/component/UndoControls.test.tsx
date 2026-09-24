/**
 * undo.controls (story 8): Undo/Redo buttons and shortcuts against a fake UndoController
 * (TC-18 to TC-21), plus the buttons driving the real controller on the real board.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from '../../src/client/board/Board';
import type { UndoController } from '../../src/client/board/undo';
import { SharePanel } from '../../src/client/share/SharePanel';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { doubleClickBoard, editor, flushFrame, noteEls, renderBoard } from './stickyHelpers';

interface FakeController extends UndoController {
  undo: ReturnType<typeof vi.fn<() => boolean>>;
  redo: ReturnType<typeof vi.fn<() => boolean>>;
  set(state: { canUndo: boolean; canRedo: boolean }): void;
}

function fakeController(initial = { canUndo: true, canRedo: true }): FakeController {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    undo: vi.fn(() => state.canUndo),
    redo: vi.fn(() => state.canRedo),
    boundary: vi.fn(),
    canUndo: () => state.canUndo,
    canRedo: () => state.canRedo,
    addScope: vi.fn(),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: vi.fn(),
    beginGesture: vi.fn(),
    endGesture: vi.fn(),
    lastStep: () => null,
    set(next) {
      state = next;
      act(() => listeners.forEach((cb) => cb()));
    },
  };
}

/** Stands in for the browser WebSocket so a test can make the room close with "load failed". */
class ControlledWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ControlledWebSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = ControlledWebSocket.CONNECTING;
  binaryType = 'arraybuffer';
  onopen: (() => void) | null = null;
  onmessage: unknown = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: unknown = null;
  constructor(readonly url: string) {
    super();
    ControlledWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = ControlledWebSocket.CLOSED;
  }
  acceptThenClose(code: number): void {
    act(() => {
      this.readyState = ControlledWebSocket.OPEN;
      this.onopen?.();
      this.readyState = ControlledWebSocket.CLOSED;
      this.onclose?.({ code, reason: '' });
    });
  }
}

function renderWith(controller: UndoController, withShare = false): void {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const boardId = newBoardId();
  render(
    <Board boardId={boardId} createUndoController={() => controller}>
      {withShare && <SharePanel boardId={boardId} />}
    </Board>,
  );
  flushFrame();
}

function undoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Undo' });
}
function redoButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Redo' });
}

/** Dispatches keydown on `target`; returns true when the page called preventDefault. */
function keyPrevented(init: KeyboardEventInit, target: Element = document.body): boolean {
  return !fireEvent.keyDown(target, init);
}

const UNDO_KEYS: [string, KeyboardEventInit][] = [
  ['Ctrl+Z', { key: 'z', ctrlKey: true }],
  ['Cmd+Z', { key: 'z', metaKey: true }],
];
const REDO_KEYS: [string, KeyboardEventInit][] = [
  ['Ctrl+Shift+Z', { key: 'Z', ctrlKey: true, shiftKey: true }],
  ['Cmd+Shift+Z', { key: 'Z', metaKey: true, shiftKey: true }],
  ['Ctrl+Y', { key: 'y', ctrlKey: true }],
];

beforeEach(() => {
  ControlledWebSocket.instances = [];
});

describe('undo.controls: buttons', () => {
  it('TC-18 with empty history both buttons are disabled (and expose it), with shortcut tooltips', () => {
    renderWith(fakeController({ canUndo: false, canRedo: false }));
    for (const button of [undoButton(), redoButton()]) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
    }
    expect(undoButton().title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().title).toBe('Redo (Ctrl/Cmd+Shift+Z)');
    // The buttons sit in the left tool bar, below the tools.
    const toolbar = screen.getByRole('toolbar', { name: 'Tools' });
    const buttons = Array.from(toolbar.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));
    expect(buttons).toEqual(['Sticky note', 'Undo', 'Redo']);
  });

  it('buttons follow the controller state and call it when clicked', () => {
    const ctl = fakeController({ canUndo: false, canRedo: false });
    renderWith(ctl);
    ctl.set({ canUndo: true, canRedo: false });
    expect(undoButton().disabled).toBe(false);
    expect(undoButton().getAttribute('aria-disabled')).toBe('false');
    expect(redoButton().disabled).toBe(true);
    fireEvent.click(undoButton());
    expect(ctl.undo).toHaveBeenCalledTimes(1);
    ctl.set({ canUndo: false, canRedo: true });
    fireEvent.click(redoButton());
    expect(ctl.redo).toHaveBeenCalledTimes(1);
    expect(ctl.undo).toHaveBeenCalledTimes(1);
  });

  it('with the real controller: create a note, Undo removes it, Redo brings it back', () => {
    renderBoard();
    expect(undoButton().disabled).toBe(true);
    doubleClickBoard(400, 300);
    fireEvent.keyDown(editor()!, { key: 'Escape' });
    expect(noteEls()).toHaveLength(1);
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
    fireEvent.click(undoButton());
    expect(noteEls()).toHaveLength(0);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
    fireEvent.click(redoButton());
    expect(noteEls()).toHaveLength(1);
    expect(redoButton().disabled).toBe(true);
  });
});

describe('undo.controls: shortcuts', () => {
  it.each(UNDO_KEYS)('TC-19 %s undoes with preventDefault', (_name, init) => {
    const ctl = fakeController();
    renderWith(ctl);
    expect(keyPrevented(init)).toBe(true);
    expect(ctl.undo).toHaveBeenCalledTimes(1);
    expect(ctl.redo).not.toHaveBeenCalled();
  });

  it.each(REDO_KEYS)('TC-19 %s redoes with preventDefault', (_name, init) => {
    const ctl = fakeController();
    renderWith(ctl);
    expect(keyPrevented(init)).toBe(true);
    expect(ctl.redo).toHaveBeenCalledTimes(1);
    expect(ctl.undo).not.toHaveBeenCalled();
  });

  it('TC-19 shortcuts also work while a toolbar button has focus; Cmd+Y and Alt combinations do nothing', () => {
    const ctl = fakeController();
    renderWith(ctl);
    undoButton().focus();
    expect(keyPrevented({ key: 'z', ctrlKey: true }, undoButton())).toBe(true);
    expect(ctl.undo).toHaveBeenCalledTimes(1);
    expect(keyPrevented({ key: 'y', metaKey: true })).toBe(false);
    expect(keyPrevented({ key: 'z', ctrlKey: true, altKey: true })).toBe(false);
    expect(ctl.redo).not.toHaveBeenCalled();
    expect(ctl.undo).toHaveBeenCalledTimes(1);
  });

  it('TC-20 (negative) while the board failed to load: shortcuts ignored, buttons disabled', () => {
    vi.stubGlobal('WebSocket', ControlledWebSocket);
    const ctl = fakeController({ canUndo: true, canRedo: true });
    renderWith(ctl);
    expect(undoButton().disabled).toBe(false);
    ControlledWebSocket.instances.at(-1)!.acceptThenClose(CLOSE_BOARD_LOAD_FAILED);
    expect(screen.getByRole('status', { name: 'Connection status' }).textContent).toBe(
      "This board couldn't be loaded. Retrying…",
    );
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    for (const [, init] of [...UNDO_KEYS, ...REDO_KEYS]) expect(keyPrevented(init)).toBe(false);
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(ctl.undo).not.toHaveBeenCalled();
    expect(ctl.redo).not.toHaveBeenCalled();
  });

  it('TC-21 (negative) Ctrl+Z in the share link field is left to the field', () => {
    const ctl = fakeController();
    renderWith(ctl, true);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const field = screen.getByRole('textbox', { name: 'Board link' });
    field.focus();
    for (const [, init] of [...UNDO_KEYS, ...REDO_KEYS]) expect(keyPrevented(init, field)).toBe(false);
    expect(ctl.undo).not.toHaveBeenCalled();
    expect(ctl.redo).not.toHaveBeenCalled();
  });

  it('the controller is destroyed when the board unmounts (history is session-only)', () => {
    const ctl = fakeController();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const view = render(<Board boardId={newBoardId()} createUndoController={() => ctl} />);
    view.unmount();
    expect(ctl.destroy).toHaveBeenCalled();
  });
});
