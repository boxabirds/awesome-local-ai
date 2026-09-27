// The board's input surface: dot grid background, world layer, and all
// pointer / wheel / gesture handling.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useCamera, type CameraApi } from './useCamera';
import type { Size } from './camera';
import {
  GRID_SPACING_WORLD,
  WHEEL_DELTA_LINE_PX,
  WHEEL_DELTA_MODE_LINE,
  WHEEL_DELTA_MODE_PAGE,
} from '../../shared/config';

const GRID_DOT_COLOR = '#c7cdd6';
const GRID_DOT_RADIUS_PX = 1.5;

export interface BoardViewportProps {
  /** Rendered inside the world layer (world coordinates). */
  children?: React.ReactNode;
  /**
   * Shared camera instance. When omitted the viewport creates its own
   * (standalone usage); App passes the shared one so the zoom controls and
   * hint observe the same camera.
   */
  camera?: CameraApi;
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function deltaToPixels(delta: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === WHEEL_DELTA_MODE_LINE) return delta * WHEEL_DELTA_LINE_PX;
  if (deltaMode === WHEEL_DELTA_MODE_PAGE) return delta * pageHeight;
  return delta;
}

export function BoardViewport({ children, camera: cameraProp }: BoardViewportProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);

  const ownCamera = useCamera(viewport);
  const camera: CameraApi = cameraProp ?? ownCamera;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // Measure the viewport; camera x,y are intentionally untouched by resizes.
  useEffect(() => {
    if (cameraProp !== undefined) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      setViewport({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cameraProp]);

  // Non-passive wheel listener: must be able to preventDefault so the page
  // never scrolls or zooms while the board handles the gesture.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      cameraRef.current.wheel({
        deltaX: deltaToPixels(e.deltaX, e.deltaMode, viewport.height),
        deltaY: deltaToPixels(e.deltaY, e.deltaMode, viewport.height),
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewport.height]);

  // Safari trackpad pinch (GestureEvent); other browsers never fire these.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as Event & { scale: number; clientX: number; clientY: number };
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      const rect = el.getBoundingClientRect();
      cameraRef.current.zoomAtPoint(
        { x: gesture.clientX - rect.left, y: gesture.clientY - rect.top },
        gesture.scale / lastScale,
      );
      lastScale = gesture.scale;
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  const { camera: cam } = camera;
  const spacing = GRID_SPACING_WORLD * cam.zoom;
  const offsetX = positiveMod(-cam.x * cam.zoom, spacing);
  const offsetY = positiveMod(-cam.y * cam.zoom, spacing);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Drag starts only on empty board space (the viewport or world layer
  // themselves), so later object stories can stop propagation on their nodes.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && e.target !== worldRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
    camera.beginPan(toLocal(e));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!panning) return;
    camera.panMove(toLocal(e));
  };

  const finishPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setPanning(false);
    camera.endPan();
  };

  return (
    <div
      ref={containerRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-pan-state={panning ? 'panning' : 'idle'}
      style={{
        backgroundImage: `radial-gradient(circle, ${GRID_DOT_COLOR} ${GRID_DOT_RADIUS_PX}px, transparent ${GRID_DOT_RADIUS_PX + 0.5}px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onLostPointerCapture={finishPan}
    >
      <div
        ref={worldRef}
        className="board-world"
        data-testid="board-world"
        style={{
          transform: `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
