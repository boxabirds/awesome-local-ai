// Marquee (Shift+drag) selection (see spec: sel.marquee).
//
// useMarquee tracks a world-space rect from a screen-space drag (converted
// through the camera). On release it reports the ids of objects lying
// entirely inside (objectsInRect) — an empty result leaves the selection
// unchanged (additive). A pointercancel cancels the marquee with no effect.

import { useCallback, useRef, useState, type JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

export interface MarqueeState {
  /** The current marquee rect in world units, or null while idle. */
  rect: Rect | null;
  /** Start a marquee drag at a screen point. */
  begin(screen: Point): void;
  /** Extend the marquee to a screen point. */
  move(screen: Point): void;
  /** Release: report the ids of fully-contained objects (additive). */
  end(): void;
  /** Cancel (pointercancel / Escape): no selection change. */
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeState {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setBoth = (next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    setBoth({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (start === null) return;
    setBoth(normalizeRect(start, screenToWorld(cameraRef.current, screen)));
  }, []);

  const end = useCallback(() => {
    const current = rectRef.current;
    if (current !== null) {
      onSelectRef.current(objectsInRect(snapshotRef.current, current));
    }
    startRef.current = null;
    setBoth(null);
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    setBoth(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** The marquee rectangle, rendered in world space by the board viewport. */
export function MarqueeRect({ rect }: { rect: Rect | null }): JSX.Element | null {
  if (rect === null) return null;
  return (
    <div
      data-testid="marquee-rect"
      className="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
