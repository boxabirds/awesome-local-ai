import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ReactElement,
  type CSSProperties,
} from 'react';
import { type Point, type Size, worldToScreen } from '@client/canvas/camera';
import { useCamera, type CameraApi } from '@client/canvas/useCamera';
import { BoardContext } from '@client/canvas/BoardContext';
import { GRID_SPACING_WORLD, wheelDeltaToPixels } from '@shared/config';

// Positive modulo, so the grid stays evenly spaced for negative camera positions.
function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function defaultViewport(): Size {
  if (typeof window !== 'undefined' && window.innerWidth > 0) {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  return { width: 1280, height: 800 };
}

interface BoardViewportProps {
  // A mutable ref that receives the current camera each render.
  cameraRef?: React.MutableRefObject<import('@client/canvas/camera').Camera>;
  // A mutable ref that receives the viewport element.
  viewportRef?: React.MutableRefObject<HTMLElement | null>;
  // Objects rendered in world coordinates (sticky notes etc. in later stories).
  children?: ReactNode;
  // Fixed-position UI (zoom controls, hint) rendered inside the board context but
  // NOT inside the transformed world layer.
  overlay?: ReactNode;
  // Double-click on empty board space -> create note
  onEmptyDoubleClick?(worldPoint: Point): void;
  // Click on empty board space without drag -> clear selection
  onEmptyClick?(): void;
  // Shift+pointerdown on empty space -> start marquee
  onMarqueeBegin?(screenPoint: Point): void;
  // pointermove during marquee
  onMarqueeMove?(screenPoint: Point): void;
  // pointerup during marquee
  onMarqueeEnd?(): void;
  // pointercancel during marquee
  onMarqueeCancel?(): void;
  // Active tool
  tool?: 'select' | 'text';
  // Click with text tool active -> worldPoint
  onToolClick?(worldPoint: Point): void;
}

export function BoardViewport({
  cameraRef,
  viewportRef: viewportRefProp,
  children,
  overlay,
  onEmptyDoubleClick,
  onEmptyClick,
  onMarqueeBegin,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
  tool,
  onToolClick,
}: BoardViewportProps): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>(() => defaultViewport());
  const api = useCamera(viewport);
  const { camera, beginPan, panMove, endPan, wheel, gestureZoom, zoomStep, reset } = api;

  // Keep the external refs in sync
  if (cameraRef) cameraRef.current = camera;
  if (viewportRefProp) viewportRefProp.current = viewportRef.current;
  const setCamera = api.setCamera;

  // Panning: a ref drives the input logic (no stale closures), React state drives
  // the "is-panning" cursor class.
  const panningRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  // Track whether we moved during a pointer sequence (to distinguish click from drag)
  const movedRef = useRef(false);
  const downPosRef = useRef<Point | null>(null);

  // Marquee state
  const marqueeRef = useRef(false);

  // --- viewport size (design: ResizeObserver; fall back to window.resize) ---
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const read = () => {
      const rect = el.getBoundingClientRect();
      const width = rect.width || window.innerWidth;
      const height = rect.height || window.innerHeight;
      setViewport((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    read();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  const pointFromClient = useCallback((clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // --- pointer drag (pan.drag): native listeners so both jsdom and real
  //     browsers behave identically (and so we can use pointer capture) ---
  const finishPan = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setIsPanning(false);
    endPan();
  }, [endPan]);

  // Callbacks ref for double-click, empty click, and marquee
  const callbacksRef = useRef({
    onEmptyDoubleClick,
    onEmptyClick,
    onMarqueeBegin,
    onMarqueeMove,
    onMarqueeEnd,
    onMarqueeCancel,
    tool,
    onToolClick,
  });
  callbacksRef.current = {
    onEmptyDoubleClick,
    onEmptyClick,
    onMarqueeBegin,
    onMarqueeMove,
    onMarqueeEnd,
    onMarqueeCancel,
    tool,
    onToolClick,
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Drag starts only on the viewport/grid itself; later object stories can
      // stopPropagation on their own elements.
      if (e.target !== el) return;
      movedRef.current = false;
      downPosRef.current = { x: e.clientX, y: e.clientY };

      // Shift+pointerdown on empty space -> marquee
      if (e.shiftKey && callbacksRef.current.onMarqueeBegin) {
        marqueeRef.current = true;
        try {
          el.setPointerCapture?.(e.pointerId);
        } catch {
          /* pointer capture unsupported (e.g. jsdom) */
        }
        callbacksRef.current.onMarqueeBegin(pointFromClient(e.clientX, e.clientY));
        return;
      }

      // Normal pan
      panningRef.current = true;
      setIsPanning(true);
      try {
        el.setPointerCapture?.(e.pointerId);
      } catch {
        /* pointer capture unsupported (e.g. jsdom) — window listeners still work */
      }
      beginPan(pointFromClient(e.clientX, e.clientY));
    };
    const onMove = (e: PointerEvent) => {
      if (marqueeRef.current) {
        if (downPosRef.current) {
          const dx = e.clientX - downPosRef.current.x;
          const dy = e.clientY - downPosRef.current.y;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            movedRef.current = true;
          }
        }
        callbacksRef.current.onMarqueeMove?.(pointFromClient(e.clientX, e.clientY));
        return;
      }
      if (!panningRef.current) return;
      if (downPosRef.current) {
        const dx = e.clientX - downPosRef.current.x;
        const dy = e.clientY - downPosRef.current.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          movedRef.current = true;
        }
      }
      panMove(pointFromClient(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      if (marqueeRef.current) {
        marqueeRef.current = false;
        if (movedRef.current) {
          callbacksRef.current.onMarqueeEnd?.();
        } else {
          callbacksRef.current.onMarqueeCancel?.();
        }
        return;
      }
      if (panningRef.current && !movedRef.current && e.target === el) {
        // If text tool is active, create text at click point instead of clearing selection
        if (callbacksRef.current.tool === 'text' && callbacksRef.current.onToolClick) {
          const pt = pointFromClient(e.clientX, e.clientY);
          const worldPoint = { x: pt.x / camera.zoom + camera.x, y: pt.y / camera.zoom + camera.y };
          callbacksRef.current.onToolClick(worldPoint);
        } else {
          // Click on empty board space without dragging: clear selection
          callbacksRef.current.onEmptyClick?.();
        }
      }
      finishPan();
    };
    const onCancel = () => {
      if (marqueeRef.current) {
        marqueeRef.current = false;
        callbacksRef.current.onMarqueeCancel?.();
        return;
      }
      finishPan();
    };
    // move/up/cancel are tracked on window so a drag that leaves the element (or
    // an interrupted drag) still ends cleanly; pointer events bubble to window.
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('lostpointercapture', () => {
      if (marqueeRef.current) {
        marqueeRef.current = false;
        callbacksRef.current.onMarqueeCancel?.();
        return;
      }
      finishPan();
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('lostpointercapture', () => {});
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [beginPan, panMove, finishPan, pointFromClient]);

  // --- dblclick on empty board space ---
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onDblClick = (e: MouseEvent) => {
      // Only handle if target is the viewport itself (empty space)
      if (e.target !== el) return;
      const pt = pointFromClient(e.clientX, e.clientY);
      const worldPoint = { x: pt.x / camera.zoom + camera.x, y: pt.y / camera.zoom + camera.y };
      callbacksRef.current.onEmptyDoubleClick?.(worldPoint);
    };
    el.addEventListener('dblclick', onDblClick);
    return () => el.removeEventListener('dblclick', onDblClick);
  }, [camera, pointFromClient]);

  // --- wheel (non-passive; always preventDefault over the board) ---
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Wheel over the fixed UI (zoom controls / hint) is not a board gesture:
      // leave it to the browser (TC-30). The controls also stopPropagation.
      const target = e.target as Element | null;
      if (target && target.closest('[data-board-ui]')) return;
      // Board owns all wheel gestures over it -> the page never scrolls/zooms.
      e.preventDefault();
      const dx = wheelDeltaToPixels(e.deltaX, e.deltaMode);
      const dy = wheelDeltaToPixels(e.deltaY, e.deltaMode);
      wheel({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: pointFromClient(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel, pointFromClient]);

  // --- Safari gesture events (pinch) ---
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let startScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      startScale = (e as GestureEvent).scale || 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as GestureEvent;
      const prev = startScale || 1;
      const ratio = (ge.scale || 1) / prev;
      startScale = ge.scale || 1;
      gestureZoom(pointFromClient(ge.clientX, ge.clientY), ratio);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      startScale = 1;
    };
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    el.addEventListener('gestureend', onGestureEnd as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [gestureZoom, pointFromClient]);

  // --- keyboard shortcuts (zoom.step, view.reset, zoom.no_page_zoom) ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      const key = e.key;
      if (key === '=' || key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (key === '-' || key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // --- test-only camera hook (test build only) ---
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    window.__vidi6 = { setCamera };
    return () => {
      if (window.__vidi6?.setCamera === setCamera) {
        delete window.__vidi6;
      }
    };
  }, [setCamera]);

  // --- derived render values ---
  const { x, y, zoom } = camera;
  const gridSize = GRID_SPACING_WORLD * zoom;
  const bgX = mod(-x * zoom, gridSize);
  const bgY = mod(-y * zoom, gridSize);

  const viewportStyle: CSSProperties = {
    backgroundImage: 'radial-gradient(var(--vidi6-grid-dot) 1px, transparent 1.2px)',
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${bgX}px ${bgY}px`,
    cursor: tool === 'text' ? 'text' : undefined,
  };

  const worldStyle: CSSProperties = {
    transform: `scale(${zoom}) translate(${-x}px, ${-y}px)`,
    transformOrigin: '0 0',
  };

  const origin = worldToScreen(camera, { x: 0, y: 0 });

  return (
    <BoardContext.Provider value={{ ...api, viewport }}>
      <div
        ref={viewportRef}
        className={`board-viewport${isPanning ? ' is-panning' : ''}`}
        data-testid="board-viewport"
        data-panning={isPanning ? 'true' : 'false'}
        style={viewportStyle}
      >
        <div className="board-world" data-testid="board-world" style={worldStyle}>
          <div
            className="origin-marker"
            data-testid="origin-marker"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              // Counter-scale so the crosshair keeps a constant on-screen size
              // while its centre stays pinned to world (0,0).
              transform: `scale(${1 / zoom})`,
              transformOrigin: '0 0',
              width: 0,
              height: 0,
            }}
            data-origin-screen-x={origin.x}
            data-origin-screen-y={origin.y}
          />
          {children}
        </div>
        {overlay}
      </div>
    </BoardContext.Provider>
  );
}

export type { CameraApi };
