import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useMemo, useRef, type JSX, type MutableRefObject } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { UndoContext } from '../../src/client/board/useUndo';
import { snapshot } from '../../src/shared/board-model';
import { makeSticky } from '../fixtures/stickies';

interface CtrlRegistry {
  doc: Y.Doc;
  selection: SelectionApi;
  real: UndoController;
  undo: UndoController;
}

let registry: MutableRefObject<CtrlRegistry | null>;
let undoCalls: { undo: (() => void)[]; redo: (() => void)[] };

// Board plus an outside input, with the controller wrapped in spies so tests
// can assert which shortcuts reach it.
function ControlsHarness(props: { canEdit: boolean }): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  const created = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => created.destroy(), [created]);
  const realRef = useRef(created);
  realRef.current = created;
  const wrapped = useMemo<UndoController>(() => {
    const spy: UndoController = {
      undo: () => {
        undoCalls.undo.push(() => realRef.current.undo());
        return true;
      },
      redo: () => {
        undoCalls.redo.push(() => realRef.current.redo());
        return true;
      },
      boundary: () => realRef.current.boundary(),
      canUndo: () => realRef.current.canUndo(),
      canRedo: () => realRef.current.canRedo(),
      addScope: (type: Y.AbstractType<unknown>) => realRef.current.addScope(type),
      onChange: (cb: () => void) => realRef.current.onChange(cb),
      destroy: () => realRef.current.destroy()
    };
    return spy;
  }, []);
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: props.canEdit, undo: wrapped });
  registry.current = { doc, selection, real: created, undo: wrapped };
  return (
    <>
      <UndoContext.Provider value={wrapped}>
        <BoardViewport doc={doc} notes={notes} selection={selection} editable={props.canEdit} />
      </UndoContext.Provider>
      <input aria-label="external input" />
    </>
  );
}

function mountHarness(canEdit = true): void {
  registry = { current: null };
  undoCalls = { undo: [], redo: [] };
  render(<ControlsHarness canEdit={canEdit} />);
}

function ctrl(): CtrlRegistry {
  return registry.current!;
}

function runCalls(calls: (() => void)[]): void {
  act(() => {
    for (const call of calls) call();
  });
}

function seedUndoableChange(): void {
  act(() => {
    makeSticky(ctrl().doc, 0, 0);
  });
}

describe('undo controls (undo.controls)', () => {
  afterEach(() => {
    cleanup();
  });

  test('TC-18: on an empty history both buttons are disabled', () => {
    mountHarness();
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
    expect(undoBtn.getAttribute('aria-disabled')).toBe('true');
    expect(redoBtn.getAttribute('aria-disabled')).toBe('true');
  });

  test('TC-19: every documented shortcut calls the controller and is preventDefaulted', () => {
    mountHarness();
    seedUndoableChange();
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect((undoBtn as HTMLButtonElement).disabled).toBe(false);
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);

    const shortcuts: [string, 'undo' | 'redo'][] = [
      ['Ctrl+Z', 'undo'],
      ['Cmd+Z', 'undo'],
      ['Ctrl+Shift+Z', 'redo'],
      ['Cmd+Shift+Z', 'redo'],
      ['Ctrl+Y', 'redo']
    ];
    for (const [name, kind] of shortcuts) {
      const before = undoCalls[kind].length;
      const shift = name.includes('Shift');
      const init: KeyboardEventInit = name.startsWith('Cmd')
        ? { key: name.endsWith('Y') ? 'y' : 'z', metaKey: true, shiftKey: shift }
        : name === 'Ctrl+Y'
          ? { key: 'y', ctrlKey: true }
          : { key: 'z', ctrlKey: true, shiftKey: shift };
      // fireEvent returns false only when preventDefault was called.
      const prevented = !fireEvent.keyDown(window, init);
      expect(prevented, `${name} prevented`).toBe(true);
      expect(undoCalls[kind].length, `${name} reached controller`).toBe(before + 1);
      runCalls(undoCalls[kind].splice(0));
    }
    // Net effect of one effective undo and one effective redo: the note is
    // back, the undo step is available again and redo is not.
    expect(snapshot(ctrl().doc).length).toBe(1);
    expect((undoBtn as HTMLButtonElement).disabled).toBe(false);
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);

    // Clicking the buttons drives the controller too.
    fireEvent.click(undoBtn);
    runCalls(undoCalls.undo.splice(0));
    expect(snapshot(ctrl().doc).length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    runCalls(undoCalls.redo.splice(0));
    expect(snapshot(ctrl().doc).length).toBe(1);
  });

  test('TC-20: on a load-failed (read-only) board shortcuts are ignored and buttons stay disabled', () => {
    mountHarness(false);
    seedUndoableChange();
    expect(ctrl().real.canUndo()).toBe(true);
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    const redoBtn = screen.getByRole('button', { name: 'Redo' });
    expect((undoBtn as HTMLButtonElement).disabled).toBe(true);
    expect((redoBtn as HTMLButtonElement).disabled).toBe(true);
    // The shortcut is not handled at all: not prevented, controller untouched.
    const prevented = !fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(prevented).toBe(false);
    expect(undoCalls.undo.length).toBe(0);
    expect(snapshot(ctrl().doc).length).toBe(1);
  });

  test('TC-21: Ctrl+Z focused in an ordinary input never reaches the controller', () => {
    mountHarness();
    seedUndoableChange();
    const input = screen.getByLabelText('external input') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'hello' } });
    const prevented = !fireEvent.keyDown(input, { key: 'z', ctrlKey: true });
    expect(prevented).toBe(false);
    expect(undoCalls.undo.length).toBe(0);
    expect(snapshot(ctrl().doc).length).toBe(1);
  });
});
