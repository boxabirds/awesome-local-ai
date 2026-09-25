import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  ORIGIN_MARKER_SIZE_PX,
} from '../../shared/config';
import { mod, worldToScreen } from './camera';
import { useCameraApi, wheelDeltaToPixels } from './useCamera';

/**
 * The input surface of the board.
 *
 * Everything is positioned with CSS transforms: a dot-grid background whose
 * size and phase come from the camera (so the grid looks attached to the
 * board), and a "world layer" whose transform maps world coordinates to screen
 * pixels. Children are rendered in world coordinates.
 */
export interface BoardViewportProps {
  children?: ReactNode;
}

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

export function BoardViewport({ children }: BoardViewportProps) {
  const api = useCameraApi();
  const apiRef = useRef(api);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panningRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const [panning, setPanning] = useState(false);

  // Declared before the listeners effect so the bound-once listeners always
  // see the newest camera api.
  useEffect(() => {
    apiRef.current = api;
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const localPoint = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };

    /** True when the pointer is on empty board surface, not on a board object. */
    const isSurface = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      return target.closest('[data-board-object]') === null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Touch and pen navigation is out of scope for this story.
      if (event.pointerType !== 'mouse') return;
      if (!isSurface(event.target)) return;
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // jsdom and older browsers have no pointer capture; dragging still works.
      }
      panningRef.current = true;
      setPanning(true);
      apiRef.current.beginPan({ x: event.clientX, y: event.clientY });
      // Stops text selection / native page scroll while dragging.
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!panningRef.current) return;
      apiRef.current.panMove({ x: event.clientX, y: event.clientY });
    };

    /** Idle is reached on pointerup, pointercancel and lostpointercapture. */
    const endPan = () => {
      if (!panningRef.current) return;
      panningRef.current = false;
      setPanning(false);
      apiRef.current.endPan();
    };

    const onWheel = (event: WheelEvent) => {
      // The board owns the wheel over the board: preventing the default stops
      // both page scrolling and browser page zoom (Ctrl/Cmd + wheel).
      event.preventDefault();
      apiRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: localPoint(event.clientX, event.clientY),
      });
    };

    const onGestureStart = (event: Event) => {
      // Safari's gesture scale is cumulative, so restart the ratio baseline.
      event.preventDefault();
      gestureScaleRef.current = 1;
    };

    const onGestureChange = (event: GestureEventLike) => {
      event.preventDefault();
      const scale = typeof event.scale === 'number' ? event.scale : Number.NaN;
      if (!Number.isFinite(scale) || scale <= 0) return;
      const factor = scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;
      if (factor === 1) return;
      apiRef.current.wheel({
        deltaX: 0,
        deltaY: 0,
        ctrlOrMeta: true,
        point: localPoint(event.clientX ?? 0, event.clientY ?? 0),
        scale: factor,
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key;
      if (key === '=' || key === '+') {
        event.preventDefault(); // would otherwise zoom the whole page
        apiRef.current.zoomStep('in');
      } else if (key === '-' || key === '_') {
        event.preventDefault();
        apiRef.current.zoomStep('out');
      } else if (key === '0') {
        event.preventDefault();
        apiRef.current.reset();
      }
    };

    const onGestureChangeAsListener = (event: Event) =>
      onGestureChange(event as GestureEventLike);

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', endPan);
    el.addEventListener('pointercancel', endPan);
    el.addEventListener('lostpointercapture', endPan);
    // React's onWheel is passive, so the wheel listener is attached by hand.
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChangeAsListener, {
      passive: false,
    });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', endPan);
      el.removeEventListener('pointercancel', endPan);
      el.removeEventListener('lostpointercapture', endPan);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChangeAsListener);
      window.removeEventListener('keydown', onKeyDown);
      panningRef.current = false;
    };
  }, []);

  const camera = api.camera;
  const zoom = camera.zoom;
  const spacingPx = GRID_SPACING_WORLD * zoom;
  const origin = worldToScreen(camera, { x: 0, y: 0 });
  const halfMarker = ORIGIN_MARKER_SIZE_PX / 2;
  const halfSpacing = spacingPx / 2;

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      data-camera={`${camera.x},${camera.y},${zoom}`}
      data-origin={`${origin.x},${origin.y}`}
      style={{
        backgroundImage: `radial-gradient(rgba(56, 66, 84, 0.45) ${GRID_DOT_RADIUS_PX}px, rgba(0, 0, 0, 0) ${GRID_DOT_RADIUS_PX}px)`,
        backgroundSize: `${spacingPx}px ${spacingPx}px`,
        backgroundPosition: `${mod(origin.x - halfSpacing, spacingPx)}px ${mod(
          origin.y - halfSpacing,
          spacingPx,
        )}px`,
      }}
    >
      <div
        className="board-world"
        data-testid="world-layer"
        data-transform={`scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`}
        style={{
          transform: `scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
      <div
        className="board-origin-marker"
        data-testid="origin-marker"
        aria-hidden="true"
        style={{
          transform: `translate(${origin.x - halfMarker}px, ${origin.y - halfMarker}px)`,
        }}
      >
        <svg
          width={ORIGIN_MARKER_SIZE_PX}
          height={ORIGIN_MARKER_SIZE_PX}
          viewBox={`0 0 ${ORIGIN_MARKER_SIZE_PX} ${ORIGIN_MARKER_SIZE_PX}`}
          focusable="false"
        >
          <line
            x1="0"
            y1={halfMarker}
            x2={ORIGIN_MARKER_SIZE_PX}
            y2={halfMarker}
            stroke="rgba(224, 96, 72, 0.9)"
            strokeWidth="1"
          />
          <line
            x1={halfMarker}
            y1="0"
            x2={halfMarker}
            y2={ORIGIN_MARKER_SIZE_PX}
            stroke="rgba(224, 96, 72, 0.9)"
            strokeWidth="1"
          />
          <circle
            cx={halfMarker}
            cy={halfMarker}
            r="3"
            fill="none"
            stroke="rgba(224, 96, 72, 0.9)"
            strokeWidth="1"
          />
        </svg>
      </div>
    </div>
  );
}
