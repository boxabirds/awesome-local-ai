import { useCallback, useEffect, useRef, useState } from 'react';
import { createSticky, deleteObjects, setStickyColor } from '../shared/board-model';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { type UndoController, createUndo } from './board/undo';
import { UndoContext, useUndo } from './board/useUndo';
import { BoardViewport } from './canvas/BoardViewport';
import { type Camera, type Point, screenToWorld } from './canvas/camera';
import { getObjectType } from './objects/registry';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import type * as Y from 'yjs';

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** The app: Home (`/`), a board (`/b/:id`) or Board not found (anything else). */
export function Root() {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}

/**
 * Whether the board may be changed. Only a board that could not be loaded is locked: its
 * saved content is unknown, so it must not be presented as an empty editable board.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The board (stories 1–4). `boardId` connects the board to its live room; without it (component tests) the board is
 * local only. `doc` lets tests supply the board document; the app creates its own.
 */
export function App(props: { boardId?: string; doc?: Y.Doc }) {
  const { doc, objects, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection(objects);
  const { startEdit, endEdit, click, setMany, clear } = selection;
  const editable = canEdit(connection);
  const cameraRef = useRef<Camera | null>(null);
  const getCamera = useCallback(() => cameraRef.current ?? INITIAL_CAMERA, []);

  // One undo history per board document, for this tab only: gone on board change or reload.
  const [history, setHistory] = useState<UndoController | null>(null);
  useEffect(() => {
    const controller = createUndo(doc);
    setHistory(controller);
    return () => {
      controller.destroy();
      setHistory(null);
    };
  }, [doc]);
  const undo = useUndo(history, editable);
  const boundary = useCallback(() => history?.boundary(), [history]);
  /** Runs one user action as its own undo step. */
  const step = <T,>(fn: () => T): T => {
    boundary();
    try {
      return fn();
    } finally {
      boundary();
    }
  };

  // Objects of a registered type are shown; others (from newer clients) are left alone.
  const shown = objects.filter((o) => getObjectType(o.type) !== undefined);
  // Nothing is edited while the board is locked.
  const editingId = editable ? selection.editingId : null;

  const transform = useTransformGesture({
    doc,
    camera: getCamera,
    selection,
    snapshot: shown,
    canEdit: editable,
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });
  useBoardKeys({ doc, selection, snapshot: shown, canEdit: editable, undo: history });

  const deleteSelection = () => {
    if (!editable) return;
    step(() => deleteObjects(doc, [...selection.ids]));
    clear();
  };

  // Stacking follows (z, id) via CSS; DOM order is creation order so a drag never moves the node.
  const layers = new Map(shown.map((o, i) => [o.id, i + 1]));
  const domOrder = [...shown].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const createAt = (world: Point) => {
    if (!editable) return;
    const id = step(() => createSticky(doc, world));
    if (id) startEdit(id);
  };

  return (
    <UndoContext.Provider value={history}>
      <BoardViewport
        cameraRef={cameraRef}
        onEmptyDoubleClick={createAt}
        onEmptyClick={clear}
        marquee={{ snapshot: shown, onSelect: (ids) => setMany(ids, true) }}
        overlay={({ camera, viewport }) => (
          <>
            <div className="selection-layer">
              <SelectionOverlay
                ids={selection.ids}
                snapshot={shown}
                camera={camera}
                interactive={editable && editingId === null}
                onHandlePointerDown={transform.onHandlePointerDown}
              />
              <SelectionBar
                ids={selection.ids}
                snapshot={shown}
                camera={camera}
                editable={editable}
                hidden={transform.gesture !== null || editingId !== null}
                onDelete={deleteSelection}
                onColor={(id, color) => {
                  if (editable) step(() => setStickyColor(doc, id, color));
                }}
              />
            </div>
            <Toolbar
              disabled={!editable}
              undo={undo}
              onCreateSticky={() =>
                createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }))
              }
            />
          </>
        )}
      >
        {({ camera }) =>
          domOrder.map((obj) => {
            const { Component } = getObjectType(obj.type)!;
            return (
              <Component
                key={obj.id}
                layer={layers.get(obj.id)}
                object={obj}
                doc={doc}
                zoom={camera.zoom}
                selected={selection.ids.has(obj.id)}
                editing={obj.id === editingId}
                editable={editable}
                transforming={transform.gesture !== null}
                onPointerDown={transform.onObjectPointerDown}
                onSelect={click}
                onStartEdit={startEdit}
                onEndEdit={endEdit}
              />
            );
          })
        }
      </BoardViewport>
      {props.boardId && <ConnectionStatus state={connection} />}
    </UndoContext.Provider>
  );
}
