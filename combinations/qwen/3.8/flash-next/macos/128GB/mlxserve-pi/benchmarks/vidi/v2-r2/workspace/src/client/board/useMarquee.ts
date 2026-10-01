// The marquee (story 7): Shift+drag over empty board space draws a rectangle
// and selects the objects that lie entirely inside it.
//
// Why the rectangle collects on `end` rather than on every move: the rule is
// "entirely inside", and a rectangle growing under the pointer is a preview,
// not a selection - firing the selection once, on release, is what keeps the
// marquee from strobing the selection bar through every intermediate state,
// and matches how the object clicks behave (they decide once, deliberately).
// The preview rectangle is still live state - the only thing that re-renders
// during the drag.
//
// The selection a marquee makes is ADDITIVE: shift is the one key that both
// drew this rectangle and stands for "add to the selection", so a marquee
// unions with what was already selected instead of wiping it. A marquee that
// caught nothing but was a real drag selects nothing and, like Figma, clears
// the old selection - the one replace it performs.

import { useCallback, useRef, useState } from 'react';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

/** The four calls the viewport makes, in viewport coordinates. */
export interface MarqueeHandlers {
  start(point: Point): void;
  move(point: Point): void;
  end(point: Point): void;
  cancel(): void;
}

export interface MarqueeOptions {
  objects: readonly ObjectSnapshot[];
  camera: Camera;
  /** A locked board draws no marquee: without selection it would select nothing. */
  editable: boolean;
  /** Hand the caught ids over; additive unions with the current selection. */
  onSelectMany(ids: readonly string[], additive: boolean): void;
  /** The drag never travelled: it was a shift-click on empty board space. */
  onEmptyClick(): void;
}

export interface Marquee {
  /** The live rectangle, in world units, while a marquee drag is in flight. */
  rect: Rect | null;
  handlers: MarqueeHandlers;
}

export function useMarquee(options: MarqueeOptions): Marquee {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [rect, setRect] = useState<Rect | null>(null);
  const pressRef = useRef<{ from: Point; moved: boolean } | null>(null);

  const worldOf = useCallback((point: Point): Point => {
    return screenToWorld(optionsRef.current.camera, point);
  }, []);

  const start = useCallback((point: Point): void => {
    const { editable } = optionsRef.current;
    if (!editable) return;
    pressRef.current = { from: worldOf(point), moved: false };
    // the rectangle appears only once the pointer has travelled: a
    // shift-press that is really a shift-click must not flash a box
  }, [worldOf]);

  const move = useCallback(
    (point: Point): void => {
      const press = pressRef.current;
      if (press === null) return;
      const to = worldOf(point);
      const next = normalizeRect(press.from, to);
      if (!press.moved) {
        // the threshold is a screen-pixel rule, so convert it through zoom
        const { zoom } = optionsRef.current.camera;
        const threshold = DRAG_THRESHOLD_PX / (zoom === 0 ? 1 : zoom);
        if (next.width < threshold && next.height < threshold) return;
        press.moved = true;
      }
      setRect(next);
    },
    [worldOf],
  );

  const finish = useCallback(
    (point: Point | null, cancelled: boolean): void => {
      const press = pressRef.current;
      if (press === null) return;
      pressRef.current = null;
      setRect(null);
      if (cancelled || point === null) return;
      const { objects, onSelectMany, onEmptyClick } = optionsRef.current;
      if (!press.moved) {
        // no travel at all: the empty-board rules own this press - it is a
        // shift-click on nothing, which clears the selection like a click
        onEmptyClick();
        return;
      }
      const to = worldOf(point);
      const box = normalizeRect(press.from, to);
      const ids = objectsInRect(objects, box);
      if (ids.length === 0) {
        // a real drag that caught nothing: a replace by an empty set is the
        // quiet way of saying "the selection is gone now"
        onSelectMany([], false);
        return;
      }
      onSelectMany(ids, true);
    },
    [worldOf],
  );

  const end = useCallback((point: Point): void => finish(point, false), [finish]);
  const cancel = useCallback((): void => finish(null, true), [finish]);

  return { rect, handlers: { start, move, end, cancel } };
}
