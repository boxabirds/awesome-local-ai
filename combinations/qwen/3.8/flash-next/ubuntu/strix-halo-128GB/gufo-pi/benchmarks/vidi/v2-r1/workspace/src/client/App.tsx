import { useCallback, useEffect, useMemo, useRef } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from './canvas/camera';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { TEST_MODE } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useBoardKeys } from './board/useBoardKeys';
import { useTransformGesture } from './board/useTransformGesture';
import { useUndo } from './board/useUndo';
import { useTool } from './board/useTool';
import { createUndo, type UndoController } from './board/undo';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import { getObjectType } from './objects/registry';
import { createCanvasMeasurer, type Measurer } from './objects/textLayout';
import { remeasureTextBox } from './objects/useTextBoxSync';
import { createText } from '../shared/objects/text';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';
import { SharePanel } from './share/SharePanel';
import {
  createSticky,
  deleteObjects,
  objectSnapshots,
  objectsInRect,
  setStickyColor,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../shared/board-model';
import type { TextSnapshot } from '../shared/objects/text';
import { createShape, setShapeStyle, type ShapeSnap } from '../shared/objects/shape';
import { createConnector, type ConnectorSnap, type Endpoint } from '../shared/objects/connector';
import { ShapeObject } from './objects/ShapeObject';
import { ConnectorObject } from './objects/ConnectorObject';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { ShapeTool } from './tools/ShapeTool';
import { ConnectorTool } from './tools/ConnectorTool';
import { PenTool } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { StrokeObject } from './objects/StrokeObject';
import type { StrokeSnap } from '../shared/objects/stroke';
import { ImageObject } from './objects/ImageObject';
import type { ImageSnap as ImageSnapType } from '../shared/objects/image';
import { useImageInsert } from './images/useImageInsert';
import { IMAGE_ACCEPTED_TYPES } from '../shared/config';
import type { FillColor, StrokeColor } from '../shared/config';
import type { Rect } from '../shared/geometry';
import { objectBounds } from '../shared/board-model';

/**
 * The board: an infinite canvas (story 1) holding sticky notes (story 2) and
 * text objects (story 9), shared live with others (story 3), with multi-selection,
 * move, resize, nudge and delete (story 7), and per-user undo/redo (story 8).
 */
export function App(props: { boardId: string }) {
  const { boardId } = props;
  const viewport = useViewportSize();
  const cameraApi = useCamera(viewport);
  const { camera, hasNavigated } = cameraApi;
  const { doc, notes, connectionState } = useBoardDoc(boardId);

  // Object snapshots for group operations (must be computed before useSelection for prune)
  const objSnapshots: readonly ObjectSnapshot[] = useMemo(() => objectSnapshots(doc), [notes]);

  const selection = useSelection(objSnapshots);
  const editing = canEdit(connectionState);

  // Tool mode
  const toolApi = useTool({ canEdit: editing, onSelect: useCallback((id: string) => selection.click(id), [selection]) });
  const { tool, setTool, shapeKind, setShapeKind, toolCreated } = toolApi;

  // Pen options (session-only state)
  const penOptions = usePenOptions();

  // Text measurer (shared across all text objects)
  const measureRef = useRef<Measurer | null>(null);
  if (measureRef.current === null) {
    measureRef.current = createCanvasMeasurer();
  }
  const measure = measureRef.current;

  /** Latest camera, readable synchronously inside event handlers. */
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // --- Undo controller (story 8) ---
  const undoRef = useRef<UndoController | null>(null);
  // Create one controller per doc; destroy on board change or unmount.
  useEffect(() => {
    const ctrl = createUndo(doc);
    undoRef.current = ctrl;
    return () => {
      ctrl.destroy();
      undoRef.current = null;
    };
  }, [doc]);

  const undoApi = useUndo(undoRef.current, editing);

  const undoBoundary = useCallback(() => {
    undoRef.current?.boundary();
  }, []);

  const undoCtrlRef = useMemo(
    () => ({
      undo: () => undoRef.current?.undo() ?? false,
      redo: () => undoRef.current?.redo() ?? false,
    }),
    [],
  );

  // Image insert hook
  const { insertImages, retry: retryImage, canRetry: _canRetry } = useImageInsert({
    boardId,
    getDoc: () => doc,
    undoBoundary: (_label, fn) => fn(),
    toast: (msg) => { console.warn(msg); },
    screenToWorld: (screen) => screenToWorld(cameraRef.current, screen),
    isOnline: () => editing,
    clientId: () => 'local',
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImagePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      const world = screenToWorld(cameraRef.current, { x: viewport.width / 2, y: viewport.height / 2 });
      insertImages(files, world, 'centre');
    }
    // Reset so same file can be selected again
    e.target.value = '';
  }, [insertImages, viewport]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!editing) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const screen = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(cameraRef.current, screen);
    insertImages(files, world, 'top-left');
  }, [editing, insertImages]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!editing) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.kind === 'file' && IMAGE_ACCEPTED_TYPES.includes(items[i]!.type as any)) {
        const f = items[i]!.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    const world = screenToWorld(cameraRef.current, { x: viewport.width / 2, y: viewport.height / 2 });
    insertImages(files, world, 'centre');
  }, [editing, insertImages, viewport]);

  useEffect(() => {
    const handler = (e: ClipboardEvent) => handlePaste(e);
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [handlePaste]);

  // Transform gesture — boundary on start and end
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: objSnapshots,
    canEdit: editing,
    onGestureStart: undoBoundary,
    onGestureEnd: undoBoundary,
    remeasureText: useCallback(
      (id: string) => remeasureTextBox(doc, id, measure),
      [doc, measure],
    ),
  });

  // Marquee selection
  const marquee = useMarquee(
    camera,
    objSnapshots,
    useCallback(
      (ids: string[]) => selection.setMany(ids, true),
      [selection],
    ),
    objectsInRect,
  );

  /** Create a note centred on a screen point of the board area (a double-click),
   * and start typing straight away. */
  const createAtScreenPoint = useCallback(
    (screen: Point) => {
      if (!editing) return;
      const world = screenToWorld(cameraRef.current, screen);
      undoBoundary();
      const id = createSticky(doc, world);
      undoBoundary();
      if (id !== '') {
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [doc, selection, editing, undoBoundary],
  );

  /** Create a note in the middle of what the user can see. */
  const createAtCentre = useCallback(() => {
    if (!editing) return;
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.height, viewport.width, editing]);

  /** Handle text tool click: create text at the clicked point, start editing, switch to Select. */
  const handleTextToolClick = useCallback(
    (screen: Point) => {
      if (!editing) return;
      const world = screenToWorld(cameraRef.current, screen);
      undoBoundary();
      const id = createText(doc, world, 'local');
      undoBoundary();
      if (id !== null) {
        setTool('select');
        selection.click(id);
        selection.startEdit(id);
      }
    },
    [doc, selection, editing, undoBoundary, setTool],
  );

  // Keyboard commands
  useBoardKeys({
    doc,
    selection,
    snapshot: objSnapshots,
    canEdit: editing,
    undo: undoApi.undo,
    redo: undoApi.redo,
    undoBoundary,
    tool,
    setTool,
    onCreateSticky: createAtCentre,
    onImagePicker: handleImagePicker,
  });

  // Test-only hooks
  useEffect(() => {
    const hooks = TEST_MODE ? window.__vidi6 : undefined;
    if (!hooks) return undefined;
    const prevGetDoc = hooks.getDoc;
    const prevGetNoteCount = hooks.getNoteCount;
    const prevAddRandomNotes = hooks.addRandomNotes;
    hooks.getDoc = () => doc;
    hooks.getNoteCount = () => notes.length;
    hooks.addRandomNotes = (n: number) => {
      for (let i = 0; i < n; i++) {
        createSticky(doc, { x: (i % 50) * 220, y: Math.floor(i / 50) * 220 });
      }
    };
    hooks.addNoteAt = (pos: { x: number; y: number }) => createSticky(doc, pos);
    return () => {
      hooks.getDoc = prevGetDoc;
      hooks.getNoteCount = prevGetNoteCount;
      hooks.addRandomNotes = prevAddRandomNotes;
    };
  }, [doc, notes.length]);

  const handleDeleteSelection = useCallback(() => {
    if (!editing) return;
    undoBoundary();
    deleteObjects(doc, [...selection.ids]);
    undoBoundary();
    selection.clear();
  }, [doc, selection, editing, undoBoundary]);

  const handleColor = useCallback(
    (id: string, color: string) => {
      undoBoundary();
      setStickyColor(doc, id, color);
      undoBoundary();
    },
    [doc, undoBoundary],
  );

  // Determine if any selected type is resizable
  const anyResizable = useMemo(() => {
    for (const id of selection.ids) {
      const obj = objSnapshots.find((o) => o.id === id);
      if (obj) {
        const spec = getObjectType(obj.type);
        if (spec?.resizable) return true;
      }
    }
    return false;
  }, [selection.ids, objSnapshots]);

  // Marquee event handlers
  const handleMarqueeBegin = useCallback(
    (point: Point) => marquee.begin(point),
    [marquee],
  );
  const handleMarqueeMove = useCallback(
    (point: Point) => marquee.move(point),
    [marquee],
  );
  const handleMarqueeEnd = useCallback(() => marquee.end(), [marquee]);
  const handleMarqueeCancel = useCallback(() => marquee.cancel(), [marquee]);

  /** Separate sticky notes and text objects for rendering. */
  const paintedNotes: StickySnapshot[] = useMemo(() => [...notes].sort(byId), [notes]);

  const textObjects: TextSnapshot[] = useMemo(() => {
    const result: TextSnapshot[] = [];
    const objects = doc.getMap('objects');
    for (const [id, entry] of objects) {
      if (entry instanceof (entry as any).constructor) {
        // Check type field
        const type = (entry as any).get?.('type');
        if (type === 'text') {
          const snap = objSnapshots.find((o) => o.id === id);
          if (snap) {
            const textVal = (entry as any).get?.('text');
            const size = (entry as any).get?.('size') ?? 'M';
            const widthMode = (entry as any).get?.('widthMode') ?? 'auto';
            result.push({
              ...snap,
              type: 'text',
              text: textVal?.toString?.() ?? '',
              size,
              widthMode,
            });
          }
        }
      }
    }
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [objSnapshots, doc, notes]);

  // Shape objects snapshots
  const shapeObjects: ShapeSnap[] = useMemo(() => {
    const result: ShapeSnap[] = [];
    const objects = doc.getMap('objects');
    for (const [id, entry] of objects) {
      if (!(entry instanceof Object)) continue;
      const ymap = entry as any;
      if (ymap.get?.('type') !== 'shape') continue;
      const x = ymap.get('x');
      const y = ymap.get('y');
      const w = ymap.get('width');
      const h = ymap.get('height');
      const z = ymap.get('z');
      const kind = ymap.get('kind') ?? 'rect';
      const fill = ymap.get('fill') ?? 'white';
      const stroke = ymap.get('stroke') ?? 'dark';
      const label = ymap.get('label');
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      result.push({
        id, type: 'shape', x, y, z: typeof z === 'number' ? z : 0,
        width: typeof w === 'number' ? w : 160,
        height: typeof h === 'number' ? h : 160,
        kind, fill, stroke,
        label: label?.toString?.() ?? '',
      });
    }
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [objSnapshots, doc, notes]);

  // Connector objects snapshots
  const connectorObjects: ConnectorSnap[] = useMemo(() => {
    const result: ConnectorSnap[] = [];
    const objects = doc.getMap('objects');
    for (const [id, entry] of objects) {
      if (!(entry instanceof Object)) continue;
      const ymap = entry as any;
      if (ymap.get?.('type') !== 'connector') continue;
      const z = ymap.get('z');
      const fromRaw = ymap.get('from');
      const toRaw = ymap.get('to');
      if (!fromRaw || !toRaw) continue;
      result.push({
        id, type: 'connector', x: 0, y: 0, z: typeof z === 'number' ? z : 0,
        from: fromRaw as Endpoint, to: toRaw as Endpoint,
      });
    }
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [objSnapshots, doc, notes]);

  // Stroke objects snapshots
  const strokeObjects: StrokeSnap[] = useMemo(() => {
    const result: StrokeSnap[] = [];
    const objects = doc.getMap('objects');
    for (const [id, entry] of objects) {
      if (!(entry instanceof Object)) continue;
      const ymap = entry as any;
      if (ymap.get?.('type') !== 'stroke') continue;
      const x = ymap.get('x');
      const y = ymap.get('y');
      const w = ymap.get('width');
      const h = ymap.get('height');
      const z = ymap.get('z');
      const points = ymap.get('points');
      const baseWidth = ymap.get('baseWidth');
      const baseHeight = ymap.get('baseHeight');
      const color = ymap.get('color') ?? 'black';
      const thickness = ymap.get('thickness') ?? 'medium';
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      result.push({
        id, type: 'stroke', x, y, z: typeof z === 'number' ? z : 0,
        width: typeof w === 'number' ? w : 10,
        height: typeof h === 'number' ? h : 10,
        points: Array.isArray(points) ? points : [],
        baseWidth: typeof baseWidth === 'number' ? baseWidth : 10,
        baseHeight: typeof baseHeight === 'number' ? baseHeight : 10,
        color, thickness,
      });
    }
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [objSnapshots, doc, notes]);

  // Image objects snapshots
  const imageObjects: ImageSnapType[] = useMemo(() => {
    const result: ImageSnapType[] = [];
    const objects = doc.getMap('objects');
    for (const [id, entry] of objects) {
      if (!(entry instanceof Object)) continue;
      const ymap = entry as any;
      if (ymap.get?.('type') !== 'image') continue;
      const x = ymap.get('x');
      const y = ymap.get('y');
      const w = ymap.get('width');
      const h = ymap.get('height');
      const z = ymap.get('z');
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      result.push({
        id, type: 'image', x, y, z: typeof z === 'number' ? z : 0,
        width: typeof w === 'number' ? w : 100,
        height: typeof h === 'number' ? h : 100,
        assetKey: (ymap.get('assetKey') as string | null) ?? null,
        contentType: (ymap.get('contentType') as string) ?? '',
        naturalWidth: (ymap.get('naturalWidth') as number) ?? 0,
        naturalHeight: (ymap.get('naturalHeight') as number) ?? 0,
        status: (ymap.get('status') as ImageSnapType['status']) ?? 'uploading',
        uploadStartedAt: (ymap.get('uploadStartedAt') as number) ?? 0,
        uploaderId: (ymap.get('uploaderId') as string) ?? '',
      });
    }
    return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }, [objSnapshots, doc, notes]);

  // Build rects map for connector resolution
  const rectsMap: ReadonlyMap<string, Rect> = useMemo(() => {
    const map = new Map<string, Rect>();
    for (const obj of objSnapshots) {
      map.set(obj.id, objectBounds(obj));
    }
    return map;
  }, [objSnapshots]);

  // Shape tool creation handler
  const handleCreateShape = useCallback((rect: Rect | null, at: Point, square: boolean): string | null => {
    if (!editing) return null;
    return createShape(doc, { kind: shapeKind, rect, at, square }, 'local');
  }, [doc, editing, shapeKind]);

  // Connector tool creation handler
  const handleCreateConnector = useCallback((from: Endpoint, to: Endpoint): string | null => {
    if (!editing) return null;
    return createConnector(doc, from, to, 'local');
  }, [doc, editing]);

  // Shape style handlers
  const selectedShapeId = useMemo(() => {
    for (const id of selection.ids) {
      if (shapeObjects.find((s) => s.id === id)) return id;
    }
    return null;
  }, [selection.ids, shapeObjects]);

  const selectedShape = useMemo(() => {
    return selectedShapeId ? shapeObjects.find((s) => s.id === selectedShapeId) ?? null : null;
  }, [selectedShapeId, shapeObjects]);

  const handleShapeFill = useCallback((c: FillColor) => {
    if (!selectedShapeId || !editing) return;
    undoBoundary();
    setShapeStyle(doc, selectedShapeId, { fill: c });
    undoBoundary();
  }, [doc, selectedShapeId, editing, undoBoundary]);

  const handleShapeStroke = useCallback((c: StrokeColor) => {
    if (!selectedShapeId || !editing) return;
    undoBoundary();
    setShapeStyle(doc, selectedShapeId, { stroke: c });
    undoBoundary();
  }, [doc, selectedShapeId, editing, undoBoundary]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={cameraApi}
        onEmptyClick={() => selection.clear()}
        onEmptyDblClick={createAtScreenPoint}
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
        tool={tool}
        onTextToolClick={handleTextToolClick}
        onDrop={handleDrop}
      >
        {paintedNotes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            onPointerDown={gesture.onObjectPointerDown}
            onSelect={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            multiSelected={selection.ids.size > 1}
            dragging={gesture.isDragging && selection.ids.has(note.id)}
            undoBoundary={undoBoundary}
            undoCtrl={undoCtrlRef}
          />
        ))}
        {textObjects.map((tobj) => (
          <TextObject
            key={tobj.id}
            note={tobj}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(tobj.id)}
            editing={tobj.id === selection.editingId}
            canEdit={editing}
            onPointerDown={gesture.onObjectPointerDown}
            onSelect={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            multiSelected={selection.ids.size > 1}
            dragging={gesture.isDragging && selection.ids.has(tobj.id)}
            undoBoundary={undoBoundary}
            undoCtrl={undoCtrlRef}
            measure={measure}
          />
        ))}
        {shapeObjects.map((shape) => (
          <ShapeObject
            key={shape.id}
            shape={shape}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(shape.id)}
            editing={shape.id === selection.editingId}
            multiSelected={selection.ids.size > 1}
            dragging={gesture.isDragging && selection.ids.has(shape.id)}
            canEdit={editing}
            onPointerDown={gesture.onObjectPointerDown}
            onSelect={selection.toggle}
            onStartEdit={selection.startEdit}
            onEndEdit={selection.endEdit}
            undoBoundary={undoBoundary}
            undoCtrl={undoCtrlRef}
          />
        ))}
        {strokeObjects.map((stroke) => (
          <StrokeObject
            key={stroke.id}
            stroke={stroke}
            selected={selection.ids.has(stroke.id)}
            zoom={camera.zoom}
            canEdit={editing}
            multiSelected={selection.ids.size > 1}
            dragging={gesture.isDragging && selection.ids.has(stroke.id)}
            onPointerDown={gesture.onObjectPointerDown}
            onSelect={selection.toggle}
          />
        ))}
        {imageObjects.map((img) => (
          <ImageObject
            key={img.id}
            snap={img}
            camera={camera}
            isSelected={selection.ids.has(img.id)}
            onPointerDown={(e: React.PointerEvent) => gesture.onObjectPointerDown(e, img.id)}
            onRetry={retryImage}
          />
        ))}
        <SelectionOverlay
          ids={selection.ids}
          snapshot={objSnapshots}
          camera={camera}
          onHandlePointerDown={gesture.onHandlePointerDown}
          resizable={anyResizable}
        />
        <MarqueeRect rect={marquee.rect} />
      </BoardViewport>

      {/* Connector objects render as fixed overlays */}
      {connectorObjects.map((conn) => (
        <ConnectorObject
          key={conn.id}
          connector={conn}
          rects={rectsMap}
          snapshot={objSnapshots}
          doc={doc}
          camera={camera}
          zoom={camera.zoom}
          selected={selection.ids.has(conn.id)}
          canEdit={editing}
          undoBoundary={undoBoundary}
          onSelect={selection.click}
        />
      ))}

      {/* Shape tool active overlay */}
      {tool === 'shape' && (
        <ShapeTool
          kind={shapeKind}
          camera={camera}
          onCreated={toolCreated}
          createShapeAt={handleCreateShape}
          undoBoundary={undoBoundary}
        />
      )}

      {/* Connector tool active overlay */}
      {tool === 'connector' && (
        <ConnectorTool
          camera={camera}
          snapshot={objSnapshots}
          onCreated={toolCreated}
          createConnectorAt={handleCreateConnector}
          undoBoundary={undoBoundary}
        />
      )}

      {/* Pen tool active overlay */}
      {tool === 'pen' && (
        <PenTool
          camera={camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId="local"
          canEdit={editing}
          undoBoundary={undoBoundary}
        />
      )}

      <Toolbar
        onCreateSticky={createAtCentre}
        disabled={!editing}
        undo={undoApi}
        tool={tool}
        onToolChange={setTool}
        shapeKind={shapeKind}
        onShapeKindChange={setShapeKind}
      />
      {tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={cameraApi.reset}
      />
      <NavigationHint visible={!hasNavigated && notes.length === 0} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        data-testid="image-file-input"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <SharePanel boardId={boardId} />
      {/* Selection bar renders in a fixed position overlay */}
      <div className="selection-bar-overlay" data-testid="selection-bar-overlay">
        <SelectionBar
          ids={selection.ids}
          snapshot={notes}
          onDelete={handleDeleteSelection}
          onColor={handleColor}
          editingId={selection.editingId}
          isDragging={gesture.isDragging}
        />
        {selectedShape && !selection.editingId && (
          <ShapeToolbar
            fill={selectedShape.fill}
            stroke={selectedShape.stroke}
            onFill={handleShapeFill}
            onStroke={handleShapeStroke}
          />
        )}
      </div>
    </>
  );
}

/** A stable order for rendered notes: by id, so raising one moves nothing. */
function byId(a: StickySnapshot, b: StickySnapshot): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
