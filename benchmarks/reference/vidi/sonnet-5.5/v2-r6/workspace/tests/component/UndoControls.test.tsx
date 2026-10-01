import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { UndoController } from '../../src/client/board/undo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { useUndo } from '../../src/client/board/useUndo';

function fakeController(stacks: { undo: number; redo: number }) {
  const listeners = new Set<() => void>();
  const c = {
    undo: vi.fn(() => { if (stacks.undo === 0) return false; stacks.undo--; stacks.redo++; listeners.forEach((l) => l()); return true; }),
    redo: vi.fn(() => { if (stacks.redo === 0) return false; stacks.redo--; stacks.undo++; listeners.forEach((l) => l()); return true; }),
    boundary: vi.fn(),
    canUndo: () => stacks.undo > 0,
    canRedo: () => stacks.redo > 0,
    addScope: vi.fn(),
    onChange: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    destroy: vi.fn(),
  };
  return c satisfies UndoController;
}

const doc = new Y.Doc();
const NO_NOTES: never[] = [];

function Harness(props: { controller: UndoController; canEdit: boolean }) {
  const selection = useSelection(NO_NOTES);
  useBoardKeys({ doc, selection, snapshot: NO_NOTES, canEdit: props.canEdit, undo: props.controller });
  const state = useUndo(props.controller, props.canEdit);
  return (
    <div>
      <UndoButtons {...state} />
      <input aria-label="Share link" />
    </div>
  );
}

const press = (init: KeyboardEventInit, target: Element | Window = window) => {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { (target as EventTarget).dispatchEvent(ev); });
  return ev;
};

describe('undo buttons (undo.buttons)', () => {
  it('TC-18 empty history: both buttons disabled and aria-disabled', () => {
    render(<Harness controller={fakeController({ undo: 0, redo: 0 })} canEdit />);
    for (const name of ['Undo', 'Redo']) {
      const b = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('enabled buttons call the controller and show shortcut tooltips', () => {
    const c = fakeController({ undo: 1, redo: 1 });
    render(<Harness controller={c} canEdit />);
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('title')).toBe('Undo (Ctrl/Cmd+Z)');
    expect(screen.getByRole('button', { name: 'Redo' }).getAttribute('title')).toBe('Redo (Ctrl/Cmd+Shift+Z)');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(c.undo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    // after the undo the redo stack holds 2 entries
    expect(c.redo).toHaveBeenCalledTimes(1);
  });

  it('buttons follow controller changes', () => {
    const c = fakeController({ undo: 1, redo: 0 });
    render(<Harness controller={c} canEdit />);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('undo shortcuts (undo.shortcuts)', () => {
  it('TC-19 Ctrl+Z and Cmd+Z undo; Ctrl+Shift+Z, Cmd+Shift+Z and Ctrl+Y redo; all preventDefault', () => {
    const c = fakeController({ undo: 10, redo: 10 });
    render(<Harness controller={c} canEdit />);
    expect(press({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'z', metaKey: true }).defaultPrevented).toBe(true);
    expect(c.undo).toHaveBeenCalledTimes(2);
    expect(c.redo).not.toHaveBeenCalled();
    expect(press({ key: 'Z', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'Z', metaKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 'y', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(c.redo).toHaveBeenCalledTimes(3);
    expect(c.undo).toHaveBeenCalledTimes(2);
  });

  it('TC-20 load failed: shortcuts ignored and buttons disabled', () => {
    const c = fakeController({ undo: 3, redo: 3 });
    render(<Harness controller={c} canEdit={false} />);
    press({ key: 'z', ctrlKey: true });
    press({ key: 'z', ctrlKey: true, shiftKey: true });
    press({ key: 'y', ctrlKey: true });
    expect(c.undo).not.toHaveBeenCalled();
    expect(c.redo).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('TC-21 Ctrl+Z in a non-board input is left to the browser', () => {
    const c = fakeController({ undo: 3, redo: 3 });
    render(<Harness controller={c} canEdit />);
    const ev = press({ key: 'z', ctrlKey: true }, screen.getByLabelText('Share link'));
    expect(c.undo).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});
