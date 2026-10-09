import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './camera';
import type { Point, Size } from './camera';
import { createSticky, type StickySnapshot } from '../../shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import { gridStyle, worldLayerStyle } from './boardStyles';
import { NavigationHint } from './NavigationHint';
import { installTestHooks, uninstallTestHooks } from './testHooks';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { Toolbar } from '../board/Toolbar';
import { StickyNote } from '../objects/StickyNote';

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
  notes?: readonly StickySnapshot[];
  selectedId?: string | null;
  editingId?: string | null;
  onSelect?(id: string | null): void;
  onStartEdit?(id: string): void;
  onEndEdit?(next: 'selected' | 'unselected'): void;
  // False while the board could not be loaded: every model mutation is a
  // no-op and the Sticky note button is disabled.
  editable?: boolean;
}

export function BoardViewport(props: BoardViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gestureScaleRef = useRef(1);
  const pointerIdRef = useRef<number | null>(null);
  const panStartRef = useRef<Point | null>(null);
  const panMovedRef = useRef(false);
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
  useEffect(() => {
    installTestHooks({ getCamera, setCamera });
    return () => uninstallTestHooks();
  }, [getCamera, setCamera]);

  const isBoardSurface = (target: EventTarget | null): boolean => {
    if (target === null) return false;
    const element = target as HTMLElement;
    return element === viewportRef.current || element.dataset.grid === 'true';
  };

  const selectRef = useRef(props.onSelect);
  const startEditRef = useRef(props.onStartEdit);
  selectRef.current = props.onSelect;
  startEditRef.current = props.onStartEdit;

  const createAtWorld = useCallback((world: Point): void => {
    const doc = props.doc;
    if (doc === undefined || props.editable === false) return;
    const id = createSticky(doc, world);
    if (id === false) return;
    selectRef.current?.(id);
    startEditRef.current?.(id);
  }, [props.doc, props.editable]);

  const createCentre = useCallback((): void => {
    createAtWorld(screenToWorld(cam.camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [createAtWorld, cam.camera, viewport.width, viewport.height]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !isBoardSurface(event.target)) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerIdRef.current = event.pointerId;
      panStartRef.current = { x: event.clientX, y: event.clientY };
      panMovedRef.current = false;
      setIsPanning(true);
      cam.beginPan({ x: event.clientX, y: event.clientY });
    },
    [cam]
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current === null) return;
      const start = panStartRef.current;
      if (start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= DRAG_THRESHOLD_PX) {
        panMovedRef.current = true;
      }
      cam.panMove({ x: event.clientX, y: event.clientY });
    },
    [cam]
  );

  const handlePanEnd = useCallback(() => {
    if (pointerIdRef.current === null) return;
    const element = viewportRef.current;
    if (element !== null && pointerIdRef.current !== null && element.hasPointerCapture(pointerIdRef.current)) {
      element.releasePointerCapture(pointerIdRef.current);
    }
    const wasClick = !panMovedRef.current;
    pointerIdRef.current = null;
    panStartRef.current = null;
    setIsPanning(false);
    cam.endPan();
    if (wasClick) selectRef.current?.(null);
  }, [cam]);

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

  const camera = cam.camera;

  // Render in a stable order (by id) so a z change from bringToFront only
  // updates each note's z-index instead of reordering the DOM. Reordering would
  // detach the node the browser has a pointer capture on and end a drag early.
  const orderedNotes = useMemo(
    () => (props.notes === undefined ? undefined : [...props.notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))),
    [props.notes]
  );

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
        onPointerUp={handlePanEnd}
        onPointerCancel={handlePanEnd}
        onLostPointerCapture={handlePanEnd}
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
          {orderedNotes?.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={props.doc!}
              zoom={camera.zoom}
              selected={props.selectedId === note.id}
              editing={props.editingId === note.id}
              onSelect={(id) => props.onSelect?.(id)}
              onStartEdit={(id) => props.onStartEdit?.(id)}
              onEndEdit={(next) => props.onEndEdit?.(next)}
              editable={props.editable !== false}
            />
          ))}
        </div>
      </div>
      {props.doc !== undefined ? <Toolbar onCreateSticky={createCentre} disabled={props.editable === false} /> : null}
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
