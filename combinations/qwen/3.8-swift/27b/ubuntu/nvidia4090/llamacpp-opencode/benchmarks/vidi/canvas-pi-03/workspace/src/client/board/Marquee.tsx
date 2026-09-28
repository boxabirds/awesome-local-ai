/**
 * Story 7: the marquee selection rectangle (sel.marquee).
 *
 * Shift + drag on empty board space draws a selection rectangle (world
 * units). On release it selects EVERY object whose bounds intersect the
 * rectangle, unioned with the current selection (Shift-additive,
 * sel.marquee). A marquee with an empty result changes nothing
 * (sel.marquee_empty). Escape cancels the marquee in progress (BoardViewport
 * stops that keydown so the selection itself is not cleared).
 *
 * `useMarquee` returns the live rect (for rendering) plus begin/move/end/
 * cancel, driven by the viewport's pointer handlers.
 */
import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect, type Rect } from 'src/shared/geometry';
import { objectsInRect, type ObjectSnapshot } from 'src/shared/board-model';

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): {
  rect: Rect | null;
  begin: (screen: Point) => void;
  move: (screen: Point) => void;
  end: () => void;
  cancel: () => void;
} {
  const camRef = useRef(camera);
  camRef.current = camera;
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const begin = useCallback((screen: Point) => {
    startRef.current = screenToWorld(camRef.current, screen);
    rectRef.current = null;
    setRect(null);
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    const r = normalizeRect(start, screenToWorld(camRef.current, screen));
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
    if (!r) return; // released without drawing: nothing selected, nothing cleared
    onSelectRef.current(objectsInRect(snapRef.current, r));
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** The semi-transparent marquee rectangle, rendered in the world layer. */
export function MarqueeRect(props: { rect: Rect | null }): JSX.Element | null {
  const { rect } = props;
  if (!rect) return null;
  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: 'rgba(26, 115, 232, 0.15)',
        border: '1.5px solid #1A73E8',
        pointerEvents: 'none',
      }}
    />
  );
}
