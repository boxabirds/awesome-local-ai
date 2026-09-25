import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useUndo } from '../../src/client/board/useUndo';
import { Toolbar } from '../../src/client/board/Toolbar';
import { REDO_TOOLTIP, UNDO_TOOLTIP } from '../../src/client/board/UndoButtons';
import type { UndoController } from '../../src/client/board/undo';
import { SharePanel } from '../../src/client/share/SharePanel';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { FakeProvider } from './fakeProvider';
import { dispatchPrevented, renderApp } from './helpers';

/** A fake controller with settable stack state. */
function fakeController(state = { canUndo: true, canRedo: true }) {
  const listeners = new Set<() => void>();
  const c = {
    undo: vi.fn(() => state.canUndo),
    redo: vi.fn(() => state.canRedo),
    boundary: vi.fn(),
    beginStep: vi.fn(),
    canUndo: () => state.canUndo,
    canRedo: () => state.canRedo,
    topUndo: () => null,
    topRedo: () => null,
    addScope: vi.fn(),
    onChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: vi.fn(),
    /** Test helper: change the stacks and notify. */
    set(next: { canUndo: boolean; canRedo: boolean }) {
      Object.assign(state, next);
      act(() => listeners.forEach((l) => l()));
    },
  };
  return c satisfies UndoController;
}

function Harness(props: { controller: UndoController; canEdit: boolean; share?: boolean }) {
  const [doc] = useState(() => new Y.Doc());
  const { objects } = useBoardDoc(undefined, doc);
  const selection = useSelection(objects);
  const undo = useUndo(props.controller, props.canEdit);
  useBoardKeys({ doc, selection, snapshot: objects, canEdit: props.canEdit, undo: { ...undo, controller: props.controller } });
  return (
    <>
      <Toolbar onCreateSticky={() => {}} disabled={!props.canEdit} undo={undo} />
      {props.share && <SharePanel boardId="AbCdEfGhIjKlMnOpQr_-09" />}
    </>
  );
}

function press(k: string, init: KeyboardEventInit, target: EventTarget = document.body) {
  return dispatchPrevented(target, new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

const undoButton = () => screen.getByRole('button', { name: 'Undo' });
const redoButton = () => screen.getByRole('button', { name: 'Redo' });

describe('undo shortcuts and buttons (undo.controls)', () => {
  it('TC-18 with empty stacks both buttons are disabled; they follow the stacks and show shortcut tooltips', () => {
    const c = fakeController({ canUndo: false, canRedo: false });
    render(<Harness controller={c} canEdit />);
    expect(undoButton()).toBeDisabled();
    expect(undoButton()).toHaveAttribute('aria-disabled', 'true');
    expect(redoButton()).toBeDisabled();
    expect(redoButton()).toHaveAttribute('aria-disabled', 'true');
    expect(undoButton()).toHaveAttribute('title', UNDO_TOOLTIP);
    expect(redoButton()).toHaveAttribute('title', REDO_TOOLTIP);
    expect(UNDO_TOOLTIP).toBe('Undo (Ctrl/Cmd+Z)');
    expect(REDO_TOOLTIP).toBe('Redo (Ctrl/Cmd+Shift+Z)');
    // Empty-stack shortcut does nothing visible.
    press('z', { ctrlKey: true });
    expect(c.undo).toHaveBeenCalledTimes(1);
    expect(c.undo).toHaveReturnedWith(false);

    c.set({ canUndo: true, canRedo: false });
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();
    fireEvent.click(undoButton());
    expect(c.undo).toHaveBeenCalledTimes(2);
    c.set({ canUndo: false, canRedo: true });
    fireEvent.click(redoButton());
    expect(c.redo).toHaveBeenCalledTimes(1);
  });

  it('the real app starts with both buttons disabled and enables Undo after a change', () => {
    const doc = new Y.Doc();
    renderApp(doc);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    act(() => screen.getByRole('button', { name: 'Sticky note' }).click());
    expect(snapshot(doc)).toHaveLength(1);
    expect(undoButton()).toBeEnabled();
    fireEvent.click(undoButton());
    expect(snapshot(doc)).toHaveLength(0);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeEnabled();
    fireEvent.click(redoButton());
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-19 Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo; each prevents the default', () => {
    const c = fakeController();
    render(<Harness controller={c} canEdit />);
    expect(press('z', { ctrlKey: true })).toBe(true);
    expect(press('z', { metaKey: true })).toBe(true);
    expect(c.undo).toHaveBeenCalledTimes(2);
    expect(c.redo).not.toHaveBeenCalled();
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press('z', { metaKey: true, shiftKey: true })).toBe(true);
    expect(press('y', { ctrlKey: true })).toBe(true);
    expect(c.redo).toHaveBeenCalledTimes(3);
    expect(c.undo).toHaveBeenCalledTimes(2);
    // Plain Z is not a shortcut.
    expect(press('z', {})).toBe(false);
    expect(c.undo).toHaveBeenCalledTimes(2);
  });

  it('TC-20 while the board cannot be edited, shortcuts are ignored and both buttons are disabled', () => {
    const c = fakeController();
    render(<Harness controller={c} canEdit={false} />);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    press('z', { ctrlKey: true });
    press('z', { ctrlKey: true, shiftKey: true });
    press('y', { ctrlKey: true });
    fireEvent.click(undoButton());
    expect(c.undo).not.toHaveBeenCalled();
    expect(c.redo).not.toHaveBeenCalled();
  });

  it('TC-20 in the app, a board that failed to load disables Undo even with history, and Ctrl+Z changes nothing', async () => {
    const provider = new FakeProvider();
    vi.resetModules();
    vi.doMock('../../src/client/sync/connectBoard', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
      return {
        ...real,
        connectBoard: (_doc: Y.Doc, _id: string, onState: (s: ConnectionState) => void) => ({
          destroy: real.trackConnectionState(provider, onState),
        }),
      };
    });
    const { App } = await import('../../src/client/App');
    const doc = new Y.Doc();
    initDoc(doc);
    render(<App boardId="AbCdEfGhIjKlMnOpQr_-09" doc={doc} />);
    provider.connect();
    act(() => screen.getByRole('button', { name: 'Sticky note' }).click());
    expect(snapshot(doc)).toHaveLength(1);
    expect(undoButton()).toBeEnabled();
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    press('z', { ctrlKey: true });
    expect(snapshot(doc)).toHaveLength(1);
    vi.doUnmock('../../src/client/sync/connectBoard');
  });

  it('TC-21 Ctrl+Z with focus in the share link field is left to the browser', () => {
    const c = fakeController();
    render(<Harness controller={c} canEdit share />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const input = screen.getByRole('textbox', { name: 'Board link' });
    expect(input).toHaveFocus();
    expect(press('z', { ctrlKey: true }, input)).toBe(false);
    expect(press('z', { ctrlKey: true, shiftKey: true }, input)).toBe(false);
    expect(c.undo).not.toHaveBeenCalled();
    expect(c.redo).not.toHaveBeenCalled();
  });
});

