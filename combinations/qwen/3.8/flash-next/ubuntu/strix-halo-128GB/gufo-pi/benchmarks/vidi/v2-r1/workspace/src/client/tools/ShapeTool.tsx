/**
 * ShapeTool: drag to create shapes (rect, ellipse, diamond) with a preview.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { ShapeKind } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import type { Point } from '../../shared/board-model';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  /** Creates the shape at the given rect (drag) or default-size at a point (click). */
  createShapeAt(rect: Rect | null, at: Point, square: boolean): string | null;
  /** Undo boundary callback. */
  undoBoundary(): void;
}

export function ShapeTool(props: ShapeToolProps): JSX.Element | null {
  const { camera, onCreated, createShapeAt, undoBoundary } = props;
  const [preview, setPreview] = useState<Rect | null>(null);
  const dragging = useRef(false);
  const startPoint = useRef<Point | null>(null);
  const pointerId = useRef<number | null>(null);

  // Use refs for mutable callbacks to avoid stale closures in event listeners
  const createShapeAtRef = useRef(createShapeAt);
  createShapeAtRef.current = createShapeAt;
  const undoBoundaryRef = useRef(undoBoundary);
  undoBoundaryRef.current = undoBoundary;
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (pointerId.current !== null) return;
    // Don't capture clicks on toolbar, controls, or other UI
    const target = event.target as HTMLElement;
    if (target.closest('[data-board-surface]') === null) return;
    pointerId.current = event.pointerId;
    dragging.current = true;
    try { target.setPointerCapture(event.pointerId); } catch { /* noop */ }
    const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
    startPoint.current = world;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId || !dragging.current || !startPoint.current) return;
    const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
    let x = Math.min(startPoint.current.x, world.x);
    let y = Math.min(startPoint.current.y, world.y);
    let w = Math.abs(world.x - startPoint.current.x);
    let h = Math.abs(world.y - startPoint.current.y);

    // Shift = square constraint
    if (event.shiftKey) {
      const size = Math.max(w, h);
      w = size;
      h = size;
      if (world.x < startPoint.current.x) x = startPoint.current.x - size;
      if (world.y < startPoint.current.y) y = startPoint.current.y - size;
    }

    setPreview({ x, y, width: w, height: h });
  }, []);

  const handlePointerUp = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    const start = startPoint.current;
    dragging.current = false;
    startPoint.current = null;
    setPreview(null);

    if (!start) return;
    const world = screenToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
    let w = Math.abs(world.x - start.x);
    let h = Math.abs(world.y - start.y);

    let rect: Rect | null = null;
    if (w < 5 && h < 5) {
      // Click - create default-size shape at the click point
      rect = null;
    } else {
      let x = Math.min(start.x, world.x);
      let y = Math.min(start.y, world.y);
      if (event.shiftKey) {
        const size = Math.max(w, h);
        w = size;
        h = size;
        if (world.x < start.x) x = start.x - size;
        if (world.y < start.y) y = start.y - size;
      }
      rect = { x, y, width: w, height: h };
    }

    undoBoundaryRef.current();
    const id = createShapeAtRef.current(rect, start, event.shiftKey);
    undoBoundaryRef.current();
    if (id !== null) {
      onCreatedRef.current(id);
    }
  }, []);

  const handlePointerCancel = useCallback((event: PointerEvent) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    dragging.current = false;
    startPoint.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    document.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
      document.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel]);

  // Render preview overlay
  if (!preview) return null;

  const tl = worldToScreen(camera, { x: preview.x, y: preview.y });
  const w = preview.width * camera.zoom;
  const h = preview.height * camera.zoom;

  return (
    <svg
      data-testid="shape-preview-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      <rect
        x={tl.x}
        y={tl.y}
        width={w}
        height={h}
        fill="rgba(30, 136, 229, 0.1)"
        stroke="#1E88E5"
        strokeWidth={1.5}
        strokeDasharray="6 3"
      />
    </svg>
  );
}
