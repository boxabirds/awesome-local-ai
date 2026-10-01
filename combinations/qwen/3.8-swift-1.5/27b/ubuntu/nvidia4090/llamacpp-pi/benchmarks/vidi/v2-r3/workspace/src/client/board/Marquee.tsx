import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';

/**
 * Story 7 (sel.marquee): shift+drag on empty board space draws a marquee in
 * WORLD units (it follows pan/zoom while dragging) and selects every object
 * lying ENTIRELY inside it on release.
 *
 * The marquee is an optional mode of the viewport: `onPointerDown` with
 * `shiftKey` (empty space) begins it; a plain drag keeps panning (no
 * marquee, selection untouched). Escape cancels (`cancel`); pointercancel
 * cancels too. Selection merges additively with the current selection.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: readonly string[], additive: boolean) => void,
) {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const setBoth = useCallback((r: Rect | null) => {
    rectRef.current = r;
    setRect(r);
  }, []);

  const begin = useCallback(
    (screen: Point) => {
      startRef.current = screen;
      setBoth(normalizeRect(screen, screen));
    },
    [setBoth],
  );

  const move = useCallback(
    (screen: Point) => {
      const start = startRef.current;
      if (!start) return;
      const c = cameraRef.current;
      setBoth(normalizeRect(screenToWorld(c, start), screenToWorld(c, screen)));
    },
    [setBoth],
  );

  const end = useCallback(() => {
    const current = rectRef.current;
    startRef.current = null;
    setBoth(null);
    if (current && current.width > 0 && current.height > 0) {
      const ids = objectsInRect(snapshotRef.current, current);
      // Select every object lying entirely inside, merged additively.
      onSelectRef.current(ids, true);
    }
  }, [setBoth]);

  const cancel = useCallback(() => {
    startRef.current = null;
    setBoth(null);
  }, [setBoth]);

  return { rect, begin, move, end, cancel };
}

/** The marquee rectangle, drawn in world space (inside the camera layer). */
export function MarqueeRect({ rect }: { rect: Rect | null }): React.ReactElement | null {
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
        border: '1px solid #1565C0',
        background: 'rgba(21, 101, 192, 0.12)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}
