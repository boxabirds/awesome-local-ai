// Story 8 test harness for undo.controls (TC-18 to TC-21): a FAKE
// UndoController wired through the real useUndo hook, the real UndoButtons
// (in the real Toolbar) and the real useBoardKeys key handler. The fake
// records every call so the tests can assert exactly what the shortcuts and
// buttons invoke, without a real Y.Doc or stack.

import { useEffect, useMemo, type JSX } from 'react';
import * as Y from 'yjs';
import { useUndo } from '../../src/client/board/useUndo';
import { UndoButtons } from '../../src/client/board/UndoButtons';
import { Toolbar } from '../../src/client/board/Toolbar';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { SharePanel } from '../../src/client/share/SharePanel';
import type { SelectionApi } from '../../src/client/board/useSelection';
import type { UndoController } from '../../src/client/board/undo';

/** A controllable fake of the UndoController contract. */
export interface FakeUndo {
  controller: UndoController;
  /** How many times each method was invoked. */
  calls: { undo: number; redo: number; boundary: number };
  /** Set both stack depths (and notify subscribers). */
  setSteps(undo: number, redo: number): void;
  /** Current depths, for assertions. */
  depths: { undo: number; redo: number };
}

export function createFakeUndo(): FakeUndo {
  let undoDepth = 0;
  let redoDepth = 0;
  const calls = { undo: 0, redo: 0, boundary: 0 };
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };
  const controller: UndoController = {
    undo: () => {
      calls.undo += 1;
      if (undoDepth === 0) return false;
      undoDepth -= 1;
      redoDepth += 1;
      notify();
      return true;
    },
    redo: () => {
      calls.redo += 1;
      if (redoDepth === 0) return false;
      redoDepth -= 1;
      undoDepth += 1;
      notify();
      return true;
    },
    canUndo: () => undoDepth > 0,
    canRedo: () => redoDepth > 0,
    boundary: () => {
      calls.boundary += 1;
    },
    addScope: () => {},
    onChange: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    destroy: () => listeners.clear(),
  };
  return {
    controller,
    calls,
    depths: { get undo() { return undoDepth; }, get redo() { return redoDepth; } },
    setSteps(undo: number, redo: number): void {
      undoDepth = undo;
      redoDepth = redo;
      notify();
    },
  };
}

const emptySelection: SelectionApi = {
  ids: new Set<string>(),
  editingId: null,
  click: () => {},
  toggle: () => {},
  setMany: () => {},
  selectOnly: () => {},
  clear: () => {},
  startEdit: () => {},
  endEdit: () => {},
};

export function UndoHarness(props: { fake: FakeUndo; canEdit: boolean }): JSX.Element {
  const doc = useMemo(() => new Y.Doc(), []);
  useEffect(() => () => doc.destroy(), [doc]);
  const api = useUndo(props.fake.controller, props.canEdit);
  useBoardKeys({
    doc,
    selection: emptySelection,
    snapshot: [],
    canEdit: props.canEdit,
    undo: props.fake.controller,
  });
  return (
    <div>
      <Toolbar
        tool="select"
        shapeKind="rect"
        onSelectTool={() => undefined}
        onSelectShapeKind={() => undefined}
        onCreateSticky={() => {}}
        disabled={!props.canEdit}
        extra={<UndoButtons undo={api} />}
      />
      <SharePanel boardId="harness" />
    </div>
  );
}
