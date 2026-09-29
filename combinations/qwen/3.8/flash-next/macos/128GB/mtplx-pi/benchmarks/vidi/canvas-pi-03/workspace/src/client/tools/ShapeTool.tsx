// The Shape tool (story 10, contract `shape.ui`).
//
// It is a full-board input layer, not an object: while it is armed every press
// inside the board belongs to the tool, which is what makes TC-28 true — a
// press that happens to start on a shape draws a new one instead of dragging
// the old one. The layer sits above the world (screen space), so the preview is
// drawn where the pointer is and only the released rectangle is converted to
// world units.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { createShape } from '../../shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD, type ShapeKind } from '../../shared/config';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface ShapeToolProps {
  /** The board to draw into. */
  doc: Y.Doc;
  /** Which shape this arm of the tool draws (Rectangle, Ellipse, Diamond). */
  kind: ShapeKind;
  /** The live camera, so a press converts to world units at any zoom. */
  camera: Camera;
  /** Whose hand is drawing: stored as the shape's `createdBy`. */
  by?: string;
  /** A shape was created: select it and disarm the tool. */
  onCreated(id: string): void;
  /** A gesture ended, created or not: close the undo capture window. */
  onGestureEnd?(): void;
}

/** A screen-space rectangle. */
type Box = { x: number; y: number; width: number; height: number };

/** The local gesture: the press point, the current point and the Shift state
 * read on the LAST event (Shift may change mid-drag, so it is never captured
 * once at press). */
interface Drag {
  x0: number;
  y0: number;
  x: number;
  y: number;
  shift: boolean;
}

/** The rectangle a drag describes in screen px, Squared when Shift is held:
 * both sides take the longer one, anchored at the press point (the corner the
 * pointer started from), which is the same anchor the model squares around. */
function previewBox(drag: Drag): Box {
  const rawW = Math.abs(drag.x - drag.x0);
  const rawH = Math.abs(drag.y - drag.y0);
  const side = Math.max(rawW, rawH);
  // Squaring grows the box from its CORNER, which is exactly how `shape.ts`
  // squares a released rect: preview and result cannot disagree.
  const w = drag.shift ? side : rawW;
  const h = drag.shift ? side : rawH;
  return {
    x: Math.min(drag.x0, drag.x),
    y: Math.min(drag.y0, drag.y),
    width: w,
    height: h,
  };
}

export function ShapeTool({ doc, kind, camera, by = 'local', onCreated, onGestureEnd }: ShapeToolProps) {
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Box | null>(null);

  /** Press coordinates in the layer's own space. A full-board layer starts at
   * the viewport's origin, so this is the same conversion the viewport does. */
  const local = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // The tool owns the press: nothing under it moves, and the board neither
    // pans nor marquees under it.
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = local(e);
    drag.current = { x0: p.x, y0: p.y, x: p.x, y: p.y, shift: e.shiftKey };
    setPreview({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    e.stopPropagation();
    const p = local(e);
    drag.current = { ...drag.current, x: p.x, y: p.y, shift: e.shiftKey };
    setPreview(previewBox(drag.current));
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = drag.current;
    drag.current = null;
    setPreview(null);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (gesture === null) return;
    e.stopPropagation();
    // A cancelled gesture creates nothing (contract: Sizing → Ready).
    if (cancelled) return;

    const p = local(e);
    const start = screenToWorld(camera, { x: gesture.x0, y: gesture.y0 });
    const end = screenToWorld(camera, { x: p.x, y: p.y });

    // A press that never reached the minimum size in EITHER direction counts as
    // a click: a default-sized shape centred on the point it started at.
    const drawn = {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    };
    const tooSmall = drawn.width < SHAPE_MIN_SIZE_WORLD || drawn.height < SHAPE_MIN_SIZE_WORLD;
    // The model owns the sizing rules (clamping, squaring, the click default);
    // the tool only says whether the drag was big enough to be a shape.
    const id = createShape(doc, { kind, rect: tooSmall ? null : drawn, at: start, square: gesture.shift }, by);
    if (id !== null) onCreated(id);
    onGestureEnd?.();
  };

  return (
    <div
      data-testid="shape-tool-layer"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'auto', cursor: 'crosshair', zIndex: 4 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
    >
      {preview !== null && preview.width > 1 && preview.height > 1 && (
        <div
          data-testid="shape-preview"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
            border: '1.5px dashed #2563eb',
            background: 'rgba(37,99,235,0.08)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
