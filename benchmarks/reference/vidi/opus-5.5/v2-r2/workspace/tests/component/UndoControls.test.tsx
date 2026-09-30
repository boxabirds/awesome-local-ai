// Story 8 — undo.controls: shortcuts, Undo/Redo buttons and the edit lock (TC-18 to TC-21) with a fake controller.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { UndoController } from '../../src/client/board/undo';
import { SharePanel } from '../../src/client/share/SharePanel';
import { initDoc } from '../../src/shared/board-model';

// Captures connectBoard's state callback so the test can make the board fail to load.
const connectCalls = vi.hoisted(() => [] as ((s: string) => void)[]);
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
      connectCalls.push(onState);
      onState('connecting');
      return { destroy() {} };
    },
  };
});

const { App } = await import('../../src/client/App');

/** A fake UndoController whose stacks the test sets directly. */
function fakeUndo(state: { undo: boolean; redo: boolean } = { undo: true, redo: true }) {
  const listeners = new Set<() => void>();
  const fake = {
    state,
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
    checkpoint: () => null,
    canUndoSince: () => false,
    holdCapture: vi.fn(),
    destroy: vi.fn(),
    set(next: { undo: boolean; redo: boolean }) {
      Object.assign(state, next);
      act(() => {
        for (const cb of listeners) cb();
      });
    },
  } satisfies UndoController & Record<string, unknown>;
  return fake;
}

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const undoButton = () => screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = () => screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;

afterEach(() => {
  connectCalls.length = 0;
});

describe('undo.controls', () => {
  it('TC-18 empty history → Undo and Redo disabled; they enable as steps appear', () => {
    const undo = fakeUndo({ undo: false, redo: false });
    render(<App doc={newDoc()} undo={undo} />);
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(undoButton().getAttribute('aria-disabled')).toBe('true');
    expect(redoButton().getAttribute('aria-disabled')).toBe('true');
    expect(undoButton().title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redoButton().title).toBe('Redo (Ctrl/Cmd+Shift+Z)');

    undo.set({ undo: true, redo: false });
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
    fireEvent.click(undoButton());
    expect(undo.undo).toHaveBeenCalledTimes(1);

    undo.set({ undo: false, redo: true });
    fireEvent.click(redoButton());
    expect(undo.redo).toHaveBeenCalledTimes(1);
    expect(undoButton().disabled).toBe(true);
  });

  it('TC-19 Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo; each prevents the default', () => {
    const undo = fakeUndo();
    render(<App doc={newDoc()} undo={undo} />);
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true })).toBe(false);
    expect(undo.undo).toHaveBeenCalledTimes(2);
    expect(undo.redo).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: 'Z', metaKey: true, shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })).toBe(false);
    expect(undo.redo).toHaveBeenCalledTimes(3);
    expect(undo.undo).toHaveBeenCalledTimes(2);

    // Plain Z and Y are not shortcuts.
    expect(fireEvent.keyDown(document.body, { key: 'z' })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'y' })).toBe(true);
    expect(undo.undo).toHaveBeenCalledTimes(2);
    expect(undo.redo).toHaveBeenCalledTimes(3);
  });

  it('TC-20 board failed to load → shortcuts ignored and buttons disabled', () => {
    const undo = fakeUndo();
    render(<App boardId="b1" doc={newDoc()} undo={undo} />);
    act(() => connectCalls.at(-1)!('connected'));
    expect(undoButton().disabled).toBe(false);

    act(() => connectCalls.at(-1)!('load_failed'));
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    fireEvent.click(undoButton());
    expect(undo.undo).not.toHaveBeenCalled();
    expect(undo.redo).not.toHaveBeenCalled();
  });

  it('TC-21 Ctrl+Z in the share link field is left to the browser', () => {
    const undo = fakeUndo();
    render(
      <>
        <App doc={newDoc()} undo={undo} />
        <SharePanel boardId="b1" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const input = screen.getByRole('textbox', { name: 'Board link' });
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'y', ctrlKey: true })).toBe(true);
    expect(undo.undo).not.toHaveBeenCalled();
    expect(undo.redo).not.toHaveBeenCalled();
  });
});
