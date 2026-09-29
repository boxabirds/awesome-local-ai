// undo.controls: shortcuts, Undo/Redo buttons and the edit lock (TC-18 to TC-21), with a fake
// UndoController; plus the same controls wired into the real App.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Toolbar } from '../../src/client/board/Toolbar';
import { REDO_TOOLTIP, UNDO_TOOLTIP } from '../../src/client/board/UndoButtons';
import type { UndoController } from '../../src/client/board/undo';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { useUndo } from '../../src/client/board/useUndo';
import { SharePanel } from '../../src/client/share/SharePanel';
import { initDoc } from '../../src/shared/board-model';
import { renderApp } from './stickyHelpers';

afterEach(cleanup);

function fakeController(state: { undo: boolean; redo: boolean }) {
  const listeners = new Set<() => void>();
  const controller = {
    undo: vi.fn(() => state.undo),
    redo: vi.fn(() => state.redo),
    boundary: vi.fn(),
    canUndo: () => state.undo,
    canRedo: () => state.redo,
    addScope: vi.fn(),
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: vi.fn(),
  } satisfies UndoController;
  const set = (next: Partial<typeof state>) =>
    act(() => {
      Object.assign(state, next);
      for (const cb of listeners) cb();
    });
  return { controller, set };
}

function Harness(props: { controller: UndoController; canEdit: boolean }) {
  const doc = new Y.Doc();
  initDoc(doc);
  const selection = useSelection([]);
  useBoardKeys({ doc, selection, snapshot: [], canEdit: props.canEdit, undo: props.controller });
  const undo = useUndo(props.controller, props.canEdit);
  return (
    <>
      <Toolbar onCreateSticky={() => {}} disabled={!props.canEdit} undo={undo} />
      <SharePanel boardId="abc123def456" />
    </>
  );
}

const undoButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Undo' });
const redoButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Redo' });

function key(init: KeyboardEventInit, target: EventTarget = window) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('undo.controls', () => {
  it('TC-18 with empty stacks both buttons are disabled; they follow the history', () => {
    const { controller, set } = fakeController({ undo: false, redo: false });
    render(<Harness controller={controller} canEdit />);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(undoButton()).toHaveProperty('title', UNDO_TOOLTIP);
    expect(redoButton()).toHaveProperty('title', REDO_TOOLTIP);
    // Nothing to undo: the shortcut does nothing.
    key({ key: 'z', ctrlKey: true });
    expect(controller.undo).toHaveBeenCalledTimes(1);
    expect(controller.undo).toHaveReturnedWith(false);

    set({ undo: true });
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
    fireEvent.click(undoButton());
    expect(controller.undo).toHaveBeenCalledTimes(2);
    set({ undo: false, redo: true });
    expect(undoButton().disabled).toBe(true);
    fireEvent.click(redoButton());
    expect(controller.redo).toHaveBeenCalledTimes(1);
  });

  it('TC-19 Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; each prevents the default', () => {
    const { controller } = fakeController({ undo: true, redo: true });
    render(<Harness controller={controller} canEdit />);
    const undos = [
      key({ key: 'z', ctrlKey: true }),
      key({ key: 'z', metaKey: true }),
    ];
    expect(controller.undo).toHaveBeenCalledTimes(2);
    const redos = [
      key({ key: 'Z', ctrlKey: true, shiftKey: true }),
      key({ key: 'z', metaKey: true, shiftKey: true }),
      key({ key: 'y', ctrlKey: true }),
    ];
    expect(controller.redo).toHaveBeenCalledTimes(3);
    expect(controller.undo).toHaveBeenCalledTimes(2);
    for (const e of [...undos, ...redos]) expect(e.defaultPrevented).toBe(true);
    // Plain Z and Cmd+Y are not shortcuts.
    key({ key: 'z' });
    key({ key: 'y', metaKey: true });
    expect(controller.undo).toHaveBeenCalledTimes(2);
    expect(controller.redo).toHaveBeenCalledTimes(3);
  });

  it('TC-20 board failed to load: shortcuts ignored and buttons disabled', () => {
    const { controller } = fakeController({ undo: true, redo: true });
    render(<Harness controller={controller} canEdit={false} />);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    const e1 = key({ key: 'z', ctrlKey: true });
    const e2 = key({ key: 'z', ctrlKey: true, shiftKey: true });
    const e3 = key({ key: 'y', ctrlKey: true });
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
    expect(e1.defaultPrevented || e2.defaultPrevented || e3.defaultPrevented).toBe(false);
  });

  it('TC-21 Ctrl+Z in the share link field is left to the browser', () => {
    const { controller } = fakeController({ undo: true, redo: true });
    render(<Harness controller={controller} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const input = screen.getByRole('textbox', { name: 'Board link' });
    input.focus();
    const e = key({ key: 'z', ctrlKey: true }, input);
    const r = key({ key: 'y', ctrlKey: true }, input);
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.redo).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    expect(r.defaultPrevented).toBe(false);
  });

  it('in the App, creating a note enables Undo; Undo removes it, Redo brings it back', () => {
    const { doc } = renderApp();
    const objects = doc.getMap('objects');
    expect(undoButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    expect(objects.size).toBe(1);
    // Leave the editor so the board's shortcut handler is in charge.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note text' }), { key: 'Escape' });
    expect(undoButton().disabled).toBe(false);
    fireEvent.click(undoButton());
    expect(objects.size).toBe(0);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
    key({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(objects.size).toBe(1);
    expect(redoButton().disabled).toBe(true);
  });
});
