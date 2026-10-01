import { useRef, useState, useCallback, type ReactElement } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { createShape } from '../../shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { ShapeKind } from '../../shared/config';
import type * as Y from 'yjs';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  createdBy: string;
  onCreated: (id: string) => void;
}

/**
 * The Shape tool (story 10, shape.ui): drag to create a shape, or click to
 * drop a standard-size shape. Shows a dashed preview during the drag.
 *
 * The tool captures the pointer so drags starting over existing objects
 * never move them (TC-28).
 */
export function ShapeTool({ kind, camera, doc, createdBy, onCreated }: ShapeToolProps): ReactElement | null {
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const isDraggingRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.nativeEvent.button !== 0) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragStartRef.current = screenPoint;
    isDraggingRef.current = false;
    setPreview(null);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const start = dragStartRef.current;

    const dx = screenPoint.x - start.x;
    const dy = screenPoint.y - start.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      isDraggingRef.current = true;
    }

    // Convert to world space for the preview
    const worldStart = screenToWorld(camera, start);
    const worldEnd = screenToWorld(camera, screenPoint);

    let w = Math.abs(worldEnd.x - worldStart.x);
    let h = Math.abs(worldEnd.y - worldStart.y);

    // Shift constraint: square
    if (e.shiftKey) {
      const size = Math.max(w, h);
      w = size;
      h = size;
    }

    const px = Math.min(worldStart.x, worldEnd.x);
    const py = Math.min(worldStart.y, worldEnd.y);

    // Preview in screen space
    const screenStart = worldToScreenLocal(camera, { x: px, y: py });
    setPreview({
      x: screenStart.x,
      y: screenStart.y,
      w: w * camera.zoom,
      h: h * camera.zoom,
    });
  }, [camera]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const start = dragStartRef.current;
    dragStartRef.current = null;

    const worldStart = screenToWorld(camera, start);
    const worldEnd = screenToWorld(camera, screenPoint);

    let w = Math.abs(worldEnd.x - worldStart.x);
    let h = Math.abs(worldEnd.y - worldStart.y);

    // Shift constraint
    if (e.shiftKey) {
      const size = Math.max(w, h);
      w = size;
      h = size;
    }

    const wasDrag = isDraggingRef.current;
    isDraggingRef.current = false;
    setPreview(null);

    if (!wasDrag || w < SHAPE_MIN_SIZE_WORLD || h < SHAPE_MIN_SIZE_WORLD) {
      // Click or tiny drag: create standard size at the point
      const id = createShape(doc, { kind, rect: null, at: worldStart }, createdBy);
      if (id) onCreated(id);
    } else {
      // Drag: create shape covering the dragged area
      const dragRect = {
        x: Math.min(worldStart.x, worldEnd.x),
        y: Math.min(worldStart.y, worldEnd.y),
        width: w,
        height: h,
      };
      const id = createShape(doc, { kind, rect: dragRect, at: worldStart, square: e.shiftKey }, createdBy);
      if (id) onCreated(id);
    }
  }, [camera, kind, doc, createdBy, onCreated]);

  const handlePointerCancel = useCallback(() => {
    dragStartRef.current = null;
    isDraggingRef.current = false;
    setPreview(null);
  }, []);

  // Render in screen space (fixed position overlay)
  return (
    <div
      data-testid="shape-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 15,
        cursor: 'crosshair',
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
            border: '2px dashed #1565C0',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

// Local helper to avoid circular import
function worldToScreenLocal(camera: Camera, p: Point): Point {
  return {
    x: (p.x - camera.x) * camera.zoom,
    y: (p.y - camera.y) * camera.zoom,
  };
}
