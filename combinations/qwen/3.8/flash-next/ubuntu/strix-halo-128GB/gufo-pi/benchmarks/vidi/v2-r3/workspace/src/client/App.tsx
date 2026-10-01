import React, { useEffect, useCallback, useState, useRef } from 'react';
import type * as Y from 'yjs';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import type { Size } from './canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut, screenToWorld, worldToScreen } from './canvas/camera';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { canEdit } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { StickyNote } from './objects/StickyNote';
import { TextObject } from './objects/TextObject';
import { SelectionOverlay } from './board/SelectionOverlay';
import { SelectionBar } from './board/SelectionBar';
import { useMarquee, MarqueeRect } from './board/Marquee';
import { useTransformGesture } from './board/useTransformGesture';
import { useBoardKeys } from './board/useBoardKeys';
import { useTool } from './board/useTool';
import type { Tool } from './board/useTool';
import { createUndo, type UndoController } from './board/undo';
import { useUndo } from './board/useUndo';
import { createSticky, deleteObjects, snapshot, LOCAL_ORIGIN, isSticky, isTextSnapshot, isShape, isConnector, isStroke, isImage, objectBounds } from '../shared/board-model';
import type { ObjectSnapshot, StickySnapshot, ShapeSnap, ConnectorSnap } from '../shared/board-model';
import type { ImageSnap } from '../shared/board-model';
import type { Rect, Point } from '../shared/geometry';
import { normalizeRect } from '../shared/geometry';
import { DRAG_THRESHOLD_PX, SHAPE_MIN_SIZE_WORLD, CONNECTOR_MIN_LENGTH_WORLD } from '../shared/config';
import { createText, setTextSize } from '../shared/objects/text';
import { createShape, setShapeStyle, getShapeLabel } from '../shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../shared/objects/connector';
import type { Endpoint } from '../shared/objects/connector';
import { resolveEndpoints } from '../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../shared/geometry/polyline';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../shared/config';
import { ShapeObject } from './objects/ShapeObject';
import { ShapeToolbar } from './objects/ShapeToolbar';
import { ConnectorObject } from './objects/ConnectorObject';
import { StrokeObject } from './objects/StrokeObject';
import { PenTool, PenPreview } from './tools/PenTool';
import { PenToolbar } from './tools/PenToolbar';
import { usePenOptions } from './tools/usePenOptions';
import { createStroke } from '../shared/objects/stroke';
import type { PenColor, PenThickness } from '../shared/config';
import type { ShapeKind, FillColor, StrokeColor } from '../shared/config';
import { registerTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { useImageInsert } from './images/useImageInsert';
import { DropHighlight } from './images/DropHighlight';
import { ImageObject } from './objects/ImageObject';
import { ToastContainer, useToast } from './ui/Toast';

/**
 * BoardUI: the board UI with multi-selection support (stories 1-7).
 */
export function BoardUI({ boardId }: { boardId: string }) {
  const [viewport, setViewport] = useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureZoom,
    zoomStep,
    reset,
    setCamera,
  } = useCamera(viewport);

  const { doc, notes, connectionState } = useBoardDoc(boardId);
  const selection = useSelection(notes);
  const editable = canEdit(connectionState);
  const { tool, setTool } = useTool(editable);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  // Shape tool state
  const [shapePreview, setShapePreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeSquareRef = useRef(false);
  const shapeDraggingRef = useRef(false);

  // Connector tool state
  const [connDragFrom, setConnDragFrom] = useState<{ x: number; y: number } | null>(null);
  const [connDragTo, setConnDragTo] = useState<{ x: number; y: number } | null>(null);
  const connStartScreenRef = useRef<{ x: number; y: number } | null>(null);
  const connStartObjIdRef = useRef<string | null>(null);
  const connDraggingRef = useRef(false);

  // Pen tool state (story 11)
  const penOptions = usePenOptions();

  // Toast and image insert (story 12)
  const toast = useToast();
  const imageInsert = useImageInsert({
    doc,
    boardId,
    camera,
    connection: connectionState,
    identityId: 'user',
    viewport,
    showToast: toast.show,
    onToolReset: () => setTool('select'),
  });

  // Clock tick for image object status updates (re-render every 30s while images are uploading)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const hasUploading = notes.some((o) => o.type === 'image' && (o as ImageSnap).status === 'uploading');
    if (!hasUploading) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [notes]);

  // One undo controller per board doc, destroyed on board change/unmount (session-only history)
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  const undoController = undoRef.current;
  useEffect(() => {
    return () => {
      undoController.destroy();
    };
  }, [undoController]);
  const undoState = useUndo(undoController, editable);

  const marquee = useMarquee(camera, notes, (ids) => selection.setMany(ids, true));

  // Pen tool instance
  const penTool = PenTool({
    camera,
    color: penOptions.color,
    thickness: penOptions.thickness,
    doc,
    identityId: 'user',
    active: tool === 'pen',
    onBeforeCommit: undoController.boundary,
    onAfterCommit: undoController.boundary,
  });

  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    onGestureStart: undoController.boundary,
    onGestureEnd: undoController.boundary,
  });

  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undoController, tool, setTool, onCreateSticky: () => createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 }) });

  // Track viewport size
  useEffect(() => {
    const handleResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Image drag and paste handlers (story 12)
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => { imageInsert.onDragOver(e); };
    const handleDragLeave = (e: DragEvent) => { imageInsert.onDragLeave(e); };
    const handleDrop = (e: DragEvent) => { imageInsert.onDrop(e); };
    const handlePaste = (e: ClipboardEvent) => { imageInsert.onPaste(e); };
    const handleKeyDown = (e: KeyboardEvent) => {
      // I key opens image picker (story 12)
      if (isTextEntry(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        imageInsert.openPicker();
      }
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [imageInsert]);

  // Register test hooks (no-op outside the test build mode)
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useEffect(() => {
    registerTestHooks({
      setCamera,
      getBoard: () => snapshot(doc),
      addSticky: (at, text, color) => {
        undoController.boundary();
        const id = createSticky(doc, at, (color as any) ?? undefined);
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          const t = m.get('text') as Y.Text;
          doc.transact(() => t.insert(0, text), LOCAL_ORIGIN);
        }
        undoController.boundary();
        return id;
      },
      addText: (at, text, size) => {
        undoController.boundary();
        const id = createText(doc, at, 'test-user');
        if (id && text) {
          const m = doc.getMap('objects').get(id) as Y.Map<unknown>;
          const t = m.get('text') as Y.Text;
          doc.transact(() => t.insert(0, text), LOCAL_ORIGIN);
        }
        if (id && size) {
          setTextSize(doc, id, size);
        }
        undoController.boundary();
        return id!;
      },
      getSelectedIds: () => [...selectionRef.current.ids],
      addShape: (opts) => {
        undoController.boundary();
        const id = createShape(doc, { kind: opts.kind ?? 'rect', rect: opts.rect ?? null, at: opts.at ?? { x: 0, y: 0 } }, 'test-user');
        undoController.boundary();
        return id!;
      },
      addConnector: (from, to) => {
        undoController.boundary();
        const id = createConnector(doc, from, to, 'test-user');
        undoController.boundary();
        return id!;
      },
    });
  }, [setCamera, doc, undoController]);

  // Expose connection state for e2e tests
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as any).__vidi6 = (window as any).__vidi6 || {};
      (window as any).__vidi6.connectionState = connectionState;
    }
  }, [connectionState]);

  // Zoom keyboard shortcuts (Ctrl/Cmd + / - / 0)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          zoomStep('in');
        } else if (e.key === '-') {
          e.preventDefault();
          zoomStep('out');
        } else if (e.key === '0') {
          e.preventDefault();
          reset();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset]);

  // Enter edits the selected note (single sticky only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1 || isTextEntry(e.target)) return;
      if (!editable) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const [id] = selection.ids;
        selection.startEdit(id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, editable]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  // A new note lands centred on the given screen point and opens for typing.
  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createSticky(doc, world);
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable, undoController],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport]);

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => {
      createAtScreenPoint(point);
    },
    [createAtScreenPoint],
  );

  const handleEmptyClick = useCallback(() => {
    selection.clear();
  }, [selection]);

  const handleDeleteSelection = useCallback(() => {
    if (!editable) return;
    undoController.boundary();
    deleteObjects(doc, [...selection.ids]);
    undoController.boundary();
    selection.clear();
  }, [doc, selection, editable, undoController]);

  const handleMarqueeBegin = useCallback((p: { x: number; y: number }) => {
    marquee.begin(p);
  }, [marquee]);

  const handleMarqueeMove = useCallback((p: { x: number; y: number }) => {
    marquee.move(p);
  }, [marquee]);

  const handleMarqueeEnd = useCallback(() => {
    marquee.end();
  }, [marquee]);

  const handleMarqueeCancel = useCallback(() => {
    marquee.cancel();
  }, [marquee]);

  const handleTextToolClick = useCallback(
    (point: { x: number; y: number }) => {
      if (!editable) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createText(doc, world, 'user');
      undoController.boundary();
      setTool('select');
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, editable, undoController, setTool],
  );

  const handleObjectPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      gesture.onObjectPointerDown(e, id);
    },
    [gesture],
  );

  const handleHandlePointerDown = useCallback(
    (e: React.PointerEvent, handle: any) => {
      gesture.onHandlePointerDown(e, handle);
    },
    [gesture],
  );

  // --- Shape tool handlers ---
  const handleToolPointerDown = useCallback(
    (p: { x: number; y: number; shiftKey: boolean }) => {
      if (tool === 'pen') {
        penTool.handlePointerDown(p.x, p.y);
      } else if (tool === 'shape') {
        shapeStartRef.current = screenToWorld(camera, { x: p.x, y: p.y });
        shapeSquareRef.current = p.shiftKey;
        shapeDraggingRef.current = true;
        setShapePreview(null);
      } else if (tool === 'connector') {
        const worldPt = screenToWorld(camera, { x: p.x, y: p.y });
        connStartScreenRef.current = { x: p.x, y: p.y };
        connStartObjIdRef.current = hitTestObject(notes, worldPt);
        connDraggingRef.current = true;
        setConnDragFrom(worldPt);
        setConnDragTo(worldPt);
      }
    },
    [camera, tool, notes, penTool],
  );

  const handleToolPointerMove = useCallback(
    (p: { x: number; y: number; shiftKey: boolean }) => {
      if (tool === 'pen') {
        penTool.handlePointerMove(p.x, p.y);
      } else if (tool === 'shape' && shapeDraggingRef.current && shapeStartRef.current) {
        shapeSquareRef.current = p.shiftKey;
        const startWorld = shapeStartRef.current;
        const currentWorld = screenToWorld(camera, { x: p.x, y: p.y });
        let r = normalizeRect(startWorld, currentWorld);
        if (shapeSquareRef.current && (r.width >= 20 || r.height >= 20)) {
          const side = Math.max(r.width, r.height);
          const x = currentWorld.x >= startWorld.x ? startWorld.x : startWorld.x - side;
          const y = currentWorld.y >= startWorld.y ? startWorld.y : startWorld.y - side;
          r = { x, y, width: side, height: side };
        }
        setShapePreview(r);
      } else if (tool === 'connector' && connDraggingRef.current) {
        const worldPt = screenToWorld(camera, { x: p.x, y: p.y });
        setConnDragTo(worldPt);
      }
    },
    [camera, tool, penTool],
  );

  const handleToolPointerUp = useCallback(
    (p: { x: number; y: number }) => {
      if (tool === 'pen') {
        penTool.handlePointerUp(p.x, p.y);
        return;
      }
      if (tool === 'shape' && shapeDraggingRef.current) {
        shapeDraggingRef.current = false;
        const start = shapeStartRef.current!;
        const endWorld = screenToWorld(camera, { x: p.x, y: p.y });
        const screenDist = Math.hypot(p.x - worldToScreen(camera, start).x, p.y - worldToScreen(camera, start).y);
        let rect: Rect | null = null;
        if (screenDist >= DRAG_THRESHOLD_PX) {
          let r = normalizeRect(start, endWorld);
          if (shapeSquareRef.current) {
            const side = Math.max(r.width, r.height);
            const x = endWorld.x >= start.x ? start.x : start.x - side;
            const y = endWorld.y >= start.y ? start.y : start.y - side;
            r = { x, y, width: side, height: side };
          }
          rect = (r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) ? null : r;
        }
        setShapePreview(null);
        undoController.boundary();
        const id = createShape(doc, { kind: shapeKind, rect, at: start, square: shapeSquareRef.current }, 'user');
        undoController.boundary();
        if (id) { selection.click(id); setTool('select'); }
        shapeStartRef.current = null;
      } else if (tool === 'connector' && connDraggingRef.current) {
        connDraggingRef.current = false;
        const worldPt = screenToWorld(camera, { x: p.x, y: p.y });
        const start = connStartScreenRef.current;
        if (start) {
          const screenDist = Math.hypot(p.x - start.x, p.y - start.y);
          if (screenDist < DRAG_THRESHOLD_PX) { setConnDragFrom(null); setConnDragTo(null); return; }
        }
        const startWorld = screenToWorld(camera, connStartScreenRef.current!);
        const length = Math.hypot(worldPt.x - startWorld.x, worldPt.y - startWorld.y);
        if (length < CONNECTOR_MIN_LENGTH_WORLD) { setConnDragFrom(null); setConnDragTo(null); return; }

        const startObjId = connStartObjIdRef.current;
        const from: Endpoint = startObjId
          ? { kind: 'attached', objectId: startObjId, fallback: { x: startWorld.x, y: startWorld.y } }
          : { kind: 'free', x: startWorld.x, y: startWorld.y };

        const targetId = hitTestObject(notes, worldPt);
        let to: Endpoint;
        if (targetId && targetId !== startObjId) {
          to = { kind: 'attached', objectId: targetId, fallback: { x: worldPt.x, y: worldPt.y } };
        } else if (targetId && targetId === startObjId) {
          setConnDragFrom(null); setConnDragTo(null); return;
        } else {
          to = { kind: 'free', x: worldPt.x, y: worldPt.y };
        }

        undoController.boundary();
        const id = createConnector(doc, from, to, 'user');
        undoController.boundary();
        if (id) { selection.click(id); setTool('select'); }
        setConnDragFrom(null); setConnDragTo(null);
      }
    },
    [camera, tool, doc, notes, selection, setTool, undoController, shapeKind],
  );

  const handleToolPointerCancel = useCallback(() => {
    penTool.handlePointerCancel();
    shapeDraggingRef.current = false;
    shapeStartRef.current = null;
    setShapePreview(null);
    connDraggingRef.current = false;
    setConnDragFrom(null);
    setConnDragTo(null);
  }, [penTool]);

  // Build rects map for connectors
  const connectorRects = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const obj of notes) {
    if (obj.type !== 'connector') {
      connectorRects.set(obj.id, objectBounds(obj));
    }
  }

  // Shape toolbar actions
  const selectedShape = notes.find((o) => o.type === 'shape' && selection.ids.has(o.id)) as ShapeSnap | undefined;
  const handleShapeFill = useCallback((c: FillColor) => {
    if (!selectedShape) return;
    undoController.boundary();
    setShapeStyle(doc, selectedShape.id, { fill: c });
    undoController.boundary();
  }, [doc, selectedShape, undoController]);
  const handleShapeStroke = useCallback((c: StrokeColor) => {
    if (!selectedShape) return;
    undoController.boundary();
    setShapeStyle(doc, selectedShape.id, { stroke: c });
    undoController.boundary();
  }, [doc, selectedShape, undoController]);

  return (
    <>
      <ConnectionStatus state={connectionState} />
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={handleGestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onMarqueeBegin={handleMarqueeBegin}
        onMarqueeMove={handleMarqueeMove}
        onMarqueeEnd={handleMarqueeEnd}
        onMarqueeCancel={handleMarqueeCancel}
        tool={tool}
        onTextToolClick={handleTextToolClick}
        onToolPointerDown={handleToolPointerDown}
        onToolPointerMove={handleToolPointerMove}
        onToolPointerUp={handleToolPointerUp}
        onToolPointerCancel={handleToolPointerCancel}
      >
        {notes.filter(isSticky).map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(note.id)}
            editing={note.id === selection.editingId}
            dragging={gesture.draggingIds.has(note.id)}
            onSelect={(id) => {
              if (selection.ids.has(id) && selection.ids.size === 1) return;
              selection.click(id);
            }}
            onStartEdit={selection.startEdit}
            onEndEdit={(next) => {
              if (next === 'unselected') selection.clear();
              else selection.endEdit();
            }}
            onObjectPointerDown={handleObjectPointerDown}
            editable={editable}
            undoController={undoController}
          />
        ))}
        {notes.filter(isTextSnapshot).map((obj) => (
          <TextObject
            key={obj.id}
            note={obj}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(obj.id)}
            editing={obj.id === selection.editingId}
            dragging={gesture.draggingIds.has(obj.id)}
            onSelect={(id) => {
              if (selection.ids.has(id) && selection.ids.size === 1) return;
              selection.click(id);
            }}
            onStartEdit={selection.startEdit}
            onEndEdit={(next) => {
              if (next === 'unselected') selection.clear();
              else selection.endEdit();
            }}
            onObjectPointerDown={handleObjectPointerDown}
            editable={editable}
            undoController={undoController}
          />
        ))}
        {notes.filter(isShape).map((obj) => (
          <ShapeObject
            key={obj.id}
            shape={obj}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.ids.has(obj.id)}
            editing={obj.id === selection.editingId}
            dragging={gesture.draggingIds.has(obj.id)}
            onSelect={(id) => {
              if (selection.ids.has(id) && selection.ids.size === 1) return;
              selection.click(id);
            }}
            onStartEdit={selection.startEdit}
            onEndEdit={(next) => {
              if (next === 'unselected') selection.clear();
              else selection.endEdit();
            }}
            onObjectPointerDown={handleObjectPointerDown}
            editable={editable}
            undoController={undoController}
          />
        ))}
        {notes.filter(isConnector).map((obj) => (
          <ConnectorObject
            key={obj.id}
            connector={obj}
            rects={connectorRects}
            doc={doc}
            selected={selection.ids.has(obj.id)}
            zoom={camera.zoom}
          />
        ))}
        {notes.filter(isStroke).map((obj) => (
          <StrokeObject
            key={obj.id}
            stroke={obj}
            selected={selection.ids.has(obj.id)}
          />
        ))}
        {notes.filter(isImage).map((obj) => (
          <ImageObject
            key={obj.id}
            image={obj}
            isUploader={obj.uploaderId === 'user'}
            progress={imageInsert.progress.get(obj.id)}
            canRetry={imageInsert.canRetry(obj.id)}
            now={now}
            onRetry={() => imageInsert.retry(obj.id)}
            onRemove={() => { undoController.boundary(); deleteObjects(doc, [obj.id]); undoController.boundary(); }}
          />
        ))}
      </BoardViewport>
      <DropHighlight visible={imageInsert.isDragging} />
      {/* Shape preview overlay */}
      {shapePreview && (
        <div
          data-testid="shape-preview"
          style={{
            position: 'fixed',
            left: (shapePreview.x - camera.x) * camera.zoom,
            top: (shapePreview.y - camera.y) * camera.zoom,
            width: shapePreview.width * camera.zoom,
            height: shapePreview.height * camera.zoom,
            border: '2px dashed #1976D2',
            backgroundColor: 'rgba(25,118,210,0.05)',
            pointerEvents: 'none',
            zIndex: 20,
          }}
        />
      )}
      {/* Connector drag line */}
      {connDragFrom && connDragTo && (
        <svg style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 20 }}>
          <line
            x1={(connDragFrom.x - camera.x) * camera.zoom}
            y1={(connDragFrom.y - camera.y) * camera.zoom}
            x2={(connDragTo.x - camera.x) * camera.zoom}
            y2={(connDragTo.y - camera.y) * camera.zoom}
            stroke="#1976D2"
            strokeWidth={2}
            strokeDasharray="6 3"
          />
        </svg>
      )}
      {/* Pen preview overlay */}
      {tool === 'pen' && penTool.previewPoints.length > 0 && (
        <PenPreview
          points={penTool.previewPoints}
          camera={camera}
          thickness={penOptions.thickness}
          color={penOptions.color}
        />
      )}
      <MarqueeRect rect={marquee.rect} camera={camera} />
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={camera}
        onHandlePointerDown={handleHandlePointerDown}
      />
      <SelectionBar
        ids={selection.ids}
        snapshot={notes}
        onDelete={handleDeleteSelection}
      />
      {/* Shape toolbar when a single shape is selected */}
      {selectedShape && !selection.editingId && (
        <div style={{ position: 'fixed', left: 70, top: '50%', transform: 'translateY(-50%)', zIndex: 30 }}>
          <ShapeToolbar
            fill={selectedShape.fill}
            stroke={selectedShape.stroke}
            onFill={handleShapeFill}
            onStroke={handleShapeStroke}
          />
        </div>
      )}
      {/* Pen toolbar when pen tool is active */}
      {tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={!editable} undo={undoState} tool={tool} onToolChange={setTool} shapeKind={shapeKind} onShapeKindChange={setShapeKind} onImagePick={imageInsert.openPicker} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ToastContainer messages={toast.messages} />
    </>
  );
}

/** True when a key press belongs to a text field rather than to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Hit-test a world point against non-connector objects; returns topmost id or null. */
function hitTestObject(objs: readonly ObjectSnapshot[], worldPoint: Point): string | null {
  for (let i = objs.length - 1; i >= 0; i--) {
    const obj = objs[i];
    if (obj.type === 'connector') continue;
    const r = objectBounds(obj);
    if (worldPoint.x >= r.x && worldPoint.x <= r.x + r.width &&
        worldPoint.y >= r.y && worldPoint.y <= r.y + r.height) {
      return obj.id;
    }
  }
  return null;
}

/** Backward-compatible export for tests that import App */
export { BoardUI as App };
