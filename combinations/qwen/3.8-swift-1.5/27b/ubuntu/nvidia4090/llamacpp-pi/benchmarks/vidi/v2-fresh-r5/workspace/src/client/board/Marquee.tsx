import { useCallback, useRef, useState, type JSX } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

/**
 * Hook that manages the Shift+drag marquee selection rectangle.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
) {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startWorldRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  const snapshotRef = useRef(snapshot);
  const onSelectRef = useRef(onSelect);
  cameraRef.current = camera;
  snapshotRef.current = snapshot;
  onSelectRef.current = onSelect;

  const updateRect = useCallback((r: Rect | null) => {
    rectRef.current = r;
    setRect(r);
  }, []);

  const begin = useCallback(
    (screen: Point) => {
      const world = screenToWorld(cameraRef.current, screen);
      startWorldRef.current = world;
      updateRect({ x: world.x, y: world.y, width: 0, height: 0 });
    },
    [updateRect],
  );

  const move = useCallback(
    (screen: Point) => {
      const start = startWorldRef.current;
      if (!start) return;
      const world = screenToWorld(cameraRef.current, screen);
      updateRect(normalizeRect(start, world));
    },
    [updateRect],
  );

  const end = useCallback(() => {
    const r = rectRef.current;
    startWorldRef.current = null;
    updateRect(null);
    if (r && r.width > 0 && r.height > 0) {
      const ids = objectsInRect(snapshotRef.current, r);
      if (ids.length > 0) {
        onSelectRef.current(ids);
      }
    }
  }, [updateRect]);

  const cancel = useCallback(() => {
    startWorldRef.current = null;
    updateRect(null);
  }, [updateRect]);

  return { rect, begin, move, end, cancel };
}

/**
 * Renders the translucent marquee rectangle in the world layer.
 */
export function MarqueeRect(props: { rect: Rect | null }): JSX.Element | null {
  const { rect } = props;
  if (!rect) return null;

  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: '1px solid #1a73e8',
        backgroundColor: 'rgba(26, 115, 232, 0.1)',
        pointerEvents: 'none',
      }}
    />
  );
}
