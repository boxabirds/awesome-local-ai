import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  createSticky,
  deleteObjects,
  getStickyText,
  isStickyColor,
  resizeObjects,
  setStickyColor,
  stickiesOf,
} from '../shared/board-model';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { type Endpoint, createConnector } from '../shared/objects/connector';
import { type ShapeKind, createShape, getShapeLabel, setShapeStyle } from '../shared/objects/shape';
import { type PenColor, type PenThickness, createStroke } from '../shared/objects/stroke';
import { createText, setTextSize } from '../shared/objects/text';
import { MarqueeRect, useMarquee } from './board/Marquee';
import { SelectionBar } from './board/SelectionBar';
import { SelectionOverlay } from './board/SelectionOverlay';
import { Toolbar } from './board/Toolbar';
import { type UndoController, createUndo } from './board/undo';
import { useBoardDoc } from './board/useBoardDoc';
import { useBoardKeys } from './board/useBoardKeys';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { NO_UNDO, UndoContext, useUndo } from './board/useUndo';
import { type Point, type Size, canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installTestHooks } from './canvas/testHooks';
import { BoardCameraContext, useCamera } from './canvas/useCamera';
import { DropHighlight } from './images/DropHighlight';
import { ImageInsertContext, type ImageInsertInfo } from './images/ImageInsertContext';
import { useImageInsert } from './images/useImageInsert';
import { BoardObjectsContext } from './objects/BoardObjectsContext';
import { getObjectType } from './objects/registry';
import { remeasureTextBox } from './objects/useTextBoxSync';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { ShapeTool } from './tools/ShapeTool';
import { useActiveTool } from './tools/useActiveTool';
import { usePenOptions } from './tools/usePenOptions';
import { Toast } from './ui/Toast';

function initialViewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const GUEST_ID_KEY = 'vidi6-guest-id';

/** A random guest id kept for the tab's session, so a reload keeps it (the uploader of an image stays its uploader). */
function tabGuestId(): string {
  try {
    const stored = sessionStorage.getItem(GUEST_ID_KEY);
    if (stored) return stored;
    const id = `g_${crypto.randomUUID()}`;
    sessionStorage.setItem(GUEST_ID_KEY, id);
    return id;
  } catch {
    return `g_${crypto.randomUUID()}`;
  }
}

/**
 * Author id stored in `createdBy` (and an image's `uploaderId`) for this tab.
 * Identity (story 6) is not part of this build, so each tab gets a guest id.
 */
const LOCAL_AUTHOR_ID = tabGuestId();

/** Whether the board may be edited: never while its saved state cannot be loaded. */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * `boardId` connects the board to its live room; without it the board stays
 * local. `doc` lets tests supply the board document; the app creates its own.
 * `undo` lets tests supply the undo controller; otherwise the board gets its
 * own, discarded with the board (history is per tab and session-only).
 */
export function App(props: { boardId?: string | null; doc?: Y.Doc; undo?: UndoController } = {}): React.JSX.Element {
  const [viewportSize, setViewportSize] = useState<Size>(initialViewportSize);
  const board = useCamera(viewportSize);
  const context = useMemo(() => ({ ...board, setViewportSize }), [board]);
  const { camera } = board;
  const { doc, objects, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection(objects);
  const { ids: selectedIds, editingId, startEdit, endEdit } = selection;
  // A board that could not be loaded is never presented as an empty editable board.
  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  useEffect(() => {
    if (!editable) endEdit('selected');
  }, [editable, endEdit]);

  const [ownUndo, setOwnUndo] = useState<UndoController>(NO_UNDO);
  useEffect(() => {
    if (props.undo) return;
    const controller = createUndo(doc);
    setOwnUndo(controller);
    return () => {
      controller.destroy();
      setOwnUndo(NO_UNDO);
    };
  }, [doc, props.undo]);
  const undoController = props.undo ?? ownUndo;
  const undoControls = useUndo(undoController, editable);
  /** Runs one board change as its own undo step. */
  const asStep = <T,>(change: () => T): T => {
    undoController.boundary();
    try {
      return change();
    } finally {
      undoController.boundary();
    }
  };

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: editable,
    // A whole drag or resize (even a cancelled one) is exactly one undo step.
    onGestureStart: () => {
      undoController.boundary();
      undoController.holdCapture(true);
    },
    onGestureEnd: () => {
      undoController.holdCapture(false);
      undoController.boundary();
    },
  });
  const marquee = useMarquee(camera, objects, (ids) => selection.setMany(ids, true));
  // A shape or arrow just created becomes the selection and the tool returns to Select.
  const tools = useActiveTool({ canEdit: editable, onSelect: selection.selectNew });
  // Pen colour and thickness last for the session (until the page is reloaded).
  const pen = usePenOptions();

  useEffect(
    () =>
      installTestHooks({
        getNotes: () => stickiesOf(objects),
        getObjects: () => objects,
        getSelection: () => [...selectedIds],
        seedNotes: (notes) =>
          notes.map((n) => {
            const size = n.size ?? STICKY_SIZE_WORLD;
            const color = isStickyColor(n.color) ? n.color : undefined;
            const id = createSticky(doc, { x: n.x + STICKY_SIZE_WORLD / 2, y: n.y + STICKY_SIZE_WORLD / 2 }, color);
            if (id === false) throw new Error('seed rejected');
            if (n.text) doc.transact(() => getStickyText(doc, id)?.insert(0, n.text!), LOCAL_ORIGIN);
            if (size !== STICKY_SIZE_WORLD) resizeObjects(doc, new Map([[id, { x: n.x, y: n.y, width: size, height: size }]]));
            return id;
          }),
        seedShapes: (shapes) =>
          shapes.map((sh) => {
            const id = createShape(
              doc,
              { kind: sh.kind as ShapeKind, rect: { x: sh.x, y: sh.y, width: sh.width, height: sh.height }, at: { x: sh.x, y: sh.y } },
              LOCAL_AUTHOR_ID,
            );
            if (id === null) throw new Error('seed rejected');
            if (sh.label) doc.transact(() => getShapeLabel(doc, id)?.insert(0, sh.label!), LOCAL_ORIGIN);
            return id;
          }),
        seedConnectors: (arrows) =>
          arrows.map((a) => {
            const id = createConnector(doc, a.from as Endpoint, a.to as Endpoint, LOCAL_AUTHOR_ID);
            if (id === null) throw new Error('seed rejected');
            return id;
          }),
        seedStrokes: (strokes) =>
          strokes.map((st) => {
            const id = createStroke(
              doc,
              { points: st.points, color: (st.color ?? 'black') as PenColor, thickness: (st.thickness ?? 'medium') as PenThickness },
              LOCAL_AUTHOR_ID,
            );
            if (id === null) throw new Error('seed rejected');
            return id;
          }),
        deleteObjects: (ids) => deleteObjects(doc, ids),
      }),
    [objects, selectedIds, doc],
  );
  const connectionStates = useRef<ConnectionState[]>([]);
  useEffect(() => {
    if (!props.boardId) return;
    connectionStates.current.push(connection);
    return installTestHooks({ connectionState: connection, connectionStates: connectionStates.current });
  }, [props.boardId, connection]);

  const createAt = useCallback(
    (world: Point) => {
      if (!editableRef.current) return;
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id !== false) startEdit(id);
    },
    [doc, startEdit, undoController],
  );

  const createAtViewportCentre = () =>
    createAt(screenToWorld(camera, { x: viewportSize.width / 2, y: viewportSize.height / 2 }));

  useBoardKeys({
    doc,
    selection,
    snapshot: objects,
    canEdit: editable,
    undo: undoController,
    tool: tools,
    onCreateSticky: createAtViewportCentre,
    onImage: () => openImagePicker(),
  });

  /**
   * Text tool press: a new text at `world` (top-left), edited at once, and back
   * to Select. No boundary after creating: the new text's edit continues the
   * creation step, so abandoning it empty leaves nothing to undo.
   */
  const placeText = (world: Point) => {
    tools.setTool('select');
    if (!editableRef.current) return;
    undoController.boundary();
    const id = createText(doc, world, LOCAL_AUTHOR_ID);
    if (id !== null) startEdit(id);
  };

  const changeTextSize = (id: string, size: Parameters<typeof setTextSize>[2]) =>
    asStep(() => {
      if (setTextSize(doc, id, size)) remeasureTextBox(doc, id);
    });

  const images = useImageInsert({
    doc,
    boardId: props.boardId ?? '',
    camera,
    // A local board (no room, component tests) has no connection to wait for.
    connection: props.boardId ? connection : 'connected',
    identityId: LOCAL_AUTHOR_ID,
    viewportSize,
    undo: undoController,
    canEdit: editable,
    editing: editingId !== null,
  });
  const { progress: imageProgress, canRetry, retry } = images;
  const imageInfo = useMemo<ImageInsertInfo>(
    () => ({
      identityId: LOCAL_AUTHOR_ID,
      progress: imageProgress,
      canRetry,
      retry,
      remove: (id) => {
        undoController.boundary();
        deleteObjects(doc, [id]);
        undoController.boundary();
      },
    }),
    [imageProgress, canRetry, retry, doc, undoController],
  );
  /** Image tool (button or I): opens the file picker; the tool is Select again. */
  const openImagePicker = () => {
    tools.setTool('select');
    images.openPicker();
  };

  const deleteSelection = () => {
    asStep(() => deleteObjects(doc, [...selectedIds]));
    selection.clear();
  };

  const transforming = gesture.active !== null;

  let toolLayer: React.JSX.Element | null = null;
  if (tools.tool === 'shape') {
    toolLayer = (
      <ShapeTool
        kind={tools.shapeKind}
        camera={camera}
        onCreated={tools.toolCreated}
        doc={doc}
        createdBy={LOCAL_AUTHOR_ID}
        undo={undoController}
      />
    );
  } else if (tools.tool === 'connector') {
    toolLayer = (
      <ConnectorTool
        camera={camera}
        snapshot={objects}
        onCreated={tools.toolCreated}
        doc={doc}
        createdBy={LOCAL_AUTHOR_ID}
        undo={undoController}
      />
    );
  } else if (tools.tool === 'pen') {
    toolLayer = (
      <PenTool
        camera={camera}
        color={pen.color}
        thickness={pen.thickness}
        doc={doc}
        identityId={LOCAL_AUTHOR_ID}
        undo={undoController}
      />
    );
  }

  return (
    <BoardCameraContext.Provider value={context}>
      <UndoContext.Provider value={undoController}>
        <ImageInsertContext.Provider value={imageInfo}>
          <BoardObjectsContext.Provider value={objects}>
            <main className="app">
              <BoardViewport
                onEmptyDoubleClick={createAt}
                onEmptyClick={selection.clear}
                marquee={marquee}
                tool={tools.tool}
                onPlaceText={placeText}
                overlay={toolLayer}
                drop={images}
                highlight={<DropHighlight active={images.dropActive} />}
              >
                {[...objects].sort(byId).map((obj) => {
                  const spec = getObjectType(obj.type);
                  if (!spec) return null;
                  const selected = selectedIds.has(obj.id);
                  return (
                    <spec.Component
                      key={obj.id}
                      object={obj}
                      doc={doc}
                      zoom={camera.zoom}
                      selected={selected}
                      editing={obj.id === editingId}
                      editable={editable}
                      transforming={transforming && selected}
                      onPointerDown={gesture.onObjectPointerDown}
                      onSelect={selection.click}
                      onStartEdit={startEdit}
                      onEndEdit={endEdit}
                    />
                  );
                })}
                <MarqueeRect rect={marquee.rect} camera={camera} />
              </BoardViewport>
              <SelectionOverlay
                ids={selectedIds}
                snapshot={objects}
                camera={camera}
                onHandlePointerDown={gesture.onHandlePointerDown}
                showHandles={editable && editingId === null}
              />
              <SelectionBar
                ids={selectedIds}
                snapshot={objects}
                camera={camera}
                onDelete={deleteSelection}
                onColor={(id, color) => asStep(() => setStickyColor(doc, id, color))}
                onTextSize={changeTextSize}
                onShapeStyle={(id, style) => asStep(() => setShapeStyle(doc, id, style))}
                hidden={!editable || editingId !== null || transforming}
              />
              <Toolbar
                onCreateSticky={createAtViewportCentre}
                disabled={!editable}
                undo={undoControls}
                tool={tools.tool}
                onTool={tools.setTool}
                shapeKind={tools.shapeKind}
                onShapeKind={tools.setShapeKind}
                onImage={openImagePicker}
              />
              {tools.tool === 'pen' && (
                <PenToolbar color={pen.color} thickness={pen.thickness} onColor={pen.setColor} onThickness={pen.setThickness} />
              )}
              {props.boardId && <ConnectionStatus state={connection} />}
              <Toast messages={images.messages} />
              <NavigationHint visible={!board.hasNavigated} />
              <ZoomControls
                zoomPercent={zoomPercent(camera)}
                canZoomIn={canZoomIn(camera)}
                canZoomOut={canZoomOut(camera)}
                onZoomIn={() => board.zoomStep('in')}
                onZoomOut={() => board.zoomStep('out')}
                onReset={board.reset}
              />
            </main>
          </BoardObjectsContext.Provider>
        </ImageInsertContext.Provider>
      </UndoContext.Provider>
    </BoardCameraContext.Provider>
  );
}
