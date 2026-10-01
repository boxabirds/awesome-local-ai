import { useEffect, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObjects } from '../shared/board-model';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { BoardViewport } from './canvas/BoardViewport';
import type { Camera } from './canvas/camera';
import { setTestConnectionState } from './canvas/testHooks';
import { getObjectType } from './objects/registry';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';

/** Editing is blocked only while a saved board cannot be loaded (it must not look like an empty board). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function App({ doc: externalDoc, boardId }: { doc?: Y.Doc; boardId?: string }) {
  const { doc, notes: objects, connection } = useBoardDoc(externalDoc, boardId);
  useEffect(() => setTestConnectionState(connection), [connection]);
  const sel = useSelection(objects);
  const editable = canEdit(connection);

  // The camera lives in BoardViewport; the gesture reads it live through this view of the latest value.
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const liveCamera = useMemo<Camera>(
    () => ({
      get x() {
        return cameraRef.current.x;
      },
      get y() {
        return cameraRef.current.y;
      },
      get zoom() {
        return cameraRef.current.zoom;
      },
    }),
    [],
  );
  const gesture = useTransformGesture({ doc, camera: liveCamera, selection: sel, snapshot: objects, canEdit: editable });

  useBoardKeys({ doc, selection: sel, snapshot: objects, canEdit: editable });

  const deleteSelection = () => {
    if (!editable) return;
    deleteObjects(doc, [...sel.ids]);
    sel.clear();
  };

  const create = (at: { x: number; y: number }) => {
    if (!editable) return;
    const id = createSticky(doc, at);
    if (id) sel.startEdit(id);
  };

  return (
    <>
    {boardId && <ConnectionStatus state={connection} />}
    <BoardViewport
      onDoubleClickEmpty={create}
      onClickEmpty={sel.clear}
      snapshot={objects}
      onMarqueeSelect={(ids) => sel.setMany(ids, true)}
      overlay={(ctx) => {
        cameraRef.current = ctx.camera;
        return (
          <>
            <Toolbar disabled={!editable} onCreateSticky={() => create(ctx.viewCentre)} />
            <SelectionOverlay
              ids={sel.ids}
              snapshot={objects}
              camera={ctx.camera}
              editable={editable}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
            <SelectionBar
              ids={sel.ids}
              snapshot={objects}
              camera={ctx.camera}
              doc={doc}
              editable={editable}
              hidden={gesture.active || sel.editingId !== null}
              onDelete={deleteSelection}
            />
          </>
        );
      }}
    >
      {(ctx) => {
        cameraRef.current = ctx.camera;
        return [...objects]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((object) => {
            const Component = getObjectType(object.type)?.Component;
            if (!Component) return null;
            return (
              <Component
                key={object.id}
                object={object}
                doc={doc}
                editable={editable}
                zoom={ctx.camera.zoom}
                selected={sel.ids.has(object.id)}
                editing={editable && sel.editingId === object.id}
                onObjectPointerDown={gesture.onObjectPointerDown}
                onStartEdit={sel.startEdit}
                onEndEdit={sel.endEdit}
              />
            );
          });
      }}
    </BoardViewport>
    </>
  );
}
