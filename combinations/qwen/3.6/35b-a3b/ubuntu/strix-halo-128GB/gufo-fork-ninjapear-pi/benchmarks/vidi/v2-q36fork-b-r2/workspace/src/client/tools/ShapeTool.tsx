import * as React from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ShapeKind } from '../../shared/objects/shape';
import { createShape } from '../../shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD, DRAG_THRESHOLD_PX } from '../../shared/config';
import type { Doc } from 'yjs';

interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Doc;
  onCreated(id: string): void;
  selection: { click(id: string): void };
}

export function ShapeTool(props: ShapeToolProps): React.JSX.Element | null {
  const { kind, camera, doc, onCreated, selection } = props;

  // Preview state during drag
  const [dragState, setDragState] = React.useState<{
    start: Point;
    end: Point;
    square: boolean;
  } | null>(null);

  // Refs for pointer capture
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.button !== 0) return;
      try {
        if (containerRef.current) containerRef.current.setPointerCapture(e.pointerId);
      } catch { /* ignore */ }

      const offset = getContainerOffset(containerRef);
      const screenStart: Point = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      };
      const worldStart = screenToWorld(camera, screenStart);

      setDragState({ start: worldStart, end: worldStart, square: e.shiftKey });
    },
    [camera],
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!dragState) return;
      const offset = getContainerOffset(containerRef);
      const screenEnd: Point = {
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      };
      const worldEnd = screenToWorld(camera, screenEnd);
      setDragState((prev) =>
        prev ? { ...prev, end: worldEnd, square: e.shiftKey } : null,
      );
    },
    [dragState, camera],
  );

  const handlePointerUp = React.useCallback(() => {
    if (!dragState) return;
    const { start, end, square } = dragState;

    // Compute world rect
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    // Check if this was a tiny drag (< threshold in pixels or < min size in world)
    const distPx = Math.sqrt(dx * dx + dy * dy) * camera.zoom;
    if (distPx < DRAG_THRESHOLD_PX) {
      // Click → standard size shape centred at start
      const id = createShape(doc, { kind, rect: null, at: start, square }, 'local');
      if (id) {
        onCreated(id);
        selection.click(id);
      }
    } else {
      // Drag → use rect, but check min size in world units
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx < SHAPE_MIN_SIZE_WORLD || absDy < SHAPE_MIN_SIZE_WORLD) {
        // Tiny drag → treat as click
        const id = createShape(doc, { kind, rect: null, at: start, square }, 'local');
        if (id) {
          onCreated(id);
          selection.click(id);
        }
      } else {
        // Normal drag
        const rect = { x: start.x, y: start.y, width: dx, height: dy };
        const id = createShape(doc, { kind, rect, at: start, square }, 'local');
        if (id) {
          onCreated(id);
          selection.click(id);
        }
      }
    }

    setDragState(null);
  }, [dragState, kind, doc, camera, onCreated, selection]);

  // Cancel creates nothing
  const handleCancel = React.useCallback(() => {
    setDragState(null);
  }, []);

  if (!dragState) return null;

  const previewRect = computePreviewRect(dragState.start, dragState.end, dragState.square);

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handleCancel}
    >
      {/* Dashed preview rectangle */}
      <svg
        style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
        aria-hidden="true"
      >
        {renderShapePreview(previewRect, kind)}
      </svg>
    </div>
  );
}

function getContainerOffset(ref: React.RefObject<HTMLDivElement | null>): Point {
  if (!ref.current) return { x: 0, y: 0 };
  const rect = ref.current.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

function computePreviewRect(
  start: Point,
  end: Point,
  square: boolean,
): { x: number; y: number; width: number; height: number } {
  let w = Math.abs(end.x - start.x);
  let h = Math.abs(end.y - start.y);
  let x = Math.min(start.x, end.x);
  let y = Math.min(start.y, end.y);

  if (square && w > 0 && h > 0) {
    const size = Math.max(w, h);
    w = size;
    h = size;
  }

  // Clamp to min
  w = Math.max(SHAPE_MIN_SIZE_WORLD, w);
  h = Math.max(SHAPE_MIN_SIZE_WORLD, h);

  return { x, y, width: w, height: h };
}

function renderShapePreview(rect: { x: number; y: number; width: number; height: number }, kind: ShapeKind): React.ReactNode {
  switch (kind) {
    case 'rect':
      return (
        <rect
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          fill="none"
          stroke="#999"
          strokeWidth={2}
          strokeDasharray="6,4"
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={rect.x + rect.width / 2}
          cy={rect.y + rect.height / 2}
          rx={rect.width / 2}
          ry={rect.height / 2}
          fill="none"
          stroke="#999"
          strokeWidth={2}
          strokeDasharray="6,4"
        />
      );
    case 'diamond': {
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      return (
        <polygon
          points={`${cx},${rect.y} ${rect.x + rect.width},${cy} ${cx},${rect.y + rect.height} ${rect.x},${cy}`}
          fill="none"
          stroke="#999"
          strokeWidth={2}
          strokeDasharray="6,4"
        />
      );
    }
    default:
      return null;
  }
}
