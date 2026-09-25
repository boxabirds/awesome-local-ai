import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, type Camera, type Point } from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { createUndo, NO_UNDO, type UndoController } from './board/undo';
import { asStep, UndoContext, useUndo } from './board/useUndo';
import { getObjectType, type ObjectGesturePhase } from './objects/registry';
import { createSticky, deleteObjects, snapshot } from '../shared/board-model';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** Whether the board may be edited: not while its saved state cannot be loaded (never over an empty stand-in). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/** Routes `/` to the home page, `/b/:boardId` to that board (or Board not found), anything else to not found. */
export function Root() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}

/**
 * One board. With `boardId` it is live-synced with everyone else on that board.
 * `doc` lets tests supply their own document; the app creates one.
 */
export function App(props: { boardId?: string; doc?: Y.Doc } = {}) {
  const { doc, objects, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection(objects);
  const { startEdit, endEdit, clear, click, setMany } = selection;
  const editable = canEdit(connection);
  const editingId = editable ? selection.editingId : null;
  // The camera lives in BoardViewport; the gesture reads the one last rendered, at event time.
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

  // Objects are drawn in a stable DOM order (by id) and stacked with z-index from their (z, id) rank.
  // Re-ordering DOM nodes instead would make browsers drop pointer capture when a dragged object comes to the front.
  const stacked = useMemo(() => {
    const rank = new Map(objects.map((o, i) => [o.id, i + 1]));
    const byId = [...objects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return byId.map((object) => ({ object, stackIndex: rank.get(object.id)! }));
  }, [objects]);

  useEffect(() => {
    if (!editable && selection.editingId !== null) endEdit('selected');
  }, [editable, selection.editingId, endEdit]);

  // One undo history per board doc in this tab, memory only: gone on reload or board change (undo.session_only).
  const [undoController, setUndoController] = useState<UndoController>(NO_UNDO);
  useEffect(() => {
    const controller = createUndo(doc);
    setUndoController(controller);
    return () => {
      controller.destroy();
      setUndoController(NO_UNDO);
    };
  }, [doc]);
  const undoRef = useRef(undoController);
  undoRef.current = undoController;
  const undo = useUndo(undoController, editable);

  const gesture = useTransformGesture({
    doc,
    camera: liveCamera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // A whole drag or resize is one undo step, however long it lasts (undo.steps).
    onGestureStart: () => undoRef.current.beginStep(),
    onGestureEnd: () => undoRef.current.boundary(),
  });
  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: { undo: undo.undo, redo: undo.redo, controller: undoController },
  });

  const editableRef = useRef(editable);
  editableRef.current = editable;
  const createAt = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      const id = asStep(undoRef.current, () => createSticky(doc, world));
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  const deleteSelection = useCallback(() => {
    if (!editableRef.current) return;
    const ids = [...selection.ids];
    asStep(undoRef.current, () => deleteObjects(doc, ids));
    clear();
  }, [doc, selection.ids, clear]);

  const marquee = useMemo(
    () => ({ snapshot: objects, onSelect: (ids: string[]) => setMany(ids, true) }),
    [objects, setMany],
  );

  useEffect(() => installTestHooks({ notes: () => snapshot(doc) }), [doc]);
  useEffect(() => installTestHooks({ connectionState: connection }), [connection]);
  useEffect(() => installTestHooks({ selection: () => [...selection.ids].sort() }), [selection.ids]);

  const moving = gesture.state.mode === 'moving' || gesture.state.mode === 'resizing';
  const phaseOf = (id: string, selected: boolean): ObjectGesturePhase => {
    const { mode, pressedId } = gesture.state;
    if (mode === 'moving' && selected) return 'dragging';
    if (mode === 'pressed' && pressedId === id) return 'pressed';
    return 'idle';
  };

  return (
    <UndoContext.Provider value={undoController}>
      <BoardViewport
        onDoubleClickEmpty={createAt}
        onEmptyClick={clear}
        marquee={marquee}
        overlay={({ camera, size }) => (
          <>
            <SelectionOverlay
              ids={editingId !== null ? new Set<string>() : selection.ids}
              snapshot={objects}
              camera={camera}
              resizable={editable && gesture.state.mode !== 'moving'}
              onHandlePointerDown={gesture.onHandlePointerDown}
            />
            <Toolbar
              disabled={!editable}
              undo={undo}
              onCreateSticky={() => createAt(screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }))}
            />
            <ConnectionStatus state={connection} />
          </>
        )}
      >
        {({ camera }) => {
          cameraRef.current = camera;
          return (
            <>
              {stacked.map(({ object, stackIndex }) => {
                const spec = getObjectType(object.type);
                if (!spec) return null;
                const selected = selection.ids.has(object.id);
                return (
                  <spec.Component
                    key={object.id}
                    object={object}
                    stackIndex={stackIndex}
                    doc={doc}
                    zoom={camera.zoom}
                    selected={selected}
                    editing={object.id === editingId}
                    editable={editable}
                    gesture={phaseOf(object.id, selected)}
                    onObjectPointerDown={gesture.onObjectPointerDown}
                    onSelect={click}
                    onStartEdit={startEdit}
                    onEndEdit={endEdit}
                  />
                );
              })}
              <SelectionBar
                ids={selection.ids}
                snapshot={objects}
                doc={doc}
                zoom={camera.zoom}
                editable={editable}
                hidden={editingId !== null || moving}
                onDelete={deleteSelection}
              />
            </>
          );
        }}
      </BoardViewport>
    </UndoContext.Provider>
  );
}
