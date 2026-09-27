import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config.js';
import type { Size } from './camera.js';
import type { CameraApi } from './useCamera.js';
import { useViewportSize } from './useCamera.js';
import { OriginMarker } from './OriginMarker.js';

/** Screen pixels per wheel notch for a `deltaMode === LINE` event. */
export const LINE_HEIGHT_PX = 16;
/** Screen pixels per page for a `deltaMode === PAGE` wheel event. */
export const PAGE_HEIGHT_PX = 800;

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Camera and navigation operations. They are passed in rather than created here
   * so the zoom controls and the navigation hint — which live in screen space,
   * outside this element — drive the very same camera.
   */
  api: CameraApi;
  /** Overrides the measured viewport size (component tests). */
  size?: Size;
  /** Reports the measured board area size whenever it changes (window resizes). */
  onViewportSize?(size: Size): void;
  /** A double-click landed on empty board space, at a viewport-relative screen point. */
  onCreateAtPoint?(screenPoint: { x: number; y: number }): void;
  /** A press-and-release on empty board space that never dragged (clears the selection). */
  onClearSelection?(): void;
}

/** Convert a wheel delta of any `deltaMode` into CSS pixels. */
export const deltaToPixels = (delta: number, deltaMode: number | undefined): number => {
  if (deltaMode === 1) return delta * LINE_HEIGHT_PX;
  if (deltaMode === 2) return delta * PAGE_HEIGHT_PX;
  return delta;
};

const mod = (value: number, period: number): number => {
  if (!(period > 0)) return 0;
  return ((value % period) + period) % period;
};

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement);

/**
 * The infinite board: dot grid, world layer, and every board input gesture.
 * Drag pans, plain scroll pans, Ctrl/Cmd + wheel and trackpad pinch zoom around
 * the pointer, Ctrl/Cmd + = / - / 0 step the zoom and reset it. All of these call
 * `preventDefault`, so the page itself never scrolls or zooms.
 */
export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const { api } = props;
  const measured = useViewportSize();
  const viewport: Size = props.size ?? measured;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const frameRef = useRef(0);
  const queuedMove = useRef<{ x: number; y: number } | null>(null);
  const camera = api.camera;
  const downPointRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);

  const onViewportSize = props.onViewportSize;
  useEffect(() => {
    onViewportSize?.(viewport);
  }, [onViewportSize, viewport.width, viewport.height]);

  /** At most one camera update per animation frame while dragging. */
  const queueMove = useCallback(
    (point: { x: number; y: number }): void => {
      queuedMove.current = point;
      if (frameRef.current !== 0) return;
      const run = (): void => {
        frameRef.current = 0;
        const next = queuedMove.current;
        queuedMove.current = null;
        if (next) api.panMove(next);
      };
      if (typeof requestAnimationFrame === 'undefined') {
        run();
        return;
      }
      frameRef.current = requestAnimationFrame(run);
    },
    [api],
  );

  const stopPan = useCallback((): void => {
    if (!panningRef.current) return;
    panningRef.current = false;
    // Releasing must land exactly where the pointer was, never one coalesced step
    // short: apply the last pointer position we saw before dropping the frame.
    // (WebKit can deliver `pointerup` inside the same frame as the final move, so
    // cancelling a pending frame there used to swallow the last increment.)
    const pending = queuedMove.current;
    queuedMove.current = null;
    if (frameRef.current !== 0 && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (pending) api.panMove(pending);
    api.endPan();
    setPanning(false);
  }, [api]);

  useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const pointOf = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    /** Only empty board space (or the grid) starts a pan; objects stop propagation. */
    const isBoardSurface = (target: EventTarget | null): boolean =>
      target === el || (target instanceof Element && target.classList.contains('vidi-grid'));

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (!isBoardSurface(event.target)) return;
      panningRef.current = true;
      movedRef.current = false;
      downPointRef.current = pointOf(event.clientX, event.clientY);
      setPanning(true);
      el.setPointerCapture?.(event.pointerId);
      api.beginPan(pointOf(event.clientX, event.clientY));
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!panningRef.current) return;
      const point = pointOf(event.clientX, event.clientY);
      const down = downPointRef.current;
      if (down && Math.hypot(point.x - down.x, point.y - down.y) >= DRAG_THRESHOLD_PX) {
        movedRef.current = true;
      }
      queueMove(point);
    };

    const onWheel = (event: WheelEvent): void => {
      // The board owns its gestures: the page never scrolls or zooms.
      event.preventDefault();
      api.wheel({
        deltaX: deltaToPixels(event.deltaX, event.deltaMode),
        deltaY: deltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: pointOf(event.clientX, event.clientY),
      });
    };

    const gestureFields = (event: Event): { point: { x: number; y: number }; scale: number } => {
      const gestureEvent = event as Event & { scale?: number; clientX?: number; clientY?: number };
      return {
        point: pointOf(gestureEvent.clientX ?? 0, gestureEvent.clientY ?? 0),
        scale: gestureEvent.scale ?? 1,
      };
    };

    const onGestureStart = (event: Event): void => {
      // Safari trackpad pinch: take the gesture over before the browser can zoom.
      event.preventDefault();
      api.gestureStart(gestureFields(event).point);
    };

    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const { point, scale } = gestureFields(event);
      api.gesture(point, scale);
    };

    const onGestureEnd = (event: Event): void => {
      event.preventDefault();
      api.gestureEnd();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditable(event.target)) return;
      switch (event.key) {
        case '=':
        case '+':
          event.preventDefault();
          api.zoomStep('in');
          break;
        case '-':
        case '_':
          event.preventDefault();
          api.zoomStep('out');
          break;
        case '0':
          event.preventDefault();
          api.reset();
          break;
        default:
          // Any other Ctrl/Cmd combination belongs to the browser.
          break;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    el.addEventListener('gestureend', onGestureEnd as EventListener);
    // A press-and-release on empty board space that never moved clears the selection.
    const onPointerUp = (event: PointerEvent): void => {
      const wasPanning = panningRef.current;
      stopPan();
      if (wasPanning && !movedRef.current) props.onClearSelection?.();
      // Release the pointer capture React's synthetic pointerup may have left behind.
      if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture?.(event.pointerId);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', stopPan);
    el.addEventListener('lostpointercapture', stopPan);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', stopPan);
      el.removeEventListener('lostpointercapture', stopPan);
      window.removeEventListener('keydown', onKeyDown);
      if (frameRef.current !== 0 && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, [api, queueMove, stopPan, props]);

  // Dot grid: a repeating radial gradient on a full-viewport layer in screen space.
  // Its tile size and offset follow the camera, so the dots stay welded to the board.
  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  const dotRadius = Math.min(2, Math.max(0.5, 1.1 * camera.zoom));
  // scale(zoom) translate(-x, -y) maps a world point w to (w - camera.xy) * zoom,
  // exactly `worldToScreen`.
  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;
  const offsetX = mod(-camera.x * camera.zoom, spacingPx);
  const offsetY = mod(-camera.y * camera.zoom, spacingPx);

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Only empty board space (or the grid) creates a note; a note stops propagation.
    const target = event.target;
    const onEmpty =
      target === elementRef.current ||
      (target instanceof Element && target.classList.contains('vidi-grid'));
    if (!onEmpty) return;
    props.onCreateAtPoint?.({ x: event.clientX, y: event.clientY });
  };

  return (
    <div
      ref={elementRef}
      className="vidi-board-viewport"
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      role="application"
      aria-label="Board"
      onDoubleClick={onDoubleClick}
    >
      <div
        className="vidi-grid"
        data-testid="board-grid"
        aria-hidden="true"
        style={{
          backgroundImage: `radial-gradient(circle at 0 0, var(--vidi-grid-dot) 0 ${dotRadius}px, transparent ${dotRadius}px 100%)`,
          backgroundSize: `${spacingPx}px ${spacingPx}px`,
          backgroundPosition: `${offsetX}px ${offsetY}px`,
        }}
      />
      <div
        className="vidi-world"
        data-testid="world-layer"
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-camera-zoom={camera.zoom}
        data-world-transform={worldTransform}
        style={{ transform: worldTransform }}
      >
        <OriginMarker zoom={camera.zoom} />
        {props.children}
      </div>
    </div>
  );
}
