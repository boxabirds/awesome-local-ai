// src/client/board/Marquee.tsx
// Shift+drag selection rectangle.

import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect, type Rect } from '../../shared/geometry';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin: (screen: Point) => void;
  move: (screen: Point) => void;
  end: () => void;
  cancel: () => void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const startWorldRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startWorldRef.current = world;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    if (!startWorldRef.current) return;
    const world = screenToWorld(cameraRef.current, screen);
    setRect(normalizeRect(startWorldRef.current, world));
  }, []);

  const end = useCallback(() => {
    if (!startWorldRef.current) return;
    const currentRect = rect;
    startWorldRef.current = null;
    setRect(null);
    if (currentRect && (currentRect.width > 0 || currentRect.height > 0)) {
      const ids = objectsInRect(snapshot, currentRect);
      if (ids.length > 0) {
        onSelect(ids);
      }
    }
  }, [rect, snapshot, onSelect]);

  const cancel = useCallback(() => {
    startWorldRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

export function MarqueeRect(props: MarqueeRectProps): ReactElement | null {
  const { rect } = props;
  if (!rect) return null;

  // The rect is already in world space, so we render it in the world layer
  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: 'rgba(33, 150, 243, 0.15)',
        border: '1.5px solid #2196F3',
        pointerEvents: 'none',
      }}
    />
  );
}
