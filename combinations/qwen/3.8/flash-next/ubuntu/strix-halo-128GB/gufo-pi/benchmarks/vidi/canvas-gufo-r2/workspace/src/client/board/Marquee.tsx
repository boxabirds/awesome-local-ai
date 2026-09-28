/**
 * Shift+drag marquee selection (story 7, sel.marquee_ui).
 *
 * The rectangle is stored in *world* units so a zoom change during the drag is
 * harmless. On release, `objectsInRect` picks the objects lying entirely inside
 * and hands their ids to `onSelect`. Cancel (pointer cancel / Escape) leaves the
 * selection unchanged.
 */
import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

export interface MarqueeController {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeController {
  const [rect, setRect] = useState<Rect | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const startRef = useRef<Point | null>(null);

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    const world = screenToWorld(cameraRef.current, screen);
    setRect(normalizeRect(start, world));
  }, []);

  const end = useCallback(() => {
    const r = rect;
    startRef.current = null;
    setRect(null);
    if (!r || r.width === 0 || r.height === 0) return;
    const ids = objectsInRect(snapshotRef.current, r);
    if (ids.length > 0) onSelectRef.current(ids);
  }, [rect]);

  const cancel = useCallback(() => {
    startRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** The translucent selection rectangle, rendered in the world layer. */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  const { rect } = props;
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        // Keep the border a constant screen thickness regardless of zoom.
        borderWidth: `${1 / Math.max(props.camera.zoom, 0.001)}px`,
      }}
    />
  );
}
