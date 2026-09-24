/**
 * Story 10 · task 12 — the Shape tool overlay (design "Shape tool, shape object
 * and toolbar", PRD `shape.create_drag` / `shape.create_click` / `shape.constrain`).
 *
 * While the Shape tool is active this layer sits *above* the world layer and
 * owns every pointer gesture on the board (TC-28: a drag that starts on an
 * existing sticky never moves it, because the object never sees the event). It
 * draws the dashed screen-space preview and, on release, turns the gesture into
 * exactly one `createShape` call inside one undo step.
 *
 * Screen → world: both corners of the dragged rectangle are converted with the
 * live camera, so a zoom made *during* the drag still produces the shape the
 * preview promised. Shift squares the preview (and the result) using the longer
 * dragged edge, anchored at the drag's own top-left.
 */
import { useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  SHAPE_DEFAULT_SIZE_WORLD,
} from '../../shared/config';
import { createShape, shapeRect, type ShapeKind } from '../../shared/objects/shape';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import type { UndoController } from '../board/undo';

export interface ShapeToolProps {
  /** The kind the Shape menu currently points at. */
  kind: ShapeKind;
  /** The live camera, used for the screen ⇄ world conversion. */
  camera: Camera;
  /** The board document the new shape is written to. */
  doc: Y.Doc;
  /** This client's identity, recorded as `createdBy`. */
  by: string;
  /** The personal undo history: one drag is one step. */
  undo?: UndoController;
  /** Called with the new id (only when a shape was actually created). */
  onCreated(id: string): void;
}

/** One in-progress drag, kept in *screen* pixels so zoom cannot distort it. */
interface ShapeGesture {
  startX: number;
  startY: number;
  x: number;
  y: number;
  shift: boolean;
}

/** Pointer position relative to the overlay (0,0 in jsdom, where rects are empty). */
function local(event: ReactPointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * The dragged rectangle in screen pixels, Shift-squared if needed. The square
 * keeps the drag's own top-left, so the preview and the stored shape agree.
 */
export function dragRectScreen(g: ShapeGesture): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let dx = g.x - g.startX;
  let dy = g.y - g.startY;
  if (g.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  return {
    x: Math.min(g.startX, g.startX + dx),
    y: Math.min(g.startY, g.startY + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

/**
 * The world rectangle a gesture produces — the *stored* one, including the
 * Shift square and the minimum-size clamp, by running the model's own
 * `shapeRect` on the converted drag. The preview draws exactly this, so there
 * is only ever one answer to "what will this gesture create".
 */
export function dragWorldRect(camera: Camera, g: ShapeGesture): Rect {
  const screen = dragRectScreen(g);
  const topLeft = screenToWorld(camera, { x: screen.x, y: screen.y });
  const bottomRight = screenToWorld(camera, {
    x: screen.x + screen.width,
    y: screen.y + screen.height,
  });
  const dragged: Rect = {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.abs(bottomRight.x - topLeft.x),
    height: Math.abs(bottomRight.y - topLeft.y),
  };
  const travelled = Math.hypot(g.x - g.startX, g.y - g.startY);
  const at = screenToWorld(camera, { x: g.x, y: g.y });
  if (travelled < DRAG_THRESHOLD_PX) {
    // A click (or a drag too small to be a size): the default shape, centred on
    // the release point.
    const half = SHAPE_DEFAULT_SIZE_WORLD / 2;
    return { x: at.x - half, y: at.y - half, width: SHAPE_DEFAULT_SIZE_WORLD, height: SHAPE_DEFAULT_SIZE_WORLD };
  }
  return shapeRect(dragged, at, g.shift);
}

export function ShapeTool(props: ShapeToolProps): JSX.Element {
  const { doc, by, camera, kind, onCreated } = props;
  const [gesture, setGesture] = useState<ShapeGesture | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // The tool owns the pointer: nothing under the overlay can be picked up.
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and engines without pointer capture just skip it.
    }
    const p = local(event);
    setGesture({ startX: p.x, startY: p.y, x: p.x, y: p.y, shift: event.shiftKey });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture === null) return;
    event.stopPropagation();
    const p = local(event);
    setGesture({ ...gesture, x: p.x, y: p.y, shift: event.shiftKey });
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture;
    setGesture(null);
    if (g === null || cancelled) return; // a cancelled gesture creates nothing
    event.stopPropagation();

    const travelled = Math.hypot(g.x - g.startX, g.y - g.startY);
    const at = screenToWorld(camera, { x: g.x, y: g.y });

    let rect: Rect | null = null;
    if (travelled >= DRAG_THRESHOLD_PX) {
      const screen = dragRectScreen(g);
      const topLeft = screenToWorld(camera, { x: screen.x, y: screen.y });
      const bottomRight = screenToWorld(camera, {
        x: screen.x + screen.width,
        y: screen.y + screen.height,
      });
      rect = {
        x: topLeft.x,
        y: topLeft.y,
        width: Math.abs(bottomRight.x - topLeft.x),
        height: Math.abs(bottomRight.y - topLeft.y),
      };
    }

    const create = () => createShape(doc, { kind, rect, at, square: g.shift }, by);
    const id = props.undo ? props.undo.step(create) : create();
    if (id !== null) onCreated(id);
  };

  // The dashed preview is the *result* of the gesture, projected back to screen,
  // so a Shift drag previews a square and a tiny drag previews the default box.
  const preview = gesture === null ? null : projectRect(camera, dragWorldRect(camera, gesture));

  return (
    <div
      className="tool-overlay"
      data-testid="shape-tool"
      data-tool="shape"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'auto',
        touchAction: 'none',
        cursor: 'crosshair',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={() => setGesture(null)}
    >
      {preview ? (
        <div
          data-testid="shape-preview"
          data-phase="sizing"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${preview.x}px`,
            top: `${preview.y}px`,
            width: `${preview.width}px`,
            height: `${preview.height}px`,
            border: '1px dashed #2f6fed',
            background: 'rgb(47 111 237 / 12%)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}

/** A world rectangle as it sits on screen right now. */
function projectRect(camera: Camera, rect: Rect) {
  const a = worldToScreen(camera, { x: rect.x, y: rect.y });
  const b = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}
