import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';

import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect, type Rect } from '../../shared/geometry';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface UseMarqueeResult {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

/**
 * Manages the Shift+drag marquee selection rectangle.
 * Rect is stored in world units so zoom changes during drag are harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
  objectsInRect: (snapshot: readonly ObjectSnapshot[], rect: Rect) => string[],
): UseMarqueeResult {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const activeRef = useRef(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const objectsInRectRef = useRef(objectsInRect);
  objectsInRectRef.current = objectsInRect;

  const begin = useCallback((screen: Point) => {
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    startRef.current = world;
    activeRef.current = true;
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    if (!activeRef.current || startRef.current === null) return;
    const cam = cameraRef.current;
    const world = screenToWorld(cam, screen);
    const r = normalizeRect(startRef.current, world);
    setRect(r);
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current || rect === null) {
      activeRef.current = false;
      setRect(null);
      return;
    }
    activeRef.current = false;
    const ids = objectsInRectRef.current(snapshotRef.current, rect);
    setRect(null);
    if (ids.length > 0) {
      onSelectRef.current(ids);
    }
  }, [rect]);

  const cancel = useCallback(() => {
    activeRef.current = false;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/**
 * Draws the translucent marquee rectangle in the world layer.
 */
export function MarqueeRect({ rect }: { rect: Rect | null }): JSX.Element | null {
  if (!rect || rect.width === 0 || rect.height === 0) return null;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: 'rgba(25, 118, 210, 0.1)',
        border: '1px solid rgba(25, 118, 210, 0.4)',
        pointerEvents: 'none',
        zIndex: 10001,
      }}
    />
  );
}
