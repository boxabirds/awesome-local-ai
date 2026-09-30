import { useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { createShape, shapeRect, type ShapeKind } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { localAuthor } from '../objects/TextObject';

interface Sizing {
  pointerId: number;
  /** Viewport-local screen point where the drag started. */
  start: Point;
  current: Point;
  shift: boolean;
}

/**
 * Shape tool layer (story 10, shape.ui). Covers the board and owns every
 * press, so drags that start over objects never move them. A drag draws a
 * dashed preview (Shift makes it square) and creates the shape on release; a
 * click or tiny drag drops a standard-size shape centred on the press.
 */
export function ShapeTool(props: { kind: ShapeKind; camera: Camera; doc: Y.Doc; onCreated(id: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sizing, setSizing] = useState<Sizing | null>(null);
  const sizingRef = useRef<Sizing | null>(null);
  const undo = useUndoController();

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const update = (next: Sizing | null) => {
    sizingRef.current = next;
    setSizing(next);
  };

  /** The world rect the gesture describes, as createShape will make it. */
  const worldRect = (s: Sizing): { rect: Rect; at: Point } => {
    const a = screenToWorld(props.camera, s.start);
    const b = screenToWorld(props.camera, s.current);
    return { rect: normalizeRect(a, b), at: a };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || sizingRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Unavailable for synthetic events; events still reach the layer.
    }
    const p = local(e);
    update({ pointerId: e.pointerId, start: p, current: p, shift: e.shiftKey });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = sizingRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    update({ ...s, current: local(e), shift: e.shiftKey });
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = sizingRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const done = { ...s, current: local(e), shift: e.shiftKey };
    update(null);
    const { rect, at } = worldRect(done);
    undo.boundary();
    const id = createShape(props.doc, { kind: props.kind, rect, at, square: done.shift }, localAuthor(props.doc));
    undo.boundary();
    // Rejected by the model: nothing created, the tool stays active.
    if (id) props.onCreated(id);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    if (sizingRef.current?.pointerId === e.pointerId) update(null);
  };

  let preview: Rect | null = null;
  if (sizing) {
    const { rect, at } = worldRect(sizing);
    const moved = sizing.start.x !== sizing.current.x || sizing.start.y !== sizing.current.y;
    if (moved) {
      // Exactly what release would create (a square with Shift, the standard size when tiny).
      const r = shapeRect(rect, at, sizing.shift);
      const tl = worldToScreen(props.camera, r);
      preview = { x: tl.x, y: tl.y, width: r.width * props.camera.zoom, height: r.height * props.camera.zoom };
    }
  }

  return (
    <div
      ref={ref}
      className="tool-layer shape-tool"
      data-testid="shape-tool"
      data-state={sizing ? 'sizing' : 'ready'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview && (
        <div
          className={`shape-preview shape-preview-${props.kind}`}
          data-testid="shape-preview"
          style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
        />
      )}
    </div>
  );
}
