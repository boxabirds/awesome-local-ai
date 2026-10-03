/**
 * The Shape tool's pointer (`shape.tool`): drag a box, or click for a standard one.
 *
 * While the tool is armed this transparent sheet sits over the board and takes every press.
 * That is deliberate: a press must size a new shape rather than selecting, moving or
 * panning whatever is under it (`tools.one_action`) — the same reason the Text tool claims
 * the next press, but a shape is *dragged* into being, so it needs the press, the move and
 * the release rather than a single click.
 *
 * - A **drag** draws the box from corner to corner; on release it is created (`shape.create`).
 * - A **click** — a press that never moved past `DRAG_THRESHOLD_PX` — makes the standard
 *   square centred on the point (`shape.click`), which the model does too; the tool only
 *   decides "is this a click or a drag" and says so by handing up `rect: null`.
 * - **Shift** squares the drag to its larger side (`shape.square`).
 *
 * Everything is converted through the camera on the way up, so the tool hands the model a
 * rectangle in world units and knows nothing about creating, selecting or undo — that is
 * `App`'s job.
 */
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { DRAG_THRESHOLD_PX } from '../../shared/config';
import type { Rect } from '../../shared/geometry';
import type { ShapeKind } from '../../shared/config';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

export interface ShapeToolProps {
  camera: Camera;
  /** The kind the next shape will be (from `useActiveTool`). */
  shapeKind: ShapeKind;
  /**
   * A shape was drawn. `rect` is the box in world units, or `null` for a click; `at` is the
   * press point in world units; `square` is whether Shift was held.
   */
  onCreate(args: { rect: Rect | null; at: Point; square: boolean }): void;
}

export function ShapeTool({ camera, onCreate }: ShapeToolProps) {
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const shiftRef = useRef(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Best effort: the drag still works from events on the sheet itself.
    }
    shiftRef.current = event.shiftKey;
    const point = { x: event.clientX, y: event.clientY };
    setDrag({ from: point, to: point });
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setDrag((current) => (current ? { ...current, to: { x: event.clientX, y: event.clientY } } : current));
    },
    [],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignored.
      }
      const to = { x: event.clientX, y: event.clientY };
      const movedPx = Math.hypot(to.x - drag.from.x, to.y - drag.from.y);
      const fromWorld = screenToWorld(camera, drag.from);
      const square = event.shiftKey || shiftRef.current;
      if (movedPx < DRAG_THRESHOLD_PX) {
        // A click: no rectangle, just the point (`shape.click`).
        onCreate({ rect: null, at: fromWorld, square });
      } else {
        const toWorld = screenToWorld(camera, to);
        onCreate({
          rect: {
            x: Math.min(fromWorld.x, toWorld.x),
            y: Math.min(fromWorld.y, toWorld.y),
            width: Math.abs(toWorld.x - fromWorld.x),
            height: Math.abs(toWorld.y - fromWorld.y),
          },
          at: fromWorld,
          square,
        });
      }
      setDrag(null);
    },
    [camera, drag, onCreate],
  );

  // A ghost of the box being dragged, on screen, so the shape has an outline before it exists.
  const ghost = (() => {
    if (!drag) return null;
    const left = Math.min(drag.from.x, drag.to.x);
    const top = Math.min(drag.from.y, drag.to.y);
    return { left, top, width: Math.abs(drag.to.x - drag.from.x), height: Math.abs(drag.to.y - drag.from.y) };
  })();

  return (
    <div
      className="tool-overlay tool-overlay--shape"
      data-testid="shape-tool"
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        pointerEvents: 'all',
        touchAction: 'none',
        zIndex: 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={() => setDrag(null)}
    >
      {ghost ? (
        <div
          data-testid="shape-ghost"
          style={{
            position: 'fixed',
            left: ghost.left,
            top: ghost.top,
            width: ghost.width,
            height: ghost.height,
            border: '2px solid #2563eb',
            background: 'rgb(37 99 235 / 0.08)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
