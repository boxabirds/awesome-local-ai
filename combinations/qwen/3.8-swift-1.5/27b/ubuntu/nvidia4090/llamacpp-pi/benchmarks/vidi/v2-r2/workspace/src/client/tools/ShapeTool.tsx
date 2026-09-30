/**
 * Shape tool (story 10, shape.ui).
 *
 * Handles drag-to-create and click-to-create shapes. Captures the pointer so
 * drags starting over existing objects don't move them.
 */
import { useRef, useState, useCallback } from 'react';
import type { ShapeKind } from '../../shared/config';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { createShape } from '../../shared/objects/shape';
import type * as Y from 'yjs';

interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  createdBy: string;
  onCreated(id: string): void;
  onBoundary(): void;
}

export function ShapeTool({ kind, camera, doc, createdBy, onCreated, onBoundary }: ShapeToolProps) {
  const [preview, setPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const dragStartRef = useRef<Point | null>(null);
  const shiftRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragStartRef.current = screen;
    shiftRef.current = e.shiftKey;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch { /* jsdom */ }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    shiftRef.current = e.shiftKey;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const startWorld = screenToWorld(camera, dragStartRef.current);
    const endWorld = screenToWorld(camera, screen);

    let w = Math.abs(endWorld.x - startWorld.x);
    let h = Math.abs(endWorld.y - startWorld.y);

    if (shiftRef.current) {
      const size = Math.max(w, h);
      w = size;
      h = size;
    }

    const x = Math.min(startWorld.x, endWorld.x);
    const y = Math.min(startWorld.y, endWorld.y);
    setPreview({ x, y, width: w, height: h });
  }, [camera]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const startScreen = dragStartRef.current;
    dragStartRef.current = null;
    setPreview(null);

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const endScreen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    const startWorld = screenToWorld(camera, startScreen);
    const endWorld = screenToWorld(camera, endScreen);

    const w = Math.abs(endWorld.x - startWorld.x);
    const h = Math.abs(endWorld.y - startWorld.y);

    let shapeRect: { x: number; y: number; width: number; height: number } | null;
    let at: Point;

    if (w < SHAPE_MIN_SIZE_WORLD || h < SHAPE_MIN_SIZE_WORLD) {
      // Click: create default size centred at the point
      shapeRect = null;
      at = startWorld;
    } else {
      let rw = w;
      let rh = h;
      if (shiftRef.current) {
        const size = Math.max(rw, rh);
        rw = size;
        rh = size;
      }
      shapeRect = {
        x: Math.min(startWorld.x, endWorld.x),
        y: Math.min(startWorld.y, endWorld.y),
        width: rw,
        height: rh,
      };
      at = startWorld;
    }

    const id = createShape(doc, { kind, rect: shapeRect, at, square: shiftRef.current }, createdBy);
    if (id) {
      onBoundary();
      onCreated(id);
    }
  }, [camera, doc, kind, createdBy, onCreated, onBoundary]);

  const handlePointerCancel = useCallback(() => {
    dragStartRef.current = null;
    setPreview(null);
  }, []);

  // Render a screen-space overlay for the preview
  const previewScreen = preview
    ? {
        x: (preview.x - camera.x) * camera.zoom,
        y: (preview.y - camera.y) * camera.zoom,
        width: preview.width * camera.zoom,
        height: preview.height * camera.zoom,
      }
    : null;

  return (
    <div
      data-testid="shape-tool"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 5,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {previewScreen && (
        <div
          data-testid="shape-preview"
          style={{
            position: 'absolute',
            left: previewScreen.x,
            top: previewScreen.y,
            width: previewScreen.width,
            height: previewScreen.height,
            border: '2px dashed #3b82f6',
            borderRadius: kind === 'ellipse' ? '50%' : 0,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
