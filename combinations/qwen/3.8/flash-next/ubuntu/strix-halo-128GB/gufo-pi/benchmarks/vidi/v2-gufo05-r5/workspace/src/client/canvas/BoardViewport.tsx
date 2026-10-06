import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { worldToScreen } from './camera';
import { useBoardCamera } from './CameraProvider';
import {
  GRID_DOT_SIZE_SCREEN,
  GRID_SPACING_WORLD,
  WHEEL_LINE_MODE_PIXELS,
  WHEEL_PAGE_MODE_PIXELS,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';

/** WheelEvent.deltaMode values (the static constants are not in every environment). */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Safari's pinch gesture event (not in the TypeScript DOM lib). */
interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly rotation?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

function mod(value: number, modulus: number): number {
  if (!(modulus > 0)) return 0;
  return ((value % modulus) + modulus) % modulus;
}

/** Converts a wheel delta into CSS pixels whatever unit the browser reported. */
function wheelDeltaPixels(e: WheelEvent): { deltaX: number; deltaY: number } {
  const perUnit =
    e.deltaMode === DELTA_MODE_LINE
      ? WHEEL_LINE_MODE_PIXELS
      : e.deltaMode === DELTA_MODE_PAGE
        ? WHEEL_PAGE_MODE_PIXELS
        : 1;
  return { deltaX: e.deltaX * perUnit, deltaY: e.deltaY * perUnit };
}

/** True when the keyboard shortcut should go to the page, not to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  );
}

/**
 * The board's input surface: an unbounded area with a dot grid that moves with the
 * camera, a world layer (transformed with CSS) holding board objects, and an origin
 * marker that gives tests a stable pixel target.
 */
export function BoardViewport({ children }: { children?: ReactNode }) {
  const {
    camera,
    registerViewport,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
  } = useBoardCamera();
  const [node, setNodeState] = useState<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);
  // Guards the drag independently of render timing (Idle / Panning in the design).
  const panningGuard = useRef({ active: false });

  const setNode = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeState(el);
      registerViewport(el);
    },
    [registerViewport],
  );

  // ---- wheel (non-passive, so board gestures never zoom/scroll the page) ----
  useEffect(() => {
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { deltaX, deltaY } = wheelDeltaPixels(e);
      wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX, y: e.clientY },
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [node, wheel]);

  // ---- Safari trackpad pinch (gesturestart / gesturechange) ----
  useEffect(() => {
    if (!node) return;
    let gestureScale = 1;
    const rectOf = (e: GestureEventLike) => {
      const rect = node.getBoundingClientRect();
      const x = e.clientX ?? rect.width / 2;
      const y = e.clientY ?? rect.height / 2;
      return { x, y };
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = (e as GestureEventLike).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      const scale = gesture.scale ?? 1;
      const ratio = gestureScale > 0 ? scale / gestureScale : 1;
      gestureScale = scale;
      if (ratio === 1) return;
      // Express the pinch as the wheel delta that yields this zoom ratio.
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point: rectOf(gesture) });
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const options = { passive: false } as const;
    node.addEventListener('gesturestart', onGestureStart, options);
    node.addEventListener('gesturechange', onGestureChange, options);
    node.addEventListener('gestureend', onGestureEnd, options);
    return () => {
      node.removeEventListener('gesturestart', onGestureStart);
      node.removeEventListener('gesturechange', onGestureChange);
      node.removeEventListener('gestureend', onGestureEnd);
    };
  }, [node, wheel]);

  // ---- keyboard shortcuts (also stops the browser zooming the page) ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.defaultPrevented || isTextEntry(e.target)) return;
      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault();
          zoomStep('in');
          break;
        case '-':
        case '_':
          e.preventDefault();
          zoomStep('out');
          break;
        case '0':
          e.preventDefault();
          reset();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // ---- pointer drag ----
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return; // touch navigation is out of scope (story 1)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    // Only empty board space starts a pan; board objects handle their own gestures.
    if (target?.closest('[data-board-object]')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    panningGuard.current.active = true;
    setPanning(true);
    beginPan({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panningGuard.current.active) return;
    panMove({ x: e.clientX, y: e.clientY });
  };

  const stopPanning = () => {
    if (!panningGuard.current.active) return;
    panningGuard.current.active = false;
    setPanning(false);
    endPan(); // the board stays exactly where it was
  };

  const origin = worldToScreen(camera, { x: 0, y: 0 });
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const dot = `${GRID_DOT_SIZE_SCREEN}px`;

  return (
    <div
      ref={setNode}
      className="board-viewport"
      data-testid="board-viewport"
      data-board-surface
      data-interaction-state={panning ? 'panning' : 'idle'}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      style={{
        backgroundImage: `radial-gradient(circle, var(--grid-dot) ${dot}, transparent ${dot})`,
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${mod(-camera.x * camera.zoom, gridSpacing)}px ${mod(
          -camera.y * camera.zoom,
          gridSpacing,
        )}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopPanning}
      onPointerCancel={stopPanning}
      onLostPointerCapture={stopPanning}
    >
      <div
        className="board-world"
        data-testid="board-world"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        {children}
      </div>
      <div
        className="board-origin-marker"
        data-testid="origin-marker"
        aria-hidden="true"
        style={{ left: `${origin.x}px`, top: `${origin.y}px` }}
      />
    </div>
  );
}
