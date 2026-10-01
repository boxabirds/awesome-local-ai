import { useRef, useCallback, useState, type JSX } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
) {
  const [rect, setRect] = useState<Rect | null>(null);
  const startWorldRef = useRef<Point | null>(null);
  const activeRef = useRef(false);

  const begin = useCallback(
    (screen: Point) => {
      const world = screenToWorld(camera, screen);
      startWorldRef.current = world;
      activeRef.current = true;
      setRect({ x: world.x, y: world.y, width: 0, height: 0 });
    },
    [camera],
  );

  const move = useCallback(
    (screen: Point) => {
      if (!activeRef.current || !startWorldRef.current) return;
      const world = screenToWorld(camera, screen);
      setRect(normalizeRect(startWorldRef.current, world));
    },
    [camera],
  );

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    startWorldRef.current = null;

    setRect((currentRect) => {
      if (currentRect && (currentRect.width > 0 || currentRect.height > 0)) {
        const ids = objectsInRect(snapshot, currentRect);
        if (ids.length > 0) {
          onSelect(ids);
        }
      }
      return null;
    });
  }, [snapshot, onSelect]);

  const cancel = useCallback(() => {
    activeRef.current = false;
    startWorldRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  if (!props.rect) return null;
  const { rect } = props;

  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: 'rgba(33, 150, 243, 0.15)',
        border: '1px solid rgba(33, 150, 243, 0.5)',
        pointerEvents: 'none',
      }}
    />
  );
}
