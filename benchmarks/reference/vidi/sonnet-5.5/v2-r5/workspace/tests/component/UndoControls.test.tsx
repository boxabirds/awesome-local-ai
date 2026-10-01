import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UndoController } from '../../src/client/board/undo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useUndo } from '../../src/client/board/useUndo';
import { Harness, newDoc } from './helpers';

afterEach(cleanup);

function fake(state: { canUndo: boolean; canRedo: boolean }) {
  const ctl: UndoController = {
    undo: vi.fn(() => true), redo: vi.fn(() => true), boundary: vi.fn(),
    canUndo: () => state.canUndo, canRedo: () => state.canRedo,
    addScope: vi.fn(), onChange: () => () => {}, destroy: vi.fn(),
  };
  return ctl;
}

function Screen({ ctl, canEdit }: { ctl: UndoController; canEdit: boolean }) {
  const u = useUndo(ctl, canEdit);
  return (
    <>
      <Harness doc={doc} undo={ctl} canEdit={canEdit} />
      <UndoButtons {...u} />
      <input aria-label="Share link" readOnly value="https://x.test/b/abc" />
    </>
  );
}
const doc = newDoc();

describe('undo buttons and shortcuts', () => {
  it('TC-18 empty history: both buttons are disabled', () => {
    render(<Screen ctl={fake({ canUndo: false, canRedo: false })} canEdit />);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('buttons call the controller and show the shortcuts as tooltips', () => {
    const ctl = fake({ canUndo: true, canRedo: true });
    render(<Screen ctl={ctl} canEdit />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo.getAttribute('title')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(redo.getAttribute('title')).toBe('Redo (Ctrl/Cmd+Shift+Z)');
    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(ctl.undo).toHaveBeenCalledTimes(1);
    expect(ctl.redo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Ctrl+Z', { key: 'z', ctrlKey: true }, 'undo'],
    ['Cmd+Z', { key: 'z', metaKey: true }, 'undo'],
    ['Ctrl+Shift+Z', { key: 'Z', ctrlKey: true, shiftKey: true }, 'redo'],
    ['Cmd+Shift+Z', { key: 'Z', metaKey: true, shiftKey: true }, 'redo'],
    ['Ctrl+Y', { key: 'y', ctrlKey: true }, 'redo'],
  ] as const)('TC-19 %s calls %s and prevents the browser default', (_n, init, method) => {
    const ctl = fake({ canUndo: true, canRedo: true });
    render(<Screen ctl={ctl} canEdit />);
    const notPrevented = fireEvent.keyDown(document.body, { ...init, cancelable: true });
    expect(notPrevented).toBe(false);
    expect(ctl[method]).toHaveBeenCalledTimes(1);
    expect(ctl[method === 'undo' ? 'redo' : 'undo']).not.toHaveBeenCalled();
  });

  it('TC-20 load failed: shortcuts are ignored and buttons are disabled', () => {
    const ctl = fake({ canUndo: true, canRedo: true });
    render(<Screen ctl={ctl} canEdit={false} />);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(ctl.undo).not.toHaveBeenCalled();
    expect(ctl.redo).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-21 Ctrl+Z with focus in the share link field leaves the browser default alone', () => {
    const ctl = fake({ canUndo: true, canRedo: true });
    render(<Screen ctl={ctl} canEdit />);
    const input = screen.getByLabelText('Share link');
    input.focus();
    const notPrevented = fireEvent.keyDown(input, { key: 'z', ctrlKey: true, cancelable: true });
    expect(notPrevented).toBe(true);
    expect(ctl.undo).not.toHaveBeenCalled();
  });
});
