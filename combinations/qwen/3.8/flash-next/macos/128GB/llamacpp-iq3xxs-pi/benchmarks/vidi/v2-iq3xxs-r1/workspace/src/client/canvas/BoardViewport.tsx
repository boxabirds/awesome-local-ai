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
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
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

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * The active tool (story 9). While the Text tool is active the pointer is a text
   * caret, empty space is not panned and Shift+drag does not make a marquee, so a
   * click can be used to put the text where it was clicked instead.
   */
  tool?: 'select' | 'text';
  /**
   * A click while the Text tool is active, reported as a screen-space point: the
   * board creates a text object with its top-left at that point (story 9). Unlike
   * the sticky note gesture this also happens on top of other objects.
   */
  onCreateTextAt?(point: Point): void;
  /**
   * Double-click on empty board space, reported as a screen-space point relative
   * to the viewport (story 2 creates a sticky note centred on it).
   */
  onCreateStickyAt?(point: Point): void;
  /** A press on empty board space that did not turn into a pan (clears selection). */
  onEmptyClick?(): void;
  /** Shift+drag started on empty space (story 7 marquee). */
  onMarqueeBegin?(screen: Point): void;
  /** Shift+drag pointer move. */
  onMarqueeMove?(screen: Point): void;
  /** Shift+drag ended (pointerup). */
  onMarqueeEnd?(): void;
  /** Shift+drag cancelled (pointercancel). */
  onMarqueeCancel?(): void;
}

export function BoardViewport({
  children,
  tool = 'select',
  onCreateTextAt,
  onCreateStickyAt,
  onEmptyClick,
  onMarqueeBegin,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
}: BoardViewportProps) {
  const { camera, viewportRef, beginPan, panMove, endPan, wheel, zoomAtPoint, zoomStep, reset } =
    useBoardCamera();
  const [panning, setPanning] = useState(false);
  const activePointerRef = useRef<number | null>(null);
  const gestureScaleRef = useRef(1);
  // Latest callbacks, so the input effect keeps a stable dependency list.
  const createStickyRef = useRef(onCreateStickyAt);
  createStickyRef.current = onCreateStickyAt;
  const emptyClickRef = useRef(onEmptyClick);
  emptyClickRef.current = onEmptyClick;
  const marqueeBeginRef = useRef(onMarqueeBegin);
  marqueeBeginRef.current = onMarqueeBegin;
  const marqueeMoveRef = useRef(onMarqueeMove);
  marqueeMoveRef.current = onMarqueeMove;
  const marqueeEndRef = useRef(onMarqueeEnd);
  marqueeEndRef.current = onMarqueeEnd;
  const marqueeCancelRef = useRef(onMarqueeCancel);
  marqueeCancelRef.current = onMarqueeCancel;
  const pressRef = useRef<{ x: number; y: number; isClick: boolean } | null>(null);
  const marqueeActiveRef = useRef(false);
  // Latest tool, so a tool change does not reattach every input listener.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const createTextRef = useRef(onCreateTextAt);
  createTextRef.current = onCreateTextAt;
  /** The Text tool's press, which must not pan the board nor select an object. */
  const textPressRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const toPoint = (e: { clientX: number; clientY: number }): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // --- Text tool (story 9) ------------------------------------------------
    // Capture phase and stopped, because an object under the pointer would
    // otherwise take the press for a selection or a drag of its own.
    const onPointerDownCapture = (e: PointerEvent) => {
      if (toolRef.current !== 'text' || e.button !== 0) return;
      textPressRef.current = { pointerId: e.pointerId, ...toPoint(e) };
      e.stopPropagation();
    };
    const onPointerUpCapture = (e: PointerEvent) => {
      const press = textPressRef.current;
      if (!press || press.pointerId !== e.pointerId) return;
      textPressRef.current = null;
      e.stopPropagation();
      if (toolRef.current !== 'text') return;
      const p = toPoint(e);
      // A drag in the Text tool means nothing; only a click puts text on the board.
      if (Math.hypot(p.x - press.x, p.y - press.y) >= DRAG_THRESHOLD_PX) return;
      createTextRef.current?.(p);
    };
    const onPointerCancelCapture = (e: PointerEvent) => {
      if (textPressRef.current?.pointerId === e.pointerId) textPressRef.current = null;
    };

    // --- Pointer drag (pan) -------------------------------------------------
    const onPointerDown = (e: PointerEvent) => {
      // A press the Text tool already claimed does not pan or marquee.
      if (textPressRef.current) return;
      // Only start on empty space (the viewport/grid itself), never board objects.
      if (e.target !== el) return;
      if (e.button !== 0) return;
      activePointerRef.current = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      const p = toPoint(e);
      // Shift+drag on empty space = marquee (story 7)
      if (e.shiftKey && marqueeBeginRef.current) {
        marqueeActiveRef.current = true;
        marqueeBeginRef.current(p);
        return;
      }
      setPanning(true);
      pressRef.current = { x: p.x, y: p.y, isClick: true };
      beginPan(p);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      const p = toPoint(e);
      if (marqueeActiveRef.current) {
        marqueeMoveRef.current?.(p);
        return;
      }
      const press = pressRef.current;
      if (press && Math.hypot(p.x - press.x, p.y - press.y) >= DRAG_THRESHOLD_PX) {
        press.isClick = false; // a pan is not a click on empty space
      }
      panMove(p);
    };
    const finishPan = (e: PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      activePointerRef.current = null;
      el.releasePointerCapture?.(e.pointerId);
      if (marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        marqueeEndRef.current?.();
        return;
      }
      const press = pressRef.current;
      pressRef.current = null;
      endPan();
      setPanning(false);
      // Clicking empty board space clears the selection (sticky.select).
      if (press?.isClick) emptyClickRef.current?.();
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (activePointerRef.current !== e.pointerId) return;
      activePointerRef.current = null;
      el.releasePointerCapture?.(e.pointerId);
      if (marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        marqueeCancelRef.current?.();
        return;
      }
      pressRef.current = null;
      endPan();
      setPanning(false);
    };
    const onDoubleClick = (e: MouseEvent) => {
      // Empty board space only; a note stops the event before it gets here.
      if (e.target !== el) return;
      // In the Text tool a second click means a second text, not a sticky note.
      if (toolRef.current === 'text') return;
      e.preventDefault();
      createStickyRef.current?.(toPoint(e));
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
    el.addEventListener('pointerdown', onPointerDownCapture, true);
    el.addEventListener('pointerup', onPointerUpCapture, true);
    el.addEventListener('pointercancel', onPointerCancelCapture, true);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', finishPan);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('lostpointercapture', finishPan);
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    el.addEventListener('gestureend', onGestureEnd as EventListener);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerdown', onPointerDownCapture, true);
      el.removeEventListener('pointerup', onPointerUpCapture, true);
      el.removeEventListener('pointercancel', onPointerCancelCapture, true);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', finishPan);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('lostpointercapture', finishPan);
      el.removeEventListener('dblclick', onDoubleClick);
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
      data-tool={tool}
      style={{
        backgroundImage: `radial-gradient(circle, ${DOT_COLOR} 1px, transparent 1px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: tool === 'text' ? 'text' : panning ? 'grabbing' : 'grab',
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
