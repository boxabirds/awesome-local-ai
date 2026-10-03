// Marquee (shift+drag) selection (story 7).
//
// `useMarquee` tracks the drag rectangle in world space; `MarqueeRect`
// renders it inside the world layer. On release, the ids of all objects
// fully contained in the rect are returned to the caller (additive).

import { useCallback, useRef, useState } from 'react';
import { screenToWorld, type Camera } from '../canvas/camera';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';

export interface MarqueeApi {
  /** Current marquee rect in world space (null while not dragging). */
  rect: Rect | null;
  /** Begin a marquee at a screen point. */
  begin: (screen: { x: number; y: number }) => void;
  /** Extend the marquee to a screen point. */
  move: (screen: { x: number; y: number }) => void;
  /** Release: resolve the contained ids and clear the rect. */
  end: () => void;
  /** Cancel (Escape): clear the rect without selecting. */
  cancel: () => void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: { x: number; y: number }) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    const r = normalizeRect(world, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: { x: number; y: number }) => {
    if (startRef.current === null) return;
    const world = screenToWorld(cameraRef.current, screen);
    const r = normalizeRect(startRef.current, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    if (r) {
      onSelectRef.current(objectsInRect(snapshotRef.current, r));
    }
    rectRef.current = null;
    startRef.current = null;
    setRect(null);
  }, []);

  const cancel = useCallback(() => {
    rectRef.current = null;
    startRef.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** The marquee rectangle, rendered in the world layer. */
export function MarqueeRect({ rect }: { rect: Rect | null }) {
  if (rect === null) return null;
  return (
    <div
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        backgroundColor: 'rgba(25, 118, 210, 0.1)',
        border: '1px solid #1976D2',
        pointerEvents: 'none',
      }}
    />
  );
}
