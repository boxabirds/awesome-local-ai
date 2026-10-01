import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UndoController } from '../../src/client/board/undo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { useUndo } from '../../src/client/board/useUndo';
import * as Y from 'yjs';

afterEach(cleanup);

function fakeController(opts: { canUndo?: boolean; canRedo?: boolean } = {}) {
  const c = {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    boundary: vi.fn(),
    canUndo: () => opts.canUndo ?? true,
    canRedo: () => opts.canRedo ?? true,
    addScope: vi.fn(),
    onChange: () => () => {},
    destroy: vi.fn(),
    isDestroyed: () => false,
  };
  return c satisfies UndoController;
}

function Subject(props: { controller: UndoController; canEdit: boolean }) {
  const doc = new Y.Doc();
  const sel = useSelection([]);
  const undo = useUndo(props.controller, props.canEdit);
  useBoardKeys({ doc, selection: sel, snapshot: [], canEdit: props.canEdit, undo: props.controller });
  return (
    <div>
      <UndoButtons {...undo} />
      <input aria-label="Share link" />
    </div>
  );
}

describe('undo.controls', () => {
  it('TC-18 buttons are disabled when the stacks are empty', () => {
    render(<Subject controller={fakeController({ canUndo: false, canRedo: false })} canEdit />);
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    expect(undo.title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redo.title).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });

  it('buttons call the controller when enabled', () => {
    const c = fakeController();
    render(<Subject controller={c} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(c.undo).toHaveBeenCalledTimes(1);
    expect(c.redo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Ctrl+Z', { key: 'z', ctrlKey: true }, 'undo'],
    ['Cmd+Z', { key: 'z', metaKey: true }, 'undo'],
    ['Ctrl+Shift+Z', { key: 'Z', ctrlKey: true, shiftKey: true }, 'redo'],
    ['Cmd+Shift+Z', { key: 'Z', metaKey: true, shiftKey: true }, 'redo'],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }, 'redo'],
  ] as const)('TC-19 %s calls %s with preventDefault', (_label, init, method) => {
    const c = fakeController();
    render(<Subject controller={c} canEdit />);
    const notPrevented = fireEvent.keyDown(window, init);
    expect(notPrevented).toBe(false);
    expect(c[method]).toHaveBeenCalledTimes(1);
    expect(c[method === 'undo' ? 'redo' : 'undo']).not.toHaveBeenCalled();
  });

  it('TC-20 load-failed board: shortcuts ignored and buttons disabled', () => {
    const c = fakeController();
    render(<Subject controller={c} canEdit={false} />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(c.undo).not.toHaveBeenCalled();
    expect(c.redo).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-21 Ctrl+Z in a non-board input is left to the browser', () => {
    const c = fakeController();
    render(<Subject controller={c} canEdit />);
    const notPrevented = fireEvent.keyDown(screen.getByLabelText('Share link'), { key: 'z', ctrlKey: true });
    expect(notPrevented).toBe(true);
    expect(c.undo).not.toHaveBeenCalled();
  });
});
