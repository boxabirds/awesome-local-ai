// Story 10: the Shape tool (anchor: shapes.create, shapes.size).
//
// While active (rendered by App in the screen-space board overlay):
//  - a press+drag draws a live preview rect; the released rect becomes the
//    new shape (createShape with the drawn rect);
//  - a plain click (no travel) creates the default-sized shape centred on
//    the click (shapes.size: click = default size);
//  - holding Shift while drawing forces a square of the larger dimension,
//    anchored at the drag origin (shapes.size, squareRect);
//  - a press on top of an object still creates a shape there (the world
//    layer ignores the pointer while a drawing tool is active — the click
//    lands on the board surface, like the Text tool in story 9).
//
// The component only reports the gesture; App runs the model call (with the
// undo boundaries) and selects/auto-returns via toolCreated.

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ShapeKind } from '../../shared/config';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

interface DragState {
  start: Point;
  cur: Point;
  square: boolean;
}

export function ShapeTool(props: {
  camera: Camera;
  kind: ShapeKind;
  /** Report a finished gesture: drawn rect (null = click) and its origin. */
  onCreateShape(rect: Rect | null, at: Point, square: boolean): void;
}): JSX.Element | null {
  const [drag, setDrag] = useState<DragState | null>(null);
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const callbackRef = useRef(props.onCreateShape);
  callbackRef.current = props.onCreateShape;

  useEffect(() => {
    const toWorld = (clientX: number, clientY: number): Point | null => {
      const root = document.querySelector('[data-testid="board-viewport"]');
      if (root === null) return null;
      const rect = root.getBoundingClientRect();
      // jsdom reports a zero-sized rect: skip the bounds check there.
      const inside =
        rect.width === 0 && rect.height === 0
          ? true
          : clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (!inside) return null;
      return screenToWorld(cameraRef.current, { x: clientX - rect.left, y: clientY - rect.top });
    };

    let active: DragState | null = null;
    let pointerId: number | null = null;

    const onDown = (e: PointerEvent): void => {
      if (pointerId !== null) return; // a gesture is already in flight
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Only presses that land on the board surface start a draw.
      const root = document.querySelector('[data-testid="board-viewport"]');
      if (root === null || !root.contains(e.target as Node)) return;
      const start = toWorld(e.clientX, e.clientY);
      if (start === null) return;
      pointerId = e.pointerId;
      active = { start, cur: start, square: e.shiftKey };
      setDrag(active);
    };
    const onMove = (e: PointerEvent): void => {
      if (pointerId !== e.pointerId || active === null) return;
      const cur = toWorld(e.clientX, e.clientY);
      if (cur === null) return;
      active = { ...active, cur, square: e.shiftKey };
      setDrag(active);
    };
    const finish = (e: PointerEvent): void => {
      if (pointerId !== e.pointerId || active === null) return;
      pointerId = null;
      const done = active;
      active = null;
      setDrag(null);
      const travelled = Math.hypot(done.cur.x - done.start.x, done.cur.y - done.start.y);
      if (travelled === 0) {
        callbackRef.current(null, done.start, false);
        return;
      }
      const rect: Rect = {
        x: Math.min(done.start.x, done.cur.x),
        y: Math.min(done.start.y, done.cur.y),
        width: Math.abs(done.cur.x - done.start.x),
        height: Math.abs(done.cur.y - done.start.y),
      };
      callbackRef.current(rect, done.start, done.square);
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  if (drag === null) return null;

  // Preview rect in world units (square-constrained when Shift is held).
  let worldRect: Rect;
  if (drag.square) {
    const side = Math.max(Math.abs(drag.cur.x - drag.start.x), Math.abs(drag.cur.y - drag.start.y));
    const x = drag.cur.x >= drag.start.x ? drag.start.x : drag.start.x - side;
    const y = drag.cur.y >= drag.start.y ? drag.start.y : drag.start.y - side;
    worldRect = { x, y, width: side, height: side };
  } else {
    worldRect = {
      x: Math.min(drag.start.x, drag.cur.x),
      y: Math.min(drag.start.y, drag.cur.y),
      width: Math.abs(drag.cur.x - drag.start.x),
      height: Math.abs(drag.cur.y - drag.start.y),
    };
  }
  const a = worldToScreen(props.camera, { x: worldRect.x, y: worldRect.y });
  const b = worldToScreen(props.camera, { x: worldRect.x + worldRect.width, y: worldRect.y + worldRect.height });

  return (
    <div
      className="shape-tool-preview"
      data-testid="shape-preview"
      style={{
        left: Math.min(a.x, b.x),
        top: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x),
        height: Math.abs(b.y - a.y),
        borderColor: 'var(--accent, #1E88E5)',
      }}
    />
  );
}

/** The default size, exported for preview parity with the model. */
export const SHAPE_TOOL_DEFAULT_SIZE = SHAPE_DEFAULT_SIZE_WORLD;
