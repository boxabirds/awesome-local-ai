/**
 * ShapeTool (story 10): drag/click creation with preview overlay.
 */
import React, { useRef, useCallback, useState } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect } from '../../shared/geometry';
import type { Rect } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX, SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { ShapeKind } from '../../shared/config';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  /** Called to actually create the shape in the model. Return id or null. */
  createShape(rect: Rect | null, at: { x: number; y: number }, square: boolean): string | null;
}

export function ShapeTool({ kind, camera, onCreated, createShape }: ShapeToolProps) {
  const [preview, setPreview] = useState<Rect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const squareRef = useRef(false);
  const draggingRef = useRef(false);

  const getPoint = useCallback((e: { clientX: number; clientY: number }) => {
    return { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      startRef.current = getPoint(e);
      squareRef.current = e.shiftKey;
      draggingRef.current = true;
      setPreview(null);
    },
    [getPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !startRef.current) return;
      squareRef.current = e.shiftKey;
      const start = startRef.current;
      const current = getPoint(e);
      const startWorld = screenToWorld(camera, start);
      const currentWorld = screenToWorld(camera, current);
      let r = normalizeRect(startWorld, currentWorld);

      // Apply square constraint in world space
      if (squareRef.current && (r.width >= SHAPE_MIN_SIZE_WORLD || r.height >= SHAPE_MIN_SIZE_WORLD)) {
        const side = Math.max(r.width, r.height);
        // Anchor at the start point (top-left of original drag direction)
        const x = currentWorld.x >= startWorld.x ? startWorld.x : startWorld.x - side;
        const y = currentWorld.y >= startWorld.y ? startWorld.y : startWorld.y - side;
        r = { x, y, width: side, height: side };
      }

      setPreview(r);
    },
    [camera, getPoint],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current || !startRef.current) return;
      draggingRef.current = false;

      const start = startRef.current;
      const end = getPoint(e);
      const startWorld = screenToWorld(camera, start);
      const endWorld = screenToWorld(camera, end);

      // Determine if this is a click (below drag threshold in screen pixels)
      const screenDist = Math.hypot(end.x - start.x, end.y - start.y);

      let rect: Rect | null = null;
      if (screenDist >= DRAG_THRESHOLD_PX) {
        let r = normalizeRect(startWorld, endWorld);
        if (squareRef.current) {
          const side = Math.max(r.width, r.height);
          const x = endWorld.x >= startWorld.x ? startWorld.x : startWorld.x - side;
          const y = endWorld.y >= startWorld.y ? startWorld.y : startWorld.y - side;
          r = { x, y, width: side, height: side };
        }
        // Below minimum → treated as click (rect = null)
        if (r.width < SHAPE_MIN_SIZE_WORLD || r.height < SHAPE_MIN_SIZE_WORLD) {
          rect = null;
        } else {
          rect = r;
        }
      }

      setPreview(null);
      const id = createShape(rect, startWorld, squareRef.current);
      if (id) onCreated(id);
      startRef.current = null;
    },
    [camera, getPoint, createShape, onCreated],
  );

  const handlePointerCancel = useCallback(() => {
    draggingRef.current = false;
    startRef.current = null;
    setPreview(null);
  }, []);

  // Render preview rectangle in world coordinates (screen-space overlay)
  const renderPreview = () => {
    if (!preview) return null;
    const tl = { x: preview.x, y: preview.y };
    const br = { x: preview.x + preview.width, y: preview.y + preview.height };
    const tlScreen = { x: (tl.x - camera.x) * camera.zoom, y: (tl.y - camera.y) * camera.zoom };
    const brScreen = { x: (br.x - camera.x) * camera.zoom, y: (br.y - camera.y) * camera.zoom };

    return (
      <div
        data-testid="shape-preview"
        style={{
          position: 'absolute',
          left: tlScreen.x,
          top: tlScreen.y,
          width: brScreen.x - tlScreen.x,
          height: brScreen.y - tlScreen.y,
          border: '2px dashed #1976D2',
          backgroundColor: 'rgba(25, 118, 210, 0.05)',
          pointerEvents: 'none',
        }}
      />
    );
  };

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {renderPreview()}
    </div>
  );
}
