/**
 * Board page (story 5, share.pages).
 *
 * States:
 *   malformed id    → NotFoundPage (no request sent)
 *   checking        → "Opening board…"
 *   ready           → board UI (stories 1-4) + SharePanel
 *   not_found       → NotFoundPage
 *   unreachable     → "Couldn't reach vidi6. Retrying…" with backoff
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { isValidBoardId } from '../../shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../shared/config';
import { checkBoard } from '../api';
import { NotFoundPage } from './NotFoundPage';
import { SharePanel } from '../share/SharePanel';
import type { Size } from '../canvas/camera';
import type { ConnectionState } from '../sync/connectBoard';

/**
 * Edit gate: the board is editable in every phase except `load_failed`
 * (room rejected the sync; retrying). `null` (local mode / test harness) is
 * editable.
 */
export function canEdit(phase: ConnectionState | null): boolean {
  return phase !== 'load_failed';
}
import { canZoomIn, canZoomOut, zoomPercent } from '../canvas/camera';
import { useCamera } from '../canvas/useCamera';
import { BoardViewport } from '../canvas/BoardViewport';
import { ZoomControls } from '../canvas/ZoomControls';
import { NavigationHint } from '../canvas/NavigationHint';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useBoardActions } from '../board/useBoardActions';
import { useBoardKeys } from '../board/useBoardKeys';
import { useTransformGesture } from '../board/useTransformGesture';
import { useTool } from '../board/useTool';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { createMeasurer, type Measurer } from '../objects/textLayout';
import { deleteObjects, hasObject, objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import { createText, deleteIfEmpty, isEmptyText } from '../../shared/objects/text';
import { createShape, setShapeStyle, getShapeLabel } from '../../shared/objects/shape';
import { createConnector, setConnectorEndpoint, type Endpoint } from '../../shared/objects/connector';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { DEFAULT_TEXT_SIZE, SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Point } from '../canvas/camera';

import { ShapeToolbar } from '../objects/ShapeToolbar';
import { ConnectorObject } from '../objects/ConnectorObject';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import type { Rect } from '../../shared/geometry';
import { objectBounds as getBounds } from '../../shared/board-model';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { getSessionId } from '../../shared/objects/text';
import { useImageInsert } from '../images/useImageInsert';
import { DropHighlight } from '../images/DropHighlight';
import { useToast, Toast } from '../ui/Toast';

type BoardPageState = 'checking' | 'ready' | 'not_found' | 'unreachable';

export function BoardPage({ id }: { id: string }) {
  // Malformed id → immediate NotFoundPage, no request.
  if (!isValidBoardId(id)) {
    return <NotFoundPage />;
  }
  return <BoardPageInner id={id} />;
}

function BoardPageInner({ id }: { id: string }) {
  const [state, setState] = useState<BoardPageState>('checking');
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const unmountedRef = useRef(false);

  // Board existence check with exponential backoff.
  const doCheck = useCallback(async () => {
    const result = await checkBoard(id);
    if (unmountedRef.current) return;
    if (result.kind === 'exists') {
      setState('ready');
    } else if (result.kind === 'not_found') {
      setState('not_found');
    } else {
      // unreachable: schedule a retry with exponential backoff
      setState('unreachable');
      const attempt = attemptRef.current;
      attemptRef.current += 1;
      const delay = Math.min(
        BOARD_CHECK_RETRY_BASE_MS * 2 ** attempt,
        RECONNECT_MAX_BACKOFF_MS,
      );
      retryTimerRef.current = setTimeout(() => {
        doCheck();
      }, delay);
    }
  }, [id]);

  useEffect(() => {
    unmountedRef.current = false;
    doCheck();
    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [doCheck]);

  if (state === 'checking') {
    return (
      <div className="vidi6-board-loading" data-testid="board-loading">
        Opening board…
      </div>
    );
  }

  if (state === 'not_found') {
    return <NotFoundPage />;
  }

  if (state === 'unreachable') {
    return (
      <div className="vidi6-board-unreachable" data-testid="board-unreachable">
        Couldn't reach vidi6. Retrying…
      </div>
    );
  }

  // state === 'ready': render the board UI. The key remounts the whole
  // content (fresh doc connection AND a fresh per-user undo history) when
  // navigating between boards.
  return <BoardContent key={id} id={id} />;
}

/**
 * The actual board UI (stories 1-4). Rendered only when the board exists.
 */
function BoardContent({ id }: { id: string }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const api = useCamera(size);
  const { doc, notes, connectionPhase } = useBoardDoc(id);
  // One per-user undo controller per doc (story 8, undo.history). Session
  // only: destroyed on unmount, a fresh one starts empty (undo.session_only).
  const [undo] = useState(() => createUndo(doc));
  useEffect(() => () => undo.destroy(), [undo]);
  const selection = useSelection(notes, (id) => hasObject(doc, id));
  const editable = canEdit(connectionPhase);
  const undoState = useUndo(undo, editable);
  const boundary = useCallback(() => undo.boundary(), [undo]);
  const actions = useBoardActions({ doc, api, size, selection, editable });
  const gesture = useTransformGesture({
    doc,
    camera: api.camera,
    selection,
    snapshot: notes,
    canEdit: editable,
    // Step boundaries (story 8, undo.boundaries): one gesture = one step.
    onGestureStart: boundary,
    onGestureEnd: boundary,
  });
  const { tool, setTool, shapeKind, setShapeKind } = useTool(editable);
  // Story 11: pen options (session state) and the identity for createdBy.
  const pen = usePenOptions();
  const identityId = useMemo(() => getSessionId(), []);
  const measurer = useMemo(() => createMeasurer(), []);

  // Story 12: image insertion (drop, paste, picker).
  const { toast, showToast, dismissToast } = useToast();
  const imageInsert = useImageInsert({
    doc,
    boardId: id,
    camera: api.camera,
    size,
    connection: connectionPhase,
    identityId,
    showToast,
  });

  // Paste listener on window (story 12, image.paste).
  useEffect(() => {
    const handler = (e: ClipboardEvent) => imageInsert.onPaste(e);
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [imageInsert.onPaste]);

  // Creation and deletion are single steps (story 8, undo.boundaries).
  const createStickyAt = (point: Parameters<typeof actions.createAtScreenPoint>[0]) => {
    boundary();
    actions.createAtScreenPoint(point);
    boundary();
  };
  const createStickyCentre = () => {
    boundary();
    actions.createAtCentre();
    boundary();
  };

  useBoardKeys({
    doc, selection, snapshot: notes, canEdit: editable, undo,
    tool, setTool, onCreateStickyCentre: createStickyCentre, shapeKind,
    onOpenImagePicker: imageInsert.openPicker,
  });
  const marquee = useMarquee(api.camera, notes, (ids) => selection.setMany(ids, true));

  // Story 9: create a text at a screen point (text tool click).
  const createTextAt = useCallback((screenPoint: Point) => {
    if (!editable) return;
    boundary();
    const world = screenToWorld(api.camera, screenPoint);
    const id = createText(doc, LOCAL_ORIGIN, world, DEFAULT_TEXT_SIZE);
    if (id) {
      selection.setMany([id], false);
      selection.startEdit(id);
    }
    boundary();
    setTool('select');
  }, [doc, api, editable, selection, setTool]);

  // Story 10: shape tool - create a shape from a drag or click.
  const createShapeAt = useCallback((rect: Rect | null, at: Point, square: boolean) => {
    if (!editable) return;
    boundary();
    const id = createShape(doc, { kind: shapeKind, rect, at, square });
    if (id) {
      selection.setMany([id], false);
    }
    boundary();
    setTool('select');
  }, [doc, editable, selection, setTool, shapeKind]);

  // Story 10: connector tool - create a connector from a drag.
  const handleConnectorDragEnd = useCallback((from: Point, to: Point) => {
    if (!editable) return;
    // Hit-test: find the object under the start and end points.
    const hitFrom = findObjectAtPoint(notes, from);
    const hitTo = findObjectAtPoint(notes, to);

    const fromEp: Endpoint = hitFrom
      ? { kind: 'attached', objectId: hitFrom, fallback: from }
      : { kind: 'free', x: from.x, y: from.y };
    const toEp: Endpoint = hitTo
      ? { kind: 'attached', objectId: hitTo, fallback: to }
      : { kind: 'free', x: to.x, y: to.y };

    boundary();
    const id = createConnector(doc, fromEp, toEp);
    if (id) {
      selection.setMany([id], false);
    }
    boundary();
    setTool('select');
  }, [doc, notes, editable, selection, setTool]);

  // Story 10: find the object at a world point (hit-testing for connector tool).
  // Story 11: pass the zoom so line hit tolerances (strokes) scale in screen px.
  const findObjectAtPoint = useCallback((snapshot: typeof notes, p: Point): string | null => {
    for (const o of snapshot) {
      const spec = getObjectType(o.type);
      if (!spec) continue;
      if (o.type === 'connector') continue; // Don't hit-test connectors for connector creation.
      if (spec.hitTest(o, p, api.camera.zoom)) return o.id;
    }
    return null;
  }, [api.camera.zoom]);

  // Story 10: shape style changes (from the ShapeToolbar).
  const handleShapeFillChange = useCallback((color: string) => {
    if (!editable || selection.ids.size !== 1) return;
    const id = [...selection.ids][0]!;
    boundary();
    setShapeStyle(doc, id, { fill: color });
    boundary();
  }, [doc, editable, selection, boundary]);

  const handleShapeStrokeChange = useCallback((color: string) => {
    if (!editable || selection.ids.size !== 1) return;
    const id = [...selection.ids][0]!;
    boundary();
    setShapeStyle(doc, id, { stroke: color });
    boundary();
  }, [doc, editable, selection, boundary]);

  // Story 10: shape label editing (double-click / Enter).
  const handleShapeLabelEdit = useCallback((id: string) => {
    // For now, shape label editing uses the same Y.Text mechanism as text.
    // The ShapeObject component handles the editing UI.
  }, []);

  // Story 10: connector reconnection (drag endpoint while selected).
  // This is handled in a future story; for now, the connector is not
  // resizable or reconnectable via the selection bar.

  const handleEndEdit = useCallback(() => {
    const editingId = selection.editingId;
    if (editingId !== null && isEmptyText(doc, editingId)) {
      deleteIfEmpty(doc, LOCAL_ORIGIN, editingId);
      selection.clear();
      return;
    }
    selection.endEdit();
  }, [doc, selection]);

  const deleteSelection = () => {
    if (!editable) return;
    boundary();
    if (deleteObjects(doc, [...selection.ids]) > 0) selection.clear();
    boundary();
  };

  // Bounding box of the selection (world units) → the bar's anchor (screen).
  const selectedObjects = notes.filter((o) => selection.ids.has(o.id));
  const box = unionRects(selectedObjects.map(objectBounds));
  let barAnchor: { x: number; y: number } | null = null;
  if (box !== null) {
    const topLeft = worldToScreen(api.camera, { x: box.x, y: box.y });
    barAnchor = { x: topLeft.x + (box.width * api.camera.zoom) / 2, y: topLeft.y - 8 };
  }

  // Story 10: connector overlay - resolve endpoints and render connectors.
  const rectsMap = useMemo(() => {
    const m = new Map<string, Rect>();
    for (const o of notes) {
      const b = getBounds(o);
      m.set(o.id, { x: b.x, y: b.y, width: b.width, height: b.height });
    }
    return m;
  }, [notes]);

  const connectors = notes.filter((o) => o.type === 'connector' && o.from && o.to);

  // Story 10: connection dots for the connector tool.
  const connectionDots = useMemo(() => {
    if (tool !== 'connector') return [];
    const dots: Array<{ x: number; y: number; objectId: string }> = [];
    for (const o of notes) {
      if (o.type === 'connector') continue;
      const b = getBounds(o);
      // Show a dot at the centre of each object.
      dots.push({ x: b.x + b.width / 2, y: b.y + b.height / 2, objectId: o.id });
    }
    return dots;
  }, [notes, tool]);

  // Story 10: shape toolbar state.
  const selectedShape = selectedObjects.find((o) => o.type === 'shape');
  const selectedConnector = selectedObjects.find((o) => o.type === 'connector');
  const showShapeToolbar = (selectedShape || selectedConnector) && selection.ids.size === 1 && selection.editingId === null && editable;

  return (
    <div className="vidi6-shell" ref={shellRef}>
      <BoardViewport
        api={api}
        onCreateStickyAt={createStickyAt}
        onEmptyClick={() => selection.clear()}
        marquee={marquee}
        tool={tool}
        onCreateTextAt={createTextAt}
        onCreateShapeAt={createShapeAt}
        onConnectorDragEnd={handleConnectorDragEnd}
        onDragEnter={imageInsert.onDragEnter}
        onDragOver={imageInsert.onDragOver}
        onDragLeave={imageInsert.onDragLeave}
        onDrop={imageInsert.onDrop}
      >
        {notes.map((note) => {
          // Unknown object types stay in the doc untouched (no renderer yet).
          const spec = getObjectType(note.type);
          if (spec === undefined) return null;
          // Connectors are rendered in the SVG overlay below, not in their own container.
          if (note.type === 'connector') return null;
          const Component = spec.Component;
          return (
            <Component
              key={note.id}
              obj={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={selection.ids.has(note.id)}
              editing={selection.editingId === note.id}
              editable={editable}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onSelect={selection.click}
              onStartEdit={selection.startEdit}
              onEndEdit={handleEndEdit}
              undo={undo}
              measurer={measurer}
              // Story 12: image-specific props.
              isUploader={note.type === 'image' ? note.uploaderId === identityId : undefined}
              progress={note.type === 'image' ? imageInsert.progress.get(note.id) : undefined}
              canRetry={note.type === 'image' ? imageInsert.canRetry(note.id) : undefined}
              now={Date.now()}
              onRetry={note.type === 'image' ? (imgId: string) => imageInsert.retry(imgId) : undefined}
              onRemove={note.type === 'image' ? (imgId: string) => { boundary(); if (deleteObjects(doc, [imgId]) > 0) selection.clear(); boundary(); } : undefined}
            />
          );
        })}
        {/* Story 10: connector SVG overlay */}
        <svg
          style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' }}
        >
          {connectors.map((c) => {
            if (!c.from || !c.to) return null;
            const resolved = resolveEndpoints({ from: c.from, to: c.to }, rectsMap);
            return (
              <g key={c.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                 onPointerDown={(e) => { e.stopPropagation(); selection.click(c.id); }}
              >
                <ConnectorObject from={resolved.from} to={resolved.to} selected={selection.ids.has(c.id)} />
              </g>
            );
          })}
          {/* Story 10: connection dots for the connector tool */}
          {connectionDots.map((d) => (
            <circle
              key={`dot-${d.objectId}`}
              cx={d.x}
              cy={d.y}
              r={4}
              fill="#4285F4"
              opacity={0.7}
              pointerEvents="none"
            />
          ))}
        </svg>
      </BoardViewport>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={notes}
        camera={api.camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
      {/* Story 11: pen tool — preview + capture while the Pen is active. */}
      {tool === 'pen' && editable && (
        <PenTool
          camera={api.camera}
          color={pen.color}
          thickness={pen.thickness}
          doc={doc}
          identityId={identityId}
          undo={undo}
        />
      )}
      <MarqueeRect rect={marquee.rect} camera={api.camera} />
      {barAnchor !== null && selection.editingId === null && (
        <div
          className="vidi6-selection-bar-anchor"
          style={{ left: barAnchor.x, top: barAnchor.y }}
        >
          <SelectionBar
            ids={selection.ids}
            snapshot={notes}
            doc={doc}
            editable={editable}
            onDelete={deleteSelection}
            boundary={boundary}
          />
        </div>
      )}
      {/* Story 10: shape/connector toolbar */}
      {showShapeToolbar && selectedShape && (
        <ShapeToolbar
          fill={selectedShape.fill ?? 'white'}
          stroke={selectedShape.stroke ?? 'dark'}
          onFillChange={handleShapeFillChange}
          onStrokeChange={handleShapeStrokeChange}
          onDelete={deleteSelection}
        />
      )}
      {showShapeToolbar && selectedConnector && (
        <ShapeToolbar
          fill="white"
          stroke="dark"
          onFillChange={() => {}}
          onStrokeChange={() => {}}
          onDelete={deleteSelection}
          isConnector
        />
      )}
      <Toolbar
        onCreateSticky={createStickyCentre}
        onOpenImagePicker={imageInsert.openPicker}
        disabled={!editable}
        undo={undoState}
        tool={tool}
        onToolChange={setTool}
        shapeKind={shapeKind}
        onShapeKindChange={setShapeKind}
      />
      {/* Story 11: pen options, next to the left toolbar, Pen tool only. */}
      {tool === 'pen' && (
        <PenToolbar
          color={pen.color}
          thickness={pen.thickness}
          onColor={pen.setColor}
          onThickness={pen.setThickness}
        />
      )}
      {/* Story 12: drop highlight while files are being dragged over. */}
      {imageInsert.dragActive && <DropHighlight />}
      {/* Story 12: toast for image insertion messages. */}
      {toast.message !== null && (
        <Toast key={toast.key} message={toast.message} onDismiss={dismissToast} />
      )}
      <ConnectionStatus phase={connectionPhase ?? undefined} />
      <ZoomControls
        zoomPercent={zoomPercent(api.camera)}
        canZoomIn={canZoomIn(api.camera)}
        canZoomOut={canZoomOut(api.camera)}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
      <SharePanel boardId={id} />
    </div>
  );
}
