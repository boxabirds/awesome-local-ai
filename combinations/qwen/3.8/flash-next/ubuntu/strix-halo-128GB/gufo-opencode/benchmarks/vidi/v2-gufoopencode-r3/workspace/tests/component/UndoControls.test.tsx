import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { Toolbar } from '../../src/client/board/Toolbar';
import { createUndo } from '../../src/client/board/undo';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import type { SelectionController } from '../../src/client/board/useSelection';
import type { UndoController } from '../../src/client/board/undo';
import { useUndo } from '../../src/client/board/useUndo';
import { SharePanel } from '../../src/client/share/SharePanel';

const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

const selection: SelectionController = {
  ids: new Set<string>(),
  editingId: null,
  click: vi.fn(),
  toggle: vi.fn(),
  setMany: vi.fn(),
  clear: vi.fn(),
  selectNew: vi.fn(),
  startEdit: vi.fn(),
  endEdit: vi.fn()
};

// A controller whose only job is to record what the shortcuts asked for.
function fakeUndo(available = true): UndoController {
  return {
    undo: vi.fn(() => available),
    redo: vi.fn(() => available),
    boundary: vi.fn(),
    canUndo: () => available,
    canRedo: () => available,
    addScope: vi.fn(),
    onChange: () => () => undefined,
    destroy: vi.fn()
  };
}

function Harness({ undo, canEdit }: { undo: UndoController; canEdit: boolean }): null {
  useBoardKeys({ doc: new Y.Doc(), objects: [], selection, canEdit, undo });
  return null;
}

function BindController({ controller }: { controller: UndoController }) {
  return (
    <Toolbar
      onCreateSticky={() => undefined}
      tool="select"
      onSelectTool={() => undefined}
      shapeKind="rect"
      onSelectShapeKind={() => undefined}
      undo={useUndo(controller, true)}
    />
  );
}

function undoButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Undo' });
}

function redoButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Redo' });
}

function mountBoard(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

function addNote(doc: Y.Doc): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 0, y: 0 });
  });
  return id;
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('undo.controls (buttons)', () => {
  it('TC-18 empty stacks render both buttons disabled', () => {
    render(
      <Toolbar
        onCreateSticky={() => undefined}
        tool="select"
        onSelectTool={() => undefined}
                shapeKind="rect"
                onSelectShapeKind={() => undefined}
        undo={{ canUndo: false, canRedo: false, undo: vi.fn(), redo: vi.fn() }}
      />
    );
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    expect(undoButton()).toHaveAttribute('aria-disabled', 'true');
    expect(redoButton()).toHaveAttribute('aria-disabled', 'true');
  });

  it('TC-18 a step in each stack enables them, tooltips name the shortcuts, clicks act', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(
      <Toolbar
        onCreateSticky={() => undefined}
        tool="select"
        onSelectTool={() => undefined}
                shapeKind="rect"
                onSelectShapeKind={() => undefined}
        undo={{ canUndo: true, canRedo: true, undo, redo }}
      />
    );
    expect(undoButton()).toBeEnabled();
    expect(redoButton()).toBeEnabled();
    expect(undoButton()).toHaveAttribute('title', 'Undo (Ctrl/Cmd+Z)');
    expect(redoButton()).toHaveAttribute('title', 'Redo (Ctrl/Cmd+Shift+Z)');
    fireEvent.click(undoButton());
    fireEvent.click(redoButton());
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('TC-18 the buttons track the controller stacks', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const controller = createUndo(doc);
    render(<BindController controller={controller} />);
    expect(undoButton()).toBeDisabled();
    addNote(doc);
    expect(undoButton()).toBeEnabled();
    fireEvent.click(undoButton());
    expect(snapshot(doc)).toHaveLength(0);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeEnabled();
    controller.destroy();
  });
});

describe('undo.controls (shortcuts)', () => {
  it('TC-19 the five shortcut forms reach the controller, each default-prevented', () => {
    const undo = fakeUndo();
    render(<Harness undo={undo} canEdit />);
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true })).toBe(false);
    expect(undo.undo).toHaveBeenCalledTimes(2);
    expect(fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })).toBe(
      false
    );
    expect(fireEvent.keyDown(document.body, { key: 'Z', metaKey: true, shiftKey: true })).toBe(
      false
    );
    expect(fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })).toBe(false);
    expect(undo.redo).toHaveBeenCalledTimes(3);
  });

  it('TC-19 an empty stack leaves the browser default alone', () => {
    const undo = fakeUndo(false);
    render(<Harness undo={undo} canEdit />);
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })).toBe(true);
    expect(undo.undo).not.toHaveBeenCalled();
    expect(undo.redo).not.toHaveBeenCalled();
  });

  it('TC-20 a load-failed board ignores the shortcuts (negative)', () => {
    const undo = fakeUndo();
    render(<Harness undo={undo} canEdit={false} />);
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(
      true
    );
    expect(fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })).toBe(true);
    expect(undo.undo).not.toHaveBeenCalled();
    expect(undo.redo).not.toHaveBeenCalled();
  });

  it('TC-20 a load-failed board keeps its steps un-undoable and its buttons disabled', () => {
    holder.status = 'load_failed';
    const doc = mountBoard();
    addNote(doc);
    expect(undoButton()).toBeDisabled();
    expect(redoButton()).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-21 Ctrl+Z focused in the share link input is not hijacked (negative)', () => {
    const doc = mountBoard();
    const id = addNote(doc);
    render(<SharePanel boardId={newBoardId()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const input = screen.getByRole('textbox');
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true);
    expect(snapshot(doc).map((n) => n.id)).toEqual([id]);
  });
});
