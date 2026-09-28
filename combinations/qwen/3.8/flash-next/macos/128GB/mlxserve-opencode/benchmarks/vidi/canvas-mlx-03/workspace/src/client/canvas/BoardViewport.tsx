import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { Camera, Point } from './camera.ts';
import type { CameraApi } from './useCamera.ts';
import { GRID_SPACING_WORLD, WHEEL_LINE_HEIGHT_PX, WHEEL_PAGE_HEIGHT_PX } from '../../shared/config.ts';

export interface BoardViewportProps {
  camera: Camera;
  viewportRef: RefObject<HTMLDivElement | null>;
  api: Pick<CameraApi, 'beginPan' | 'panMove' | 'endPan' | 'wheel' | 'gesture'>;
  children?: ReactNode;
}

interface GestureEventLike extends Event {
  scale?: number;
}

function pointFrom(e: { clientX: number; clientY: number }, rect: DOMRect): Point {
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// Convert a wheel event's delta to CSS pixels, honouring deltaMode.
function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_PX; // DOM_DELTA_LINE
  if (deltaMode === 2) return delta * WHEEL_PAGE_HEIGHT_PX; // DOM_DELTA_PAGE
  return delta; // DOM_DELTA_PIXEL
}

/**
 * The board input surface: dot-grid background, a world layer positioned with a
 * CSS transform, and the origin crosshair. Handles pointer drag, non-passive
 * wheel (board-owned), and Safari gesture events. All input calls go through the
 * camera.math API so the board never zooms the page.
 */
export function BoardViewport({ camera, viewportRef, api, children }: BoardViewportProps) {
  const apiRef = useRef(api);
  apiRef.current = api;

  // Non-passive wheel listener so we can always preventDefault over the board
  // (React's onWheel is passive and cannot stop page zoom / scroll).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Board owns the gesture: stop page zoom (ctrl/meta) and page scroll.
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      apiRef.current.wheel({
        deltaX: wheelPixels(e.deltaX, e.deltaMode),
        deltaY: wheelPixels(e.deltaY, e.deltaMode),
        ctrlOrMeta,
        point: pointFrom(e, rect),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewportRef]);

  // Safari (macOS/iOS) trackpad pinch fires gesture* events.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const startScaleRef = { current: 1 };
    const startCamRef = { current: null as null | Camera };
    void startCamRef;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      startScaleRef.current = (e as GestureEventLike).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ge = e as GestureEventLike & { clientX?: number; clientY?: number };
      const scale = ge.scale ?? 1;
      const point: Point =
        typeof ge.clientX === 'number' && typeof ge.clientY === 'number'
          ? { x: ge.clientX - rect.left, y: ge.clientY - rect.top }
          : { x: rect.width / 2, y: rect.height / 2 };
      apiRef.current.gesture(scale / startScaleRef.current, point);
      startScaleRef.current = scale;
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
    };
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    el.addEventListener('gestureend', onGestureEnd as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [viewportRef]);

  const zoom = camera.zoom;
  const gridPx = GRID_SPACING_WORLD * zoom;
  const pos = worldToScreenPx(camera);
  const bgX = ((pos.x % gridPx) + gridPx) % gridPx;
  const bgY = ((pos.y % gridPx) + gridPx) % gridPx;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only start a pan when the press is on the board surface itself (viewport /
    // grid / origin marker), never on a board object (later stories stopPropagation).
    if (e.target !== e.currentTarget) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.style.cursor = 'grabbing';
    const rect = e.currentTarget.getBoundingClientRect();
    apiRef.current.beginPan(pointFrom(e, rect));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    apiRef.current.panMove(pointFrom(e, rect));
  };
  const finish = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    e.currentTarget.style.cursor = 'grab';
    apiRef.current.endPan();
  };

  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      className="vidi6-viewport"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        overscrollBehavior: 'none',
        backgroundImage: 'radial-gradient(circle, #b8bcc4 1px, transparent 1.2px)',
        backgroundSize: `${gridPx}px ${gridPx}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: 'grab',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        <div
          data-testid="origin-marker"
          aria-hidden
          style={{
            position: 'absolute',
            left: -10,
            top: -10,
            width: 20,
            height: 20,
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 9,
              width: 20,
              height: 2,
              background: 'rgba(60,64,72,0.5)',
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: 9,
              top: 0,
              width: 2,
              height: 20,
              background: 'rgba(60,64,72,0.5)',
            }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

// Screen offset of the world origin (used to keep the grid welded to the board).
function worldToScreenPx(cam: Camera): Point {
  return { x: -cam.x * cam.zoom, y: -cam.y * cam.zoom };
}
