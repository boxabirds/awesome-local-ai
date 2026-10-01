import { useEffect, useMemo, useRef } from 'react';
import { createSticky, deleteObjects, setStickyColor } from '../../shared/board-model';
import { SelectionBar } from './SelectionBar';
import { SelectionOverlay } from './SelectionOverlay';
import { Toolbar } from './Toolbar';
import { useBoardDoc } from './useBoardDoc';
import { useBoardKeys } from './useBoardKeys';
import { useSelection } from './useSelection';
import { useTransformGesture } from './useTransformGesture';
import { BoardViewport, type BoardApi } from '../canvas/BoardViewport';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Camera, type Point } from '../canvas/camera';
import { NavigationHint } from '../canvas/NavigationHint';
import { ZoomControls } from '../canvas/ZoomControls';
import { getObjectType } from '../objects/registry';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';

const HALF = 2;

/** Editing is blocked only while the saved board could not be loaded (never present an empty editable board). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}


export function Board({ boardId }: { boardId: string }) {
  const { doc, objects, connection } = useBoardDoc(boardId);
  useEffect(() => {
    if (window.__vidi6) window.__vidi6.connectionState = connection;
  }, [connection]);
  const sel = useSelection(objects);
  const editable = canEdit(connection);

  // The camera lives inside BoardViewport; gestures read it at event time through this live view of it.
  const apiRef = useRef<BoardApi | null>(null);
  const liveCamera = useMemo<Camera>(() => ({
    get x() { return apiRef.current?.getCamera().x ?? 0; },
    get y() { return apiRef.current?.getCamera().y ?? 0; },
    get zoom() { return apiRef.current?.getCamera().zoom ?? 1; },
  }), []);

  const gesture = useTransformGesture({ doc, camera: liveCamera, selection: sel, snapshot: objects, canEdit: editable });
  useBoardKeys({ doc, selection: sel, snapshot: objects, canEdit: editable });

  // Stacking is CSS z-index (z, with id as DOM-order tie-break). The DOM order stays stable so that
  // raising objects never moves an element, which would drop its pointer capture mid-drag.
  const domOrder = useMemo(() => [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [objects]);

  const createAt = (world: Point) => {
    if (!editable) return;
    const id = createSticky(doc, world);
    if (id) sel.startEdit(id);
  };
  const deleteSelection = () => {
    if (!editable) return;
    deleteObjects(doc, [...sel.ids]);
    sel.clear();
  };

  return (
    <BoardViewport
      onDoubleClickEmpty={createAt}
      onEmptyClick={sel.clear}
      objects={objects}
      onMarqueeSelect={(ids) => sel.setMany(ids, true)}
      overlay={(api) => (
        <>
          {sel.editingId === null && (
            <>
              <SelectionOverlay
                ids={sel.ids} snapshot={objects} camera={api.camera}
                canEdit={editable} onHandlePointerDown={gesture.onHandlePointerDown}
              />
              <SelectionBar
                ids={sel.ids} snapshot={objects} camera={api.camera} readOnly={!editable}
                onDelete={deleteSelection}
                onColor={(id, c) => { setStickyColor(doc, id, c); }}
              />
            </>
          )}
          <Toolbar
            disabled={!editable}
            onCreateSticky={() => createAt(
              screenToWorld(api.getCamera(), { x: api.size.width / HALF, y: api.size.height / HALF }),
            )}
          />
          <ConnectionStatus state={connection} />
          <NavigationHint visible={!api.hasNavigated} />
          <ZoomControls
            zoomPercent={zoomPercent(api.camera)}
            canZoomIn={canZoomIn(api.camera)}
            canZoomOut={canZoomOut(api.camera)}
            onZoomIn={() => api.zoomStep('in')}
            onZoomOut={() => api.zoomStep('out')}
            onReset={api.reset}
          />
        </>
      )}
    >
      {(api) => {
        apiRef.current = api;
        return domOrder.map((object) => {
          const spec = getObjectType(object.type);
          if (!spec) return null;
          const { Component } = spec;
          return (
            <Component
              key={object.id}
              object={object}
              doc={doc}
              zoom={api.camera.zoom}
              selected={sel.ids.has(object.id)}
              editing={editable && sel.editingId === object.id}
              dragging={gesture.activeIds.has(object.id)}
              readOnly={!editable}
              onPointerDown={gesture.onObjectPointerDown}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
            />
          );
        });
      }}
    </BoardViewport>
  );
}
