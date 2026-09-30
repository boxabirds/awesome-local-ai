import { useState, useCallback, useRef } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectsInRect } from '@shared/board-model';
import { normalizeRect, type Rect } from '@shared/geometry';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

/**
 * Story 7: Shift+drag marquee selection (PRD sel.marquee).
 *
 * The rectangle is stored in world units so zoom changes mid-drag are
 * harmless. On `end`, the ids of the objects lying ENTIRELY inside the
 * rectangle are handed to `onSelect` (the caller adds them to the
 * selection). `cancel` (pointercancel / Escape) discards it.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): {
  rect: Rect | null;
  begin: (screen: Point) => void;
  move: (screen: Point) => void;
  end: () => void;
  cancel: () => void;
} {
  const [rect, setRect] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setRectBoth = useCallback((r: Rect | null) => {
    rectRef.current = r;
    setRect(r);
  }, []);

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    setRectBoth({ x: world.x, y: world.y, width: 0, height: 0 });
  }, [setRectBoth]);

  const move = useCallback((screen: Point) => {
    if (!startRef.current) return;
    const world = screenToWorld(cameraRef.current, screen);
    setRectBoth(normalizeRect(startRef.current, world));
  }, [setRectBoth]);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    setRectBoth(null);
    if (r && r.width > 0 && r.height > 0) {
      const ids = objectsInRect(snapshotRef.current, r);
      if (ids.length > 0) onSelectRef.current(ids);
    }
  }, [setRectBoth]);

  const cancel = useCallback(() => {
    startRef.current = null;
    setRectBoth(null);
  }, [setRectBoth]);

  return { rect, begin, move, end, cancel };
}

/**
 * The translucent light-blue selection rectangle, drawn in the world layer
 * (so it scales with the board zoom).
 */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }) {
  const { rect } = props;
  if (!rect) return null;
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
        backgroundColor: 'rgba(33, 150, 243, 0.15)',
        border: '1px solid rgba(33, 150, 243, 0.6)',
        pointerEvents: 'none',
      }}
    />
  );
}
