import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { useCamera } from '../../../src/client/canvas/useCamera';
import { BoardViewport } from '../../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../../src/client/board/useBoardDoc';
import { useSelection } from '../../../src/client/board/useSelection';
import { StickyNote } from '../../../src/client/objects/StickyNote';
import { TextObject } from '../../../src/client/objects/TextObject';
import { ShapeObject } from '../../../src/client/objects/ShapeObject';
import { ShapeToolbar } from '../../../src/client/objects/ShapeToolbar';
import { ConnectorObject } from '../../../src/client/objects/ConnectorObject';
import { StrokeObject } from '../../../src/client/objects/StrokeObject';
import { PenTool, PenPreview } from '../../../src/client/tools/PenTool';
import { PenToolbar } from '../../../src/client/tools/PenToolbar';
import { usePenOptions } from '../../../src/client/tools/usePenOptions';
import { createStroke } from '../../../src/shared/objects/stroke';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import { Toolbar } from '../../../src/client/board/Toolbar';
import { SelectionOverlay } from '../../../src/client/board/SelectionOverlay';
import { SelectionBar } from '../../../src/client/board/SelectionBar';
import { useMarquee, MarqueeRect } from '../../../src/client/board/Marquee';
import { useTransformGesture } from '../../../src/client/board/useTransformGesture';
import { useBoardKeys } from '../../../src/client/board/useBoardKeys';
import { useTool } from '../../../src/client/board/useTool';
import { createUndo, type UndoController } from '../../../src/client/board/undo';
import { useUndo } from '../../../src/client/board/useUndo';
import { createSticky, deleteObjects, isSticky, isTextSnapshot, isShape, isConnector, isStroke, objectBounds } from '../../../src/shared/board-model';
import type { ShapeSnap, ConnectorSnap } from '../../../src/shared/board-model';
import { createText } from '../../../src/shared/objects/text';
import { createShape, setShapeStyle } from '../../../src/shared/objects/shape';
import { createConnector, setConnectorEndpoint } from '../../../src/shared/objects/connector';
import type { Endpoint } from '../../../src/shared/objects/connector';
import type { ShapeKind, FillColor, StrokeColor } from '../../../src/shared/config';
import type { Rect, Point } from '../../../src/shared/geometry';
import { normalizeRect } from '../../../src/shared/geometry';
import type { Camera, Size } from '../../../src/client/canvas/camera';
import { screenToWorld } from '../../../src/client/canvas/camera';

export interface HarnessHandle {
  doc: Y.Doc;
  getCamera(): Camera;
  getSelectedIds(): ReadonlySet<string>;
  /** Backward-compat: returns the single selected id or null. */
  getSelectedId(): string | null;
  getEditingId(): string | null;
  selection: ReturnType<typeof useSelection>;
  undoController: UndoController;
  setTool(t: string): void;
  getTool(): string;
  setShapeKind(k: ShapeKind): void;
  getPenColor(): PenColor;
  setPenColor(c: PenColor): void;
  getPenThickness(): PenThickness;
  setPenThickness(t: PenThickness): void;
}

/** True when the key press belongs to a text field rather than to the board. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Hit-test a world point against non-connector objects. */
function hitTestHarnessObj(objs: readonly import('../../../src/shared/board-model').ObjectSnapshot[], worldPoint: Point): string | null {
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

/** Compute side dots in screen-space for the connector tool. */
function computeDots(r: Rect, camera: Camera, highlightSide: string | null): Array<{ side: string; screenX: number; screenY: number; highlighted: boolean }> {
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  return sides.map((side) => {
    const pt = sideAnchorFn(r, side);
    return {
      side,
      screenX: (pt.x - camera.x) * camera.zoom,
      screenY: (pt.y - camera.y) * camera.zoom,
      highlighted: highlightSide === side,
    };
  });
}

/** Simple nearest-side (same logic as connector-geometry). */
function nearestSideFn(r: Rect, toward: Point): string {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > -45 && angle <= 45) return 'right';
  if (angle > 45 && angle <= 135) return 'bottom';
  if (angle > -135 && angle <= -45) return 'top';
  return 'left';
}

/** Side anchor point. */
function sideAnchorFn(r: Rect, s: string): Point {
  switch (s) {
    case 'top': return { x: r.x + r.width / 2, y: r.y };
    case 'right': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'bottom': return { x: r.x + r.width / 2, y: r.y + r.height };
    default: return { x: r.x, y: r.y + r.height / 2 };
  }
}

export interface BoardHarnessProps {
  handleRef: React.MutableRefObject<HarnessHandle | null>;
  viewport?: Size;
  /** When true, editing (create / drag / colour / delete / text) is disabled. */
  readOnly?: boolean;
}

/**
 * The story 2-7 wiring (document, selection, viewport, toolbar, notes) with the
 * handles a component test needs. Mirrors App.tsx; kept here so tests can reach
 * the Y.Doc and the local state without exposing them in production.
 */
export function BoardHarness({ handleRef, viewport = { width: 1280, height: 800 }, readOnly = false }: BoardHarnessProps) {
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom } = useCamera(viewport);
  const { doc, notes } = useBoardDoc(null);
  const selection = useSelection(notes);
  const editable = !readOnly;
  const { tool, setTool } = useTool(editable);
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');

  // Shape tool state
  const [shapePreview, setShapePreview] = useState<Rect | null>(null);
  const shapeStartRef = useRef<Point | null>(null);
  const shapeSquareRef = useRef(false);
  const shapeDraggingRef = useRef(false);

  // Connector tool state
  const [connDragFrom, setConnDragFrom] = useState<Point | null>(null);
  const [connDragTo, setConnDragTo] = useState<Point | null>(null);
  const [connHoverDots, setConnHoverDots] = useState<Array<{ side: string; screenX: number; screenY: number; highlighted: boolean }>>([]);
  const connStartScreenRef = useRef<Point | null>(null);
  const connStartObjIdRef = useRef<string | null>(null);
  const connDraggingRef = useRef(false);

  // Pen tool state (story 11)
  const penOptions = usePenOptions();

  const marquee = useMarquee(camera, notes, (ids) => selection.setMany(ids, true));

  // Undo controller
  const undoRef = useRef<UndoController | null>(null);
  if (undoRef.current === null) undoRef.current = createUndo(doc);
  const undoController = undoRef.current;
  useEffect(() => () => { undoController.destroy(); }, [undoController]);
  const undoState = useUndo(undoController, editable);

  // Pen tool instance (story 11)
  const penTool = PenTool({
    camera,
    color: penOptions.color,
    thickness: penOptions.thickness,
    doc,
    identityId: 'test-user',
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

  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undoController, tool, setTool, onCreateSticky: () => { createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 }); } });

  const live = useRef({ camera, selection, tool, setTool, setShapeKind, penOptions });
  live.current = { camera, selection, tool, setTool, setShapeKind, penOptions };

  if (!handleRef.current) {
    handleRef.current = {
      doc,
      getCamera: () => live.current.camera,
      getSelectedIds: () => live.current.selection.ids,
      getSelectedId: () => {
        const ids = live.current.selection.ids;
        return ids.size === 1 ? [...ids][0] : null;
      },
      getEditingId: () => live.current.selection.editingId,
      selection: live.current.selection,
      undoController,
      setTool: (t: string) => live.current.setTool(t as any),
      getTool: () => live.current.tool,
      setShapeKind: (k: ShapeKind) => live.current.setShapeKind(k),
      getPenColor: () => live.current.penOptions.color,
      setPenColor: (c: PenColor) => live.current.penOptions.setColor(c),
      getPenThickness: () => live.current.penOptions.thickness,
      setPenThickness: (t: PenThickness) => live.current.penOptions.setThickness(t),
    };
  }

  const createAtScreenPoint = useCallback(
    (point: { x: number; y: number }) => {
      if (readOnly) return;
      undoController.boundary();
      const id = createSticky(doc, screenToWorld(camera, point));
      undoController.boundary();
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, readOnly, undoController],
  );

  const handleEmptyDblClick = useCallback(
    (point: { x: number; y: number }) => createAtScreenPoint(point),
    [createAtScreenPoint],
  );

  const handleToolbarCreate = useCallback(() => {
    createAtScreenPoint({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreenPoint, viewport.width, viewport.height]);

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

  const handleTextToolClick = useCallback(
    (point: { x: number; y: number }) => {
      if (readOnly) return;
      const world = screenToWorld(camera, point);
      undoController.boundary();
      const id = createText(doc, world, 'user');
      undoController.boundary();
      setTool('select');
      if (id) selection.startEdit(id);
    },
    [camera, doc, selection, readOnly, undoController, setTool],
  );

  const handleObjectPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
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

  // --- Shape/Connector/Pen tool handlers ---
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
        connStartObjIdRef.current = hitTestHarnessObj(notes, worldPt);
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
      } else if (tool === 'connector') {
        const worldPt = screenToWorld(camera, { x: p.x, y: p.y });
        const hit = hitTestHarnessObj(notes, worldPt);
        if (connDraggingRef.current) {
          setConnDragTo(worldPt);
          // Highlight target dots if over a different object
          if (hit && hit !== connStartObjIdRef.current) {
            const hitRect = objectBounds(notes.find((o) => o.id === hit)!);
            const side = nearestSideFn(hitRect, worldPt);
            setConnHoverDots(computeDots(hitRect, camera, side));
          } else if (hit && hit === connStartObjIdRef.current) {
            setConnHoverDots([]);
          } else {
            setConnHoverDots([]);
          }
        } else {
          // Hover: show dots
          if (hit) {
            const hitRect = objectBounds(notes.find((o) => o.id === hit)!);
            setConnHoverDots(computeDots(hitRect, camera, null));
          } else {
            setConnHoverDots([]);
          }
        }
      }
    },
    [camera, tool, notes],
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
        const startScreen = { x: (start.x - camera.x) * camera.zoom, y: (start.y - camera.y) * camera.zoom };
        const screenDist = Math.hypot(p.x - startScreen.x, p.y - startScreen.y);
        let rect: Rect | null = null;
        if (screenDist >= 3) {
          let r = normalizeRect(start, endWorld);
          if (shapeSquareRef.current) {
            const side = Math.max(r.width, r.height);
            const x = endWorld.x >= start.x ? start.x : start.x - side;
            const y = endWorld.y >= start.y ? start.y : start.y - side;
            r = { x, y, width: side, height: side };
          }
          rect = (r.width < 20 || r.height < 20) ? null : r;
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
          if (screenDist < 3) { setConnDragFrom(null); setConnDragTo(null); return; }
        }
        const startWorld = screenToWorld(camera, connStartScreenRef.current!);
        const length = Math.hypot(worldPt.x - startWorld.x, worldPt.y - startWorld.y);
        if (length < 8) { setConnDragFrom(null); setConnDragTo(null); return; }

        const startObjId = connStartObjIdRef.current;
        const from: Endpoint = startObjId
          ? { kind: 'attached', objectId: startObjId, fallback: { x: startWorld.x, y: startWorld.y } }
          : { kind: 'free', x: startWorld.x, y: startWorld.y };

        const targetId = hitTestHarnessObj(notes, worldPt);
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
    [camera, tool, doc, notes, selection, setTool, undoController, shapeKind, penTool],
  );

  const handleToolPointerCancel = useCallback(() => {
    penTool.handlePointerCancel();
    shapeDraggingRef.current = false;
    shapeStartRef.current = null;
    setShapePreview(null);
    connDraggingRef.current = false;
    setConnDragFrom(null);
    setConnDragTo(null);
    setConnHoverDots([]);
  }, [penTool]);

  // Build rects map for connectors
  const connectorRects = new Map<string, Rect>();
  for (const obj of notes) {
    if (obj.type !== 'connector') {
      connectorRects.set(obj.id, objectBounds(obj));
    }
  }

  // Enter edits the selected note (single sticky only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selection.editingId || selection.ids.size !== 1 || isTextEntry(e.target)) return;
      if (readOnly) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        const [id] = selection.ids;
        selection.startEdit(id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selection, readOnly]);

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={gestureZoom}
        onEmptyClick={handleEmptyClick}
        onEmptyDblClick={handleEmptyDblClick}
        onMarqueeBegin={(p) => marquee.begin(p)}
        onMarqueeMove={(p) => marquee.move(p)}
        onMarqueeEnd={() => marquee.end()}
        onMarqueeCancel={() => marquee.cancel()}
        tool={tool}
        onTextToolClick={handleTextToolClick}
        onToolPointerDown={handleToolPointerDown}
        onToolPointerMove={handleToolPointerMove}
        onToolPointerUp={handleToolPointerUp}
        onToolPointerCancel={handleToolPointerCancel}
        connectorDots={tool === 'connector' ? connHoverDots : undefined}
        connectorDragLine={tool === 'connector' && connDragFrom && connDragTo ? {
          fromX: (connDragFrom.x - camera.x) * camera.zoom,
          fromY: (connDragFrom.y - camera.y) * camera.zoom,
          toX: (connDragTo.x - camera.x) * camera.zoom,
          toY: (connDragTo.y - camera.y) * camera.zoom,
        } : null}
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
            editable={!readOnly}
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
            editable={!readOnly}
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
            editable={!readOnly}
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
      </BoardViewport>
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
            pointerEvents: 'none',
            zIndex: 20,
          }}
        />
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
      {/* Pen toolbar when pen tool is active */}
      {tool === 'pen' && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      <Toolbar onCreateSticky={handleToolbarCreate} disabled={readOnly} undo={undoState} tool={tool} onToolChange={setTool} shapeKind={shapeKind} onShapeKindChange={setShapeKind} />
      {/* Shape toolbar when single shape selected */}
      {(() => {
        const selectedShape = notes.find((o) => o.type === 'shape' && selection.ids.has(o.id)) as ShapeSnap | undefined;
        if (!selectedShape || selection.editingId) return null;
        return (
          <ShapeToolbar
            fill={selectedShape.fill}
            stroke={selectedShape.stroke}
            onFill={(c) => { undoController.boundary(); setShapeStyle(doc, selectedShape.id, { fill: c }); undoController.boundary(); }}
            onStroke={(c) => { undoController.boundary(); setShapeStyle(doc, selectedShape.id, { stroke: c }); undoController.boundary(); }}
          />
        );
      })()}
    </>
  );
}
