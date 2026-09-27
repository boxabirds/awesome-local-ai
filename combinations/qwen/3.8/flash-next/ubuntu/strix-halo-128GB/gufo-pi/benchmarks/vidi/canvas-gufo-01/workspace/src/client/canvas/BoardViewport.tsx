// The canvas viewport: infinite pannable/zoomable surface (story 1) with the
// world layer that holds note objects. Input handling:
//   - drag on empty canvas (or middle button / space) pans
//   - ctrl/cmd + wheel and pinch zoom at the cursor/midpoint; plain wheel pans
//   - marquee selection with the left button on empty canvas
// The viewport itself holds no board state.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';
import { screenToWorld, type Camera } from './camera';
import type { CameraController } from './useCamera';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewportProps {
  camera: Camera;
  controller: CameraController;
  children?: ReactNode;
  overlay?: ReactNode;
  onMarquee?: (rect: Rect | null, final: boolean) => void;
  onDoubleClickEmpty?: (world: { x: number; y: number }) => void;
}

export function BoardViewport({
  camera,
  controller,
  children,
  overlay,
  onMarquee,
  onDoubleClickEmpty,
}: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    mode: 'none' | 'pan' | 'marquee' | 'pinch';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    originCamera: Camera;
    pinchDistance: number;
  }>({ mode: 'none', startX: 0, startY: 0, lastX: 0, lastY: 0, originCamera: camera, pinchDistance: 0 });

  // --- grid background -------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const spacing = GRID_SPACING_WORLD * camera.zoom;
    if (spacing < 4) return; // too dense to be useful at deep zoom-out
    const offsetX = ((camera.x % spacing) + spacing) % spacing;
    const offsetY = ((camera.y % spacing) + spacing) % spacing;
    ctx.fillStyle = '#c9d4e5';
    for (let x = offsetX; x < width; x += spacing) {
      for (let y = offsetY; y < height; y += spacing) {
        ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
      }
    }
  }, [camera]);

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  // --- wheel: ctrl/meta zooms at the cursor, plain wheel pans ----------
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event);
      if (event.ctrlKey || event.metaKey) {
        controller.zoomAt(point.x, point.y, Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY));
      } else {
        controller.panBy(-event.deltaX, -event.deltaY);
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [controller]);

  const activePinch = useCallback(() => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return null;
    const dx = pts[0]!.x - pts[1]!.x;
    const dy = pts[0]!.y - pts[1]!.y;
    return {
      distance: Math.hypot(dx, dy),
      midX: (pts[0]!.x + pts[1]!.x) / 2,
      midY: (pts[0]!.y + pts[1]!.y) / 2,
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('[data-object-id]')) return; // objects handle their own drag
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    if (pointers.current.size >= 2) {
      const pinch = activePinch();
      gesture.current = {
        mode: 'pinch',
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        originCamera: controller.camera,
        pinchDistance: pinch?.distance ?? 0,
      };
      return;
    }

    const panRequested = event.button === 1 || event.button === 2 || event.shiftKey;
    if (panRequested) {
      gesture.current = {
        mode: 'pan',
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        originCamera: controller.camera,
        pinchDistance: 0,
      };
    } else {
      gesture.current = {
        mode: 'marquee',
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        originCamera: controller.camera,
        pinchDistance: 0,
      };
      onMarquee?.({ x: point.x, y: point.y, width: 0, height: 0 }, false);
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const point = localPoint(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);
    const g = gesture.current;
    if (g.mode === 'none') return;

    if (g.mode === 'pinch') {
      const pinch = activePinch();
      if (!pinch || g.pinchDistance === 0) return;
      const factor = pinch.distance / g.pinchDistance;
      controller.zoomAt(pinch.midX, pinch.midY, factor);
      g.pinchDistance = pinch.distance;
      return;
    }

    if (g.mode === 'pan') {
      controller.panBy(point.x - g.lastX, point.y - g.lastY);
      g.lastX = point.x;
      g.lastY = point.y;
      return;
    }

    if (g.mode === 'marquee') {
      g.lastX = point.x;
      g.lastY = point.y;
      onMarquee?.(
        {
          x: Math.min(g.startX, point.x),
          y: Math.min(g.startY, point.y),
          width: Math.abs(point.x - g.startX),
          height: Math.abs(point.y - g.startY),
        },
        false,
      );
    }
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g.mode === 'marquee') {
      const moved = Math.hypot(g.lastX - g.startX, g.lastY - g.startY);
      onMarquee?.(
        moved > 3
          ? {
              x: Math.min(g.startX, g.lastX),
              y: Math.min(g.startY, g.lastY),
              width: Math.abs(g.lastX - g.startX),
              height: Math.abs(g.lastY - g.startY),
            }
          : null,
        true,
      );
    }
    gesture.current = { ...g, mode: 'none' };
  };

  return (
    <div
      ref={rootRef}
      className="viewport"
      data-testid="viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-object-id]')) return;
        const point = localPoint(event);
        onDoubleClickEmpty?.(screenToWorld(camera, point.x, point.y));
      }}
    >
      <canvas ref={canvasRef} className="grid-canvas" aria-hidden="true" />
      <div
        className="world"
        style={{ transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})` }}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}
