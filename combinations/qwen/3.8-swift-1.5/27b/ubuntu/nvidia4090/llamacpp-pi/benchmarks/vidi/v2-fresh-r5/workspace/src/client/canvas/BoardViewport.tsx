import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/** Minimal shape of Safari's (non-standard) GestureEvent. */
interface SafariGestureEvent {
  scale: number;
  clientX: number;
  clientY: number;
}
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent, type Size } from './camera';
import { GRID_SPACING_WORLD, WHEEL_LINE_PX, WHEEL_PAGE_PX } from '../../shared/config';
import { installTestHook } from './testHooks';

/** Positive modulo, in [0, b). */
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/**
 * The infinite board: a full-window input surface with a dot grid that moves
 * with the camera, a world layer positioned with a CSS transform, an origin
 * marker, the zoom controls and the first-use hint. Owns the camera via
 * {@link useCamera}.
 */
export function BoardViewport(props: { children?: ReactNode }): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panningRef = useRef(false);

  const cam = useCamera(size);
  const camRef = useRef(cam);
  camRef.current = cam;

  // Measure the viewport size with a ResizeObserver (full-window board).
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = (width: number, height: number) => {
      if (width > 0 || height > 0) setSize({ width, height });
    };
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        update(width, height);
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);
    return () => ro.disconnect();
  }, []);

  // Native, non-passive wheel listener so we can preventDefault (page scroll and
  // Ctrl/Cmd page zoom) over the board.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= WHEEL_LINE_PX;
        dy *= WHEEL_LINE_PX;
      } else if (e.deltaMode === 2) {
        dx *= WHEEL_PAGE_PX;
        dy *= WHEEL_PAGE_PX;
      }
      camRef.current.wheel({ deltaX: dx, deltaY: dy, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Safari pinch: GestureEvent is delivered as gesturestart/gesturechange.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as unknown as SafariGestureEvent;
      const scale = g.scale ?? 1;
      const ratio = scale / lastScale;
      lastScale = scale;
      const rect = el.getBoundingClientRect();
      const point = { x: g.clientX - rect.left, y: g.clientY - rect.top };
      camRef.current.zoomAtFactor(point, ratio);
    };
    el.addEventListener('gesturestart', onGestureStart as EventListener, { passive: false });
    el.addEventListener('gesturechange', onGestureChange as EventListener, { passive: false });
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, []);

  // Keyboard: Ctrl/Cmd + = / - / 0.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        camRef.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        camRef.current.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        camRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Test-only hook (excluded from production builds).
  useEffect(() => {
    installTestHook(camRef.current.setCamera);
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Start a pan only when pressing on the board surface itself (the viewport
    // or its grid). World content is pointer-events:none in this story.
    if (e.target !== e.currentTarget) return;
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') {
      el.setPointerCapture(e.pointerId);
    }
    panningRef.current = true;
    setIsPanning(true);
    const rect = e.currentTarget.getBoundingClientRect();
    camRef.current.beginPan({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!panningRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    camRef.current.panMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const endPan = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setIsPanning(false);
    camRef.current.endPan();
  }, []);

  const { camera } = cam;
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgX = mod(-camera.x * camera.zoom, spacing);
  const bgY = mod(-camera.y * camera.zoom, spacing);
  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <>
      <div
        ref={viewportRef}
        className="board-viewport"
        role="application"
        aria-label="Board"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          cursor: isPanning ? 'grabbing' : 'grab',
          touchAction: 'none',
          backgroundColor: '#fafafa',
          backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.28) 1px, transparent 1px)',
          backgroundSize: `${spacing}px ${spacing}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
        }}
      >
        <div
          className="board-world"
          data-testid="world"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: worldTransform,
            transformOrigin: '0 0',
            pointerEvents: 'none',
          }}
        >
          <div data-testid="origin" style={originMarkerStyle}>
            <span style={originBarHorizontal} />
            <span style={originBarVertical} />
          </div>
          {props.children}
        </div>
      </div>

      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </>
  );
}

const originMarkerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  pointerEvents: 'none',
};
const originBarHorizontal: CSSProperties = {
  position: 'absolute',
  left: -6,
  top: -1,
  width: 12,
  height: 2,
  background: '#e11d48',
};
const originBarVertical: CSSProperties = {
  position: 'absolute',
  left: -1,
  top: -6,
  width: 2,
  height: 12,
  background: '#e11d48',
};
