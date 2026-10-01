import { useState } from 'react';
import { UndoContext, useUndo, useUndoHistory } from './board/useUndo';
import { createSticky, deleteObjects, setStickyColor } from '../shared/board-model';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import type { Camera, Point } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { getObjectType } from './objects/registry';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** Editing is blocked only while the saved board cannot be loaded (never present it as an empty editable board). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function App({ boardId }: { boardId?: string } = {}) {
  const { doc, objects, connection } = useBoardDoc(boardId);
  const sel = useSelection(objects);
  const [gesturing, setGesturing] = useState(false);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);

  const editable = canEdit(connection);
  const history = useUndoHistory(doc);
  const undo = useUndo(history, editable);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    onGestureStart: () => {
      history.boundary();
      setGesturing(true);
    },
    onGestureEnd: () => {
      history.boundary();
      setGesturing(false);
    },
  });
  useBoardKeys({ doc, selection: sel, snapshot: objects, canEdit: editable, undo: history });

  const create = (at: Point) => {
    if (!editable) return;
    history.boundary();
    const id = createSticky(doc, at);
    history.boundary();
    if (id) sel.startEdit(id);
  };

  const deleteSelection = () => {
    history.boundary();
    deleteObjects(doc, [...sel.ids]);
    history.boundary();
    sel.clear();
  };

  return (
    <UndoContext.Provider value={history}>
    <BoardViewport
      onCreateAt={create}
      onEmptyClick={sel.clear}
      snapshot={objects}
      onMarqueeSelect={(ids) => sel.setMany(ids, true)}
      onCameraChange={setCamera}
      overlay={(ctx) => (
        <>
          <ConnectionStatus state={connection} />
          <Toolbar onCreateSticky={() => create(ctx.centerWorld())} disabled={!editable} undo={undo} />
          {sel.editingId === null && (
            <SelectionOverlay
              ids={sel.ids}
              snapshot={objects}
              camera={ctx.camera}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
          )}
          {editable && sel.editingId === null && !gesturing && (
            <SelectionBar
              ids={sel.ids}
              snapshot={objects}
              camera={ctx.camera}
              onDelete={deleteSelection}
              onColor={(id, color) => {
                history.boundary();
                setStickyColor(doc, id, color);
                history.boundary();
              }}
            />
          )}
        </>
      )}
    >
      {(ctx) =>
        // DOM order is stable (by id) and stacking uses z-index: re-ordering nodes mid-drag would drop pointer capture.
        [...objects].sort(byId).map((object) => {
          const spec = getObjectType(object.type);
          if (!spec) return null;
          return (
            <spec.Component
              key={object.id}
              object={object}
              doc={doc}
              zoom={ctx.zoom}
              selected={sel.ids.has(object.id)}
              editing={sel.editingId === object.id}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
              readOnly={!editable}
            />
          );
        })
      }
    </BoardViewport>
    </UndoContext.Provider>
  );
}
