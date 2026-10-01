import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../src/client/board/useSelection';
import type { UndoController } from '../../src/client/board/undo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useUndo } from '../../src/client/board/useUndo';
import * as Y from 'yjs';

afterEach(cleanup);

function fake(canUndo: boolean, canRedo: boolean) {
  const c = {
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    boundary: vi.fn(),
    canUndo: () => canUndo,
    canRedo: () => canRedo,
    addScope: vi.fn(),
    onChange: () => () => {},
    destroy: vi.fn(),
  };
  return c satisfies UndoController;
}

const selection = { ids: new Set<string>(), editingId: null } as unknown as Selection;

function Harness({ ctl, canEdit }: { ctl: UndoController; canEdit: boolean }) {
  const state = useUndo(ctl, canEdit);
  useBoardKeys({ doc: new Y.Doc(), selection, snapshot: [], canEdit, undo: ctl });
  return (
    <>
      <UndoButtons {...state} />
      <input aria-label="Share link" />
    </>
  );
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('undo controls', () => {
  it('TC-18 empty stacks disable both buttons', () => {
    render(<Harness ctl={fake(false, false)} canEdit />);
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(true);
    expect(button('Undo').title).toBe('Undo (Ctrl/Cmd+Z)');
    expect(button('Redo').title).toBe('Redo (Ctrl/Cmd+Shift+Z)');
  });

  it('buttons call the controller when enabled', () => {
    const ctl = fake(true, true);
    render(<Harness ctl={ctl} canEdit />);
    fireEvent.click(button('Undo'));
    fireEvent.click(button('Redo'));
    expect(ctl.undo).toHaveBeenCalledTimes(1);
    expect(ctl.redo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Ctrl+Z', { key: 'z', ctrlKey: true }, 'undo'],
    ['Cmd+Z', { key: 'z', metaKey: true }, 'undo'],
    ['Ctrl+Shift+Z', { key: 'Z', ctrlKey: true, shiftKey: true }, 'redo'],
    ['Cmd+Shift+Z', { key: 'z', metaKey: true, shiftKey: true }, 'redo'],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }, 'redo'],
  ] as const)('TC-19 %s calls %s and prevents the default', (_n, init, method) => {
    const ctl = fake(true, true);
    render(<Harness ctl={ctl} canEdit />);
    const notPrevented = fireEvent.keyDown(document.body, init);
    expect(notPrevented).toBe(false);
    expect(ctl[method]).toHaveBeenCalledTimes(1);
    expect(ctl[method === 'undo' ? 'redo' : 'undo']).not.toHaveBeenCalled();
  });

  it('TC-20 load failed: shortcuts ignored and buttons disabled', () => {
    const ctl = fake(true, true);
    render(<Harness ctl={ctl} canEdit={false} />);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(ctl.undo).not.toHaveBeenCalled();
    expect(ctl.redo).not.toHaveBeenCalled();
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(true);
  });

  it('TC-21 Ctrl+Z in a non-board input is left to the browser', () => {
    const ctl = fake(true, true);
    render(<Harness ctl={ctl} canEdit />);
    const input = screen.getByLabelText('Share link');
    input.focus();
    const notPrevented = fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(notPrevented).toBe(true);
    expect(ctl.undo).not.toHaveBeenCalled();
  });
});
