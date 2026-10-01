/**
 * Marquee selection: Shift+drag on empty board space draws a translucent rectangle
 * and selects objects fully inside it on release.
 */
import { useCallback, useRef, useState } from 'react';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { worldToScreen, screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

export interface UseMarqueeResult {
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
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: Point) => {
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    startRef.current = world;
    const r = { x: world.x, y: world.y, width: 0, height: 0 };
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    const r = normalizeRect(start, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
    if (r && r.width > 0 && r.height > 0) {
      const ids = objectsInRect(snapshotRef.current, r);
      onSelectRef.current(ids);
    }
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/**
 * MarqueeRect: renders the translucent selection rectangle in screen space.
 */
export function MarqueeRect({
  rect,
  camera,
}: {
  rect: Rect | null;
  camera: Camera;
}): React.JSX.Element | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y });
  const bottomRight = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });

  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
        background: 'rgba(37, 99, 235, 0.1)',
        border: '1px solid rgba(37, 99, 235, 0.5)',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
