/**
 * Marquee selection (story 7, sel.marquee).
 *
 * `useMarquee` tracks a Shift+drag rectangle in WORLD units (so zoom changes
 * mid-drag are harmless) and, on `end`, hands the fully-contained object ids
 * to `onSelect` (additively). `pointercancel`/Escape call `cancel`, leaving
 * the selection unchanged. `MarqueeRect` renders the translucent rectangle in
 * the world layer.
 */

import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { objectsInRect } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';

export interface Marquee {
  /** The current marquee rect in world units (null while idle). */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

/** Screen point → world point for the current camera. */
function toWorld(cam: Camera, p: Point): Point {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);

  const setBoth = useCallback((r: Rect | null) => {
    rectRef.current = r;
    setRect(r);
  }, []);

  const begin = useCallback(
    (screen: Point) => {
      const world = toWorld(cameraRef.current, screen);
      startRef.current = world;
      setBoth(normalizeRect(world, world));
    },
    [setBoth],
  );

  const move = useCallback(
    (screen: Point) => {
      const start = startRef.current;
      if (!start) return;
      const world = toWorld(cameraRef.current, screen);
      setBoth(normalizeRect(start, world));
    },
    [setBoth],
  );

  const end = useCallback(() => {
    const current = rectRef.current;
    startRef.current = null;
    setBoth(null);
    if (current) {
      // Containment is computed against the snapshot at pointer-up time.
      onSelectRef.current(objectsInRect(snapshotRef.current, current));
    }
  }, [setBoth]);

  const cancel = useCallback(() => {
    startRef.current = null;
    setBoth(null);
  }, [setBoth]);

  // `rect` is a getter over the ref: callers (the viewport's move/end
  // guards) read it synchronously, even inside a batched act() before the
  // state update has re-rendered. The state still drives re-renders.
  return {
    get rect() {
      return rectRef.current;
    },
    begin,
    move,
    end,
    cancel,
  };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/** The translucent marquee rectangle, rendered in the world layer. */
export function MarqueeRect({ rect, camera }: MarqueeRectProps): JSX.Element | null {
  if (!rect) return null;
  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        border: `${1.5 / camera.zoom}px solid #1a73e8`,
        backgroundColor: 'rgba(26,115,232,0.1)',
        pointerEvents: 'none',
      }}
    />
  );
}
