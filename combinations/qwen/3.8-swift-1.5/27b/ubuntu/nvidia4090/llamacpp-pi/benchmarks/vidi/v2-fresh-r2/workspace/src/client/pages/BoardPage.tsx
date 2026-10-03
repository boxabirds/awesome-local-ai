/**
 * Board page (story 5, share.pages).
 *
 * - malformed id → Board not found immediately (no request sent)
 * - valid id → "Opening board…" while `checkBoard` runs
 *   - exists → the stories 1–4 board (with the Share panel)
 *   - not_found → Board not found page
 *   - unreachable → "Couldn't reach vidi6. Retrying…" with exponential
 *     backoff (BOARD_CHECK_RETRY_BASE_MS doubling, capped at
 *     RECONNECT_MAX_BACKOFF_MS); the board opens when the service is
 *     reachable again, without a reload
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { canZoomIn, canZoomOut, zoomPercent, screenToWorld, worldToScreen } from '../canvas/camera';
import type { Size } from '../canvas/camera';
import { BoardViewport } from '../canvas/BoardViewport';
import { NavigationHint } from '../canvas/NavigationHint';
import { useCamera } from '../canvas/useCamera';
import { ZoomControls } from '../canvas/ZoomControls';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useTransformGesture } from '../board/useTransformGesture';
import { useBoardKeys } from '../board/useBoardKeys';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import { Toolbar } from '../board/Toolbar';
import { createUndo } from '../board/undo';
import { useUndo } from '../board/useUndo';
import { useTool } from '../board/useTool';
import { getObjectType } from '../objects/registry';
import {
  createSticky,
  deleteObjects,
  objectBounds,
  setStickyColor,
} from '../../shared/board-model';
import { createText, setTextSize, setTextWidthFixed } from '../../shared/objects/text';
import { createShape, setShapeStyle } from '../../shared/objects/shape';
import { createConnector } from '../../shared/objects/connector';
import { resolveEndpoints } from '../../shared/geometry/connector-geometry';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import { ShapeTool } from '../tools/ShapeTool';
import { ConnectorTool } from '../tools/ConnectorTool';
import { PenTool } from '../tools/PenTool';
import { PenToolbar } from '../tools/PenToolbar';
import { usePenOptions } from '../tools/usePenOptions';
import { createStroke } from '../../shared/objects/stroke';
import type { Endpoint } from '../../shared/objects/connector';
import type { Rect, Handle } from '../../shared/geometry';
import type { StickySnapshot } from '../../shared/board-model';
import { CONNECTOR_HIT_TOLERANCE_PX } from '../../shared/config';
import type { StickyColor, TextSize, ShapeFillColor, ShapeStrokeColor } from '../../shared/config';
import { sessionIdentity } from '../identity';
import { isValidBoardId } from '../../shared/board-id';
import { checkBoard } from '../api';
import { SharePanel } from '../share/SharePanel';
import { NotFoundPage } from './NotFoundPage';
import { nextBoardPageState, type BoardPageState } from './state';

const INITIAL_SIZE: Size = { width: 0, height: 0 };

export function BoardPage(props: { id: string }): JSX.Element {
  const valid = isValidBoardId(props.id);
  const [state, setState] = useState<BoardPageState>(
    valid ? { kind: 'checking', boardId: props.id } : { kind: 'not_found' },
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;
    const doCheck = async () => {
      attempt += 1;
      const currentAttempt = attempt;
      const result = await checkBoard(props.id);
      if (cancelled) return;
      const next = nextBoardPageState(stateRef.current, result, currentAttempt);
      setState(next);
      if (next.kind === 'unreachable') {
        timer = window.setTimeout(doCheck, next.nextRetryMs);
      }
    };
    void doCheck();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [props.id, valid]);

  switch (state.kind) {
    case 'checking':
      return (
        <div
          data-testid="board-checking"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Opening board…
        </div>
      );
    case 'not_found':
      return <NotFoundPage />;
    case 'unreachable':
      return (
        <div
          data-testid="board-unreachable"
          role="status"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#555',
          }}
        >
          Couldn't reach vidi6. Retrying…
        </div>
      );
    case 'ready':
      return <BoardView boardId={state.boardId} />;
  }
}

/**
 * The stories 1–4 board UI, mounted only once the board's existence has
 * been confirmed. Owns the camera, the Y.Doc and the network connection.
 * Exported so component tests can render the board directly (story 5: the
 * route `/` now renders the home page, not the board).
 */
export function BoardView({
  boardId,
  deps,
}: {
  boardId: string;
  /** Connection dependency injection (test builds: fake provider). */
  deps?: import('../sync/connectBoard').ConnectBoardDeps;
}): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>(INITIAL_SIZE);

  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const controls = useCamera(size);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;
  const { doc, objects, connectionState } = useBoardDoc(boardId, deps);
  const selection = useSelection(objects);
  const isLoadFailed = connectionState === 'load-failed';
  const canEdit = !isLoadFailed;

  // Story 9: board tool (select / text); story 10: shape / connector; story 11: pen.
  const tool = useTool({ canEdit, selection });
  const penOptions = usePenOptions();

  // Story 8: per-user undo controller (one per board doc, destroyed on unmount).
  const undoRef = useRef<ReturnType<typeof createUndo> | null>(null);
  if (undoRef.current === null) {
    undoRef.current = createUndo(doc);
  }
  const undoController = undoRef.current;
  useEffect(() => {
    return () => { undoRef.current?.destroy(); undoRef.current = null; };
  }, []);

  const undoState = useUndo(undoController, canEdit);

  const gesture = useTransformGesture({
    doc,
    camera: controls.camera,
    objects,
    selection,
    canEdit,
    onGestureStart: () => {
      undoController.boundary();
      window.__vidi6?.gestureLog?.push('start');
    },
    onGestureEnd: () => {
      undoController.boundary();
      window.__vidi6?.gestureLog?.push('end');
    },
  });

  // Board keyboard commands (story 7: select all, nudge, delete, …; story 8: undo/redo;
  // story 9: V/T/N/Escape tool shortcuts). The N handler reads through a ref
  // so the keyboard wiring stays stable across renders.
  const handleCreateStickyRef = useRef<(() => void) | null>(null);
  useBoardKeys({
    doc,
    objects,
    selection,
    canEdit,
    startEdit: selection.startEdit,
    undo: undoController,
    tool: { setTool: tool.setTool },
    onCreateStickyCenter: () => handleCreateStickyRef.current?.(),
  });

  // Marquee (story 7): Shift+drag on empty space selects by containment.
  const marquee = useMarquee(controls.camera, objects, (ids) => selection.setMany(ids, true));

  // Publish the mapped connection state to the test hook (test builds only).
  useEffect(() => {
    window.__vidi6?.setConnectionState(connectionState);
  }, [connectionState]);

  // Story 8: expose undo controller and startEdit to the test hook.
  useEffect(() => {
    if (import.meta.env.MODE === 'test' && window.__vidi6) {
      window.__vidi6.undo = undoController;
      window.__vidi6.startEdit = selection.startEdit;
    }
  }, [undoController, selection]);

  // Create a sticky note at a screen point (disabled when load failed)
  const handleCreateAtScreenPoint = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (isLoadFailed) return;
      const worldPoint = screenToWorld(controls.camera, screenPoint);
      const id = createSticky(doc, worldPoint);
      selection.startEdit(id);
    },
    [doc, controls.camera, selection, isLoadFailed],
  );

  // Create from toolbar button / N shortcut (centre of viewport)
  const handleCreateSticky = useCallback(() => {
    if (isLoadFailed) return;
    const centre = { x: size.width / 2, y: size.height / 2 };
    handleCreateAtScreenPoint(centre);
  }, [size, handleCreateAtScreenPoint, isLoadFailed]);
  handleCreateStickyRef.current = handleCreateSticky;

  // Text tool: click anywhere (even on an object) creates a text object on
  // top at that point, then starts editing it (story 9, text.tool).
  const handleTextToolClick = useCallback(
    (screenPoint: { x: number; y: number }) => {
      if (isLoadFailed) return;
      const worldPoint = screenToWorld(controls.camera, screenPoint);
      const id = createText(doc, worldPoint, sessionIdentity());
      if (!id) return;
      tool.setTool('select');
      selection.startEdit(id);
    },
    [doc, controls.camera, selection, isLoadFailed, tool],
  );

  // Double-click on empty board space
  const handleDblClickEmpty = useCallback(
    (point: { x: number; y: number }) => {
      if (isLoadFailed) return;
      handleCreateAtScreenPoint(point);
    },
    [handleCreateAtScreenPoint, isLoadFailed],
  );

  // Click on empty board space → select a connector under the point (6px
  // tolerance, story 10 connector.hit) or a stroke (line-distance hit test,
  // story 11 pen.select) or clear the selection.
  const handleClickEmpty = useCallback(
    (point: { x: number; y: number }) => {
      // Connectors (story 10): 6px screen tolerance on the line.
      for (const o of objects) {
        if (o.type !== 'connector') continue;
        const conn = o as unknown as { id: string; from: Endpoint; to: Endpoint };
        const rects = new Map(objects.map((x) => [x.id, objectBounds(x)]));
        const ends = resolveEndpoints({ from: conn.from, to: conn.to }, rects);
        const seg = [
          worldToScreen(controls.camera, ends.from),
          worldToScreen(controls.camera, ends.to),
        ];
        if (distanceToPolyline(seg, point) <= CONNECTOR_HIT_TOLERANCE_PX) {
          selection.click(o.id);
          return;
        }
      }
      // Strokes (story 11): line-distance hit test in world space.
      const worldPoint = screenToWorld(controls.camera, point);
      for (let i = objects.length - 1; i >= 0; i--) {
        const o = objects[i];
        if (o.type !== 'stroke') continue;
        const spec = getObjectType(o.type);
        if (spec?.hitTest(o, worldPoint, controls.camera.zoom)) {
          selection.click(o.id);
          return;
        }
      }
      selection.clear();
    },
    [objects, controls.camera, selection],
  );

  // Delete the current selection (bar button / Delete key).
  const handleDeleteSelection = useCallback(() => {
    if (isLoadFailed || selection.ids.size === 0) return;
    deleteObjects(doc, [...selection.ids]);
    selection.clear();
  }, [doc, selection, isLoadFailed]);

  // Recolour the single selected sticky (story 2 toolbar, now in the bar).
  const handleColor = useCallback(
    (c: StickyColor) => {
      if (selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      setStickyColor(doc, id, c);
    },
    [doc, selection],
  );

  // Restyle the single selected shape (story 10, shape.toolbar).
  const handleShapeFill = useCallback(
    (c: ShapeFillColor) => {
      if (selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      setShapeStyle(doc, id, { fill: c });
    },
    [doc, selection],
  );

  const handleShapeStroke = useCallback(
    (c: ShapeStrokeColor) => {
      if (selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      setShapeStyle(doc, id, { stroke: c });
    },
    [doc, selection],
  );

  // Change the single selected text object's size preset (story 9, text.size).
  // The box-sync hook re-measures the height in the same capture window.
  const handleTextSize = useCallback(
    (s: TextSize) => {
      if (selection.ids.size !== 1) return;
      const [id] = [...selection.ids];
      setTextSize(doc, id, s);
    },
    [doc, selection],
  );

  // Story 9: fixed-width drag on a single text object's e/w handle. Sets a
  // fixed width (clamped to TEXT_MIN_WIDTH_WORLD); the box-sync hook rewrites
  // the height. The top-left position is unchanged.
  const startTextWidthDrag = useCallback(
    (e: ReactPointerEvent, id: string, handle: 'e' | 'w') => {
      const objMap = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
      if (!objMap) return;
      const objX = objMap.get('x') as number;
      const objW = objMap.get('width') as number;
      undoController.boundary();
      let raf: number | null = null;
      const onMove = (ev: PointerEvent) => {
        const w = screenToWorld(controlsRef.current.camera, { x: ev.clientX, y: ev.clientY });
        const newWidth = handle === 'e' ? w.x - objX : objX + objW - w.x;
        if (raf !== null) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          raf = null;
          setTextWidthFixed(doc, id, newWidth);
        });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (raf !== null) cancelAnimationFrame(raf);
        undoController.boundary();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [doc, undoController],
  );

  // Wrap the generic handle gesture: a single text object's e/w handle drives
  // the fixed-width drag instead of a proportional group resize.
  const onHandlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>, handle: Handle) => {
      if (selection.ids.size === 1 && (handle === 'e' || handle === 'w')) {
        const [id] = [...selection.ids];
        const obj = objects.find((o) => o.id === id);
        if (obj && obj.type === 'text') {
          e.stopPropagation();
          startTextWidthDrag(e, id, handle);
          return;
        }
      }
      gesture.onHandlePointerDown(e, handle);
    },
    [selection, objects, startTextWidthDrag, gesture],
  );

  const selectedObjects = objects.filter((o) => selection.ids.has(o.id));
  const resizable =
    selectedObjects.length > 0 &&
    selectedObjects.every((o) => getObjectType(o.type)?.resizable === true);
  const singleSelected =
    selection.ids.size === 1 ? selectedObjects[0] : undefined;
  const singleSticky =
    singleSelected && singleSelected.type === 'sticky'
      ? (singleSelected as StickySnapshot)
      : undefined;

  // Screen-space anchor (top-centre) of the single selected object, for the
  // per-type toolbar in the screen-space selection bar.
  const singleAnchor = useMemo(() => {
    if (!singleSelected) return undefined;
    const b = objectBounds(singleSelected);
    return {
      x: (b.x + b.width / 2 - controls.camera.x) * controls.camera.zoom,
      y: (b.y - controls.camera.y) * controls.camera.zoom,
    };
  }, [singleSelected, controls.camera]);

  return (
    <div ref={shellRef} style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <BoardViewport
        controls={controls}
        onDblClickEmpty={handleDblClickEmpty}
        onClickEmpty={handleClickEmpty}
        marquee={canEdit ? marquee : undefined}
        textTool={tool.tool === 'text'}
        onTextToolClick={handleTextToolClick}
        onStrokeHit={(worldPoint) => {
          for (let i = objects.length - 1; i >= 0; i--) {
            const o = objects[i];
            if (o.type !== 'stroke') continue;
            const spec = getObjectType(o.type);
            if (spec?.hitTest(o, worldPoint, controls.camera.zoom)) {
              selection.click(o.id);
              return true;
            }
          }
          return false;
        }}
      >
        {objects.map((obj) => {
          const spec = getObjectType(obj.type);
          if (!spec) return null;
          const { Component } = spec;
          return (
            <Component
              key={obj.id}
              obj={obj}
              doc={doc}
              zoom={controls.camera.zoom}
              selected={selection.ids.has(obj.id)}
              editing={selection.editingId === obj.id}
              canEdit={canEdit}
              onObjectPointerDown={gesture.onObjectPointerDown}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
              undo={undoController}
              objects={objects}
              camera={controls.camera}
            />
          );
        })}
        <SelectionOverlay
          objects={objects}
          ids={selection.ids}
          zoom={controls.camera.zoom}
          resizable={resizable}
          onHandlePointerDown={onHandlePointerDown}
        />
        <MarqueeRect rect={marquee.rect} camera={controls.camera} />
      </BoardViewport>
      {/* Story 10: drawing tools (full-screen capture layers). */}
      {tool.tool === 'shape' && canEdit && (
        <ShapeTool
          camera={controls.camera}
          kind={tool.shapeKind}
          onCreate={(a) => createShape(doc, a, sessionIdentity())}
          onCreated={tool.toolCreated}
        />
      )}
      {tool.tool === 'connector' && canEdit && (
        <ConnectorTool
          camera={controls.camera}
          objects={objects}
          onCreate={(from, to) => createConnector(doc, from, to, sessionIdentity())}
          onCreated={tool.toolCreated}
        />
      )}
      {/* Story 11: pen tool (stays active after each stroke). */}
      {tool.tool === 'pen' && canEdit && (
        <PenTool
          camera={controls.camera}
          color={penOptions.color}
          thickness={penOptions.thickness}
          doc={doc}
          identityId={sessionIdentity()}
          onCommit={() => undoController.boundary()}
          onWheel={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            controls.wheel({
              deltaX: e.deltaX,
              deltaY: e.deltaY,
              ctrlOrMeta: e.ctrlKey || e.metaKey,
              point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
            });
          }}
        />
      )}
      {tool.tool === 'pen' && canEdit && (
        <PenToolbar
          color={penOptions.color}
          thickness={penOptions.thickness}
          onColor={penOptions.setColor}
          onThickness={penOptions.setThickness}
        />
      )}
      <SelectionBar
        count={selection.ids.size}
        single={singleSelected}
        anchor={singleAnchor}
        onColor={handleColor}
        onTextSize={handleTextSize}
        onShapeFill={handleShapeFill}
        onShapeStroke={handleShapeStroke}
        onDelete={handleDeleteSelection}
      />
      <Toolbar
        tool={tool.tool}
        setTool={tool.setTool}
        canEdit={canEdit}
        onCreateSticky={handleCreateSticky}
        undo={undoState}
        shapeKind={tool.shapeKind}
        setShapeKind={tool.setShapeKind}
      />
      <ZoomControls
        zoomPercent={zoomPercent(controls.camera)}
        canZoomIn={canZoomIn(controls.camera)}
        canZoomOut={canZoomOut(controls.camera)}
        onZoomIn={() => controls.zoomStep('in')}
        onZoomOut={() => controls.zoomStep('out')}
        onReset={controls.reset}
      />
      <NavigationHint visible={!controls.hasNavigated} />
      <ConnectionStatus state={connectionState} />
      <SharePanel boardId={boardId} />
    </div>
  );
}
