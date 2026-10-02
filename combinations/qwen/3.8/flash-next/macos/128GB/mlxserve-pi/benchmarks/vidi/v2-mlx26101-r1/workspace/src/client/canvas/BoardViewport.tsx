import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  GRID_SPACING_WORLD,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import type { Camera, Point } from './camera';
import type { WheelInput } from './useCamera';

/** Convert a non-pixel wheel deltaMode to CSS pixels. */
const PIXELS_PER_LINE = 16;

/** Minimal shape of Safari's proprietary GestureEvent. */
interface GestureEventLike extends Event {
  readonly scale: number;
}

/** Screen-space modulo that always returns a non-negative remainder. */
function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

export interface BoardViewportProps {
  camera: Camera;
  onWheelInput(e: WheelInput): void;
  onBeginPan(p: Point): void;
  onPanMove(p: Point): void;
  onEndPan(): void;
  onZoomStep(dir: 'in' | 'out'): void;
  onReset(): void;
  children?: ReactNode;
}

/**
 * The full-window input surface and rendering of the infinite board: a dot grid
 * background and a world layer, both positioned from the camera with CSS
 * transforms. It is presentational for state but owns the raw DOM event wiring
 * (pointer drag, non-passive wheel, Safari gesture, keyboard shortcuts) and
 * forwards intent to the useCamera handlers passed in as props.
 */
export const BoardViewport = forwardRef<HTMLDivElement, BoardViewportProps>(
  function BoardViewport(
    {
      camera,
      onWheelInput,
      onBeginPan,
      onPanMove,
      onEndPan,
      onZoomStep,
      onReset,
      children,
    },
    ref,
  ) {
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const [panning, setPanning] = useState(false);

    const setSurface = useCallback(
      (node: HTMLDivElement | null) => {
        surfaceRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    /** Screen point (relative to the viewport surface) for a client coord. */
    const toLocal = useCallback((clientX: number, clientY: number): Point => {
      const el = surfaceRef.current;
      if (!el) return { x: clientX, y: clientY };
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    }, []);

    // --- Pointer drag to pan ------------------------------------------------
    const isBoardSurface = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.hasAttribute('data-board-grid') ||
        target.closest('[data-board-grid]') !== null);

    const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      // Only empty board space starts a drag; objects stop propagation.
      if (!isBoardSurface(e.target)) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setPanning(true);
      onBeginPan(toLocal(e.clientX, e.clientY));
    };

    const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!panning) return;
      onPanMove(toLocal(e.clientX, e.clientY));
    };

    const stopPan = () => {
      if (!panning) return;
      setPanning(false);
      onEndPan();
    };

    // --- Wheel (non-passive so we can stop page scroll / page zoom) ---------
    useEffect(() => {
      const el = surfaceRef.current;
      if (!el) return;

      const toPixels = (delta: number, mode: number, axisPx: number): number => {
        if (mode === 1) return delta * PIXELS_PER_LINE; // DOM_DELTA_LINE
        if (mode === 2) return delta * axisPx; // DOM_DELTA_PAGE
        return delta; // DOM_DELTA_PIXEL
      };

      const onWheel = (e: WheelEvent) => {
        // Always prevent over the board: stops the page from scrolling and,
        // with Ctrl/Cmd held, stops the browser from zooming the whole page.
        e.preventDefault();
        const point = toLocal(e.clientX, e.clientY);
        const ctrlOrMeta = e.ctrlKey || e.metaKey;
        const px = toPixels(e.deltaX, e.deltaMode, el.clientWidth || window.innerWidth);
        const py = toPixels(e.deltaY, e.deltaMode, el.clientHeight || window.innerHeight);
        onWheelInput({ deltaX: px, deltaY: py, ctrlOrMeta, point });
      };

      const onGestureStart = (e: Event) => e.preventDefault();
      const onGestureChange = (e: Event) => {
        e.preventDefault();
        const scale = (e as GestureEventLike).scale;
        if (!Number.isFinite(scale) || scale <= 0) return;
        // Map a gesture scale onto the pinch/wheel zoom path: choosing
        // deltaY = -ln(scale)/sensitivity makes zoomAt receive exactly `scale`.
        const deltaY = -Math.log(scale) / WHEEL_ZOOM_SENSITIVITY;
        const ge = e as unknown as MouseEvent;
        onWheelInput({
          deltaX: 0,
          deltaY,
          ctrlOrMeta: true,
          point: toLocal(ge.clientX ?? 0, ge.clientY ?? 0),
        });
      };

      el.addEventListener('wheel', onWheel, { passive: false });
      // Safari-only pinch gestures; absent elsewhere, harmless to register.
      el.addEventListener('gesturestart', onGestureStart as EventListener, {
        passive: false,
      });
      el.addEventListener('gesturechange', onGestureChange as EventListener, {
        passive: false,
      });
      return () => {
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('gesturestart', onGestureStart as EventListener);
        el.removeEventListener('gesturechange', onGestureChange as EventListener);
      };
    }, [onWheelInput, toLocal]);

    // --- Keyboard shortcuts (window level, board focused) -------------------
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        switch (e.key) {
          case '=':
          case '+':
            e.preventDefault();
            onZoomStep('in');
            break;
          case '-':
          case '_':
            e.preventDefault();
            onZoomStep('out');
            break;
          case '0':
            e.preventDefault();
            onReset();
            break;
        }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [onZoomStep, onReset]);

    // --- Rendering derived from the camera ----------------------------------
    const spacing = GRID_SPACING_WORLD * camera.zoom;
    const bgX = mod(-camera.x * camera.zoom, spacing);
    const bgY = mod(-camera.y * camera.zoom, spacing);

    return (
      <div
        ref={setSurface}
        data-board-grid=""
        data-interaction={panning ? 'Panning' : 'Idle'}
        data-testid="board-viewport"
        className="board-viewport"
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          touchAction: 'none',
          cursor: panning ? 'grabbing' : 'grab',
          backgroundColor: '#f7f8fa',
          backgroundImage:
            'radial-gradient(circle, #c4c9d4 1px, transparent 1.5px)',
          backgroundSize: `${spacing}px ${spacing}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPan}
        onPointerCancel={stopPan}
        onLostPointerCapture={stopPan}
      >
        <div
          data-testid="world-layer"
          data-x={camera.x}
          data-y={camera.y}
          data-zoom={camera.zoom}
          className="world-layer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            transformOrigin: '0 0',
            transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
            pointerEvents: 'none',
          }}
        >
          {/* Stable pixel target for e2e: a crosshair at world (0, 0). The
              marker box itself is 0x0 so its bounding rect is exactly
              worldToScreen(0, 0); the visible crosshair is counter-scaled so it
              stays a constant screen size at any zoom. */}
          <div
            data-testid="origin-marker"
            data-world-x="0"
            data-world-y="0"
            className="origin-marker"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            <span
              className="origin-cross"
              data-testid="origin-marker-visual"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 24,
                height: 24,
                marginLeft: -12,
                marginTop: -12,
                transform: `scale(${1 / camera.zoom})`,
                transformOrigin: '50% 50%',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 0,
                  width: 2,
                  height: '100%',
                  marginLeft: -1,
                  background: '#e5484d',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 0,
                  height: 2,
                  width: '100%',
                  marginTop: -1,
                  background: '#e5484d',
                }}
              />
            </span>
          </div>
          {children}
        </div>
      </div>
    );
  },
);
