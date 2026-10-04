import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import type { Point } from './camera';
import type { CameraApi } from './useCamera';

/** Wheel deltaMode values (WheelEvent.DOM_DELTA_*) as named constants. */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;
/** Pixel equivalents used to convert LINE/PAGE wheel deltas to pixels. */
const WHEEL_LINE_DELTA_PIXELS = 16;
const WHEEL_PAGE_DELTA_PIXELS = 100;
const GESTURE_START_SCALE = 1;

export interface BoardViewportProps extends CameraApi {
  /** Rendered in world coordinates inside the world layer. */
  children?: ReactNode;
  /** Called when the user double-clicks empty board space. */
  onDblClickEmpty?(screenX: number, screenY: number): void;
  /** Called when the user clicks empty board space (no drag), with client coords. */
  onClickEmpty?(screenX: number, screenY: number): void;
  /** The active board tool (story 9): sets the cursor style. */
  tool?: 'select' | 'text';
  /** Called when Shift+pointerdown on empty space (starts marquee). */
  onShiftPointerDownEmpty?(screenPoint: { x: number; y: number }): void;
  /** Called during Shift+drag marquee. */
  onShiftPointerMove?(screenPoint: { x: number; y: number }): void;
  /** Called on Shift+pointerup (ends marquee). */
  onShiftPointerUp?(): void;
  /** Called on pointercancel during marquee. */
  onShiftPointerCancel?(): void;
}

/** a mod b with a non-negative result. */
function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * The full-window board surface: input handling (pointer drag, non-passive
 * wheel, Safari gestures, Ctrl/Cmd keyboard shortcuts), the dot grid and the
 * transformed world layer.
 */
export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const { camera, beginPan, panMove, endPan, wheel, zoomStep, reset, children, onDblClickEmpty, onClickEmpty, tool, onShiftPointerDownEmpty, onShiftPointerMove, onShiftPointerUp, onShiftPointerCancel } = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const gestureScaleRef = useRef(GESTURE_START_SCALE);
  const [panning, setPanning] = useState(false);
  const wasPanningRef = useRef(false);
  const marqueeActiveRef = useRef(false);

  const toViewportPoint = useCallback((clientX: number, clientY: number): Point => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  // --- Pointer drag (pan.drag) / Marquee (Shift+drag) ---------------------------
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      // Drag only starts on empty board space (the viewport, the grid, or
      // the world layer itself — the world layer only covers the area the
      // camera has panned over, so it must be a valid drag target too);
      // object nodes stopPropagation from their own handlers.
      const grid = viewport.querySelector('.board-grid');
      const target = e.target as HTMLElement;
      const isBoardSurface =
        target === viewport ||
        target === grid ||
        target.classList.contains('board-world') ||
        target.classList.contains('board-objects');
      if (!isBoardSurface) return;
      try {
        viewport.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture unsupported (e.g. jsdom): drag still works.
      }

      // Shift+drag on empty space → marquee selection
      if (e.shiftKey && onShiftPointerDownEmpty) {
        marqueeActiveRef.current = true;
        onShiftPointerDownEmpty(toViewportPoint(e.clientX, e.clientY));
        return;
      }

      wasPanningRef.current = false;
      setPanning(true);
      beginPan(toViewportPoint(e.clientX, e.clientY));
    },
    [beginPan, toViewportPoint, onShiftPointerDownEmpty],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Marquee move
      if (marqueeActiveRef.current) {
        onShiftPointerMove?.(toViewportPoint(e.clientX, e.clientY));
        return;
      }
      if (!panning) return;
      wasPanningRef.current = true;
      panMove(toViewportPoint(e.clientX, e.clientY));
    },
    [panning, panMove, toViewportPoint, onShiftPointerMove],
  );

  const onEndPan = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Marquee end
      if (marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        const viewport = viewportRef.current;
        if (
          viewport &&
          typeof viewport.hasPointerCapture === 'function' &&
          viewport.hasPointerCapture(e.pointerId)
        ) {
          viewport.releasePointerCapture(e.pointerId);
        }
        onShiftPointerUp?.();
        return;
      }

      if (!panning) return;
      setPanning(false);
      const viewport = viewportRef.current;
      if (
        viewport &&
        typeof viewport.hasPointerCapture === 'function' &&
        viewport.hasPointerCapture(e.pointerId)
      ) {
        viewport.releasePointerCapture(e.pointerId);
      }
      endPan();
      // If we didn't actually pan (no movement), treat as a click on empty space
      if (!wasPanningRef.current && onClickEmpty) {
        onClickEmpty(e.clientX, e.clientY);
      }
      wasPanningRef.current = false;
    },
    [panning, endPan, onClickEmpty, onShiftPointerUp],
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Marquee cancel
      if (marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        const viewport = viewportRef.current;
        if (
          viewport &&
          typeof viewport.hasPointerCapture === 'function' &&
          viewport.hasPointerCapture(e.pointerId)
        ) {
          viewport.releasePointerCapture(e.pointerId);
        }
        onShiftPointerCancel?.();
        return;
      }
      // Regular pan cancel
      onEndPan(e);
    },
    [onEndPan, onShiftPointerCancel],
  );

  // --- Double-click on empty space → create note ---
  const onDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      // Only trigger on empty board areas (viewport, grid, or world container)
      const target = e.target as HTMLElement;
      if (target === viewport || target.classList.contains('board-grid') || target.classList.contains('board-world')) {
        if (onDblClickEmpty) {
          onDblClickEmpty(e.clientX, e.clientY);
        }
      }
    },
    [onDblClickEmpty],
  );

  // --- Wheel: pan, or zoom when Ctrl/Cmd is held (pan.scroll, zoom.pointer) ---
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      // Always prevent the default over the board: plain scroll must not
      // scroll the page and Ctrl/Cmd wheel must not zoom the page.
      e.preventDefault();
      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      if (e.deltaMode === DELTA_MODE_LINE) {
        deltaX *= WHEEL_LINE_DELTA_PIXELS;
        deltaY *= WHEEL_LINE_DELTA_PIXELS;
      } else if (e.deltaMode === DELTA_MODE_PAGE) {
        deltaX *= WHEEL_PAGE_DELTA_PIXELS;
        deltaY *= WHEEL_PAGE_DELTA_PIXELS;
      }
      wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toViewportPoint(e.clientX, e.clientY),
      });
    };
    // React's onWheel is passive, so attach non-passively to preventDefault.
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [wheel, toViewportPoint]);

  // --- Safari pinch (gesturestart/gesturechange) -------------------------------
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = GESTURE_START_SCALE;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      if (!Number.isFinite(ge.scale) || ge.scale <= 0) return;
      const ratio = ge.scale / gestureScaleRef.current;
      gestureScaleRef.current = ge.scale;
      // Express the scale ratio as an equivalent Ctrl-wheel delta so the zoom
      // runs through the same pointer-anchored path: exp(-d * s) = ratio.
      wheel({
        deltaX: 0,
        deltaY: -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point: toViewportPoint(ge.clientX, ge.clientY),
      });
    };
    viewport.addEventListener('gesturestart', onGestureStart);
    viewport.addEventListener('gesturechange', onGestureChange);
    return () => {
      viewport.removeEventListener('gesturestart', onGestureStart);
      viewport.removeEventListener('gesturechange', onGestureChange);
    };
  }, [wheel, toViewportPoint]);

  // --- Keyboard: Ctrl/Cmd + = / - / 0 (zoom.step, view.reset) ------------------
  useEffect(() => {
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
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // --- Rendering ---------------------------------------------------------------
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = positiveMod(-camera.x * camera.zoom, spacing);
  const gridOffsetY = positiveMod(-camera.y * camera.zoom, spacing);

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-vidi6="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      data-tool={tool ?? 'select'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onEndPan}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onEndPan}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="board-grid"
        data-vidi6="board-grid"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--vidi6-dot-color) 1px, transparent 1.5px)',
          backgroundSize: `${spacing}px ${spacing}px`,
          backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        }}
      />
      <div
        className="board-world"
        data-vidi6="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div className="origin-marker" data-vidi6="origin-marker" />
        {children}
      </div>
    </div>
  );
}
