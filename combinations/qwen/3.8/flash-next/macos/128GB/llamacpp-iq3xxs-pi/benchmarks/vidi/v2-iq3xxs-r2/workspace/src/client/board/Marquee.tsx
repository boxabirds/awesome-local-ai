import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';

/** The presses the viewport reports, in screen pixels. */
export interface Marquee {
  /** The rectangle being drawn, in world units, or null when not drawing one. */
  readonly rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Release: the objects fully inside the rectangle are selected. */
  end(): void;
  /** Escape or `pointercancel`: the rectangle disappears and the selection is untouched. */
  cancel(): void;
}

/**
 * Drawing a rectangle with Shift+drag to select what is inside it.
 *
 * The rectangle is kept in world units, so panning or zooming the board halfway through a
 * drag (a trackpad does both) cannot make it pick different objects than the ones the
 * pointer is now over. The selection is decided once, at the release: an empty result
 * leaves the selection exactly as it was, rather than clearing it — a marquee that missed
 * is not a way of deselecting, that is what Escape is for.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);
  // `end` runs from a pointer handler and must see the last drawn rectangle whatever React
  // has or has not rendered yet, so the rectangle lives here too.
  const drawn = useRef<Rect | null>(null);
  const active = useRef(false);
  // Both corners in world units, so the drawing and the hit test agree without a camera.
  const from = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const begin = useCallback((screen: Point): void => {
    active.current = true;
    const world = screenToWorld(cameraRef.current, screen);
    from.current = world;
    const start = { x: world.x, y: world.y, width: 0, height: 0 };
    drawn.current = start;
    setRect(start);
  }, []);

  const move = useCallback((screen: Point): void => {
    if (!active.current) return;
    const world = screenToWorld(cameraRef.current, screen);
    const current = from.current;
    if (!current) return;
    const next = normalizeRect(current, world);
    drawn.current = next;
    setRect(next);
  }, []);

  const end = useCallback((): void => {
    if (!active.current) return;
    active.current = false;
    const current = from.current;
    const box = drawn.current;
    from.current = null;
    drawn.current = null;
    setRect(null);
    if (!current || !box) return;
    // Fully inside only (TC-07, TC-32): an object that merely touches the edge from
    // outside is not selected, and neither is one that is half in.
    const ids = objectsInRect(snapshotRef.current, box);
    if (ids.length === 0) return;
    selectRef.current(ids);
  }, []);

  const cancel = useCallback((): void => {
    active.current = false;
    from.current = null;
    drawn.current = null;
    setRect(null);
  }, []);

  // Escape during a marquee throws the rectangle away and keeps the selection (TC-22).
  useEffect(() => {
    if (rect === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cancel, rect]);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  readonly rect: Rect | null;
  readonly camera: Camera;
}

/**
 * The translucent rectangle itself, drawn in screen space: it is a drawing about the
 * screen the user is dragging across, not a thing on the board, and it never takes the
 * pointer's attention (`pointer-events: none`), so the drag keeps running through it.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps): JSX.Element | null {
  if (rect === null) return null;
  const from = worldToScreen(camera, { x: rect.x, y: rect.y });
  const width = rect.width * camera.zoom;
  const height = rect.height * camera.zoom;
  return (
    <div
      className="vidi6-marquee"
      data-testid="marquee"
      data-marquee-width={rect.width}
      data-marquee-height={rect.height}
      style={{
        left: `${from.x}px`,
        top: `${from.y}px`,
        width: `${Math.max(width, 0)}px`,
        height: `${Math.max(height, 0)}px`,
      }}
    />
  );
}
