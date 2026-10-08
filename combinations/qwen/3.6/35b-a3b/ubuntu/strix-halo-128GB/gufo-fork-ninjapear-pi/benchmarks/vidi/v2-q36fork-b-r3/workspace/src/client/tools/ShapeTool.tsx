import React, { useState, useCallback, useRef } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect } from '@shared/geometry';
import type { ShapeKind } from '@shared/objects/shape';
import { createShape } from '@shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD } from '@shared/config';

interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  /** Called when a shape is created with its id. */
  onCreated(id: string): void;
}

/**
 * The Shape tool: drag to draw, click for default size.
 * Captures the pointer so drags over existing objects don't move them.
 */
export function ShapeTool(props: ShapeToolProps) {
  const { kind, camera, doc, onCreated } = props;
  const [preview, setPreview] = useState<Rect | null>(null);
  const dragging = useRef(false);
  const startWorld = useRef<Point>({ x: 0, y: 0 });

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const wp = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    startWorld.current = wp;
    dragging.current = true;
    setPreview(null);
  }, [camera]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const cur = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const a = startWorld.current;
    const b = cur;
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const rx = Math.min(a.x, b.x);
    const ry = Math.min(a.y, b.y);

    let r: Rect = { x: rx, y: ry, width: w, height: h };

    if (e.nativeEvent.shiftKey) {
      // Constrain to square using larger dimension
      const side = Math.max(w, h);
      r = { x: rx, y: ry, width: side, height: side };
    }

    setPreview(r);
  }, [camera]);

  const handlePointerUp = useCallback(() => {
    if (!dragging.current || !preview) {
      dragging.current = false;
      setPreview(null);
      return;
    }

    dragging.current = false;

    // Tiny drag (< min size) → treat as click with default size
    const minSize = SHAPE_MIN_SIZE_WORLD;
    const rectToUse =
      preview.width >= minSize && preview.height >= minSize ? preview : null;

    const centerPoint = {
      x: startWorld.current.x + (rectToUse ? preview.width / 2 : 0),
      y: startWorld.current.y + (rectToUse ? preview.height / 2 : 0),
    };

    const at = rectToUse ? centerPoint : startWorld.current;
    const square = !!preview && preview.width > 0 && preview.width === preview.height;

    const id = createShape(doc, { kind, rect: rectToUse, at, square }, 'user');

    if (id) {
      onCreated(id);
    }

    setPreview(null);
  }, [doc, kind, preview, onCreated]);

  const handleLostPointerCapture = useCallback(() => {
    dragging.current = false;
    setPreview(null);
  }, []);

  return (
    <div
      style={{ position: 'absolute', inset: 0 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
    />
  );
}
