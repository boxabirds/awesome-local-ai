import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import { normalizeRect, type Rect, type Point } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface UseMarqueeResult {
  /** The current marquee rect in world units, or null while idle. */
  rect: Rect | null;
  /** Begin a marquee at a viewport-relative screen point (Shift+pointerdown on empty space). */
  begin(screen: Point): void;
  /** Extend the marquee to a viewport-relative screen point. */
  move(screen: Point): void;
  /** Finish: add the ids of every object entirely inside the rect (additive). */
  end(): void;
  /** Abort (pointercancel / Escape): selection unchanged. */
  cancel(): void;
}

/**
 * Shift+drag marquee selection (sel.marquee). The rect is stored in world
 * units so zoom changes during the drag are harmless. On `end`, the ids of
 * the objects lying entirely inside the rect are passed to `onSelect`
 * (partly-inside objects are never selected); an empty result leaves the
 * selection unchanged.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult {
  const [rect, setRectState] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setRect = useCallback((r: Rect | null) => {
    rectRef.current = r;
    setRectState(r);
  }, []);

  const begin = useCallback(
    (screen: Point) => {
      startRef.current = screenToWorld(cameraRef.current, screen);
      setRect(null);
    },
    [setRect],
  );

  const move = useCallback(
    (screen: Point) => {
      const start = startRef.current;
      if (!start) return;
      setRect(normalizeRect(start, screenToWorld(cameraRef.current, screen)));
    },
    [setRect],
  );

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    setRect(null);
    if (!r) return;
    const ids = objectsInRect(snapshotRef.current, r);
    if (ids.length > 0) onSelectRef.current(ids);
  }, [setRect]);

  const cancel = useCallback(() => {
    startRef.current = null;
    setRect(null);
  }, [setRect]);

  return { rect, begin, move, end, cancel };
}

/**
 * The translucent light-blue selection rectangle, rendered in the world
 * layer (world coordinates).
 */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  const r = props.rect;
  if (!r) return null;
  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: r.x,
        top: r.y,
        width: r.width,
        height: r.height,
        background: 'rgba(26, 115, 232, 0.15)',
        border: '1px solid rgba(26, 115, 232, 0.8)',
        pointerEvents: 'none',
      }}
    />
  );
}
