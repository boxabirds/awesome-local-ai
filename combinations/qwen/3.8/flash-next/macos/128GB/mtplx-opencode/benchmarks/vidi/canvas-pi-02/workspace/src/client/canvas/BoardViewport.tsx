import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  GRID_DOT_RADIUS_PX,
  GRID_SPACING_WORLD,
  ORIGIN_MARKER_SIZE_PX,
} from '../../shared/config';
import { mod, screenToWorld, worldToScreen } from './camera';
import type { Point } from './camera';
import { useCameraApi, wheelDeltaToPixels } from './useCamera';
import type { MarqueeApi } from '../board/Marquee';

/**
 * The input surface of the board.
 *
 * Everything is positioned with CSS transforms: a dot-grid background whose
 * size and phase come from the camera (so the grid looks attached to the
 * board), and a "world layer" whose transform maps world coordinates to screen
 * pixels. Children are rendered in world coordinates.
 *
 * Story 2 added click and double-click on empty surface.
 * Story 7 adds: shift+drag on empty surface = marquee, not pan.
 * Story 9 adds: text tool cursor and click-to-create.
 */
export interface BoardViewportProps {
  children?: ReactNode;
  /** Active tool (stories 9, 10). */
  tool?: 'select' | 'text' | 'shape' | 'connector';
  /** A press and release on empty surface with no pan in between. */
  onSurfaceClick?(point: Point): void;
  /** A double-click on empty surface, in world coordinates. */
  onSurfaceDoubleClick?(point: Point): void;
  /** Marquee state (story 7); shift+drag starts it instead of panning. */
  marqueeRef?: { current: MarqueeApi };
}

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

export function BoardViewport(props: BoardViewportProps) {
  const api = useCameraApi();
  const apiRef = useRef(api);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panningRef = useRef(false);
  const marqueeActiveRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const [panning, setPanning] = useState(false);
  const [marqueeing, setMarqueeing] = useState(false);
  const movedRef = useRef(false);
  const downPointRef = useRef<Point>({ x: 0, y: 0 });

  const propsRef = useRef<BoardViewportProps>(props);
  propsRef.current = props;

  // Keep toolRef in sync for use inside event handlers.
  const toolRef = useRef(props.tool ?? 'select');
  toolRef.current = props.tool ?? 'select';

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

    const isSurface = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return true;
      return target.closest('[data-board-object]') === null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (event.pointerType !== 'mouse') return;
      if (!isSurface(event.target)) return;

      // While a creation tool is active: no panning, no marquee.
      // Click will be handled in onPointerUp as surface click.
      if (toolRef.current === 'text' || toolRef.current === 'shape' || toolRef.current === 'connector') {
        // Don't start panning or marquee when text tool is active.
        try {
          el.setPointerCapture(event.pointerId);
        } catch {
          // jsdom and older browsers have no pointer capture; dragging still works.
        }
        panningRef.current = false;
        marqueeActiveRef.current = false;
        movedRef.current = false;
        downPointRef.current = { x: event.clientX, y: event.clientY };
        event.preventDefault();
        return;
      }

      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // jsdom and older browsers have no pointer capture; dragging still works.
      }
      const local = localPoint(event.clientX, event.clientY);

      // Shift+drag on empty surface = marquee selection instead of pan.
      if (event.shiftKey && propsRef.current.marqueeRef) {
        marqueeActiveRef.current = true;
        panningRef.current = false;
        setMarqueeing(true);
        setPanning(false);
        movedRef.current = true; // suppresses surface-click
        propsRef.current.marqueeRef.current.begin(local);
        event.preventDefault();
        return;
      }

      panningRef.current = true;
      marqueeActiveRef.current = false;
      movedRef.current = false;
      downPointRef.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
      apiRef.current.beginPan({ x: event.clientX, y: event.clientY });
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (marqueeActiveRef.current && propsRef.current.marqueeRef) {
        const local = localPoint(event.clientX, event.clientY);
        propsRef.current.marqueeRef.current.move(local);
        return;
      }
      if (!panningRef.current) return;
      const down = downPointRef.current;
      if (Math.abs(event.clientX - down.x) > 0.5 || Math.abs(event.clientY - down.y) > 0.5) {
        movedRef.current = true;
      }
      apiRef.current.panMove({ x: event.clientX, y: event.clientY });
    };

    const cancelGesture = () => {
      if (marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        setMarqueeing(false);
        propsRef.current.marqueeRef?.current.cancel();
        return;
      }
      if (!panningRef.current) return;
      panningRef.current = false;
      setPanning(false);
      apiRef.current.endPan();
    };

    const endPan = () => {
      if (marqueeActiveRef.current) {
        marqueeActiveRef.current = false;
        setMarqueeing(false);
        propsRef.current.marqueeRef?.current.end();
        return;
      }
      if (!panningRef.current) return;
      panningRef.current = false;
      setPanning(false);
      apiRef.current.endPan();
    };

    const onPointerUp = (event: PointerEvent) => {
      const wasMarquee = marqueeActiveRef.current;
      const wasClick = (panningRef.current || toolRef.current === 'text' || toolRef.current === 'shape' || toolRef.current === 'connector') && !movedRef.current;
      endPan();
      if (wasMarquee) return;
      if (!wasClick || !isSurface(event.target)) return;
      propsRef.current.onSurfaceClick?.(
        screenToWorld(apiRef.current.camera, localPoint(event.clientX, event.clientY)),
      );
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (!isSurface(event.target)) return;
      // Shape/Connector/Text tools: double-click does NOT create a sticky.
      if (toolRef.current === 'text' || toolRef.current === 'shape' || toolRef.current === 'connector') return;
      propsRef.current.onSurfaceDoubleClick?.(
        screenToWorld(apiRef.current.camera, localPoint(event.clientX, event.clientY)),
      );
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      apiRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: localPoint(event.clientX, event.clientY),
      });
    };

    const onGestureStart = (event: Event) => {
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
        event.preventDefault();
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
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', cancelGesture);
    el.addEventListener('lostpointercapture', endPan);
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('wheel', onWheel, { passive: false } as EventListenerOptions);
    el.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false } as EventListenerOptions);
    el.addEventListener('gesturechange', onGestureChangeAsListener as EventListener, {
      passive: false,
    } as EventListenerOptions);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', cancelGesture);
      el.removeEventListener('lostpointercapture', endPan);
      el.removeEventListener('dblclick', onDoubleClick);
      el.removeEventListener('wheel', onWheel as EventListener);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChangeAsListener as EventListener);
      window.removeEventListener('keydown', onKeyDown);
      panningRef.current = false;
      marqueeActiveRef.current = false;
    };
  }, []);

  const camera = api.camera;
  const zoom = camera.zoom;
  const spacingPx = GRID_SPACING_WORLD * zoom;
  const origin = worldToScreen(camera, { x: 0, y: 0 });
  const halfMarker = ORIGIN_MARKER_SIZE_PX / 2;
  const halfSpacing = spacingPx / 2;

  const cursorStyle = (props.tool === 'text' || props.tool === 'shape' || props.tool === 'connector') ? 'crosshair' : undefined;

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-panning={panning ? 'true' : 'false'}
      data-marqueeing={marqueeing ? 'true' : 'false'}
      data-camera={`${camera.x},${camera.y},${zoom}`}
      data-origin={`${origin.x},${origin.y}`}
      style={{
        backgroundImage: `radial-gradient(rgba(56, 66, 84, 0.45) ${GRID_DOT_RADIUS_PX}px, rgba(0, 0, 0, 0) ${GRID_DOT_RADIUS_PX}px)`,
        backgroundSize: `${spacingPx}px ${spacingPx}px`,
        backgroundPosition: `${mod(origin.x - halfSpacing, spacingPx)}px ${mod(
          origin.y - halfSpacing,
          spacingPx,
        )}px`,
        cursor: cursorStyle,
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
        {props.children}
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