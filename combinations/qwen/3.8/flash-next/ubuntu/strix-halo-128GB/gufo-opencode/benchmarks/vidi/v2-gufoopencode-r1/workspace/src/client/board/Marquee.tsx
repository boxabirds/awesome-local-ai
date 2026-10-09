import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface MarqueeApi {
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

// Shift+drag rectangle in world units (so a zoom change mid-drag is harmless).
// On end, the ids fully inside the rect go to onSelect (which the viewport
// wires to setMany(ids, additive=true)); cancel leaves the selection alone.
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const originRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  const snapshotRef = useRef(snapshot);
  const onSelectRef = useRef(onSelect);
  cameraRef.current = camera;
  snapshotRef.current = snapshot;
  onSelectRef.current = onSelect;

  const update = useCallback((next: Rect | null): void => {
    rectRef.current = next;
    setRect(next);
  }, []);

  const begin = useCallback(
    (screen: Point): void => {
      const world = screenToWorld(cameraRef.current, screen);
      originRef.current = world;
      update({ x: world.x, y: world.y, width: 0, height: 0 });
    },
    [update]
  );

  const move = useCallback(
    (screen: Point): void => {
      const origin = originRef.current;
      if (origin === null) return;
      update(normalizeRect(origin, screenToWorld(cameraRef.current, screen)));
    },
    [update]
  );

  const end = useCallback((): void => {
    const origin = originRef.current;
    originRef.current = null;
    const finalRect = rectRef.current;
    update(null);
    if (origin === null || finalRect === null) return;
    if (finalRect.width <= 0 || finalRect.height <= 0) return;
    onSelectRef.current(objectsInRect(snapshotRef.current, finalRect));
  }, [update]);

  const cancel = useCallback((): void => {
    originRef.current = null;
    update(null);
  }, [update]);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

// Translucent marquee drawn inside the world layer (world-unit positioning;
// the layer's transform handles zoom).
export function MarqueeRect(props: MarqueeRectProps): JSX.Element | null {
  if (props.rect === null) return null;
  return (
    <div
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: props.rect.x,
        top: props.rect.y,
        width: props.rect.width,
        height: props.rect.height,
        background: 'rgba(37, 99, 235, 0.12)',
        border: `1px solid rgba(37, 99, 235, 0.8)`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 1_000_000
      }}
    />
  );
}
