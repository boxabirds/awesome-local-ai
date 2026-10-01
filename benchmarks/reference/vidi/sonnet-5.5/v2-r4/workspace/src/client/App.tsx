import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObjects, objectBounds } from '../shared/board-model';
import { createText } from '../shared/objects/text';
import { localIdentityId } from './identity';
import { useActiveTool } from './tools/useActiveTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { ObjectRectsContext } from './objects/rectsContext';
import type { Rect } from '../shared/geometry';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { createUndo, NO_UNDO, type UndoController } from './board/undo';
import { UndoButtons } from './board/UndoButtons';
import { UndoContext, useUndo } from './board/useUndo';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { BoardViewport } from './canvas/BoardViewport';
import type { Camera } from './canvas/camera';
import { setTestConnectionState } from './canvas/testHooks';
import { getObjectType } from './objects/registry';
import { ImageInsertContext } from './images/imageContext';
import { DropHighlight } from './images/DropHighlight';
import { useImageInsert } from './images/useImageInsert';
import { ToastHost } from './ui/Toast';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';

/** Editing is blocked only while a saved board cannot be loaded (it must not look like an empty board). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export function App({ doc: externalDoc, boardId }: { doc?: Y.Doc; boardId?: string }) {
  const { doc, notes: objects, connection } = useBoardDoc(externalDoc, boardId);
  useEffect(() => setTestConnectionState(connection), [connection]);
  // One controller per board doc; history is session-only, so it dies with the doc.
  const [undoCtl, setUndoCtl] = useState<UndoController>(NO_UNDO);
  useEffect(() => {
    const c = createUndo(doc);
    setUndoCtl(c);
    return () => {
      c.destroy();
      setUndoCtl(NO_UNDO);
    };
  }, [doc]);
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
  const gesture = useTransformGesture({ doc, camera: liveCamera, selection: sel, snapshot: objects, canEdit: editable, onGestureStart: undoCtl.boundary, onGestureEnd: undoCtl.boundary });
  const undoState = useUndo(undoCtl, editable);

  const { tool, shapeKind, setTool, setShapeKind, toolCreated } = useActiveTool({ canEdit: editable, select: sel.select });
  const pen = usePenOptions();
  const rects = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const o of objects) if (o.type !== 'connector') m.set(o.id, objectBounds(o));
    return m;
  }, [objects]);
  const viewCentreRef = useRef({ x: 0, y: 0 });
  const identityId = localIdentityId();
  const images = useImageInsert({ doc, boardId: boardId ?? '', camera: liveCamera, connection, identityId, undo: undoCtl });
  const imageCtx = useMemo(
    () => ({ identityId, progress: images.progress, canRetry: images.canRetry, retry: images.retry }),
    [identityId, images.progress, images.canRetry, images.retry],
  );
  const onPasteImage = images.onPaste;
  useEffect(() => {
    const h = (e: ClipboardEvent) => onPasteImage(e);
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, [onPasteImage]);

  const deleteSelection = () => {
    if (!editable) return;
    undoCtl.boundary();
    deleteObjects(doc, [...sel.ids]);
    undoCtl.boundary();
    sel.clear();
  };

  const create = (at: { x: number; y: number }) => {
    if (!editable) return;
    undoCtl.boundary();
    const id = createSticky(doc, at);
    undoCtl.boundary();
    if (id) sel.startEdit(id);
  };

  // No boundary after creating: the first typing joins the creation step, so one undo removes the whole text.
  const placeText = (at: { x: number; y: number }) => {
    if (!editable) return;
    undoCtl.boundary();
    const id = createText(doc, at, localIdentityId());
    setTool('select');
    if (id) sel.startEdit(id);
  };

  useBoardKeys({
    doc,
    selection: sel,
    snapshot: objects,
    canEdit: editable,
    undo: undoCtl,
    setTool,
    onCreateSticky: () => create(viewCentreRef.current),
    onOpenImagePicker: images.openPicker,
  });

  return (
    <UndoContext.Provider value={undoCtl}>
    <ObjectRectsContext.Provider value={rects}>
    <ImageInsertContext.Provider value={imageCtx}>
    <ToastHost />
    {boardId && <ConnectionStatus state={connection} />}
    <BoardViewport
      onDoubleClickEmpty={create}
      onClickEmpty={sel.clear}
      snapshot={objects}
      onMarqueeSelect={(ids) => sel.setMany(ids, true)}
      textToolActive={tool === 'text'}
      onTextClick={placeText}
      onDragEnter={images.onDragEnter}
      onDragOver={images.onDragOver}
      onDragLeave={images.onDragLeave}
      onDrop={images.onDrop}
      overlay={(ctx) => {
        cameraRef.current = ctx.camera;
        viewCentreRef.current = ctx.viewCentre;
        return (
          <>
            {tool === 'shape' && <ShapeTool kind={shapeKind} camera={ctx.camera} doc={doc} undo={undoCtl} onCreated={toolCreated} />}
            {tool === 'pen' && <PenTool camera={ctx.camera} color={pen.color} thickness={pen.thickness} doc={doc} identityId={localIdentityId()} undo={undoCtl} />}
            {tool === 'pen' && <PenToolbar color={pen.color} thickness={pen.thickness} onColor={pen.setColor} onThickness={pen.setThickness} />}
            {tool === 'connector' && <ConnectorTool camera={ctx.camera} snapshot={objects} doc={doc} undo={undoCtl} onCreated={toolCreated} />}
            <DropHighlight active={images.dragActive} />
            <Toolbar
              disabled={!editable}
              tool={tool}
              onTool={setTool}
              shapeKind={shapeKind}
              onShapeKind={(k) => {
                setShapeKind(k);
                setTool('shape');
              }}
              onCreateSticky={() => create(ctx.viewCentre)}
              onImage={images.openPicker}
            >
              <UndoButtons {...undoState} />
            </Toolbar>
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
              undo={undoCtl}
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
    </ImageInsertContext.Provider>
    </ObjectRectsContext.Provider>
    </UndoContext.Provider>
  );
}
