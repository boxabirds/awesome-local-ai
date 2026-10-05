import { useCallback, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';

export interface MarqueeApi {
  /** The rectangle being dragged, in world units, or `null` when idle. */
  readonly rect: Rect | null;
  /** Start dragging from a screen point (viewport-relative). */
  begin(screen: Point): void;
  /** Drag to a screen point. */
  move(screen: Point): void;
  /** Release: the objects entirely inside the rectangle are selected. */
  end(): void;
  /** Escape or pointercancel: throw the rectangle away, selection untouched. */
  cancel(): void;
}

/**
 * Box selection: press Shift on empty board space and drag a rectangle.
 *
 * The rectangle is kept in *world* units, so zooming with the wheel mid-drag
 * (trackpad users do) does not distort it. On release the model decides what is
 * inside — an object counts only when all four of its edges are — and the ids
 * are added to whatever was already selected. Nothing inside means nothing
 * changes: a stray Shift+drag must not silently empty someone's selection.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  // Same value in a ref, so `end` can read it without being recreated per frame.
  const rectRef = useRef<Rect | null>(null);
  rectRef.current = rect;

  // The viewport calls these from its own pointer handlers, which are recreated
  // per render; the ref keeps the newest camera, board and callback.
  const live = useRef({ camera, snapshot, onSelect });
  live.current = { camera, snapshot, onSelect };
  const originRef = useRef<Point | null>(null);

  const begin = useCallback((screen: Point) => {
    originRef.current = screenToWorld(live.current.camera, screen);
    setRect(normalizeRect(originRef.current, originRef.current));
  }, []);

  const move = useCallback((screen: Point) => {
    const origin = originRef.current;
    if (!origin) return;
    setRect(normalizeRect(origin, screenToWorld(live.current.camera, screen)));
  }, []);

  const end = useCallback(() => {
    const box = rectRef.current;
    originRef.current = null;
    rectRef.current = null;
    setRect(null);
    if (!box || (box.width === 0 && box.height === 0)) return;
    const ids = objectsInRect(live.current.snapshot, box);
    // An empty marquee is passed on as an empty list: the owner's additive
    // setMany leaves the selection exactly as it was.
    live.current.onSelect(ids);
  }, []);

  const cancel = useCallback(() => {
    originRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  /** The rectangle in world units. */
  rect: Rect | null;
  camera: Camera;
}

/**
 * The translucent rectangle of a marquee in progress, in screen space. Renders
 * nothing when there is no marquee, and never intercepts the pointer.
 */
export function MarqueeRect(props: MarqueeRectProps) {
  const { rect, camera } = props;
  if (!rect) return null;
  const origin = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      className="marquee-rect"
      data-marquee=""
      aria-hidden="true"
      style={{
        left: `${origin.x}px`,
        top: `${origin.y}px`,
        width: `${rect.width * camera.zoom}px`,
        height: `${rect.height * camera.zoom}px`,
      }}
    />
  );
}
