import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoardViewport,
  type ViewportBridge,
} from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useTransformGesture } from './board/useTransformGesture';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useBoardKeys } from './board/useBoardKeys';
import { useTool } from './board/useTool';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import { ShapeObject } from './objects/ShapeObject';
import { ConnectorObject } from './objects/ConnectorObject';
import { StrokeObject } from './objects/StrokeObject';
import { ImageObject } from './objects/ImageObject';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { useImageInsert } from './images/useImageInsert';
import { DropHighlight } from './images/DropHighlight';
import { ToastContainer, useToastState } from './ui/Toast';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { useActiveTool } from './tools/useActiveTool';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import * as Y from 'yjs';
import { createSticky, deleteObjects } from '../shared/board-model';
import type { StickySnapshot } from '../shared/board-model';
import { createText } from '../shared/objects/text';
import { createShape, setShapeStyle, type ShapeSnap } from '../shared/objects/shape';
import { createConnector, type ConnectorSnap } from '../shared/objects/connector';
import { type StrokeSnap } from '../shared/objects/stroke';
import { type ImageSnap } from '../shared/objects/image';
import type { Endpoint } from '../shared/geometry/connector-geometry';
import { isTestMode, setTestConnectionState } from './testHooks';
import { canEdit } from './sync/connectBoard';
import type { Camera, Point } from './canvas/camera';
import type { Handle, Rect } from '../shared/geometry';
import { createCanvasMeasurer } from './objects/textLayout';

// Register sticky note type (side effect: populates the registry)
import './objects/registerTypes';

export interface AppProps {
  /**
   * Optional board document. Production passes nothing and the app owns one;
   * component tests pass a doc they can also read and mutate.
   */
  doc?: Y.Doc;
  /**
   * Optional boardId to connect to the sync server. If omitted, no connection.
   */
  boardId?: string;
}

export function App({ doc: externalDoc, boardId: propBoardId }: AppProps = {}): React.JSX.Element {
  const boardId = propBoardId;

  const { doc, notes, connectionState } = useBoardDoc(externalDoc, boardId);
  const isReadOnly = !canEdit(connectionState);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (isTestMode()) {
      setTestConnectionState(connectionState);
    }
  }, [connectionState]);

  // Undo controller: one per board doc, destroyed on unmount
  const [undoCtrl, setUndoCtrl] = useState<UndoController | null>(null);
  useEffect(() => {
    const ctrl = createUndo(doc);
    setUndoCtrl(ctrl);
    return () => { ctrl.destroy(); setUndoCtrl(null); };
  }, [doc]);

  const undoState = useUndo(undoCtrl, !isReadOnly);

  const selection = useSelection(notes);
  const bridgeRef = useRef<ViewportBridge | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const onCameraChange = useCallback((cam: Camera) => setCamera(cam), []);

  // Toast state for image messages
  const toastState = useToastState();

  // Tool state — use useActiveTool for the extended tool set
  const onSelect = useCallback(
    (id: string) => { selection.click(id); },
    [selection],
  );
  const activeTool = useActiveTool({ canEdit: !isReadOnly, onSelect });

  // Keep useTool in sync for backward compat with existing code paths
  const { setTool: legacySetTool } = useTool(!isReadOnly);

  // Sync activeTool → legacyTool where they overlap
  useEffect(() => {
    if (activeTool.tool === 'text') legacySetTool('text');
    else legacySetTool('select');
  }, [activeTool.tool, legacySetTool]);

  // Pen options
  const penOptions = usePenOptions();

  // Image insert (story 12)
  const getViewCentre = useCallback((): Point | null => {
    return bridgeRef.current?.centreWorld() ?? null;
  }, []);
  const imageInsert = useImageInsert({
    doc,
    boardId: boardId ?? 'local',
    camera,
    connection: connectionState,
    identityId: 'local',
    showToast: toastState.show,
    getViewCentre,
  });

  // Clock tick every 30s to detect unfinished uploads
  const [clockTick, setClockTick] = useState(Date.now());
  const hasUploadingImages = notes.some((n) => n.type === 'image' && (n as ImageSnap).status === 'uploading');
  useEffect(() => {
    if (!hasUploadingImages) return;
    const interval = setInterval(() => setClockTick(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [hasUploadingImages]);

  // Paste handler on window
  useEffect(() => {
    const handler = (e: ClipboardEvent) => imageInsert.onPaste(e);
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [imageInsert.onPaste]);

  // Image tool: open picker when 'image' tool is activated
  useEffect(() => {
    if (activeTool.tool === 'image') {
      imageInsert.openPicker();
      activeTool.setTool('select');
    }
  }, [activeTool.tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // Measurer for text objects
  const measurer = useMemo(() => createCanvasMeasurer(), []);

  // Transform gesture: move and resize (boundary on gesture start/end)
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: !isReadOnly,
    onGestureStart: undoCtrl?.boundary,
    onGestureEnd: undoCtrl?.boundary,
  });

  // Marquee: shift+drag on empty space
  const marquee = useMarquee(camera, notes, (ids) => {
    if (ids.length > 0) {
      selection.setMany(ids, true);
    }
  });

  /** Centre a new note on a world point, select it and start typing. */
  const createAndEdit = useCallback(
    (world: Point) => {
      if (isReadOnly) return;
      undoCtrl?.boundary();
      const id = createSticky(doc, world);
      undoCtrl?.boundary();
      if (id) selection.startEdit(id);
    },
    [doc, selection, isReadOnly, undoCtrl],
  );

  const onCreateStickyWorld = useCallback(
    (world: Point) => {
      createAndEdit(world);
    },
    [createAndEdit],
  );

  /** The toolbar button or N key: a note centred in the visible board area. */
  const onCreateSticky = useCallback(() => {
    const centre = bridgeRef.current?.centreWorld();
    if (!centre) return;
    createAndEdit(centre);
  }, [createAndEdit]);

  /** Text tool: click creates text at world point, then switch to select and start editing. */
  const onTextToolClick = useCallback(
    (world: Point) => {
      if (isReadOnly) return;
      undoCtrl?.boundary();
      const id = createText(doc, world, 'local');
      undoCtrl?.boundary();
      if (id) {
        activeTool.setTool('select');
        selection.startEdit(id);
      }
    },
    [doc, selection, isReadOnly, undoCtrl, activeTool],
  );

  // Shape tool callbacks
  const onCreateShape = useCallback(
    (rect: { x: number; y: number; width: number; height: number } | null, at: Point, square: boolean): string | null => {
      if (isReadOnly) return null;
      return createShape(doc, { kind: activeTool.shapeKind, rect, at, square }, 'local');
    },
    [doc, isReadOnly, activeTool.shapeKind],
  );

  const undoBoundary = useCallback(() => {
    undoCtrl?.boundary();
  }, [undoCtrl]);

  // Connector tool callbacks
  const onCreateConnector = useCallback(
    (from: Endpoint, to: Endpoint): string | null => {
      if (isReadOnly) return null;
      return createConnector(doc, from, to, 'local');
    },
    [doc, isReadOnly],
  );

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: notes,
    canEdit: !isReadOnly,
    undo: undoCtrl ?? undefined,
    tool: activeTool.tool === 'text' ? 'text' : 'select',
    setTool: (t) => activeTool.setTool(t),
    onCreateSticky,
  });

  const clearSelection = useCallback(() => selection.clear(), [selection]);

  const onDeleted = useCallback(
    (_id: string) => {
      // Selection pruning handles this via the snapshot effect
    },
    [],
  );

  const onDeleteSelection = useCallback(() => {
    if (selection.ids.size === 0) return;
    if (isReadOnly) return;
    undoCtrl?.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoCtrl?.boundary();
    selection.clear();
  }, [doc, selection, isReadOnly, undoCtrl]);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, handle: Handle) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

  const onObjectPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      gesture.onObjectPointerDown(e, id);
    },
    [gesture],
  );

  const onShapePointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>, id: string) => {
      gesture.onObjectPointerDown(e as unknown as React.PointerEvent<HTMLDivElement>, id);
    },
    [gesture],
  );

  const onConnectorPointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>, id: string) => {
      gesture.onObjectPointerDown(e as unknown as React.PointerEvent<HTMLDivElement>, id);
    },
    [gesture],
  );

  // Marquee handlers
  const onMarqueeStart = useCallback(
    (screen: Point) => marquee.begin(screen),
    [marquee],
  );
  const onMarqueeMove = useCallback(
    (screen: Point) => marquee.move(screen),
    [marquee],
  );
  const onMarqueeEnd = useCallback(
    () => marquee.end(),
    [marquee],
  );
  const onMarqueeCancel = useCallback(
    () => marquee.cancel(),
    [marquee],
  );

  // Build the overlay (screen-space elements: marquee rect, selection overlay, selection bar, pen tool)
  const activeToolId = activeTool.tool;
  const overlay = (
    <>
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={onHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onDelete={onDeleteSelection}
      />
      {/* Pen tool overlay inside viewport so wheel events bubble to viewport's wheel handler */}
      {activeToolId === 'pen' && !isReadOnly && (
        <PenTool
          camera={camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId="local"
          undoBoundary={undoBoundary}
        />
      )}
    </>
  );

  // Separate objects by type
  const stickyNotes = notes.filter((n): n is StickySnapshot => n.type === 'sticky');
  const textObjects = notes.filter((n) => n.type === 'text');
  const shapes = notes.filter((n): n is ShapeSnap => n.type === 'shape');
  const connectors = notes.filter((n): n is ConnectorSnap => n.type === 'connector');
  const strokes = notes.filter((n): n is StrokeSnap => n.type === 'stroke');
  const images = notes.filter((n): n is ImageSnap => n.type === 'image');

  // Build rects map for connector resolution
  const rectsMap = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const obj of notes) {
      if (obj.type === 'connector') continue;
      const w = 'width' in obj && obj.width !== undefined ? obj.width : 200;
      const h = 'height' in obj && obj.height !== undefined ? obj.height : 200;
      m.set(obj.id, { x: obj.x, y: obj.y, width: w, height: h });
    }
    return m;
  }, [notes]);

  // Shape toolbar: show when exactly one shape is selected
  const selectedShape = shapes.length === 1 && selection.ids.size === 1 && selection.ids.has(shapes[0]?.id ?? '')
    ? shapes[0]
    : null;

  const onShapeFill = useCallback(
    (c: string) => {
      if (!selectedShape) return;
      undoCtrl?.boundary();
      setShapeStyle(doc, selectedShape.id, { fill: c });
      undoCtrl?.boundary();
    },
    [doc, selectedShape, undoCtrl],
  );

  const onShapeStroke = useCallback(
    (c: string) => {
      if (!selectedShape) return;
      undoCtrl?.boundary();
      setShapeStyle(doc, selectedShape.id, { stroke: c });
      undoCtrl?.boundary();
    },
    [doc, selectedShape, undoCtrl],
  );

  // Shape toolbar screen position
  const shapeToolbarPos = useMemo(() => {
    if (!selectedShape) return null;
    const sx = (selectedShape.x - camera.x) * camera.zoom;
    const sy = (selectedShape.y - camera.y) * camera.zoom - 32;
    return { left: sx, top: sy };
  }, [selectedShape, camera]);

  return (
    <div className="app">
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        bridgeRef={bridgeRef}
        onCreateStickyWorld={onCreateStickyWorld}
        onClearSelection={clearSelection}
        onCameraChange={onCameraChange}
        onMarqueeStart={onMarqueeStart}
        onMarqueeMove={onMarqueeMove}
        onMarqueeEnd={onMarqueeEnd}
        onMarqueeCancel={onMarqueeCancel}
        overlay={overlay}
        tool={activeToolId === 'text' ? 'text' : 'select'}
        onTextToolClick={onTextToolClick}
        onDragEnter={imageInsert.onDragEnter}
        onDragOver={imageInsert.onDragOver}
        onDragLeave={imageInsert.onDragLeave}
        onDrop={imageInsert.onDrop}
      >
        {/* SVG layer for shapes and connectors */}
        <svg
          data-testid="svg-layer"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          {connectors.map((conn) => (
            <ConnectorObject
              key={conn.id}
              connector={conn}
              rects={rectsMap}
              doc={doc}
              selected={selection.ids.has(conn.id)}
              zoom={camera.zoom}
              camera={camera}
              snapshot={notes}
              onPointerDown={onConnectorPointerDown}
            />
          ))}
          {shapes.map((shape) => (
            <ShapeObject
              key={shape.id}
              shape={shape}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.ids.has(shape.id)}
              editing={shape.id === selection.editingId}
              onPointerDown={onShapePointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          ))}
          {strokes.map((stroke) => (
            <StrokeObject
              key={stroke.id}
              stroke={stroke}
              selected={selection.ids.has(stroke.id)}
              zoom={camera.zoom}
              onPointerDown={onShapePointerDown}
            />
          ))}
        </svg>
        {stickyNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            onPointerDown={onObjectPointerDown}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onDeleted={onDeleted}
            undo={undoCtrl ?? undefined}
          />
        ))}
        {textObjects.map((obj) => (
          <TextObject
            key={obj.id}
            obj={obj}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(obj.id)}
            editing={obj.id === selection.editingId}
            canEdit={!isReadOnly}
            onPointerDown={onObjectPointerDown}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            onDeleted={onDeleted}
            undo={undoCtrl ?? undefined}
            measurer={measurer}
          />
        ))}
        {images.map((img) => (
          <ImageObject
            key={img.id}
            image={img}
            isUploader={img.uploaderId === 'local'}
            progress={imageInsert.progress.get(img.id)}
            canRetry={imageInsert.canRetry(img.id)}
            now={clockTick}
            selected={selection.ids.has(img.id)}
            zoom={camera.zoom}
            onRetry={() => imageInsert.retry(img.id)}
            onRemove={() => { deleteObjects(doc, [img.id]); }}
            onPointerDown={onObjectPointerDown}
          />
        ))}
      </BoardViewport>

      {/* Pen tool overlay (captures pointer events when pen tool is active) */}
      {activeToolId === 'shape' && !isReadOnly && (
        <ShapeTool
          kind={activeTool.shapeKind}
          camera={camera}
          onCreated={(id) => activeTool.toolCreated(id)}
          onCreateShape={onCreateShape}
          undoBoundary={undoBoundary}
        />
      )}

      {/* Connector tool overlay */}
      {activeToolId === 'connector' && !isReadOnly && (
        <ConnectorTool
          camera={camera}
          snapshot={notes}
          zoom={camera.zoom}
          onCreated={(id) => activeTool.toolCreated(id)}
          onCreateConnector={onCreateConnector}
          undoBoundary={undoBoundary}
        />
      )}

      {/* Pen toolbar: visible while pen is active */}
      {activeToolId === 'pen' && !isReadOnly && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}

      {/* Shape toolbar for selected shape */}
      {selectedShape && activeToolId === 'select' && !isReadOnly && shapeToolbarPos && (
        <div style={{ position: 'absolute', left: shapeToolbarPos.left, top: shapeToolbarPos.top, zIndex: 20 }}>
          <ShapeToolbar
            fill={selectedShape.fill}
            stroke={selectedShape.stroke}
            onFill={onShapeFill}
            onStroke={onShapeStroke}
          />
        </div>
      )}

      {imageInsert.isDragging && <DropHighlight />}
      <ToastContainer toasts={toastState.toasts} />
      <Toolbar
        tool={activeToolId}
        onToolChange={(t) => activeTool.setTool(t)}
        canEdit={!isReadOnly}
        onCreateSticky={onCreateSticky}
        onImagePick={() => imageInsert.openPicker()}
        undo={undoState}
        shapeKind={activeTool.shapeKind}
        onShapeKindChange={activeTool.setShapeKind}
      />
    </div>
  );
}
