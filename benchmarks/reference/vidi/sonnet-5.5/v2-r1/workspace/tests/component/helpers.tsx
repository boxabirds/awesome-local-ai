import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type * as Y from 'yjs';
import { createSticky, deleteObjects, getStickyText } from '../../src/shared/board-model';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { UndoContext, useUndoHistory } from '../../src/client/board/useUndo';
import type { UndoController } from '../../src/client/board/undo';
import { getObjectType } from '../../src/client/objects/registry';

export const FRAME_MS = 20;

export function flush() {
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}

export const viewport = () => screen.getByTestId('board-viewport');
export const notes = () => screen.queryAllByRole('group', { name: 'Sticky note' });

/** Mirrors the App wiring for one board, exposing the real Y.Doc and selection state to the test. */
export interface Probe {
  doc: Y.Doc;
  /** The selected id when exactly one object is selected. */
  selectedId: string | null;
  ids: ReadonlySet<string>;
  editingId: string | null;
  gestureStarts: number;
  gestureEnds: number;
  undo: UndoController;
}

export function Harness(props: { probe: Probe; zoom?: number; canEdit?: boolean }) {
  const { doc, objects } = useBoardDoc();
  const sel = useSelection(objects);
  const history = useUndoHistory(doc);
  const camera = { x: 0, y: 0, zoom: props.zoom ?? 1 };
  const gesture = useTransformGesture({
    doc,
    camera,
    selection: sel,
    snapshot: objects,
    canEdit: props.canEdit ?? true,
    onGestureStart: () => {
      history.boundary();
      props.probe.gestureStarts++;
    },
    onGestureEnd: () => {
      history.boundary();
      props.probe.gestureEnds++;
    },
  });
  useBoardKeys({ doc, selection: sel, snapshot: objects, canEdit: props.canEdit ?? true, undo: history });
  props.probe.undo = history;
  props.probe.doc = doc;
  props.probe.ids = sel.ids;
  props.probe.selectedId = sel.ids.size === 1 ? [...sel.ids][0] : null;
  props.probe.editingId = sel.editingId;
  return (
    <UndoContext.Provider value={history}>
    <div data-testid="harness" onPointerDown={() => sel.clear()}>
      {objects.map((n) => {
        const spec = getObjectType(n.type);
        if (!spec) return null;
        return (
          <spec.Component
            key={n.id}
            object={n}
            doc={doc}
            zoom={props.zoom ?? 1}
            selected={sel.ids.has(n.id)}
            editing={sel.editingId === n.id}
            onObjectPointerDown={gesture.onObjectPointerDown}
            onStartEdit={sel.startEdit}
            onEndEdit={sel.endEdit}
          />
        );
      })}
      <SelectionOverlay
        ids={sel.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      <SelectionBar ids={sel.ids} snapshot={objects} onDelete={() => { deleteObjects(doc, [...sel.ids]); sel.clear(); }} />
    </div>
    </UndoContext.Provider>
  );
}

export function newProbe(): Probe {
  return {
    doc: undefined as unknown as Y.Doc,
    selectedId: null,
    ids: new Set(),
    editingId: null,
    gestureStarts: 0,
    gestureEnds: 0,
    undo: undefined as unknown as UndoController,
  };
}

export function addNote(probe: Probe, text = '', at = { x: 100, y: 100 }): string {
  let id: string | false = false;
  act(() => {
    id = createSticky(probe.doc, at);
    if (id && text) getStickyText(probe.doc, id)?.insert(0, text);
  });
  if (!id) throw new Error('create failed');
  return id;
}

export function press(el: Element, x = 0, y = 0) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0 });
}
export function moveTo(el: Element, x: number, y: number) {
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 });
}
export function release(el: Element, x = 0, y = 0) {
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}
