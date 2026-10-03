/**
 * The selection rectangle: Shift + drag across empty board space (`sel.marquee`).
 *
 * A second drag, on the board's own surface, and deliberately the mirror image of a
 * pan: a plain drag on empty space moves the board, a Shift-drag on empty space draws a
 * box and selects what fits inside it. `BoardViewport` is what decides between them,
 * because it is the only place that knows the press began on empty space rather than on
 * an object.
 *
 * Two details worth the care:
 *
 * - The box is stored in **world** units, converted from the pointer through the camera
 *   at each end. Zooming mid-drag (a wheel, a pinch on the trackpad) therefore leaves
 *   the box where it was in the board, which is where the objects are, instead of
 *   sliding it around the screen.
 * - Selection happens once, on release, from the box as it finished — so a marquee
 *   never writes to the selection on every mouse move, and the selection a person had
 *   before they started dragging survives until the box says otherwise.
 *
 * Objects are added by `objectsInRect`, which takes only objects lying *entirely*
 * inside: touching an edge is not enough (`sel.marquee`'s IF clause).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

export interface MarqueeHandle {
  /** The box in world units while one is being dragged, otherwise null. */
  readonly rect: Rect | null;
  /** A Shift-press on empty board space, in screen coordinates. */
  begin(point: Point): void;
  /** The pointer moved, in screen coordinates. */
  move(point: Point): void;
  /** Released: select what is inside, and put the box away. */
  end(): void;
  /** Escape: put the box away and change nothing. */
  cancel(): void;
  /** True while a marquee is being dragged. */
  readonly active: boolean;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  /** What to do with the ids the box caught: `useSelection.setMany(ids, true)`. */
  onSelect: (ids: readonly string[]) => void,
): MarqueeHandle {
  const [rect, setRect] = useState<Rect | null>(null);
  /** The corner the drag started from, in world units. */
  const startRef = useRef<Point | null>(null);
  /** The box as it stands, readable inside `end` without waiting for a render. */
  const rectRef = useRef<Rect | null>(null);
  /** Latest values, so a drag in progress is not stuck with the ones it started with. */
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };

  const setBox = useCallback((next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  const worldPoint = useCallback((point: Point): Point => {
    return screenToWorld(latest.current.camera, point);
  }, []);

  const begin = useCallback(
    (point: Point) => {
      const world = worldPoint(point);
      startRef.current = world;
      setBox({ x: world.x, y: world.y, width: 0, height: 0 });
    },
    [setBox, worldPoint],
  );

  const move = useCallback(
    (point: Point) => {
      const start = startRef.current;
      if (!start) return;
      setBox(normalizeRect(start, worldPoint(point)));
    },
    [setBox, worldPoint],
  );

  const end = useCallback(() => {
    const box = rectRef.current;
    startRef.current = null;
    setBox(null);
    if (!box) return;
    // Everything entirely inside joins what was already selected; the objects come
    // from what the board can draw, so a type it cannot render cannot be picked up.
    latest.current.onSelect(objectsInRect(latest.current.snapshot, box));
  }, [setBox]);

  const cancel = useCallback(() => {
    startRef.current = null;
    setBox(null);
  }, [setBox]);

  // Escape puts the box away without touching the selection (`sel.clear`'s exception:
  // a marquee in progress is what Escape is for).
  useEffect(() => {
    if (!rect) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [rect, cancel]);

  return { rect, begin, move, end, cancel, active: rect !== null };
}
