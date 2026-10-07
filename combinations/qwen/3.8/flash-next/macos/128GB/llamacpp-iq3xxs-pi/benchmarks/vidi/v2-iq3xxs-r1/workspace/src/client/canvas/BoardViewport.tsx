import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import { type Point, type Size } from './camera';
import { useCamera, type UseCamera } from './useCamera';

const DOT_COLOR = '#c9c9c9';
const LINE_DELTA_PIXELS = 16; // deltaMode: DOM_DELTA_LINE -> pixels

function mod(v: number, m: number): number {
  return ((v % m) + m) % m;
}

// ---------------------------------------------------------------------------
// Board camera context: owns the measured viewport Size + useCamera so the
// viewport, the zoom controls and the hint all read one camera. Kept separate
// so BoardViewport's public props stay `{ children }` while the fixed-position
// controls render OUTSIDE the transformed world layer.
// ---------------------------------------------------------------------------

interface BoardCameraContextValue extends UseCamera {
  readonly viewport: Size;
  readonly viewportRef: RefObject<HTMLDivElement | null>;
}

const BoardCameraContext = createContext<BoardCameraContextValue | null>(null);

function fallbackSize(): Size {
  if (typeof window === 'undefined') return { width: 1200, height: 800 };
  return { width: window.innerWidth || 1200, height: window.innerHeight || 800 };
}

export function BoardCameraProvider({ children }: { children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>(fallbackSize);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth || window.innerWidth;
      const height = el.clientHeight || window.innerHeight;
      setViewport((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };
    update();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const controller = useCamera(viewport);
  const value = useMemo<BoardCameraContextValue>(
    () => ({ ...controller, viewport, viewportRef }),
    [controller, viewport],
  );

  return <BoardCameraContext.Provider value={value}>{children}</BoardCameraContext.Provider>;
}

export function useBoardCamera(): BoardCameraContextValue {
  const ctx = useContext(BoardCameraContext);
  if (!ctx) throw new Error('useBoardCamera must be used within BoardCameraProvider');
  return ctx;
}

interface GestureLike {
  scale: number;
  clientX: number;
  clientY: number;
}

// ---------------------------------------------------------------------------
// BoardViewport: the input surface + dot grid + transformed world layer.
// All input (pointer, wheel, gesture, keyboard) is wired with native
// addEventListener so preventDefault (passive:false) and pointer capture work
// identically in the browser and in tests.
// ---------------------------------------------------------------------------

export function BoardViewport({ children }: { children?: ReactNode }) {
  const { camera, viewportRef, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset } =
    useBoardCamera();
  const [panning, setPanning] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const gestureScaleRef = useRef(1);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const toPoint = (e: { clientX: number; clientY: number }): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // --- Pointer drag (pan) -------------------------------------------------
    const onPointerDown = (e: PointerEvent) => {
      // Only start on empty space (the viewport/grid itself), never board objects.
      if (e.target !== el) return;
      if (e.button !== 0) return;
      activePointerRef.current = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      setPanning(true);
      beginPan(toPoint(e));
    };
    const onPointerMove = (e: PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      panMove(toPoint(e));
    };
    const finishPan = (e: PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      activePointerRef.current = null;
      el.releasePointerCapture?.(e.pointerId);
      endPan();
      setPanning(false);
    };

    // --- Wheel / Safari gesture --------------------------------------------
    const onWheel = (e: WheelEvent) => {
      // Always prevent over the board so the page never scrolls/zooms.
      e.preventDefault();
      const scale =
        e.deltaMode === 1 ? LINE_DELTA_PIXELS : e.deltaMode === 2 ? el.clientHeight : 1;
      wheel({
        deltaX: e.deltaX * scale,
        deltaY: e.deltaY * scale,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toPoint(e),
      });
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = (e as unknown as GestureLike).scale || 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as GestureLike;
      const prev = gestureScaleRef.current || 1;
      const factor = ge.scale / prev;
      gestureScaleRef.current = ge.scale;
      zoomAtPoint(toPoint(ge), factor);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };

    // --- Keyboard shortcuts -------------------------------------------------
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', finishPan);
    el.addEventListener('pointercancel', finishPan);
    el.addEventListener('lostpointercapture', finishPan);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    el.addEventListener('gestureend', onGestureEnd as EventListener);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', finishPan);
      el.removeEventListener('pointercancel', finishPan);
      el.removeEventListener('lostpointercapture', finishPan);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [viewportRef, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset]);

  // Derived CSS for the dot grid and the world layer.
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgX = mod(-camera.x * camera.zoom, spacing);
  const bgY = mod(-camera.y * camera.zoom, spacing);

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-panning={panning}
      style={{
        backgroundImage: `radial-gradient(circle, ${DOT_COLOR} 1px, transparent 1px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: panning ? 'grabbing' : 'grab',
      }}
    >
      <div
        className="board-world"
        data-testid="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {/* Stable pixel target for e2e: world (0,0). */}
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
