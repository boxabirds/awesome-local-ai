import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';

import {
  objectsInRect,
  type ObjectSnapshot,
  type Point,
  type Rect,
} from '../../shared/board-model.js';
import { normalizeRect } from '../../shared/geometry.js';
import { screenToWorld, type Camera } from '../canvas/camera.js';

/**
 * The Shift+drag marquee (`src/client/canvas/Marquee.tsx`).
 *
 * Holding Shift and dragging on empty board space draws a dashed rectangle; on
 * release the objects whose bounds lie **fully inside** it are added to the
 * selection. Everything about the box is world-space so it is identical for two
 * people whose cameras differ (the rule is the same on both screens), and so the
 * containment test happens in world units too. The controller is created in the
 * board surface and handed down to the viewport (which starts the drag) and the
 * world layer (which draws the box) - so the two halves of the interaction cannot
 * drift out of sync.
 */

/** The marquee's state and the four things the viewport can do to it. */
export interface MarqueeController {
  /** The rectangle in world units, or null when there is no marquee in flight. */
  rect: Rect | null;
  /** Start a marquee from a screen point (Shift held, on empty space). */
  begin(screen: Point): void;
  /** Update the rectangle as the pointer moves. */
  move(screen: Point): void;
  /** Finish: select what is fully inside, then clear the box. */
  end(): void;
  /** Abandon (Escape / pointercancel): clear the box, leave the selection alone. */
  cancel(): void;
}

/**
 * The marquee's state machine. `onSelect` is called on release with the ids fully
 * inside the box; the board surface wires that to `selection.setMany(ids, true)`
 * so a marquee adds to what was already selected (`sel.marquee`).
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeController {
  const [rect, setRect] = useState<Rect | null>(null);

  // Mirrors, so the pointer handlers (which outlive a render) see current values.
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const show = useCallback((next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  const begin = useCallback(
    (screen: Point) => {
      const start = screenToWorld(cameraRef.current, screen);
      startRef.current = start;
      show({ x: start.x, y: start.y, width: 0, height: 0 });
    },
    [show],
  );

  const move = useCallback(
    (screen: Point) => {
      const start = startRef.current;
      if (!start) return;
      show(normalizeRect(start, screenToWorld(cameraRef.current, screen)));
    },
    [show],
  );

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    show(null);
    // No rectangle to select with: a click (no drag) selects nothing and, by
    // design, never turns into a marquee that clears the selection.
    if (!r || (r.width <= 0 && r.height <= 0)) return;
    onSelectRef.current(objectsInRect(snapshotRef.current, r));
  }, [show]);

  const cancel = useCallback(() => {
    startRef.current = null;
    show(null);
  }, [show]);

  return { rect, begin, move, end, cancel };
}

/**
 * The dashed selection box, drawn in the world layer. It is positioned and sized
 * in world units so the existing world-layer transform places it for free; only
 * the border is counter-scaled so it stays a hairline at any zoom.
 */
export function MarqueeRect({ rect, camera }: { rect: Rect; camera: Camera }): JSX.Element {
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      data-width={rect.width}
      data-height={rect.height}
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderWidth: `${1 / camera.zoom}px`,
      }}
    />
  );
}
