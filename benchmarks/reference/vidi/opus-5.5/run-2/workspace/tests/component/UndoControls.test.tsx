/**
 * Story 8 component tests (TC-18 to TC-21, undo.controls): shortcuts and toolbar buttons
 * against a fake UndoController, plus the edit lock on the real App (story 4 load failure).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { Toolbar } from '../../src/client/board/Toolbar';
import { REDO_TOOLTIP, UNDO_TOOLTIP } from '../../src/client/board/UndoButtons';
import type { UndoController } from '../../src/client/board/undo';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { useUndo } from '../../src/client/board/useUndo';
import { SharePanel } from '../../src/client/share/SharePanel';
import { createSticky, deleteObjects, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { fakeProviders } from './fakeProvider';

interface FakeController extends UndoController {
  undoCalls: number;
  redoCalls: number;
  set(state: { canUndo: boolean; canRedo: boolean }): void;
}

function fakeController(initial = { canUndo: false, canRedo: false }): FakeController {
  let state = initial;
  const listeners = new Set<() => void>();
  const fake: FakeController = {
    undoCalls: 0,
    redoCalls: 0,
    set(next) {
      state = next;
      act(() => listeners.forEach((l) => l()));
    },
    undo() {
      fake.undoCalls += 1;
      return state.canUndo;
    },
    redo() {
      fake.redoCalls += 1;
      return state.canRedo;
    },
    boundary: () => undefined,
    startGroup: () => undefined,
    undoIn: () => false,
    redoIn: () => false,
    undoSize: () => 0,
    amendLast: (fn: () => void) => fn(),
    canUndo: () => state.canUndo,
    canRedo: () => state.canRedo,
    addScope: () => undefined,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy: () => undefined,
  };
  return fake;
}

const NO_OBJECTS: readonly ObjectSnapshot[] = [];

/** The board's keyboard handling, left toolbar and share panel around a fake controller. */
function Harness(props: { controller: UndoController; canEdit: boolean }): React.JSX.Element {
  const doc = useState(() => new Y.Doc())[0];
  const selection = useSelection(NO_OBJECTS);
  const api = useUndo(props.controller, props.canEdit);
  useBoardKeys({
    doc,
    selection,
    snapshot: NO_OBJECTS,
    canEdit: props.canEdit,
    history: { undo: api.undo, redo: api.redo, boundary: props.controller.boundary },
  });
  return (
    <>
      <Toolbar onCreateSticky={() => undefined} disabled={!props.canEdit} undo={api} />
      <SharePanel boardId="abcdefghijklmnopqrstuv" />
    </>
  );
}

function undoButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Undo' });
}
function redoButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Redo' });
}

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

describe('Undo and Redo buttons (undo.buttons)', () => {
  it('TC-18 both buttons are disabled while the history is empty', () => {
    render(<Harness controller={fakeController()} canEdit />);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(undoButton()).toHaveAttribute('title', UNDO_TOOLTIP);
    expect(redoButton()).toHaveAttribute('title', REDO_TOOLTIP);
    // Exposed as disabled to assistive technology.
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
  });

  it('buttons follow the history and call the controller', () => {
    const c = fakeController();
    render(<Harness controller={c} canEdit />);
    c.set({ canUndo: true, canRedo: false });
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeDisabled();
    fireEvent.click(undoButton());
    expect(c.undoCalls).toBe(1);
    c.set({ canUndo: false, canRedo: true });
    expect(undoButton()).toBeDisabled();
    fireEvent.click(redoButton());
    expect(c.redoCalls).toBe(1);
  });
});

describe('Undo shortcuts (undo.shortcuts)', () => {
  it('TC-19 Ctrl+Z and Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo, each without the browser default', () => {
    const c = fakeController({ canUndo: true, canRedo: true });
    render(<Harness controller={c} canEdit />);
    const cases: [KeyboardEventInit, 'undo' | 'redo'][] = [
      [{ key: 'z', ctrlKey: true }, 'undo'],
      [{ key: 'z', metaKey: true }, 'undo'],
      [{ key: 'Z', ctrlKey: true, shiftKey: true }, 'redo'],
      [{ key: 'Z', metaKey: true, shiftKey: true }, 'redo'],
      [{ key: 'y', ctrlKey: true }, 'redo'],
    ];
    for (const [init, expected] of cases) {
      const before = { undo: c.undoCalls, redo: c.redoCalls };
      const e = press(init);
      expect(e.defaultPrevented).toBe(true);
      expect(c.undoCalls - before.undo).toBe(expected === 'undo' ? 1 : 0);
      expect(c.redoCalls - before.redo).toBe(expected === 'redo' ? 1 : 0);
    }
    // Plain Z and Cmd+Y are not shortcuts.
    press({ key: 'z' });
    press({ key: 'y', metaKey: true });
    expect(c.undoCalls).toBe(2);
    expect(c.redoCalls).toBe(3);
  });

  it('TC-20 with the board locked (load failed) shortcuts are ignored and the buttons disabled', () => {
    const c = fakeController({ canUndo: true, canRedo: true });
    render(<Harness controller={c} canEdit={false} />);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    const e = press({ key: 'z', ctrlKey: true });
    press({ key: 'Z', ctrlKey: true, shiftKey: true });
    press({ key: 'y', ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(c.undoCalls).toBe(0);
    expect(c.redoCalls).toBe(0);
  });

  it('TC-21 Ctrl+Z in the share link field is left to the browser', () => {
    const c = fakeController({ canUndo: true, canRedo: true });
    render(<Harness controller={c} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const field = screen.getByRole('textbox', { name: 'Board link' });
    const e = press({ key: 'z', ctrlKey: true }, field);
    press({ key: 'y', ctrlKey: true }, field);
    expect(e.defaultPrevented).toBe(false);
    expect(c.undoCalls).toBe(0);
    expect(c.redoCalls).toBe(0);
  });
});

describe('Undo on a board that failed to load (undo.not_editable)', () => {
  const fakes = fakeProviders();
  beforeEach(() => {
    fakes.reset();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  });
  afterEach(() => vi.useRealTimers());

  it('TC-20 the real board disables undo while locked and re-enables it after recovery', () => {
    const doc = new Y.Doc();
    render(<App boardId={newBoardId()} doc={doc} createProvider={fakes.createProvider} />);
    fakes.provider().open();
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note text' }), { key: 'Escape' });
    expect(snapshot(doc)).toHaveLength(1);
    expect(undoButton()).toBeEnabled();

    fakes.provider().drop(CLOSE_BOARD_LOAD_FAILED);
    expect(undoButton()).toBeDisabled();
    press({ key: 'z', ctrlKey: true });
    expect(snapshot(doc)).toHaveLength(1);

    fakes.provider().open();
    expect(undoButton()).toBeEnabled();
    press({ key: 'z', ctrlKey: true });
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('changes made by others are never undoable', () => {
    const doc = new Y.Doc();
    render(<App boardId={newBoardId()} doc={doc} createProvider={fakes.createProvider} />);
    fakes.provider().open();
    const remote = Symbol('remote');
    act(() => {
      const other = new Y.Doc();
      const id = createSticky(other, { x: 0, y: 0 });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), remote);
      deleteObjects(other, [id]);
    });
    expect(snapshot(doc)).toHaveLength(1);
    expect(undoButton()).toBeDisabled();
  });
});
