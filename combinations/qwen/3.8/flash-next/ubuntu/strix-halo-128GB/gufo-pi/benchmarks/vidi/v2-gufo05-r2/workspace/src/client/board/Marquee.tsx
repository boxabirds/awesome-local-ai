import { useCallback, useRef, useState } from 'react';

import { normalizeRect, type Point, type Rect } from '../../shared/geometry';

export interface Marquee {
  /** The rectangle so far, in board units; null while no marquee is running. */
  readonly rect: Rect | null;
  /** Begin at a board point (shift held, on empty board space). */
  start(point: Point, additive: boolean): void;
  move(point: Point): void;
  /**
   * Finish, and hand the rectangle to `onSelect`. A marquee that never started,
   * or a rectangle of no size over nothing, selects nothing — the caller's
   * additive set makes that a no-op rather than a surprise.
   */
  end(): void;
  /** Drop the rectangle without selecting anything (an interrupted drag). */
  cancel(): void;
}

/**
 * The shift + drag rectangle.
 *
 * It is drawn inside the world layer in board units, so the rectangle, the objects
 * it contains and the objects' own boxes are in the same coordinate system at
 * every zoom level, and the rule that decides what is inside (`objectsInRect`, in
 * the board model) is applied to the same numbers this draws.
 */
export function useMarquee(onSelect: (rect: Rect, additive: boolean) => void): Marquee {
  const select = useRef(onSelect);
  select.current = onSelect;
  const running = useRef<{ from: Point; additive: boolean; rect: Rect } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const start = useCallback((point: Point, additive: boolean) => {
    const empty = { x: point.x, y: point.y, width: 0, height: 0 };
    running.current = { from: point, additive, rect: empty };
    setRect(empty);
  }, []);

  const move = useCallback((point: Point) => {
    const drag = running.current;
    if (!drag) return;
    drag.rect = normalizeRect(drag.from, point);
    setRect(drag.rect);
  }, []);

  const end = useCallback(() => {
    const drag = running.current;
    if (!drag) return;
    running.current = null;
    setRect(null);
    select.current(drag.rect, drag.additive);
  }, []);

  const cancel = useCallback(() => {
    if (!running.current) return;
    running.current = null;
    setRect(null);
  }, []);

  return { rect, start, move, end, cancel };
}

/** The marquee itself: a translucent rectangle with a border, on the board. */
export function MarqueeRect({ rect }: { rect: Rect | null }) {
  if (!rect) return null;
  return (
    <div
      className="marquee"
      data-testid="marquee"
      aria-hidden="true"
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    />
  );
}
