import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, worldToScreen, zoomPercent } from './camera';
import type { Point, Size } from './camera';
import { createSticky, deleteObjects, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { createText } from '../../shared/objects/text';
import { getSessionId } from '../session';
import { unionRects } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import { gridStyle, worldLayerStyle } from './boardStyles';
import { NavigationHint } from './NavigationHint';
import { installTestHooks, uninstallTestHooks } from './testHooks';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { Toolbar } from '../board/Toolbar';
import { getObjectType } from '../objects/registry';
import { SelectionOverlay } from '../board/SelectionOverlay';
import { SelectionBar } from '../board/SelectionBar';
import { useMarquee, MarqueeRect } from '../board/Marquee';
import { useTransformGesture } from '../board/useTransformGesture';
import { useTool } from '../board/useTool';
import { useUndo, useUndoController } from '../board/useUndo';
import type { SelectionApi } from '../board/useSelection';

// Wheel events with deltaMode LINE/PAGE are converted to pixels with these.
const WHEEL_LINE_PIXELS = 16;
const WHEEL_PAGE_PIXELS = 400;

interface GestureEventLike extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

function wheelDeltaPixels(delta: number, deltaMode: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_PIXELS;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * WHEEL_PAGE_PIXELS;
  return delta;
}

function pointRelativeTo(element: Element, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

export interface BoardViewportProps {
  children?: ReactNode;
  doc?: Y.Doc;
  notes?: readonly ObjectSnapshot[];
  selection?: SelectionApi;
  // False while the board could not be loaded: every model mutation is a
  // no-op and the Sticky note button is disabled.
  editable?: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export function BoardViewport(props: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gestureScaleRef = useRef(1);
  const pointerIdRef = useRef<number | null>(null);
  const panStartRef = useRef<Point | null>(null);
  const panMovedRef = useRef(false);
  const modeRef = useRef<'pan' | 'marquee' | null>(null);
  const [viewport, setViewport] = useState<Size>(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  const [isPanning, setIsPanning] = useState(false);
  const cam = useCamera(viewport);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      const width = rect !== undefined && rect.width > 0 ? rect.width : window.innerWidth;
      const height = rect !== undefined && rect.height > 0 ? rect.height : window.innerHeight;
      setViewport((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { wheel, gestureZoomAtPointer } = cam;
  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      // Board-owned gestures: never let the page scroll or zoom.
      event.preventDefault();
      wheel({
        deltaX: wheelDeltaPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: pointRelativeTo(element, event.clientX, event.clientY)
      });
    };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = (event as GestureEventLike).scale || 1;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      const previous = gestureScaleRef.current || 1;
      gestureScaleRef.current = gesture.scale;
      gestureZoomAtPointer(gesture.scale / previous, pointRelativeTo(element, gesture.clientX, gesture.clientY));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('gesturestart', onGestureStart, { passive: false });
    element.addEventListener('gesturechange', onGestureChange, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('gesturestart', onGestureStart);
      element.removeEventListener('gesturechange', onGestureChange);
    };
  }, [wheel, gestureZoomAtPointer]);

  const { zoomStep, reset } = cam;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.altKey) return;
      if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        zoomStep('in');
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomStep('out');
      } else if (event.key === '0') {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  const { getCamera, setCamera } = cam;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const editableRef = useRef(props.editable !== false);
  editableRef.current = props.editable !== false;
  useEffect(() => {
    installTestHooks({
      getCamera,
      setCamera,
      seedStickies: (count: number): string[] => {
        const doc = docRef.current;
        if (doc === undefined) return [];
        const ids: string[] = [];
        doc.transact(() => {
          for (let i = 0; i < count; i++) {
            const col = i % 4;
            const row = Math.floor(i / 4);
            const id = createSticky(doc, { x: -460 + col * 240, y: -200 + row * 240 });
            if (id !== false) ids.push(id);
          }
        });
        return ids;
      }
    });
    return () => uninstallTestHooks();
  }, [getCamera, setCamera]);

  const isBoardSurface = (target: EventTarget | null): boolean => {
    if (target === null) return false;
    const element = target as HTMLElement;
    return element === viewportRef.current || element.dataset.grid === 'true';
  };

  const selectionRef = useRef(props.selection);
  selectionRef.current = props.selection;

  const snapshot = props.notes ?? [];
  const camera = cam.camera;

  const marquee = useMarquee(camera, snapshot, (ids) => {
    selectionRef.current?.setMany(ids, true);
  });
  const marqueeActive = marquee.rect !== null;

  const undoController = useUndoController();
  const undoState = useUndo(undoController, props.editable !== false);
  const undoRef = useRef(undoController);
  undoRef.current = undoController;

  const transform = useTransformGesture({
    doc: props.doc ?? null,
    camera,
    selection: props.selection ?? null,
    snapshot,
    canEdit: props.editable !== false,
    // One drag/resize is one undo step: close the previous step at the start
    // and the gesture's merged frames at the end (including pointercancel).
    onGestureStart: () => {
      undoRef.current?.boundary();
      props.onGestureStart?.();
    },
    onGestureEnd: () => {
      undoRef.current?.boundary();
      props.onGestureEnd?.();
    }
  });

  // Escape during a marquee cancels the marquee and must not also clear the
  // selection, so the listener runs in the capture phase and stops
  // propagation before the board-wide key handler sees it.
  useEffect(() => {
    if (!marqueeActive) return;
    const onKeyDownCapture = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      marquee.cancel();
    };
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => window.removeEventListener('keydown', onKeyDownCapture, true);
  }, [marqueeActive, marquee.cancel]);

  const createAtWorld = useCallback((world: Point): void => {
    const doc = docRef.current;
    if (doc === undefined || !editableRef.current) return;
    undoRef.current?.boundary();
    const id = createSticky(doc, world);
    undoRef.current?.boundary();
    if (id === false) return;
    selectionRef.current?.startEdit(id);
  }, []);

  const createCentre = useCallback((): void => {
    createAtWorld(screenToWorld(cam.camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [createAtWorld, cam.camera, viewport.width, viewport.height]);

  const { tool, setTool } = useTool(props.editable !== false);

  // Story 9 tool shortcuts (design text.tool_ui): V → Select, T → Text,
  // N → same as the Sticky note button, Escape → Select. Ignored while
  // editing text or when focus is in an input. Escape keeps bubbling so the
  // board-wide handler can also clear the selection.
  const createCentreRef = useRef(createCentre);
  createCentreRef.current = createCentre;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const selection = selectionRef.current;
      if (selection !== undefined && selection.editingId !== null) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true)
      ) {
        return;
      }
      if (event.key === 'v' || event.key === 'V') {
        setTool('select');
        return;
      }
      if (event.key === 't' || event.key === 'T') {
        if (!editableRef.current) return;
        event.preventDefault();
        setTool('text');
        return;
      }
      if (event.key === 'n' || event.key === 'N') {
        if (!editableRef.current) return;
        event.preventDefault();
        createCentreRef.current();
        return;
      }
      if (event.key === 'Escape') {
        setTool('select');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool]);

  const createTextAtScreenPoint = useCallback(
    (clientX: number, clientY: number): void => {
      const doc = docRef.current;
      const element = viewportRef.current;
      if (doc === undefined || element === null || !editableRef.current) return;
      const rect = element.getBoundingClientRect();
      const world = screenToWorld(cam.camera, { x: clientX - rect.left, y: clientY - rect.top });
      undoRef.current?.boundary();
      const id = createText(doc, world, getSessionId());
      undoRef.current?.boundary();
      if (id === null) return;
      setTool('select');
      selectionRef.current?.startEdit(id);
    },
    [cam.camera, setTool]
  );

  const toolActive = tool === 'text';

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isBoardSurface(event.target)) return;
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);
      pointerIdRef.current = event.pointerId;
      panStartRef.current = { x: event.clientX, y: event.clientY };
      panMovedRef.current = false;
      if (event.shiftKey && selectionRef.current !== undefined && editableRef.current) {
        modeRef.current = 'marquee';
        marquee.begin(pointRelativeTo(element, event.clientX, event.clientY));
        return;
      }
      modeRef.current = 'pan';
      setIsPanning(true);
      cam.beginPan({ x: event.clientX, y: event.clientY });
    },
    [cam, marquee]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current === null) return;
      const start = panStartRef.current;
      if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_THRESHOLD_PX) {
        panMovedRef.current = true;
      }
      if (modeRef.current === 'marquee') {
        marquee.move(pointRelativeTo(event.currentTarget, event.clientX, event.clientY));
        return;
      }
      cam.panMove({ x: event.clientX, y: event.clientY });
    },
    [cam, marquee]
  );

  const finishPointer = useCallback((cancelled: boolean) => {
    if (pointerIdRef.current === null) return;
    const element = viewportRef.current;
    if (element !== null && pointerIdRef.current !== null && element.hasPointerCapture(pointerIdRef.current)) {
      element.releasePointerCapture(pointerIdRef.current);
    }
    const wasClick = !panMovedRef.current;
    const mode = modeRef.current;
    pointerIdRef.current = null;
    panStartRef.current = null;
    modeRef.current = null;
    setIsPanning(false);
    if (mode === 'marquee') {
      // Cancelled gestures (Escape already handled separately, pointercancel)
      // leave the selection untouched.
      if (cancelled) marquee.cancel();
      else marquee.end();
      return;
    }
    cam.endPan();
    if (wasClick && !cancelled) selectionRef.current?.clear();
  }, [cam, marquee]);

  const handlePointerUp = useCallback(() => finishPointer(false), [finishPointer]);
  const handlePointerCancel = useCallback(() => finishPointer(true), [finishPointer]);

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!isBoardSurface(event.target)) return;
      const element = viewportRef.current;
      if (element === null) return;
      const rect = element.getBoundingClientRect();
      createAtWorld(screenToWorld(cam.camera, { x: event.clientX - rect.left, y: event.clientY - rect.top }));
    },
    [cam.camera, createAtWorld]
  );

  // Render in a stable order (by id) so a z change from bringToFront only
  // updates each note's z-index instead of reordering the DOM. Reordering would
  // detach the node the browser has a pointer capture on and end a drag early.
  const orderedObjects = useMemo(
    () => (props.notes === undefined ? undefined : [...props.notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))),
    [props.notes]
  );

  const selection = props.selection;
  const barAnchor = useMemo(() => {
    if (selection === undefined || props.notes === undefined || selection.ids.size < 2) return null;
    const box = unionRects(props.notes.filter((obj) => selection.ids.has(obj.id)).map(objectBounds));
    if (box === null) return null;
    return worldToScreen(camera, { x: box.x + box.width / 2, y: box.y });
  }, [selection, props.notes, camera]);

  return (
    <>
      <div
        ref={viewportRef}
        data-testid="board-viewport"
        data-interaction={isPanning ? 'panning' : 'idle'}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          background: '#fbfbf9',
          cursor: isPanning ? 'grabbing' : 'default',
          touchAction: 'none'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={() => finishPointer(false)}
        onDoubleClick={handleDoubleClick}
      >
        <div data-testid="dot-grid" data-grid="true" style={gridStyle(camera)} />
        <div data-testid="world-layer" style={{ ...worldLayerStyle(camera), pointerEvents: 'none' }}>
          <div
            data-testid="origin-marker"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 20,
              height: 20,
              transform: 'translate(-50%, -50%)'
            }}
          >
            <div style={{ position: 'absolute', left: 9.25, top: 0, width: 1.5, height: 20, background: '#e05252' }} />
            <div style={{ position: 'absolute', left: 0, top: 9.25, width: 20, height: 1.5, background: '#e05252' }} />
          </div>
          {props.children}
          {orderedObjects?.map((obj) => {
            const spec = getObjectType(obj.type);
            if (spec === undefined) return null;
            const Renderer = spec.Component;
            return (
              <Renderer
                key={obj.id}
                obj={obj}
                doc={props.doc as Y.Doc}
                zoom={camera.zoom}
                selected={selection !== undefined && selection.ids.has(obj.id)}
                dragging={transform.draggingIds.has(obj.id)}
                editing={selection !== undefined && selection.editingId === obj.id}
                editable={props.editable !== false}
                onStartEdit={(id) => selectionRef.current?.startEdit(id)}
                onEndEdit={(next) => selectionRef.current?.endEdit(next)}
                onObjectPointerDown={transform.onObjectPointerDown}
              />
            );
          })}
          <MarqueeRect rect={marquee.rect} camera={camera} />
        </div>
        {toolActive ? (
          <div
            data-testid="text-tool-overlay"
            style={{ position: 'absolute', inset: 0, cursor: 'text', zIndex: 45 }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              createTextAtScreenPoint(event.clientX, event.clientY);
            }}
          />
        ) : null}
        {selection !== undefined && props.doc !== undefined ? (
          <SelectionOverlay
            ids={selection.ids}
            snapshot={snapshot}
            camera={camera}
            onHandlePointerDown={transform.onHandlePointerDown}
          />
        ) : null}
        {barAnchor !== null && selection !== undefined ? (
          <div
            style={{
              position: 'absolute',
              left: barAnchor.x,
              top: barAnchor.y,
              transform: 'translate(-50%, calc(-100% - 8px))',
              pointerEvents: 'none',
              zIndex: 41
            }}
          >
            <SelectionBar
              ids={selection.ids}
              snapshot={snapshot}
              onDelete={() => {
                if (props.doc === undefined) return;
                undoRef.current?.boundary();
                deleteObjects(props.doc, [...selection.ids]);
                undoRef.current?.boundary();
                selection.clear();
              }}
            />
          </div>
        ) : null}
      </div>
      {props.doc !== undefined ? (
        <Toolbar
          onCreateSticky={createCentre}
          disabled={props.editable === false}
          undo={undoState}
          tool={tool}
          onToolChange={setTool}
        />
      ) : null}
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={() => cam.reset()}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </>
  );
}
