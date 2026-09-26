import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { MARQUEE_BORDER_COLOR, MARQUEE_COLOR } from '../../shared/config';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

/** Pointer hooks the viewport drives for a shift+drag selection marquee. */
export interface MarqueeController {
  begin(screenPoint: Point): void;
  move(screenPoint: Point): void;
  end(): void;
  cancel(): void;
}

/**
 * A shift+drag selection rectangle. The rect is stored in *world* units so it
 * stays glued to the board while zooming/panning; it is only converted to the
 * selection through `objectsInRect` (fully-inside rule) when the drag ends.
 *
 * `screenPoint` is viewport-relative (the same coordinate space the camera's
 * `screenToWorld` uses for pan/wheel anchors).
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: readonly string[]) => void,
): { rect: Rect | null; controller: MarqueeController } {
  const cameraRef = useRef(camera);
  const snapshotRef = useRef(snapshot);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    cameraRef.current = camera;
    snapshotRef.current = snapshot;
    onSelectRef.current = onSelect;
  });

  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const update = useCallback((next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  const begin = useCallback(
    (screenPoint: Point) => {
      const world = screenToWorld(cameraRef.current, screenPoint);
      startRef.current = world;
      update({ x: world.x, y: world.y, width: 0, height: 0 });
    },
    [update],
  );

  const move = useCallback(
    (screenPoint: Point) => {
      const start = startRef.current;
      if (start === null) return;
      const world = screenToWorld(cameraRef.current, screenPoint);
      update(normalizeRect(start, world));
    },
    [update],
  );

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    update(null);
    if (r === null) return;
    // A degenerate marquee (a shift-click on empty space) clears the selection.
    if (r.width === 0 && r.height === 0) {
      onSelectRef.current([]);
      return;
    }
    onSelectRef.current(objectsInRect(snapshotRef.current, r));
  }, [update]);

  const cancel = useCallback(() => {
    startRef.current = null;
    update(null);
  }, [update]);

  return { rect, controller: { begin, move, end, cancel } };
}

/** The translucent selection rectangle, drawn in the world layer. */
export function MarqueeRect({ rect }: { rect: Rect | null }): JSX.Element | null {
  if (rect === null) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        backgroundColor: MARQUEE_COLOR,
        border: `1px solid ${MARQUEE_BORDER_COLOR}`,
        pointerEvents: 'none',
      }}
    />
  );
}
