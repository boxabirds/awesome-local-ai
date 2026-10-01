// src/client/tools/ShapeTool.tsx
// Shape tool: drag to create a shape, click to drop a standard shape.
// Captures the pointer so drags starting over existing objects never move them.

import { useState, useCallback, useRef } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect } from '../../shared/geometry';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { ShapeKind } from '../../shared/config';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  onCreated: (id: string) => void;
  /** Creates a shape in world space. Returns the new id or null. */
  create: (rect: { x: number; y: number; width: number; height: number } | null, at: Point, square: boolean) => string | null;
}

export function ShapeTool(props: ShapeToolProps): ReactElement | null {
  const { camera, onCreated, create } = props;
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const shiftRef = useRef(false);

  const getScreenPoint = (e: ReactPointerEvent): Point => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    const sp = getScreenPoint(e);
    dragStartRef.current = sp;
    shiftRef.current = e.shiftKey;
    setPreview({ x: sp.x, y: sp.y, w: 0, h: 0 });
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!dragStartRef.current) return;
    const sp = getScreenPoint(e);
    shiftRef.current = e.shiftKey;

    const start = dragStartRef.current;
    let w = Math.abs(sp.x - start.x);
    let h = Math.abs(sp.y - start.y);
    if (e.shiftKey) {
      const size = Math.max(w, h);
      w = size;
      h = size;
    }
    setPreview({
      x: Math.min(sp.x, start.x),
      y: Math.min(sp.y, start.y),
      w,
      h,
    });
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!dragStartRef.current) return;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}

    const startScreen = dragStartRef.current;
    const endScreen = getScreenPoint(e);
    dragStartRef.current = null;
    setPreview(null);

    // Convert to world space
    const worldStart = screenToWorld(camera, startScreen);
    const worldEnd = screenToWorld(camera, endScreen);

    // Determine if this is a click (tiny drag) or a real drag
    const worldRect = normalizeRect(worldStart, worldEnd);
    const isClick = worldRect.width < SHAPE_MIN_SIZE_WORLD || worldRect.height < SHAPE_MIN_SIZE_WORLD;

    let id: string | null;
    if (isClick) {
      id = create(null, worldStart, false);
    } else {
      id = create(worldRect, worldStart, shiftRef.current);
    }

    if (id) {
      onCreated(id);
    }
  }, [camera, create, onCreated]);

  const onPointerCancel = useCallback(() => {
    dragStartRef.current = null;
    setPreview(null);
  }, []);

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        cursor: 'crosshair',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {preview && (
        <div
          data-testid="shape-preview"
          style={{
            position: 'absolute',
            left: preview.x,
            top: preview.y,
            width: preview.w,
            height: preview.h,
            border: '2px dashed #1E88E5',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
