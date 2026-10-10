import { useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import type { ShapeKind } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { createShape } from '../../shared/objects/shape';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  userId: string;
  // The shape was created (id given): undo boundary handling and
  // select + return-to-Select live in the caller (toolCreated).
  onCreated(id: string): void;
}

interface DragState {
  start: Point;
  current: Point;
  shift: boolean;
}

// Screen-space rect of the drag preview, Shift-squared when held: the side
// is the larger dimension, extended in each axis by the drag direction.
function previewRect(drag: DragState): Rect {
  const dx = drag.current.x - drag.start.x;
  const dy = drag.current.y - drag.start.y;
  if (drag.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    const x2 = drag.start.x + sx * side;
    const y2 = drag.start.y + sy * side;
    return {
      x: Math.min(drag.start.x, x2),
      y: Math.min(drag.start.y, y2),
      width: Math.abs(x2 - drag.start.x),
      height: Math.abs(y2 - drag.start.y)
    };
  }
  return {
    x: Math.min(drag.start.x, drag.current.x),
    y: Math.min(drag.start.y, drag.current.y),
    width: Math.abs(dx),
    height: Math.abs(dy)
  };
}

// Shape creation gesture: a full-board overlay captures every pointer event
// (objects cannot be selected or moved while a drawing tool is active),
// shows a dashed preview while dragging, and creates the shape on release.
// A press without a meaningful drag creates a standard-size shape centred
// on the click; the model handles both cases (and Shift squaring).
export function ShapeTool({ kind, camera, doc, userId, onCreated }: ShapeToolProps): JSX.Element {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const update = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const finish = (e: React.PointerEvent<HTMLDivElement>, create: boolean) => {
    const current = dragRef.current;
    update(null);
    if (current === null || !create) return;
    const worldStart = screenToWorld(camera, current.start);
    const worldEnd = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const rect: Rect = {
      x: Math.min(worldStart.x, worldEnd.x),
      y: Math.min(worldStart.y, worldEnd.y),
      width: Math.abs(worldEnd.x - worldStart.x),
      height: Math.abs(worldEnd.y - worldStart.y)
    };
    const id = createShape(
      doc,
      { kind, rect: rect.width === 0 && rect.height === 0 ? null : rect, at: worldStart, square: e.shiftKey },
      userId
    );
    if (id !== null) onCreated(id);
  };

  return (
    <div
      data-testid="shape-tool-overlay"
      className="tool-overlay"
      style={{ cursor: 'crosshair' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // jsdom and older engines lack pointer capture.
        }
        const start = { x: e.clientX, y: e.clientY };
        update({ start, current: start, shift: e.shiftKey });
      }}
      onPointerMove={(e) => {
        const current = dragRef.current;
        if (current === null) return;
        e.stopPropagation();
        update({
          start: current.start,
          current: { x: e.clientX, y: e.clientY },
          shift: e.shiftKey
        });
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        finish(e, true);
      }}
      onPointerCancel={() => {
        update(null);
      }}
    >
      {drag !== null && (drag.current.x !== drag.start.x || drag.current.y !== drag.start.y) && (
        <div
          data-testid="shape-preview"
          className="shape-preview"
          style={previewRect(drag)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
