import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, type Camera, type Point, type Size } from './canvas/camera';
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
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { BoardContext, type BoardContextValue } from './board/BoardContext';
import { useImageInsert } from './images/useImageInsert';
import { ImageContext, type ImageContextValue } from './images/ImageContext';
import { DropHighlight } from './images/DropHighlight';
import { tabUploaderId } from './images/uploaderId';
import { useClock } from './objects/ImageObject';
import { Toast } from './ui/Toast';
import { IMAGE_STATUS_TICK_MS } from '../shared/config';
import { isImage } from '../shared/objects/image';
import { createSticky, deleteObjects, objectSnapshot, snapshot } from '../shared/board-model';
import { createText } from '../shared/objects/text';
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

/**
 * Author recorded on new text objects (`createdBy`). There is no identity in this build (story 6 is not part of
 * it), so every object is created by the same anonymous author.
 */
export const LOCAL_AUTHOR = 'anonymous';

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
export function App(props: { boardId?: string; doc?: Y.Doc; identityId?: string } = {}) {
  const { doc, objects, connection } = useBoardDoc(props.boardId, props.doc);
  // Uploader identity for images (no sign-in in this build: one id per browser tab).
  const [identityId] = useState(() => props.identityId ?? tabUploaderId());
  const selection = useSelection(objects);
  const { startEdit, endEdit, clear, click, setMany } = selection;
  const editable = canEdit(connection);
  const editingId = editable ? selection.editingId : null;
  // The camera lives in BoardViewport; the gesture reads the one last rendered, at event time.
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const viewSizeRef = useRef<Size>({ width: 0, height: 0 });
  const openPickerRef = useRef(() => {});
  const tool = useActiveTool({
    canEdit: editable,
    onSelectCreated: selection.selectNew,
    isEditing: editingId !== null,
    onImage: () => openPickerRef.current(),
  });
  const { setTool } = tool;
  // Pen colour and thickness: remembered until the page is reloaded (pen.options).
  const pen = usePenOptions();
  // Client-to-world conversion for objects (arrow end handles), from the viewport as last rendered.
  const toWorldRef = useRef<(x: number, y: number) => Point>((x, y) => ({ x, y }));
  const boardContext = useMemo<BoardContextValue>(
    () => ({ objects, toWorld: (x, y) => toWorldRef.current(x, y) }),
    [objects],
  );
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
  const createAtCentre = useCallback(() => {
    const { width, height } = viewSizeRef.current;
    createAt(screenToWorld(cameraRef.current, { x: width / 2, y: height / 2 }));
  }, [createAt]);
  // Text tool click: new text with its top-left at the point, being edited; the tool goes back to Select.
  const createTextAt = useCallback(
    (world: Point) => {
      setTool('select');
      if (!editableRef.current) return;
      const id = asStep(undoRef.current, () => createText(doc, world, LOCAL_AUTHOR));
      if (id) startEdit(id);
    },
    [doc, startEdit, setTool],
  );

  const images = useImageInsert({
    doc,
    boardId: props.boardId,
    connection,
    identityId,
    toWorld: (x, y) => toWorldRef.current(x, y),
    viewCentre: () => {
      const { width, height } = viewSizeRef.current;
      return screenToWorld(cameraRef.current, { x: width / 2, y: height / 2 });
    },
    undo: undoController,
    isEditing: editingId !== null,
  });
  openPickerRef.current = images.openPicker;
  const anyUploading = objects.some((o) => isImage(o) && o.status === 'uploading');
  const now = useClock(anyUploading, IMAGE_STATUS_TICK_MS);
  const { progress, canRetry, retry, forget } = images;
  const imageContext = useMemo<ImageContextValue>(
    () => ({
      identityId,
      progress,
      now,
      editable,
      canRetry,
      retry: (id) => {
        if (editableRef.current) retry(id);
      },
      remove: (id) => {
        if (!editableRef.current) return;
        forget(id);
        asStep(undoRef.current, () => deleteObjects(doc, [id]));
      },
    }),
    [identityId, progress, now, editable, canRetry, retry, forget, doc],
  );
  const dropTarget = useMemo(
    () => ({
      onDragEnter: images.onDragEnter,
      onDragOver: images.onDragOver,
      onDragLeave: images.onDragLeave,
      onDrop: (e: Parameters<typeof images.onDrop>[0]) => {
        if (editableRef.current) images.onDrop(e);
        else e.preventDefault();
      },
    }),
    [images.onDragEnter, images.onDragOver, images.onDragLeave, images.onDrop],
  );

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: { undo: undo.undo, redo: undo.redo, controller: undoController },
    tool,
    onCreateSticky: createAtCentre,
  });

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

  useEffect(() => installTestHooks({ notes: () => snapshot(doc), objects: () => objectSnapshot(doc) }), [doc]);
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
        onPlace={tool.tool === 'text' ? createTextAt : undefined}
        dropTarget={dropTarget}
        overlay={({ camera, size }) => (
          <>
            {tool.tool === 'shape' && (
              <ShapeTool
                kind={tool.shapeKind}
                camera={camera}
                doc={doc}
                by={LOCAL_AUTHOR}
                onCreated={tool.toolCreated}
              />
            )}
            {tool.tool === 'connector' && (
              <ConnectorTool
                camera={camera}
                snapshot={objects}
                doc={doc}
                by={LOCAL_AUTHOR}
                onCreated={tool.toolCreated}
              />
            )}
            {tool.tool === 'pen' && (
              <PenTool
                camera={camera}
                color={pen.color}
                thickness={pen.thickness}
                doc={doc}
                identityId={LOCAL_AUTHOR}
              />
            )}
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
              tool={tool.tool}
              onTool={setTool}
              shapeKind={tool.shapeKind}
              onShapeKind={tool.setShapeKind}
              onCreateSticky={() => createAt(screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }))}
              onImage={() => {
                setTool('select');
                images.openPicker();
              }}
            />
            <input {...images.pickerInput} />
            <DropHighlight active={images.dragging && editable} />
            <Toast message={images.message} onDismiss={images.dismissMessage} />
            {tool.tool === 'pen' && (
              <PenToolbar
                color={pen.color}
                thickness={pen.thickness}
                onColor={pen.setColor}
                onThickness={pen.setThickness}
              />
            )}
            <ConnectionStatus state={connection} />
          </>
        )}
      >
        {({ camera, size, toWorld }) => {
          cameraRef.current = camera;
          viewSizeRef.current = size;
          toWorldRef.current = toWorld;
          return (
            <BoardContext.Provider value={boardContext}>
              <ImageContext.Provider value={imageContext}>
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
              </ImageContext.Provider>
            </BoardContext.Provider>
          );
        }}
      </BoardViewport>
    </UndoContext.Provider>
  );
}
