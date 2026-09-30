// The board surface: dot grid background, world layer, and all board input
// (pointer drag to pan, wheel/trackpad scroll to pan, Ctrl/Cmd wheel and Safari
// gesture to zoom around the pointer, Ctrl/Cmd + = / - / 0 to step and reset).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
} from '../../shared/config';
import { worldToScreen } from './camera';
import { useBoardCamera } from './CameraProvider';

/** Interaction state: Idle -> Panning -> Idle (see the story state diagram). */
export type InteractionMode = 'idle' | 'panning';

/** Rendered dot radius in CSS pixels, scaled with zoom so the grid stays legible. */
const GRID_DOT_MIN_PX = 0.6;
const GRID_DOT_MAX_PX = 5;
const GRID_DOT_PX_PER_ZOOM = 1.1;

/** Colour of a grid dot on the board. */
const GRID_DOT_COLOUR = 'rgba(30, 30, 40, 0.28)';

function modulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** Convert a wheel delta (which may be in lines or pages) to CSS pixels. */
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_PAGE_PX;
  return delta;
}

/** True when the keyboard shortcut should be left to the browser/page (typing). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName);
}

export interface BoardViewportProps {
  /** Board content, rendered in world coordinates. */
  children?: ReactNode;
}

export function BoardViewport({ children }: BoardViewportProps): JSX.Element {
  const api = useBoardCamera();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<InteractionMode>('idle');
  /** Same as `mode`, readable synchronously from event handlers. */
  const modeRef = useRef<InteractionMode>('idle');

  // Keep the newest camera API in a ref so the non-passive wheel, gesture and
  // key listeners are attached once and never call a stale camera.
  const apiRef = useRef(api);
  apiRef.current = api;

  const { camera } = api;
  const zoom = camera.zoom;

  /** Board-area coordinates of a browser event. */
  const pointOf = useCallback((clientX: number, clientY: number) => {
    const el = viewportRef.current;
    if (el === null) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // --- Wheel: panning and zooming. Added manually because React's onWheel is
  // passive, and preventDefault is required so the board owns the gesture and
  // the browser page never scrolls or zooms. ---
  useEffect(() => {
    const el = viewportRef.current;
    if (el === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { x, y } = pointOf(event.clientX, event.clientY);
      apiRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: { x, y },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // --- Safari gesture events (pinch on macOS trackpads/touch screens). ---
    let gestureScale = 1;
    const isGesture = (event: Event): event is GestureEvent =>
      'scale' in event && typeof (event as GestureEvent).scale === 'number';
    const onGestureStart = (event: Event) => {
      if (!isGesture(event)) return;
      event.preventDefault();
      gestureScale = event.scale;
    };
    const onGestureChange = (event: Event) => {
      if (!isGesture(event)) return;
      event.preventDefault();
      const factor = gestureScale === 0 ? 1 : event.scale / gestureScale;
      gestureScale = event.scale;
      const { x, y } = pointOf(event.clientX, event.clientY);
      apiRef.current.pinchAt({ x, y }, factor);
    };
    const onGestureEnd = (event: Event) => {
      if (!isGesture(event)) return;
      event.preventDefault();
      gestureScale = 1;
    };
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    el.addEventListener('gestureend', onGestureEnd, { passive: false });

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [pointOf]);

  // --- Keyboard: Ctrl/Cmd + = (zoom in), Ctrl/Cmd + - (zoom out),
  // Ctrl/Cmd + 0 (Reset view). preventDefault stops the browser zooming the page. ---
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const key = event.key;
      const zoomIn = key === '=' || key === '+' || key === 'NumpadAdd' || key === 'NumpadEqual';
      const zoomOut = key === '-' || key === '_' || key === 'Subtract' || key === 'NumpadSubtract';
      const reset = key === '0' || key === 'Numpad0';
      if (!zoomIn && !zoomOut && !reset) return;
      event.preventDefault();
      if (zoomIn) apiRef.current.zoomStep('in');
      else if (zoomOut) apiRef.current.zoomStep('out');
      else apiRef.current.reset();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // --- Pointer drag to pan. Only starts on empty board space: objects in later
  // stories stop propagation, and anything that is not the surface itself is
  // ignored here so it can own its own drag. ---
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (el === null) return;
    if (event.target !== el) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    el.setPointerCapture?.(event.pointerId);
    apiRef.current.beginPan(pointOf(event.clientX, event.clientY));
    modeRef.current = 'panning';
    setMode('panning');
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (modeRef.current !== 'panning') return;
    apiRef.current.panMove(pointOf(event.clientX, event.clientY));
  };

  const endDrag = useCallback(() => {
    apiRef.current.endPan();
    modeRef.current = 'idle';
    setMode('idle');
  }, []);

  const spacing = GRID_SPACING_WORLD * zoom;
  const gridOffsetX = modulo(-camera.x * zoom, spacing);
  const gridOffsetY = modulo(-camera.y * zoom, spacing);
  const dotRadius = Math.min(GRID_DOT_MAX_PX, Math.max(GRID_DOT_MIN_PX, GRID_DOT_PX_PER_ZOOM * zoom));
  const origin = worldToScreen(camera, { x: 0, y: 0 });

  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      data-mode={mode}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      data-grid-spacing={spacing}
      data-grid-offset-x={gridOffsetX}
      data-grid-offset-y={gridOffsetY}
      data-origin-x={origin.x}
      data-origin-y={origin.y}
      className={`board-viewport${mode === 'panning' ? ' is-panning' : ''}`}
      style={{
        backgroundImage: `radial-gradient(circle at 50% 50%, ${GRID_DOT_COLOUR} 0 ${dotRadius}px, transparent ${dotRadius}px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        backgroundRepeat: 'repeat',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <div
        data-testid="board-world"
        className="board-world"
        style={{
          transform: `scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {/* The board's starting point, always visible, so users (and tests)
            have a fixed landmark at world (0, 0). */}
        <div data-testid="origin-marker" className="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
