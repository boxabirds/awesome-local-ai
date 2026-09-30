/**
 * Story 10: ShapeTool — pointer overlay for drawing shapes by dragging.
 *
 * pointerdown → record start point
 * pointermove → update preview
 * pointerup → createShape, select it, return to Select tool
 */
import { useCallback, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_DEFAULT_SIZE_WORLD, SHAPE_MIN_SIZE_WORLD,
  type ShapeKind,
} from '@shared/config';
import { screenToWorld, type Camera } from '@client/canvas/camera';
import { createShape } from '@shared/objects/shape';
import type { Point } from '@shared/geometry';

interface Props {
  doc: Y.Doc;
  camera: Camera;
  kind: ShapeKind;
  createdBy: string;
  onCreated: (id: string) => void;
}

export function ShapeTool({
  doc, camera, kind, createdBy, onCreated,
}: Props) {
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const [shiftHeld, setShiftHeld] = useState(false);
  const dragStartRef = useRef<Point | null>(null);
  const draggingRef = useRef(false);

  const getPoint = useCallback((e: React.PointerEvent): Point => {
    return { x: e.clientX, y: e.clientY };
  }, []);

  const getWorldPoint = useCallback((screenPt: Point): Point => {
    return screenToWorld(camera, screenPt);
  }, [camera]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    const pt = getPoint(e);
    draggingRef.current = true;
    dragStartRef.current = pt;
    setDragStart(pt);
    setDragEnd(pt);
    setShiftHeld(e.shiftKey);
  }, [getPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    setDragEnd(getPoint(e));
    setShiftHeld(e.shiftKey);
  }, [getPoint]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const end = getPoint(e);
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;
    setDragStart(null);
    setDragEnd(null);

    const worldStart = getWorldPoint(start);
    const worldEnd = getWorldPoint(end);
    const x = Math.min(worldStart.x, worldEnd.x);
    const y = Math.min(worldStart.y, worldEnd.y);
    let w = Math.abs(worldEnd.x - worldStart.x);
    let h = Math.abs(worldEnd.y - worldStart.y);

    if (shiftHeld && w > 0 && h > 0) {
      const size = Math.max(w, h);
      w = size;
      h = size;
    }

    if (w < SHAPE_MIN_SIZE_WORLD && h < SHAPE_MIN_SIZE_WORLD) {
      w = SHAPE_DEFAULT_SIZE_WORLD;
      h = SHAPE_DEFAULT_SIZE_WORLD;
    }

    const id = createShape(doc, {
      kind,
      rect: { x, y, width: w, height: h },
      at: worldEnd,
    }, createdBy);
    if (id) {
      onCreated(id);
    }
  }, [dragStart, dragEnd, shiftHeld, getPoint, getWorldPoint, doc, kind, createdBy, onCreated]);

  const handlePointerCancel = useCallback(() => {
    draggingRef.current = false;
    dragStartRef.current = null;
    setDragStart(null);
    setDragEnd(null);
  }, []);

  // Compute preview
  let preview: { x: number; y: number; w: number; h: number } | null = null;
  if (dragStart && dragEnd) {
    const ws = getWorldPoint(dragStart);
    const we = getWorldPoint(dragEnd);
    const x = Math.min(ws.x, we.x);
    const y = Math.min(ws.y, we.y);
    let w = Math.abs(we.x - ws.x);
    let h = Math.abs(we.y - ws.y);
    if (shiftHeld && w > 0 && h > 0) {
      const size = Math.max(w, h);
      w = size;
      h = size;
    }
    preview = { x, y, w, h };
  }

  return (
    <div
      data-testid="shape-tool-overlay"
      className="absolute inset-0"
      style={{ cursor: 'crosshair', zIndex: 5 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {preview && (
        <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
          <g transform={`translate(${-camera.x},${-camera.y}) scale(${camera.zoom})`}>
            <rect
              data-testid="shape-preview"
              x={preview.x}
              y={preview.y}
              width={preview.w}
              height={preview.h}
              fill="rgba(33,150,243,0.1)"
              stroke="#2196F3"
              strokeWidth={1.5 / camera.zoom}
              strokeDasharray={`${4 / camera.zoom} ${4 / camera.zoom}`}
            />
          </g>
        </svg>
      )}
    </div>
  );
}
